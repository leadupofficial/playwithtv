/** Runtime configuration from environment variables (see .env.example). No secrets have defaults. */
export interface Config {
  port: number;
  publicUrl: string;
  allowedOrigins: string[];
  databaseUrl?: string;
  redisUrl?: string;
  adminToken?: string;
  inviteTtlMs: number;
  tvGraceMs: number;
  roomIdleMs: number;
  webDist?: string;
  /**
   * How many reverse proxies sit in front of the app (default 1: nginx/Caddy). Only the address added by the
   * last trusted hop is believed, so a client cannot fake its IP by sending its own X-Forwarded-For.
   * 0 = no proxy (use the socket address).
   */
  trustProxyHops: number;
}

export function loadConfig(env = process.env): Config {
  return {
    port: Number(env.PORT ?? 8080),
    publicUrl: (env.PUBLIC_URL ?? "http://localhost:5173").replace(/\/$/, ""),
    allowedOrigins: (env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    databaseUrl: env.DATABASE_URL || undefined,
    redisUrl: env.REDIS_URL || undefined,
    adminToken: env.ADMIN_TOKEN || undefined,
    inviteTtlMs: Number(env.INVITE_TTL_MS ?? 10 * 60_000),
    tvGraceMs: Number(env.TV_GRACE_MS ?? 90_000),
    roomIdleMs: Number(env.ROOM_IDLE_MS ?? 2 * 60 * 60_000),
    webDist: env.WEB_DIST || undefined,
    trustProxyHops: Math.max(0, Math.min(5, Number(env.TRUST_PROXY_HOPS ?? 1) || 0)),
  };
}

/** An empty allow-list means "development: allow any origin"; production deployments must set it. */
export function originAllowed(cfg: Config, origin: string | undefined): boolean {
  if (cfg.allowedOrigins.length === 0) return true;
  return origin !== undefined && cfg.allowedOrigins.includes(origin);
}

/**
 * Production must not run with defaults that are fine on a laptop. The code is public, so the only things
 * protecting a deployment are its secrets and settings: refuse to start when they are weak or missing.
 */
export function productionProblems(cfg: Config, env = process.env): string[] {
  if (env.NODE_ENV !== "production") return [];
  const out: string[] = [];
  if (!cfg.adminToken || cfg.adminToken.length < 32) out.push("ADMIN_TOKEN must be set to at least 32 random characters");
  if (cfg.allowedOrigins.length === 0) out.push("ALLOWED_ORIGINS must list the site's own origin(s)");
  if (!cfg.publicUrl.startsWith("https://")) out.push("PUBLIC_URL must be https:// (phones need a secure page for motion sensors)");
  return out;
}
