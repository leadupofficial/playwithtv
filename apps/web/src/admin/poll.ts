import { useEffect, useRef, useState } from "react";
import { api } from "../net";

export type Auth = Record<string, string>;

/**
 * Polls an admin endpoint every `everyMs` while the tab is visible (a hidden tab costs the server nothing), and
 * once more as soon as it comes back. Each request has the shared API deadline, so a stalled one cannot freeze it.
 */
export function usePoll<T>(path: string, everyMs: number, auth: Auth, onUnauthorized: (msg: string) => void) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState(0);
  const [nonce, setNonce] = useState(0);
  const busy = useRef(false);
  const authKey = auth.authorization;

  useEffect(() => {
    let alive = true;
    async function tick() {
      if (busy.current || document.hidden) return;
      busy.current = true;
      try {
        const d = await api<T>(path, undefined, auth);
        if (!alive) return;
        setData(d);
        setError(null);
        setUpdatedAt(Date.now());
      } catch (e) {
        if (!alive) return;
        const err = e as Error & { status?: number };
        if (err.status === 401 || err.status === 429) onUnauthorized(err.message);
        else setError(err.message);
      } finally {
        busy.current = false;
      }
    }
    void tick();
    const id = setInterval(tick, everyMs);
    const onShow = () => !document.hidden && void tick();
    document.addEventListener("visibilitychange", onShow);
    return () => {
      alive = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [path, everyMs, authKey, nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  return { data, error, updatedAt, reload: () => setNonce((n) => n + 1) };
}

export function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86_400)}d ${Math.floor((s % 86_400) / 3600)}h`;
}

export const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "–");
