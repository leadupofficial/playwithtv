/**
 * Tiffin Tornado: the carriage sways on curves (pure). Loose things on plain counters slide sideways (towards or
 * away from the camera); one that slides off the edge onto the floor is dropped (a plate counts against whoever
 * left it there). Stations hold their pans, so only counters and hatches are slippery.
 */
import type { Item } from "./recipes";
import { type Kitchen, cellCentre, isCounter, tileAt, walkable } from "./kitchen";

/** Sideways acceleration at full sway, m/s². */
export const SWAY_ACCEL = 2.8;
const STICK = 1.3;      // static friction: below this the item stays put
const FRICTION = { plate: 0.55, other: 0.95 };

export interface SlideEvent { kind: "fall" | "bump"; item: Item; x: number; z: number }

/** Slides loose items for dt seconds under sway `a` (-1..1). */
export function slideItems(k: Kitchen, a: number, dt: number): SlideEvent[] {
  const out: SlideEvent[] = [];
  const acc = a * SWAY_ACCEL;
  const moved = new Set<number>();
  for (let i = 0; i < k.tiles.length; i++) {
    const t = k.tiles[i]!;
    if (!isCounter(t) || !t.item || moved.has(i)) continue;
    const mu = (t.item.kind === "plate" ? FRICTION.plate : FRICTION.other) * 2;
    if (Math.abs(t.slideV) < 0.02 && Math.abs(acc) < STICK) {
      t.slideV = 0;
      t.slide *= Math.max(0, 1 - dt * 2); // settles back to the middle of its counter
      continue;
    }
    const dir = Math.sign(t.slideV || acc);
    t.slideV += (acc - dir * mu) * dt;
    if (Math.sign(t.slideV) !== dir && Math.abs(acc) < mu) t.slideV = 0;
    t.slide += t.slideV * dt;
    if (Math.abs(t.slide) <= 0.5) continue;
    const step = Math.sign(t.slide);
    const next = tileAt(k, t.c, t.r + step);
    const at = cellCentre(k, t.c, t.r);
    if (next && isCounter(next) && !next.item) {
      next.item = t.item;
      next.slide = t.slide - step;
      next.slideV = t.slideV;
      moved.add(k.tiles.indexOf(next));
      t.item = null;
      t.slide = t.slideV = 0;
    } else if (next && walkable(k, next.c, next.r)) {
      const it = t.item;
      k.floor.push({ item: it, x: at.x + (((t.c * 0.618) % 1) - 0.5) * 0.3, z: at.z + step * 0.85 });
      out.push({ kind: "fall", item: it, x: at.x, z: at.z + step * 0.85 });
      t.item = null;
      t.slide = t.slideV = 0;
    } else {
      t.slide = step * 0.42;
      if (Math.abs(t.slideV) > 0.6) out.push({ kind: "bump", item: t.item, x: at.x, z: at.z + t.slide });
      t.slideV = 0;
    }
  }
  return out;
}
