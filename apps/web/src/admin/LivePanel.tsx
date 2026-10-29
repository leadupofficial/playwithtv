import { ago, usePoll, type Auth } from "./poll";

interface Sample { t: number; tvs: number; phones: number; rooms: number; playing: number }
export interface LiveData {
  at: number;
  startedAt: number;
  current: Omit<Sample, "t">;
  history: Sample[];
  peakToday: { day: string; tvs: number; phones: number; rooms: number };
  stats: { rooms: number; players: number; connected: number; tvs: number; playing: number; byGame: Record<string, { rooms: number; phones: number }> };
  rooms: Array<{ roomId: string; status: string; gameId: string | null; players: number; online: number; tv: boolean; idleSeconds: number }>;
}

const W = 720, H = 140, PAD = 24;

/** Last hour of TVs and phones online (each point = the highest count in its 30 s slot). */
function OnlineChart({ history: h, now, current }: { history: Sample[]; now: number; current: Omit<Sample, "t"> }) {
  const from = now - 60 * 60_000;
  // the line always reaches "now" with the live reading, so even the first seconds draw something
  const history = [...h.filter((s) => s.t >= from && s.t < now), { t: now, ...current }];
  const max = Math.max(4, ...history.map((s) => Math.max(s.phones, s.tvs)));
  const x = (t: number) => PAD + ((t - from) / (now - from)) * (W - PAD * 2);
  const y = (v: number) => H - PAD - (v / max) * (H - PAD * 1.6);
  const line = (k: "phones" | "tvs") => history.filter((s) => s.t >= from).map((s, i) => `${i ? "L" : "M"}${x(s.t).toFixed(1)},${y(s[k]).toFixed(1)}`).join("");
  const grid = [0, Math.round(max / 2), max];
  return (
    <svg className="admin-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Phones and TVs online in the last hour">
      {grid.map((g) => (
        <g key={g}>
          <line x1={PAD} x2={W - PAD} y1={y(g)} y2={y(g)} className="grid" />
          <text x={4} y={y(g) + 4}>{g}</text>
        </g>
      ))}
      {[60, 45, 30, 15, 0].map((m) => <text key={m} x={x(now - m * 60_000) - 10} y={H - 4}>{m ? `-${m}m` : "now"}</text>)}
      <path d={line("tvs")} className="tvs" />
      <path d={line("phones")} className="phones" />
      <circle cx={x(now)} cy={y(current.tvs)} r={4} className="tvs" />
      <circle cx={x(now)} cy={y(current.phones)} r={4} className="phones" />
    </svg>
  );
}

export function LivePanel({ auth, titles, onUnauthorized }: { auth: Auth; titles: Record<string, string>; onUnauthorized: (m: string) => void }) {
  const { data, error, updatedAt } = usePoll<LiveData>("/api/admin/live", 2000, auth, onUnauthorized);
  const stale = updatedAt && Date.now() - updatedAt > 10_000;
  if (!data) return <section className="admin-card"><h2>Live now</h2><p className="hint">{error ?? "Loading live counts…"}</p></section>;
  const { current: c, peakToday: pk, stats } = data;
  const games = Object.entries(stats.byGame).sort((a, b) => b[1].phones - a[1].phones);
  return (
    <section className="admin-card">
      <h2>
        <span className={`live-dot ${stale || error ? "off" : ""}`} /> Live now
        <small className="hint"> · updates every 2 s{error ? ` · ${error}` : ""} · server up {ago(data.at - data.startedAt)}</small>
      </h2>
      <div className="stats">
        <div className="stat">TVs online<b>{c.tvs}</b></div>
        <div className="stat">Phones online<b>{c.phones}</b><small>{stats.players - stats.connected > 0 ? `+${stats.players - stats.connected} reconnecting` : " "}</small></div>
        <div className="stat">Rooms<b>{c.rooms}</b><small>{c.playing} in a game</small></div>
        <div className="stat">Peak today<b>{pk.phones} <span className="unit">phones</span></b><small>{pk.tvs} TVs · {pk.rooms} rooms</small></div>
      </div>
      <div className="chart-legend"><span className="key phones" /> phones <span className="key tvs" /> TVs <span className="hint">· last 60 minutes</span></div>
      <OnlineChart history={data.history} now={data.at} current={c} />
      {games.length > 0 && (
        <p className="now-playing">Playing now: {games.map(([id, g]) => <span key={id} className="chip">{titles[id] ?? id} · {g.phones} 📱{g.rooms > 1 ? ` · ${g.rooms} rooms` : ""}</span>)}</p>
      )}
      <h3>Live rooms</h3>
      {data.rooms.length === 0 ? <p className="hint">No rooms open right now. They appear here the moment a TV opens playwithtv.</p> : (
        <table><thead><tr><th>Room</th><th>Status</th><th>Game</th><th>Phones</th><th>TV</th><th>Idle</th></tr></thead>
          <tbody>{[...data.rooms].sort((a, b) => b.online - a.online || a.idleSeconds - b.idleSeconds).map((r) => (
            <tr key={r.roomId}><td><code>{r.roomId}</code></td><td>{r.status}</td><td>{r.gameId ? titles[r.gameId] ?? r.gameId : "–"}</td>
              <td>{r.online}{r.players > r.online ? <span className="hint"> / {r.players}</span> : null}</td>
              <td>{r.tv ? "online" : <span className="bad">offline</span>}</td><td>{ago(r.idleSeconds * 1000)}</td></tr>
          ))}</tbody></table>
      )}
    </section>
  );
}
