/**
 * Everything that moves, as plain poses (world position, yaw, roll, tumble), computed from the live race or from
 * a replay frame, so the same drawing code serves both. Pure maths on top of the track.
 */
import { toWorld, type Track, type WorldPoint } from "./track";
import { driftLevel, type Kind } from "./racer";
import type { Race } from "./race";
import { TRAFFIC_SIZE, type TrafficKind } from "./traffic";
import { goatAt, racerAt, trafficAt } from "./replay";

export interface RacerPose {
  id: string;
  kind: Kind;
  color: string;
  x: number; y: number; z: number;
  /** Body yaw (world, three.js convention). */
  yaw: number;
  /** Travel heading (world). */
  travel: number;
  roll: number;
  pitch: number;
  /** Wreck tumble angle (rad) and hop height. */
  tumble: number;
  hop: number;
  speed: number;
  drift: number;
  level: 0 | 1 | 2 | 3;
  boosting: boolean;
  wrecked: boolean;
  shield: boolean;
  visible: boolean;
}

export interface TrafficPose { kind: TrafficKind; x: number; y: number; z: number; yaw: number; look: number; len: number }
export interface GoatPose { x: number; y: number; z: number; yaw: number; hop: number; tumble: number }

const w: WorldPoint = { x: 0, y: 0, z: 0, heading: 0 };

function racerPose(t: Track, id: string, kind: Kind, color: string, s: number, d: number, a: number, slip: number, y: number,
  wreckT: number, spinT: number, boosting: boolean, v: number, drift: number, level: 0 | 1 | 2 | 3, shieldT: number, steer: number, time: number): RacerPose {
  toWorld(t, s, d, w);
  const travel = w.heading - a;
  let yaw = w.heading - (a + slip);
  if (spinT > 0) yaw += spinT * 9;
  const tumble = wreckT > 0 ? (1.25 - wreckT) * 7 : 0;
  const hop = wreckT > 0 ? Math.max(0, Math.sin(Math.min(1, (1.25 - wreckT) / 0.9) * Math.PI) * 2.2) : 0;
  return {
    id, kind, color, x: w.x, y: y + hop, z: w.z, yaw, travel, roll: -steer * 0.08 - drift * 0.06, pitch: 0, tumble, hop, speed: v,
    drift, level, boosting, wrecked: wreckT > 0, shield: shieldT > 0 && Math.floor(time * 12) % 2 === 0, visible: true,
  };
}

/** Poses of every racer in the live race. `colors` maps racer id → player colour. */
export function liveRacers(race: Race, colors: Map<string, string>, out: RacerPose[] = []): RacerPose[] {
  out.length = 0;
  for (const r of race.racers) {
    out.push(racerPose(race.track, r.id, r.kind, colors.get(r.id) ?? "#ffffff", r.s, r.d, r.a, r.slip, r.y, r.wreckT, r.spinT,
      r.boostT > 0 || r.turboT > 0, r.v, r.drift, driftLevel(r), r.shieldT, r.steer, race.time));
  }
  return out;
}

export function liveTraffic(race: Race, out: TrafficPose[] = []): TrafficPose[] {
  out.length = 0;
  for (const c of race.traffic) {
    toWorld(race.track, c.s, c.d, w);
    out.push({ kind: c.kind, x: w.x, y: w.y, z: w.z, yaw: c.dir === 1 ? w.heading : w.heading + Math.PI, look: c.look, len: TRAFFIC_SIZE[c.kind].len });
  }
  return out;
}

export function liveGoats(race: Race, out: GoatPose[] = []): GoatPose[] {
  out.length = 0;
  for (const g of race.goats) {
    toWorld(race.track, g.s, g.d, w);
    const tumble = g.bumped > 0 ? g.bumped * 8 : 0;
    const hop = g.bumped > 0 ? Math.max(0, Math.sin(Math.min(1, g.bumped / 1.2) * Math.PI) * 3) : g.hop > 0 ? Math.sin((g.hop / 0.5) * Math.PI) * 0.8 : Math.abs(Math.sin(race.time * 9 + g.id)) * 0.06;
    out.push({ x: w.x, y: w.y + hop, z: w.z, yaw: w.heading + (g.vd >= 0 ? -Math.PI / 2 : Math.PI / 2), hop, tumble });
  }
  return out;
}

/** Poses from a recorded replay frame (racers in race order). */
export function replayPoses(race: Race, f: Float32Array, colors: Map<string, string>, time: number) {
  const racers: RacerPose[] = race.racers.map((r, i) => {
    const p = racerAt(f, i);
    return racerPose(race.track, r.id, r.kind, colors.get(r.id) ?? "#fff", p.s, p.d, p.a, p.slip, p.y, p.wreckT, p.spinT, p.boosting, 30, 0, 0, 0, 0, time);
  });
  const traffic: TrafficPose[] = race.traffic.map((c, i) => {
    const p = trafficAt(f, race.racers.length, i);
    toWorld(race.track, p.s, p.d, w);
    return { kind: c.kind, x: w.x, y: w.y, z: w.z, yaw: c.dir === 1 ? w.heading : w.heading + Math.PI, look: c.look, len: TRAFFIC_SIZE[c.kind].len };
  });
  const goats: GoatPose[] = [];
  for (let i = 0; i < 8; i++) {
    const g = goatAt(f, race.racers.length, race.traffic.length, i);
    if (!g) continue;
    toWorld(race.track, g.s, g.d, w);
    goats.push({ x: w.x, y: w.y, z: w.z, yaw: w.heading + Math.PI / 2, hop: 0, tumble: g.bumped * 8 });
  }
  return { racers, traffic, goats };
}
