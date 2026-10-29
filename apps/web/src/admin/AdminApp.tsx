import { useCallback, useMemo, useState } from "react";
import type { GameManifest } from "@playwithtv/protocol";
import { api } from "../net";
import { SponsorsAdmin } from "./SponsorsAdmin";
import { LivePanel } from "./LivePanel";
import { UsagePanel } from "./UsagePanel";
import { usePoll } from "./poll";

const KEY = "pwtv.admin.token";

interface Overview {
  metrics: Record<string, number>;
  storage: { db: string; presence: string };
  recentMatches: Array<{ gameId: string; finishedAt: string; players: number; durationMs: number }>;
}

const METRICS: Array<[string, string]> = [
  ["roomsCreated", "Rooms created"], ["joins", "Phone joins"], ["rejoins", "Rejoins"], ["matchesFinished", "Matches"],
  ["inputsRelayed", "Inputs relayed"], ["inputsDropped", "Inputs dropped"], ["rateLimited", "Rate limited"],
  ["serverBusy", "Server busy"], ["badMessages", "Bad messages"],
];

/** Operator console: live users, daily new/returning users, games on/off, sponsors, server counters. */
export function AdminApp() {
  const [token, setToken] = useState(() => sessionStorage.getItem(KEY) ?? "");
  const [signInError, setSignInError] = useState<string | null>(null);
  const signOut = useCallback((reason: string | null) => {
    sessionStorage.removeItem(KEY);
    setToken("");
    setSignInError(reason);
  }, []);

  const [checking, setChecking] = useState(false);

  if (!token) {
    return (
      <form className="admin admin-login" onSubmit={async (e) => {
        e.preventDefault();
        const t = (new FormData(e.currentTarget).get("t") as string).trim();
        // one request checks the token: mounting the console with a wrong one would fire every panel's poll at
        // once, and each counts as a failed attempt towards the server's lockout
        setChecking(true);
        setSignInError(null);
        try {
          await api("/api/admin/overview", undefined, { authorization: `Bearer ${t}` });
          sessionStorage.setItem(KEY, t);
          setToken(t);
        } catch (err) {
          const status = (err as { status?: number }).status;
          setSignInError(status === 401 ? "Wrong admin token" : (err as Error).message);
        } finally {
          setChecking(false);
        }
      }}>
        <h1>Admin console</h1>
        {signInError && <div className="notice">{signInError}</div>}
        <input className="input" name="t" type="password" placeholder="Admin token" autoComplete="off" required autoFocus />
        <button className="btn" type="submit" disabled={checking}>{checking ? "Checking…" : "Sign in"}</button>
        <p className="hint">The token is the server's ADMIN_TOKEN. It stays in this tab only and is forgotten when you close it.</p>
      </form>
    );
  }
  return <Console token={token} onSignOut={signOut} />;
}

function Console({ token, onSignOut }: { token: string; onSignOut: (reason: string | null) => void }) {
  const auth = useMemo(() => ({ authorization: `Bearer ${token}` }), [token]);
  const unauthorized = useCallback((m: string) => onSignOut(m), [onSignOut]);
  const games = usePoll<Array<GameManifest & { enabled: boolean }>>("/api/admin/games", 60_000, auth, unauthorized);
  const overview = usePoll<Overview>("/api/admin/overview", 10_000, auth, unauthorized);
  const titles = useMemo(() => Object.fromEntries((games.data ?? []).map((g) => [g.id, `${g.emoji} ${g.title}`])), [games.data]);
  const [saving, setSaving] = useState<string | null>(null);

  return (
    <div className="admin">
      <header className="admin-head">
        <h1>Admin console</h1>
        <span className="hint">{overview.data ? `storage: ${overview.data.storage.db} · presence: ${overview.data.storage.presence}` : ""}</span>
        <button className="btn secondary small" onClick={() => onSignOut(null)}>Sign out</button>
      </header>

      <LivePanel auth={auth} titles={titles} onUnauthorized={unauthorized} />
      <UsagePanel auth={auth} titles={titles} onUnauthorized={unauthorized} />

      <details className="admin-card">
        <summary><h2>Games <small className="hint">· {(games.data ?? []).filter((g) => g.enabled).length} of {(games.data ?? []).length} on · untick to hide a game from every TV straight away</small></h2></summary>
        <table><thead><tr><th>Game</th><th>Version</th><th>Controller</th><th>Players</th><th>Status</th><th>Enabled</th></tr></thead>
          <tbody>{(games.data ?? []).map((g) => (
            <tr key={g.id} className={g.enabled ? "" : "quiet"}>
              <td>{g.emoji} {g.title}</td><td>{g.version}</td><td>{g.controller}</td><td>{g.minPlayers}–{g.maxPlayers}</td>
              <td>{g.heldBack ? "held back" : g.playable ? "playable" : "in development"}</td>
              <td><input type="checkbox" checked={g.enabled} disabled={saving === g.id} aria-label={`Enable ${g.title}`} onChange={async (e) => {
                setSaving(g.id);
                try {
                  await api(`/api/admin/games/${g.id}`, { enabled: e.target.checked }, auth);
                } finally {
                  setSaving(null);
                  games.reload();
                }
              }} /></td>
            </tr>
          ))}</tbody></table>
      </details>

      <SponsorsAdmin auth={auth} />

      {overview.data && (
        <div className="admin-grid">
          <section className="admin-card">
            <h2>Server counters <small className="hint">· since the last restart</small></h2>
            <div className="stats compact">
              {METRICS.map(([k, label]) => <div key={k} className="stat">{label}<b>{(overview.data!.metrics[k] ?? 0).toLocaleString()}</b></div>)}
            </div>
          </section>
          <section className="admin-card">
            <h2>Recent matches</h2>
            {overview.data.recentMatches.length === 0 ? <p className="hint">No matches yet.</p> : (
              <table><thead><tr><th>Game</th><th>Finished</th><th>Players</th><th>Length</th></tr></thead>
                <tbody>{overview.data.recentMatches.map((m, i) => (
                  <tr key={i}><td>{titles[m.gameId] ?? m.gameId}</td><td>{new Date(m.finishedAt).toLocaleString()}</td><td>{m.players}</td><td>{Math.round(m.durationMs / 1000)}s</td></tr>
                ))}</tbody></table>
            )}
          </section>
        </div>
      )}
      <p className="credit">Play With TV · by <b>Leadup Technologies</b></p>
    </div>
  );
}
