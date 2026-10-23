import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import { CATALOG, type GameManifest, type GameResult } from "@scp/protocol";

export interface MatchRecord {
  sessionId: string;
  gameId: string;
  gameVersion: string;
  startedAt: number;
  durationMs: number;
  results: GameResult[];
}

/** Durable storage behind one small interface so tests and offline dev run without Postgres. */
export interface Persistence {
  readonly kind: "postgres" | "memory";
  init(): Promise<void>;
  sessionStarted(id: string): Promise<void>;
  sessionEnded(id: string, reason: string): Promise<void>;
  playerJoined(sessionId: string, playerId: string, name: string, avatar: string): Promise<void>;
  matchFinished(m: MatchRecord): Promise<void>;
  games(): Promise<Array<GameManifest & { enabled: boolean }>>;
  setGameEnabled(id: string, enabled: boolean): Promise<boolean>;
  recentMatches(limit: number): Promise<Array<{ gameId: string; finishedAt: string; players: number; durationMs: number }>>;
  opsEvent(kind: string, detail: Record<string, unknown>): Promise<void>;
  close(): Promise<void>;
}

export class MemoryPersistence implements Persistence {
  readonly kind = "memory" as const;
  private enabled = new Map(CATALOG.map((g) => [g.id, true]));
  private matches: Array<MatchRecord & { finishedAt: number }> = [];
  async init() {}
  async sessionStarted() {}
  async sessionEnded() {}
  async playerJoined() {}
  async matchFinished(m: MatchRecord) {
    this.matches.unshift({ ...m, finishedAt: Date.now() });
    this.matches.length = Math.min(this.matches.length, 500);
  }
  async games() {
    return CATALOG.map((g) => ({ ...g, enabled: this.enabled.get(g.id) ?? true }));
  }
  async setGameEnabled(id: string, enabled: boolean) {
    if (!this.enabled.has(id)) return false;
    this.enabled.set(id, enabled);
    return true;
  }
  async recentMatches(limit: number) {
    return this.matches.slice(0, limit).map((m) => ({
      gameId: m.gameId, finishedAt: new Date(m.finishedAt).toISOString(), players: m.results.length, durationMs: m.durationMs,
    }));
  }
  async opsEvent() {}
  async close() {}
}

export class PgPersistence implements Persistence {
  readonly kind = "postgres" as const;
  private pool: pg.Pool;
  constructor(url: string) {
    this.pool = new pg.Pool({ connectionString: url, max: 10 });
  }

  /** Applies pending migrations in order, then syncs the catalogue manifests. */
  async init() {
    await this.pool.query("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())");
    const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
    const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
    for (const f of files) {
      const done = await this.pool.query("SELECT 1 FROM schema_migrations WHERE name = $1", [f]);
      if (done.rowCount) continue;
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(await readFile(join(dir, f), "utf8"));
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [f]);
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    }
    for (const g of CATALOG) {
      await this.pool.query(
        `INSERT INTO games (id, title, manifest) VALUES ($1, $2, $3)
         ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, manifest = EXCLUDED.manifest, updated_at = now()`,
        [g.id, g.title, g],
      );
      await this.pool.query("INSERT INTO game_versions (game_id, version) VALUES ($1, $2) ON CONFLICT DO NOTHING", [g.id, g.version]);
    }
    // titles dropped from the catalogue disappear, unless matches were played with them (history stays intact)
    await this.pool.query(
      "DELETE FROM games WHERE NOT (id = ANY($1)) AND id NOT IN (SELECT DISTINCT game_id FROM matches)",
      [CATALOG.map((g) => g.id)],
    );
    await this.pool.query("DELETE FROM ops_events WHERE at < now() - interval '30 days'");
  }

  async sessionStarted(id: string) {
    await this.pool.query("INSERT INTO sessions (id) VALUES ($1) ON CONFLICT DO NOTHING", [id]);
  }
  async sessionEnded(id: string, reason: string) {
    await this.pool.query("UPDATE sessions SET ended_at = now(), end_reason = $2 WHERE id = $1", [id, reason]);
  }
  async playerJoined(sessionId: string, playerId: string, name: string, avatar: string) {
    await this.pool.query(
      `INSERT INTO session_players (session_id, player_id, display_name, avatar) VALUES ($1, $2, $3, $4)
       ON CONFLICT (session_id, player_id) DO UPDATE SET display_name = EXCLUDED.display_name, avatar = EXCLUDED.avatar`,
      [sessionId, playerId, name, avatar],
    );
  }
  async matchFinished(m: MatchRecord) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const r = await client.query(
        "INSERT INTO matches (session_id, game_id, game_version, started_at, duration_ms) VALUES ($1, $2, $3, to_timestamp($4 / 1000.0), $5) RETURNING id",
        [m.sessionId, m.gameId, m.gameVersion, m.startedAt, Math.round(m.durationMs)],
      );
      for (const res of m.results) {
        await client.query("INSERT INTO match_results (match_id, player_id, score, place) VALUES ($1, $2, $3, $4)", [
          r.rows[0].id, res.playerId, res.score, res.place,
        ]);
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
  async games() {
    const r = await this.pool.query("SELECT manifest, enabled FROM games ORDER BY title");
    return r.rows.map((row) => ({ ...(row.manifest as GameManifest), enabled: row.enabled as boolean }));
  }
  async setGameEnabled(id: string, enabled: boolean) {
    const r = await this.pool.query("UPDATE games SET enabled = $2, updated_at = now() WHERE id = $1", [id, enabled]);
    return (r.rowCount ?? 0) > 0;
  }
  async recentMatches(limit: number) {
    const r = await this.pool.query(
      `SELECT m.game_id, m.finished_at, m.duration_ms, count(mr.player_id)::int AS players
       FROM matches m LEFT JOIN match_results mr ON mr.match_id = m.id
       GROUP BY m.id ORDER BY m.finished_at DESC LIMIT $1`,
      [limit],
    );
    return r.rows.map((x) => ({ gameId: x.game_id, finishedAt: x.finished_at.toISOString(), players: x.players, durationMs: x.duration_ms }));
  }
  async opsEvent(kind: string, detail: Record<string, unknown>) {
    await this.pool.query("INSERT INTO ops_events (kind, detail) VALUES ($1, $2)", [kind, detail]);
  }
  async close() {
    await this.pool.end();
  }
}
