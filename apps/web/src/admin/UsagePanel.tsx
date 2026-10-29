import { pct, usePoll, type Auth } from "./poll";

interface UsageDay {
  day: string; rooms: number; roomsWithPhones: number; tvs: number; newTvs: number; joins: number;
  phones: number; newPhones: number; matches: number; peakTvs: number; peakPhones: number;
}
export interface UsageData {
  storage: string;
  days: UsageDay[];
  week: { tvs: number; newTvs: number; phones: number; newPhones: number; rooms: number; emptyRooms: number };
  allTime: { tvs: number; phones: number; trackingSince: string | null };
  topGames: Array<{ gameId: string; matches: number; avgSeconds: number }>;
  events: Array<{ at: string; kind: string; detail: Record<string, unknown> }>;
}

const EVENT_LABEL: Record<string, string> = {
  admin_auth_failed: "Wrong admin token",
  join_code_flood: "Many wrong join codes (possible guessing)",
};

const dayLabel = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });

export function UsagePanel({ auth, titles, onUnauthorized }: { auth: Auth; titles: Record<string, string>; onUnauthorized: (m: string) => void }) {
  const { data, error } = usePoll<UsageData>("/api/admin/usage?days=14", 60_000, auth, onUnauthorized);
  if (!data) return <section className="admin-card"><h2>Users</h2><p className="hint">{error ?? "Loading usage…"}</p></section>;
  const { week: w, allTime: a } = data;
  const maxJoins = Math.max(1, ...data.days.map((d) => Math.max(d.joins, d.phones)));
  return (
    <>
      <section className="admin-card">
        <h2>Users <small className="hint">· last 7 days, India time · refreshes every minute</small></h2>
        {data.storage !== "postgres" && <p className="notice">History needs Postgres (DATABASE_URL). This server keeps it in memory, so only live numbers are real.</p>}
        <div className="stats">
          <div className="stat">New phones<b>{w.newPhones}</b><small>{w.phones} active this week</small></div>
          <div className="stat">Returning phones<b>{w.phones - w.newPhones}</b><small>{pct(w.phones - w.newPhones, w.phones)} of active</small></div>
          <div className="stat">New TVs<b>{w.newTvs}</b><small>{w.tvs} active (households)</small></div>
          <div className="stat">Returning TVs<b>{w.tvs - w.newTvs}</b><small>{pct(w.tvs - w.newTvs, w.tvs)} of active</small></div>
          <div className="stat">Rooms with no phone<b>{pct(w.emptyRooms, w.rooms)}</b><small>{w.emptyRooms} of {w.rooms} rooms</small></div>
          <div className="stat">All time<b>{a.phones} <span className="unit">phones</span></b><small>{a.tvs} TVs{a.trackingSince ? ` · since ${new Date(a.trackingSince).toLocaleDateString()}` : ""}</small></div>
        </div>
        <p className="hint">Phones and TVs are counted by an anonymous install id kept in the browser (no personal data); clearing site data or private mode counts as a new device. Days before tracking started show only rooms, joins and matches.</p>
        <table className="usage">
          <thead><tr><th>Day</th><th>Phones (new)</th><th>Joins</th><th>TVs (new)</th><th>Rooms · with phones</th><th>Matches</th><th>Peak online</th></tr></thead>
          <tbody>{data.days.map((d) => (
            <tr key={d.day} className={d.rooms + d.joins + d.matches === 0 ? "quiet" : ""}>
              <td>{dayLabel(d.day)}</td>
              <td><div className="bar-cell"><span className="bar" style={{ width: `${(d.phones / maxJoins) * 100}%` }} />{d.phones} <span className="hint">({d.newPhones})</span></div></td>
              <td><div className="bar-cell"><span className="bar alt" style={{ width: `${(d.joins / maxJoins) * 100}%` }} />{d.joins}</div></td>
              <td>{d.tvs} <span className="hint">({d.newTvs})</span></td>
              <td>{d.rooms} · {d.roomsWithPhones}</td>
              <td>{d.matches}</td>
              <td>{d.peakPhones || d.peakTvs ? `${d.peakPhones} 📱 · ${d.peakTvs} 📺` : "–"}</td>
            </tr>
          ))}</tbody>
        </table>
      </section>
      <div className="admin-grid">
        <section className="admin-card">
          <h2>Top games <small className="hint">· 7 days</small></h2>
          {data.topGames.length === 0 ? <p className="hint">No finished matches this week.</p> : (
            <table><thead><tr><th>Game</th><th>Matches</th><th>Avg length</th></tr></thead>
              <tbody>{data.topGames.map((g) => (
                <tr key={g.gameId}><td>{titles[g.gameId] ?? g.gameId}</td><td>{g.matches}</td><td>{g.avgSeconds}s{g.avgSeconds < 5 ? <span className="bad"> · quit early?</span> : null}</td></tr>
              ))}</tbody></table>
          )}
        </section>
        <section className="admin-card">
          <h2>Security events <small className="hint">· kept 30 days</small></h2>
          {data.events.length === 0 ? <p className="hint">Nothing suspicious recorded.</p> : (
            <table><thead><tr><th>When</th><th>What</th><th>From</th></tr></thead>
              <tbody>{data.events.map((e, i) => (
                <tr key={i}><td>{new Date(e.at).toLocaleString()}</td><td>{EVENT_LABEL[e.kind] ?? e.kind}</td><td><code>{typeof e.detail.ip === "string" ? e.detail.ip : "–"}</code></td></tr>
              ))}</tbody></table>
          )}
        </section>
      </div>
    </>
  );
}
