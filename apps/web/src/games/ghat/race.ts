/**
 * GHAT RUSH race: phases (intro flyover → 3-2-1 → race → results → replay → podium), every racer's driving,
 * contacts and takedowns with quick respawns, traffic and goats, tiffin pickups and items, the boost meter
 * (near misses, drafting, air, drifts, takedowns), gentle rubber-banding, laps, places and the finish.
 * Pure and deterministic for a seed: the TV just feeds inputs and draws the state.
 */
import { buildTrack, frameAt, type Frame, type Track } from "./track";
import { HAIRPIN_GHAT } from "./course";
import { BOOST_COST, KINDS, RESPAWN_SHIELD, drive, newRacer, spinOut, wreck, type DriveEvent, type Kind, type Racer, type RacerInput } from "./racer";
import { CHAI, HORN_REACH, HORN_SHOVE, HORN_SHOVE_RANGE, PICKUP_RESPAWN, ROLL_TIME, SPLASH_BLIND, SPLASH_REACH, placePickups, rollItem, stepCoconuts, type Coconut, type ItemKind, type Pickup } from "./items";
import { GOAT_ZONES, gapTo, spawnGoats, spawnTraffic, stepGoats, stepTraffic, type Goat, type Traffic } from "./traffic";
import { goatContacts, racerContacts, takedownBy, trafficContacts, type ContactEvent } from "./contact";
import { Recorder } from "./replay";

export const DT = 1 / 60;
export type Phase = "intro" | "countdown" | "race" | "results" | "replay" | "podium";

export interface RaceOpts {
  laps: number;
  seed: number;
  introSeconds: number;
  countdownSeconds: number;
  /** After the first finisher, how long the others get (s). */
  graceSeconds: number;
  replaySeconds: number;
  podiumSeconds: number;
  traffic: number;
}

export const FULL: RaceOpts = { laps: 3, seed: 1, introSeconds: 6, countdownSeconds: 3, graceSeconds: 25, replaySeconds: 7, podiumSeconds: 10, traffic: 8 };
export const QUICK: RaceOpts = { laps: 1, seed: 1, introSeconds: 2.5, countdownSeconds: 3, graceSeconds: 15, replaySeconds: 5, podiumSeconds: 7, traffic: 6 };

export interface Entrant { id: string; cpu: boolean; kind: Kind }

export type RaceEvent =
  | DriveEvent
  | ContactEvent
  | { kind: "phase"; phase: Phase }
  | { kind: "count"; n: number }
  | { kind: "go" }
  | { kind: "lap"; id: string; lap: number; final: boolean }
  | { kind: "finish"; id: string; place: number }
  | { kind: "pickup"; id: string; item: ItemKind }
  | { kind: "item"; id: string; item: ItemKind }
  | { kind: "coconutHit"; id: string; by: string }
  | { kind: "splashed"; id: string; by: string }
  | { kind: "respawn"; id: string }
  | { kind: "overtake"; id: string; place: number }
  | { kind: "draft"; id: string };

export interface Race {
  opts: RaceOpts;
  track: Track;
  phase: Phase;
  /** Seconds in the current phase. */
  phaseT: number;
  /** Race clock (from GO). */
  time: number;
  racers: Racer[];
  traffic: Traffic[];
  goats: Goat[];
  pickups: Pickup[];
  coconuts: Coconut[];
  finishOrder: string[];
  firstFinishAt: number | null;
  nearMissed: Map<string, Set<number>>;
  drafting: Map<string, number>;
  goatClock: number;
  goatId: number;
  recorder: Recorder;
  seed: number;
  rnd: () => number;
  /** The race simulation has fully ended (podium shown long enough). */
  over: boolean;
}

const fr: Frame = { x: 0, y: 0, z: 0, heading: 0, curv: 0, slope: 0, hw: 0, i: 0 };

export function makeRng(seed: number) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Grid: two abreast, 7 m between rows, behind the start line. */
export function gridSpot(slot: number, hw: number) {
  return { s: -6 - Math.floor(slot / 2) * 7, d: (slot % 2 === 0 ? -1 : 1) * hw * 0.33 };
}

export function newRace(entrants: Entrant[], opts: RaceOpts): Race {
  const track = buildTrack(HAIRPIN_GHAT);
  const rnd = makeRng(opts.seed);
  const hw = frameAt(track, 0, fr).hw;
  const racers = entrants.map((e, slot) => {
    const g = gridSpot(slot, hw);
    const r = newRacer(e.id, slot, e.kind, e.cpu, g.s, g.d);
    r.y = frameAt(track, g.s, fr).y;
    r.pace = e.cpu ? 0.92 + rnd() * 0.05 : 1;
    return r;
  });
  const traffic = spawnTraffic(track, opts.traffic, rnd);
  return {
    opts, track, phase: "intro", phaseT: 0, time: 0, racers, traffic, goats: [], pickups: placePickups(track), coconuts: [],
    finishOrder: [], firstFinishAt: null, nearMissed: new Map(), drafting: new Map(), goatClock: 6, goatId: 0,
    recorder: new Recorder(racers.length, traffic.length), seed: opts.seed, rnd, over: false,
  };
}

/** Race distance in laps for the HUD: 1-based current lap, capped at the race's laps. */
export function lapOf(race: Race, r: Racer): number {
  return Math.min(race.opts.laps, Math.max(1, Math.floor(Math.max(0, r.s) / race.track.length) + 1));
}

/** Order: finishers by finish order, then by distance. */
export function standings(race: Race): Racer[] {
  return [...race.racers].sort((a, b) => {
    const fa = race.finishOrder.indexOf(a.id), fb = race.finishOrder.indexOf(b.id);
    if (fa >= 0 || fb >= 0) return (fa < 0 ? 99 : fa) - (fb < 0 ? 99 : fb);
    return b.s - a.s;
  });
}

function setPhase(race: Race, p: Phase, ev: RaceEvent[]) {
  race.phase = p;
  race.phaseT = 0;
  ev.push({ kind: "phase", phase: p });
}

/** Finds a clear spot near s to put a wrecked racer back on the road. */
function respawn(race: Race, r: Racer) {
  const t = race.track;
  frameAt(t, r.s, fr);
  const candidates = [0, -0.4, 0.4, -0.7, 0.7].map((f) => f * (fr.hw - 1.2));
  let best = 0, bestScore = -Infinity;
  for (const d of candidates) {
    let score = -Math.abs(d) * 0.1;
    for (const c of race.traffic) if (Math.abs(gapTo(t, r.s, c.s)) < 25 && Math.abs(c.d - d) < 3) score -= 10;
    for (const o of race.racers) if (o !== r && Math.abs(o.s - r.s) < 6 && Math.abs(o.d - d) < 2) score -= 5;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  r.d = best;
  r.a = 0;
  r.push = 0;
  r.v = KINDS[r.kind].vmax * 0.62;
  r.y = fr.y;
  r.vy = 0;
  r.air = false;
  r.wreckT = 0;
  r.shieldT = RESPAWN_SHIELD;
  r.lastHitBy = null;
}

function useItem(race: Race, r: Racer, ev: RaceEvent[]) {
  const item = r.item!;
  r.item = null;
  r.stats.items++;
  ev.push({ kind: "item", id: r.id, item });
  const t = race.track;
  if (item === "chai") {
    r.turboT = Math.max(r.turboT, CHAI.t);
    r.turboPower = CHAI.power;
    r.meter = Math.min(1, r.meter + CHAI.meter);
  } else if (item === "coconut") {
    race.coconuts.push({ s: r.s - KINDS[r.kind].len, d: r.d, sv: Math.max(4, r.sv - 24), dv: 0, life: 8, owner: r.id, spin: 0 });
  } else if (item === "splash") {
    for (const o of race.racers) {
      const gap = r.s - o.s;
      if (o === r || gap <= 0 || gap > SPLASH_REACH || o.shieldT > 0) continue;
      o.blindT = SPLASH_BLIND;
      o.stats.splashed++;
      ev.push({ kind: "splashed", id: o.id, by: r.id });
    }
  } else if (item === "horn") {
    for (const c of race.traffic) {
      const g = gapTo(t, r.s, c.s);
      if (g > -10 && g < HORN_REACH) c.verge = 4.5;
    }
    for (const g of race.goats) {
      const gap = gapTo(t, r.s, g.s);
      if (gap > -5 && gap < HORN_REACH + 20) {
        g.fleeing = true;
        g.pause = 0;
        if (Math.abs(g.vd) < 0.1) g.vd = g.d >= 0 ? 1.5 : -1.5;
      }
    }
    for (const o of race.racers) {
      if (o === r || o.wreckT > 0 || o.shieldT > 0) continue;
      const ds = o.s - r.s;
      if (ds > -3 && ds < HORN_SHOVE_RANGE && Math.abs(o.d - r.d) < 4.5) {
        o.push += Math.sign(o.d - r.d || 1) * HORN_SHOVE;
        o.lastHitBy = r.id;
        o.lastHitAt = race.time;
      }
    }
  }
}

function award(race: Race, r: Racer, amount: number) {
  r.meter = Math.min(1, r.meter + amount);
}

/** One fixed step. `inputs` maps racer id → input (CPU inputs included). Returns what happened. */
export function step(race: Race, dt: number, inputs: Map<string, RacerInput>): RaceEvent[] {
  const ev: RaceEvent[] = [];
  const t = race.track;
  race.phaseT += dt;
  const o = race.opts;
  if (race.phase === "intro") {
    if (race.phaseT >= o.introSeconds) {
      setPhase(race, "countdown", ev);
      ev.push({ kind: "count", n: 3 });
    }
    return ev;
  }
  if (race.phase === "countdown") {
    const before = Math.ceil(o.countdownSeconds - (race.phaseT - dt));
    const left = Math.ceil(o.countdownSeconds - race.phaseT);
    if (left !== before && left > 0) ev.push({ kind: "count", n: left });
    if (race.phaseT >= o.countdownSeconds) {
      setPhase(race, "race", ev);
      ev.push({ kind: "go" });
      // a perfectly timed launch is not modelled; everyone gets a small launch boost
      for (const r of race.racers) r.v = 6;
    }
    return ev;
  }
  if (race.phase === "replay") {
    if (race.phaseT >= o.replaySeconds) setPhase(race, "podium", ev);
    return ev;
  }
  if (race.phase === "podium") {
    if (race.phaseT >= o.podiumSeconds) race.over = true;
    return ev;
  }

  // ---- race (and results: the sim keeps running behind the results card) ----
  race.time += dt;
  const leader = Math.max(...race.racers.map((r) => r.s));
  const humans = race.racers.filter((r) => !r.cpu);
  const bestHuman = humans.length ? Math.max(...humans.map((r) => r.s)) : leader;
  const order = standings(race);
  for (const r of race.racers) {
    // gentle rubber-banding: up to +7% top speed when far behind; CPUs far ahead of every human ease off
    r.catchUp = Math.min(1, Math.max(0, (leader - r.s - 15) / 180)) * 0.07;
    if (r.cpu) r.pace = Math.min(0.97, Math.max(0.86, (r.pace + (r.s - bestHuman > 50 ? -0.02 : 0.004) * dt)));
    const inp = inputs.get(r.id) ?? { steer: 0, drift: false, boost: false, item: false };
    const before = r.wreckT;
    drive(t, r, inp, dt, ev as DriveEvent[]);
    if (before > 0 && r.wreckT <= 0) {
      respawn(race, r);
      ev.push({ kind: "respawn", id: r.id });
    }
    if (inp.item && r.item && r.rollT <= 0 && r.wreckT <= 0 && r.finishedAt === null) useItem(race, r, ev);
  }
  // rails: a hard hit right after a shove is a takedown
  for (const e of ev) {
    if (e.kind !== "wall" || e.impact < 5.5) continue;
    const r = race.racers.find((x) => x.id === e.id)!;
    const by = takedownBy(r, race.time);
    if (by && wreck(r)) ev.push({ kind: "takedown", by, victim: r.id, impact: e.impact + r.v * 0.3, how: "rail" });
  }
  const contacts: ContactEvent[] = [];
  racerContacts(race.racers, race.time, contacts);
  stepTraffic(t, race.traffic, dt);
  trafficContacts(t, race.racers, race.traffic, race.time, race.nearMissed, contacts);
  // goats: a herd crosses somewhere ahead of the leader every so often
  race.goatClock -= dt;
  if (race.goatClock <= 0 && race.goats.length < 5) {
    race.goatClock = 9 + race.rnd() * 7;
    const zone = GOAT_ZONES[Math.floor(race.rnd() * GOAT_ZONES.length)]! * t.length;
    const lead = leader % t.length;
    const ahead = ((zone - lead) % t.length + t.length) % t.length;
    if (ahead > 110 && ahead < 500) {
      const g = spawnGoats(t, zone, race.rnd, race.goatId);
      race.goatId += g.length;
      race.goats.push(...g);
    }
  }
  race.goats = stepGoats(t, race.goats, dt);
  goatContacts(t, race.racers, race.goats, race.rnd, contacts);
  for (const c of contacts) {
    ev.push(c);
    if (c.kind === "takedown") {
      const by = race.racers.find((r) => r.id === c.by)!, victim = race.racers.find((r) => r.id === c.victim)!;
      by.stats.takedowns++;
      victim.stats.wrecked++;
      award(race, by, 0.34);
      race.recorder.takedown(c.victim, c.by, c.impact);
    } else if (c.kind === "crash") {
      race.racers.find((r) => r.id === c.id)!.stats.crashes++;
    } else if (c.kind === "nearMiss") {
      const r = race.racers.find((x) => x.id === c.id)!;
      r.stats.nearMisses++;
      award(race, r, c.oncoming ? 0.16 : 0.1);
    } else if (c.kind === "goatDodge") {
      award(race, race.racers.find((x) => x.id === c.id)!, 0.08);
    }
  }
  // takedowns found in the rail pass above
  for (const e of ev) {
    if (e.kind === "takedown" && e.how === "rail") {
      const by = race.racers.find((r) => r.id === e.by)!, victim = race.racers.find((r) => r.id === e.victim)!;
      by.stats.takedowns++;
      victim.stats.wrecked++;
      award(race, by, 0.34);
      race.recorder.takedown(e.victim, e.by, e.impact);
    }
  }
  // drafting: tucked in behind someone at speed fills the meter
  for (const r of race.racers) {
    if (r.wreckT > 0 || r.finishedAt !== null || r.v < 18) continue;
    const ahead = race.racers.some((x) => x !== r && x.wreckT <= 0 && x.s - r.s > 3 && x.s - r.s < 16 && Math.abs(x.d - r.d) < 1.6);
    const was = race.drafting.get(r.id) ?? 0;
    const now = ahead ? was + dt : 0;
    race.drafting.set(r.id, now);
    if (ahead) {
      award(race, r, dt * 0.09);
      r.stats.drafted += dt;
      if (was < 0.8 && now >= 0.8) ev.push({ kind: "draft", id: r.id });
    }
  }
  // pickups and coconuts
  for (const p of race.pickups) {
    if (p.t > 0) {
      p.t -= dt;
      continue;
    }
    for (const r of race.racers) {
      if (r.item || r.wreckT > 0 || r.finishedAt !== null) continue;
      if (Math.abs(gapTo(t, r.s, p.s)) < 1.7 && Math.abs(r.d - p.d) < 1.6) {
        p.t = PICKUP_RESPAWN;
        r.item = rollItem(order.indexOf(r) + 1, race.racers.length, race.rnd());
        r.rollT = ROLL_TIME;
        ev.push({ kind: "pickup", id: r.id, item: r.item });
        break;
      }
    }
  }
  race.coconuts = stepCoconuts(t, race.coconuts, dt, race.racers);
  for (const c of race.coconuts) {
    for (const r of race.racers) {
      if (r.id === c.owner && c.life > 7.5) continue;
      if (r.air || r.wreckT > 0) continue;
      if (Math.abs(r.s - c.s) < KINDS[r.kind].len / 2 + 0.3 && Math.abs(r.d - c.d) < KINDS[r.kind].wid / 2 + 0.3) {
        c.life = 0;
        if (spinOut(r, 1.0)) {
          r.stats.coconutsHit++;
          r.lastHitBy = c.owner;
          r.lastHitAt = race.time;
          ev.push({ kind: "coconutHit", id: r.id, by: c.owner });
        }
      }
    }
  }
  // laps, finish, places
  for (const r of race.racers) {
    const lap = Math.floor(Math.max(0, r.s) / t.length);
    if (lap > r.lapShown && r.finishedAt === null) {
      r.lapShown = lap;
      if (lap < o.laps) ev.push({ kind: "lap", id: r.id, lap: lap + 1, final: lap + 1 === o.laps });
    }
    // only while the race is on: once it is called, everyone still out is already placed where they were
    if (r.finishedAt === null && race.phase === "race" && r.s >= o.laps * t.length) {
      r.finishedAt = race.time;
      race.finishOrder.push(r.id);
      race.firstFinishAt ??= race.time;
      ev.push({ kind: "finish", id: r.id, place: race.finishOrder.length });
    }
  }
  const after = standings(race);
  after.forEach((r, i) => {
    const place = i + 1;
    if (place < r.place && race.phase === "race" && r.finishedAt === null) ev.push({ kind: "overtake", id: r.id, place });
    r.place = place;
  });
  race.recorder.record({ racers: race.racers, traffic: race.traffic, goats: race.goats }, dt);

  // ending: everyone home, or the grace time after the winner is up
  const allHumansDone = humans.length > 0 && humans.every((r) => r.finishedAt !== null);
  const allDone = race.racers.every((r) => r.finishedAt !== null);
  if (race.phase === "race" && race.firstFinishAt !== null && (allDone || allHumansDone || race.time - race.firstFinishAt >= o.graceSeconds)) {
    // the rest are placed where they are
    for (const r of standings(race)) if (!race.finishOrder.includes(r.id)) race.finishOrder.push(r.id);
    setPhase(race, "results", ev);
  }
  if (race.phase === "results" && race.phaseT >= 3 && !race.recorder.capturing) {
    setPhase(race, race.recorder.best ? "replay" : "podium", ev);
  }
  return ev;
}

/** Boost meter segments (0-3) a racer can fire. */
export const boostsReady = (r: Racer) => Math.floor((r.meter + 1e-6) / BOOST_COST);
