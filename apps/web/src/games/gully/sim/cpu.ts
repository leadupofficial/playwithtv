/** CPU kids: a bowler who mostly hits a good length, and a batter whose timing is good but human. */
import { clamp, gauss } from "./lane";
import type { BowlPlan, Delivery } from "./delivery";
import type { Swing } from "./shot";

export function cpuBowlPlan(rand: () => number, bowlOut = false): BowlPlan {
  if (bowlOut) return { line: gauss(rand) * 0.25, length: 0.25 + rand() * 0.35, kind: rand() < 0.6 ? "pace" : "spin" };
  const r = rand();
  const length = r < 0.15 ? 0.05 + rand() * 0.1 : r < 0.75 ? 0.35 + rand() * 0.3 : 0.7 + rand() * 0.25;
  return { line: clamp(gauss(rand) * 0.55, -1.1, 1.1), length, kind: rand() < 0.55 ? "pace" : "spin" };
}

/**
 * When and how a CPU batter swings at a delivery (null = leaves it). Timing error ~70 ms, so perfect contact is
 * common but not certain; good balls are defended now and then.
 */
export function cpuSwing(d: Delivery, rand: () => number): (Swing & { at: number }) | null {
  if (d.wide && rand() < 0.7) return null;
  const goodBall = d.hitsStumps && d.plan.length > 0.3 && d.plan.length < 0.65;
  const defend = goodBall && rand() < 0.3;
  const err = gauss(rand) * 70 - 10;
  return {
    at: d.tContact + err / 1000, dtMs: err, power: defend ? 0.2 : 0.45 + rand() * 0.55,
    aim: gauss(rand) * 0.3, loft: rand() * 2 - 0.6, defend,
  };
}

/** A bowl-out delivery hits the bare brick stack when it is on line and not too short (it would bounce over). */
export function bowlOutHit(d: Delivery): boolean {
  return d.hitsStumps;
}
