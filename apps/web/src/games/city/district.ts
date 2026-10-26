/**
 * CITY RIVALS district: one compact, hand-laid block of city, built as data (pure, no three.js) so the simulation,
 * the CPUs, the TV picture and the tests all read the same map.
 *
 * A 5 × 5 grid of streets (x east, z south, metres) 48 m apart, 14 m wide. Between them: 16 blocks. Most blocks are
 * buildings, two are split by a narrow alley (shortcuts), one is an open maidan (a park you can cut across, slower
 * on the grass) with a stunt ramp, one is a plaza with a fountain. Kicker ramps sit on three straight streets.
 * Coin trails line the streets and arc over the ramps. The race is a loop of checkpoint gates at crossings: the
 * route between gates is the player's choice.
 */

export const SPACING = 48;
export const ROAD_HW = 7;
export const ALLEY_HW = 3.5;
export const GRID = 5; // crossings per side
export const EXTENT = SPACING * (GRID - 1); // 192 m between the outer street centre lines
/** Outer wall: just past the outer pavements. */
export const BOUND = { min: -ROAD_HW - 3, max: EXTENT + ROAD_HW + 3 };

export interface Box { x0: number; z0: number; x1: number; z1: number; h: number; tint: number }
export type BlockKind = "buildings" | "alley-x" | "alley-z" | "park" | "plaza";
export interface Block { i: number; j: number; kind: BlockKind; x0: number; z0: number; x1: number; z1: number }
/** A kicker: a ramp across a street. `axis` is the street direction (the way you jump). */
export interface Ramp { x: number; z: number; axis: "x" | "z"; len: number; wid: number; h: number }
export interface Coin { x: number; y: number; z: number }
export interface Gate { x: number; z: number; r: number }
export interface Disc { x: number; z: number; r: number }

export interface District {
  blocks: Block[];
  /** Solid buildings (collision and drawing). */
  boxes: Box[];
  /** Solid round things (the plaza fountain). */
  discs: Disc[];
  ramps: Ramp[];
  coins: Coin[];
  gates: Gate[];
  /** Grass areas (slower). */
  grass: Array<{ x0: number; z0: number; x1: number; z1: number }>;
  /** Trees for drawing (not solid: park trees are hedged so you thread between them). */
  trees: Array<{ x: number; z: number; s: number }>;
  lamps: Array<{ x: number; z: number; a: number }>;
  /** Start grid: pole first, facing yaw. */
  grid: Array<{ x: number; z: number; yaw: number }>;
}

/** Street centre coordinate of crossing index k. */
export const at = (k: number) => k * SPACING;

// block layout by (i, j): i east, j south
const SPECIAL: Record<string, BlockKind> = {
  "1,1": "park",
  "2,2": "plaza",
  "2,0": "alley-z",
  "1,3": "alley-x",
  "3,2": "alley-z",
};

/** The checkpoint loop (crossing indices). Start / finish is gate 0. */
export const ROUTE: Array<[number, number]> = [
  [0, 4], [0, 1], [2, 0], [4, 0], [4, 2], [2, 2], [3, 4], [1, 4],
];

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

export function buildDistrict(): District {
  const rnd = rng(1234);
  const blocks: Block[] = [], boxes: Box[] = [], discs: Disc[] = [], grass: District["grass"] = [], trees: District["trees"] = [];
  const PAVE = 2.5; // pavement inside the block edge
  for (let i = 0; i < GRID - 1; i++) {
    for (let j = 0; j < GRID - 1; j++) {
      const x0 = at(i) + ROAD_HW, x1 = at(i + 1) - ROAD_HW, z0 = at(j) + ROAD_HW, z1 = at(j + 1) - ROAD_HW;
      const kind = SPECIAL[`${i},${j}`] ?? "buildings";
      blocks.push({ i, j, kind, x0, z0, x1, z1 });
      const bx0 = x0 + PAVE, bx1 = x1 - PAVE, bz0 = z0 + PAVE, bz1 = z1 - PAVE;
      const tall = () => 9 + Math.floor(rnd() * 6) * 4 + (i === 2 || j === 2 ? 6 : 0);
      if (kind === "buildings") {
        // two or three buildings per block, split along the longer side at random
        const n = rnd() < 0.5 ? 2 : 3;
        const alongX = rnd() < 0.5;
        for (let k = 0; k < n; k++) {
          const a = k / n, b = (k + 1) / n;
          const gap = k < n - 1 ? 0.6 : 0;
          if (alongX) boxes.push({ x0: bx0 + (bx1 - bx0) * a, x1: bx0 + (bx1 - bx0) * b - gap, z0: bz0, z1: bz1, h: tall(), tint: rnd() });
          else boxes.push({ x0: bx0, x1: bx1, z0: bz0 + (bz1 - bz0) * a, z1: bz0 + (bz1 - bz0) * b - gap, h: tall(), tint: rnd() });
        }
      } else if (kind === "alley-x" || kind === "alley-z") {
        // an alley through the middle of the block (a shortcut, narrow: one car at a time)
        const mid = kind === "alley-x" ? (z0 + z1) / 2 : (x0 + x1) / 2;
        if (kind === "alley-x") {
          boxes.push({ x0: bx0, x1: bx1, z0: bz0, z1: mid - ALLEY_HW, h: tall(), tint: rnd() });
          boxes.push({ x0: bx0, x1: bx1, z0: mid + ALLEY_HW, z1: bz1, h: tall(), tint: rnd() });
        } else {
          boxes.push({ x0: bx0, x1: mid - ALLEY_HW, z0: bz0, z1: bz1, h: tall(), tint: rnd() });
          boxes.push({ x0: mid + ALLEY_HW, x1: bx1, z0: bz0, z1: bz1, h: tall(), tint: rnd() });
        }
      } else if (kind === "park") {
        grass.push({ x0, z0, x1, z1 });
        for (let k = 0; k < 14; k++) {
          const x = x0 + 3 + rnd() * (x1 - x0 - 6), z = z0 + 3 + rnd() * (z1 - z0 - 6);
          // keep the diagonal racing line and the ramp clear
          const u = (x - x0) / (x1 - x0), v = (z - z0) / (z1 - z0);
          if (Math.abs(u - v) < 0.28) continue;
          trees.push({ x, z, s: 0.8 + rnd() * 0.6 });
        }
      } else if (kind === "plaza") {
        discs.push({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, r: 5 });
      }
    }
  }
  const mid = (k: number) => at(k) + SPACING / 2;
  const ramps: Ramp[] = [
    { x: mid(2), z: at(0), axis: "x", len: 7, wid: 8, h: 1.8 },   // the top street, before gate 3
    { x: at(4), z: mid(1), axis: "z", len: 7, wid: 8, h: 1.8 },   // the east street
    { x: at(2), z: mid(3), axis: "z", len: 7, wid: 8, h: 1.8 },   // down from the plaza
    { x: mid(1), z: mid(1), axis: "x", len: 8, wid: 9, h: 2.6 },  // the maidan stunt ramp
  ];
  const coins: Coin[] = [];
  // coin trails down the middle of some streets
  const trail = (x0: number, z0: number, x1: number, z1: number, n: number) => {
    for (let k = 0; k < n; k++) {
      const u = (k + 0.5) / n;
      coins.push({ x: x0 + (x1 - x0) * u, y: 1.1, z: z0 + (z1 - z0) * u });
    }
  };
  // the streets each leg of the race can take (both L-shaped ways between its gates): a short trail mid-block,
  // drifting from one lane to the other so collecting them is a line choice
  const seg = new Set<string>();
  const street = (i0: number, j0: number, i1: number, j1: number) => {
    const di = Math.sign(i1 - i0), dj = Math.sign(j1 - j0);
    for (let i = i0, j = j0; i !== i1 || j !== j1; i += di, j += dj) {
      if (di && j !== j0) break;
      seg.add(di ? `x${Math.min(i, i + di)},${j}` : `z${i},${Math.min(j, j + dj)}`);
      if (!di && !dj) break;
    }
  };
  ROUTE.forEach(([i0, j0], k) => {
    const [i1, j1] = ROUTE[(k + 1) % ROUTE.length]!;
    for (const [ci, cj] of [[i1, j0], [i0, j1]] as const) {
      street(i0, j0, ci, cj);
      street(ci, cj, i1, j1);
    }
  });
  let lane = 1;
  for (const s of [...seg].sort()) {
    const [a, b] = s.slice(1).split(",").map(Number) as [number, number];
    const o = (lane = -lane) * 2.5;
    if (s[0] === "x") trail(mid(a) - 9, at(b) + o, mid(a) + 9, at(b) - o, 4);
    else trail(at(a) + o, mid(b) - 9, at(a) - o, mid(b) + 9, 4);
  }
  // arcs over every ramp (you only get these in the air)
  for (const r of ramps) {
    for (let k = 0; k < 3; k++) {
      // on the arc of a jump at racing speed (launch ≈ 9 m/s up off the crest at ≈ 28 m/s)
      const off = 7 + k * 4.5;
      const y = [3.3, 3.4, 3.0][k]! + (r.h - 1.8);
      coins.push(r.axis === "x" ? { x: r.x + r.len / 2 + off, y, z: r.z } : { x: r.x, y, z: r.z + r.len / 2 + off });
    }
  }
  // the alleys: a trail through each north-south alley
  for (const b of blocks) {
    if (b.kind === "alley-z") trail((b.x0 + b.x1) / 2, b.z0 + 4, (b.x0 + b.x1) / 2, b.z1 - 4, 4);
  }
  const gates: Gate[] = ROUTE.map(([i, j]) => ({ x: at(i), z: at(j), r: 9 }));
  const lamps: District["lamps"] = [];
  for (let k = 0; k < GRID; k++) {
    for (let s = 0; s < GRID - 1; s++) {
      const m = at(s) + SPACING / 2;
      lamps.push({ x: at(k) + ROAD_HW + 1, z: m, a: Math.PI / 2 });
      lamps.push({ x: m, z: at(k) - ROAD_HW - 1, a: 0 });
    }
  }
  // start grid: on the west street just north of gate 0 (start / finish), heading north (yaw π), two by two
  const g0 = gates[0]!;
  const grid: District["grid"] = [];
  for (let k = 0; k < 4; k++) grid.push({ x: g0.x + (k % 2 ? 2.6 : -2.6), z: g0.z - 14 - Math.floor(k / 2) * 6, yaw: Math.PI });
  return { blocks, boxes, discs, ramps, coins, gates, grass, trees, lamps, grid };
}

/** Is (x, z) on a street or alley (not inside a block's building footprint)? */
export function onGrass(d: District, x: number, z: number): boolean {
  for (const g of d.grass) if (x > g.x0 && x < g.x1 && z > g.z0 && z < g.z1) return true;
  return false;
}

/** Nearest crossing (grid indices) to a point. */
export function nearestCrossing(x: number, z: number): [number, number] {
  const c = (v: number) => Math.max(0, Math.min(GRID - 1, Math.round(v / SPACING)));
  return [c(x), c(z)];
}

/** Ramp height under a point (0 off ramps), and the ramp. The kicker rises over its length in the street direction
 * (both ways: drive it either way, its top edge is in the middle, a hump). */
export function rampAt(d: District, x: number, z: number): { h: number; ramp: Ramp | null } {
  for (const r of d.ramps) {
    const along = r.axis === "x" ? x - r.x : z - r.z;
    const across = r.axis === "x" ? z - r.z : x - r.x;
    if (Math.abs(across) > r.wid / 2 || Math.abs(along) > r.len / 2) continue;
    return { h: r.h * (1 - Math.abs(along) / (r.len / 2)), ramp: r };
  }
  return { h: 0, ramp: null };
}
