import Fastify, { type FastifyInstance, type onRequestHookHandler } from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { WebSocketServer } from "ws";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { relative, sep } from "node:path";
import { CreateRoomRequest, CreateRoomResponse, JoinRequest, MAX_FRAME_BYTES } from "@playwithtv/protocol";
import { type Config, originAllowed } from "./config.js";
import { Hub, HubError, metrics } from "./hub.js";
import { FailureLock, KeyedLimiter, addressOf, networkOf, sameToken } from "./security.js";
import type { Persistence } from "./persistence.js";
import type { Presence } from "./presence.js";
import { type AdStore, MemoryAdStore, todayIST } from "./ads.js";
import { registerAdRoutes } from "./adRoutes.js";
import { REVALIDATE, cacheControlFor } from "./caching.js";
import { LiveTracker, istDay } from "./live.js";

export interface App {
  http: FastifyInstance;
  hub: Hub;
  close(): Promise<void>;
}

/** Builds the HTTP API, the WebSocket hub and the (optional) static web app. */
export async function buildApp(cfg: Config, db: Persistence, presence: Presence, opts: { logger?: boolean; ads?: AdStore } = {}): Promise<App> {
  const http = Fastify({
    logger: opts.logger ? { level: "info" } : false,
    bodyLimit: 8 * 1024,
    genReqId: (req) => (req.headers["x-request-id"] as string) || randomUUID(),
    // never `true`: that believes the left-most (client-written) X-Forwarded-For entry
    trustProxy: (_address: string, hop: number) => hop < cfg.trustProxyHops,
  });
  const hub = new Hub(cfg, db, presence, (o, m) => http.log.warn(o, m));
  const createLimiter = new KeyedLimiter(0.2, 10);   // 10 rooms burst, then 1 per 5 s per IP
  const joinLimiter = new KeyedLimiter(0.5, 20);     // 20 joins burst, then 1 per 2 s per IP
  // Typed join codes (24.3 million, each valid 10 minutes) are guarded in layers that slow guessing down
  // without letting an attacker lock real families out for long:
  //  - one address: 10 wrong codes in 10 minutes → that address is locked (it is the guesser);
  //  - one network block (/24 or /48), where many people may share addresses (mobile carriers): 60 wrong
  //    codes, then one every 2 s. A short back-off, never a long ban;
  //  - everyone together: past 300 wrong codes, then 5 per second site-wide, networks that guessed wrong in
  //    the last 15 minutes are slowed; a family typing the right code first time always gets in. (An attacker
  //    with many networks gets one free guess per network per 15 min: against 24.3 million codes that each
  //    expire in 10 minutes this stays impractical, and the TV host can remove an unexpected player.)
  //    Floods also raise an ops alert.
  // QR invites (long random tokens) are never affected, so scanning always works.
  const joinFails = new FailureLock(10, 10 * 60_000);
  const netMisses = new KeyedLimiter(0.5, 60);
  const allMisses = new KeyedLimiter(5, 300);
  const missedRecently = new FailureLock(1, 15 * 60_000); // any wrong code from a network in the last 15 min
  let lastFloodAlert = 0;

  await http.register(cors, {
    origin: (origin, cb) => cb(null, originAllowed(cfg, origin ?? undefined) || !origin),
  });
  // Browser-side protection. The code is public, so nothing here relies on hiding how it works.
  const policy = (phone: boolean) => [
    "default-src 'self'",
    // no inline or third-party scripts can run. The phone controller page may also compile WebAssembly
    // ('wasm-unsafe-eval' allows WebAssembly.instantiate only, never JS eval) for on-phone body tracking
    phone ? "script-src 'self' 'wasm-unsafe-eval'" : "script-src 'self'",
    "style-src 'self' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",                // self-hosted Indic fonts (public/fonts)
    "img-src 'self' data: blob:",                          // QR codes are data: URLs
    "media-src 'self'",
    `connect-src 'self' ${cfg.publicUrl.replace(/^http/, "ws")}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",                              // nobody can frame the site (clickjacking)
  ].join("; ");
  const csp = policy(false), phoneCsp = policy(true);
  // only the phone controller may use the camera (camera games track the body on the phone; video never leaves it)
  const permissions = (phone: boolean) =>
    `accelerometer=(self), gyroscope=(self), magnetometer=(), camera=${phone ? "(self)" : "()"}, microphone=(), geolocation=(), payment=(), usb=(), fullscreen=(self), screen-wake-lock=(self)`;
  const pp = permissions(false), phonePp = permissions(true);
  const hsts = cfg.publicUrl.startsWith("https://");
  http.addHook("onSend", async (req, reply) => {
    const phone = isPhonePage(req.url);
    reply.header("x-request-id", req.id);
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "no-referrer"); // invite tokens in /join URLs never leak via Referer
    reply.header("content-security-policy", phone ? phoneCsp : csp);
    reply.header("x-frame-options", "DENY");
    reply.header("cross-origin-opener-policy", "same-origin");
    reply.header("permissions-policy", phone ? phonePp : pp);
    if (hsts) reply.header("strict-transport-security", "max-age=31536000");
  });

  http.setErrorHandler((err, req, reply) => {
    if (err instanceof HubError) return reply.status(err.status).send({ error: err.code, message: err.message });
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) req.log.error({ err }, "request failed");
    return reply.status(status).send({ error: status >= 500 ? "internal" : "bad_request", message: status >= 500 ? "Something went wrong." : (err as Error).message });
  });

  // public health check: no usage numbers (those are in the admin overview and /metrics)
  http.get("/healthz", async () => ({ ok: true, db: db.kind, presence: presence.kind }));

  http.get("/api/games", async () => (await db.games()).filter((g) => g.enabled && g.playable && (!g.heldBack || cfg.previewGames)));

  http.post("/api/rooms", async (req, reply) => {
    if (!createLimiter.take(req.ip)) {
      metrics.rateLimited++;
      return reply.status(429).send({ error: "rate_limited", message: "Too many rooms, wait a moment." });
    }
    const body = CreateRoomRequest.parse(req.body ?? {});
    return CreateRoomResponse.parse(hub.createRoom(body.device, body.form));
  });

  http.post("/api/join", async (req, reply) => {
    if (!joinLimiter.take(req.ip)) {
      metrics.rateLimited++;
      return reply.status(429).send({ error: "rate_limited", message: "Too many attempts, wait a moment." });
    }
    const body = JoinRequest.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: "bad_request", message: body.error.issues[0]?.message ?? "invalid" });
    const net = networkOf(req.ip);
    const guesser = missedRecently.locked(net); // this network guessed wrong in the last 15 minutes
    if (body.data.joinCode && (joinFails.locked(addressOf(req.ip)) || !netMisses.canTake(net) || (guesser && !allMisses.canTake("all")))) {
      metrics.rateLimited++;
      return reply.status(429).send({ error: "rate_limited", message: "Too many wrong codes right now. Wait a little, or scan the QR code on the TV instead." });
    }
    try {
      return hub.join(body.data);
    } catch (e) {
      if (body.data.joinCode && e instanceof HubError && e.code === "invite_expired") {
        joinFails.fail(addressOf(req.ip));
        netMisses.take(net);
        missedRecently.fail(net);
        if (!allMisses.take("all") && Date.now() - lastFloodAlert > 60_000) {
          lastFloodAlert = Date.now();
          http.log.warn("many wrong join codes from many addresses: possible distributed guessing");
          void db.opsEvent("join_code_flood", {}).catch(() => undefined);
        }
      }
      throw e;
    }
  });

  // ---- live usage: sampled every 2 s, peaks saved per day ---------------------------------
  const startedAt = Date.now();
  const live = new LiveTracker(() => {
    const s = hub.stats();
    return { tvs: s.tvs, phones: s.connected, rooms: s.rooms, playing: s.playing };
  }, (p) => db.raisePeak(p));
  live.seed(await db.peak(istDay()).catch(() => null));
  const liveTick = setInterval(() => live.observe(), 2_000);
  liveTick.unref();

  // ---- admin (bearer token) -------------------------------------------------------
  const adminLock = new FailureLock(5, 15 * 60_000);
  const adminGuard: onRequestHookHandler = async (req, reply) => {
    if (adminLock.locked(req.ip)) {
      metrics.rateLimited++;
      return reply.status(429).send({ error: "rate_limited", message: "Too many wrong admin tokens. Try again in 15 minutes." });
    }
    const auth = req.headers.authorization ?? "";
    const given = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!cfg.adminToken || !given || !sameToken(given, cfg.adminToken)) {
      adminLock.fail(req.ip);
      void db.opsEvent("admin_auth_failed", { ip: req.ip }).catch(() => undefined);
      return reply.status(401).send({ error: "unauthorized", message: "Admin token required." });
    }
    adminLock.succeed(req.ip);
  };
  http.register(async (admin) => {
    admin.addHook("onRequest", adminGuard);
    admin.get("/api/admin/overview", async () => ({
      stats: hub.stats(), metrics, rooms: hub.roomsSummary(), storage: { db: db.kind, presence: presence.kind },
      recentMatches: await db.recentMatches(20),
    }));
    // cheap: polled every 2 s by the console
    admin.get("/api/admin/live", async () => {
      const snap = live.snapshot();
      return { at: Date.now(), startedAt, ...snap, stats: hub.stats(), rooms: hub.roomsSummary() };
    });
    admin.get<{ Querystring: { days?: string } }>("/api/admin/usage", async (req) => ({
      storage: db.kind, ...(await db.usage(Number(req.query.days) || 14)),
    }));
    admin.get("/api/admin/games", async () => db.games());
    admin.post<{ Params: { id: string }; Body: { enabled: boolean } }>("/api/admin/games/:id", async (req, reply) => {
      const enabled = (req.body as { enabled?: unknown })?.enabled;
      if (typeof enabled !== "boolean") return reply.status(400).send({ error: "bad_request", message: "enabled must be boolean" });
      if (!(await db.setGameEnabled(req.params.id, enabled))) return reply.status(404).send({ error: "not_found", message: "no such game" });
      return { ok: true };
    });
  }, { prefix: "" });

  const ads = opts.ads ?? new MemoryAdStore();
  await registerAdRoutes(http, ads, adminGuard);
  hub.onImpressions = (items) => void ads.count({ items }, todayIST()).catch((err) => http.log.warn({ err }, "impressions not saved"));

  http.get("/metrics", { onRequest: adminGuard }, async (req, reply) => {
    const s = hub.stats();
    const lines = Object.entries({ ...metrics, active_rooms: s.rooms, players: s.players, connected_players: s.connected, tvs_online: s.tvs, rooms_playing: s.playing })
      .map(([k, v]) => `pwtv_${k.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase())} ${v}`);
    reply.type("text/plain").send(lines.join("\n") + "\n");
  });

  // ---- web app (production) ----------------------------------------------------------
  if (cfg.webDist && existsSync(cfg.webDist)) {
    await http.register(fastifyStatic, {
      root: cfg.webDist,
      wildcard: false,
      cacheControl: false, // set per file below, so the CDN keeps game files and pages still update on deploy
      setHeaders: (reply, filePath) => reply.header("cache-control", cacheControlFor("/" + relative(cfg.webDist!, filePath).split(sep).join("/"))),
    });
    http.setNotFoundHandler((req, reply) => {
      // A missing build file (e.g. a game chunk from before the last deploy, asked for by a TV that has been
      // open since) must be a real 404: answering with index.html makes the browser fail to run it as a script
      // and the game opens to a blank screen. Only page routes (/tv, /join, ...) fall back to the app.
      const path = req.url.split("?")[0]!;
      const isFile = path.startsWith("/assets/") || path.startsWith("/vendor/") || /\.[a-z0-9]{1,8}$/i.test(path);
      if (req.method === "GET" && !path.startsWith("/api") && !isFile) return reply.header("cache-control", REVALIDATE).sendFile("index.html");
      if (isFile) return reply.status(404).header("cache-control", "no-store").type("text/plain").send("Not found");
      return reply.status(404).send({ error: "not_found", message: "Not found" });
    });
  }

  // ---- WebSocket hub -----------------------------------------------------------------
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });
  const socketsByIp = new Map<string, number>();
  http.server.on("upgrade", (req, socket, head) => {
    if (!req.url?.startsWith("/ws") || !originAllowed(cfg, req.headers.origin)) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      return socket.destroy();
    }
    // capacity guards: one busy hub must not take the rest of the machine down with it
    const ip = upgradeIp(req, cfg.trustProxyHops);
    const fromIp = socketsByIp.get(ip) ?? 0;
    if (wss.clients.size >= cfg.maxSockets || fromIp >= cfg.maxSocketsPerIp) {
      metrics.serverBusy++;
      socket.write("HTTP/1.1 503 Service Unavailable\r\nRetry-After: 5\r\nConnection: close\r\n\r\n");
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      socketsByIp.set(ip, (socketsByIp.get(ip) ?? 0) + 1);
      ws.once("close", () => {
        const n = (socketsByIp.get(ip) ?? 1) - 1;
        if (n > 0) socketsByIp.set(ip, n);
        else socketsByIp.delete(ip);
      });
      wss.emit("connection", ws, req); // registers the socket with the heartbeat below
      hub.attach(ws);
    });
  });
  // server-side heartbeat: drop sockets that stop answering
  const alive = new WeakSet<object>();
  wss.on("connection", (ws) => {
    alive.add(ws);
    ws.on("pong", () => alive.add(ws));
  });
  const beat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.has(ws)) {
        ws.terminate();
        continue;
      }
      alive.delete(ws);
      ws.ping();
    }
    hub.sweep();
  }, 10_000);

  return {
    http,
    hub,
    async close() {
      clearInterval(beat);
      clearInterval(liveTick);
      for (const ws of wss.clients) ws.terminate();
      wss.close();
      await http.close();
    },
  };
}

/**
 * The client address of a WebSocket upgrade, trusting the same number of proxy hops as the HTTP routes (Fastify's
 * trustProxy): walk X-Forwarded-For from the right, one entry per trusted proxy.
 */
export function upgradeIp(req: Pick<IncomingMessage, "headers" | "socket">, trustedHops: number): string {
  const xff = req.headers["x-forwarded-for"];
  const forwarded = (Array.isArray(xff) ? xff.join(",") : xff ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const chain = [req.socket.remoteAddress ?? "unknown", ...forwarded.reverse()];
  return chain[Math.min(trustedHops, chain.length - 1)]!;
}

/**
 * The phone controller page (/join and /controller, with any query string). Only its HTML gets the camera and
 * 'wasm-unsafe-eval': a page's CSP and permissions come from the response that loaded the document, so the TV,
 * admin and every other page keep the strict policy.
 */
export function isPhonePage(url: string): boolean {
  const path = url.split(/[?#]/, 1)[0]!.replace(/\/+$/, "");
  return path === "/join" || path === "/controller";
}
