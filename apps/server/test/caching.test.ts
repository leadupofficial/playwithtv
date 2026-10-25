import { mkdirSync, mkdtempSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { IMMUTABLE, REVALIDATE, STATIC, cacheControlFor } from "../src/caching.js";
import { type App, buildApp, upgradeIp } from "../src/app.js";
import { type Config, loadConfig } from "../src/config.js";
import { MemoryPersistence } from "../src/persistence.js";
import { MemoryPresence } from "../src/presence.js";

describe("cacheControlFor", () => {
  it("revalidates pages, the service worker and manifests so deploys show up at once", () => {
    for (const p of ["/", "/index.html", "/offline.html", "/sw.js", "/manifest.webmanifest", "/manifest-pick.js"]) {
      expect(cacheControlFor(p), p).toBe(REVALIDATE);
    }
  });

  it("caches hashed build files and versioned vendor files for a year", () => {
    for (const p of [
      "/assets/index-B3x_9aQz.js",
      "/assets/KalariGame-Dk2-aZ0q.js",
      "/assets/index-B3x_9aQz.css",
      "/assets/index-B3x_9aQz.js.map",
      "/vendor/mediapipe-0.10.35/pose_landmarker_lite.task",
      "/vendor/mediapipe-0.10.35/wasm/vision_wasm_internal.wasm",
    ]) expect(cacheControlFor(p), p).toBe(IMMUTABLE);
  });

  it("gives game art under fixed names a short browser and a day-long CDN lifetime", () => {
    for (const p of [
      "/assets/kenney-voiceover/ready.ogg",
      "/assets/kalari-clash/kloppenheim_06_puresky_512.hdr",
      "/assets/ghat-rush/bus.json",
      "/icons/icon-192.png",
      "/fonts/noto-sans-tamil-tamil-400-normal.woff2",
      "/vendor/three-addons/thing.js",
    ]) expect(cacheControlFor(p), p).toBe(STATIC);
  });

  it("ignores query strings", () => {
    expect(cacheControlFor("/sw.js?v=2")).toBe(REVALIDATE);
    expect(cacheControlFor("/assets/index-B3x_9aQz.js?x")).toBe(IMMUTABLE);
  });

  it("never marks a hand-made public file immutable (it could then never be replaced)", () => {
    const pub = fileURLToPath(new URL("../../web/public", import.meta.url));
    const walk = (d: string): string[] => readdirSync(d).flatMap((n) => {
      const f = join(d, n);
      return statSync(f).isDirectory() ? walk(f) : [f];
    });
    const wrong = walk(pub)
      .map((f) => "/" + relative(pub, f).split(sep).join("/"))
      .filter((p) => !p.startsWith("/vendor/") && cacheControlFor(p) === IMMUTABLE);
    expect(wrong).toEqual([]);
  });
});

describe("upgradeIp", () => {
  const req = (remote: string, xff?: string) => ({ socket: { remoteAddress: remote }, headers: xff ? { "x-forwarded-for": xff } : {} }) as never;

  it("uses the socket address when no proxy is trusted", () => {
    expect(upgradeIp(req("10.0.0.5", "1.2.3.4"), 0)).toBe("10.0.0.5");
  });

  it("takes one forwarded entry per trusted proxy, from the right (a client can't spoof past the proxy)", () => {
    expect(upgradeIp(req("172.18.0.2", "6.6.6.6, 1.2.3.4"), 1)).toBe("1.2.3.4");
    expect(upgradeIp(req("172.18.0.2", "6.6.6.6, 1.2.3.4"), 2)).toBe("6.6.6.6");
  });

  it("falls back to the furthest known address when there are fewer entries than hops", () => {
    expect(upgradeIp(req("172.18.0.2"), 1)).toBe("172.18.0.2");
    expect(upgradeIp(req("172.18.0.2", "1.2.3.4"), 3)).toBe("1.2.3.4");
  });
});

describe("hub capacity guards and static headers (live server)", () => {
  let app: App | undefined;
  let base = "";
  const dist = mkdtempSync(join(tmpdir(), "pwtv-dist-"));
  mkdirSync(join(dist, "assets", "game"), { recursive: true });
  writeFileSync(join(dist, "index.html"), "<!doctype html><title>t</title>");
  writeFileSync(join(dist, "assets", "index-B3x_9aQz.js"), "x");
  writeFileSync(join(dist, "assets", "game", "hero.webp"), "x");

  async function start(over: Partial<Config> = {}) {
    app = await buildApp({ ...loadConfig({}), adminToken: "x".repeat(40), webDist: dist, ...over }, new MemoryPersistence(), new MemoryPresence());
    await app.http.listen({ port: 0, host: "127.0.0.1" });
    const addr = app.http.server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  }
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });
  const open = (headers: Record<string, string> = {}) => new Promise<WebSocket | number>((resolve) => {
    const ws = new WebSocket(base.replace("http", "ws") + "/ws", { headers });
    ws.once("open", () => resolve(ws));
    ws.once("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
    ws.once("error", () => undefined);
  });

  it("serves each kind of file with its cache policy", async () => {
    await start();
    const cc = async (p: string) => (await fetch(base + p)).headers.get("cache-control");
    expect(await cc("/assets/index-B3x_9aQz.js")).toBe(IMMUTABLE);
    expect(await cc("/assets/game/hero.webp")).toBe(STATIC);
    expect(await cc("/")).toBe(REVALIDATE);
    expect(await cc("/tv")).toBe(REVALIDATE); // client-side route → index.html
  });

  it("answers 503 server_busy once the room cap is reached", async () => {
    await start({ maxRooms: 2 });
    const post = () => fetch(base + "/api/rooms", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect((await post()).status).toBe(200);
    expect((await post()).status).toBe(200);
    const busy = await post();
    expect(busy.status).toBe(503);
    expect((await busy.json()).error).toBe("server_busy");
  });

  it("refuses WebSockets past the per-address cap, and frees the slot when one closes", async () => {
    await start({ maxSocketsPerIp: 2, trustProxyHops: 1 });
    const a = await open({ "x-forwarded-for": "1.1.1.1" });
    const b = await open({ "x-forwarded-for": "1.1.1.1" });
    expect(a).toBeInstanceOf(WebSocket);
    expect(b).toBeInstanceOf(WebSocket);
    expect(await open({ "x-forwarded-for": "1.1.1.1" })).toBe(503);
    const other = await open({ "x-forwarded-for": "2.2.2.2" }); // a different home is unaffected
    expect(other).toBeInstanceOf(WebSocket);
    await new Promise<void>((r) => { (a as WebSocket).once("close", () => r()); (a as WebSocket).close(); });
    await new Promise((r) => setTimeout(r, 50));
    expect(await open({ "x-forwarded-for": "1.1.1.1" })).toBeInstanceOf(WebSocket);
  });

  it("refuses WebSockets past the total cap", async () => {
    await start({ maxSockets: 1 });
    expect(await open()).toBeInstanceOf(WebSocket);
    expect(await open()).toBe(503);
  });
});
