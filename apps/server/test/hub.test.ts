import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { buildApp, type App } from "../src/app.js";
import { loadConfig, type Config } from "../src/config.js";
import { MemoryPersistence } from "../src/persistence.js";
import { MemoryPresence } from "../src/presence.js";
import type { ServerMessage } from "@playwithtv/protocol";

let app: App | undefined;
let base = "";

async function start(over: Partial<Config> = {}) {
  const cfg = { ...loadConfig({}), publicUrl: "http://tv.test", adminToken: "admin-secret", ...over };
  app = await buildApp(cfg, new MemoryPersistence(), new MemoryPresence());
  await app.http.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.http.server.address();
  base = `127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  return cfg;
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  const r = await fetch(`http://${base}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
}

/** A WebSocket client that records every message and can wait for a matching one. */
class Client {
  ws: WebSocket;
  msgs: ServerMessage[] = [];
  private waiters: Array<{ pred: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }> = [];
  closed: Promise<number>;
  constructor(origin?: string) {
    this.ws = new WebSocket(`ws://${base}/ws`, origin ? { headers: { origin } } : undefined);
    this.ws.on("message", (d) => {
      const m = JSON.parse(d.toString()) as ServerMessage;
      this.msgs.push(m);
      this.waiters = this.waiters.filter((w) => (w.pred(m) ? (w.resolve(m), false) : true));
    });
    this.closed = new Promise((res) => this.ws.on("close", (code) => res(code)));
  }
  open() {
    return new Promise<void>((res, rej) => {
      this.ws.once("open", () => res());
      this.ws.once("error", rej);
    });
  }
  send(m: unknown) {
    this.ws.send(JSON.stringify(m));
  }
  next<T extends ServerMessage["type"]>(type: T, pred: (m: Extract<ServerMessage, { type: T }>) => boolean = () => true, ms = 2000) {
    const found = this.msgs.find((m) => m.type === type && pred(m as never));
    if (found) {
      this.msgs = this.msgs.filter((m) => m !== found);
      return Promise.resolve(found as Extract<ServerMessage, { type: T }>);
    }
    return new Promise<Extract<ServerMessage, { type: T }>>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`timeout waiting for ${type}`)), ms);
      this.waiters.push({
        pred: (m) => m.type === type && pred(m as never),
        resolve: (m) => {
          clearTimeout(t);
          this.msgs = this.msgs.filter((x) => x !== m);
          resolve(m as Extract<ServerMessage, { type: T }>);
        },
      });
    });
  }
  close() {
    this.ws.close();
  }
}

async function tv() {
  const room = (await post("/api/rooms", {})).body;
  const c = new Client();
  await c.open();
  c.send({ type: "hello", v: 1, role: "tv", roomId: room.roomId, hostToken: room.hostToken });
  await c.next("welcome");
  return { room, c };
}

async function phone(join: { inviteToken?: string; joinCode?: string }, name = "Ravi") {
  const res = await post("/api/join", { ...join, name, avatar: "tiger" });
  expect(res.status).toBe(200);
  const c = new Client();
  await c.open();
  c.send({ type: "hello", v: 1, role: "controller", roomId: res.body.roomId, playerToken: res.body.playerToken });
  await c.next("welcome");
  return { c, ...res.body } as { c: Client; roomId: string; playerId: string; playerToken: string };
}

describe("rooms and invitations", () => {
  it("creates a room with an unguessable invite, a 5-character code and a join URL", async () => {
    await start();
    const r = await post("/api/rooms", {});
    expect(r.status).toBe(200);
    expect(r.body.joinCode).toMatch(/^[A-HJ-NP-Z2-9]{5}$/);
    expect(r.body.inviteToken.length).toBeGreaterThanOrEqual(32);
    expect(r.body.joinUrl).toBe(`http://tv.test/join?i=${r.body.inviteToken}`);
    expect(r.body.expiresAt).toBeGreaterThan(Date.now());
  });

  it("joins by QR invite and by manual code, and shows players in the TV lobby", async () => {
    await start();
    const { room, c: t } = await tv();
    await phone({ inviteToken: room.inviteToken }, "Ravi");
    await phone({ joinCode: room.joinCode.toLowerCase() }, "Meena");
    const st = await t.next("room.state", (m) => m.room.players.length === 2 && m.room.players.every((p) => p.connected));
    expect(st.room.players.map((p) => p.name).sort()).toEqual(["Meena", "Ravi"]);
  });

  it("rejects wrong codes, bad names and expired invites", async () => {
    await start({ inviteTtlMs: 50 });
    const r = await post("/api/rooms", {});
    expect((await post("/api/join", { joinCode: "ZZZZZ", name: "A", avatar: "tiger" })).status).toBe(404);
    expect((await post("/api/join", { inviteToken: r.body.inviteToken, name: "<script>", avatar: "tiger" })).status).toBe(400);
    await new Promise((res) => setTimeout(res, 80));
    const late = await post("/api/join", { inviteToken: r.body.inviteToken, name: "Late", avatar: "tiger" });
    expect(late.status).toBe(410);
    expect(late.body.error).toBe("invite_expired");
  });

  it("rotating the invite invalidates the old QR token and code", async () => {
    await start();
    const { room, c: t } = await tv();
    t.send({ type: "room.rotateInvite" });
    const inv = await t.next("room.invite", (m) => m.inviteToken !== room.inviteToken);
    expect((await post("/api/join", { inviteToken: room.inviteToken, name: "Old", avatar: "tiger" })).status).toBe(404);
    expect((await post("/api/join", { inviteToken: inv.inviteToken, name: "New", avatar: "tiger" })).status).toBe(200);
  });

  it("caps a room at 8 players and dedupes names", async () => {
    await start();
    const { room } = await tv();
    for (let i = 0; i < 8; i++) expect((await post("/api/join", { joinCode: room.joinCode, name: "Sam", avatar: "lotus" })).status).toBe(200);
    const full = await post("/api/join", { joinCode: room.joinCode, name: "Nine", avatar: "lotus" });
    expect(full.status).toBe(409);
    expect(full.body.error).toBe("room_full");
  });

  it("a rejoin with the player token keeps the same identity", async () => {
    await start();
    const { room } = await tv();
    const a = await post("/api/join", { joinCode: room.joinCode, name: "Ravi", avatar: "tiger" });
    const b = await post("/api/join", { joinCode: room.joinCode, name: "Ravi K", avatar: "cobra", playerToken: a.body.playerToken });
    expect(b.body.playerId).toBe(a.body.playerId);
  });
});

describe("sockets and input", () => {
  it("rejects a controller hello with a forged token and an unknown protocol version", async () => {
    await start();
    const { room } = await tv();
    const c = new Client();
    await c.open();
    c.send({ type: "hello", v: 1, role: "controller", roomId: room.roomId, playerToken: "forged" });
    expect((await c.next("error")).code).toBe("unauthorized");
    const d = new Client();
    await d.open();
    d.send({ type: "hello", v: 99, role: "tv", roomId: room.roomId, hostToken: room.hostToken });
    expect((await d.next("error")).code).toBe("unsupported_version");
  });

  it("a hello to a room that has ended closes with that reason, so queued messages cannot bury it under 'say hello first'", async () => {
    await start();
    const c = new Client();
    await c.open();
    // what a phone does on reconnect: hello, then whatever it queued while offline
    c.send({ type: "hello", v: 1, role: "controller", roomId: "gone-room", playerToken: "old" });
    c.send({ type: "player.ready", ready: true });
    const err = await c.next("error");
    expect(err.code).toBe("room_not_found");
    expect(err.message).toBe("This room has ended.");
    expect(await Promise.race([c.closed, new Promise((r) => setTimeout(() => r("open"), 1000))])).toBe(4400);
    expect(c.msgs.filter((m) => m.type === "error")).toEqual([]); // nothing after the real reason
  });

  it("a second hello on a working connection is refused without dropping it", async () => {
    await start();
    const { room, c: t } = await tv();
    t.send({ type: "hello", v: 1, role: "tv", roomId: room.roomId, hostToken: room.hostToken });
    expect((await t.next("error")).code).toBe("not_allowed");
    t.send({ type: "ping", t: 1 });
    await t.next("pong");
  });

  it("relays controller state to the TV, drops stale frames and invalid values", async () => {
    await start();
    const { room, c: t } = await tv();
    const p = await phone({ inviteToken: room.inviteToken });
    p.c.send({ type: "controller.input", seq: 5, state: { axes: { steer: 0.5 }, buttons: { brake: true } } });
    const got = await t.next("controller.input");
    expect(got).toMatchObject({ playerId: p.playerId, seq: 5, state: { axes: { steer: 0.5 }, buttons: { brake: true } } });
    p.c.send({ type: "controller.input", seq: 4, state: { axes: { steer: -1 } } }); // stale
    p.c.send({ type: "controller.input", seq: 6, state: { axes: { steer: 7 } } }); // out of range
    expect((await p.c.next("error")).code).toBe("bad_message");
    p.c.send({ type: "controller.input", seq: 7, state: { taps: { a: 1 } } });
    const next = await t.next("controller.input");
    expect(next.seq).toBe(7);
  });

  it("closes connections that send oversized frames", async () => {
    await start();
    const c = new Client();
    await c.open();
    c.send({ type: "ping", t: 1, pad: "x".repeat(10_000) });
    expect(await c.closed).toBe(1009);
  });

  it("even the captain's phone cannot do TV-only things (layouts, events, results, removing players)", async () => {
    await start();
    const { room } = await tv();
    const p = await phone({ inviteToken: room.inviteToken }); // the only player, so the captain
    for (const m of [
      { type: "controller.layout", to: "all", layout: "lobby" },
      { type: "tv.event", to: "all", event: "outcome" },
      { type: "game.finished", results: [], durationMs: 1 },
      { type: "player.remove", playerId: p.playerId },
    ]) {
      p.c.send(m);
      expect((await p.c.next("error")).code).toBe("not_allowed");
    }
  });

  it("clears a player's controls on disconnect and accepts a reconnect", async () => {
    await start();
    const { room, c: t } = await tv();
    const p = await phone({ inviteToken: room.inviteToken });
    p.c.close();
    expect((await t.next("controller.clear")).playerId).toBe(p.playerId);
    await t.next("room.state", (m) => m.room.players[0]?.connected === false);
    const again = new Client();
    await again.open();
    again.send({ type: "hello", v: 1, role: "controller", roomId: p.roomId, playerToken: p.playerToken });
    const w = await again.next("welcome");
    expect(w.playerId).toBe(p.playerId);
    await t.next("room.state", (m) => m.room.players[0]?.connected === true);
  });

  it("relays a reloaded phone whose input sequence starts again at 0", async () => {
    await start();
    const { room, c: t } = await tv();
    const p = await phone({ inviteToken: room.inviteToken });
    p.c.send({ type: "controller.input", seq: 50, state: { taps: { push: 9 } } });
    expect((await t.next("controller.input")).seq).toBe(50);
    p.c.close();
    await t.next("controller.clear");
    const again = new Client();
    await again.open();
    again.send({ type: "hello", v: 1, role: "controller", roomId: p.roomId, playerToken: p.playerToken });
    await again.next("welcome");
    again.send({ type: "controller.input", seq: 0, state: { taps: { push: 1 } } });
    const m = await t.next("controller.input", (x) => x.seq === 0);
    expect(m.state.taps?.push).toBe(1);
  });

  it("tells the TV to forget a phone's input numbers when a newer connection replaces a still-open one", async () => {
    await start();
    const { room, c: t } = await tv();
    const p = await phone({ inviteToken: room.inviteToken });
    p.c.send({ type: "controller.input", seq: 50, state: { taps: { push: 9 } } });
    expect((await t.next("controller.input")).seq).toBe(50);
    const again = new Client(); // reconnects before the old socket closed (Wi-Fi switch, fast reload)
    await again.open();
    again.send({ type: "hello", v: 1, role: "controller", roomId: p.roomId, playerToken: p.playerToken });
    await again.next("welcome");
    expect((await t.next("controller.clear")).playerId).toBe(p.playerId);
    again.send({ type: "controller.input", seq: 0, state: { taps: { push: 1 } } });
    expect((await t.next("controller.input", (x) => x.seq === 0)).state.taps?.push).toBe(1);
  });

  it("rejects WebSockets from origins that are not allowed", async () => {
    await start({ allowedOrigins: ["http://tv.test"] });
    const bad = new Client("http://evil.test");
    await expect(bad.open()).rejects.toThrow();
    const good = new Client("http://tv.test");
    await good.open();
    good.close();
  });
});

describe("game lifecycle", () => {
  it("select, start (with the right layout), finish with validated results, then rematch", async () => {
    await start();
    const { room, c: t } = await tv();
    const p = await phone({ inviteToken: room.inviteToken });
    t.send({ type: "game.start" });
    expect((await t.next("error")).code).toBe("unknown_game");
    t.send({ type: "game.select", gameId: "neon-drift-arena" }); // not playable yet
    expect((await t.next("error")).code).toBe("unknown_game");
    t.send({ type: "game.select", gameId: "memory-wave" });
    await t.next("game.selected");
    t.send({ type: "game.start" });
    const started = await t.next("game.started");
    expect(started.players).toHaveLength(1);
    expect((await p.c.next("controller.layout", (m) => m.layout === "game")).layout).toBe("game");

    t.send({ type: "game.finished", results: [{ playerId: "someone-else", score: 9, place: 1 }], durationMs: 1000 });
    expect((await t.next("error")).code).toBe("bad_message");
    t.send({ type: "game.finished", results: [{ playerId: p.playerId, score: 4, place: 1 }], durationMs: 1000 });
    const fin = await p.c.next("game.finished");
    expect(fin.results[0]).toMatchObject({ playerId: p.playerId, score: 4 });

    t.send({ type: "game.start" }); // rematch without reloading
    await t.next("game.started");
    t.send({ type: "game.exit" });
    await t.next("room.state", (m) => m.room.status === "lobby" && m.room.gameId === null);
  });

  it("finishes a game whose results still name a player who left mid-game (the TV is not stranded)", async () => {
    await start();
    const { room, c: t } = await tv();
    const a = await phone({ inviteToken: room.inviteToken }, "Ana");
    const b = await phone({ inviteToken: room.inviteToken }, "Bala");
    const c = await phone({ inviteToken: room.inviteToken }, "Chitra");
    t.send({ type: "game.select", gameId: "memory-wave" });
    await t.next("game.selected");
    t.send({ type: "game.start" });
    await t.next("game.started");
    b.c.send({ type: "player.leave" });
    // (an earlier room.state from before Chitra joined also lists two players: wait for the one without Bala)
    await t.next("room.state", (m) => m.room.players.length === 2 && !m.room.players.some((x) => x.id === b.playerId));
    // the game still reports everyone it started with: Bala won, Ana and Chitra tied second
    t.send({
      type: "game.finished",
      durationMs: 1000,
      results: [
        { playerId: b.playerId, score: 9, place: 1 },
        { playerId: a.playerId, score: 5, place: 2 },
        { playerId: c.playerId, score: 5, place: 2 },
      ],
    });
    const fin = await a.c.next("game.finished");
    expect(fin.results).toEqual([
      { playerId: a.playerId, score: 5, place: 1 },
      { playerId: c.playerId, score: 5, place: 1 },
    ]);
    await t.next("room.state", (m) => m.room.status === "results");
    // a stranger is still refused
    t.send({ type: "game.start" });
    await t.next("game.started");
    t.send({ type: "game.finished", results: [{ playerId: "someone-else", score: 1, place: 1 }], durationMs: 1 });
    expect((await t.next("error")).code).toBe("bad_message");
  });

  it("keeps held-back games off the public list and refuses to start them, unless the hub previews them", async () => {
    await start();
    const list = (await (await fetch(`http://${base}/api/games`)).json()) as Array<{ id: string }>;
    for (const id of ["tamil-trivia-royale", "two-paths", "mind-match", "lantern-truths"]) expect(list.some((g) => g.id === id)).toBe(false);
    expect(list.some((g) => g.id === "memory-wave")).toBe(true);
    const { c: t } = await tv();
    t.send({ type: "game.select", gameId: "two-paths" });
    expect((await t.next("error")).code).toBe("unknown_game");
    await app!.close();

    await start({ previewGames: true });
    expect(((await (await fetch(`http://${base}/api/games`)).json()) as Array<{ id: string }>).some((g) => g.id === "two-paths")).toBe(true);
    const { c: t2 } = await tv();
    t2.send({ type: "game.select", gameId: "two-paths" });
    expect((await t2.next("game.selected")).gameId).toBe("two-paths");
  });

  it("enforces the game's player count", async () => {
    await start();
    const { c: t } = await tv();
    t.send({ type: "game.select", gameId: "memory-wave" });
    await t.next("game.selected");
    t.send({ type: "game.start" }); // nobody connected
    expect((await t.next("error")).code).toBe("player_count");
  });

  it("routes TV events to one player or everyone", async () => {
    await start();
    const { room, c: t } = await tv();
    const a = await phone({ inviteToken: room.inviteToken }, "A");
    const b = await phone({ inviteToken: room.inviteToken }, "B");
    t.send({ type: "tv.event", to: a.playerId, event: "vibrate", data: { ms: 50 } });
    expect((await a.c.next("tv.event")).event).toBe("vibrate");
    t.send({ type: "tv.event", to: "all", event: "round" });
    await a.c.next("tv.event", (m) => m.event === "round");
    await b.c.next("tv.event", (m) => m.event === "round");
    expect(b.c.msgs.some((m) => m.type === "tv.event" && m.event === "vibrate")).toBe(false);
  });
});

describe("cleanup, limits and admin", () => {
  it("expires a room after the TV has been gone for the grace period", async () => {
    await start({ tvGraceMs: 30 });
    const { room, c: t } = await tv();
    const p = await phone({ inviteToken: room.inviteToken });
    t.close();
    await new Promise((res) => setTimeout(res, 60));
    app!.hub.sweep();
    await p.c.next("room.expired");
    expect(app!.hub.stats().rooms).toBe(0);
    expect((await post("/api/join", { joinCode: room.joinCode, name: "X", avatar: "tiger" })).status).toBe(404);
  });

  it("rate-limits joining", async () => {
    await start();
    const r = await post("/api/rooms", {});
    let limited = false;
    for (let i = 0; i < 30 && !limited; i++) {
      limited = (await post("/api/join", { joinCode: r.body.joinCode, name: "Spam", avatar: "tiger" })).status === 429;
    }
    expect(limited).toBe(true);
  });

  it("protects admin routes with the admin token", async () => {
    await start();
    expect((await fetch(`http://${base}/api/admin/overview`)).status).toBe(401);
    const ok = await fetch(`http://${base}/api/admin/overview`, { headers: { authorization: "Bearer admin-secret" } });
    expect(ok.status).toBe(200);
    const off = await post("/api/admin/games/memory-wave", { enabled: false }, { authorization: "Bearer admin-secret" });
    expect(off.status).toBe(200);
    const list = await (await fetch(`http://${base}/api/games`)).json();
    expect(list.find((g: { id: string }) => g.id === "memory-wave")).toBeUndefined();
  });

  it("reports health", async () => {
    await start();
    const h = await (await fetch(`http://${base}/healthz`)).json();
    expect(h).toEqual({ ok: true, db: "memory", presence: "memory" });
  });
});

describe("TV reconnects mid-game", () => {
  it("pauses when the TV drops and resumes when it comes back; phones keep their game controller", async () => {
    await start();
    const { room, c: t } = await tv();
    const p = await phone({ inviteToken: room.inviteToken });
    t.send({ type: "game.select", gameId: "memory-wave" });
    await t.next("game.selected");
    t.send({ type: "game.start" });
    await t.next("game.started");
    t.close();
    expect((await p.c.next("game.paused", (m) => m.paused)).paused).toBe(true);
    const t2 = new Client();
    await t2.open();
    t2.send({ type: "hello", v: 1, role: "tv", roomId: room.roomId, hostToken: room.hostToken });
    expect((await p.c.next("game.paused", (m) => !m.paused)).paused).toBe(false);
    await t2.next("room.state", (m) => m.room.status === "playing");
    // a phone that reconnects during the game gets the game's controller, not the lobby
    p.c.close();
    const again = new Client();
    await again.open();
    again.send({ type: "hello", v: 1, role: "controller", roomId: p.roomId, playerToken: p.playerToken });
    expect((await again.next("controller.layout")).layout).toBe("game");
  });

  it("replays the TV's latest layout (with its data) to a phone that reconnects", async () => {
    await start();
    const { room, c: t } = await tv();
    const p = await phone({ inviteToken: room.inviteToken });
    t.send({ type: "game.select", gameId: "memory-wave" });
    await t.next("game.selected");
    t.send({ type: "game.start" });
    await t.next("game.started");
    t.send({ type: "controller.layout", to: "all", layout: "game", data: { round: 2, options: ["a", "b", "c", "d"] } });
    await p.c.next("controller.layout", (m) => m.data?.round === 2);
    p.c.close();
    const again = new Client();
    await again.open();
    again.send({ type: "hello", v: 1, role: "controller", roomId: p.roomId, playerToken: p.playerToken });
    const l = await again.next("controller.layout");
    expect(l.data).toMatchObject({ round: 2 });
  });
});

describe("heartbeat", () => {
  it("keeps healthy sockets open across heartbeat rounds", async () => {
    vi.useFakeTimers({ toFake: ["setInterval"] });
    try {
      await start();
      const { c: t } = await tv();
      vi.advanceTimersByTime(10_000);
      await new Promise((r) => setTimeout(r, 50)); // let the pong arrive
      vi.advanceTimersByTime(10_000);
      await new Promise((r) => setTimeout(r, 50));
      expect(t.ws.readyState).toBe(WebSocket.OPEN);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("direct phone-to-TV links (WebRTC signalling)", () => {
  const offer = { sdp: { type: "offer", sdp: "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n" } };

  it("relays a phone's offer to its TV and the TV's answer back to that phone only", async () => {
    await start();
    const { room, c: t } = await tv();
    const a = await phone({ inviteToken: room.inviteToken }, "Asha");
    const b = await phone({ joinCode: room.joinCode }, "Bala");
    a.c.send({ type: "rtc.signal", to: "tv", signal: offer });
    const got = await t.next("rtc.signal");
    expect(got.from).toBe(a.playerId);
    expect(got.signal).toEqual(offer);
    t.send({ type: "rtc.signal", to: a.playerId, signal: { sdp: { type: "answer", sdp: "v=0\r\n" } } });
    expect((await a.c.next("rtc.signal")).from).toBe("tv");
    await expect(b.c.next("rtc.signal", () => true, 300)).rejects.toThrow(); // the other phone sees nothing
  });

  it("phones cannot signal other players, and the TV cannot signal strangers", async () => {
    await start();
    const { room, c: t } = await tv();
    const a = await phone({ inviteToken: room.inviteToken }, "Asha");
    const b = await phone({ joinCode: room.joinCode }, "Bala");
    a.c.send({ type: "rtc.signal", to: b.playerId, signal: offer });
    expect((await a.c.next("error")).code).toBe("not_allowed");
    t.send({ type: "rtc.signal", to: "someone-else", signal: offer });
    expect((await t.next("error")).code).toBe("not_allowed");
  });

  it("rejects oversized or malformed signals and rate-limits floods", async () => {
    await start();
    const { room } = await tv();
    const a = await phone({ inviteToken: room.inviteToken }, "Asha");
    a.c.send({ type: "rtc.signal", to: "tv", signal: { sdp: { type: "offer", sdp: "x".repeat(3500) } } });
    expect((await a.c.next("error")).code).toBe("bad_message");
    a.c.send({ type: "rtc.signal", to: "tv", signal: { script: "alert(1)" } });
    expect((await a.c.next("error")).code).toBe("bad_message");
    for (let i = 0; i < 60; i++) a.c.send({ type: "rtc.signal", to: "tv", signal: { bye: true } });
    expect((await a.c.next("error", (e) => e.code === "rate_limited")).code).toBe("rate_limited");
  });
});

describe("the host removes a player", () => {
  it("the removed phone is told and disconnected, its token stops working, and only the TV can remove", async () => {
    await start();
    const { room, c: t } = await tv();
    const guest = await phone({ inviteToken: room.inviteToken }, "Stranger");
    const friend = await phone({ joinCode: room.joinCode }, "Friend");
    friend.c.send({ type: "player.remove", playerId: guest.playerId });
    expect((await friend.c.next("error")).code).toBe("not_allowed"); // a phone can't remove anyone
    t.send({ type: "player.remove", playerId: guest.playerId });
    expect((await guest.c.next("error")).code).toBe("removed");
    expect(await guest.c.closed).toBe(4410);
    await t.next("room.state", (m) => m.room.players.length === 1);
    const again = new Client();
    await again.open();
    again.send({ type: "hello", v: 1, role: "controller", roomId: guest.roomId, playerToken: guest.playerToken });
    expect((await again.next("error")).code).toBe("unauthorized"); // the old token no longer works
  });
});

describe("removal also ends direct links", () => {
  it("the TV is told to close the removed player's direct link, and the removed phone can't signal any more", async () => {
    await start();
    const { room, c: t } = await tv();
    const guest = await phone({ inviteToken: room.inviteToken }, "Stranger");
    t.send({ type: "player.remove", playerId: guest.playerId });
    const bye = await t.next("rtc.signal");
    expect(bye).toMatchObject({ from: guest.playerId, signal: { bye: true } });
  });
});

describe("the captain's phone runs the game menu", () => {
  it("only the captain picks, starts and ends games; captaincy passes on when they leave", async () => {
    await start();
    const { room, c: t } = await tv();
    const cap = await phone({ inviteToken: room.inviteToken }, "Captain");
    const other = await phone({ joinCode: room.joinCode }, "Other");
    const state = await t.next("room.state", (m) => m.room.players.length === 2);
    expect(state.room.captainId).toBe(cap.playerId);

    other.c.send({ type: "game.select", gameId: "memory-wave" });
    expect((await other.c.next("error")).code).toBe("not_allowed");

    cap.c.send({ type: "game.select", gameId: "memory-wave" });
    expect((await t.next("game.selected")).gameId).toBe("memory-wave");
    cap.c.send({ type: "game.start" });
    await t.next("game.started");
    cap.c.send({ type: "game.start" });                       // no restarting a running game
    expect((await cap.c.next("error")).message).toMatch(/already running/);
    cap.c.send({ type: "game.exit" });
    await t.next("game.exit");

    cap.c.send({ type: "player.leave" });
    const after = await t.next("room.state", (m) => m.room.players.length === 1 && m.room.players[0]!.name === "Other");
    expect(after.room.captainId).toBe(other.playerId);       // the next player becomes captain
  });
});
