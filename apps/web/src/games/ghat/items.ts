/**
 * GHAT RUSH items (all original): tiffin-carrier pickups on the road give one of
 *   coconut   🥥  rolls back down the road at whoever is behind you: a hit spins them out
 *   splash    💦  you plough through a monsoon puddle: a wall of water blinds everyone just behind you
 *   chai      ☕  a flask of hot chai: an instant long boost and a bit of meter
 *   horn      📯  the goat-horn horn: traffic and goats ahead scatter to the verge, rivals beside you get shoved
 * Leaders roll mostly defensive items, racers at the back mostly speed (gentle rubber-banding). Pure.
 */
import { wrapS, type Track } from "./track";

export type ItemKind = "coconut" | "splash" | "chai" | "horn";
export const ITEMS: ItemKind[] = ["coconut", "splash", "chai", "horn"];
export const ITEM_LABEL: Record<ItemKind, string> = { coconut: "🥥 Coconut", splash: "💦 Puddle Splash", chai: "☕ Chai Boost", horn: "📯 Goat Horn" };
export const ROLL_TIME = 0.7;
export const PICKUP_RESPAWN = 4;

export interface Pickup { s: number; d: number; t: number }
export interface Coconut { s: number; d: number; sv: number; dv: number; life: number; owner: string; spin: number }

/** Rows of four tiffins across the road at a few places on the lap (fractions of the lap). */
export function placePickups(t: Track, at: number[] = [0.2, 0.47, 0.78]): Pickup[] {
  const out: Pickup[] = [];
  for (const f of at) {
    const s = wrapS(t, f * t.length);
    const i = Math.floor(s / 2) % t.n;
    const hw = t.hw[i]!;
    for (let k = 0; k < 4; k++) out.push({ s, d: (-0.75 + k * 0.5) * (hw - 1.5), t: 0 });
  }
  return out;
}

/**
 * Weighted roll for a racer in `place` of `field`: the front of the pack gets defence (coconut, splash),
 * the back gets speed (chai, horn). `r` is a uniform random number in [0, 1).
 */
export function rollItem(place: number, field: number, r: number): ItemKind {
  const back = field <= 1 ? 0.5 : (place - 1) / (field - 1); // 0 = leader, 1 = last
  const w: Record<ItemKind, number> = {
    coconut: 1.6 - back * 1.1,
    splash: 1.3 - back * 0.7,
    chai: 0.5 + back * 1.6,
    horn: 0.7 + back * 0.7,
  };
  const total = ITEMS.reduce((a, k) => a + w[k], 0);
  let x = r * total;
  for (const k of ITEMS) {
    x -= w[k];
    if (x < 0) return k;
  }
  return "chai";
}

/** Splash reach: racers up to this far behind (m) are blinded. */
export const SPLASH_REACH = 45;
export const SPLASH_BLIND = 2.4;
/** Horn: traffic and goats this far ahead scatter; rivals this close get shoved. */
export const HORN_REACH = 110;
export const HORN_SHOVE_RANGE = 12;
export const HORN_SHOVE = 7.5;
export const CHAI = { t: 1.8, power: 1.42, meter: 0.15 };

/** Moves coconuts; they roll back down the road (relative to the thrower), bounce off the rails, steer gently
 * towards the nearest racer behind, and expire. Returns the ones still alive. */
export function stepCoconuts(t: Track, list: Coconut[], dt: number, targets: Array<{ id: string; s: number; d: number }>): Coconut[] {
  for (const c of list) {
    c.life -= dt;
    c.s += c.sv * dt;
    c.spin += dt * 12;
    // home in, softly, on the closest racer behind it (not the owner)
    let best: { s: number; d: number } | null = null, bd = 40;
    for (const r of targets) {
      if (r.id === c.owner) continue;
      const gap = c.s - r.s;
      if (gap > 0 && gap < bd) {
        bd = gap;
        best = r;
      }
    }
    const want = best ? Math.sign(best.d - c.d) * 2.2 : 0;
    c.dv += (want - c.dv) * Math.min(1, dt * 2);
    c.d += c.dv * dt;
    const i = Math.floor(wrapS(t, c.s) / 2) % t.n;
    const lim = t.hw[i]! - 0.6;
    if (Math.abs(c.d) > lim) {
      c.d = Math.sign(c.d) * lim;
      c.dv = -c.dv * 0.6;
    }
  }
  return list.filter((c) => c.life > 0);
}
