/**
 * Tiffin Tornado: the kitchen grid and its stations (pure). Cooking timers, the tava's flip window, burning,
 * fire that spreads, washing-up and the plate supply. Interactions live in interact.ts, chefs in chefs.ts.
 */
import { type Item, type ItemKind, item } from "./recipes";
import { TILE, type TileCode } from "./levels";

export interface Tile {
  c: number;
  r: number;
  code: TileCode;
  /** What sits on it: a counter's item, or the food inside a station. */
  item: Item | null;
  /** Cooking: seconds since it went in (tava: per side). */
  cook: number;
  /** Tava only: "side1" until flipped, then "side2". */
  side: 1 | 2;
  /** Seconds since the food was done (burns after a while on the tava and in the kadai). */
  over: number;
  /** Chopping / grinding / washing progress 0..1. */
  work: number;
  /** Seconds this tile has been on fire (0 = no fire). */
  fire: number;
  /** Seconds since the food here burnt (smoke, then fire). */
  smoke: number;
  /** Plate rack: clean plates. Sink: clean plates waiting. Dirty return: dirty plates. Pot: sambar servings. */
  stock: number;
  /** Sink: dirty plates waiting to be washed. */
  dirty: number;
  /** Loose items sliding on a counter in a curve: offset within the tile (metres, z) and velocity. */
  slide: number;
  slideV: number;
}

export interface FloorItem { item: Item; x: number; z: number }

export interface Kitchen {
  w: number;
  h: number;
  tiles: Tile[];
  floor: FloorItem[];
  doorsShut: boolean;
}

/** Things players pick raw ingredients from (infinite supply). */
export const CRATE: Partial<Record<TileCode, ItemKind>> = { b: "batter", u: "dough", o: "coconut", v: "veg", c: "cup", m: "water" };

/** Stations that cook by themselves once filled. */
export const COOK: Partial<Record<TileCode, { input: ItemKind; output: ItemKind; seconds: number; burnAfter?: number; servings?: number }>> = {
  t: { input: "batter", output: "dosa", seconds: 3, burnAfter: 9 }, // per side; see flipWindow
  i: { input: "batter", output: "idli", seconds: 7 },
  k: { input: "dough", output: "vada", seconds: 6, burnAfter: 10 },
  p: { input: "cutveg", output: "sambar", seconds: 8, servings: 3 },
  f: { input: "cup", output: "coffee", seconds: 4.5 },
};

/** Stations a chef works by hand (tap, tap, tap…). */
export const WORK: Partial<Record<TileCode, { input: ItemKind; output: ItemKind; strokes: number }>> = {
  x: { input: "veg", output: "cutveg", strokes: 6 },
  g: { input: "coconut", output: "chutney", strokes: 8 },
};
export const WASH_STROKES = 4;

/** The tava: flip once side 1 is half done; a flip in the golden window makes a perfect dosa; too late = burnt. */
export const FLIP = { min: 0.5, perfectFrom: 0.8, perfectTo: 1.15, burnAt: 1.9 };

export const SMOKE_TO_FIRE = 2.5;
export const FIRE_SPREAD = 7;

const SOLID: ReadonlySet<TileCode> = new Set<TileCode>(["#", "h", "b", "u", "o", "v", "c", "m", "x", "g", "t", "i", "k", "p", "f", "s", "r", "d", "w", "z"]);

export function parseKitchen(layout: string[], plates: number): Kitchen {
  const h = layout.length, w = layout[0]!.length;
  const tiles: Tile[] = [];
  for (let r = 0; r < h; r++) {
    if (layout[r]!.length !== w) throw new Error(`layout row ${r} has ${layout[r]!.length} cells, expected ${w}`);
    for (let c = 0; c < w; c++) {
      const code = layout[r]![c] as TileCode;
      tiles.push({ c, r, code, item: null, cook: 0, side: 1, over: 0, work: 0, fire: 0, smoke: 0, stock: code === "r" ? plates : 0, dirty: 0, slide: 0, slideV: 0 });
    }
  }
  return { w, h, tiles, floor: [], doorsShut: false };
}

export function tileAt(k: Kitchen, c: number, r: number): Tile | null {
  return c < 0 || r < 0 || c >= k.w || r >= k.h ? null : k.tiles[r * k.w + c]!;
}

/** World centre of a cell (x right, z towards the camera), metres. */
export function cellCentre(k: Kitchen, c: number, r: number): { x: number; z: number } {
  return { x: (c - (k.w - 1) / 2) * TILE, z: (r - (k.h - 1) / 2) * TILE };
}

export function cellOf(k: Kitchen, x: number, z: number): { c: number; r: number } {
  return { c: Math.round(x / TILE + (k.w - 1) / 2), r: Math.round(z / TILE + (k.h - 1) / 2) };
}

/** Can a chef stand here? (Floor, or the gangway while its doors are open.) */
export function walkable(k: Kitchen, c: number, r: number): boolean {
  const t = tileAt(k, c, r);
  if (!t) return false;
  if (t.code === "|") return !k.doorsShut;
  return t.code === ".";
}

/** Something a chef can interact with (every non-floor tile). */
export function interactive(t: Tile | null): t is Tile {
  return !!t && SOLID.has(t.code);
}

export const isCounter = (t: Tile) => t.code === "#" || t.code === "h";

/** Is this station's food finished (ready to take)? */
export function ready(t: Tile): boolean {
  const cook = COOK[t.code];
  if (cook && t.item) return t.item.kind === cook.output;
  const work = WORK[t.code];
  if (work && t.item) return t.item.kind === work.output;
  return false;
}

/** The tava is in its flip window (side 1, at least half done, not yet burnt). */
export function flippable(t: Tile): boolean {
  return t.code === "t" && t.item?.kind === "batter" && t.side === 1 && t.cook / COOK.t!.seconds >= FLIP.min;
}

export interface StationEvent { kind: "done" | "burnt" | "fire" | "spread"; c: number; r: number; what?: ItemKind }

function burn(t: Tile, out: StationEvent[]) {
  if (!t.item || t.item.kind === "burnt") return;
  t.item = item("burnt", t.item.by);
  t.over = 0;
  t.smoke = 0;
  out.push({ kind: "burnt", c: t.c, r: t.r });
}

/** Advances every station by dt seconds. `rand` picks where fire spreads (seedable). */
export function tickStations(k: Kitchen, dt: number, rand: () => number): StationEvent[] {
  const out: StationEvent[] = [];
  for (const t of k.tiles) {
    if (t.fire > 0) {
      const before = t.fire;
      t.fire += dt;
      if (t.item && t.item.kind !== "burnt" && t.item.kind !== "water") burn(t, out);
      if (Math.floor(t.fire / FIRE_SPREAD) > Math.floor(before / FIRE_SPREAD)) spread(k, t, rand, out);
      continue;
    }
    const cook = COOK[t.code];
    if (!cook || !t.item) {
      if (t.item?.kind === "burnt" && cook) smoulder(t, dt, out);
      continue;
    }
    const kind = t.item.kind;
    if (kind === "burnt") {
      smoulder(t, dt, out);
      continue;
    }
    if (kind === cook.input) {
      t.cook += dt;
      if (t.code === "t") {
        // the tava: side 1 waits for the flip (and burns if forgotten), side 2 finishes by itself
        const p = t.cook / cook.seconds;
        if (t.side === 1 && p >= FLIP.burnAt) burn(t, out);
        else if (t.side === 2 && p >= 1) {
          t.item = { ...t.item, kind: "dosa" };
          t.over = 0;
          out.push({ kind: "done", c: t.c, r: t.r, what: "dosa" });
        }
      } else if (t.cook >= cook.seconds) {
        t.item = { ...t.item, kind: cook.output };
        t.over = 0;
        if (cook.servings) t.stock = cook.servings;
        out.push({ kind: "done", c: t.c, r: t.r, what: cook.output });
      }
    } else if (kind === cook.output && cook.burnAfter) {
      t.over += dt;
      if (t.over >= cook.burnAfter) burn(t, out);
    }
  }
  return out;
}

function smoulder(t: Tile, dt: number, out: StationEvent[]) {
  const before = t.smoke;
  t.smoke += dt;
  if (before < SMOKE_TO_FIRE && t.smoke >= SMOKE_TO_FIRE) {
    t.fire = 0.001;
    out.push({ kind: "fire", c: t.c, r: t.r });
  }
}

function spread(k: Kitchen, from: Tile, rand: () => number, out: StationEvent[]) {
  const n = [[1, 0], [-1, 0], [0, 1], [0, -1]]
    .map(([dc, dr]) => tileAt(k, from.c + dc!, from.r + dr!))
    .filter((t): t is Tile => interactive(t) && t.fire === 0 && t.code !== "w" && t.code !== "m" && t.code !== "s");
  if (!n.length) return;
  const t = n[Math.floor(rand() * n.length)]!;
  t.fire = 0.001;
  out.push({ kind: "spread", c: t.c, r: t.r });
}

/** Puts a fire out (a tumbler of water). The burnt food stays to be binned. */
export function douse(t: Tile) {
  t.fire = 0;
  t.smoke = -6; // a soaked station needs a while before it could catch again
}

export function burning(k: Kitchen): number {
  let n = 0;
  for (const t of k.tiles) if (t.fire > 0) n++;
  return n;
}

/** A dirty plate comes back from the passengers (to the first dirty-return hatch). */
export function returnDirty(k: Kitchen, n = 1) {
  const d = k.tiles.find((t) => t.code === "d");
  if (d) d.stock += n;
}
