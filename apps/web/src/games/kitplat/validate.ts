/**
 * kitplat/validate: checks a level before anyone plays it.
 *   - reachability: from the start, can a hero reach every checkpoint and the goal (or the boss)? Moves are found
 *     by simulating the REAL movement code (player.ts) from every standable spot with a set of inputs (walk, short
 *     hop, full jump, running jump; left and right), so a gap that needs a pixel-perfect jump shows up as a failure
 *     instead of a guess from jump formulas. Gates count as open (levers open them), springs launch, ladders climb,
 *     moving platforms carry you between their ends.
 *   - budgets: size, foes, gems and the tiles the view will draw (triangles), so every level fits a 1 GB TV.
 */
import { Collider } from "./collide";
import { DT, type Feel, launchSpeed } from "./feel";
import { type Level, type LevelDef, Tile, parseLevel } from "./level";
import { type PadInput, newMover, stepMover } from "./player";

export interface LevelReport {
  id: string;
  ok: boolean;
  problems: string[];
  nodes: number;
  reached: number;
  tiles: number;
  /** Triangles the tile layer costs (2 per drawn tile, plus decorations). */
  triangles: number;
}

export const LEVEL_BUDGET = { maxW: 420, maxH: 40, foes: 60, gems: 400, tiles: 6000, triangles: 14000 };

const key = (c: number, r: number) => r * 4096 + c;

function standable(col: Collider, c: number, r: number): boolean {
  if (col.solidAt(c, r) || col.solidAt(c, r + 1)) return false;
  const below = col.tile(c, r - 1);
  const here = col.tile(c, r);
  if (here === Tile.SlopeUp || here === Tile.SlopeDown) return true;
  return col.wall(below) || below === Tile.OneWay || (below === Tile.Ladder && here !== Tile.Ladder) || below === Tile.SlopeUp || below === Tile.SlopeDown;
}

interface Strategy { dir: number; run: boolean; jumpFrames: number; preRun: number }
const STRATS: Strategy[] = [];
for (const dir of [-1, 1]) {
  STRATS.push({ dir, run: true, jumpFrames: 0, preRun: 0 });           // walk / run off
  for (const jf of [4, 9, 60]) for (const pre of [0, 30]) STRATS.push({ dir, run: true, jumpFrames: jf, preRun: pre });
  STRATS.push({ dir, run: false, jumpFrames: 60, preRun: 0 });         // careful, slow full jump
}
STRATS.push({ dir: 0, run: false, jumpFrames: 60, preRun: 0 });        // straight up (ladders, springs)

/** Where a hero ends up from (x, y) with a strategy: every grounded cell it touched. */
function simulate(col: Collider, f: Feel, x: number, y: number, s: Strategy, springs: Set<number>, out: Set<number>) {
  const m = newMover(x, y);
  m.body.grounded = true;
  m.state = "ground";
  const inp: PadInput = { x: 0, y: 0, jump: false, jumpPressed: false, run: s.run, action: false };
  // a run-up: start at speed, as if the hero ran in from behind
  if (s.preRun) m.body.vx = s.dir * (s.run ? f.run : f.walk);
  let air = 0;
  for (let i = 0; i < 260; i++) {
    inp.x = s.dir;
    inp.jumpPressed = i === 0 && s.jumpFrames > 0;
    inp.jump = i < s.jumpFrames;
    stepMover(m, inp, f, col, DT);
    const b = m.body;
    if (b.y < -1) return;
    if (b.grounded) {
      const c = Math.floor(b.x), r = Math.round(b.y);
      out.add(key(c, r));
      if (springs.has(key(c, r))) {
        b.vy = launchSpeed(f.spring, f.gravity);
        m.launched = true;
        b.grounded = false;
        b.y += 0.7;
      }
      if (air > 2 || (s.jumpFrames === 0 && i > 50)) return;
    } else air++;
    if (Math.abs(b.vx) < 0.01 && b.grounded && i > 4) return;
  }
}

export function validateLevel(def: LevelDef, feel: Feel): LevelReport {
  const level: Level = parseLevel(def);
  const col = new Collider(level);
  col.gateOpen = [true, true];
  const problems: string[] = [];
  const nodes: Array<[number, number]> = [];
  for (let c = 0; c < level.w; c++) for (let r = 0; r < level.h; r++) if (standable(col, c, r)) nodes.push([c, r]);
  const springs = new Set<number>();
  const ladders: Array<[number, number]> = [];
  for (const e of level.entities) if (e.kind === "spring") springs.add(key(Math.floor(e.x), e.y));
  for (let c = 0; c < level.w; c++) for (let r = 0; r < level.h; r++) if (col.tile(c, r) === Tile.Ladder) ladders.push([c, r]);
  // moving platforms: stand-ins every tile along their travel (riding one takes you anywhere along it)
  let mi = 0;
  for (const e of level.entities) {
    if (e.kind !== "moverH" && e.kind !== "moverV") continue;
    const m = def.movers?.[mi++] ?? {};
    const travel = m.travel ?? 4, hw = (m.w ?? 3) / 2;
    for (let s = 0; s <= travel; s += 1) {
      col.platforms.push({ x: e.x + (e.kind === "moverH" ? s : 0), y: e.y + 1 + (e.kind === "moverV" ? s : 0), hw, dx: 0, dy: 0, active: true });
    }
  }
  const startKey = key(Math.floor(level.start.x), level.start.y);
  const seen = new Set<number>([startKey]);
  const queue: number[] = [startKey];
  const visit = (k: number) => { if (!seen.has(k)) { seen.add(k); queue.push(k); } };
  const out = new Set<number>();
  while (queue.length) {
    const k = queue.shift()!;
    const c = k % 4096, r = Math.floor(k / 4096);
    out.clear();
    for (const s of STRATS) simulate(col, feel, c + 0.5, r, s, springs, out);
    if (springs.has(k)) simulate(col, feel, c + 0.5, r + 0.7, { dir: 0, run: false, jumpFrames: 0, preRun: 0 }, new Set(), out);
    for (const o of out) visit(o);
    // ladders: a ladder you stand next to (or on) can be climbed to its top and bottom
    for (const [lc, lr] of ladders) {
      if (lc !== c || Math.abs(lr - r) > 1) continue;
      let top = lr, bot = lr;
      while (col.tile(lc, top + 1) === Tile.Ladder) top++;
      while (col.tile(lc, bot - 1) === Tile.Ladder) bot--;
      for (const rr of [top + 1, bot]) if (standable(col, lc, rr)) visit(key(lc, rr));
      for (let rr = bot; rr <= top + 1; rr++) for (const dc of [-1, 1]) if (standable(col, lc + dc, rr)) visit(key(lc + dc, rr));
    }
  }
  const reached = (x: number, y: number, rad = 1.5) => [...seen].some((k) => Math.abs((k % 4096) + 0.5 - x) <= rad && Math.abs(Math.floor(k / 4096) - y) <= rad);
  if (level.goal && !reached(level.goal.x, level.goal.y)) problems.push(`goal at (${level.goal.x - 0.5}, ${level.goal.y}) is not reachable`);
  const boss = level.entities.find((e) => e.kind === "boss");
  if (!level.goal && !boss) problems.push("no goal (G) and no boss (Z)");
  if (boss && !reached(boss.x, boss.y, 6)) problems.push("the boss arena is not reachable");
  for (const cp of level.entities.filter((e) => e.kind === "checkpoint")) {
    if (!reached(cp.x, cp.y)) problems.push(`checkpoint at (${cp.x - 0.5}, ${cp.y}) is not reachable`);
  }
  // budgets
  let tiles = 0;
  for (const t of level.tiles) if (t !== Tile.Empty) tiles++;
  const triangles = tiles * 2 + Math.round(level.w * 0.6) * 2;
  const foes = level.entities.filter((e) => ["walker", "hopper", "flyer", "curler"].includes(e.kind)).length;
  const gems = level.entities.filter((e) => e.kind === "gem" || e.kind === "biggem").length;
  const B = LEVEL_BUDGET;
  if (level.w > B.maxW || level.h > B.maxH) problems.push(`level is ${level.w}×${level.h}, budget ${B.maxW}×${B.maxH}`);
  if (foes > B.foes) problems.push(`${foes} foes, budget ${B.foes}`);
  if (gems > B.gems) problems.push(`${gems} gems, budget ${B.gems}`);
  if (tiles > B.tiles) problems.push(`${tiles} tiles, budget ${B.tiles}`);
  if (triangles > B.triangles) problems.push(`${triangles} tile triangles, budget ${B.triangles}`);
  if (def.time < 20) problems.push("less than 20 s on the clock");
  return { id: def.id, ok: problems.length === 0, problems, nodes: nodes.length, reached: seen.size, tiles, triangles };
}
