import Fastify, { type FastifyInstance, type onRequestHookHandler } from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { WebSocketServer } from "ws";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { CreateRoomResponse, JoinRequest, MAX_FRAME_BYTES } from "@scp/protocol";
import { type Config, originAllowed } from "./config.js";
import { Hub, HubError, metrics } from "./hub.js";
import { FailureLock, KeyedLimiter, sameToken } from "./security.js";
import type { Persistence } from "./persistence.js";
import type { Presence } from "./presence.js";
import { type AdStore, MemoryAdStore, todayIST } from "./ads.js";
import { registerAdRoutes } from "./adRoutes.js";

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
    trustProxy: true,
  });
  const hub = new Hub(cfg, db, presence, (o, m) => http.log.warn(o, m));
  const createLimiter = new KeyedLimiter(0.2, 10);   // 10 rooms burst, then 1 per 5 s per IP
  const joinLimiter = new KeyedLimiter(0.5, 20);     // 20 joins burst, then 1 per 2 s per IP

  await http.register(cors, {
    origin: (origin, cb) => cb(null, originAllowed(cfg, origin ?? undefined) || !origin),
  });
  // Browser-side protection. The code is public, so nothing here relies on hiding how it works.
  const csp = [
    "default-src 'self'",
    "script-src 'self'",                                   // no inline or third-party scripts can run
    "style-src 'self' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
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
  const hsts = cfg.publicUrl.startsWith("https://");
  http.addHook("onSend", async (req, reply) => {
    reply.header("x-request-id", req.id);
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "no-referrer"); // invite tokens in /join URLs never leak via Referer
    reply.header("content-security-policy", csp);
    reply.header("x-frame-options", "DENY");
    reply.header("cross-origin-opener-policy", "same-origin");
    reply.header("permissions-policy",
      "accelerometer=(self), gyroscope=(self), magnetometer=(), camera=(), microphone=(), geolocation=(), payment=(), usb=(), fullscreen=(self), screen-wake-lock=(self)");
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

  http.get("/api/games", async () => (await db.games()).filter((g) => g.enabled && g.playable));

  http.post("/api/rooms", async (req, reply) => {
    if (!createLimiter.take(req.ip)) {
      metrics.rateLimited++;
      return reply.status(429).send({ error: "rate_limited", message: "Too many rooms, wait a moment." });
    }
    return CreateRoomResponse.parse(hub.createRoom());
  });

  http.post("/api/join", async (req, reply) => {
    if (!joinLimiter.take(req.ip)) {
      metrics.rateLimited++;
      return reply.status(429).send({ error: "rate_limited", message: "Too many attempts, wait a moment." });
    }
    const body = JoinRequest.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: "bad_request", message: body.error.issues[0]?.message ?? "invalid" });
    return hub.join(body.data);
  });

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
    const lines = Object.entries({ ...metrics, active_rooms: s.rooms, players: s.players, connected_players: s.connected })
      .map(([k, v]) => `scp_${k.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase())} ${v}`);
    reply.type("text/plain").send(lines.join("\n") + "\n");
  });

  // ---- web app (production) ----------------------------------------------------------
  if (cfg.webDist && existsSync(cfg.webDist)) {
    await http.register(fastifyStatic, { root: cfg.webDist, wildcard: false });
    http.setNotFoundHandler((req, reply) => {
      if (req.method === "GET" && !req.url.startsWith("/api")) return reply.sendFile("index.html");
      return reply.status(404).send({ error: "not_found", message: "Not found" });
    });
  }

  // ---- WebSocket hub -----------------------------------------------------------------
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });
  http.server.on("upgrade", (req, socket, head) => {
    if (!req.url?.startsWith("/ws") || !originAllowed(cfg, req.headers.origin)) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
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
      for (const ws of wss.clients) ws.terminate();
      wss.close();
      await http.close();
    },
  };
}
