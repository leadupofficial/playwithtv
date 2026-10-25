/**
 * kitplat/level: the tile-based level format. Levels are ASCII rows (easy to read, diff and author by hand),
 * parsed into a tile grid plus entities. World units are tiles: x right, y UP, tile (c, r) covers
 * [c, c+1] × [r, r+1] with r = 0 the bottom row. No DOM, no three.js: unit-tested.
 *
 *   tiles     #  ground (auto-tiled)      B  block            X  crate (breaks from below or by a dash)
 *             =  one-way platform         /  slope up-right   \  slope down-right
 *             ^  spikes                   ~  water            H  ladder / vine
 *             Y  crumbling floor          T  timed spikes (in and out)
 *             D  gate A (a lever L opens it)   E  gate B (a lever K opens it)
 *   entities  P  player start   C  checkpoint   G  goal         o  gem   O  big gem   U  power-up
 *             S  spring         >  boost pad    Q  loop (bottom-left corner)        Z  boss
 *             M  moving platform (horizontal)   N  moving platform (vertical)        L / K  levers
 *             e  walker   h  hopper   f  flyer   k  curler (stomp it, then kick the ball)
 */

export const Tile = {
  Empty: 0, Solid: 1, Block: 2, Crate: 3, OneWay: 4, SlopeUp: 5, SlopeDown: 6, Spikes: 7, Water: 8,
  Ladder: 9, Crumble: 10, TimedSpikes: 11, GateA: 12, GateB: 13,
} as const;
export type Tile = (typeof Tile)[keyof typeof Tile];

export type EntityKind =
  | "start" | "checkpoint" | "goal" | "gem" | "biggem" | "powerup" | "spring" | "boost" | "loop" | "boss"
  | "moverH" | "moverV" | "leverA" | "leverB" | "walker" | "hopper" | "flyer" | "curler";

export interface EntitySpawn { kind: EntityKind; x: number; y: number; /** n-th of its kind in reading order */ n: number }

/** Extra data a level can carry beside its rows. */
export interface LevelMeta {
  id: string;
  name: string;
  /** Seconds on the clock. */
  time: number;
  /** Power-up ids handed out by the `U` markers, in reading order (cycled). */
  powerups?: string[];
  /** Moving platforms (in reading order of M/N): width in tiles, travel in tiles, seconds per round trip. */
  movers?: Array<{ w?: number; travel?: number; period?: number }>;
  /** Backdrop set and an optional colour grade for it (e.g. dusk). */
  backdrop?: string;
  grade?: string;
  /** Boss id (see boss.ts) when the level has a `Z`. */
  boss?: string;
}

export interface LevelDef extends LevelMeta { rows: string[] }

export interface Level {
  meta: LevelMeta;
  w: number;
  h: number;
  /** Tile kinds, index = r * w + c (r = 0 is the bottom row). */
  tiles: Uint8Array;
  entities: EntitySpawn[];
  start: { x: number; y: number };
  goal: { x: number; y: number } | null;
}

const TILE_OF: Record<string, Tile> = {
  "#": Tile.Solid, B: Tile.Block, X: Tile.Crate, "=": Tile.OneWay, "/": Tile.SlopeUp, "\\": Tile.SlopeDown, "^": Tile.Spikes,
  "~": Tile.Water, H: Tile.Ladder, Y: Tile.Crumble, T: Tile.TimedSpikes, D: Tile.GateA, E: Tile.GateB,
};
const ENTITY_OF: Record<string, EntityKind> = {
  P: "start", C: "checkpoint", G: "goal", o: "gem", O: "biggem", U: "powerup", S: "spring", ">": "boost", Q: "loop", Z: "boss",
  M: "moverH", N: "moverV", L: "leverA", K: "leverB", e: "walker", h: "hopper", f: "flyer", k: "curler",
};

/** Parses a level. Rows may differ in length (short rows are padded with empty space). Throws on unknown glyphs. */
export function parseLevel(def: LevelDef): Level {
  const h = def.rows.length;
  const w = Math.max(...def.rows.map((r) => r.length));
  const tiles = new Uint8Array(w * h);
  const entities: EntitySpawn[] = [];
  const counts = new Map<EntityKind, number>();
  for (let i = 0; i < h; i++) {
    const row = def.rows[i]!;
    const r = h - 1 - i;
    for (let c = 0; c < row.length; c++) {
      const ch = row[c]!;
      if (ch === " " || ch === ".") continue;
      const t = TILE_OF[ch];
      if (t !== undefined) {
        tiles[r * w + c] = t;
        continue;
      }
      const kind = ENTITY_OF[ch];
      if (!kind) throw new Error(`level ${def.id}: unknown glyph '${ch}' at column ${c}, row ${i}`);
      const n = counts.get(kind) ?? 0;
      counts.set(kind, n + 1);
      entities.push({ kind, x: c + 0.5, y: r, n });
    }
  }
  const start = entities.find((e) => e.kind === "start");
  if (!start) throw new Error(`level ${def.id}: no player start (P)`);
  const goal = entities.find((e) => e.kind === "goal") ?? null;
  const { rows: _rows, ...meta } = def;
  return { meta, w, h, tiles, entities, start: { x: start.x, y: start.y }, goal: goal && { x: goal.x, y: goal.y } };
}

export function tileAt(l: Pick<Level, "w" | "h" | "tiles">, c: number, r: number): Tile {
  if (c < 0 || c >= l.w) return Tile.Solid; // the level's sides are walls
  if (r < 0 || r >= l.h) return Tile.Empty; // below is a pit, above is open sky
  return l.tiles[r * l.w + c] as Tile;
}

export function setTile(l: Pick<Level, "w" | "h" | "tiles">, c: number, r: number, t: Tile) {
  if (c >= 0 && c < l.w && r >= 0 && r < l.h) l.tiles[r * l.w + c] = t;
}

/** Surface height of a slope tile at horizontal fraction u (0..1), relative to the tile's bottom. */
export function slopeHeight(t: Tile, u: number): number {
  const v = Math.min(1, Math.max(0, u));
  return t === Tile.SlopeUp ? v : 1 - v;
}

export const isSlope = (t: Tile) => t === Tile.SlopeUp || t === Tile.SlopeDown;
