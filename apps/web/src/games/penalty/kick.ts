import {
  DIVE_REACH, aimToGoal, ballAt, clamp, keeperBody, makeShot, resolve,
  type Dive, type Outcome, type Shot, type Vec,
} from "./geometry";

/**
 * One penalty kick, pure: intro → aim → flight → result → done, advanced in fixed steps (seconds).
 * The keeper may commit early (a hidden guess, carried out the moment the ball is struck) or react
 * once the ball is in the air. Only the first dive counts.
 */
export type KickPhase = "intro" | "aim" | "flight" | "result" | "done";

export interface KickTiming { intro: number; aim: number; result: number }
export const NORMAL_TIMING: KickTiming = { intro: 1.6, aim: 9, result: 2.6 };
export const QUICK_TIMING: KickTiming = { intro: 1, aim: 7, result: 1.6 };

/** Crosshair speed with the joystick (normalised aim units per second) and the KICK charge rate. */
export const AIM_SPEED = 1.25;
export const CHARGE_PER_S = 1 / 1.05;
export const MAX_CHARGE = 1.3;
/** Power when the aim timer runs out before the kicker shoots. */
export const TIMEOUT_POWER = 0.6;

export interface KickState {
  timing: KickTiming;
  phase: KickPhase;
  /** Time in the current phase. */
  t: number;
  /** Normalised aim: x -1…1 (posts at ±0.89), y 0 (ground) … 1 (just under 2.75 m). */
  aim: Vec;
  charge: number;
  charging: boolean;
  curve: number;
  shot: Shot | null;
  flightT: number;
  guess: Dive | null;
  dive: Dive | null;
  /** Flight time when the dive began (0 for a guess). */
  diveAt: number;
  outcome: Outcome | null;
  woodwork: boolean;
}

export interface KickerInput {
  /** Joystick: moves the crosshair (ignored while charging). */
  aimVel?: Vec;
  /** Tilt / touchpad / CPU: puts the crosshair here. */
  aimAbs?: Vec;
  /** Buttons: KICK is held. Releasing it shoots with the charge so far. */
  charging?: boolean;
  /** Buttons: the joystick's x while charging bends the shot. */
  curve?: number;
  /** Motion / touchpad / CPU: shoot now. */
  shoot?: { power: number; curve: number; aim?: Vec };
}

export type KickEvent =
  | { kind: "aim" }
  | { kind: "guess"; dive: Dive }
  | { kind: "shot"; shot: Shot }
  | { kind: "dive"; dive: Dive; early: boolean }
  | { kind: "outcome"; outcome: Outcome; woodwork: boolean; ball: Vec }
  | { kind: "done" };

export function newKick(timing: KickTiming = NORMAL_TIMING): KickState {
  return {
    timing, phase: "intro", t: 0, aim: { x: 0, y: 0.35 }, charge: 0, charging: false, curve: 0,
    shot: null, flightT: 0, guess: null, dive: null, diveAt: 0, outcome: null, woodwork: false,
  };
}

const clampAim = (a: Vec): Vec => ({ x: clamp(a.x, -1.1, 1.1), y: clamp(a.y, 0, 1.1) });

function strike(k: KickState, power: number, curve: number, rand: () => number, ev: KickEvent[]) {
  const g = aimToGoal(k.aim.x, k.aim.y);
  k.shot = makeShot(g, power, curve, rand);
  k.phase = "flight";
  k.t = 0;
  k.flightT = 0;
  k.charging = false;
  ev.push({ kind: "shot", shot: k.shot });
  if (k.guess) {
    k.dive = k.guess;
    k.diveAt = 0;
    ev.push({ kind: "dive", dive: k.dive, early: true });
  }
}

/** Advances the kick by `dt` seconds with this step's kicker and keeper inputs. */
export function stepKick(k: KickState, dt: number, kicker: KickerInput, keeperDive: Dive | null, rand: () => number): KickEvent[] {
  const ev: KickEvent[] = [];
  k.t += dt;
  if (k.phase === "intro") {
    if (k.t >= k.timing.intro) {
      k.phase = "aim";
      k.t = 0;
      ev.push({ kind: "aim" });
    }
    return ev;
  }
  if (k.phase === "aim") {
    if (keeperDive && !k.guess) {
      k.guess = keeperDive;
      ev.push({ kind: "guess", dive: keeperDive });
    }
    if (kicker.aimAbs) k.aim = clampAim(kicker.aimAbs);
    if (kicker.charging) {
      k.charging = true;
      k.charge = Math.min(MAX_CHARGE, k.charge + dt * CHARGE_PER_S);
      k.curve = clamp(kicker.curve ?? 0, -1, 1);
    } else {
      if (k.charging) {
        strike(k, k.charge, k.curve, rand, ev); // KICK released
        return ev;
      }
      if (kicker.aimVel) k.aim = clampAim({ x: k.aim.x + kicker.aimVel.x * AIM_SPEED * dt, y: k.aim.y + kicker.aimVel.y * AIM_SPEED * 0.8 * dt });
    }
    if (kicker.shoot) {
      if (kicker.shoot.aim) k.aim = clampAim(kicker.shoot.aim);
      strike(k, kicker.shoot.power, kicker.shoot.curve, rand, ev);
    } else if (k.t >= k.timing.aim) {
      strike(k, k.charging ? k.charge : TIMEOUT_POWER, k.charging ? k.curve : 0, rand, ev);
    }
    return ev;
  }
  if (k.phase === "flight") {
    const shot = k.shot!;
    k.flightT += dt;
    if (keeperDive && !k.dive) {
      k.dive = keeperDive;
      k.diveAt = k.flightT;
      ev.push({ kind: "dive", dive: keeperDive, early: false });
    }
    if (k.flightT >= shot.time) {
      const ball = ballAt(shot, 1);
      const r = resolve(ball, keeperBody(k.dive, shot.time - k.diveAt));
      k.outcome = r.outcome;
      k.woodwork = r.woodwork;
      k.phase = "result";
      k.t = 0;
      ev.push({ kind: "outcome", outcome: r.outcome, woodwork: r.woodwork, ball: { x: ball.x, y: ball.y } });
    }
    return ev;
  }
  if (k.phase === "result" && k.t >= k.timing.result) {
    k.phase = "done";
    ev.push({ kind: "done" });
  }
  return ev;
}

// ---- CPU ---------------------------------------------------------------------------------

export interface CpuKickPlan { aim: Vec; power: number; curve: number; at: number }

/** The CPU kicker picks a spot (mostly towards a side), a power and when to shoot. */
export function cpuKickPlan(rand: () => number): CpuKickPlan {
  const side = rand() < 0.5 ? -1 : 1;
  const middle = rand() < 0.15;
  return {
    aim: { x: middle ? (rand() - 0.5) * 0.3 : side * (0.3 + rand() * 0.58), y: 0.06 + rand() * 0.72 },
    power: 0.7 + rand() * 0.27,
    curve: (rand() - 0.5) * 0.5,
    at: 1.3 + rand() * 1.5,
  };
}

/** The CPU kicker's input this step: glide the crosshair to the spot, then shoot. */
export function cpuKickerInput(plan: CpuKickPlan, k: KickState): KickerInput {
  if (k.phase !== "aim") return {};
  const f = Math.min(1, k.t / Math.max(0.1, plan.at - 0.3));
  const aim = { x: plan.aim.x * f, y: 0.35 + (plan.aim.y - 0.35) * f };
  return k.t >= plan.at ? { shoot: { power: plan.power, curve: plan.curve, aim: plan.aim } } : { aimAbs: aim };
}

export interface CpuKeepPlan {
  /** Commit to this dive before the shot (a guess), or null to wait and react. */
  guess: Dive | null;
  guessAt: number;
  reaction: number;
  /** Misjudgement of the ball's line (metres). */
  errX: number;
  errY: number;
}

/** The CPU keeper guesses about 40% of the time, otherwise reacts like a person would (0.32–0.48 s). */
export function cpuKeepPlan(rand: () => number, skill = 0.6): CpuKeepPlan {
  const guessing = rand() < 0.4;
  const side = rand() < 0.5 ? -1 : 1;
  return {
    guess: guessing ? { dx: side, dy: (rand() - 0.5) * 1.2 } : null,
    guessAt: 0.8 + rand() * 1.5,
    reaction: 0.32 + rand() * 0.18 * (1.5 - skill),
    errX: (rand() - 0.5) * 1.4 * (1.2 - skill),
    errY: (rand() - 0.5) * 0.9 * (1.2 - skill),
  };
}

/** The CPU keeper's dive this step (or null). It reads the ball's line, and is partly fooled by curl. */
export function cpuKeeperDive(plan: CpuKeepPlan, k: KickState): Dive | null {
  if (k.dive || k.guess) return null;
  if (k.phase === "aim") return plan.guess && k.t >= plan.guessAt ? plan.guess : null;
  if (k.phase !== "flight" || !k.shot || k.flightT < plan.reaction) return null;
  const seenX = k.shot.target.x - k.shot.curve * 0.9 * 0.6 + plan.errX;
  const seenY = k.shot.target.y + plan.errY;
  if (Math.abs(seenX) < 0.45 && seenY < 1.9) return null; // straight at him: stay big
  if (Math.abs(seenX) < 0.6) return { dx: 0, dy: 1 };       // high and central: jump
  return { dx: clamp(seenX / DIVE_REACH, -1, 1), dy: clamp((seenY - 1.05) / 0.62, -1, 1) };
}
