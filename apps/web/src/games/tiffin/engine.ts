/**
 * Tiffin Tornado: the whole match as a pure, fixed-step simulation. Three services (levels) on the kitchen
 * carriage, each: intro → countdown → service → level end (stars); then the results. No DOM, no three.js.
 *
 *   const m = newMatch(["p1", "p2"], { seed: 7, quick: true });
 *   const events = step(m, DT, inputs);       // inputs: Map<playerId, TiffinInput>, every 1/60 s
 */
import { type Item, RECIPES, type RecipeId, credit } from "./recipes";
import { LEVELS, type LevelDef, type Scenery, curveAhead, darkness, doorsShut, levelSeconds, sceneryAt, starThresholds, starsFor, swayAt, trainSpeed } from "./levels";
import { type Kitchen, burning, cellCentre, cellOf, parseKitchen, returnDirty, tickStations, tileAt, walkable } from "./kitchen";
import { type Chef, floorItemNear, moveChef, newChef, separate, spawnPoints, targetOf } from "./chefs";
import { type Verb, contextOf, perform } from "./interact";
import { type Order, type OrderBook, EXPIRE_PENALTY, newBook, serve, shares, tickOrders } from "./orders";
import { SWAY_ACCEL, slideItems } from "./sway";

export const DT = 1 / 60;

export interface TiffinInput {
  /** Movement, x right, z towards the camera (-1..1). */
  x: number;
  z: number;
  /** The action button was pressed (this step). */
  act: boolean;
  /** Extra work strokes this step (touchpad swipes / shakes at a chopping board, grinder or sink). */
  work: number;
  dash: boolean;
}
export const IDLE: TiffinInput = { x: 0, z: 0, act: false, work: 0, dash: false };

export type Phase = "intro" | "countdown" | "service" | "levelEnd" | "results";

export interface LevelResult { level: number; name: string; points: number; stars: number; served: number; expired: number; thresholds: [number, number, number] }

export type Ev =
  | { kind: "phase"; phase: Phase; level: number }
  | { kind: "act"; id: string; verb: Verb; perfect?: boolean; what?: string; c?: number; r?: number }
  | { kind: "dash"; id: string }
  | { kind: "serve"; id: string; recipe: RecipeId; points: number; tip: number; bonus: number; orderId: number }
  | { kind: "reject"; id: string }
  | { kind: "order"; order: Order }
  | { kind: "expire"; order: Order }
  | { kind: "station"; what: "done" | "burnt" | "fire" | "spread"; c: number; r: number; item?: string }
  | { kind: "fall"; item: string; x: number; z: number }
  | { kind: "bump"; x: number; z: number }
  | { kind: "curve"; dir: number }
  | { kind: "tunnel"; dark: boolean }
  | { kind: "doors"; shut: boolean };

export interface Match {
  quick: boolean;
  seed: number;
  ids: string[];
  levelIndex: number;
  level: LevelDef;
  seconds: number;
  /** Service seconds elapsed in this level. */
  t: number;
  phase: Phase;
  phaseT: number;
  kitchen: Kitchen;
  chefs: Chef[];
  book: OrderBook;
  levelPoints: number;
  teamPoints: number;
  served: number;
  expired: number;
  results: LevelResult[];
  sway: number;
  dark: number;
  speed: number;
  scenery: Scenery;
  /** Seconds until each served plate comes back dirty. */
  dirtyIn: number[];
  /** Distance the train has run (metres of scenery), for the window scroll. */
  run: number;
  rng: number;
  warnedCurve: number;
}

const PHASE_SECONDS = { intro: [6, 2], countdown: [3, 1], levelEnd: [7, 3] } as const;
const len = (m: Match, p: keyof typeof PHASE_SECONDS) => PHASE_SECONDS[p][m.quick ? 1 : 0];
const DIRTY_BACK = [9, 3];

export function rand(m: Match): number {
  // mulberry32
  let t = (m.rng = (m.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function newMatch(ids: string[], opts: { seed?: number; quick?: boolean; startLevel?: number } = {}): Match {
  const quick = !!opts.quick;
  const m = {
    quick, seed: opts.seed ?? 1, ids: [...ids], levelIndex: -1, results: [], teamPoints: 0, rng: opts.seed ?? 1, run: 0,
  } as unknown as Match;
  m.chefs = [];
  loadLevel(m, opts.startLevel ?? 0);
  return m;
}

/** Sets up level `i` (fresh kitchen and orders; the chefs keep their stats). */
export function loadLevel(m: Match, i: number) {
  const def = LEVELS[i]!;
  m.levelIndex = i;
  m.level = def;
  m.seconds = levelSeconds(m.quick);
  m.t = 0;
  m.phase = "intro";
  m.phaseT = 0;
  m.kitchen = parseKitchen(def.layout, 3 + m.ids.length);
  const spots = spawnPoints(m.kitchen, m.ids.length);
  const old = new Map(m.chefs.map((c) => [c.id, c]));
  m.chefs = m.ids.map((id, slot) => {
    const c = newChef(id, slot, spots[slot]!.x, spots[slot]!.z);
    const prev = old.get(id);
    if (prev) c.stats = prev.stats;
    return c;
  });
  m.book = newBook(m.quick ? 0.6 : 1.5);
  m.levelPoints = 0;
  m.served = 0;
  m.expired = 0;
  m.dirtyIn = [];
  m.sway = 0;
  m.dark = 0;
  m.speed = def.departs > 0 ? 0 : 1;
  m.scenery = sceneryAt(def, 0);
  m.warnedCurve = -1;
}

export function stars(m: Match): [number, number, number] {
  return starThresholds(m.seconds, m.ids.length);
}

/** One fixed step. Inputs for missing players count as idle. */
export function step(m: Match, dt: number, inputs: Map<string, TiffinInput>): Ev[] {
  const ev: Ev[] = [];
  m.phaseT += dt;
  m.run += m.speed * dt * 14;
  if (m.phase === "intro" && m.phaseT >= len(m, "intro")) setPhase(m, "countdown", ev);
  else if (m.phase === "countdown" && m.phaseT >= len(m, "countdown")) setPhase(m, "service", ev);
  else if (m.phase === "levelEnd" && m.phaseT >= len(m, "levelEnd")) {
    if (m.levelIndex + 1 < LEVELS.length) {
      loadLevel(m, m.levelIndex + 1);
      ev.push({ kind: "phase", phase: "intro", level: m.levelIndex });
    } else setPhase(m, "results", ev);
  }
  if (m.phase === "service") service(m, dt, inputs, ev);
  else if (m.phase === "countdown" || m.phase === "intro") {
    // chefs may wander about during the countdown; nothing cooks yet
    for (const c of m.chefs) {
      const inp = inputs.get(c.id) ?? IDLE;
      if (m.phase === "countdown") moveChef(m.kitchen, c, { x: inp.x, z: inp.z, dash: false }, dt);
    }
  }
  return ev;
}

function setPhase(m: Match, p: Phase, ev: Ev[]) {
  m.phase = p;
  m.phaseT = 0;
  if (p === "levelEnd") {
    const th = stars(m);
    m.results.push({ level: m.level.id, name: m.level.name, points: m.levelPoints, stars: starsFor(m.levelPoints, th), served: m.served, expired: m.expired, thresholds: th });
    for (const c of m.chefs) c.holding = null;
  }
  ev.push({ kind: "phase", phase: p, level: m.levelIndex });
}

function service(m: Match, dt: number, inputs: Map<string, TiffinInput>, ev: Ev[]) {
  const k = m.kitchen, def = m.level;
  m.t += dt;
  const f = Math.min(1, m.t / m.seconds);
  const sway = swayAt(def, f);
  const ahead = curveAhead(def, f, m.seconds);
  const curveIx = def.curves.findIndex((c) => f >= c.from - 0.2 && f < c.to);
  if (ahead && curveIx !== m.warnedCurve) {
    m.warnedCurve = curveIx;
    ev.push({ kind: "curve", dir: def.curves[curveIx]?.dir ?? 1 });
  }
  m.sway = sway;
  const dark = darkness(def, f);
  if ((dark > 0.5) !== (m.dark > 0.5)) ev.push({ kind: "tunnel", dark: dark > 0.5 });
  m.dark = dark;
  m.speed = trainSpeed(def, f);
  m.scenery = sceneryAt(def, f);
  const shut = doorsShut(def, f, m.chefs.length);
  if (shut !== k.doorsShut) {
    k.doorsShut = shut;
    ev.push({ kind: "doors", shut });
    if (shut) for (const c of m.chefs) evictFromGangway(k, c);
  }

  for (const c of m.chefs) {
    const inp = inputs.get(c.id) ?? IDLE;
    if (moveChef(k, c, { x: inp.x, z: inp.z, dash: inp.dash }, dt, sway * SWAY_ACCEL * 0.35)) {
      c.stats.dashes++;
      ev.push({ kind: "dash", id: c.id });
    }
    if (inp.act) act(m, c, 1, ev);
    else if (inp.work > 0) {
      const target = targetOf(k, c);
      const verb = contextOf(k, c, target, -1, def.menu);
      if (verb === "chop" || verb === "grind" || verb === "wash") act(m, c, inp.work, ev);
    }
  }
  separate(m.chefs, k);

  for (const s of tickStations(k, dt, () => rand(m))) {
    ev.push({ kind: "station", what: s.kind, c: s.c, r: s.r, item: s.what });
    if (s.kind === "burnt") {
      const who = tileAt(k, s.c, s.r)?.item?.by ?? [];
      for (const id of who) { const ch = m.chefs.find((x) => x.id === id); if (ch) ch.stats.burnt++; }
    }
  }
  for (const s of slideItems(k, sway, dt)) {
    if (s.kind === "fall") {
      ev.push({ kind: "fall", item: s.item.kind, x: s.x, z: s.z });
      if (s.item.kind === "plate" || s.item.kind === "dirty") blameDrop(m, s.item);
    } else ev.push({ kind: "bump", x: s.x, z: s.z });
  }

  for (const o of tickOrders(m.book, { menu: def.menu, opening: def.opening, every: scaleEvery(m), timeScale: m.quick ? 0.5 : 1, maxOpen: 3 + Math.min(2, m.ids.length - 1) }, dt, () => rand(m))) {
    if (o.kind === "order") ev.push({ kind: "order", order: o.order });
    else {
      m.expired++;
      m.levelPoints = Math.max(0, m.levelPoints - EXPIRE_PENALTY);
      ev.push({ kind: "expire", order: o.order });
    }
  }
  m.dirtyIn = m.dirtyIn.map((x) => x - dt);
  const back = m.dirtyIn.filter((x) => x <= 0).length;
  if (back) {
    returnDirty(k, back);
    m.dirtyIn = m.dirtyIn.filter((x) => x > 0);
  }
  if (m.t >= m.seconds) setPhase(m, "levelEnd", ev);
}

function scaleEvery(m: Match): [number, number] {
  const [lo, hi] = m.level.orderEvery;
  const solo = m.ids.length <= 1 ? 1.35 : m.ids.length === 2 ? 1.1 : 1;
  const q = m.quick ? 0.35 : 1;
  return [lo * solo * q, hi * solo * q];
}

function act(m: Match, c: Chef, strokes: number, ev: Ev[]) {
  const k = m.kitchen;
  const target = targetOf(k, c);
  const fi = target ? -1 : floorItemNear(k, c);
  const held = c.holding;
  const done = perform(k, c, target, fi, m.level.menu, strokes, { x: c.x + c.fx * 0.45, z: c.z + c.fz * 0.45 });
  c.sinceAct = 0;
  if (done.verb === "none") return;
  if (done.verb === "serve") return serveAt(m, c, ev);
  const s = c.stats;
  if (done.verb === "chop" || done.verb === "grind" || done.verb === "wash") {
    c.sinceWork = 0;
    if (done.what === "chutney") s.chutneys++;
    if (done.what === "cutveg") s.chops++;
    if (done.verb === "wash" && done.what === "plate") s.washed++;
  }
  if (done.verb === "flip") {
    s.flips++;
    if (done.perfect) s.perfectFlips++;
  }
  if (done.verb === "douse") s.doused++;
  if (done.verb === "trash") s.trashed++;
  if (done.verb === "drop" && held && (held.kind === "plate" || held.kind === "dirty")) s.drops++;
  ev.push({ kind: "act", id: c.id, verb: done.verb, perfect: done.perfect, what: done.what, c: target?.c, r: target?.r });
}

function serveAt(m: Match, c: Chef, ev: Ev[]) {
  const it = c.holding!;
  const got = serve(m.book, it);
  if (!got) {
    ev.push({ kind: "reject", id: c.id });
    return;
  }
  const total = got.points + got.tip + got.bonus;
  credit(it, c.id);
  for (const [id, pts] of shares(total, it.by, c.id)) {
    const ch = m.chefs.find((x) => x.id === id);
    if (ch) ch.stats.points += pts;
  }
  c.stats.serves++;
  if (it.kind === "coffee") c.stats.coffees++;
  else m.dirtyIn.push(DIRTY_BACK[m.quick ? 1 : 0]!);
  c.holding = null;
  m.levelPoints += total;
  m.teamPoints += total;
  m.served++;
  ev.push({ kind: "serve", id: c.id, recipe: got.order.recipe, points: got.points, tip: got.tip, bonus: got.bonus, orderId: got.order.id });
}

function blameDrop(m: Match, it: Item) {
  const id = it.by[it.by.length - 1];
  const ch = m.chefs.find((x) => x.id === id);
  if (ch) ch.stats.drops++;
}

/** When the gangway doors shut, anyone standing in the doorway steps back into a carriage. */
function evictFromGangway(k: Kitchen, c: Chef) {
  const { c: cc, r: rr } = cellOf(k, c.x, c.z);
  if (tileAt(k, cc, rr)?.code !== "|") return;
  for (const dc of c.vx >= 0 ? [1, -1] : [-1, 1]) {
    if (walkable(k, cc + dc, rr)) {
      const p = cellCentre(k, cc + dc, rr);
      c.x = p.x;
      c.z = p.z;
      return;
    }
  }
}

/** The action button's verb for a chef right now (the phone shows it as an icon). */
export function verbFor(m: Match, id: string): Verb {
  const c = m.chefs.find((x) => x.id === id);
  if (!c || m.phase !== "service") return "none";
  const target = targetOf(m.kitchen, c);
  return contextOf(m.kitchen, c, target, target ? -1 : floorItemNear(m.kitchen, c), m.level.menu);
}

export function fires(m: Match) {
  return burning(m.kitchen);
}

export function recipeName(id: RecipeId) {
  return RECIPES[id].name;
}
