/**
 * quality/adaptive: an opt-in frame-rate guard for a running game. Feed it real frame times; when the recent
 * average falls under the target it steps quality DOWN, one rung at a time, and never back up during the session
 * (no oscillation). The result is remembered per game in localStorage, so the next match starts where it settled.
 *
 *   const guard = new AdaptiveQuality({ game: "ghat-rush", tier: profile.tier });   // restores a saved state
 *   loop: const step = guard.frame(realDt);        // null, or what to change now:
 *         if (step?.kind === "scale")   renderer.setSize(w * step.scale, h * step.scale, false)
 *         if (step?.kind === "drop")    turn off step.feature ("ao" | "shadows-small" | "shadows" | "bloom")
 *         if (step?.kind === "tier")    rebuild the scene for step.tier (e.g. ultra → high → lite)
 *   debug: guard.state                               // { tier, scale, dropped, fps }
 *
 * The ladder: render scale 1 → 0.85 → 0.72 → minScale (0.6), then drop AO, shrink shadows, drop shadows, drop
 * bloom (only the features the tier has), then the next tier down (scale back to 1 there). A warm-up period is
 * ignored (shader compilation, asset uploads), and after every step the guard waits a full window again.
 * Pure logic apart from the optional localStorage persistence; unit-tested in adaptive.test.ts.
 */
import { TIERS, type Tier } from "./tier";

export type Feature = "ao" | "shadows-small" | "shadows" | "bloom";
export type AdaptiveStep = { kind: "scale"; scale: number } | { kind: "drop"; feature: Feature } | { kind: "tier"; tier: Tier };

export interface AdaptiveState {
  tier: Tier;
  scale: number;
  dropped: Feature[];
  /** Average frame rate over the last window (0 until measured). */
  fps: number;
  /** Steps taken this session. */
  steps: number;
}

export interface AdaptiveOptions {
  /** Storage key part: one remembered state per game. */
  game: string;
  /** The tier the game started with (the saved state only applies if it was saved for this same starting tier). */
  tier: Tier;
  /** Frames per second below which quality steps down (default 50). */
  targetFps?: number;
  /** Averaging window in seconds (default 2.5). */
  window?: number;
  /** Seconds ignored at the start and after every step (default 3). */
  warmup?: number;
  minScale?: number;
  /** Features this game can turn off, cheapest-to-lose first. */
  features?: Feature[];
  /** Lowest tier allowed (default "lite"). */
  floor?: Tier;
  /** Persist in localStorage (default true; tests pass false). */
  persist?: boolean;
}

const KEY = (game: string) => `pwtv.adaptive.${game}`;
const SCALES = [1, 0.85, 0.72];

export class AdaptiveQuality {
  readonly state: AdaptiveState;
  private o: Required<Omit<AdaptiveOptions, "game" | "tier">> & { game: string; startTier: Tier };
  private quiet: number;
  private acc = 0;
  private frames = 0;

  constructor(opts: AdaptiveOptions) {
    this.o = {
      game: opts.game, startTier: opts.tier, targetFps: opts.targetFps ?? 50, window: opts.window ?? 2.5, warmup: opts.warmup ?? 3,
      minScale: opts.minScale ?? 0.6, features: opts.features ?? ["ao", "shadows-small", "shadows", "bloom"], floor: opts.floor ?? "lite",
      persist: opts.persist ?? true,
    };
    this.quiet = this.o.warmup;
    this.state = { tier: opts.tier, scale: 1, dropped: [], fps: 0, steps: 0 };
    const saved = this.o.persist ? load(this.o.game) : null;
    if (saved && saved.from === opts.tier && TIERS.includes(saved.tier) && TIERS.indexOf(saved.tier) <= TIERS.indexOf(opts.tier)) {
      this.state.tier = saved.tier;
      this.state.scale = Math.max(this.o.minScale, Math.min(1, saved.scale));
      this.state.dropped = saved.dropped.filter((f) => this.o.features.includes(f));
    }
  }

  /** Feed one frame's real duration (seconds). Returns a step to apply now, or null. */
  frame(dt: number): AdaptiveStep | null {
    if (!(dt > 0) || dt > 0.5) return null; // tab hidden, breakpoint, a hitch while loading: ignore
    if (this.quiet > 0) {
      this.quiet -= dt;
      return null;
    }
    this.acc += dt;
    this.frames++;
    if (this.acc < this.o.window) return null;
    const fps = this.frames / this.acc;
    this.state.fps = Math.round(fps);
    this.acc = 0;
    this.frames = 0;
    if (fps >= this.o.targetFps) return null;
    const step = this.next();
    if (step) {
      this.apply(step);
      this.quiet = this.o.warmup;
      this.state.steps++;
      this.save();
    }
    return step;
  }

  /** The step the guard would take next (does not apply it). */
  next(): AdaptiveStep | null {
    const s = this.state;
    const lower = [...SCALES, this.o.minScale].filter((x) => x < s.scale - 1e-6 && x >= this.o.minScale - 1e-6);
    if (lower.length) return { kind: "scale", scale: Math.max(...lower) };
    const feature = this.o.features.find((f) => !s.dropped.includes(f) && featureOn(s.tier, f));
    if (feature) return { kind: "drop", feature };
    const i = TIERS.indexOf(s.tier);
    if (i > TIERS.indexOf(this.o.floor)) return { kind: "tier", tier: TIERS[i - 1]! };
    return null;
  }

  private apply(step: AdaptiveStep) {
    const s = this.state;
    if (step.kind === "scale") s.scale = step.scale;
    else if (step.kind === "drop") s.dropped.push(step.feature);
    else {
      s.tier = step.tier;
      s.scale = 1;
      s.dropped = [];
    }
  }

  /** Is a feature still on (for a game reading the state after a restore)? */
  has(f: Feature): boolean {
    return !this.state.dropped.includes(f);
  }

  private save() {
    if (!this.o.persist) return;
    try {
      localStorage.setItem(KEY(this.o.game), JSON.stringify({ from: this.o.startTier, tier: this.state.tier, scale: this.state.scale, dropped: this.state.dropped }));
    } catch { /* private mode: just not remembered */ }
  }
}

/** Which features a tier has to drop at all (lite has none of them). */
export function featureOn(tier: Tier, f: Feature): boolean {
  if (tier === "lite") return false;
  if (f === "ao") return tier === "ultra";
  return true;
}

function load(game: string): { from: Tier; tier: Tier; scale: number; dropped: Feature[] } | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY(game)) ?? "null");
    if (!v || typeof v !== "object" || !Array.isArray(v.dropped) || typeof v.scale !== "number") return null;
    return v;
  } catch {
    return null;
  }
}

/** Forget what a game learned (e.g. the player changed the graphics setting). */
export function resetAdaptive(game: string) {
  try {
    localStorage.removeItem(KEY(game));
  } catch { /* ignore */ }
}
