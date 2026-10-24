/**
 * KALARI CLASH match flow: intro → countdown → fight → round end → … → podium. 90 s rounds, best of three (first
 * to two round wins, at most three rounds). A round ends when one fighter is left standing (health KOs and
 * ring-outs) or on time (most health wins). Pure: step(match, DT, inputs) with seeded randomness.
 */
import { knockOut, offStage, ringOut, separate, updateFalling, updateFighter } from "./combat";
import { ARENAS } from "./arenas";
import { IDLE, MAX_HEALTH, newStats, type Fighter, type FighterId, type KalariEvent, type KalariInput, type Match } from "./rules";

export * from "./rules";

export interface MatchOptions {
  seed?: number;
  arena?: string;
  roundSeconds?: number;
  roundsToWin?: number;
  maxRounds?: number;
  introSeconds?: number;
  countdownSeconds?: number;
}

export interface Entrant { id: string; cpu: boolean; char: FighterId }

/** Start spots: two face each other across the middle; 3rd and 4th from the other diagonal. */
export function spawnPoints(hx: number, hz: number): Array<[number, number]> {
  const x = hx * 0.55, z = hz * 0.45;
  return [[-x, z * 0.2], [x, -z * 0.2], [-x * 0.4, -z * 1.2], [x * 0.4, z * 1.2]];
}

function makeFighter(e: Entrant, slot: number): Fighter {
  return {
    id: e.id, cpu: e.cpu, slot, char: e.char, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, face: 0, state: "ok", t: 0,
    move: null, struck: [], specialHit: 0, chainQueued: false, buffer: null, bufferT: 0, guardT: Infinity, stun: 0, rollCd: 0,
    rollX: 0, rollZ: 1, health: MAX_HEALTH, meter: 0, secondWind: false, combo: 0, comboT: 0, lastHitBy: null, lastHitAt: -99,
    alive: true, underdog: false, stats: newStats(),
  };
}

export function newMatch(entrants: Entrant[], o: MatchOptions = {}): Match {
  if (entrants.length < 2) throw new Error("a clash needs at least two fighters");
  const arena = ARENAS.find((a) => a.id === o.arena) ?? ARENAS[0]!;
  const m: Match = {
    phase: "intro", t: 0, time: 0, round: 1,
    roundSeconds: o.roundSeconds ?? 90, roundLeft: o.roundSeconds ?? 90,
    roundsToWin: o.roundsToWin ?? 2, maxRounds: o.maxRounds ?? 3,
    introSeconds: o.introSeconds ?? 4, countdownSeconds: o.countdownSeconds ?? 3, countdownShown: -1,
    arena: arena.rules, fighters: entrants.slice(0, 4).map(makeFighter),
    seed: Math.max(1, Math.floor(o.seed ?? 1) % 2147483646),
    roundWinner: null, matchWinner: null, lastKoAt: null, freeze: null,
  };
  resetRound(m);
  return m;
}

/** Everyone back to their spot at full health; whoever is behind on round wins becomes the underdog. */
function resetRound(m: Match) {
  const best = Math.max(...m.fighters.map((f) => f.stats.roundWins));
  const spots = spawnPoints(m.arena.hx, m.arena.hz);
  m.fighters.forEach((f, i) => {
    const [x, z] = spots[i]!;
    Object.assign(f, {
      x, z, y: 0, vx: 0, vy: 0, vz: 0, face: Math.atan2(-x, -z), state: "ok", t: 0, move: null, struck: [], specialHit: 0,
      chainQueued: false, buffer: null, bufferT: 0, guardT: Infinity, stun: 0, rollCd: 0, health: MAX_HEALTH,
      meter: Math.min(60, f.meter), secondWind: false, combo: 0, comboT: 0, lastHitBy: null, lastHitAt: -99, alive: true,
      underdog: best > 0 && f.stats.roundWins < best,
    });
    if (f.underdog) f.meter = Math.max(f.meter, 50); // a head start on the special for whoever is behind
  });
  m.roundLeft = m.roundSeconds;
  m.roundWinner = null;
  m.lastKoAt = null;
  m.freeze = null;
  m.countdownShown = -1;
}

function setPhase(m: Match, phase: Match["phase"], ev: KalariEvent[]) {
  m.phase = phase;
  m.t = 0;
  ev.push({ kind: "phase", phase });
}

function endRound(m: Match, reason: "ko" | "time", ev: KalariEvent[]) {
  const alive = m.fighters.filter((f) => f.alive);
  let winner: Fighter | null = null;
  if (alive.length === 1) winner = alive[0]!;
  else if (alive.length > 1) {
    const sorted = [...alive].sort((a, b) => b.health - a.health);
    winner = sorted[0]!.health > sorted[1]!.health ? sorted[0]! : null;
  }
  m.roundWinner = winner?.id ?? null;
  if (winner) {
    if (winner.underdog) winner.stats.comebacks++;
    winner.stats.roundWins++;
  }
  m.freeze = null;
  setPhase(m, "roundEnd", ev);
  ev.push({ kind: "round-end", winner: m.roundWinner, reason });
}

/** One number per fighter for placings(): round wins dominate, then knockouts, then damage dealt. */
export function score(f: Fighter): number {
  return f.stats.roundWins * 1000 + f.stats.kos * 50 + Math.min(49, Math.floor(f.stats.damage / 10));
}

export function standings(m: Match): Fighter[] {
  return [...m.fighters].sort((a, b) => score(b) - score(a));
}

function matchOver(m: Match): boolean {
  return m.fighters.some((f) => f.stats.roundWins >= m.roundsToWin) || m.round >= m.maxRounds;
}

/** Advances the match by `dt` seconds (use DT). Missing inputs count as idle. */
export function step(m: Match, dt: number, inputs: Map<string, KalariInput>): KalariEvent[] {
  const ev: KalariEvent[] = [];
  m.time += dt;
  m.t += dt;
  const input = (id: string) => inputs.get(id) ?? IDLE;

  if (m.phase === "intro") {
    if (m.t >= m.introSeconds) setPhase(m, "countdown", ev);
    return ev;
  }
  if (m.phase === "countdown") {
    const n = Math.max(0, Math.ceil(m.countdownSeconds - m.t));
    if (n !== m.countdownShown) {
      m.countdownShown = n;
      ev.push({ kind: "countdown", n });
    }
    if (m.t >= m.countdownSeconds) setPhase(m, "fight", ev);
    return ev;
  }
  if (m.phase === "roundEnd") {
    for (const f of m.fighters) if (f.state === "fall") updateFalling(f, dt);
    if (m.t >= 3.6) {
      if (matchOver(m)) {
        const top = standings(m);
        m.matchWinner = top[0] && (!top[1] || score(top[0]) > score(top[1])) ? top[0].id : null;
        setPhase(m, "podium", ev);
        ev.push({ kind: "match-end", winner: m.matchWinner });
      } else {
        m.round++;
        resetRound(m);
        setPhase(m, "countdown", ev);
      }
    }
    return ev;
  }
  if (m.phase === "podium") return ev;

  // ---- fight ----
  if (m.freeze) {
    if (m.time < m.freeze.until) return ev; // a special's cinematic cut: the world holds its breath
    m.freeze = null;
  }
  const before = Math.ceil(m.roundLeft);
  m.roundLeft = Math.max(0, m.roundLeft - dt);
  if (before > 10 && Math.ceil(m.roundLeft) === 10) ev.push({ kind: "time-warning" });
  for (const f of m.fighters) {
    if (f.alive) updateFighter(m, f, input(f.id), dt, ev);
    else if (f.state === "fall") updateFalling(f, dt);
  }
  separate(m);
  for (const f of m.fighters) {
    if (f.alive && f.y < 0.5 && offStage(m, f)) ringOut(m, f, ev);
    if (f.alive && f.health <= 0 && f.state !== "air") knockOut(m, f, ev);
  }
  const alive = m.fighters.filter((f) => f.alive).length;
  // the last knockout plays out in slow motion on the TV before the round ends
  if (alive <= 1 && (m.lastKoAt === null || m.time - m.lastKoAt >= 1.6)) endRound(m, "ko", ev);
  else if (m.roundLeft <= 0) endRound(m, "time", ev);
  return ev;
}
