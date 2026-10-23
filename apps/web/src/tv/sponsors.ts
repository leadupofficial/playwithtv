import { useEffect, useState } from "react";
import type { AdPlacement, AdServed } from "@scp/protocol";

const REFRESH_MS = 10 * 60_000;
const FLUSH_MS = 60_000;

/** Today's running sponsors, refreshed every 10 minutes (a TV can sit in the lobby all evening). */
export function useSponsors(): AdServed[] {
  const [ads, setAds] = useState<AdServed[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/ads")
        .then((r) => (r.ok ? r.json() : { ads: [] }))
        .then((d: { ads: AdServed[] }) => alive && setAds(d.ads))
        .catch(() => undefined); // no sponsors is fine: house promos fill the slots
    void load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
  return ads;
}

export const forPlacement = (ads: AdServed[], p: AdPlacement) => ads.filter((a) => a.placements.includes(p));

/** Picks one sponsor at random for a one-off slot (a game's opening card or its in-scene branding). */
export function pickSponsor(ads: AdServed[], p: AdPlacement): AdServed | null {
  const list = forPlacement(ads, p);
  return list.length ? list[Math.floor(Math.random() * list.length)]! : null;
}

/**
 * Counts how often each sponsor was on screen and reports the totals about once a minute over the TV's
 * authenticated room connection (see setImpressionSink). Only counts leave the TV: no viewer or device details.
 */
const pending = new Map<string, number>();
let timer: ReturnType<typeof setInterval> | undefined;
let sink: ((items: Array<{ id: string; placement: AdPlacement; n: number }>) => void) | null = null;

/** The TV app passes its hub connection here; until then counts wait in memory. */
export function setImpressionSink(fn: typeof sink) {
  sink = fn;
}

function flush() {
  if (!pending.size || !sink) return;
  const items = [...pending].slice(0, 20).map(([k, n]) => {
    const [id, placement] = k.split("|") as [string, AdPlacement];
    return { id, placement, n: Math.min(n, 10) };
  });
  for (const it of items) pending.delete(`${it.id}|${it.placement}`);
  sink(items);
}

export function countImpression(ad: AdServed, placement: AdPlacement) {
  const k = `${ad.id}|${placement}`;
  pending.set(k, (pending.get(k) ?? 0) + 1);
  timer ??= setInterval(flush, FLUSH_MS);
}
