/**
 * The match director: phases and their timing (intro → innings card → per ball: aim → run-up → delivery → play →
 * result → replay → … → innings break → chase → bowl-out if tied → podium), CPU decisions, and the events the
 * TV turns into pictures, sound and commentary. Pure: step(game, dt, inputs) with a fixed time step.
 */
import { at, deliver, type BowlPlan, type Delivery } from "./delivery";
import { defaultFielders, playOut, type Play, type PlayEvent } from "./fielding";
import { cpuBowlPlan, cpuSwing } from "./cpu";
import { bowler, newMatch, nonStriker, recordBall, recordBowlOut, striker, fielding, type BallResult, type Match, type MatchConfig, type Member } from "./match";
import { WINDOW, playShot, type Shot, type Swing, type Timing } from "./shot";
import { LANE, rng } from "./lane";
import type { Moment } from "./commentary";

export type Phase = "intro" | "innings" | "aim" | "runup" | "delivery" | "play" | "result" | "replay" | "break" | "podium";

export interface Timings { intro: number; innings: number; aimMax: number; cpuAim: number; runup: number; result: number; replay: number; break: number }
export const NORMAL: Timings = { intro: 4.2, innings: 2.6, aimMax: 10, cpuAim: 1.5, runup: 1.15, result: 2.2, replay: 3.6, break: 3.6 };
export const QUICK: Timings = { intro: 1.6, innings: 1.4, aimMax: 7, cpuAim: 0.8, runup: 1.0, result: 1.5, replay: 2.6, break: 2.2 };

export interface Ball {
  n: number;
  bowlOut: boolean;
  batter: string | null;
  bowler: string;
  partner: string | null;
  /** The bowler's live aim (from the phone or the CPU). */
  aim: BowlPlan;
  delivery: Delivery | null;
  /** Seconds since the release (delivery) or the bat (play). */
  t: number;
  swing: (Swing & { at: number }) | null;
  timing: Timing | null;
  shot: Shot | null;
  play: Play | null;
  /** Index of the next play event to emit. */
  next: number;
  result: BallResult | null;
  moment: Moment | null;
  fielders: Array<{ id: string | null; home: { x: number; y: number; z: number } }>;
  /** A CPU batter's planned swing. */
  cpu: (Swing & { at: number }) | null;
}

export type GameEvent =
  | { kind: "phase"; phase: Phase }
  | { kind: "release"; ball: Ball }
  | { kind: "pitch"; ball: Ball }
  | { kind: "swing"; timing: Timing; batter: string; contact: boolean }
  | { kind: "hit"; shot: Shot; ball: Ball }
  | { kind: "play"; ev: PlayEvent }
  | { kind: "stumps"; ball: Ball }
  | { kind: "result"; ball: Ball; moment: Moment }
  | { kind: "innings"; batting: 0 | 1 }
  | { kind: "over" };

export interface Game {
  match: Match;
  phase: Phase;
  /** Seconds in the current phase. */
  pt: number;
  timings: Timings;
  ball: Ball | null;
  /** Ball counter (for commentary variety). */
  count: number;
  rand: () => number;
  replayOf: Ball | null;
}

export interface Inputs {
  /** The human bowler's aim (merged into the live aim). */
  aim?: Partial<BowlPlan>;
  release?: boolean;
  /** A human swing; `lag` = seconds to subtract (detection + network + display latency). */
  swing?: Swing & { lag: number };
}

export function newGame(members: Member[], cfg: MatchConfig, opts: { quick?: boolean; seed?: number } = {}): Game {
  const seed = opts.seed ?? 1;
  return { match: newMatch(members, cfg, 0), phase: "intro", pt: 0, timings: opts.quick ? QUICK : NORMAL, ball: null, count: 0, rand: rng(seed), replayOf: null };
}

const isCpu = (g: Game, id: string | null) => !id || !!g.match.members.get(id)?.cpu;

function go(g: Game, phase: Phase, ev: GameEvent[]) {
  g.phase = phase;
  g.pt = 0;
  ev.push({ kind: "phase", phase });
}

function newBall(g: Game): Ball {
  const m = g.match;
  const bowlOut = m.stage === 2;
  const bw = bowler(m);
  const fieldTeam = bowlOut ? (m.bowlOut.turn === 0 ? 1 : 0) : fielding(m);
  const others = m.teams[fieldTeam].members.filter((id) => id !== bw);
  const homes = defaultFielders();
  g.count++;
  return {
    n: g.count, bowlOut, batter: bowlOut ? null : striker(m), bowler: bw, partner: bowlOut ? null : nonStriker(m),
    aim: { line: 0, length: 0.45, kind: "pace" }, delivery: null, t: 0, swing: null, timing: null, shot: null, play: null, next: 0,
    result: null, moment: null, cpu: null,
    fielders: homes.map((home, i) => ({ id: i === homes.length - 1 ? bw : (others[i] ?? null), home })),
  };
}

/** Advances the match by dt seconds. Returns what happened (for pictures, sound and commentary). */
export function step(g: Game, dt: number, input: Inputs = {}): GameEvent[] {
  const ev: GameEvent[] = [];
  const T = g.timings;
  g.pt += dt;
  const b = g.ball;
  switch (g.phase) {
    case "intro":
      if (g.pt >= T.intro) {
        ev.push({ kind: "innings", batting: g.match.batting });
        go(g, "innings", ev);
      }
      break;
    case "innings":
    case "break":
      if (g.pt >= (g.phase === "break" ? T.break : T.innings)) startBall(g, ev);
      break;
    case "aim": {
      if (input.aim && !isCpu(g, b!.bowler)) Object.assign(b!.aim, input.aim);
      const cpu = isCpu(g, b!.bowler);
      if ((cpu && g.pt >= T.cpuAim) || (!cpu && (input.release || g.pt >= T.aimMax))) {
        if (cpu) b!.aim = cpuBowlPlan(g.rand, b!.bowlOut);
        b!.delivery = deliver(b!.aim, g.rand, cpu ? 0.08 : 0.05);
        if (b!.batter && isCpu(g, b!.batter)) b!.cpu = cpuSwing(b!.delivery, g.rand);
        ev.push({ kind: "release", ball: b! });
        go(g, "runup", ev);
      }
      break;
    }
    case "runup":
      if (input.swing) takeSwing(g, input.swing);
      if (g.pt >= T.runup) {
        b!.t = 0;
        go(g, "delivery", ev);
      }
      break;
    case "delivery":
      delivery(g, dt, input, ev);
      break;
    case "play": {
      const p = b!.play!;
      b!.t += dt;
      while (b!.next < p.events.length && p.events[b!.next]!.t <= b!.t) ev.push({ kind: "play", ev: p.events[b!.next++]! });
      if (b!.t >= p.duration) finishBall(g, ev);
      break;
    }
    case "result":
      if (g.pt >= T.result) {
        const r = b!.result!;
        const big = r.kind === "six" || r.kind === "window" || (r.wicket && r.wicket !== "runout");
        if (big && !b!.bowlOut) {
          g.replayOf = b;
          go(g, "replay", ev);
        } else next(g, ev);
      }
      break;
    case "replay":
      if (g.pt >= T.replay) next(g, ev);
      break;
    case "podium":
      break;
  }
  return ev;
}

function startBall(g: Game, ev: GameEvent[]) {
  g.ball = newBall(g);
  go(g, "aim", ev);
}

function takeSwing(g: Game, s: Swing & { lag: number }) {
  const b = g.ball!;
  if (!b.delivery || b.swing || !b.batter) return;
  const swingAt = (g.phase === "runup" ? -(g.timings.runup - g.pt) : b.t) - s.lag;
  // swings long before the ball arrives don't count (a twitch, or practising): the batter can swing again
  if (swingAt < b.delivery.tContact - 0.6) return;
  const { lag: _lag, ...swing } = s;
  b.swing = { ...swing, at: swingAt, dtMs: (swingAt - b.delivery.tContact) * 1000 };
}

function delivery(g: Game, dt: number, input: Inputs, ev: GameEvent[]) {
  const b = g.ball!;
  const d = b.delivery!;
  const before = b.t;
  b.t += dt;
  if (before < d.tBounce && b.t >= d.tBounce) ev.push({ kind: "pitch", ball: b });
  if (b.bowlOut) {
    if (b.t >= d.tStumps) {
      const hit = d.hitsStumps;
      if (hit) ev.push({ kind: "stumps", ball: b });
      settle(g, { runs: 0, extras: 0, wicket: null, kind: "dot", bonus: 0 }, hit ? "bowlout-hit" : "bowlout-miss", ev);
    }
    return;
  }
  if (input.swing) takeSwing(g, input.swing);
  if (!b.swing && b.cpu && b.t >= b.cpu.at) b.swing = b.cpu;
  const late = WINDOW.late / 1000;
  const decideBy = d.tContact + late + LATEST_SWING;
  if (b.swing && b.timing === null && b.t >= Math.max(b.swing.at, d.tContact)) resolveSwing(g, ev);
  if (b.timing === null && b.t >= (b.swing ? d.tContact + late : decideBy)) {
    b.timing = "miss"; // no swing in time
    if (b.swing) ev.push({ kind: "swing", timing: "miss", batter: b.batter!, contact: false });
  }
  if (b.shot?.contact) return;
  if (b.timing === null) return; // a swing may still be on its way: nothing is out or past the bat yet
  // missed (or left): the bricks, or the keeper
  if (b.t >= d.tStumps && b.result === null && d.hitsStumps) {
    ev.push({ kind: "stumps", ball: b });
    settle(g, { runs: 0, extras: 0, wicket: "bowled", kind: "miss", bonus: 0 }, "bowled", ev);
    return;
  }
  if (b.result === null && at(d.path, b.t).z >= FIELD_KEEPER_Z - 0.3) {
    if (d.wide) settle(g, { runs: 0, extras: 1, wicket: null, kind: "wide", bonus: 0 }, "wide", ev);
    else settle(g, { runs: 0, extras: 0, wicket: null, kind: "miss", bonus: 0 }, b.swing ? "miss" : "dot", ev);
  }
}

const FIELD_KEEPER_Z = 2.3;

/**
 * Seconds past the late window that the ball waits for a swing still on its way: the slowest controller's lag
 * (motion: 0.12 s, controls.ts SWING_LAG) plus 0.08 s of Wi-Fi jitter. A swing made in time but delivered late
 * is judged at the moment it was made; only after this does a ball with no swing count as missed, bowled or
 * taken by the keeper.
 */
export const LATEST_SWING = 0.2;

function resolveSwing(g: Game, ev: GameEvent[]) {
  const b = g.ball!;
  const d = b.delivery!;
  const shot = playShot(d, b.swing!, g.rand);
  b.timing = shot.timing;
  b.shot = shot;
  ev.push({ kind: "swing", timing: shot.timing, batter: b.batter!, contact: shot.contact });
  if (!shot.contact) return;
  b.play = playOut(shot.p0, shot.v0, b.fielders.map((f) => f.home), g.rand, { defended: shot.defended });
  b.t = 0;
  b.next = 0;
  ev.push({ kind: "hit", shot, ball: b });
  go(g, "play", ev);
}

function finishBall(g: Game, ev: GameEvent[]) {
  const b = g.ball!;
  const p = b.play!;
  const shot = b.shot!;
  const catcher = p.fielder !== null ? b.fielders[p.fielder]?.id ?? null : null;
  const perfect = shot.timing === "perfect";
  let r: BallResult, moment: Moment;
  switch (p.kind) {
    case "six": r = { runs: 6, extras: 0, wicket: null, kind: "six", bonus: 0, perfect }; moment = p.events.some((e) => e.kind === "roof") ? "roof" : "six"; break;
    case "window": r = { runs: 6, extras: 0, wicket: null, kind: "window", bonus: p.bonus, perfect }; moment = "window"; break;
    case "four": r = { runs: 4, extras: 0, wicket: null, kind: "four", bonus: 0, perfect }; moment = "four"; break;
    case "caught": {
      const behind = shot.edge && p.fielder === 0;
      r = { runs: 0, extras: 0, wicket: behind ? "caught-behind" : "caught", kind: "caught", bonus: 0, catcher };
      moment = behind ? "caught-behind" : "caught";
      break;
    }
    case "one-bounce": r = { runs: 0, extras: 0, wicket: "one-bounce", kind: "one-bounce", bonus: 0, catcher }; moment = "one-bounce"; break;
    case "runout": r = { runs: p.runs, extras: 0, wicket: "runout", kind: "runout", bonus: 0 }; moment = "runout"; break;
    default: {
      r = { runs: p.runs, extras: 0, wicket: null, kind: p.kind, bonus: 0, perfect };
      const dropped = p.events.some((e) => e.kind === "drop");
      moment = dropped ? "drop" : p.runs === 0 ? (shot.defended ? "defend" : "dot") : (["one", "two", "three"] as const)[Math.min(2, p.runs - 1)]!;
    }
  }
  settle(g, r, moment, ev);
}

function settle(g: Game, r: BallResult, moment: Moment, ev: GameEvent[]) {
  const b = g.ball!;
  b.result = r;
  b.moment = moment;
  ev.push({ kind: "result", ball: b, moment });
  go(g, "result", ev);
}

function next(g: Game, ev: GameEvent[]) {
  const m = g.match;
  const b = g.ball!;
  if (b.bowlOut) {
    if (recordBowlOut(m, b.moment === "bowlout-hit", g.rand)) return over(g, ev);
    return startBall(g, ev);
  }
  const out = recordBall(m, b.result!);
  if (out.matchOver) return over(g, ev);
  if (out.inningsOver) {
    ev.push({ kind: "innings", batting: m.batting });
    return go(g, "break", ev);
  }
  startBall(g, ev);
}

function over(g: Game, ev: GameEvent[]) {
  ev.push({ kind: "over" });
  go(g, "podium", ev);
}

/** Where the ball is now (for cameras and the shadow), or null when it is not in play. */
export function ballPosition(g: Game): { x: number; y: number; z: number } | null {
  const b = g.ball;
  if (!b?.delivery) return null;
  if (g.phase === "delivery" || (g.phase === "result" && !b.play)) return at(b.delivery.path, b.t);
  if ((g.phase === "play" || g.phase === "result") && b.play) return at(b.play.path, b.t, 60);
  if (g.phase === "runup" || g.phase === "aim") return { x: LANE.release.x, y: 1.2, z: LANE.release.z - 1.5 };
  return null;
}
