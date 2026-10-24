/**
 * Pillow Fort Brawl match flow: intro → countdown → fight → round end → … → podium. Best of three rounds
 * (first to two round wins, at most three rounds). Pure: step(match, dt, inputs) with a fixed 1/60 s step and
 * seeded randomness, so whole matches replay identically in tests.
 */
import { knockOff, offBed, separate, updateFalling, updateFighter, updateGhost } from "./combat";
import { chaosGap, updateChaos, updateHazards } from "./chaos";
import { IDLE, newStats, type BrawlEvent, type BrawlInput, type Fighter, type Match } from "./rules";

export * from "./rules";

export interface MatchOptions {
  seed?: number;
  roundSeconds?: number;
  roundsToWin?: number;
  maxRounds?: number;
  introSeconds?: number;
  countdownSeconds?: number;
  /** Seconds into each round for the first chaos event (default: random 13–20 s). */
  firstChaos?: number;
}

/** Start spots: the four corners of the mattress, facing the middle. */
const SPAWN: Array<[number, number]> = [[-3, -1.8], [3, 1.8], [3, -1.8], [-3, 1.8], [0, -3], [0, 3]];

function makeFighter(id: string, cpu: boolean, slot: number): Fighter {
  return {
    id, cpu, slot, x: 0, z: 0, y: 0, vx: 0, vz: 0, vy: 0, face: 0, state: "ok", t: 0, charge: 0, power: 0, queued: 0, queuedT: 0, dodgeQ: 0,
    hitDone: true, cooldown: 0, dodgeCd: 0, dodgeX: 0, dodgeZ: 1, stun: 0, damage: 0, lastHitBy: null, lastHitAt: -99,
    alive: true, slowed: 0, combo: 0, comboT: 0, underdog: false, ghostCd: 0, ghostDrops: 0, stats: newStats(),
  };
}

export function newMatch(entrants: Array<{ id: string; cpu: boolean }>, o: MatchOptions = {}): Match {
  if (entrants.length < 2) throw new Error("a brawl needs at least two fighters");
  const m: Match = {
    phase: "intro", t: 0, time: 0, round: 1,
    roundSeconds: o.roundSeconds ?? 75, roundLeft: o.roundSeconds ?? 75,
    roundsToWin: o.roundsToWin ?? 2, maxRounds: o.maxRounds ?? 3,
    introSeconds: o.introSeconds ?? 3.5, countdownSeconds: o.countdownSeconds ?? 3,
    fighters: entrants.slice(0, SPAWN.length).map((e, i) => makeFighter(e.id, e.cpu, i)),
    hazards: [], drops: [], chaos: null, nextChaos: 0, firstChaos: o.firstChaos ?? null, lastChaos: null,
    seed: Math.max(1, Math.floor(o.seed ?? 1) % 2147483646), nextId: 1,
    roundWinner: null, lastKoAt: null, firstOutDone: false, matchWinner: null, countdownShown: -1,
  };
  resetRound(m);
  return m;
}

/** Everyone back on the bed, wobble reset; whoever is behind on round wins becomes the underdog. */
function resetRound(m: Match) {
  const best = Math.max(...m.fighters.map((f) => f.stats.roundWins));
  m.fighters.forEach((f, i) => {
    const [x, z] = SPAWN[i]!;
    Object.assign(f, {
      x, z, y: 0, vx: 0, vz: 0, vy: 0, face: Math.atan2(-x, -z), state: "ok", t: 0, charge: 0, power: 0, queued: 0, queuedT: 0, dodgeQ: 0, hitDone: true,
      cooldown: 0, dodgeCd: 0, stun: 0, damage: 0, lastHitBy: null, lastHitAt: -99, alive: true, slowed: 0, combo: 0,
      comboT: 0, ghostCd: 0, underdog: best > 0 && f.stats.roundWins < best,
    });
  });
  m.hazards = [];
  m.drops = [];
  m.chaos = null;
  m.roundLeft = m.roundSeconds;
  m.roundWinner = null;
  m.lastKoAt = null;
  m.firstOutDone = false;
  m.countdownShown = -1;
  m.nextChaos = m.firstChaos ?? chaosGap(m);
}

function setPhase(m: Match, phase: Match["phase"], ev: BrawlEvent[]) {
  m.phase = phase;
  m.t = 0;
  ev.push({ kind: "phase", phase });
}

/** Round over: the last one standing wins; on time, whoever is standing with the least wobble. */
function endRound(m: Match, reason: "ko" | "time", ev: BrawlEvent[]) {
  const alive = m.fighters.filter((f) => f.alive);
  let winner: Fighter | null = null;
  if (alive.length === 1) winner = alive[0]!;
  else if (alive.length > 1) {
    const sorted = [...alive].sort((a, b) => a.damage - b.damage);
    winner = sorted[0]!.damage < sorted[1]!.damage ? sorted[0]! : null;
  }
  m.roundWinner = winner?.id ?? null;
  if (winner) {
    if (winner.underdog) winner.stats.comebacks++;
    winner.stats.roundWins++;
  }
  m.chaos = null;
  m.drops = [];
  setPhase(m, "roundEnd", ev);
  ev.push({ kind: "round-end", winner: m.roundWinner, reason });
}

/** Match standings: round wins, then knockouts, then hits. */
export function standings(m: Match): Fighter[] {
  return [...m.fighters].sort((a, b) => score(b) - score(a));
}

/** One number per fighter for placings(): round wins dominate, knockouts and hits break ties. */
export function score(f: Fighter): number {
  return f.stats.roundWins * 1000 + f.stats.kos * 50 + Math.min(49, f.stats.hits);
}

function matchOver(m: Match): boolean {
  return m.fighters.some((f) => f.stats.roundWins >= m.roundsToWin) || m.round >= m.maxRounds;
}

/** Advances the match by `dt` seconds (use DT). Missing inputs count as idle. */
export function step(m: Match, dt: number, inputs: Map<string, BrawlInput>): BrawlEvent[] {
  const ev: BrawlEvent[] = [];
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
    for (const f of m.fighters) if (f.state === "fall") updateFalling(f, dt, ev);
    if (m.t >= 3.2) {
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
  const before = Math.ceil(m.roundLeft);
  m.roundLeft = Math.max(0, m.roundLeft - dt);
  if (before > 10 && Math.ceil(m.roundLeft) === 10) ev.push({ kind: "time-warning" });
  const elapsed = m.roundSeconds - m.roundLeft;
  updateChaos(m, elapsed, dt, ev);
  for (const f of m.fighters) {
    if (f.alive) updateFighter(m, f, input(f.id), dt, ev);
    else if (f.state === "fall") updateFalling(f, dt, ev);
    else updateGhost(m, f, input(f.id), dt, ev);
  }
  separate(m);
  updateHazards(m, dt, ev);
  for (const f of m.fighters) if (f.alive && offBed(f)) knockOff(m, f, ev);

  const alive = m.fighters.filter((f) => f.alive).length;
  // the last knockout plays out for a moment (slow motion on the TV) before the round ends
  if (alive <= 1 && (m.lastKoAt === null || m.time - m.lastKoAt >= 1.4)) endRound(m, "ko", ev);
  else if (m.roundLeft <= 0) endRound(m, "time", ev);
  return ev;
}
