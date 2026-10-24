/**
 * The broadcast director: which camera shows what (bowler's-end view for the delivery, a ball-tracking camera
 * behind the batter for the shot, a second angle in slow motion for replays), and the replay clock. Pure maths
 * on the game state; the views smooth the result.
 */
import { at } from "../sim/delivery";
import type { Game } from "../sim/game";

export type V3 = [number, number, number];
export interface CamRig { position: V3; target: V3; fovDeg: number }
export type CamName = "broadcast" | "shot" | "side";
export interface LaneMeta {
  cameras: Record<CamName, CamRig>;
  spectators: Array<{ x: number; y: number; z: number; side: number }>;
  sun: V3;
}

/** Replay speed (slow motion) and how long before the moment a replay starts. */
export const REPLAY_RATE = 0.5;

/** The game as it looked `g.pt` seconds into a replay: the same ball, re-run in slow motion. */
export function replayView(g: Game): Game {
  const b = g.replayOf ?? g.ball;
  if (!b || g.phase !== "replay") return g;
  const tr = g.pt * REPLAY_RATE;
  if (b.play) {
    const t = Math.max(0, tr - 0.25);
    return { ...g, phase: t < 0.001 ? "delivery" : "play", pt: tr, ball: { ...b, t: t < 0.001 ? b.delivery!.tContact - 0.25 + tr : t } };
  }
  const d = b.delivery!;
  return { ...g, phase: "delivery", pt: tr, ball: { ...b, t: Math.min(d.tStumps + 0.4, d.tContact - 0.5 + tr) } };
}

/** Which lite backdrop (pre-rendered camera) fits the moment. */
export function liteCamera(g: Game): CamName {
  switch (g.phase) {
    case "aim": case "runup": case "delivery": return "broadcast";
    case "play": return "shot";
    case "result": return g.ball?.play ? "shot" : "broadcast";
    case "replay": return "side";
    default: return "shot";
  }
}

const lerp = (a: V3, b: V3, k: number): V3 => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

/** A free camera for the real-time tiers (high/ultra): position, target and field of view for this moment. */
export function freeCamera(g: Game, lane: LaneMeta, ball: { x: number; y: number; z: number } | null): CamRig & { cut: string } {
  const C = lane.cameras;
  const b = g.ball;
  switch (g.phase) {
    case "intro": {
      // a crane down the lane from above the far end to the bowler's end
      const k = Math.min(1, g.pt / Math.max(0.5, g.timings.intro));
      const e = k * k * (3 - 2 * k);
      return { position: lerp([0, 14, -40], C.broadcast.position, e), target: lerp([0, 2, -12], C.broadcast.target, e), fovDeg: 50 - 29 * e, cut: "intro" };
    }
    case "innings": case "break": {
      const k = Math.min(1, g.pt / 3);
      return { position: lerp([2.5, 4.2, 4.6], [1.2, 3.6, 3.2], k), target: [0, 1.6, -14], fovDeg: 46, cut: "innings" };
    }
    case "aim": case "runup": case "delivery": {
      const push = g.phase === "delivery" ? Math.min(1, (b?.t ?? 0) / 0.9) : 0;
      return { position: C.broadcast.position, target: C.broadcast.target, fovDeg: C.broadcast.fovDeg - push * 2.5, cut: "broadcast" };
    }
    case "play": case "result": {
      if (!b?.play || !ball) return { ...C.broadcast, cut: "broadcast" };
      return track(ball, b.shot?.edge ?? false);
    }
    case "replay": {
      const rv = replayView(g);
      const rb = rv.ball!;
      const pos = rb.play && rv.phase === "play" ? at(rb.play.path, rb.t, 60) : at(rb.delivery!.path, rb.t);
      // low and close from square leg, swinging round as the ball goes
      const k = Math.min(1, g.pt / Math.max(1, g.timings.replay));
      const ang = -2.2 + k * 0.7;
      const r = 5.2 - k * 0.8;
      const base: V3 = [Math.sin(ang) * r, 1.5 + k * 0.6, -1.0 + Math.cos(ang) * r];
      const far = pos.z < -8;
      return far
        ? { position: [pos.x * 0.4 + 1.5, 3 + pos.y * 0.5, pos.z + 10], target: [pos.x, pos.y, pos.z], fovDeg: 40, cut: "replay-follow" }
        : { position: base, target: [pos.x * 0.5, 0.9 + pos.y * 0.3, (pos.z - 1) * 0.5], fovDeg: 34, cut: "replay" };
    }
    case "podium":
      return { position: [0, 1.9, -9.2], target: [0, 1.0, -3.4], fovDeg: 36, cut: "podium" };
  }
}

function track(ball: { x: number; y: number; z: number }, edge: boolean): CamRig & { cut: string } {
  if (edge || ball.z > 1) {
    return { position: [-3.4, 2.6, -4.5], target: [ball.x, Math.max(0.6, ball.y), ball.z], fovDeg: 44, cut: "track-behind" };
  }
  // behind and above the batter, dollying down the lane after the ball
  const z = Math.max(-17, Math.min(5.6, ball.z + 11));
  return {
    position: [ball.x * 0.35, 4.6 + Math.min(4, ball.y * 0.35), z],
    target: [ball.x * 0.8, Math.max(1, ball.y * 0.85), ball.z - 2],
    fovDeg: 46, cut: "track",
  };
}
