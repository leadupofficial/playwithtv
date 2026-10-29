import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { PgPersistence } from "../src/persistence.js";
import { istDay } from "../src/live.js";

// Real-database checks for the usage queries. Run against a throwaway database:
//   docker run -d --rm --name pwtv-pg -e POSTGRES_PASSWORD=t -p 55432:5432 postgres:16-alpine
//   PG_TEST_URL=postgres://postgres:t@127.0.0.1:55432/postgres pnpm --filter @playwithtv/server test
// The test wipes the tables it uses, so never point it at a real deployment.
const url = process.env.PG_TEST_URL;

describe.skipIf(!url)("Postgres usage history", () => {
  let db: PgPersistence;
  let raw: pg.Pool;
  const at = (daysAgo: number, hour = 12) => {
    // noon India time `daysAgo` days back
    const d = new Date(Date.parse(`${istDay()}T${String(hour).padStart(2, "0")}:00:00+05:30`) - daysAgo * 86_400_000);
    return d.toISOString();
  };

  beforeAll(async () => {
    raw = new pg.Pool({ connectionString: url });
    await raw.query("DROP TABLE IF EXISTS match_results, matches, session_players, sessions, daily_peaks, ops_events, ad_daily, ad_creatives, game_versions, asset_licences, games, schema_migrations CASCADE");
    db = new PgPersistence(url!);
    await db.init();
    // a session left open by a crash before this start
    await raw.query("INSERT INTO sessions (id, created_at) VALUES (gen_random_uuid(), now() - interval '1 hour')");
    await db.init(); // a restart closes it
  });
  afterAll(async () => {
    await db?.close();
    await raw?.end();
  });

  it("closes sessions a restart cut off", async () => {
    const r = await raw.query("SELECT end_reason FROM sessions");
    expect(r.rows.map((x) => x.end_reason)).toEqual(["server_restart"]);
  });

  it("counts new and returning phones and TVs per India day", async () => {
    await raw.query("DELETE FROM sessions");
    const room = async (tv: string | null, when: string, phones: Array<string | null>) => {
      const id = (await raw.query("INSERT INTO sessions (id, tv_device, created_at) VALUES (gen_random_uuid(), $1, $2) RETURNING id", [tv, when])).rows[0].id;
      let i = 0;
      for (const p of phones) await raw.query("INSERT INTO session_players (session_id, player_id, display_name, avatar, device, joined_at) VALUES ($1, $2, 'x', 'tiger', $3, $4)", [id, `p${i++}`, p, when]);
      return id;
    };
    await room("tvA", at(10), ["ph1"]);          // before the 7-day window
    await room("tvA", at(2), ["ph1", "ph2"]);    // tvA + ph1 return, ph2 new
    await room("tvB", at(0, 1), ["ph3", null]);   // 01:00 IST today: new TV and phone, plus a legacy join without id
    await room("tvB", at(0), []);                 // a room nobody joined
    await room(null, at(0), []);                  // legacy TV without an id
    await db.raisePeak({ day: istDay(), tvs: 2, phones: 3, rooms: 2 });
    await db.raisePeak({ day: istDay(), tvs: 1, phones: 5, rooms: 1 }); // only phones rise

    const u = await db.usage(14);
    expect(u.days).toHaveLength(14);
    const today = u.days[0]!;
    expect(today.day).toBe(istDay());
    expect(today).toMatchObject({ rooms: 3, roomsWithPhones: 1, tvs: 1, newTvs: 1, joins: 2, phones: 1, newPhones: 1, peakPhones: 5, peakTvs: 2 });
    expect(u.days[2]).toMatchObject({ rooms: 1, tvs: 1, newTvs: 0, joins: 2, phones: 2, newPhones: 1 });
    expect(u.days[10]).toMatchObject({ newTvs: 1, newPhones: 1 });
    expect(u.week).toEqual({ tvs: 2, newTvs: 1, phones: 3, newPhones: 2, rooms: 4, emptyRooms: 2 });
    expect(u.allTime.tvs).toBe(2);
    expect(u.allTime.phones).toBe(3);
    expect(u.allTime.trackingSince).not.toBeNull();
    expect(await db.peak(istDay())).toEqual({ day: istDay(), tvs: 2, phones: 5, rooms: 2 });
  });

  it("lists recent security events", async () => {
    await db.opsEvent("admin_auth_failed", { ip: "203.0.113.9" });
    const u = await db.usage(1);
    expect(u.events[0]).toMatchObject({ kind: "admin_auth_failed", detail: { ip: "203.0.113.9" } });
  });
});
