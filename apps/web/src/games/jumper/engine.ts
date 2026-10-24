/**
 * Tilt Jumper Worlds: the rules as a pure module (no DOM). Each player climbs their own copy of the same
 * seeded tower. World units: x in [0, COL_W) and wraps around the column edges, y is height (up), 10 units = 1 m.
 * The hero bounces by itself; the player only steers left/right and fires a stored power-up.
 */
export const COL_W = 400;
export const GRAVITY = 1500;
export const BOUNCE_V = 900;            // a normal bounce rises 270 units (27 m)
export const SPRING_V = 1500;           // a spring rises 750 units
export const ROCKET_V = 1050;
export const ROCKET_T = 2.2;
export const SHIELD_T = 9;
export const MAX_VX = 430;
export const HERO_R = 18;               // body radius; hero.y is the feet
export const FOOT = 14;                 // half the width of the feet, for landing
/** The largest vertical gap between two platforms the hero can stand on (a bounce rises 270). */
export const MAX_GAP = 205;
export const UNITS_PER_M = 10;
/** Height (m) where each world begins: Meadow, Sunset Canyon, Crystal Night, Star Station. */
export const WORLD_AT = [0, 250, 600, 1100];
export const WORLD_NAMES = ["Meadow Hills", "Sunset Canyon", "Crystal Night", "Star Station"];
export const POINTS = { gem: 10, stomp: 50, spare: 30, smash: 40 };

export type PlatformKind = "normal" | "moving" | "breaking" | "spring";
export interface Platform {
  id: number; kind: PlatformKind; x: number; y: number; w: number;
  x0: number; range: number; speed: number; phase: number;
  broken: boolean; fall: number; boing: number;
}
export type EnemyKind = "spikeling" | "glooper";
export interface Enemy { id: number; kind: EnemyKind; x: number; y: number; x0: number; y0: number; range: number; speed: number; t: number; r: number; alive: boolean }
export type PowerKind = "rocket" | "shield";
export interface Pickup { id: number; kind: "gem" | PowerKind; x: number; y: number; taken: boolean }
export interface Hero {
  x: number; y: number; vx: number; vy: number;
  alive: boolean; stunned: boolean; stored: PowerKind | null;
  rocketT: number; shieldT: number; squash: number; face: 1 | -1;
}
export type JumperEvent =
  | { kind: "bounce" | "spring" | "break" | "stomp" | "smash" | "hit" | "fell"; id: string; x: number; y: number }
  | { kind: "gem" | "pickup" | "spare"; id: string; x: number; y: number; item: Pickup["kind"] }
  | { kind: "power"; id: string; x: number; y: number; power: PowerKind }
  | { kind: "world"; id: string; x: number; y: number; world: number };

export interface World {
  id: string;
  rng: number;
  viewH: number;
  hero: Hero;
  platforms: Platform[];
  enemies: Enemy[];
  pickups: Pickup[];
  camY: number;
  maxY: number;
  points: number;
  world: number;
  time: number;
  /** When the run ended (s), or null while climbing. */
  endedAt: number | null;
  bounces: number;
  powersUsed: number;
  /** Height of the last platform bounced on (for the e2e bot's "next platform" hint). */
  lastLandY: number;
  genY: number;
  lastPowerY: number;
  lastEnemyY: number;
  lastX: number;
  nextId: number;
}

export interface JumperInput { x: number; power: boolean }

// ---- helpers ---------------------------------------------------------------------------

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const wrap = (x: number) => ((x % COL_W) + COL_W) % COL_W;
/** Signed shortest horizontal distance from a to b across the wrapping column. */
export function wrapDx(a: number, b: number) {
  let d = wrap(b - a);
  if (d > COL_W / 2) d -= COL_W;
  return d;
}
/** mulberry32: small, fast, seedable. The state lives in the world so a run replays exactly. */
function rand(w: World) {
  w.rng = (w.rng + 0x6d2b79f5) | 0;
  let t = w.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
/** 0 at the start, 1 from 900 m up. */
export const difficulty = (y: number) => clamp(y / 9000, 0, 1);
export const heightM = (w: World) => Math.floor(Math.max(0, w.maxY) / UNITS_PER_M);
export const score = (w: World) => heightM(w) + w.points;
export function worldIndex(m: number) {
  let i = 0;
  while (i + 1 < WORLD_AT.length && m >= WORLD_AT[i + 1]!) i++;
  return i;
}
/** Players tilting or using the touchpad rarely reach full deflection; give them a little more reach. */
export function steerGain(mode: string) {
  return mode === "motion" ? 1.25 : mode === "touchpad" ? 1.3 : mode === "hybrid" ? 1.2 : 1;
}

// ---- generation ------------------------------------------------------------------------

function addPlatform(w: World, kind: PlatformKind, x: number, y: number, width: number): Platform {
  const p: Platform = { id: w.nextId++, kind, x: wrap(x), y, w: width, x0: wrap(x), range: 0, speed: 0, phase: 0, broken: false, fall: 0, boing: 0 };
  if (kind === "moving") {
    p.range = 50 + rand(w) * 70;
    p.speed = 1.1 + rand(w) * 1.1 + difficulty(y) * 0.6;
    p.phase = rand(w) * Math.PI * 2;
  }
  w.platforms.push(p);
  return p;
}

/** An x far from both given positions (so enemies never sit on the way between two platforms). */
function awayFrom(w: World, a: number, b: number) {
  let best = 0, bestD = -1;
  for (let i = 0; i < 8; i++) {
    const x = rand(w) * COL_W;
    const d = Math.min(Math.abs(wrapDx(x, a)), Math.abs(wrapDx(x, b)));
    if (d > bestD) { bestD = d; best = x; }
  }
  return best;
}

/**
 * Builds the tower up to `upTo`. Every "solid" platform (normal, moving, spring) is at most MAX_GAP above the
 * previous one, so the climb is always possible; breaking platforms are extra decoys in between.
 */
function generate(w: World, upTo: number) {
  while (w.genY < upTo) {
    const d = difficulty(w.genY);
    const minGap = 55 + 55 * d, maxGap = Math.min(MAX_GAP, 115 + 90 * d);
    const gap = minGap + rand(w) * (maxGap - minGap);
    const y = w.genY + gap;
    const width = 92 - 26 * d + rand(w) * 14;
    if (gap > 95 && rand(w) < 0.14 + 0.26 * d) addPlatform(w, "breaking", rand(w) * COL_W, w.genY + gap * (0.4 + rand(w) * 0.2), width);
    const r = rand(w);
    const kind: PlatformKind = r < 0.07 ? "spring" : r < 0.07 + 0.1 + 0.3 * d ? "moving" : "normal";
    // the next platform lands somewhere new, but within a comfortable reach of the last one
    const x = wrap(w.lastX + (rand(w) - 0.5) * COL_W * (0.55 + 0.4 * d));
    addPlatform(w, kind, x, y, width);
    if (y - w.lastPowerY > 700 + rand(w) * 500 && kind !== "moving") {
      w.lastPowerY = y;
      w.pickups.push({ id: w.nextId++, kind: rand(w) < 0.5 ? "rocket" : "shield", x, y: y + 48, taken: false });
    } else if (rand(w) < 0.3) {
      w.pickups.push({ id: w.nextId++, kind: "gem", x: wrap(x + (rand(w) - 0.5) * 60), y: y + 46 + rand(w) * 50, taken: false });
    }
    if (y > 900 && y - w.lastEnemyY > 1150 - 600 * d + rand(w) * 350) {
      w.lastEnemyY = y;
      const kindE: EnemyKind = rand(w) < 0.55 ? "spikeling" : "glooper";
      const ex = awayFrom(w, w.lastX, x);
      const ey = y - gap * 0.5;
      w.enemies.push({ id: w.nextId++, kind: kindE, x: ex, y: ey, x0: ex, y0: ey, range: kindE === "glooper" ? 60 : 25, speed: kindE === "glooper" ? 1.3 : 2.2, t: rand(w) * 6, r: kindE === "glooper" ? 24 : 20, alive: true });
    }
    w.lastX = x;
    w.genY = y;
  }
}

function prune(w: World) {
  const below = w.camY - 250;
  let n = 0;
  for (const p of w.platforms) if (p.y > below) w.platforms[n++] = p;
  w.platforms.length = n;
  n = 0;
  for (const e of w.enemies) if (e.alive && e.y0 > below) w.enemies[n++] = e;
  w.enemies.length = n;
  n = 0;
  for (const k of w.pickups) if (!k.taken && k.y > below) w.pickups[n++] = k;
  w.pickups.length = n;
}

export function newWorld(id: string, seed: number, viewH: number): World {
  const w: World = {
    id, rng: seed | 0, viewH,
    hero: { x: COL_W / 2, y: 0, vx: 0, vy: BOUNCE_V, alive: true, stunned: false, stored: "rocket", rocketT: 0, shieldT: 0, squash: 0, face: 1 },
    platforms: [], enemies: [], pickups: [],
    camY: -80, maxY: 0, points: 0, world: 0, time: 0, endedAt: null, bounces: 0, powersUsed: 0, lastLandY: 0,
    genY: 0, lastPowerY: 0, lastEnemyY: 0, lastX: COL_W / 2, nextId: 1,
  };
  // the launch pad: the whole width, so nobody falls in the first second
  const ground = addPlatform(w, "normal", COL_W / 2, 0, COL_W * 2);
  ground.x0 = ground.x;
  generate(w, viewH + 400);
  return w;
}

// ---- simulation --------------------------------------------------------------------------

function usePower(w: World, ev: JumperEvent[]) {
  const h = w.hero;
  if (!h.stored || h.stunned) return;
  const power = h.stored;
  h.stored = null;
  w.powersUsed++;
  if (power === "rocket") {
    h.rocketT = ROCKET_T;
    h.vy = Math.max(h.vy, ROCKET_V);
  } else h.shieldT = SHIELD_T;
  ev.push({ kind: "power", id: w.id, x: h.x, y: h.y, power });
}

/** Advances one player's run by `dt` seconds. Events are appended to `ev`. */
export function stepWorld(w: World, dt: number, input: JumperInput, ev: JumperEvent[]) {
  const h = w.hero;
  if (!h.alive) return;
  w.time += dt;
  if (input.power) usePower(w, ev);

  // steering: the hero eases towards the speed the player asks for
  const target = clamp(input.x, -1, 1) * MAX_VX;
  h.vx += (target - h.vx) * Math.min(1, dt * 10);
  if (h.vx > 25) h.face = 1;
  else if (h.vx < -25) h.face = -1;
  h.x = wrap(h.x + h.vx * dt);

  const prevY = h.y;
  if (h.rocketT > 0) {
    h.rocketT -= dt;
    h.vy = Math.max(h.vy, ROCKET_V);
  } else h.vy -= GRAVITY * dt;
  h.y += h.vy * dt;
  if (h.shieldT > 0) h.shieldT = Math.max(0, h.shieldT - dt);
  h.squash = Math.max(0, h.squash - dt * 4);

  for (const p of w.platforms) {
    if (p.kind === "moving") {
      p.phase += p.speed * dt;
      p.x = wrap(p.x0 + Math.sin(p.phase) * p.range);
    }
    if (p.broken) {
      p.fall += 1400 * dt;
      p.y -= p.fall * dt;
    }
    if (p.boing > 0) p.boing = Math.max(0, p.boing - dt * 3);
  }

  // landing: only while falling, when the feet cross a platform's top this step
  if (h.vy < 0 && !h.stunned && h.rocketT <= 0) {
    for (const p of w.platforms) {
      if (p.broken || prevY < p.y || h.y > p.y) continue;
      if (Math.abs(wrapDx(h.x, p.x)) > p.w / 2 + FOOT) continue;
      if (p.kind === "breaking") {
        p.broken = true;
        ev.push({ kind: "break", id: w.id, x: p.x, y: p.y });
        continue; // it crumbles: the hero keeps falling
      }
      h.y = p.y;
      h.vy = p.kind === "spring" ? SPRING_V : BOUNCE_V;
      h.squash = 1;
      p.boing = 1;
      w.bounces++;
      w.lastLandY = p.y;
      ev.push({ kind: p.kind === "spring" ? "spring" : "bounce", id: w.id, x: p.x, y: p.y });
      break;
    }
  }

  for (const e of w.enemies) {
    if (!e.alive) continue;
    e.t += dt;
    e.x = wrap(e.x0 + Math.sin(e.t * e.speed) * e.range);
    e.y = e.y0 + Math.sin(e.t * (e.kind === "glooper" ? 1.7 : 3.1)) * (e.kind === "glooper" ? 14 : 6);
    if (h.stunned) continue;
    const dx = wrapDx(h.x, e.x), dy = h.y + HERO_R - e.y;
    const reach = HERO_R + e.r - 5;
    if (dx * dx + dy * dy > reach * reach) continue;
    if (h.rocketT > 0 || h.shieldT > 0) {
      e.alive = false;
      w.points += POINTS.smash;
      if (h.rocketT <= 0) h.shieldT = 0; // a shield takes one hit
      ev.push({ kind: "smash", id: w.id, x: e.x, y: e.y });
    } else if (h.vy < 0 && h.y > e.y - e.r * 0.2) {
      e.alive = false;
      w.points += POINTS.stomp;
      h.vy = BOUNCE_V * 1.1;
      h.squash = 1;
      ev.push({ kind: "stomp", id: w.id, x: e.x, y: e.y });
    } else {
      h.stunned = true;
      h.vy = Math.min(h.vy, 150);
      ev.push({ kind: "hit", id: w.id, x: h.x, y: h.y });
    }
  }

  if (!h.stunned) {
    for (const k of w.pickups) {
      if (k.taken) continue;
      const dx = wrapDx(h.x, k.x), dy = h.y + HERO_R - k.y;
      if (dx * dx + dy * dy > 36 * 36) continue;
      k.taken = true;
      if (k.kind === "gem") {
        w.points += POINTS.gem;
        ev.push({ kind: "gem", id: w.id, x: k.x, y: k.y, item: "gem" });
      } else if (!h.stored) {
        h.stored = k.kind;
        ev.push({ kind: "pickup", id: w.id, x: k.x, y: k.y, item: k.kind });
      } else {
        w.points += POINTS.spare; // the slot is full: a spare power-up is worth points
        ev.push({ kind: "spare", id: w.id, x: k.x, y: k.y, item: k.kind });
      }
    }
  }

  if (h.y > w.maxY && !h.stunned) {
    w.maxY = h.y;
    const wi = worldIndex(heightM(w));
    if (wi > w.world) {
      w.world = wi;
      ev.push({ kind: "world", id: w.id, x: h.x, y: h.y, world: wi });
    }
  }
  w.camY = Math.max(w.camY, h.y - w.viewH * 0.42);
  if (h.y < w.camY - 60) {
    h.alive = false;
    w.endedAt = w.time;
    ev.push({ kind: "fell", id: w.id, x: h.x, y: h.y });
    return;
  }
  generate(w, w.camY + w.viewH + 400);
  prune(w);
}

/** The x of the next platform worth aiming for (a hint for tests and the attract-mode bot). */
export function nextTarget(w: World): number | null {
  const h = w.hero;
  const up = Math.max(0, h.vy);
  const apex = h.y + (up * up) / (2 * GRAVITY);
  let best: Platform | null = null;
  for (const p of w.platforms) {
    // the highest platform the hero can still reach on this bounce, above the bottom of the screen
    if (p.broken || p.kind === "breaking" || p.y > apex - 15 || p.y < w.camY + 10) continue;
    if (h.vy < 0 && p.y > h.y) continue;
    if (!best || p.y > best.y) best = p;
  }
  return best ? best.x : null;
}

// ---- the match ---------------------------------------------------------------------------

export interface Match { worlds: World[]; time: number; limit: number; over: boolean }

/** Every player climbs the same tower (same seed), each in their own column. */
export function newMatch(ids: string[], seed: number, viewH: number, limit: number): Match {
  return { worlds: ids.map((id) => newWorld(id, seed, viewH)), time: 0, limit, over: false };
}

/** One fixed step for everyone. The match ends when all have fallen or the time is up. */
export function stepMatch(m: Match, dt: number, input: (id: string) => JumperInput, ev: JumperEvent[]) {
  if (m.over) return;
  m.time += dt;
  for (const w of m.worlds) stepWorld(w, dt, input(w.id), ev);
  if (m.time >= m.limit || m.worlds.every((w) => !w.hero.alive)) {
    m.over = true;
    for (const w of m.worlds) if (w.endedAt === null) w.endedAt = w.time;
  }
}

export function scores(m: Match): Map<string, number> {
  return new Map(m.worlds.map((w) => [w.id, score(w)]));
}
