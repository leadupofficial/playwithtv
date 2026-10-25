/**
 * Tiffin Tornado: the three services on the "Tiffin Tornado Express" kitchen carriage. Pure data plus the level
 * timeline (curves, tunnels, the platform stop, what the windows show). The same layouts drive the game, the
 * Blender backdrops (tools/blender/tiffin/) and the real-time diorama.
 *
 * Grid: row 0 is the back wall (top of the screen), the last row is the cut-away front of the diorama.
 *   .  floor             #  counter            h  pass hatch (a counter in the gangway wall)
 *   |  gangway door (floor while open; shut at the platform stop)
 *   b  batter tub        u  vada dough tub      o  coconuts          v  veggies          c  tumbler stack
 *   m  water matka (fire!)                     x  chopping board    g  wet grinder
 *   t  tava (dosa)       i  idli steamer        k  kadai (vada)      p  sambar pot       f  coffee filter
 *   s  sink              r  plate rack          d  dirty plate return                    w  serving window
 *   z  bin
 */
import type { RecipeId } from "./recipes";

export type TileCode = "." | "#" | "h" | "|" | "b" | "u" | "o" | "v" | "c" | "m" | "x" | "g" | "t" | "i" | "k" | "p" | "f" | "s" | "r" | "d" | "w" | "z";

export type Scenery = "station" | "fields" | "tunnel" | "platform";

export interface Span { from: number; to: number }
export interface Curve extends Span { dir: 1 | -1 }

export interface LevelDef {
  id: number;
  name: string;
  subtitle: string;
  layout: string[];
  menu: RecipeId[];
  /** The first orders, in this order (then random from the menu). */
  opening: RecipeId[];
  /** Seconds between new orders [min, max] in a full-length level with 2+ players. */
  orderEvery: [number, number];
  /** Curves (fractions of the level): the carriage sways, loose items slide. */
  curves: Curve[];
  /** Tunnels (fractions): the kitchen goes dark. */
  tunnels: Span[];
  /** The platform stop (fractions): the gangway doors shut, dishes go through the hatches. */
  platform: Span | null;
  /** Where the train is at the start (fractions until it is moving at full speed). */
  departs: number;
}

export const LEVELS: LevelDef[] = [
  {
    id: 1, name: "Morning Departure", subtitle: "A calm start at Tiffin Junction",
    layout: [
      "#btt#ii#go##",
      "#..........w",
      "c..##..##..w",
      "f..........#",
      "f..##..##..d",
      "m..........r",
      "#z#ss#######",
    ],
    menu: ["coffee", "dosa", "idli"], opening: ["coffee", "dosa", "idli"], orderEvery: [17, 24],
    curves: [], tunnels: [], platform: null, departs: 0.08,
  },
  {
    id: 2, name: "Ghat Curves", subtitle: "Hold on to your plates!",
    layout: [
      "#vxx#pp#tt##",
      "#..........w",
      "o..###..##.w",
      "g..........#",
      "g..#i#..#k.d",
      "m..........r",
      "#cf#b#u#ssz#",
    ],
    menu: ["coffee", "dosa", "vada", "idli-sambar", "dosa-sambar"], opening: ["dosa", "coffee", "vada"], orderEvery: [16, 22],
    curves: [{ from: 0.12, to: 0.17, dir: 1 }, { from: 0.34, to: 0.4, dir: -1 }, { from: 0.58, to: 0.63, dir: 1 }, { from: 0.8, to: 0.86, dir: -1 }],
    tunnels: [], platform: null, departs: 0,
  },
  {
    id: 3, name: "Tunnel Rush", subtitle: "Lights out, then a platform stop: pass it through!",
    layout: [
      "#vx#og#tt#ii#",
      "#.....h.....w",
      "b..#..h..#..w",
      "u..#..|..k..m",
      "c.....h.....d",
      "#.....h.....r",
      "#ss#mz#pp#fz#",
    ],
    menu: ["coffee", "dosa", "idli", "vada", "idli-sambar", "dosa-sambar", "combo"], opening: ["idli", "coffee", "dosa"], orderEvery: [15, 21],
    curves: [{ from: 0.04, to: 0.1, dir: 1 }, { from: 0.86, to: 0.92, dir: -1 }],
    tunnels: [{ from: 0.14, to: 0.3 }, { from: 0.7, to: 0.82 }],
    platform: { from: 0.38, to: 0.62 }, departs: 0,
  },
];

export const TILE = 1; // metres per grid cell

/** Seconds per level: 4 minutes, or 20 s with ?quick=1. */
export function levelSeconds(quick: boolean) {
  return quick ? 20 : 240;
}

const inSpan = (s: Span, f: number) => f >= s.from && f < s.to;

/** Lateral acceleration of the carriage (-1..1, + = towards the camera) at fraction `f` of the level. */
export function swayAt(def: LevelDef, f: number): number {
  for (const c of def.curves) {
    if (!inSpan(c, f)) continue;
    const k = (f - c.from) / (c.to - c.from);
    // ease in, hold, ease out: the carriage leans into the curve and back
    return c.dir * Math.sin(Math.PI * k) ** 0.6;
  }
  return 0;
}

/** True during a curve's 2-second (or 15 %) warning before it starts. */
export function curveAhead(def: LevelDef, f: number, seconds: number): boolean {
  const lead = Math.min(0.15, 2.5 / seconds);
  return def.curves.some((c) => f >= c.from - lead && f < c.from);
}

/** 0 = bright, 1 = tunnel dark (fades in and out over ~4 % of the level). */
export function darkness(def: LevelDef, f: number): number {
  let d = 0;
  for (const t of def.tunnels) {
    const fade = Math.min(0.04, (t.to - t.from) / 3);
    if (f < t.from || f >= t.to) continue;
    d = Math.max(d, Math.min(1, (f - t.from) / fade, (t.to - f) / fade));
  }
  return d;
}

/** The gangway doors are shut (platform stop) — only when 2+ chefs can work both carriages. */
export function doorsShut(def: LevelDef, f: number, chefs: number): boolean {
  return chefs >= 2 && !!def.platform && inSpan(def.platform, f);
}

/** Train speed 0..1 (drives the window scenery and the clatter). */
export function trainSpeed(def: LevelDef, f: number): number {
  if (def.departs > 0 && f < def.departs) return (f / def.departs) ** 2;
  const p = def.platform;
  if (p) {
    const brake = 0.06;
    if (f >= p.from - brake && f < p.from) return (p.from - f) / brake;
    if (inSpan(p, f)) return 0;
    if (f >= p.to && f < p.to + brake) return (f - p.to) / brake;
  }
  return 1;
}

/** What the windows show. */
export function sceneryAt(def: LevelDef, f: number): Scenery {
  if (darkness(def, f) > 0.5) return "tunnel";
  if (def.departs > 0 && f < def.departs * 1.2) return "station";
  if (def.platform && f >= def.platform.from - 0.03 && f < def.platform.to + 0.03) return "platform";
  return "fields";
}

/** Points for 1, 2 and 3 stars: scaled to the level length and eased for a solo chef. */
export function starThresholds(seconds: number, chefs: number): [number, number, number] {
  const k = (seconds / 240) * (chefs <= 1 ? 0.7 : chefs === 2 ? 0.9 : 1);
  return [Math.max(3, Math.round(45 * k)), Math.max(6, Math.round(100 * k)), Math.max(10, Math.round(160 * k))];
}

export function starsFor(points: number, t: [number, number, number]): number {
  return points >= t[2] ? 3 : points >= t[1] ? 2 : points >= t[0] ? 1 : 0;
}
