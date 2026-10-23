import { useEffect, useState } from "react";
import type { GameManifest } from "@playwithtv/protocol";
import { api } from "../net";
import { SponsorsAdmin } from "./SponsorsAdmin";

const KEY = "pwtv.admin.token";

interface Overview {
  stats: { rooms: number; players: number; connected: number };
  metrics: Record<string, number>;
  rooms: Array<{ roomId: string; status: string; gameId: string | null; players: number; tv: boolean; idleSeconds: number }>;
  storage: { db: string; presence: string };
  recentMatches: Array<{ gameId: string; finishedAt: string; players: number; durationMs: number }>;
}

/** Operator console: live sessions, metrics, rate-limit counters and enabling/disabling games. */
export function AdminApp() {
  const [token, setToken] = useState(() => sessionStorage.getItem(KEY) ?? "");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [games, setGames] = useState<Array<GameManifest & { enabled: boolean }>>([]);
  const [error, setError] = useState<string | null>(null);
  const auth = { authorization: `Bearer ${token}` };

  async function refresh() {
    try {
      const [o, g] = await Promise.all([
        fetch("/api/admin/overview", { headers: auth }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status === 401 ? "Wrong admin token" : `HTTP ${r.status}`)))),
        fetch("/api/admin/games", { headers: auth }).then((r) => r.json()),
      ]);
      setOverview(o);
      setGames(g);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    if (!token) return;
    void refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!token || (error && !overview)) {
    return (
      <form className="admin" onSubmit={(e) => {
        e.preventDefault();
        const t = new FormData(e.currentTarget).get("t") as string;
        sessionStorage.setItem(KEY, t);
        setToken(t);
      }}>
        <h1>Admin console</h1>
        {error && <div className="notice">{error}</div>}
        <input className="input" name="t" type="password" placeholder="Admin token" autoComplete="off" required />
        <button className="btn" type="submit">Sign in</button>
      </form>
    );
  }

  return (
    <div className="admin">
      <h1>Admin console</h1>
      {overview && (
        <>
          <div className="stats">
            <div className="stat">Active rooms<b>{overview.stats.rooms}</b></div>
            <div className="stat">Players<b>{overview.stats.connected} / {overview.stats.players}</b></div>
            <div className="stat">Inputs relayed<b>{overview.metrics.inputsRelayed}</b></div>
            <div className="stat">Inputs dropped<b>{overview.metrics.inputsDropped}</b></div>
            <div className="stat">Rate limited<b>{overview.metrics.rateLimited}</b></div>
            <div className="stat">Bad messages<b>{overview.metrics.badMessages}</b></div>
            <div className="stat">Matches<b>{overview.metrics.matchesFinished}</b></div>
            <div className="stat">Storage<b style={{ fontSize: 16 }}>{overview.storage.db} / {overview.storage.presence}</b></div>
          </div>
          <h2>Live rooms</h2>
          <table><thead><tr><th>Room</th><th>Status</th><th>Game</th><th>Players</th><th>TV</th><th>Idle</th></tr></thead>
            <tbody>{overview.rooms.map((r) => (
              <tr key={r.roomId}><td>{r.roomId}</td><td>{r.status}</td><td>{r.gameId ?? "–"}</td><td>{r.players}</td><td>{r.tv ? "online" : "offline"}</td><td>{r.idleSeconds}s</td></tr>
            ))}</tbody></table>
        </>
      )}
      <h2>Games</h2>
      <table><thead><tr><th>Game</th><th>Version</th><th>Controller</th><th>Players</th><th>Status</th><th>Enabled</th></tr></thead>
        <tbody>{games.map((g) => (
          <tr key={g.id}>
            <td>{g.emoji} {g.title}</td><td>{g.version}</td><td>{g.controller}</td><td>{g.minPlayers}–{g.maxPlayers}</td>
            <td>{g.playable ? "playable" : "in development"}</td>
            <td><input type="checkbox" checked={g.enabled} onChange={async (e) => {
              await api(`/api/admin/games/${g.id}`, { enabled: e.target.checked }, auth);
              void refresh();
            }} /></td>
          </tr>
        ))}</tbody></table>
      <SponsorsAdmin auth={auth} />
      {overview && (
        <>
          <h2>Recent matches</h2>
          <table><thead><tr><th>Game</th><th>Finished</th><th>Players</th><th>Duration</th></tr></thead>
            <tbody>{overview.recentMatches.map((m, i) => (
              <tr key={i}><td>{m.gameId}</td><td>{new Date(m.finishedAt).toLocaleString()}</td><td>{m.players}</td><td>{Math.round(m.durationMs / 1000)}s</td></tr>
            ))}</tbody></table>
        </>
      )}
      <p className="credit">Play With TV · by <b>Leadup Technologies</b></p>
    </div>
  );
}
