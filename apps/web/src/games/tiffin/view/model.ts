/**
 * Tiffin Tornado view model: turns the match into "what to draw where" (food sprites or models, chefs, effects,
 * progress rings), so the lite (sprites) and cinematic (real-time 3D) views draw exactly the same kitchen.
 * No three.js here. Positions are game metres: x right, y up, z towards the camera.
 */
import type { Item } from "../recipes";
import { COOK, FLIP, WORK, cellCentre, type Kitchen, type Tile } from "../kitchen";
import type { Match } from "../engine";
import type { TileCode } from "../levels";

export interface FoodDraw { name: string; x: number; y: number; z: number; scale: number; alpha: number }
export interface Fx { kind: "steam" | "smoke" | "fire" | "sizzle" | "bubbles"; x: number; y: number; z: number; rate: number }
export interface Ring { key: string; x: number; y: number; z: number; value: number; color: string; icon: string }
export type Clip = "idle" | "run" | "carry" | "carryrun" | "work" | "cheer";
export interface ChefDraw { id: string; slot: number; x: number; z: number; heading: number; clip: Clip; carrying: boolean; speed: number }

/** Height of the surface food sits on, per station code. */
export const SURFACE: Partial<Record<TileCode, number>> = {
  "#": 0.5, h: 0.5, t: 0.62, k: 0.66, p: 0.86, i: 1.02, g: 0.86, f: 0.5, x: 0.58, s: 0.5, r: 0.66, d: 0.5, w: 0.5, b: 0.5, u: 0.5, o: 0.5, v: 0.5, c: 0.5,
};

/** Heights of the solid block each code puts above the floor (the lite view's depth occluders). */
export const BLOCK: Partial<Record<TileCode, number>> = {
  "#": 0.5, h: 0.5, t: 0.6, k: 0.6, p: 0.85, i: 0.95, g: 0.8, f: 0.85, x: 0.52, s: 0.6, r: 0.6, d: 0.5, w: 0.5, b: 0.75, u: 0.66, o: 0.7, v: 0.7, c: 0.66, m: 0.9, z: 0.55,
};

/** The direction a station faces (towards its floor), as in tools/blender/tiffin/build_level.py: radians about up. */
export function facingOf(layout: readonly string[], c: number, r: number): number {
  const H = layout.length, W = layout[0]!.length;
  const floor = (cc: number, rr: number) => rr >= 0 && rr < H && cc >= 0 && cc < W && ".|".includes(layout[rr]![cc]!);
  if (floor(c, r + 1)) return 0;
  if (floor(c + 1, r)) return Math.PI / 2;
  if (floor(c - 1, r)) return -Math.PI / 2;
  if (floor(c, r - 1)) return Math.PI;
  return 0;
}

/** Local station offset (x right, z towards the station's front) turned with the station. */
function local(t: Tile, k: Kitchen, layout: readonly string[], lx: number, lz: number) {
  const a = facingOf(layout, t.c, t.r);
  const p = cellCentre(k, t.c, t.r);
  // Blender rotates about +Z (up); game z = -Blender y, so a turn of `a` maps local (x, z) like this:
  return { x: p.x + lx * Math.cos(a) + lz * Math.sin(a), z: p.z - lx * Math.sin(a) + lz * Math.cos(a) };
}

const PART_AT: Record<string, [number, number, number]> = {
  dosa: [0, -0.02, 0.85], idli: [-0.1, -0.06, 0.7], vada: [0.1, -0.06, 0.7], chutney: [0.13, 0.08, 0.7], sambar: [-0.13, 0.08, 0.7],
};

/** Sprites for one item standing at (x, y, z): a plate with its parts, a stack of dirty plates, or one thing. */
export function itemDraws(it: Item, x: number, y: number, z: number, out: FoodDraw[], scale = 1) {
  if (it.kind === "plate") {
    out.push({ name: "plate", x, y, z, scale, alpha: 1 });
    for (const p of it.parts ?? []) {
      const [dx, dz, s] = PART_AT[p]!;
      out.push({ name: p, x: x + dx * scale, y: y + 0.015, z: z + dz * scale, scale: s * scale, alpha: 1 });
    }
    return;
  }
  if (it.kind === "dirty") {
    for (let i = 0; i < Math.min(4, it.count ?? 1); i++) out.push({ name: "dirty", x, y: y + i * 0.03, z: z + i * 0.002, scale, alpha: 1 });
    return;
  }
  out.push({ name: it.kind, x, y, z, scale, alpha: 1 });
}

export interface Model { foods: FoodDraw[]; fx: Fx[]; rings: Ring[] }

/** Everything on counters and stations, on the floor, and the station effects and timers. */
export function kitchenModel(m: Match, layout: readonly string[]): Model {
  const k = m.kitchen;
  const foods: FoodDraw[] = [], fx: Fx[] = [], rings: Ring[] = [];
  for (const t of k.tiles) {
    const c = cellCentre(k, t.c, t.r);
    const y = SURFACE[t.code] ?? 0.5;
    if (t.fire > 0) fx.push({ kind: "fire", x: c.x, y: y + 0.05, z: c.z, rate: 1 });
    else if (t.item?.kind === "burnt" && COOK[t.code]) fx.push({ kind: "smoke", x: c.x, y: y + 0.1, z: c.z, rate: 1 });
    const it = t.item;
    switch (t.code) {
      case "t": {
        if (!it) break;
        const p = t.cook / COOK.t!.seconds;
        if (it.kind === "batter") {
          const golden = t.side === 1 ? Math.min(1, p / FLIP.perfectFrom) : 1;
          foods.push({ name: "tava_raw", x: c.x, y, z: c.z, scale: 1, alpha: 1 });
          foods.push({ name: "tava_dosa", x: c.x, y: y + 0.004, z: c.z, scale: 1, alpha: golden });
          fx.push({ kind: "sizzle", x: c.x, y: y + 0.05, z: c.z, rate: 0.6 });
          if (t.side === 1) rings.push({ key: `t${t.c},${t.r}`, x: c.x, y: y + 0.55, z: c.z, value: Math.min(1, p / FLIP.burnAt), color: p >= FLIP.perfectFrom && p <= FLIP.perfectTo ? "#ffd23f" : p > FLIP.perfectTo ? "#ff5d3a" : "#9fe870", icon: p >= FLIP.min ? "🍳" : "" });
          else rings.push({ key: `t${t.c},${t.r}`, x: c.x, y: y + 0.55, z: c.z, value: Math.min(1, p), color: "#9fe870", icon: "" });
        } else itemDraws(it, c.x, y, c.z, foods);
        if (it.kind === "dosa") warnOver(t, COOK.t!.burnAfter!, c, y, rings);
        break;
      }
      case "k": {
        if (!it) break;
        if (it.kind === "dough") {
          const p = t.cook / COOK.k!.seconds;
          foods.push({ name: "vada_raw", x: c.x, y, z: c.z, scale: 1, alpha: 1 });
          foods.push({ name: "vada", x: c.x, y: y + 0.003, z: c.z, scale: 1, alpha: Math.min(1, p) });
          fx.push({ kind: "sizzle", x: c.x, y: y + 0.08, z: c.z, rate: 1 });
          rings.push({ key: `k${t.c},${t.r}`, x: c.x, y: y + 0.6, z: c.z, value: Math.min(1, p), color: "#9fe870", icon: "" });
        } else itemDraws(it, c.x, y, c.z, foods);
        if (it.kind === "vada") warnOver(t, COOK.k!.burnAfter!, c, y, rings);
        break;
      }
      case "p": {
        if (!it) break;
        if (it.kind === "cutveg" || it.kind === "sambar") {
          foods.push({ name: it.kind === "sambar" ? "pot_sambar" : "pot_veg", x: c.x, y, z: c.z, scale: 1, alpha: 1 });
          fx.push({ kind: "steam", x: c.x, y: y + 0.1, z: c.z, rate: it.kind === "sambar" ? 0.6 : 1 });
          if (it.kind === "cutveg") rings.push({ key: `p${t.c},${t.r}`, x: c.x, y: y + 0.6, z: c.z, value: t.cook / COOK.p!.seconds, color: "#9fe870", icon: "" });
          else rings.push({ key: `p${t.c},${t.r}`, x: c.x, y: y + 0.6, z: c.z, value: 1, color: "#ffd23f", icon: "🍲".repeat(Math.max(1, t.stock)) });
        } else itemDraws(it, c.x, y, c.z, foods);
        break;
      }
      case "i": {
        if (!it) break;
        if (it.kind === "batter") {
          fx.push({ kind: "steam", x: c.x, y: y, z: c.z, rate: 1.4 });
          rings.push({ key: `i${t.c},${t.r}`, x: c.x, y: y + 0.45, z: c.z, value: t.cook / COOK.i!.seconds, color: "#9fe870", icon: "" });
        } else itemDraws(it, c.x, y, c.z, foods, 0.9);
        break;
      }
      case "f": {
        if (!it) break;
        const at = local(t, k, layout, 0, 0.12);
        itemDraws(it, at.x, y, at.z, foods);
        if (it.kind === "cup") {
          fx.push({ kind: "steam", x: at.x, y: y + 0.2, z: at.z, rate: 0.5 });
          rings.push({ key: `f${t.c},${t.r}`, x: at.x, y: y + 0.6, z: at.z, value: t.cook / COOK.f!.seconds, color: "#9fe870", icon: "" });
        }
        break;
      }
      case "x":
      case "g": {
        if (!it) break;
        itemDraws(it, c.x, y, c.z, foods);
        const w = WORK[t.code]!;
        if (it.kind === w.input) rings.push({ key: `${t.code}${t.c},${t.r}`, x: c.x, y: y + 0.5, z: c.z, value: t.work, color: "#5ec8ff", icon: t.code === "x" ? "🔪" : "🌀" });
        break;
      }
      case "s": {
        for (let i = 0; i < Math.min(4, t.dirty); i++) foods.push({ name: "dirty", x: c.x - 0.12, y: y + 0.02 + i * 0.03, z: c.z, scale: 0.9, alpha: 1 });
        for (let i = 0; i < Math.min(4, t.stock); i++) foods.push({ name: "plate", x: c.x + 0.18, y: y + 0.02 + i * 0.03, z: c.z + 0.05, scale: 0.8, alpha: 1 });
        if (t.dirty > 0) {
          fx.push({ kind: "bubbles", x: c.x, y: y + 0.1, z: c.z, rate: t.work > 0 ? 1 : 0.2 });
          rings.push({ key: `s${t.c},${t.r}`, x: c.x, y: y + 0.55, z: c.z, value: t.work, color: "#5ec8ff", icon: `🧽${t.dirty}` });
        }
        break;
      }
      case "r":
        for (let i = 0; i < Math.min(6, t.stock); i++) foods.push({ name: "plate", x: c.x, y: y + i * 0.035, z: c.z + 0.04, scale: 0.85, alpha: 1 });
        break;
      case "d":
        for (let i = 0; i < Math.min(5, t.stock); i++) foods.push({ name: "dirty", x: c.x, y: y + i * 0.035, z: c.z, scale: 0.9, alpha: 1 });
        break;
      default:
        if (it) itemDraws(it, c.x, y, c.z + t.slide, foods);
    }
  }
  for (const f of k.floor) itemDraws(f.item, f.x, 0.01, f.z, foods);
  return { foods, fx, rings };
}

function warnOver(t: Tile, burnAfter: number, c: { x: number; z: number }, y: number, rings: Ring[]) {
  const left = burnAfter - t.over;
  if (left < burnAfter * 0.6) rings.push({ key: `w${t.c},${t.r}`, x: c.x, y: y + 0.55, z: c.z, value: left / burnAfter, color: "#ff5d3a", icon: "⚠️" });
}

/** The chefs: where, which way, which clip. `speeds` are each chef's current ground speed. */
export function chefModel(m: Match): ChefDraw[] {
  return m.chefs.map((c) => {
    const speed = Math.hypot(c.vx, c.vz);
    const carrying = !!c.holding;
    let clip: Clip = speed > 0.5 ? (carrying ? "carryrun" : "run") : carrying ? "carry" : "idle";
    if (c.sinceWork < 0.4 && !carrying) clip = "work";
    if (m.phase === "results" || (m.phase === "levelEnd" && m.phaseT > 0.5)) clip = "cheer";
    return { id: c.id, slot: c.slot, x: c.x, z: c.z, heading: Math.atan2(c.fx, c.fz), clip, carrying, speed };
  });
}

/** Where a chef holds what they carry. */
export function carriedDraws(m: Match, out: FoodDraw[]) {
  for (const c of m.chefs) {
    if (!c.holding) continue;
    itemDraws(c.holding, c.x + c.fx * 0.34, 0.5, c.z + c.fz * 0.34 + 0.02, out, 0.85);
  }
}
