/**
 * Kart Knockout race simulation: top-down arcade karts on one shared screen. Pure and deterministic (seeded):
 * physics with grip and drifting, walls, kart-to-kart bumps, laps checked by in-order checkpoints (so cutting
 * across the grass never counts), item boxes, a catch-up rule, finish order and standings.
 * Units: stage pixels and seconds; heading `a` in radians, screen coordinates (y down).
 */
import { nearest, pointAt, project, type Track } from "./track";
import { pickupBoxes, rollItem, stepHazards, useItem, type ItemKind } from "./items";
import { drive } from "./cpu";

export type { ItemKind } from "./items";

export const KART_R = 13;
export const VMAX = 230;
const ACCEL = 330;
const COAST = 1.3;           // exponential slow-down per second without gas
const TURN = 3.0;            // rad/s at speed
const DRIFT_TURN = 3.7;
const GRIP = 12;
const DRIFT_GRIP = 3.5;
const OFFROAD = 0.5;
export const BOOST = 1.45;
export const SPIN = 1.0;
/** Drift charge (seconds of good drifting) for a small and a big spark boost. */
export const DRIFT_T1 = 0.55, DRIFT_T2 = 1.3;
const CATCH_UP = 0.12;       // up to 12% more top speed when far behind the leader
const CPU_PACE = 0.9;
const BACK = 200;            // px behind the last checkpoint still counted as "just behind it"

export interface KartInput { steer: number; gas: boolean; drift: boolean; item: boolean }
export const IDLE: KartInput = { steer: 0, gas: false, drift: false, item: false };

export interface Kart {
  id: string;
  cpu: boolean;
  slot: number;
  x: number; y: number; a: number; vx: number; vy: number;
  /** Smoothed steering in [-1, 1]. */
  steer: number;
  /** 0, or the drift direction (-1 left, 1 right) while drifting. */
  drift: number;
  driftT: number;
  boostT: number;
  spinT: number;
  shieldT: number;
  hopT: number;
  item: ItemKind | null;
  itemN: number;
  /** Item roulette still spinning (the item can't be used yet). */
  rollT: number;
  idx: number;
  /** Checkpoints passed this lap (0 = only the start line). */
  cp: number;
  /** Completed laps. */
  lap: number;
  /** Race distance for ranking (laps × length + valid progress this lap). */
  dist: number;
  missed: boolean;
  /** Signed progress past the last checkpoint at the previous step (to see which way it was crossed). */
  prevD: number;
  offroad: boolean;
  finishedAt: number | null;
  catchUp: number;
  prevItem: boolean;
  /** ITEM was pressed while the roulette was still spinning: use it as soon as it stops. */
  itemQueued: boolean;
  wallCd: number;
  bumpCd: number;
  padCd: number;
  lastHitBy: string | null;
  ai: KartInput;
  aiSeed: number;
  stats: { drifts: number; boosts: number; items: number; hits: number; pickups: number };
}

export interface Box { x: number; y: number; t: number }
export interface Puddle { x: number; y: number; life: number; owner: string; on: boolean }
export interface Ball { x: number; y: number; vx: number; vy: number; life: number; owner: string; on: boolean }

export type RaceEvent =
  | { kind: "go" }
  | { kind: "lap"; id: string; lap: number }
  | { kind: "finish"; id: string; place: number }
  | { kind: "pickup"; id: string; item: ItemKind }
  | { kind: "use"; id: string; item: ItemKind }
  | { kind: "spin"; id: string; by: string | null; cause: "puddle" | "coconut" | "bumper" }
  | { kind: "blocked"; id: string }
  | { kind: "hop"; id: string }
  | { kind: "drift-boost"; id: string; tier: 1 | 2 }
  | { kind: "pad"; id: string }
  | { kind: "bump"; a: string; b: string; hard: boolean }
  | { kind: "wall"; id: string }
  | { kind: "missed"; id: string }
  | { kind: "done" };

export interface Race {
  track: Track;
  laps: number;
  karts: Kart[];
  /** Karts by current position (1st first). */
  order: Kart[];
  boxes: Box[];
  puddles: Puddle[];
  balls: Ball[];
  time: number;
  phase: "countdown" | "race" | "done";
  countdown: number;
  finishOrder: string[];
  firstFinish: number | null;
  /** Seconds the others get after the winner finishes. */
  grace: number;
  seed: number;
  events: RaceEvent[];
}

export function rnd(r: Race) {
  r.seed = (Math.imul(r.seed, 1664525) + 1013904223) >>> 0;
  return r.seed / 4294967296;
}

export function newRace(track: Track, entrants: Array<{ id: string; cpu: boolean }>, opts: { laps?: number; seed?: number; countdown?: number; grace?: number } = {}): Race {
  const karts: Kart[] = entrants.map((e, i) => {
    const row = Math.floor(i / 2);
    const p = pointAt(track, -34 - row * 34 - (i % 2) * 12, (i % 2 ? 0.45 : -0.45) * track.hw);
    const idx = nearest(track, p.x, p.y);
    return {
      id: e.id, cpu: e.cpu, slot: i, x: p.x, y: p.y, a: p.a, vx: 0, vy: 0, steer: 0, drift: 0, driftT: 0, boostT: 0,
      spinT: 0, shieldT: 0, hopT: 0, item: null, itemN: 0, rollT: 0, idx, cp: 0, lap: 0, dist: 0, missed: false, prevD: -100,
      offroad: false, finishedAt: null, catchUp: 1, prevItem: false, itemQueued: false, wallCd: 0, bumpCd: 0, padCd: 0, lastHitBy: null,
      ai: { ...IDLE }, aiSeed: i * 7919 + 13, stats: { drifts: 0, boosts: 0, items: 0, hits: 0, pickups: 0 },
    };
  });
  const r: Race = {
    track, laps: opts.laps ?? 3, karts, order: karts.slice(), boxes: track.boxes.map((b) => ({ x: b.x, y: b.y, t: 0 })),
    puddles: [], balls: [], time: 0, phase: "countdown", countdown: opts.countdown ?? 3, finishOrder: [], firstFinish: null,
    grace: opts.grace ?? 18, seed: (opts.seed ?? 1) >>> 0, events: [],
  };
  for (const k of karts) progress(r, k);
  rank(r);
  return r;
}

const sectorLen = (r: Race) => r.track.len / r.track.def.cps;

/** Checkpoints in order, laps, and the race distance used for positions. */
function progress(r: Race, k: Kart) {
  const t = r.track, L = t.len, sec = sectorLen(r), K = t.def.cps;
  const s = project(t, k.idx, k.x, k.y).s;
  for (let guard = 0; guard < 3; guard++) {
    const d = (s - k.cp * sec + L) % L;
    if (d >= L - BACK) {               // just behind the last checkpoint (on the grid, or reversing)
      k.prevD = d - L;
      k.dist = k.lap * L + k.cp * sec + (d - L);
      return;
    }
    // reached the next checkpoint in order, driving forwards (reversing into the window never counts)
    if (d >= sec && d < sec * 1.6 && k.prevD < sec) {
      k.missed = false;
      k.prevD = d - sec;
      if (k.cp === K - 1) {
        k.cp = 0;
        k.lap++;
        if (k.finishedAt === null) r.events.push({ kind: "lap", id: k.id, lap: k.lap });
        if (k.lap >= r.laps && k.finishedAt === null) {
          k.finishedAt = r.time;
          r.firstFinish ??= r.time;
          r.finishOrder.push(k.id);
          r.events.push({ kind: "finish", id: k.id, place: r.finishOrder.length });
        }
      } else k.cp++;
      continue;
    }
    k.prevD = d;
    if (d >= sec) {                    // skipped a checkpoint: no credit past the one it missed
      if (!k.missed) r.events.push({ kind: "missed", id: k.id });
      k.missed = true;
      k.dist = k.lap * L + k.cp * sec + sec * 0.99;
      return;
    }
    k.dist = k.lap * L + k.cp * sec + d;
    return;
  }
}

function rank(r: Race) {
  r.order.sort((a, b) => {
    if (a.finishedAt !== null && b.finishedAt !== null) return a.finishedAt - b.finishedAt;
    if (a.finishedAt !== null) return -1;
    if (b.finishedAt !== null) return 1;
    return b.dist - a.dist;
  });
}

/** Position of a kart (1 = leading). */
export function placeOf(r: Race, id: string) {
  return r.order.findIndex((k) => k.id === id) + 1;
}

function physics(r: Race, k: Kart, inp: KartInput, dt: number) {
  const t = r.track;
  const spinning = k.spinT > 0;
  if (spinning) {
    k.spinT -= dt;
    k.a += ((Math.PI * 2) / SPIN) * dt;
    k.drift = 0;
  }
  const want = spinning ? 0 : Math.max(-1, Math.min(1, inp.steer));
  k.steer += (want - k.steer) * Math.min(1, dt * 12);
  let ca = Math.cos(k.a), sa = Math.sin(k.a);
  let f = k.vx * ca + k.vy * sa;
  // drifting: start with DRIFT while turning at speed, release for a spark boost
  if (!spinning && !k.drift && inp.drift && Math.abs(k.steer) > 0.3 && f > VMAX * 0.4) {
    k.drift = Math.sign(k.steer);
    k.driftT = 0;
    k.hopT = 0.2;
    r.events.push({ kind: "hop", id: k.id });
  } else if (k.drift && (!inp.drift || Math.hypot(k.vx, k.vy) < VMAX * 0.3)) {
    const tier = k.driftT >= DRIFT_T2 ? 2 : k.driftT >= DRIFT_T1 ? 1 : 0;
    if (tier) {
      k.boostT = Math.max(k.boostT, tier === 2 ? 1.1 : 0.6);
      k.stats.boosts++;
      r.events.push({ kind: "drift-boost", id: k.id, tier });
    }
    k.stats.drifts++;
    k.drift = 0;
  }
  if (k.drift) k.driftT += dt * (0.5 + 0.5 * Math.max(0, k.steer * k.drift));
  k.hopT = Math.max(0, k.hopT - dt);
  // turn (less at low speed, reversed when rolling backwards; with gas a stopped kart can still turn on the spot,
  // so nobody gets stuck nose-first against a wall)
  if (!spinning) {
    const turnIn = k.drift ? k.drift * 0.45 + k.steer * 0.4 : k.steer;
    let speedK = Math.max(-1, Math.min(1, f / 80));
    if (inp.gas && speedK > -0.2 && speedK < 0.45) speedK = 0.45;
    k.a += turnIn * (k.drift ? DRIFT_TURN : TURN) * speedK * dt;
    ca = Math.cos(k.a);
    sa = Math.sin(k.a);
  }
  // velocity in the (new) heading frame: throttle forward, grip sideways
  f = k.vx * ca + k.vy * sa;
  let l = -k.vx * sa + k.vy * ca;
  const boosting = k.boostT > 0;
  let vmax = VMAX * k.catchUp * (k.cpu ? CPU_PACE : 1);
  if (k.offroad && !boosting) vmax *= OFFROAD;
  if (boosting) {
    vmax *= BOOST;
    k.boostT -= dt;
  }
  const gas = !spinning && (inp.gas || k.drift !== 0);
  if (spinning) f *= Math.exp(-3 * dt);
  else if (gas && f < vmax) f = Math.min(vmax, f + ACCEL * (boosting ? 2.5 : 1) * dt);
  else if (f > vmax) f += (vmax - f) * Math.min(1, dt * 2.5);
  else if (!gas) f *= Math.exp(-COAST * dt);
  l *= Math.exp(-(spinning ? 1.5 : k.drift ? DRIFT_GRIP : GRIP) * dt);
  k.vx = f * ca - l * sa;
  k.vy = f * sa + l * ca;
  k.x += k.vx * dt;
  k.y += k.vy * dt;
  // walls
  k.idx = nearest(t, k.x, k.y, k.idx);
  const px = t.xs[k.idx]!, py = t.ys[k.idx]!;
  const ex = k.x - px, ey = k.y - py;
  const d = Math.hypot(ex, ey);
  const lim = t.wall - KART_R;
  if (d > lim) {
    const nx = ex / d, ny = ey / d;
    k.x = px + nx * lim;
    k.y = py + ny * lim;
    const vn = k.vx * nx + k.vy * ny;
    if (vn > 0) {
      k.vx -= nx * vn * 1.35;
      k.vy -= ny * vn * 1.35;
      k.vx *= 0.85;
      k.vy *= 0.85;
      if (k.wallCd <= 0 && vn > 60) {
        r.events.push({ kind: "wall", id: k.id });
        k.wallCd = 0.4;
      }
    }
  }
  k.offroad = d > t.hw;
  k.wallCd -= dt;
  k.bumpCd -= dt;
  k.padCd -= dt;
  k.shieldT = Math.max(0, k.shieldT - dt);
  k.rollT = Math.max(0, k.rollT - dt);
  // speed pads
  if (k.padCd <= 0) {
    for (const p of t.pads) {
      if ((k.x - p.x) ** 2 + (k.y - p.y) ** 2 < 24 * 24) {
        k.boostT = Math.max(k.boostT, 0.8);
        k.padCd = 0.6;
        r.events.push({ kind: "pad", id: k.id });
        break;
      }
    }
  }
  // items
  const press = inp.item && !k.prevItem;
  k.prevItem = inp.item;
  if (press) k.itemQueued = !!k.item;
  if (k.itemQueued && k.item && k.rollT <= 0 && !spinning) {
    k.itemQueued = false;
    useItem(r, k);
  }
}

/** Kart-to-kart bumps: equal masses, a bit bouncy; a Boing Bumper shield knocks the other kart spinning. */
function collide(r: Race) {
  const ks = r.karts;
  for (let i = 0; i < ks.length; i++) {
    for (let j = i + 1; j < ks.length; j++) {
      const a = ks[i]!, b = ks[j]!;
      const dx = b.x - a.x, dy = b.y - a.y;
      const dd = dx * dx + dy * dy;
      if (dd >= (2 * KART_R) ** 2 || dd === 0) continue;
      const d = Math.sqrt(dd), nx = dx / d, ny = dy / d;
      const push = (2 * KART_R - d) / 2;
      a.x -= nx * push; a.y -= ny * push;
      b.x += nx * push; b.y += ny * push;
      const vrel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (vrel < 0) {
        const jn = (-(1 + 0.4) * vrel) / 2;
        a.vx -= nx * jn; a.vy -= ny * jn;
        b.vx += nx * jn; b.vy += ny * jn;
      }
      let hard = false;
      for (const [s, o, sign] of [[a, b, 1], [b, a, -1]] as const) {
        if (s.shieldT > 0 && o.shieldT <= 0 && o.spinT <= 0) {
          o.vx += nx * 200 * sign;
          o.vy += ny * 200 * sign;
          o.spinT = SPIN * 0.6;
          o.lastHitBy = s.id;
          s.stats.hits++;
          hard = true;
          r.events.push({ kind: "spin", id: o.id, by: s.id, cause: "bumper" });
        }
      }
      if ((a.bumpCd <= 0 || hard) && Math.abs(vrel) > 40) {
        a.bumpCd = b.bumpCd = 0.35;
        r.events.push({ kind: "bump", a: a.id, b: b.id, hard });
      }
    }
  }
}

/** One fixed step. `inputs` holds the human karts' controls; CPU karts (and finished karts) drive themselves. */
export function step(r: Race, dt: number, inputs: Map<string, KartInput>): RaceEvent[] {
  r.events.length = 0;
  if (r.phase === "done") return r.events;
  if (r.phase === "countdown") {
    r.countdown -= dt;
    if (r.countdown <= 0) {
      r.phase = "race";
      r.events.push({ kind: "go" });
    }
    return r.events;
  }
  r.time += dt;
  let lead = -Infinity;
  for (const k of r.karts) if (k.finishedAt === null && k.dist > lead) lead = k.dist;
  for (const k of r.karts) {
    const behind = Math.max(0, lead - k.dist);
    k.catchUp = k.finishedAt !== null ? 0.8 : 1 + Math.min(1, behind / 600) * CATCH_UP;
  }
  for (const k of r.karts) {
    const inp = k.cpu || k.finishedAt !== null ? drive(r, k) : inputs.get(k.id) ?? IDLE;
    physics(r, k, inp, dt);
  }
  collide(r);
  for (const k of r.karts) {
    k.idx = nearest(r.track, k.x, k.y, k.idx);
    progress(r, k);
  }
  rank(r);
  for (const k of r.karts) {
    const got = pickupBoxes(r, k);
    if (got) {
      const pos = placeOf(r, k.id);
      const kind = rollItem(r, (pos - 1) / Math.max(1, r.karts.length - 1));
      k.item = kind;
      k.itemN = kind === "triple" ? 3 : 1;
      k.rollT = 0.8;
      k.stats.pickups++;
      r.events.push({ kind: "pickup", id: k.id, item: kind });
    }
  }
  stepHazards(r, dt);
  let allIn = true, humans = 0, humansIn = 0, lastHuman = 0;
  for (const k of r.karts) {
    if (k.finishedAt === null) allIn = false;
    if (k.cpu) continue;
    humans++;
    if (k.finishedAt !== null) {
      humansIn++;
      lastHuman = Math.max(lastHuman, k.finishedAt);
    }
  }
  const graceOver = r.firstFinish !== null && r.time - r.firstFinish > r.grace;
  const humansDone = humans > 0 && humansIn === humans && r.time - lastHuman > 2.5;
  if (allIn || graceOver || humansDone || r.time > r.laps * 90) {
    r.phase = "done";
    r.events.push({ kind: "done" });
  }
  return r.events;
}

/** Final (or current) standings, every kart: place 1 first. Points per place for the results screen. */
export const POINTS = [15, 12, 10, 8, 6, 4, 2, 1];
export function standings(r: Race) {
  return r.order.map((k, i) => ({ id: k.id, cpu: k.cpu, place: i + 1, score: POINTS[i] ?? 0, finished: k.finishedAt !== null, time: k.finishedAt }));
}
