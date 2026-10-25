import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import {
  ClientMessage, MAX_PLAYERS_PER_ROOM, PROTOCOL_VERSION, findGame,
  type Avatar, type ErrorCode, type JoinRequest, type JoinResponse, type PlayerView, type RoomStatus,
  type RoomView, type ServerMessage, type GameResult,
} from "@playwithtv/protocol";
import type { Config } from "./config.js";
import { Bucket, joinCode, sameToken, token } from "./security.js";
import type { Persistence } from "./persistence.js";
import type { Presence } from "./presence.js";
import { HubError, metrics } from "./errors.js";
import { type Conn, relaySignal } from "./rtc.js";
import { takeImpressions } from "./impressions.js";
import { type Player, type Room, captainOf, uniqueName } from "./room.js";

const PLAYER_COLORS = ["#ff5d73", "#3dd6ff", "#ffd23f", "#7cf29c", "#c084fc", "#ff9f43", "#4ade80", "#f472b6"];


export { HubError, metrics } from "./errors.js";

/**
 * Owns every live room on this process: invitations, membership, sockets, game lifecycle and input relay.
 * The TV is the game host (it runs the simulation); the hub validates, rate-limits and relays.
 */
export class Hub {
  private rooms = new Map<string, Room>();
  private byCode = new Map<string, string>();
  private byInvite = new Map<string, string>();
  private conns = new WeakMap<WebSocket, Conn>();

  /** Where sponsor impression reports from TVs go (the app wires this to the ad store). */
  onImpressions: (items: Extract<ClientMessage, { type: "ads.impressions" }>["items"]) => void = () => undefined;

  constructor(private cfg: Config, private db: Persistence, private presence: Presence, private log: (o: object, m: string) => void) {}

  // ---- rooms and invitations --------------------------------------------------------

  createRoom() {
    if (this.rooms.size >= this.cfg.maxRooms) {
      metrics.serverBusy++;
      throw new HubError("server_busy", "Lots of people are playing right now. Trying again in a few seconds…", 503);
    }
    const room: Room = {
      id: randomUUID(),
      hostToken: token(),
      joinCode: "",
      invite: { token: "", expiresAt: 0 },
      status: "lobby",
      gameId: null,
      gameStartedAt: 0,
      players: new Map(),
      tvBucket: new Bucket(40, 80),
      lastImpressionsAt: Date.now(),
      gamesSinceReport: 0,
      pausedForTv: false,
      layoutFor: new Map(),
      lastActivity: Date.now(),
    };
    this.rooms.set(room.id, room);
    this.rotateInvite(room);
    metrics.roomsCreated++;
    void this.db.sessionStarted(room.id).catch((e) => this.log({ err: String(e) }, "db.sessionStarted failed"));
    return { roomId: room.id, hostToken: room.hostToken, ...this.inviteInfo(room) };
  }

  private inviteInfo(room: Room) {
    return {
      joinCode: room.joinCode,
      inviteToken: room.invite.token,
      joinUrl: `${this.cfg.publicUrl}/join?i=${room.invite.token}`,
      expiresAt: room.invite.expiresAt,
    };
  }

  /** New short-lived QR token and join code; the old ones stop working immediately. */
  private rotateInvite(room: Room) {
    if (room.joinCode) this.byCode.delete(room.joinCode);
    if (room.invite.token) this.byInvite.delete(room.invite.token);
    let code = joinCode();
    while (this.byCode.has(code)) code = joinCode();
    room.joinCode = code;
    room.invite = { token: token(), expiresAt: Date.now() + this.cfg.inviteTtlMs };
    this.byCode.set(code, room.id);
    this.byInvite.set(room.invite.token, room.id);
    this.sendTv(room, { type: "room.invite", ...this.inviteInfo(room) });
  }

  join(req: JoinRequest): JoinResponse {
    let roomId: string | undefined;
    if (req.inviteToken) roomId = this.byInvite.get(req.inviteToken);
    else if (req.joinCode) roomId = this.byCode.get(req.joinCode);
    const room = roomId ? this.rooms.get(roomId) : undefined;
    if (!room) throw new HubError("invite_expired", "This code has expired or is wrong. Check the code on the TV.", 404);
    if (room.invite.expiresAt < Date.now()) throw new HubError("invite_expired", "This invite has expired. Scan the new code on the TV.", 410);

    // Rejoin with the same identity (page reload, phone locked, new tab).
    if (req.playerToken) {
      for (const p of room.players.values()) {
        if (sameToken(p.token, req.playerToken)) {
          p.name = uniqueName(room, req.name, p.id);
          p.avatar = req.avatar;
          metrics.rejoins++;
          this.broadcastState(room);
          return { roomId: room.id, playerId: p.id, playerToken: p.token };
        }
      }
    }
    if (room.players.size >= MAX_PLAYERS_PER_ROOM) throw new HubError("room_full", "This room is full (8 players).", 409);
    const used = new Set([...room.players.values()].map((p) => p.color));
    const p: Player = {
      id: randomUUID().slice(0, 8),
      token: token(),
      name: uniqueName(room, req.name),
      avatar: req.avatar,
      color: PLAYER_COLORS.find((c) => !used.has(c)) ?? PLAYER_COLORS[0]!,
      ready: false,
      lastSeq: -1,
      inputBucket: new Bucket(60, 90),
      msgBucket: new Bucket(10, 20),
      disconnectedAt: Date.now(),
    };
    room.players.set(p.id, p);
    room.lastActivity = Date.now();
    metrics.joins++;
    void this.db.playerJoined(room.id, p.id, p.name, p.avatar).catch(() => undefined);
    this.broadcastState(room);
    return { roomId: room.id, playerId: p.id, playerToken: p.token };
  }

  view(room: Room): RoomView {
    return {
      roomId: room.id,
      joinCode: room.joinCode,
      status: room.status,
      gameId: room.gameId,
      tvConnected: !!room.tv,
      captainId: captainOf(room),
      players: [...room.players.values()].map(
        (p): PlayerView => ({ id: p.id, name: p.name, avatar: p.avatar, color: p.color, connected: !!p.socket, ready: p.ready }),
      ),
    };
  }

  // ---- sockets ----------------------------------------------------------------------

  attach(ws: WebSocket) {
    this.conns.set(ws, {});
    const helloTimer = setTimeout(() => {
      if (!this.conns.get(ws)?.role) ws.close(4401, "hello timeout");
    }, 5000);
    ws.on("message", (data, isBinary) => {
      if (isBinary) return this.fail(ws, "bad_message", "text frames only");
      let parsed: unknown;
      try {
        parsed = JSON.parse(data.toString());
      } catch {
        return this.fail(ws, "bad_message", "invalid JSON");
      }
      const msg = ClientMessage.safeParse(parsed);
      if (!msg.success) {
        metrics.badMessages++;
        const v = (parsed as { v?: unknown })?.v;
        if ((parsed as { type?: unknown })?.type === "hello" && v !== PROTOCOL_VERSION) {
          return this.fail(ws, "unsupported_version", `protocol v${PROTOCOL_VERSION} required`, true);
        }
        return this.fail(ws, "bad_message", msg.error.issues[0]?.message ?? "invalid message");
      }
      try {
        this.handle(ws, msg.data);
      } catch (e) {
        if (e instanceof HubError) this.fail(ws, e.code, e.message);
        else {
          this.log({ err: String(e) }, "handler error");
          this.fail(ws, "bad_message", "internal error");
        }
      }
    });
    ws.on("close", () => {
      clearTimeout(helloTimer);
      this.detach(ws);
    });
    // Oversized or malformed frames make ws emit "error" (then close with 1009/1002). Without a listener
    // Node would treat that as an uncaught exception and take the whole hub down.
    ws.on("error", (err) => {
      metrics.badMessages++;
      this.log({ err: err.message }, "socket error");
    });
  }

  private handle(ws: WebSocket, m: ClientMessage) {
    const conn = this.conns.get(ws)!;
    if (m.type === "ping") return this.send(ws, { type: "pong", t: m.t, serverTime: Date.now() });
    if (m.type === "hello") return this.hello(ws, conn, m);
    const room = conn.roomId ? this.rooms.get(conn.roomId) : undefined;
    if (!room || !conn.role) throw new HubError("unauthorized", "say hello first");
    room.lastActivity = Date.now();
    if (m.type === "rtc.signal") return relaySignal(room, conn, m, (ws, msg) => this.send(ws, msg));

    if (conn.role === "controller") {
      const p = room.players.get(conn.playerId!);
      if (!p) throw new HubError("unauthorized", "not in this room");
      if (m.type === "controller.input") {
        if (!p.inputBucket.take()) {
          metrics.inputsDropped++;
          return;
        }
        if (m.seq <= p.lastSeq) {
          metrics.staleInputs++;
          return; // duplicate or reordered frame: the newer state already went through
        }
        p.lastSeq = m.seq;
        if (room.status !== "playing" && room.status !== "lobby") return;
        metrics.inputsRelayed++;
        return this.sendTv(room, { type: "controller.input", playerId: p.id, seq: m.seq, state: m.state });
      }
      if (!p.msgBucket.take()) {
        metrics.rateLimited++;
        throw new HubError("rate_limited", "slow down");
      }
      if (m.type === "player.ready") {
        p.ready = m.ready;
        return this.broadcastState(room);
      }
      if (m.type === "player.leave") {
        room.players.delete(p.id);
        this.sendTv(room, { type: "controller.clear", playerId: p.id });
        this.broadcastState(room);
        return ws.close(1000, "left");
      }
      if (m.type === "game.select" || m.type === "game.start" || m.type === "game.exit") {
        if (captainOf(room) !== p.id) throw new HubError("not_allowed", "Only the captain 👑 can pick and start games.");
        return this.hostCommand(room, m);
      }
      throw new HubError("not_allowed", "only the TV can do that");
    }

    // TV (host)
    if (!room.tvBucket.take()) {
      metrics.rateLimited++;
      throw new HubError("rate_limited", "slow down");
    }
    switch (m.type) {
      case "game.select":
      case "game.start":
      case "game.exit":
        return this.hostCommand(room, m);
      case "game.pause":
        if (room.status !== "playing" && room.status !== "paused") return;
        room.status = m.paused ? "paused" : "playing";
        room.pausedForTv = false;
        this.broadcast(room, { type: "game.paused", paused: m.paused });
        return this.broadcastState(room);
      case "game.finished":
        return this.finish(room, m.results, m.durationMs);
      case "player.remove": {
        const p = room.players.get(m.playerId);
        if (!p) throw new HubError("not_allowed", "no such player");
        room.players.delete(p.id); // their player token stops working; joining again needs the TV's code
        this.send(p.socket, { type: "error", code: "removed", message: "The TV host removed you from this game." });
        p.socket?.close(4410, "removed");
        this.sendTv(room, { type: "controller.clear", playerId: p.id });
        // also close their direct phone→TV link, so nothing from that phone reaches the TV any more
        this.sendTv(room, { type: "rtc.signal", from: p.id, signal: { bye: true } });
        return this.broadcastState(room);
      }
      case "controller.layout": {
        const msg = { type: "controller.layout" as const, layout: m.layout, data: m.data };
        if (m.to === "all") {
          room.layoutAll = msg;
          room.layoutFor.clear();
          return this.broadcastController(room, msg);
        }
        room.layoutFor.set(m.to, msg);
        return this.sendPlayer(room, m.to, msg);
      }
      case "tv.event": {
        const msg: ServerMessage = { type: "tv.event", event: m.event, data: m.data };
        return m.to === "all" ? this.broadcastController(room, msg) : this.sendPlayer(room, m.to, msg);
      }
      case "room.rotateInvite":
        return this.rotateInvite(room);
      case "ads.impressions": {
        // only real TVs in real rooms report, at most every 20 s, capped by what this room actually showed
        const items = takeImpressions(room, m.items);
        if (items === null) return void metrics.rateLimited++;
        if (items.length) this.onImpressions(items);
        return;
      }
      default:
        throw new HubError("not_allowed", "controllers only");
    }
  }

  /** Results come from the TV host; they are checked against the room before being recorded. */
  /** Picking, starting and leaving games: from the TV (remote) or the captain's phone. */
  private hostCommand(room: Room, m: Extract<ClientMessage, { type: "game.select" | "game.start" | "game.exit" }>) {
    switch (m.type) {
      case "game.select": {
        const g = findGame(m.gameId);
        if (!g || !g.playable) throw new HubError("unknown_game", "That game is not available.");
        room.gameId = g.id;
        room.status = "lobby";
        this.broadcast(room, { type: "game.selected", gameId: g.id });
        this.broadcastController(room, { type: "controller.layout", layout: "lobby", data: { gameId: g.id, title: g.title } });
        return this.broadcastState(room);
      }
      case "game.start": {
        if (room.status === "playing" || room.status === "paused") throw new HubError("not_allowed", "A game is already running.");
        const g = room.gameId ? findGame(room.gameId) : undefined;
        if (!g) throw new HubError("unknown_game", "Pick a game first.");
        const players = [...room.players.values()].filter((p) => p.socket);
        if (players.length < g.minPlayers || players.length > g.maxPlayers) {
          throw new HubError("player_count", `${g.title} needs ${g.minPlayers}–${g.maxPlayers} connected players.`);
        }
        room.status = "playing";
        room.gameStartedAt = Date.now();
        room.gamesSinceReport++;
        room.layoutAll = undefined;
        room.layoutFor.clear();
        for (const p of room.players.values()) p.lastSeq = -1;
        this.broadcast(room, { type: "game.started", gameId: g.id, players: this.view(room).players });
        this.broadcastController(room, { type: "controller.layout", layout: g.controller });
        return this.broadcastState(room);
      }
      case "game.exit":
        room.status = "lobby";
        room.layoutAll = undefined;
        room.layoutFor.clear();
        room.gameId = null;
        this.broadcast(room, { type: "game.exit" });
        this.broadcastController(room, { type: "controller.layout", layout: "lobby" });
        return this.broadcastState(room);
    }
  }

  private finish(room: Room, results: GameResult[], durationMs: number) {
    if (room.status !== "playing" && room.status !== "paused") throw new HubError("not_allowed", "no game running");
    const g = room.gameId ? findGame(room.gameId) : undefined;
    if (!g) throw new HubError("unknown_game", "no game");
    const ids = new Set<string>();
    for (const r of results) {
      if (!room.players.has(r.playerId) || ids.has(r.playerId)) throw new HubError("bad_message", "results must name each room player once");
      ids.add(r.playerId);
    }
    const elapsed = Date.now() - room.gameStartedAt;
    const safeDuration = Math.min(durationMs, elapsed + 1000); // a host cannot claim a longer match than really ran
    room.status = "results";
    room.lastResults = results;
    room.layoutAll = undefined;
    room.layoutFor.clear();
    metrics.matchesFinished++;
    this.broadcast(room, { type: "game.finished", gameId: g.id, results });
    this.broadcastController(room, { type: "controller.layout", layout: "lobby", data: { results } });
    this.broadcastState(room);
    void this.db
      .matchFinished({ sessionId: room.id, gameId: g.id, gameVersion: g.version, startedAt: room.gameStartedAt, durationMs: safeDuration, results })
      .catch((e) => this.log({ err: String(e) }, "db.matchFinished failed"));
  }

  private hello(ws: WebSocket, conn: Conn, m: Extract<ClientMessage, { type: "hello" }>) {
    if (conn.role) throw new HubError("not_allowed", "already connected");
    const room = this.rooms.get(m.roomId);
    if (!room) throw new HubError("room_not_found", "This room has ended.");
    if (m.role === "tv") {
      if (!sameToken(room.hostToken, m.hostToken ?? "")) throw new HubError("unauthorized", "not the host");
      if (room.tv && room.tv !== ws) room.tv.close(4409, "replaced by a newer TV connection");
      room.tv = ws;
      room.tvDisconnectedAt = undefined;
      conn.role = "tv";
      conn.roomId = room.id;
      this.send(ws, { type: "welcome", v: PROTOCOL_VERSION, role: "tv", room: this.view(room) });
      this.send(ws, { type: "room.invite", ...this.inviteInfo(room) });
      if (room.status === "paused" && room.pausedForTv) {
        room.status = "playing";
        room.pausedForTv = false;
        this.broadcast(room, { type: "game.paused", paused: false });
      }
      return this.broadcastState(room);
    }
    const p = [...room.players.values()].find((x) => sameToken(x.token, m.playerToken ?? ""));
    if (!p) throw new HubError("unauthorized", "Join again from the TV code.");
    if (p.socket && p.socket !== ws) p.socket.close(4409, "replaced by a newer connection");
    p.socket = ws;
    p.disconnectedAt = undefined;
    p.lastSeq = -1; // a reloaded phone counts its input frames from 0 again
    conn.role = "controller";
    conn.roomId = room.id;
    conn.playerId = p.id;
    this.send(ws, { type: "welcome", v: PROTOCOL_VERSION, role: "controller", playerId: p.id, room: this.view(room) });
    const g = room.gameId ? findGame(room.gameId) : undefined;
    const inGame = (room.status === "playing" || room.status === "paused") && g;
    const data = g ? { gameId: g.id, title: g.title, ...(room.status === "results" ? { results: room.lastResults } : {}) } : undefined;
    const sticky = inGame ? room.layoutFor.get(p.id) ?? room.layoutAll : undefined;
    this.send(ws, sticky ?? { type: "controller.layout", layout: inGame ? g.controller : "lobby", data });
    this.broadcastState(room);
  }

  private detach(ws: WebSocket) {
    const conn = this.conns.get(ws);
    const room = conn?.roomId ? this.rooms.get(conn.roomId) : undefined;
    if (!room) return;
    if (conn!.role === "tv" && room.tv === ws) {
      room.tv = undefined;
      room.tvDisconnectedAt = Date.now();
      if (room.status === "playing") {
        room.status = "paused";
        room.pausedForTv = true;
        this.broadcastController(room, { type: "game.paused", paused: true });
      }
    } else if (conn!.role === "controller") {
      const p = room.players.get(conn!.playerId!);
      if (p && p.socket === ws) {
        p.socket = undefined;
        p.disconnectedAt = Date.now();
        p.ready = false;
        this.sendTv(room, { type: "controller.clear", playerId: p.id }); // never leave a button held
      }
    }
    this.broadcastState(room);
  }

  // ---- housekeeping -----------------------------------------------------------------

  /** Rotates expired invites, drops long-gone players and expires abandoned rooms. */
  sweep(now = Date.now()) {
    for (const room of this.rooms.values()) {
      const tvGone = !room.tv && room.tvDisconnectedAt !== undefined && now - room.tvDisconnectedAt > this.cfg.tvGraceMs;
      const neverConnected = !room.tv && room.tvDisconnectedAt === undefined && now - room.lastActivity > this.cfg.tvGraceMs;
      if (tvGone || neverConnected || now - room.lastActivity > this.cfg.roomIdleMs) {
        this.expire(room, tvGone || neverConnected ? "tv_gone" : "idle");
        continue;
      }
      if (room.invite.expiresAt <= now) this.rotateInvite(room);
      for (const p of room.players.values()) {
        if (!p.socket && p.disconnectedAt && now - p.disconnectedAt > 5 * 60_000 && room.status !== "playing") {
          room.players.delete(p.id);
          this.broadcastState(room);
        }
      }
    }
  }

  private expire(room: Room, reason: string) {
    this.broadcast(room, { type: "room.expired" });
    room.tv?.close(4410, "room expired");
    for (const p of room.players.values()) p.socket?.close(4410, "room expired");
    this.rooms.delete(room.id);
    this.byCode.delete(room.joinCode);
    this.byInvite.delete(room.invite.token);
    metrics.roomsExpired++;
    void this.presence.remove(room.id, room.joinCode).catch(() => undefined);
    void this.db.sessionEnded(room.id, reason).catch(() => undefined);
  }

  stats() {
    let players = 0, connected = 0;
    for (const r of this.rooms.values()) {
      players += r.players.size;
      for (const p of r.players.values()) if (p.socket) connected++;
    }
    return { rooms: this.rooms.size, players, connected };
  }

  roomsSummary() {
    return [...this.rooms.values()].map((r) => ({
      roomId: r.id.slice(0, 8), status: r.status, gameId: r.gameId, players: r.players.size, tv: !!r.tv,
      idleSeconds: Math.round((Date.now() - r.lastActivity) / 1000),
    }));
  }

  // ---- sending ----------------------------------------------------------------------

  private send(ws: WebSocket | undefined, m: ServerMessage) {
    if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(m));
  }
  private sendTv(room: Room, m: ServerMessage) {
    this.send(room.tv, m);
  }
  private sendPlayer(room: Room, playerId: string, m: ServerMessage) {
    this.send(room.players.get(playerId)?.socket, m);
  }
  private broadcastController(room: Room, m: ServerMessage) {
    const s = JSON.stringify(m);
    for (const p of room.players.values()) if (p.socket?.readyState === p.socket?.OPEN) p.socket?.send(s);
  }
  private broadcast(room: Room, m: ServerMessage) {
    this.sendTv(room, m);
    this.broadcastController(room, m);
  }
  private broadcastState(room: Room) {
    const view = this.view(room);
    this.broadcast(room, { type: "room.state", room: view });
    void this.presence.publish(view).catch(() => undefined);
  }
  private fail(ws: WebSocket, code: ErrorCode, message: string, close = false) {
    this.send(ws, { type: "error", code, message });
    if (close) ws.close(4400, code);
  }
}
