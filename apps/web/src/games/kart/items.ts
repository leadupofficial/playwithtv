/**
 * Kart Knockout items (all original): what a gift box gives, using an item, and the hazards left on the road.
 *   zoom      ⚡ Zoom: an instant burst of speed
 *   triple    ⚡⚡⚡ Triple Zoom: three bursts (only for karts at the back)
 *   puddle    💧 Soap Slick: dropped behind you; whoever drives into it spins out
 *   coconut   🥥 Coconut: rolls forward and bounces off walls; spins out whoever it hits
 *   bumper    🛡 Boing Bumper: a springy shield for a few seconds; karts that touch you bounce away spinning
 */
import { nearest } from "./track";
import { KART_R, SPIN, rnd, type Kart, type Race } from "./engine";

export type ItemKind = "zoom" | "triple" | "puddle" | "coconut" | "bumper";
export const ITEMS: ItemKind[] = ["zoom", "triple", "puddle", "coconut", "bumper"];
export const ITEM_LABEL: Record<ItemKind, string> = {
  zoom: "⚡ Zoom", triple: "⚡ Triple Zoom", puddle: "💧 Soap Slick", coconut: "🥥 Coconut", bumper: "🛡️ Boing Bumper",
};
export const ITEM_ICON: Record<ItemKind, string> = { zoom: "⚡", triple: "⚡3", puddle: "💧", coconut: "🥥", bumper: "🛡️" };
export const BOX_RESPAWN = 3;
const PUDDLE_LIFE = 14;
const BALL_LIFE = 3.5;
const BALL_SPEED = 430;
const MAX_HAZARDS = 12;

/** Item weights for the leader (rank 0) and the last kart (rank 1); in between is interpolated (catch-up). */
const FRONT: Record<ItemKind, number> = { zoom: 15, triple: 0, puddle: 40, coconut: 25, bumper: 20 };
const BACK: Record<ItemKind, number> = { zoom: 30, triple: 35, puddle: 0, coconut: 20, bumper: 15 };

/** `rank` from 0 (leading) to 1 (last). */
export function rollItem(r: Race, rank: number): ItemKind {
  let total = 0;
  for (const k of ITEMS) total += FRONT[k] + (BACK[k] - FRONT[k]) * rank;
  let x = rnd(r) * total;
  for (const k of ITEMS) {
    x -= FRONT[k] + (BACK[k] - FRONT[k]) * rank;
    if (x < 0) return k;
  }
  return "zoom";
}

/** True when the kart drove through a live box with its item slot free (the box then respawns later). */
export function pickupBoxes(r: Race, k: Kart): boolean {
  let got = false;
  for (const b of r.boxes) {
    if (b.t > 0) continue;
    if ((k.x - b.x) ** 2 + (k.y - b.y) ** 2 > (KART_R + 12) ** 2) continue;
    b.t = BOX_RESPAWN; // boxes break even when the kart already has an item
    if (!k.item && !got) got = true;
  }
  return got;
}

function slot<T extends { on: boolean }>(list: T[], make: () => T): T {
  const free = list.find((x) => !x.on);
  if (free) return free;
  if (list.length < MAX_HAZARDS) {
    const x = make();
    list.push(x);
    return x;
  }
  return list[0]!; // pool full: the oldest goes
}

export function useItem(r: Race, k: Kart) {
  const kind = k.item!;
  const ca = Math.cos(k.a), sa = Math.sin(k.a);
  k.stats.items++;
  r.events.push({ kind: "use", id: k.id, item: kind });
  if (kind === "zoom" || kind === "triple") k.boostT = Math.max(k.boostT, 1.1);
  else if (kind === "bumper") k.shieldT = 5;
  else if (kind === "puddle") {
    const p = slot(r.puddles, () => ({ x: 0, y: 0, life: 0, owner: "", on: false }));
    p.x = k.x - ca * (KART_R * 2 + 6);
    p.y = k.y - sa * (KART_R * 2 + 6);
    p.life = PUDDLE_LIFE;
    p.owner = k.id;
    p.on = true;
  } else if (kind === "coconut") {
    const b = slot(r.balls, () => ({ x: 0, y: 0, vx: 0, vy: 0, life: 0, owner: "", on: false }));
    b.x = k.x + ca * (KART_R + 12);
    b.y = k.y + sa * (KART_R + 12);
    const fwd = Math.max(0, k.vx * ca + k.vy * sa);
    b.vx = ca * (BALL_SPEED + fwd * 0.5);
    b.vy = sa * (BALL_SPEED + fwd * 0.5);
    b.life = BALL_LIFE;
    b.owner = k.id;
    b.on = true;
  }
  k.itemN--;
  if (k.itemN <= 0) k.item = null;
}

function spinOut(r: Race, k: Kart, by: string, cause: "puddle" | "coconut"): boolean {
  if (k.shieldT > 0) {
    r.events.push({ kind: "blocked", id: k.id });
    return true;
  }
  if (k.spinT > 0) return false;
  k.spinT = SPIN;
  k.boostT = 0;
  k.vx *= 0.35;
  k.vy *= 0.35;
  k.lastHitBy = by;
  const owner = r.karts.find((x) => x.id === by);
  if (owner && owner !== k) owner.stats.hits++;
  r.events.push({ kind: "spin", id: k.id, by, cause });
  return true;
}

/** Boxes respawn, slicks age, coconuts roll and bounce; both spin out karts they touch. */
export function stepHazards(r: Race, dt: number) {
  const t = r.track;
  for (const b of r.boxes) if (b.t > 0) b.t = Math.max(0, b.t - dt);
  for (const p of r.puddles) {
    if (!p.on) continue;
    p.life -= dt;
    if (p.life <= 0) { p.on = false; continue; }
    for (const k of r.karts) {
      if ((k.x - p.x) ** 2 + (k.y - p.y) ** 2 < (KART_R + 10) ** 2 && spinOut(r, k, p.owner, "puddle")) {
        p.on = false;
        break;
      }
    }
  }
  for (const b of r.balls) {
    if (!b.on) continue;
    b.life -= dt;
    if (b.life <= 0) { b.on = false; continue; }
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    const i = nearest(t, b.x, b.y);
    const ex = b.x - t.xs[i]!, ey = b.y - t.ys[i]!;
    const d = Math.hypot(ex, ey);
    const lim = t.wall - 8;
    if (d > lim) {
      const nx = ex / d, ny = ey / d;
      b.x = t.xs[i]! + nx * lim;
      b.y = t.ys[i]! + ny * lim;
      const vn = b.vx * nx + b.vy * ny;
      if (vn > 0) { b.vx -= 2 * vn * nx; b.vy -= 2 * vn * ny; }
    }
    const young = BALL_LIFE - b.life < 0.35;
    for (const k of r.karts) {
      if (young && k.id === b.owner) continue;
      if ((k.x - b.x) ** 2 + (k.y - b.y) ** 2 < (KART_R + 9) ** 2 && spinOut(r, k, b.owner, "coconut")) {
        b.on = false;
        break;
      }
    }
  }
}
