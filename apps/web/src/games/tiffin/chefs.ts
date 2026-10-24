/**
 * Tiffin Tornado: chefs moving around the carriage (pure). Smooth acceleration, a dash, circle-vs-tile
 * collisions, chefs bumping each other, the carriage's sway pushing everyone, and which station a chef faces.
 */
import type { Item } from "./recipes";
import { type Kitchen, type Tile, cellCentre, cellOf, interactive, tileAt, walkable } from "./kitchen";

export const RADIUS = 0.3;
export const SPEED = 3.9;
export const DASH = { speed: 10, seconds: 0.16, cooldown: 0.6 };
const REACH = 1.25;

export interface ChefStats {
  serves: number; points: number; perfectFlips: number; flips: number; chutneys: number; chops: number;
  washed: number; coffees: number; doused: number; burnt: number; drops: number; dashes: number; trashed: number;
}

export interface Chef {
  id: string;
  slot: number;
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** Facing direction (unit vector on the ground). */
  fx: number;
  fz: number;
  holding: Item | null;
  dash: number;
  dashCd: number;
  /** Seconds since the last work stroke (chop/grind/wash animation), and since the last action. */
  sinceWork: number;
  sinceAct: number;
  stats: ChefStats;
}

export function newStats(): ChefStats {
  return { serves: 0, points: 0, perfectFlips: 0, flips: 0, chutneys: 0, chops: 0, washed: 0, coffees: 0, doused: 0, burnt: 0, drops: 0, dashes: 0, trashed: 0 };
}

export function newChef(id: string, slot: number, x: number, z: number): Chef {
  return { id, slot, x, z, vx: 0, vz: 0, fx: 0, fz: -1, holding: null, dash: 0, dashCd: 0, sinceWork: 9, sinceAct: 9, stats: newStats() };
}

/** Spawn points: the floor cells nearest the middle of the kitchen (spread out). */
export function spawnPoints(k: Kitchen, n: number): Array<{ x: number; z: number }> {
  const cells: Array<{ c: number; r: number; d: number }> = [];
  for (const t of k.tiles) if (walkable(k, t.c, t.r) && t.code === ".") cells.push({ c: t.c, r: t.r, d: Math.hypot(t.c - (k.w - 1) / 2, t.r - (k.h - 1) / 2) });
  cells.sort((a, b) => a.d - b.d);
  const out: Array<{ x: number; z: number }> = [];
  for (const cell of cells) {
    if (out.length >= n) break;
    const p = cellCentre(k, cell.c, cell.r);
    if (out.every((q) => Math.hypot(q.x - p.x, q.z - p.z) >= 1.9)) out.push(p);
  }
  for (const cell of cells) if (out.length < n) out.push(cellCentre(k, cell.c, cell.r));
  return out;
}

export interface MoveInput { x: number; z: number; dash: boolean }

/**
 * Moves one chef for dt seconds. `push` is the sway's sideways acceleration (m/s², + = towards the camera).
 * Returns true when a dash started.
 */
export function moveChef(k: Kitchen, c: Chef, inp: MoveInput, dt: number, push = 0): boolean {
  let mx = inp.x, mz = inp.z;
  const mag = Math.hypot(mx, mz);
  if (mag > 1) { mx /= mag; mz /= mag; }
  if (mag > 0.2) {
    const l = Math.hypot(mx, mz);
    c.fx = mx / l;
    c.fz = mz / l;
  }
  let dashed = false;
  c.dashCd = Math.max(0, c.dashCd - dt);
  if (inp.dash && c.dashCd <= 0) {
    c.dash = DASH.seconds;
    c.dashCd = DASH.cooldown;
    dashed = true;
  }
  const k2 = Math.min(1, dt * 14);
  if (c.dash > 0) {
    c.dash -= dt;
    c.vx = c.fx * DASH.speed;
    c.vz = c.fz * DASH.speed;
  } else {
    c.vx += (mx * SPEED - c.vx) * k2;
    c.vz += (mz * SPEED - c.vz) * k2;
  }
  c.vz += push * dt;
  c.x += c.vx * dt;
  c.z += c.vz * dt;
  collide(k, c);
  c.sinceWork += dt;
  c.sinceAct += dt;
  return dashed;
}

/** Pushes a chef out of every solid cell around it (circle vs. square). */
export function collide(k: Kitchen, c: Chef) {
  const { c: cc, r: rr } = cellOf(k, c.x, c.z);
  for (let pass = 0; pass < 2; pass++) {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (walkable(k, cc + dc, rr + dr)) continue;
        const p = cellCentre(k, cc + dc, rr + dr);
        const nx = Math.max(p.x - 0.5, Math.min(c.x, p.x + 0.5));
        const nz = Math.max(p.z - 0.5, Math.min(c.z, p.z + 0.5));
        const dx = c.x - nx, dz = c.z - nz;
        const d = Math.hypot(dx, dz);
        if (d >= RADIUS) continue;
        if (d < 1e-6) {
          // centre inside the cell: push out along the shallow axis
          const ox = c.x - p.x, oz = c.z - p.z;
          if (Math.abs(ox) > Math.abs(oz)) c.x = p.x + Math.sign(ox || 1) * (0.5 + RADIUS);
          else c.z = p.z + Math.sign(oz || 1) * (0.5 + RADIUS);
          continue;
        }
        const push = RADIUS - d;
        c.x += (dx / d) * push;
        c.z += (dz / d) * push;
        if (Math.abs(dx) > Math.abs(dz)) c.vx = 0; else c.vz = 0;
      }
    }
  }
}

/** Chefs bump each other apart (soft). */
export function separate(chefs: Chef[], k: Kitchen) {
  for (let i = 0; i < chefs.length; i++) {
    for (let j = i + 1; j < chefs.length; j++) {
      const a = chefs[i]!, b = chefs[j]!;
      const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
      if (d >= RADIUS * 2 || d < 1e-6) continue;
      const push = (RADIUS * 2 - d) / 2;
      a.x -= (dx / d) * push; a.z -= (dz / d) * push;
      b.x += (dx / d) * push; b.z += (dz / d) * push;
      collide(k, a);
      collide(k, b);
    }
  }
}

/** The station or counter a chef faces (forgiving: the best-aligned one within reach), or null. */
export function targetOf(k: Kitchen, c: Chef): Tile | null {
  const { c: cc, r: rr } = cellOf(k, c.x, c.z);
  let best: Tile | null = null, score = -Infinity;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const t = tileAt(k, cc + dc, rr + dr);
      if (!interactive(t)) continue;
      const p = cellCentre(k, t.c, t.r);
      const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz);
      if (d > REACH) continue;
      const align = (dx * c.fx + dz * c.fz) / (d || 1);
      if (align < 0.45) continue;
      const s = align * 2 - d;
      if (s > score) { score = s; best = t; }
    }
  }
  return best;
}

/** A dropped item at the chef's feet (or just ahead), or -1. */
export function floorItemNear(k: Kitchen, c: Chef): number {
  let best = -1, bd = 0.85;
  k.floor.forEach((f, i) => {
    const d = Math.hypot(f.x - (c.x + c.fx * 0.35), f.z - (c.z + c.fz * 0.35));
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}
