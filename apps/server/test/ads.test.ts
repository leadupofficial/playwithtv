import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { buildApp, type App } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { MemoryPersistence } from "../src/persistence.js";
import { MemoryPresence } from "../src/presence.js";
import { todayIST, daysAgo } from "../src/ads.js";

let app: App | undefined;
let base = "";
const ADMIN = { authorization: "Bearer admin-secret" };
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);

async function start() {
  app = await buildApp({ ...loadConfig({}), adminToken: "admin-secret" }, new MemoryPersistence(), new MemoryPresence());
  await app.http.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.http.server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const raw = Buffer.isBuffer(body);
  const r = await fetch(base + path, {
    method,
    headers: { ...(body !== undefined && !raw ? { "content-type": "application/json" } : {}), ...headers },
    body: body === undefined ? undefined : raw ? new Uint8Array(body as Buffer) : JSON.stringify(body),
  });
  const text = await r.text();
  return { status: r.status, body: text ? (r.headers.get("content-type")?.includes("json") ? JSON.parse(text) : text) : null, headers: r.headers };
}

const sponsor = (over: Record<string, unknown> = {}) => ({
  advertiser: "Anbu Sweets", title: "Anbu Sweets, Karur", line: "Fresh mysorepak every morning",
  placements: ["lobby-rail", "in-game"], startsOn: daysAgo(todayIST(), 1), endsOn: daysAgo(todayIST(), -7), ...over,
});

describe("sponsors", () => {
  it("admin routes need the token", async () => {
    await start();
    expect((await call("GET", "/api/admin/ads")).status).toBe(401);
    expect((await call("POST", "/api/admin/ads", sponsor())).status).toBe(401);
    expect((await call("PUT", "/api/admin/ads/00000000-0000-4000-8000-000000000000/image", PNG, { "content-type": "image/png" })).status).toBe(401);
  });

  it("validates sponsor input", async () => {
    await start();
    expect((await call("POST", "/api/admin/ads", sponsor({ placements: [] }), ADMIN)).status).toBe(400);
    expect((await call("POST", "/api/admin/ads", sponsor({ placements: ["phone"] }), ADMIN)).status).toBe(400);
    expect((await call("POST", "/api/admin/ads", sponsor({ startsOn: "2026-10-10", endsOn: "2026-10-01" }), ADMIN)).status).toBe(400);
    expect((await call("POST", "/api/admin/ads", sponsor({ title: "x".repeat(61) }), ADMIN)).status).toBe(400);
  });

  it("TVs only get enabled sponsors that are running today", async () => {
    await start();
    const live = (await call("POST", "/api/admin/ads", sponsor(), ADMIN)).body;
    await call("POST", "/api/admin/ads", sponsor({ title: "Old", startsOn: "2020-01-01", endsOn: "2020-01-31" }), ADMIN);
    await call("POST", "/api/admin/ads", sponsor({ title: "Off", enabled: false }), ADMIN);
    const feed = await call("GET", "/api/ads");
    expect(feed.body.ads.map((a: { title: string }) => a.title)).toEqual(["Anbu Sweets, Karur"]);
    expect(feed.body.ads[0]).not.toHaveProperty("enabled");
    expect(feed.headers.get("cache-control")).toContain("max-age");

    const upd = await call("PUT", `/api/admin/ads/${live.id}`, sponsor({ enabled: false }), ADMIN);
    expect(upd.status).toBe(200);
    expect((await call("GET", "/api/ads")).body.ads).toEqual([]);
    expect((await call("DELETE", `/api/admin/ads/${live.id}`, undefined, ADMIN)).status).toBe(200);
    expect((await call("DELETE", `/api/admin/ads/${live.id}`, undefined, ADMIN)).status).toBe(404);
  });

  it("accepts real images only and serves them with a versioned URL", async () => {
    await start();
    const a = (await call("POST", "/api/admin/ads", sponsor(), ADMIN)).body;
    const url = `/api/admin/ads/${a.id}/image`;
    expect((await call("PUT", url, Buffer.from("<svg onload=alert(1)>"), { ...ADMIN, "content-type": "image/png" })).status).toBe(400);
    expect((await call("PUT", url, PNG, { ...ADMIN, "content-type": "image/svg+xml" })).status).toBe(415);
    expect((await call("PUT", url, Buffer.concat([PNG, Buffer.alloc(301 * 1024)]), { ...ADMIN, "content-type": "image/png" })).status).toBe(413);
    expect((await call("PUT", url, PNG, { ...ADMIN, "content-type": "image/png" })).status).toBe(200);

    const served = (await call("GET", "/api/ads")).body.ads[0];
    expect(served.imageUrl).toBe(`/api/ads/${a.id}/image?v=1`);
    const img = await fetch(base + served.imageUrl);
    expect(img.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await img.arrayBuffer()).equals(PNG)).toBe(true);
    expect((await fetch(`${base}/api/ads/not-a-uuid/image`)).status).toBe(404);
  });

  it("counts impressions only from a real TV's room connection, capped by what that room really showed", async () => {
    await start();
    const a = (await call("POST", "/api/admin/ads", sponsor(), ADMIN)).body; // booked for lobby-rail and in-game
    expect((await call("POST", "/api/ads/impressions", { items: [{ id: a.id, placement: "lobby-rail", n: 4 }] })).status).toBe(404); // no open endpoint

    const room = (await call("POST", "/api/rooms", {})).body;
    await call("POST", "/api/join", { inviteToken: room.inviteToken, name: "Viewer", avatar: "tiger" }); // someone is watching
    const tv = new WebSocket(base.replace("http", "ws") + "/ws");
    await new Promise((r) => tv.once("open", r));
    tv.send(JSON.stringify({ type: "hello", v: 1, role: "tv", roomId: room.roomId, hostToken: room.hostToken }));
    await new Promise((r) => tv.once("message", r));
    const report = () => tv.send(JSON.stringify({ type: "ads.impressions", items: [
      { id: a.id, placement: "lobby-rail", n: 9 },               // 25 s of lobby: at most 1 rotation counts
      { id: a.id, placement: "in-game", n: 3 },                  // no game was started: nothing counts
      { id: a.id, placement: "results-rail", n: 2 },             // not booked for this slot: ignored
      { id: crypto.randomUUID(), placement: "lobby-rail", n: 9 }, // unknown sponsor: ignored
    ] }));
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + 25_000);
      report();
      report(); // too soon after the first: dropped
      await new Promise((r) => setTimeout(r, 150));
    } finally {
      vi.useRealTimers();
    }
    const stats = (await call("GET", "/api/admin/ads", undefined, ADMIN)).body.stats;
    expect(stats).toEqual([{ id: a.id, placement: "lobby-rail", impressions: 1 }]);

    tv.send(JSON.stringify({ type: "ads.impressions", items: [{ id: a.id, placement: "lobby-rail", n: 500 }] }));
    const err = await new Promise<{ code: string }>((r) => tv.on("message", (d) => { const m = JSON.parse(String(d)); if (m.type === "error") r(m); }));
    expect(err.code).toBe("bad_message"); // per-report cap in the protocol
    tv.close();
  });

  it("phones cannot report impressions", async () => {
    await start();
    const room = (await call("POST", "/api/rooms", {})).body;
    const j = (await call("POST", "/api/join", { inviteToken: room.inviteToken, name: "Kid", avatar: "tiger" })).body;
    const ph = new WebSocket(base.replace("http", "ws") + "/ws");
    await new Promise((r) => ph.once("open", r));
    ph.send(JSON.stringify({ type: "hello", v: 1, role: "controller", roomId: j.roomId, playerToken: j.playerToken }));
    const err = new Promise<{ code: string }>((r) => ph.on("message", (d) => { const m = JSON.parse(String(d)); if (m.type === "error") r(m); }));
    ph.send(JSON.stringify({ type: "ads.impressions", items: [{ id: crypto.randomUUID(), placement: "lobby-rail", n: 1 }] }));
    expect((await err).code).toBe("not_allowed");
    ph.close();
  });
});
