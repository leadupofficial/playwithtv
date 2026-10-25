/**
 * kitplat/collide: axis-separated collision of an upright box against the tile grid, 45° slopes, one-way
 * platforms, gates and moving platforms. Pure and allocation-free in the hot path.
 *
 * A body is { x (centre), y (feet), hw (half width), h (height) }. Rules:
 *   - walls: Solid, Block, Crate, Crumble and closed gates. Slopes and one-ways never block sideways.
 *   - floors: the same tiles (top edge, under either foot: you can stand on a ledge with one toe), one-ways and
 *     moving platforms (only when coming from above), and slopes (under the body's CENTRE, so walking up a slope
 *     onto flat ground never pops).
 *   - ceilings: walls only; a head bump near a corner slides the body round it (corner correction).
 *   - a grounded body steps up ≤ STEP and sticks to the ground going down slopes and steps (no little hops).
 */
import { type Level, Tile, isSlope, slopeHeight, tileAt } from "./level";

export interface Body {
  x: number; y: number; hw: number; h: number;
  vx: number; vy: number;
  grounded: boolean;
  /** Index of the moving platform it stands on, or -1. */
  platform: number;
  /** Ground tile kind under it (for dust, slope momentum), Tile.Empty in the air. */
  ground: Tile;
  /** Slope direction under it: +1 rising to the right, -1 falling, 0 flat. */
  slope: number;
}

export interface Platform { x: number; y: number; hw: number; dx: number; dy: number; active: boolean }

export const STEP = 0.4;
const EPS = 1e-4;
const SUB = 0.45;

export function newBody(x: number, y: number, hw = 0.3, h = 1.2): Body {
  return { x, y, hw, h, vx: 0, vy: 0, grounded: false, platform: -1, ground: Tile.Empty, slope: 0 };
}

export class Collider {
  /** Gate groups A and B: true = open (passable). */
  gateOpen = [false, false];
  platforms: Platform[] = [];

  constructor(readonly level: Level) {}

  tile(c: number, r: number): Tile {
    return tileAt(this.level, c, r);
  }

  /** Does this tile stop sideways movement and heads? */
  wall(t: Tile): boolean {
    return t === Tile.Solid || t === Tile.Block || t === Tile.Crate || t === Tile.Crumble ||
      (t === Tile.GateA && !this.gateOpen[0]) || (t === Tile.GateB && !this.gateOpen[1]);
  }

  /** Is (c, r) a wall tile? */
  solidAt(c: number, r: number): boolean {
    return this.wall(this.tile(c, r));
  }

  /**
   * Moves horizontally by dx in sub-steps. Returns the column of the wall it hit, or -1. A grounded body ignores
   * walls lower than STEP above its feet (it will step up onto them).
   */
  moveX(b: Body, dx: number): number {
    if (dx === 0) return -1;
    const n = Math.ceil(Math.abs(dx) / SUB);
    const sdx = dx / n;
    const dir = Math.sign(dx);
    for (let i = 0; i < n; i++) {
      const nx = b.x + sdx;
      const edge = nx + dir * b.hw;
      const c = Math.floor(edge);
      const r0 = Math.floor(b.y + (b.grounded ? STEP : 0.02));
      const r1 = Math.floor(b.y + b.h - 0.02);
      let hit = false;
      for (let r = r0; r <= r1; r++) if (this.solidAt(c, r)) { hit = true; break; }
      if (hit) {
        b.x = dir > 0 ? c - b.hw - EPS : c + 1 + b.hw + EPS;
        b.vx = 0;
        return c;
      }
      b.x = nx;
    }
    return -1;
  }

  /**
   * The highest floor under the body with  low ≤ surface ≤ high, or NaN. `prevY` is where the feet were before
   * this move (one-ways and platforms only catch bodies coming from above); `drop` falls through one-ways.
   */
  floor(b: Body, low: number, high: number, prevY: number, drop: boolean): number {
    let best = NaN;
    b.platform = -1;
    b.ground = Tile.Empty;
    b.slope = 0;
    // slopes under the centre take priority over flat tiles in other columns
    const cc = Math.floor(b.x);
    for (let r = Math.floor(high); r >= Math.floor(low) - 1; r--) {
      const t = this.tile(cc, r);
      if (isSlope(t)) {
        const s = r + slopeHeight(t, b.x - cc);
        if (s >= low - EPS && s <= high + EPS) {
          b.ground = t;
          b.slope = t === Tile.SlopeUp ? 1 : -1;
          return s;
        }
      }
    }
    const c0 = Math.floor(b.x - b.hw + 0.02), c1 = Math.floor(b.x + b.hw - 0.02);
    for (let c = c0; c <= c1; c++) {
      for (let r = Math.floor(high) - 1; r >= Math.floor(low) - 1; r--) {
        const s = r + 1;
        if (s < low - EPS || s > high + EPS) continue;
        const t = this.tile(c, r);
        let ok = this.wall(t);
        if (!ok && (t === Tile.OneWay || (t === Tile.Ladder && this.tile(c, r + 1) !== Tile.Ladder))) {
          ok = !drop && prevY >= s - 0.05;
        }
        if (ok && !(s <= best)) {
          best = s;
          b.ground = t;
        }
        if (ok) break;
      }
    }
    for (let i = 0; i < this.platforms.length; i++) {
      const p = this.platforms[i]!;
      if (!p.active || b.x + b.hw < p.x - p.hw || b.x - b.hw > p.x + p.hw) continue;
      if (p.y < low - EPS || p.y > high + EPS || drop || prevY < p.y - 0.05 - Math.max(0, p.dy)) continue;
      if (!(p.y <= best)) {
        best = p.y;
        b.platform = i;
        b.ground = Tile.OneWay;
      }
    }
    return best;
  }

  /**
   * Moves vertically by dy. Rising: stops at ceilings (returns the ceiling tile's column through `bumped`).
   * Falling or standing: lands on the highest floor crossed. `snap` > 0 keeps a grounded body glued to ground up
   * to that far below (slopes, steps down).
   */
  moveY(b: Body, dy: number, opts: { drop?: boolean; snap?: number; climbUp?: number } = {}): { landed: boolean; bumped: number } {
    const prevY = b.y;
    if (dy > 0) {
      const n = Math.ceil(dy / SUB);
      for (let i = 0; i < n; i++) {
        const head = b.y + b.h + dy / n;
        const r = Math.floor(head);
        const c0 = Math.floor(b.x - b.hw + 0.02), c1 = Math.floor(b.x + b.hw - 0.02);
        let hitL = false, hitR = false, col = -1;
        for (let c = c0; c <= c1; c++) {
          if (this.solidAt(c, r)) {
            if (c === c0) hitL = true;
            if (c === c1) hitR = true;
            col = c;
          }
        }
        if (col >= 0) {
          // corner correction: only one outer column hit, and only by a little: slide past it
          const nudge = 0.32;
          if (hitL && !hitR && c0 !== c1 && c0 + 1 - (b.x - b.hw) < nudge && !this.solidAt(c0 + 1, r)) {
            b.x = c0 + 1 + b.hw + EPS;
            b.y += dy / n;
            continue;
          }
          if (hitR && !hitL && c0 !== c1 && b.x + b.hw - c1 < nudge && !this.solidAt(c1 - 1, r)) {
            b.x = c1 - b.hw - EPS;
            b.y += dy / n;
            continue;
          }
          b.y = r - b.h - EPS;
          b.vy = 0;
          b.grounded = false;
          b.platform = -1;
          return { landed: false, bumped: col };
        }
        b.y += dy / n;
      }
      b.grounded = false;
      b.platform = -1;
      b.ground = Tile.Empty;
      return { landed: false, bumped: -1 };
    }
    const climb = opts.climbUp ?? 0;
    const low = b.y + dy - (opts.snap ?? 0);
    const high = b.y + Math.max(0.05, climb);
    const s = this.floor(b, low, high, prevY + climb, !!opts.drop);
    if (!Number.isNaN(s) && (s >= b.y + dy - EPS || (opts.snap ?? 0) > 0)) {
      b.y = s;
      if (b.vy < 0) b.vy = 0;
      b.grounded = true;
      return { landed: true, bumped: -1 };
    }
    b.y += dy;
    b.grounded = false;
    b.platform = -1;
    b.ground = Tile.Empty;
    b.slope = 0;
    return { landed: false, bumped: -1 };
  }

  /** True when any part of the body overlaps a tile of kind `t` (hazard checks, water, ladders). */
  touches(b: Body, t: Tile, inset = 0.1): boolean {
    const c0 = Math.floor(b.x - b.hw + inset), c1 = Math.floor(b.x + b.hw - inset);
    const r0 = Math.floor(b.y + inset), r1 = Math.floor(b.y + b.h - inset);
    for (let c = c0; c <= c1; c++) for (let r = r0; r <= r1; r++) if (this.tile(c, r) === t) return true;
    return false;
  }

  /** Is the body's centre column a ladder at its waist or feet? */
  onLadder(b: Body): boolean {
    const c = Math.floor(b.x);
    return this.tile(c, Math.floor(b.y + 0.5)) === Tile.Ladder || this.tile(c, Math.floor(b.y + 0.05)) === Tile.Ladder;
  }
}
