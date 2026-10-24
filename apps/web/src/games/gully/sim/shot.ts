/**
 * Bat on ball: the swing's timing against the ball's arrival decides contact quality and direction (early = leg
 * side, late = off side), the swing's strength sets the power, an optional aim/loft (buttons stick) steers it.
 * Pure: returns the launch (position + velocity) that fielding.ts plays out.
 */
import { LANE, clamp, gauss } from "./lane";
import type { Delivery, Vec } from "./delivery";

export interface Swing {
  /** Swing time minus the ball's arrival at the bat, in ms (negative = early). */
  dtMs: number;
  /** 0 (a dab) … 1 (everything). */
  power: number;
  /** -1 leg side … 1 off side (buttons stick x; 0 for motion). */
  aim?: number;
  /** -1 keep it down … 1 go big (buttons stick y). */
  loft?: number;
  defend?: boolean;
}

export type Timing = "perfect" | "good" | "early" | "late" | "miss";

/** Timing windows in ms. Late is short: past it the ball is already at the stumps. */
export const WINDOW = { perfect: 55, good: 140, early: 260, late: 85 } as const;

export interface Shot {
  timing: Timing;
  contact: boolean;
  defended: boolean;
  /** A thin edge flying behind (keeper / slips territory). */
  edge: boolean;
  /** Went straight up off a mistimed early swing. */
  skied: boolean;
  /** Launch from the bat. */
  p0: Vec;
  v0: Vec;
  /** Horizontal direction (radians from straight back down the lane; + = off side) and launch angle. */
  dir: number;
  loft: number;
  speed: number;
  name: string;
}

export function judge(dtMs: number, wide = false): Timing {
  const a = Math.abs(dtMs);
  const early = wide ? WINDOW.early * 0.7 : WINDOW.early;
  if (a <= WINDOW.perfect) return "perfect";
  if (dtMs < 0) return a <= WINDOW.good ? "good" : a <= early ? "early" : "miss";
  return dtMs <= WINDOW.late ? "late" : "miss";
}

const MISS: Omit<Shot, "timing"> = { contact: false, defended: false, edge: false, skied: false, p0: { x: 0, y: 0, z: 0 }, v0: { x: 0, y: 0, z: 0 }, dir: 0, loft: 0, speed: 0, name: "" };

export function shotName(dir: number, loft: number, short: boolean): string {
  const a = Math.abs(dir);
  if (a > 2.1) return dir > 0 ? "edge to third man" : "edge to fine leg";
  if (a < 0.25) return loft > 0.35 ? "lofted straight drive" : "straight drive";
  if (dir > 0) return a < 0.8 ? (loft > 0.35 ? "inside-out over cover" : "cover drive") : "square cut";
  if (a < 0.8) return loft > 0.35 ? "slog over midwicket" : "flick off the pads";
  return short ? "pull shot" : "sweep";
}

/** The shot for a swing at a delivery (the ball meets the bat at d.contact). */
export function playShot(d: Delivery, s: Swing, rand: () => number): Shot {
  const timing = judge(s.dtMs, d.wide);
  if (timing === "miss") return { timing, ...MISS };
  const p0 = { x: d.contact.x, y: Math.max(0.2, Math.min(1.4, d.contact.y)), z: LANE.contactZ };
  const short = d.plan.length > 0.65;
  const yorker = d.plan.length < 0.15;
  const launch = (dir: number, loft: number, speed: number, extra: Partial<Shot> = {}): Shot => {
    const h = Math.cos(loft) * speed;
    return {
      timing, contact: true, defended: false, edge: false, skied: false, p0,
      v0: { x: Math.sin(dir) * h, y: Math.sin(loft) * speed, z: -Math.cos(dir) * h },
      dir, loft, speed, name: shotName(dir, loft, short), ...extra,
    };
  };
  if (s.defend) {
    // a forward defensive: dead bat, the ball drops at the feet
    return launch(gauss(rand) * 0.5, 0.06, 2.5 + rand() * 2.5, { defended: true, name: "solid defence" });
  }
  const power = clamp(s.power, 0, 1);
  const aim = clamp(s.aim ?? 0, -1, 1);
  const loftIn = clamp(s.loft ?? 0, -1, 1);
  // early → leg side, late → off side; the ball's line pulls it too (an off-side ball goes to the off side)
  let dir = clamp(s.dtMs / 165, -1.25, 1.25) + aim * 0.45 + d.contact.x * 0.4 + gauss(rand) * 0.08;
  dir = clamp(dir, -1.45, 1.45);
  if (timing === "late" && (s.dtMs > 65 || rand() < 0.45)) {
    // thin edge behind: towards third man (off) or fine leg
    const side = d.contact.x >= 0 ? 1 : -1;
    const edgeDir = side * (2.45 + rand() * 0.45);
    return launch(edgeDir, 0.12 + rand() * 0.3, 8 + rand() * 7, { edge: true });
  }
  if (timing === "early" && rand() < 0.35) {
    // under it: skied towards the leg side
    return launch(dir - 0.2, 1.05 + rand() * 0.2, 13 + rand() * 5 + power * 4, { skied: true, name: "top edge, skied" });
  }
  const quality = timing === "perfect" ? 1 : timing === "good" ? 0.84 : 0.58;
  let loft = ((loftIn + 1) / 2) * 0.5 + power * 0.06;
  if (short) loft += 0.12;
  if (yorker) loft -= 0.12;
  loft = clamp(loft + gauss(rand) * 0.05, -0.05, 0.95);
  let speed = (9 + power * 17) * quality * (yorker ? 0.78 : 1);
  speed = Math.max(4, speed + gauss(rand) * 0.8);
  return launch(dir, loft, speed);
}
