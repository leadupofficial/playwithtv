/**
 * CPU racers: take the inside line into corners, drift through the hairpins for a mini-turbo, dodge traffic
 * and goats, use items when they make sense, boost on straights, and shoulder-barge a rival now and then.
 * Pure: reads the race, returns an input.
 */
import { curvAhead, frameAt, type Frame } from "./track";
import { ASSIST, DRIFT_YAW, KINDS, driftLevel, type Racer, type RacerInput } from "./racer";
import { gapTo, TRAFFIC_SIZE } from "./traffic";
import type { Race } from "./race";

export interface Brain {
  /** Personality: how late it brakes for corners, how keen it is to barge. */
  line: number;
  aggro: number;
  /** Wobble so CPUs don't drive like trains. */
  wobble: number;
  wobbleT: number;
  itemDelay: number;
}

export function newBrain(seed: number): Brain {
  const r = (k: number) => ((Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453) % 1 + 1) % 1;
  return { line: 0.25 + r(1) * 0.3, aggro: 0.2 + r(2) * 0.6, wobble: 0, wobbleT: r(3) * 3, itemDelay: 0.5 + r(4) * 1.5 };
}

const fr: Frame = { x: 0, y: 0, z: 0, heading: 0, curv: 0, slope: 0, hw: 0, i: 0 };

export function cpuInput(race: Race, r: Racer, b: Brain, dt: number): RacerInput {
  const t = race.track;
  const k = KINDS[r.kind];
  frameAt(t, r.s, fr);
  const hw = fr.hw;
  b.wobbleT -= dt;
  if (b.wobbleT <= 0) {
    b.wobbleT = 1.5 + race.rnd() * 2.5;
    b.wobble = (race.rnd() - 0.5) * 0.5;
  }
  // the line: inside of the next corner, else the middle (with a wobble)
  const look = 18 + r.v * 0.9;
  const ahead = curvAhead(t, r.s + 6, look);
  let target = Math.abs(ahead) > 0.008 ? -Math.sign(ahead) * hw * b.line : b.wobble * hw * 0.5;

  // traffic and goats ahead in our path: pick the other side
  for (const c of race.traffic) {
    const g = gapTo(t, r.s, c.s);
    const reach = c.dir === 1 ? 40 : 70;
    if (g < -3 || g > reach) continue;
    const half = TRAFFIC_SIZE[c.kind].wid / 2 + k.wid / 2 + 0.9;
    if (Math.abs(target - c.d) < half) target = c.d + (c.d > 0 ? -half - 0.3 : half + 0.3);
  }
  for (const g of race.goats) {
    const gap = gapTo(t, r.s, g.s);
    if (gap < 0 || gap > 30 || g.bumped) continue;
    if (Math.abs(target - g.d) < 2) target = g.d + (g.d > 0 ? -2.4 : 2.4);
  }
  // barge: drift towards a rival alongside
  let barge: Racer | null = null;
  if (b.aggro > 0.45) {
    for (const o of race.racers) {
      if (o === r || o.wreckT > 0 || o.finishedAt !== null) continue;
      const ds = o.s - r.s;
      if (Math.abs(ds) < 2.5 && Math.abs(o.d - r.d) < 3.2) barge = o;
    }
  }
  if (barge) target = barge.d;
  target = Math.max(-hw + k.wid, Math.min(hw - k.wid, target));

  // steer: pursue a point on the target line ahead, inverting the vehicle model for the yaw rate it needs
  const L = 8 + r.v * 0.45;
  const wantA = Math.atan2(target - r.d, L);
  const sv = Math.max(1, r.v * Math.cos(r.a));
  const yawNeed = (wantA - r.a) * 3 - (1 - ASSIST) * fr.curv * sv;
  // drift in tight corners (into the turn), let go once the corner opens or a purple charge is banked
  const corner = curvAhead(t, r.s, 14);
  const tight = Math.abs(corner) > 1 / 36;
  let drift = false;
  if (r.drift) drift = tight && driftLevel(r) < 3 && Math.sign(-corner) === r.drift;
  else drift = tight && r.v > 18 && r.spinT <= 0;
  let steer: number;
  if (r.drift && drift) {
    const into = (yawNeed / r.drift - DRIFT_YAW[0]) / DRIFT_YAW[1] - 1;
    steer = Math.max(-1, Math.min(1, into)) * r.drift;
  } else if (drift) {
    steer = -Math.sign(corner); // kick into the drift
  } else {
    const sf = 0.55 + 0.45 * Math.min(1, r.v / 10);
    steer = yawNeed / (k.turn * sf);
  }
  if (r.blindT > 0) steer += Math.sin(race.time * 7 + r.slot) * 0.6;
  steer = Math.max(-1, Math.min(1, steer));

  // items and boost
  let item = false;
  if (r.item && r.rollT <= 0) {
    b.itemDelay -= dt;
    if (b.itemDelay <= 0) {
      const behind = race.racers.some((o) => o !== r && r.s - o.s > 2 && r.s - o.s < 35);
      const trafficAhead = race.traffic.some((c) => { const g = gapTo(t, r.s, c.s); return g > 0 && g < 80; });
      item = r.item === "chai" || (r.item === "horn" && trafficAhead) || ((r.item === "coconut" || r.item === "splash") && behind) || b.itemDelay < -6;
      if (item) b.itemDelay = 0.5 + race.rnd() * 1.5;
    }
  }
  const straight = Math.abs(curvAhead(t, r.s, 60)) < 0.012;
  const boost = r.meter >= 0.34 && straight && r.boostT <= 0 && race.rnd() < 0.05;
  return { steer, drift, boost, item };
}
