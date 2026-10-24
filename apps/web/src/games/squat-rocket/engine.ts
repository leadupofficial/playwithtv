/**
 * Squat Rocket rules (pure: no DOM, fixed 1/60 s steps, seedable). 1-4 players, co-op and competitive:
 *
 *   warm-up  gentle moves to get going (not scored)
 *   fuel     every squat (seated: arm raise) pumps fuel into your rocket; steady rhythm builds a combo
 *   launch   the rockets lift off
 *   climb    meteors fly at each rocket: jump (seated: punch) to dodge; lean to steer into stars; pumps boost
 *   storm    the finale: everyone does jumping jacks to keep the team shield up against an asteroid storm
 *   finale   orbit! then the podium
 *
 * Fair for everyone: points reward rhythm and form, never speed or height. Reps faster than a cap (set by the
 * player's chosen intensity) don't count, and the fuel tank size and points per rep are scaled by intensity,
 * so a Gentle player can win against a Sweaty one. A player whose camera lost them is never penalised.
 */
export type Phase = "warmup" | "fuel" | "launch" | "climb" | "storm" | "finale" | "done";
export const PHASES: Phase[] = ["warmup", "fuel", "launch", "climb", "storm", "finale"];
/** 0 gentle · 1 normal · 2 sweaty */
export type Intensity = 0 | 1 | 2;
export type Timing = Record<Exclude<Phase, "done">, number>;

export const NORMAL: Timing = { warmup: 20, fuel: 50, launch: 3, climb: 60, storm: 35, finale: 5 };
export const QUICK: Timing = { warmup: 5, fuel: 10, launch: 2, climb: 12, storm: 9, finale: 2 };
export const DT = 1 / 60;

/** Minimum gap between counted reps (s): faster reps don't count ("slow and steady"). */
export const MIN_GAP: Record<Intensity, number> = { 0: 1.6, 1: 1.1, 2: 0.8 };
const JACK_GAP: Record<Intensity, number> = { 0: 1.0, 1: 0.7, 2: 0.55 };
/** Seconds per rep a player of this intensity is expected to manage: sets the tank size and points per rep. */
const PER_REP: Record<Intensity, number> = { 0: 4, 1: 3, 2: 2.2 };
const COMBO_GAP = 4.5;
/** Dodge window around a meteor's arrival (s): generous, as camera moves arrive ~150 ms late. */
export const DODGE_EARLY = 0.9, DODGE_LATE = 0.35, PERFECT_EARLY = 0.45, PERFECT_LATE = 0.2;
export const WARN = 2.2;

export interface PlayerIn {
  /** Controller live (camera: tracking the player). */
  ok: boolean;
  /** Steering, -1..1. */
  lean: number;
  intensity: Intensity;
  seated: boolean;
  /** Form of the latest squat (camera), 0..1. */
  quality: number;
}

export interface Rocket {
  id: string;
  fuel: number;
  tank: number;
  reps: number;
  perfect: number;
  combo: number;
  bestCombo: number;
  lastRep: number;
  lastJack: number;
  score: number;
  altitude: number;
  speed: number;
  boost: number;
  x: number;
  dodges: number;
  perfectDodges: number;
  hits: number;
  stars: number;
  jacks: number;
  warm: number;
  moves: number;
  /** Time of the last dodge attempt: a dodge only counts if it is a fresh move (no spamming). */
  lastTry: number;
  full: boolean;
  /** Seconds the camera had lost this player (scoring paused). */
  lost: number;
}

export interface Debris { id: number; target: string; kind: "meteor" | "star"; at: number; x: number; state: "incoming" | "dodged" | "hit" | "passed" | "got" }

export interface Match {
  phase: Phase;
  /** Seconds into the current phase, and since the start. */
  t: number;
  time: number;
  timing: Timing;
  rockets: Rocket[];
  debris: Debris[];
  shield: number;
  shieldMin: number;
  stormBeaten: boolean | null;
  nextId: number;
  nextSpawn: Map<string, number>;
  seed: number;
}

export type GameEvent =
  | { kind: "phase"; phase: Phase }
  | { kind: "rep"; id: string; perfect: boolean; combo: number; points: number }
  | { kind: "too-fast"; id: string }
  | { kind: "tank-full"; id: string }
  | { kind: "warm"; id: string }
  | { kind: "boost"; id: string }
  | { kind: "warn"; id: string; debris: number }
  | { kind: "dodge"; id: string; perfect: boolean; points: number }
  | { kind: "early"; id: string }
  | { kind: "hit"; id: string }
  | { kind: "star"; id: string }
  | { kind: "jack"; id: string; points: number }
  | { kind: "storm"; beaten: boolean };

export function newMatch(ids: string[], opts: { timing?: Timing; seed?: number; intensity?: (id: string) => Intensity } = {}): Match {
  const timing = opts.timing ?? NORMAL;
  return {
    phase: "warmup", t: 0, time: 0, timing,
    rockets: ids.map((id) => ({
      id, fuel: 0, tank: tankSize(timing, opts.intensity?.(id) ?? 1), reps: 0, perfect: 0, combo: 0, bestCombo: 0, lastRep: -99, lastJack: -99,
      score: 0, altitude: 0, speed: 0, boost: 0, x: 0, dodges: 0, perfectDodges: 0, hits: 0, stars: 0, jacks: 0, warm: 0, moves: 0, lastTry: -99, full: false, lost: 0,
    })),
    debris: [], shield: 0.6, shieldMin: 0.6, stormBeaten: null, nextId: 1, nextSpawn: new Map(), seed: (opts.seed ?? 1) >>> 0 || 1,
  };
}

/** Reps to fill the tank in this match for this intensity (at least 3). */
export function tankSize(timing: Timing, i: Intensity) {
  return Math.max(3, Math.round(timing.fuel / PER_REP[i]));
}

function rand(m: Match) {
  m.seed = (m.seed * 16807) % 2147483647;
  return m.seed / 2147483647;
}

/** Points scale so a rep is worth the same share of a round at every intensity. */
const scale = (i: Intensity) => PER_REP[i] / 3;

/**
 * One fixed step. `actions` are the actions that arrived since the previous step ("pump", "dodge", "jack");
 * the intensity can change mid-match (it is read from each phone).
 */
export function step(m: Match, dt: number, input: (id: string) => PlayerIn, actions: Array<{ id: string; action: string }>): GameEvent[] {
  const ev: GameEvent[] = [];
  if (m.phase === "done") return ev;
  m.t += dt;
  m.time += dt;
  const now = m.time;
  for (const r of m.rockets) {
    const inp = input(r.id);
    if (!inp.ok && m.phase !== "warmup") r.lost += dt;
    if (m.phase === "warmup" || (m.phase === "fuel" && r.reps === 0)) r.tank = tankSize(m.timing, inp.intensity); // the phone's choice
    r.boost = Math.max(0, r.boost - dt * 30);
    if (m.phase === "climb" || m.phase === "storm" || m.phase === "finale" || m.phase === "launch") {
      r.x += ((inp.ok ? Math.max(-1, Math.min(1, inp.lean)) : 0) - r.x) * Math.min(1, dt * 4);
    }
  }
  for (const { id, action } of actions) {
    const r = m.rockets.find((x) => x.id === id);
    if (r) act(m, r, input(id), action, now, ev);
  }
  if (m.phase === "launch" || m.phase === "climb" || m.phase === "storm" || m.phase === "finale") {
    for (const r of m.rockets) {
      const target = m.phase === "launch" ? 25 + 35 * r.fuel * (m.t / m.timing.launch) : 40 + 60 * r.fuel;
      r.speed += (target + r.boost - r.speed) * Math.min(1, dt * 2);
      r.altitude += r.speed * dt;
    }
  }
  if (m.phase === "climb") climb(m, input, ev);
  if (m.phase === "storm") {
    const n = m.rockets.length;
    const drain = 0.05 + 0.03 * (m.t / m.timing.storm);
    const anyone = m.rockets.some((r) => input(r.id).ok);
    if (anyone) m.shield = Math.max(0, m.shield - drain * dt * Math.min(1, 0.6 + 0.2 * n));
    m.shieldMin = Math.min(m.shieldMin, m.shield);
  }
  if (m.t >= m.timing[m.phase as Exclude<Phase, "done">]) advance(m, ev);
  return ev;
}

function act(m: Match, r: Rocket, inp: PlayerIn, action: string, now: number, ev: GameEvent[]) {
  if (!inp.ok) return; // the camera lost this player: nothing counts (and nothing hurts) until it sees them again
  r.moves++;
  if (m.phase === "warmup") {
    r.warm++;
    ev.push({ kind: "warm", id: r.id });
    return;
  }
  if (action === "pump" && (m.phase === "fuel" || m.phase === "climb")) {
    if (now - r.lastRep < MIN_GAP[inp.intensity]) {
      ev.push({ kind: "too-fast", id: r.id });
      return;
    }
    r.combo = now - r.lastRep <= COMBO_GAP + (inp.intensity === 0 ? 1 : 0) ? r.combo + 1 : 1;
    r.bestCombo = Math.max(r.bestCombo, r.combo);
    r.lastRep = now;
    r.reps++;
    const perfect = inp.quality >= 0.8;
    if (perfect) r.perfect++;
    const points = Math.round((10 + (perfect ? 5 : 0) + Math.min(r.combo - 1, 10) * 2) * scale(inp.intensity));
    r.score += points;
    ev.push({ kind: "rep", id: r.id, perfect, combo: r.combo, points });
    if (m.phase === "fuel") {
      r.fuel = Math.min(1, r.fuel + 1 / r.tank);
      if (r.fuel >= 1 && !r.full) {
        r.full = true;
        r.score += 25;
        ev.push({ kind: "tank-full", id: r.id });
      }
    } else {
      r.boost = Math.min(60, r.boost + 30);
      ev.push({ kind: "boost", id: r.id });
    }
    return;
  }
  if (action === "dodge" && m.phase === "climb") {
    const fresh = now - r.lastTry >= 0.8; // jumping all the time doesn't work: one move per meteor
    r.lastTry = now;
    const d = m.debris.find((x) => x.target === r.id && x.kind === "meteor" && x.state === "incoming" && now >= x.at - DODGE_EARLY && now <= x.at + DODGE_LATE);
    if (!d || !fresh) {
      ev.push({ kind: "early", id: r.id });
      return;
    }
    d.state = "dodged";
    const perfect = now >= d.at - PERFECT_EARLY && now <= d.at + PERFECT_LATE;
    r.dodges++;
    if (perfect) r.perfectDodges++;
    r.combo++;
    r.bestCombo = Math.max(r.bestCombo, r.combo);
    const points = perfect ? 25 : 15;
    r.score += points;
    ev.push({ kind: "dodge", id: r.id, perfect, points });
    return;
  }
  if (action === "jack" && m.phase === "storm") {
    if (now - r.lastJack < JACK_GAP[inp.intensity]) return;
    r.lastJack = now;
    r.jacks++;
    const n = m.rockets.length;
    m.shield = Math.min(1, m.shield + 0.09 / Math.sqrt(n));
    const points = Math.round(6 * scale(inp.intensity));
    r.score += points;
    ev.push({ kind: "jack", id: r.id, points });
  }
}

function climb(m: Match, input: (id: string) => PlayerIn, ev: GameEvent[]) {
  const now = m.time;
  const end = m.time - m.t + m.timing.climb;
  const every = m.timing.climb <= 15 ? 3 : 4.5;
  for (const r of m.rockets) {
    const ok = input(r.id).ok;
    let next = m.nextSpawn.get(r.id);
    if (next === undefined) {
      next = now + 2 + rand(m) * 0.8;
      m.nextSpawn.set(r.id, next);
    }
    if (now >= next - WARN && next + DODGE_LATE < end) {
      m.nextSpawn.set(r.id, next + every + rand(m) * 1.2);
      if (ok) {
        const d: Debris = { id: m.nextId++, target: r.id, kind: "meteor", at: next, x: r.x, state: "incoming" };
        m.debris.push(d);
        ev.push({ kind: "warn", id: r.id, debris: d.id });
        // a star halfway to the next meteor, off to one side: lean to grab it
        m.debris.push({ id: m.nextId++, target: r.id, kind: "star", at: next + every / 2, x: (rand(m) < 0.5 ? -1 : 1) * (0.5 + rand(m) * 0.35), state: "incoming" });
      }
    }
  }
  for (const d of m.debris) {
    if (d.state !== "incoming") continue;
    const r = m.rockets.find((x) => x.id === d.target)!;
    if (d.kind === "star" && now >= d.at) {
      // leaning far enough towards it is enough (overshooting is fine: buttons steer at full lock)
      if (Math.sign(r.x) === Math.sign(d.x) && Math.abs(r.x) >= Math.abs(d.x) - 0.3 && input(r.id).ok) {
        d.state = "got";
        r.stars++;
        r.score += 8;
        ev.push({ kind: "star", id: r.id });
      } else d.state = "passed";
    }
    if (d.kind === "meteor" && now > d.at + DODGE_LATE) {
      if (!input(r.id).ok) {
        d.state = "passed"; // lost tracking: the meteor misses, no penalty
        continue;
      }
      d.state = "hit";
      r.hits++;
      r.combo = 0;
      r.boost = 0;
      r.speed *= 0.6;
      ev.push({ kind: "hit", id: r.id });
    }
  }
  if (m.debris.length > 64) m.debris = m.debris.filter((d) => d.state === "incoming");
}

function advance(m: Match, ev: GameEvent[]) {
  if (m.phase === "storm") {
    m.stormBeaten = m.shield > 0.25 || m.shieldMin > 0;
    for (const r of m.rockets) r.score += m.stormBeaten ? 40 : 15;
    ev.push({ kind: "storm", beaten: m.stormBeaten });
  }
  if (m.phase === "climb") for (const r of m.rockets) r.score += Math.floor(r.altitude / 100);
  const i = PHASES.indexOf(m.phase as Exclude<Phase, "done">);
  m.phase = i < 0 || i + 1 >= PHASES.length ? "done" : PHASES[i + 1]!;
  m.t = 0;
  m.debris = [];
  ev.push({ kind: "phase", phase: m.phase });
}

/** Seconds left in the current phase. */
export function phaseLeft(m: Match) {
  return m.phase === "done" ? 0 : Math.max(0, m.timing[m.phase] - m.t);
}

export interface Award { id: string; title: string; emoji: string; line: string }

/** Fun awards for the podium: each goes to the best player at it (ties: the first), at most one per player when possible. */
export function awards(m: Match, name: (id: string) => string): Award[] {
  const out: Award[] = [];
  const used = new Set<string>();
  const pick = (key: (r: Rocket) => number, title: string, emoji: string, line: (r: Rocket) => string) => {
    const ranked = [...m.rockets].filter((r) => key(r) > 0).sort((a, b) => key(b) - key(a));
    const r = ranked.find((x) => !used.has(x.id)) ?? ranked[0];
    if (!r) return;
    used.add(r.id);
    out.push({ id: r.id, title, emoji, line: line(r) });
  };
  pick((r) => r.reps, "Squat Champion", "🏋️", (r) => `${name(r.id)} lifted the rocket ${r.reps} times!`);
  pick((r) => r.bestCombo, "Rhythm Master", "🎵", (r) => `${name(r.id)} kept a ${r.bestCombo}× combo going`);
  pick((r) => r.dodges * 2 + r.perfectDodges, "Dodge Ace", "☄️", (r) => `${name(r.id)} dodged ${r.dodges} meteor${r.dodges === 1 ? "" : "s"}`);
  pick((r) => r.jacks, "Shield Hero", "🛡️", (r) => `${name(r.id)} powered the shield with ${r.jacks} jacks`);
  pick((r) => r.perfect, "Perfect Form", "✨", (r) => `${name(r.id)}: ${r.perfect} perfect reps`);
  pick((r) => r.stars, "Star Catcher", "⭐", (r) => `${name(r.id)} grabbed ${r.stars} star${r.stars === 1 ? "" : "s"}`);
  return out;
}

/** A playful energy estimate (not a measurement): roughly 0.3 kcal per squat, 0.2 per jump or jack. */
export function funKcal(r: Rocket) {
  return Math.round(r.reps * 0.32 + r.dodges * 0.2 + r.jacks * 0.2 + r.warm * 0.1);
}
