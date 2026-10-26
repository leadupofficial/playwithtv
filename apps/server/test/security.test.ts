import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp, isPhonePage, type App } from "../src/app.js";
import { loadConfig, productionProblems } from "../src/config.js";
import { MemoryPersistence } from "../src/persistence.js";
import { MemoryPresence } from "../src/presence.js";
import { FailureLock, addressOf, networkOf } from "../src/security.js";

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

  it("only the phone controller page may compile WebAssembly and use the camera (camera games); never JS eval", async () => {
    await start();
    for (const path of ["/join", "/join?i=abc123", "/join/", "/controller"]) {
      const r = await fetch(`${base}${path}`);
      const csp = r.headers.get("content-security-policy")!;
      expect(csp, path).toContain("script-src 'self' 'wasm-unsafe-eval';");
      expect(csp, path).not.toMatch(/'unsafe-eval'|unsafe-inline/);
      expect(csp, path).toContain("connect-src 'self' wss://play.example.com");
      expect(csp, path).toContain("frame-ancestors 'none'");
      const pp = r.headers.get("permissions-policy")!;
      expect(pp, path).toContain("camera=(self)");
      expect(pp, path).toContain("microphone=()");
    }
    for (const path of ["/", "/tv", "/play", "/admin", "/sensors", "/joinx", "/tv?next=/join", "/api/games", "/healthz", "/assets/x.js"]) {
      const r = await fetch(`${base}${path}`);
      expect(r.headers.get("content-security-policy"), path).not.toContain("wasm-unsafe-eval");
      expect(r.headers.get("content-security-policy"), path).toContain("script-src 'self';");
      expect(r.headers.get("permissions-policy"), path).toContain("camera=()");
    }
    expect([isPhonePage("/join?x=1#y"), isPhonePage("/controller/"), isPhonePage("/join-us"), isPhonePage("/admin?join")]).toEqual([true, true, false, false]);
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

describe("client address behind a proxy", () => {
  it("a client cannot dodge the admin lock by writing its own X-Forwarded-For", async () => {
    await start(); // default: one trusted proxy hop
    const attempt = (i: number) => fetch(`${base}/api/admin/overview`, {
      // the "proxy" (this test) appends the real address last; the attacker controls everything before it
      headers: { authorization: "Bearer wrong", "x-forwarded-for": `10.0.0.${i}, 203.0.113.7` },
    }).then((r) => r.status);
    for (let i = 0; i < 5; i++) expect(await attempt(i)).toBe(401);
    expect(await attempt(99)).toBe(429); // still the same client: locked
  });
});

describe("join-code guessing", () => {
  it("locks an address after 10 wrong codes; QR invites keep working", async () => {
    await start();
    const room = await (await fetch(`${base}/api/rooms`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).json();
    const join = (body: object) => fetch(`${base}/api/join`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "G", avatar: "tiger", ...body }) }).then((r) => r.status);
    for (let i = 0; i < 10; i++) expect(await join({ joinCode: "ZZZZZ" })).toBe(404);
    expect(await join({ joinCode: room.joinCode })).toBe(429);          // even the right code, for now
    expect(await join({ inviteToken: room.inviteToken })).toBe(200);    // unguessable QR invites are unaffected
  });
});

describe("join-code guessing can't be turned against everyone", () => {
  const setup = async () => {
    await start();
    const room = await (await fetch(`${base}/api/rooms`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).json();
    const join = (body: object, ip: string) => fetch(`${base}/api/join`, {
      method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify({ name: "G", avatar: "tiger", ...body }),
    }).then((r) => r.status);
    return { room, join };
  };

  it("an attacker hopping addresses in one network is slowed down; families elsewhere still join", async () => {
    const { room, join } = await setup();
    for (let i = 0; i < 70; i++) await join({ joinCode: "ZZZZZ" }, `198.51.100.${i}`); // 1 miss per address
    expect(await join({ joinCode: room.joinCode }, "198.51.100.200")).toBe(429); // that network must wait a moment
    expect(await join({ joinCode: room.joinCode }, "203.0.113.9")).toBe(200);    // other networks: unaffected
    expect(await join({ inviteToken: room.inviteToken }, "198.51.100.201")).toBe(200); // QR always works
  });

  it("network back-off is short (a 2 s refill), not a long ban", async () => {
    const { room, join } = await setup();
    for (let i = 0; i < 70; i++) await join({ joinCode: "ZZZZZ" }, `192.0.2.${i}`);
    expect(await join({ joinCode: room.joinCode }, "192.0.2.250")).toBe(429);
    await new Promise((r) => setTimeout(r, 2100));
    expect(await join({ joinCode: room.joinCode }, "192.0.2.250")).toBe(200);
  });

  it("groups addresses into network blocks, whatever their spelling", () => {
    expect(networkOf("198.51.100.77")).toBe("198.51.100.0/24");
    expect(networkOf("::ffff:198.51.100.77")).toBe("198.51.100.0/24");
    expect(networkOf("2001:db8:abcd:12::1")).toBe("2001:db8:abcd::/48");
    expect(networkOf("2001:0db8:abcd:0012:0000:0000:0000:0001")).toBe("2001:db8:abcd::/48");
    expect(networkOf("2001:db8::1")).toBe("2001:db8:0::/48");
    expect(networkOf("fe80::1%eth0")).toBe("fe80:0:0::/48");
    expect(networkOf("::1")).toBe("0:0:0::/48");
    expect(networkOf("not-an-ip")).toBe("invalid:not-an-ip");
  });
});

describe("site-wide slow-down only reaches networks that guessed wrong", () => {
  it("during a global flood, a clean network's right code still gets in at once", async () => {
    await start();
    // the budgets refill with time, so the clock only moves when the test says so (a slow CI runner would
    // otherwise refill the site budget while the flood below is still being sent)
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
    const room = await (await fetch(`${base}/api/rooms`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).json();
    const join = (body: object, ip: string) => fetch(`${base}/api/join`, {
      method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify({ name: "G", avatar: "tiger", ...body }),
    }).then((r) => r.status);
    // 320 wrong codes from many networks (one each), draining the site-wide budget
    for (let i = 0; i < 320; i++) await join({ joinCode: "ZZZZZ" }, `10.${i >> 8}.${i & 255}.1`);
    expect(await join({ joinCode: "ZZZZZ" }, "10.0.5.9")).toBe(429);           // a guessing network: slowed
    vi.setSystemTime(Date.now() + 2500);                                            // its own budget refills (2 s)…
    for (let i = 0; i < 20; i++) await join({ joinCode: "ZZZZZ" }, `10.200.${i}.1`); // the flood drains the site budget again
    expect(await join({ joinCode: "ZZZZZ" }, "10.0.5.9")).toBe(429);           // …but it is still marked as a guesser
    expect(await join({ joinCode: room.joinCode }, "203.0.113.51")).toBe(200);  // and clean networks still get in
    expect(await join({ joinCode: room.joinCode }, "203.0.113.50")).toBe(200);  // a clean network: straight in
    } finally {
      vi.useRealTimers();
    }
  });

  it("keys one client as its IPv4 address or IPv6 /64", () => {
    expect(addressOf("198.51.100.7")).toBe("198.51.100.7");
    expect(addressOf("2001:db8:1:2:aaaa::1")).toBe("2001:db8:1:2::/64");
    expect(addressOf("2001:db8:1:2:bbbb::9")).toBe("2001:db8:1:2::/64");
  });
});
