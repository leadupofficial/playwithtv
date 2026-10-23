import { afterEach, describe, expect, it } from "vitest";
import { buildApp, type App } from "../src/app.js";
import { loadConfig, productionProblems } from "../src/config.js";
import { MemoryPersistence } from "../src/persistence.js";
import { MemoryPresence } from "../src/presence.js";
import { FailureLock } from "../src/security.js";

let app: App | undefined;
let base = "";
async function start(over: Partial<ReturnType<typeof loadConfig>> = {}) {
  app = await buildApp({ ...loadConfig({}), adminToken: "x".repeat(40), publicUrl: "https://play.example.com", ...over }, new MemoryPersistence(), new MemoryPresence());
  await app.http.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.http.server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
}
afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("production settings", () => {
  it("refuses weak or missing production settings", () => {
    const weak = { ...loadConfig({}), adminToken: "short", allowedOrigins: [], publicUrl: "http://x" };
    expect(productionProblems(weak, { NODE_ENV: "production" })).toHaveLength(3);
    const good = { ...loadConfig({}), adminToken: "a".repeat(32), allowedOrigins: ["https://p.example"], publicUrl: "https://p.example" };
    expect(productionProblems(good, { NODE_ENV: "production" })).toEqual([]);
    expect(productionProblems(weak, { NODE_ENV: "development" })).toEqual([]); // laptops stay easy
  });
});

describe("browser protection headers", () => {
  it("sends CSP, anti-framing, HSTS and a permissions policy that allows motion but not camera or mic", async () => {
    await start();
    const r = await fetch(`${base}/healthz`);
    const csp = r.headers.get("content-security-policy")!;
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("connect-src 'self' wss://play.example.com");
    expect(r.headers.get("x-frame-options")).toBe("DENY");
    expect(r.headers.get("strict-transport-security")).toContain("max-age=");
    const pp = r.headers.get("permissions-policy")!;
    expect(pp).toContain("accelerometer=(self)");
    expect(pp).toContain("camera=()");
    expect(pp).toContain("microphone=()");
    expect(pp).toContain("geolocation=()");
  });

  it("the public health check reveals no usage numbers; metrics need the admin token", async () => {
    await start();
    expect(await (await fetch(`${base}/healthz`)).json()).toEqual({ ok: true, db: "memory", presence: "memory" });
    expect((await fetch(`${base}/metrics`)).status).toBe(401);
    expect((await fetch(`${base}/metrics`, { headers: { authorization: `Bearer ${"x".repeat(40)}` } })).status).toBe(200);
  });
});

describe("admin brute-force lock", () => {
  it("locks an address out after 5 wrong tokens, even if the 6th is right", async () => {
    await start();
    const tryToken = (t: string) => fetch(`${base}/api/admin/overview`, { headers: { authorization: `Bearer ${t}` } }).then((r) => r.status);
    for (let i = 0; i < 5; i++) expect(await tryToken(`guess-${i}`)).toBe(401);
    expect(await tryToken("x".repeat(40))).toBe(429);
  });

  it("forgets failures after the window and on success", () => {
    const lock = new FailureLock(2, 1000);
    lock.fail("ip", 0);
    lock.fail("ip", 10);
    expect(lock.locked("ip", 20)).toBe(true);
    expect(lock.locked("ip", 2000)).toBe(false);
    lock.fail("ip", 3000);
    lock.succeed("ip");
    expect(lock.locked("ip", 3001)).toBe(false);
  });
});
