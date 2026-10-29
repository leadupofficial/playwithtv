import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { buildApp, type App } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { MemoryPersistence } from "../src/persistence.js";
import { MemoryPresence } from "../src/presence.js";
import { LiveTracker, istDay, type DayPeak, type LiveCounts } from "../src/live.js";

describe("LiveTracker", () => {
  const opts = { bucketMs: 30_000, keepMs: 60 * 60_000 };
  const T0 = Date.parse("2026-10-29T06:00:00Z"); // 11:30 IST, on a bucket boundary

  it("keeps the highest count seen in each 30 s slot, so a spike between polls is not lost", () => {
    let c: LiveCounts = { tvs: 1, phones: 2, rooms: 1, playing: 0 };
    const t = new LiveTracker(() => c, async () => undefined, opts, T0);
    t.observe(T0);
    c = { tvs: 1, phones: 6, rooms: 1, playing: 1 };
    t.observe(T0 + 2_000);
    c = { tvs: 1, phones: 3, rooms: 1, playing: 1 };
    const snap = t.snapshot(T0 + 4_000);
    expect(snap.current.phones).toBe(3);
    expect(snap.history).toEqual([{ t: T0, tvs: 1, phones: 6, rooms: 1, playing: 1 }]);
    const later = t.snapshot(T0 + 31_000);
    expect(later.history.map((s) => s.phones)).toEqual([6, 3]);
  });

  it("forgets samples older than an hour", () => {
    const t = new LiveTracker(() => ({ tvs: 0, phones: 1, rooms: 1, playing: 0 }), async () => undefined, opts, T0);
    for (let m = 0; m <= 90; m++) t.observe(T0 + m * 60_000);
    const h = t.snapshot(T0 + 90 * 60_000).history;
    expect(h[0]!.t).toBeGreaterThanOrEqual(T0 + 30 * 60_000);
    expect(h.length).toBeLessThanOrEqual(122);
  });

  it("saves the day's peak only when it rises, resets at India midnight, and merges a stored peak", async () => {
    const saved: DayPeak[] = [];
    let c: LiveCounts = { tvs: 2, phones: 4, rooms: 2, playing: 1 };
    const t = new LiveTracker(() => c, async (p) => void saved.push(p), opts, T0);
    t.seed({ day: istDay(T0), tvs: 3, phones: 9, rooms: 3 });
    t.seed({ day: "2001-01-01", tvs: 99, phones: 99, rooms: 99 }); // another day: ignored
    t.observe(T0);
    expect(saved).toEqual([]); // below the stored peak
    c = { tvs: 2, phones: 10, rooms: 2, playing: 1 };
    t.observe(T0 + 2_000);
    t.observe(T0 + 4_000);
    expect(saved).toEqual([{ day: "2026-10-29", tvs: 3, phones: 10, rooms: 3 }]);
    const midnightIst = Date.parse("2026-10-29T18:30:00Z");
    c = { tvs: 1, phones: 1, rooms: 1, playing: 0 };
    expect(t.snapshot(midnightIst + 1_000).peakToday).toEqual({ day: "2026-10-30", tvs: 1, phones: 1, rooms: 1 });
  });
});

describe("admin live + usage endpoints", () => {
  let app: App | undefined;
  let base = "";
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  class SpyDb extends MemoryPersistence {
    sessions: Array<[string, string | undefined]> = [];
    joins: Array<[string, string | undefined]> = [];
    override async sessionStarted(id: string, tv?: string) { this.sessions.push([id, tv]); }
    override async playerJoined(_s: string, p: string, _n: string, _a: string, device?: string) { this.joins.push([p, device]); }
  }

  async function start(db = new SpyDb()) {
    app = await buildApp({ ...loadConfig({}), adminToken: "y".repeat(40), publicUrl: "http://tv.test" }, db, new MemoryPresence());
    await app.http.listen({ port: 0, host: "127.0.0.1" });
    const addr = app.http.server.address();
    base = `127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
    return db;
  }
  const post = (path: string, body: unknown) =>
    fetch(`http://${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
  const admin = (path: string) => fetch(`http://${base}${path}`, { headers: { authorization: `Bearer ${"y".repeat(40)}` } }).then((r) => r.json());

  it("records the anonymous install ids of the TV and phones, and ignores a malformed one instead of failing", async () => {
    const db = await start();
    const tvDev = "tvDEVICE_abcdefghij12";
    const room = (await post("/api/rooms", { device: tvDev })).body;
    expect(db.sessions[0]).toEqual([room.roomId, tvDev]);
    const ok = await post("/api/join", { inviteToken: room.inviteToken, name: "Ravi", avatar: "tiger", device: "phone-1234567890abcdef" });
    expect(ok.status).toBe(200);
    const bad = await post("/api/join", { inviteToken: room.inviteToken, name: "Mala", avatar: "tiger", device: "<script>" });
    expect(bad.status).toBe(200);
    expect(db.joins.map((j) => j[1])).toEqual(["phone-1234567890abcdef", undefined]);
    // older TVs and phones that send no body / no device still work
    expect((await fetch(`http://${base}/api/rooms`, { method: "POST" })).status).toBe(200);
    expect((await post("/api/rooms", { device: 42 })).status).toBe(200);
  });

  it("live counts need the admin token and report TVs and phones online right now", async () => {
    await start();
    expect((await fetch(`http://${base}/api/admin/live`)).status).toBe(401);
    expect((await fetch(`http://${base}/api/admin/usage`)).status).toBe(401);
    const room = (await post("/api/rooms", {})).body;
    const tv = new WebSocket(`ws://${base}/ws`);
    await new Promise((r) => tv.once("open", r));
    const welcomed = new Promise((r) => tv.once("message", r));
    tv.send(JSON.stringify({ type: "hello", v: 1, role: "tv", roomId: room.roomId, hostToken: room.hostToken }));
    await welcomed;
    const j = (await post("/api/join", { inviteToken: room.inviteToken, name: "Ravi", avatar: "tiger" })).body;
    const ph = new WebSocket(`ws://${base}/ws`);
    await new Promise((r) => ph.once("open", r));
    const phWelcome = new Promise((r) => ph.once("message", r));
    ph.send(JSON.stringify({ type: "hello", v: 1, role: "controller", roomId: j.roomId, playerToken: j.playerToken }));
    await phWelcome;

    const live = await admin("/api/admin/live");
    expect(live.current).toMatchObject({ tvs: 1, phones: 1, rooms: 1, playing: 0 });
    expect(live.peakToday).toMatchObject({ tvs: 1, phones: 1, rooms: 1 });
    expect(live.rooms[0]).toMatchObject({ players: 1, online: 1, tv: true });
    expect(live.history.length).toBeGreaterThanOrEqual(1);

    const usage = await admin("/api/admin/usage?days=7");
    expect(usage.storage).toBe("memory");
    expect(usage.days).toHaveLength(7);
    expect(usage.days[0].peakPhones).toBe(1);
    tv.close();
    ph.close();
  });
});
