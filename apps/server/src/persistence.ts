import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import { CATALOG, type GameManifest, type GameResult } from "@playwithtv/protocol";
import type { DayPeak } from "./live.js";

export interface MatchRecord {
  sessionId: string;
  gameId: string;
  gameVersion: string;
  startedAt: number;
  durationMs: number;
  results: GameResult[];
}

/** One day (India time) of usage. Unique/new phones and TVs only count devices that sent an install id. */
export interface UsageDay {
  day: string;
  rooms: number;           // rooms created (a TV page that reloads makes a new one)
  roomsWithPhones: number; // rooms at least one phone joined
  tvs: number;             // distinct TVs that opened a room
  newTvs: number;          // TVs seen for the first time ever
  joins: number;           // phone joins (one per player per room)
  phones: number;          // distinct phones that joined
  newPhones: number;       // phones seen for the first time ever
  matches: number;
  peakTvs: number;         // most TVs online at once
  peakPhones: number;      // most phones online at once
}
export interface Usage {
  days: UsageDay[];
  /** last 7 days (today included); returning = active this week and first seen before it */
  week: { tvs: number; newTvs: number; phones: number; newPhones: number; rooms: number; emptyRooms: number };
  allTime: { tvs: number; phones: number; trackingSince: string | null };
  topGames: Array<{ gameId: string; matches: number; avgSeconds: number }>;
  events: Array<{ at: string; kind: string; detail: Record<string, unknown> }>;
}

const IST = "'Asia/Kolkata'";

/** Durable storage behind one small interface so tests and offline dev run without Postgres. */
/** How a started game ended: reached its results, left mid-game by the TV or captain, or the room closed. */
export type PlayOutcome = "finished" | "quit" | "abandoned";

export interface Persistence {
  readonly kind: "postgres" | "memory";
  init(): Promise<void>;
  sessionStarted(id: string, tvDevice?: string): Promise<void>;
  sessionEnded(id: string, reason: string): Promise<void>;
  playerJoined(sessionId: string, playerId: string, name: string, avatar: string, device?: string): Promise<void>;
  matchFinished(m: MatchRecord): Promise<void>;
  /** A game started; returns its row id (null without Postgres) for playEnded. */
  playStarted(sessionId: string, gameId: string, players: number): Promise<number | null>;
  playEnded(id: number, outcome: PlayOutcome): Promise<void>;
  games(): Promise<Array<GameManifest & { enabled: boolean }>>;
  setGameEnabled(id: string, enabled: boolean): Promise<boolean>;
  recentMatches(limit: number): Promise<Array<{ gameId: string; finishedAt: string; players: number; durationMs: number }>>;
  opsEvent(kind: string, detail: Record<string, unknown>): Promise<void>;
  /** Raises the stored peak for that day (never lowers it). */
  raisePeak(p: DayPeak): Promise<void>;
  peak(day: string): Promise<DayPeak | null>;
  usage(days: number): Promise<Usage>;
  close(): Promise<void>;
}

export class MemoryPersistence implements Persistence {
  readonly kind = "memory" as const;
  private enabled = new Map(CATALOG.map((g) => [g.id, true]));
  private matches: Array<MatchRecord & { finishedAt: number }> = [];
  async init() {}
  async sessionStarted(_id: string, _tvDevice?: string) {}
  async sessionEnded(_id: string, _reason: string) {}
  async playerJoined(_sessionId: string, _playerId: string, _name: string, _avatar: string, _device?: string) {}
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
  async playStarted(_sessionId: string, _gameId: string, _players: number) {
    return null;
  }
  async playEnded(_id: number, _outcome: PlayOutcome) {}
  private peaks = new Map<string, DayPeak>();
  async raisePeak(p: DayPeak) {
    const o = this.peaks.get(p.day);
    this.peaks.set(p.day, o ? { day: p.day, tvs: Math.max(o.tvs, p.tvs), phones: Math.max(o.phones, p.phones), rooms: Math.max(o.rooms, p.rooms) } : { ...p });
  }
  async peak(day: string) {
    return this.peaks.get(day) ?? null;
  }
  /** History needs Postgres; in memory only the matches and peaks of this process are known. */
  async usage(days: number): Promise<Usage> {
    const out: UsageDay[] = [];
    for (let i = 0; i < days; i++) {
      const day = new Date(Date.now() + 5.5 * 3600_000 - i * 86_400_000).toISOString().slice(0, 10);
      const pk = this.peaks.get(day);
      const matches = this.matches.filter((m) => new Date(m.finishedAt + 5.5 * 3600_000).toISOString().slice(0, 10) === day).length;
      out.push({ day, rooms: 0, roomsWithPhones: 0, tvs: 0, newTvs: 0, joins: 0, phones: 0, newPhones: 0, matches, peakTvs: pk?.tvs ?? 0, peakPhones: pk?.phones ?? 0 });
    }
    return { days: out, week: { tvs: 0, newTvs: 0, phones: 0, newPhones: 0, rooms: 0, emptyRooms: 0 }, allTime: { tvs: 0, phones: 0, trackingSince: null }, topGames: [], events: [] };
  }
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
    // Rooms live only in this process's memory, so any session still open now was cut off by a restart.
    await this.pool.query("UPDATE sessions SET ended_at = now(), end_reason = 'server_restart' WHERE ended_at IS NULL");
  }

  async sessionStarted(id: string, tvDevice?: string) {
    await this.pool.query("INSERT INTO sessions (id, tv_device) VALUES ($1, $2) ON CONFLICT DO NOTHING", [id, tvDevice ?? null]);
  }
  async sessionEnded(id: string, reason: string) {
    await this.pool.query("UPDATE sessions SET ended_at = now(), end_reason = $2 WHERE id = $1", [id, reason]);
  }
  async playerJoined(sessionId: string, playerId: string, name: string, avatar: string, device?: string) {
    await this.pool.query(
      `INSERT INTO session_players (session_id, player_id, display_name, avatar, device) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (session_id, player_id) DO UPDATE SET display_name = EXCLUDED.display_name, avatar = EXCLUDED.avatar`,
      [sessionId, playerId, name, avatar, device ?? null],
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
  async playStarted(sessionId: string, gameId: string, players: number) {
    const r = await this.pool.query("INSERT INTO plays (session_id, game_id, players) VALUES ($1, $2, $3) RETURNING id", [sessionId, gameId, players]);
    return Number(r.rows[0].id);
  }
  async playEnded(id: number, outcome: PlayOutcome) {
    await this.pool.query("UPDATE plays SET ended_at = now(), outcome = $2 WHERE id = $1 AND ended_at IS NULL", [id, outcome]);
  }
  async opsEvent(kind: string, detail: Record<string, unknown>) {
    await this.pool.query("INSERT INTO ops_events (kind, detail) VALUES ($1, $2)", [kind, detail]);
  }
  async raisePeak(p: DayPeak) {
    await this.pool.query(
      `INSERT INTO daily_peaks (day, tvs, phones, rooms) VALUES ($1, $2, $3, $4)
       ON CONFLICT (day) DO UPDATE SET tvs = GREATEST(daily_peaks.tvs, EXCLUDED.tvs),
         phones = GREATEST(daily_peaks.phones, EXCLUDED.phones), rooms = GREATEST(daily_peaks.rooms, EXCLUDED.rooms)`,
      [p.day, p.tvs, p.phones, p.rooms],
    );
  }
  async peak(day: string) {
    const r = await this.pool.query("SELECT to_char(day, 'YYYY-MM-DD') AS day, tvs, phones, rooms FROM daily_peaks WHERE day = $1", [day]);
    return (r.rows[0] as DayPeak | undefined) ?? null;
  }
  async usage(days: number): Promise<Usage> {
    const n = Math.max(1, Math.min(90, Math.floor(days)));
    // since = midnight (India time) at the start of the range
    const since = (d: string) => `(date_trunc('day', now() AT TIME ZONE ${IST}) - interval '${d}') AT TIME ZONE ${IST}`;
    const local = (col: string) => `(${col} AT TIME ZONE ${IST})::date`;
    const daily = await this.pool.query(
      `WITH b AS (SELECT (date_trunc('day', now() AT TIME ZONE ${IST}) - make_interval(days => $1::int - 1)) AT TIME ZONE ${IST} AS since),
       s AS (SELECT s.id, ${local("s.created_at")} AS day, s.tv_device FROM sessions s, b WHERE s.created_at >= b.since),
       p AS (SELECT ${local("p.joined_at")} AS day, p.device FROM session_players p, b WHERE p.joined_at >= b.since),
       ft AS (SELECT ${local("min(created_at)")} AS day FROM sessions WHERE tv_device IS NOT NULL GROUP BY tv_device),
       fp AS (SELECT ${local("min(joined_at)")} AS day FROM session_players WHERE device IS NOT NULL GROUP BY device),
       m AS (SELECT ${local("finished_at")} AS day FROM matches, b WHERE finished_at >= b.since),
       d AS (SELECT (now() AT TIME ZONE ${IST})::date - i AS day FROM generate_series(0, $1::int - 1) i)
       SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
         (SELECT count(*) FROM s WHERE s.day = d.day)::int AS rooms,
         (SELECT count(*) FROM s WHERE s.day = d.day AND EXISTS (SELECT 1 FROM session_players x WHERE x.session_id = s.id))::int AS "roomsWithPhones",
         (SELECT count(DISTINCT tv_device) FROM s WHERE s.day = d.day)::int AS tvs,
         (SELECT count(*) FROM ft WHERE ft.day = d.day)::int AS "newTvs",
         (SELECT count(*) FROM p WHERE p.day = d.day)::int AS joins,
         (SELECT count(DISTINCT device) FROM p WHERE p.day = d.day)::int AS phones,
         (SELECT count(*) FROM fp WHERE fp.day = d.day)::int AS "newPhones",
         (SELECT count(*) FROM m WHERE m.day = d.day)::int AS matches,
         coalesce(pk.tvs, 0) AS "peakTvs", coalesce(pk.phones, 0) AS "peakPhones"
       FROM d LEFT JOIN daily_peaks pk ON pk.day = d.day ORDER BY d.day DESC`,
      [n],
    );
    const week = await this.pool.query(
      `WITH b AS (SELECT ${since("6 days")} AS since),
       tv AS (SELECT min(created_at) AS first, max(created_at) AS last FROM sessions WHERE tv_device IS NOT NULL GROUP BY tv_device),
       ph AS (SELECT min(joined_at) AS first, max(joined_at) AS last FROM session_players WHERE device IS NOT NULL GROUP BY device)
       SELECT (SELECT count(*) FROM tv, b WHERE last >= since)::int AS tvs,
         (SELECT count(*) FROM tv, b WHERE first >= since)::int AS "newTvs",
         (SELECT count(*) FROM ph, b WHERE last >= since)::int AS phones,
         (SELECT count(*) FROM ph, b WHERE first >= since)::int AS "newPhones",
         (SELECT count(*) FROM sessions, b WHERE created_at >= since)::int AS rooms,
         (SELECT count(*) FROM sessions s, b WHERE created_at >= since AND NOT EXISTS (SELECT 1 FROM session_players p WHERE p.session_id = s.id))::int AS "emptyRooms",
         (SELECT count(*) FROM tv)::int AS "allTvs", (SELECT count(*) FROM ph)::int AS "allPhones",
         (SELECT min(t) FROM (SELECT min(created_at) AS t FROM sessions WHERE tv_device IS NOT NULL
            UNION ALL SELECT min(joined_at) FROM session_players WHERE device IS NOT NULL) x) AS "trackingSince"`,
    );
    const games = await this.pool.query(
      `SELECT game_id AS "gameId", count(*)::int AS matches, round(avg(duration_ms) / 1000)::int AS "avgSeconds"
       FROM matches WHERE finished_at >= now() - interval '7 days' GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 12`,
    );
    const events = await this.pool.query("SELECT at, kind, detail FROM ops_events ORDER BY at DESC LIMIT 25");
    const w = week.rows[0];
    return {
      days: daily.rows as UsageDay[],
      week: { tvs: w.tvs, newTvs: w.newTvs, phones: w.phones, newPhones: w.newPhones, rooms: w.rooms, emptyRooms: w.emptyRooms },
      allTime: { tvs: w.allTvs, phones: w.allPhones, trackingSince: w.trackingSince ? (w.trackingSince as Date).toISOString() : null },
      topGames: games.rows,
      events: events.rows.map((e) => ({ at: (e.at as Date).toISOString(), kind: e.kind as string, detail: e.detail as Record<string, unknown> })),
    };
  }
  async close() {
    await this.pool.end();
  }
}
