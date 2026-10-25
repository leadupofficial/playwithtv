/**
 * Progress and rewards, kept on the TV (localStorage): best stars per level, and the skin/theme the household
 * picked. Nothing is sent to the server, so a campaign costs the server nothing and works offline.
 */
import type { GridTitle, Reward } from "./types";

/** Anything with levels and star rewards (grid titles, couples games) can keep progress here. */
export type Campaign = Pick<GridTitle, "id" | "rewards"> & { levels: readonly unknown[] };

export interface Progress {
  /** Best stars per level index (0 = not cleared). */
  stars: number[];
  skin: string;
  theme: string;
}

const KEY = (id: string) => `pwtv.grid.${id}`;

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null; // private mode / blocked storage: play without saving
  }
}

export function load(t: Campaign): Progress {
  const blank: Progress = { stars: t.levels.map(() => 0), skin: "", theme: "" };
  try {
    const raw = storage()?.getItem(KEY(t.id));
    if (!raw) return blank;
    const p = JSON.parse(raw) as Partial<Progress>;
    const stars = t.levels.map((_, i) => Math.max(0, Math.min(3, Math.floor(Number(p.stars?.[i]) || 0))));
    const owned = unlocked(t, stars);
    const skin = owned.some((r) => r.kind === "skin" && r.id === p.skin) ? p.skin! : "";
    const theme = owned.some((r) => r.kind === "theme" && r.id === p.theme) ? p.theme! : "";
    return { stars, skin, theme };
  } catch {
    return blank;
  }
}

export function save(t: Campaign, p: Progress) {
  try {
    storage()?.setItem(KEY(t.id), JSON.stringify(p));
  } catch {
    /* full or blocked: progress just isn't kept */
  }
}

export const total = (stars: number[]) => stars.reduce((a, b) => a + b, 0);

/** A level is open when it is the first or the one before it has been cleared. */
export const isOpen = (stars: number[], i: number) => i === 0 || (stars[i - 1] ?? 0) > 0;

export function unlocked(t: Campaign, stars: number[]): Reward[] {
  const n = total(stars);
  return t.rewards.filter((r) => r.stars <= n);
}

/**
 * Records a finished level. Keeps the best stars, returns the rewards this run newly unlocked and, when the
 * newest reward is a skin or theme, wears it straight away (the household can still see all rewards).
 */
export function record(t: Campaign, p: Progress, level: number, stars: number): { progress: Progress; fresh: Reward[] } {
  const before = new Set(unlocked(t, p.stars).map((r) => r.id));
  const next = p.stars.slice();
  next[level] = Math.max(next[level] ?? 0, stars);
  const fresh = unlocked(t, next).filter((r) => !before.has(r.id));
  let { skin, theme } = p;
  for (const r of fresh) {
    if (r.kind === "skin") skin = r.id;
    if (r.kind === "theme") theme = r.id;
  }
  return { progress: { stars: next, skin, theme }, fresh };
}

/** The next reward still to earn, for the "3 more ★ for …" line. */
export function nextReward(t: Campaign, stars: number[]): Reward | null {
  const n = total(stars);
  return t.rewards.filter((r) => r.stars > n).sort((a, b) => a.stars - b.stars)[0] ?? null;
}
