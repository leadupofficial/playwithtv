/**
 * kitplat/autotile: which tile sprite draws each cell of a level, and where the decorations go. Pure (tested).
 *
 * Ground (#) picks top-* when nothing solid is above it and fill-* otherwise, with l / r / s (single) edges where
 * the neighbours stop and m in between; textures repeat every 4 tiles, so column c uses phase c % 4. One-way runs
 * get l / m / r / s caps; water gets a surface row. Crates, crumbling floors, gates and timed spikes change during
 * play, so they are listed separately (`dynamic`) and drawn every frame.
 */
import { type Level, Tile, tileAt } from "./level";

export interface TileDraw { c: number; r: number; sprite: string }

export interface TileLayout {
  /** Drawn once, in this order (decorations first, behind the ground). */
  decos: Array<{ x: number; y: number; sprite: string }>;
  tiles: TileDraw[];
  /** Cells whose look changes during play: crates, crumbling floors, gates, timed spikes. */
  dynamic: TileDraw[];
}

const terrain = (t: Tile) => t === Tile.Solid || t === Tile.SlopeUp || t === Tile.SlopeDown;
const side = (l: boolean, r: boolean) => (l && r ? "m" : l ? "r" : r ? "l" : "s");

export function layoutTiles(level: Level, decoIds: string[], seed = 1): TileLayout {
  const out: TileLayout = { decos: [], tiles: [], dynamic: [] };
  let s = seed >>> 0 || 1;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const occupied = new Set(level.entities.map((e) => `${Math.floor(e.x)},${e.y}`));
  let lastDeco = -9;
  for (let c = 0; c < level.w; c++) {
    for (let r = 0; r < level.h; r++) {
      const t = tileAt(level, c, r);
      if (t === Tile.Empty) continue;
      const at = (dc: number, dr: number) => (c + dc < 0 || c + dc >= level.w ? t : tileAt(level, c + dc, r + dr));
      const phase = c % 4;
      switch (t) {
        case Tile.Solid: {
          const top = !terrain(at(0, 1)) && at(0, 1) !== Tile.Block;
          const sd = side(terrain(at(-1, 0)), terrain(at(1, 0)));
          out.tiles.push({ c, r, sprite: `${top ? "top" : "fill"}-${sd}-${sd === "s" ? 0 : phase}` });
          if (top && decoIds.length && at(0, 1) === Tile.Empty && at(0, 2) === Tile.Empty && !occupied.has(`${c},${r + 1}`) && c - lastDeco > 2 && rnd() < 0.2) {
            out.decos.push({ x: c + 0.5, y: r + 1, sprite: decoIds[Math.floor(rnd() * decoIds.length)]! });
            lastDeco = c;
          }
          break;
        }
        case Tile.SlopeUp: out.tiles.push({ c, r, sprite: "slope-up" }); break;
        case Tile.SlopeDown: out.tiles.push({ c, r, sprite: "slope-down" }); break;
        case Tile.OneWay: out.tiles.push({ c, r, sprite: `oneway-${side(at(-1, 0) === Tile.OneWay, at(1, 0) === Tile.OneWay)}` }); break;
        case Tile.Block: out.tiles.push({ c, r, sprite: "block" }); break;
        case Tile.Spikes: out.tiles.push({ c, r, sprite: "spikes" }); break;
        case Tile.Water: out.tiles.push({ c, r, sprite: `${at(0, 1) === Tile.Water ? "water" : "water-top"}-${phase}` }); break;
        case Tile.Ladder: out.tiles.push({ c, r, sprite: "ladder" }); break;
        case Tile.Crate: out.dynamic.push({ c, r, sprite: "crate" }); break;
        case Tile.Crumble: out.dynamic.push({ c, r, sprite: "crumble" }); break;
        case Tile.GateA: case Tile.GateB: out.dynamic.push({ c, r, sprite: "gate" }); break;
        case Tile.TimedSpikes: out.tiles.push({ c, r, sprite: "tspikes-base" }); out.dynamic.push({ c, r, sprite: "tspikes-out" }); break;
      }
    }
  }
  return out;
}
