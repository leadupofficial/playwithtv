/**
 * Camera mode, on the phone: body landmarks (MediaPipe Pose, 33 points per frame) → moves and axes.
 *
 *   landmarks ─► One-Euro smoothing ─► visibility gate (> 0.6) ─► calibration (standing size) ─► features
 *             ─► per-move state machines (moves.ts) ─► "squat", "jump", "jack", "raise", "punch", "hands-on-head"
 *             ─► lean (axes.x), squat depth (axes.y), tracking ok (axes.ok)
 *
 * Pure TypeScript (no DOM, no camera): the unit tests drive it with synthetic bodies (synthetic.ts), and so can
 * the browser tests. Only the moves leave the phone, never the video or the landmarks.
 */
import type { PoseMove } from "@playwithtv/protocol";
import { OneEuro } from "./oneEuro";
import { HeadMachine, JackMachine, JumpMachine, PunchMachine, RaiseMachine, SquatMachine, clamp01, type Features } from "./moves";

/** BlazePose landmark indices (L/R = the player's own left and right). */
export const LM = {
  nose: 0, lShoulder: 11, rShoulder: 12, lElbow: 13, rElbow: 14, lWrist: 15, rWrist: 16,
  lHip: 23, rHip: 24, lKnee: 25, rKnee: 26, lAnkle: 27, rAnkle: 28,
} as const;
const TRACKED = Object.values(LM);
export const BONES: Array<[number, number]> = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28],
];
const STANDING_NEEDS = TRACKED;
const SEATED_NEEDS = [LM.nose, LM.lShoulder, LM.rShoulder, LM.lElbow, LM.rElbow, LM.lWrist, LM.rWrist, LM.lHip, LM.rHip];
const MIN_VIS = 0.6;

export interface Landmark { x: number; y: number; z?: number; visibility?: number }
export interface PoseInput {
  /** Milliseconds (monotonic). */
  t: number;
  /** Normalised image coordinates (0..1, y down), as MediaPipe returns them; null = nobody in view. */
  landmarks: Landmark[] | null;
  /** Frame width / height (the landmarks are normalised separately per axis). Default 4:3. */
  aspect?: number;
}

export type TrackState = "need-body" | "calibrating" | "ready" | "lost";

export interface PoseOutput {
  state: TrackState;
  /** Moves completed in this frame. */
  moves: PoseMove[];
  /** Lean, -1 (player's left) .. 1 (player's right): 0 inside ±3°, full at ±15°. */
  lean: number;
  /** Squat depth 0..1 (standing) for a live meter. */
  depth: number;
  /** Calibration progress 0..1. */
  calib: number;
  /** Form of the latest squat 0..1 (≥ 0.8 is "perfect"). */
  quality: number;
  /** A short instruction for the player. */
  message: string;
  /** Smoothed points (normalised) and which are visible, for the skeleton overlay. */
  points: Array<{ x: number; y: number; v: boolean }> | null;
}

export interface TrackerOptions {
  /** Upper-body moves only (arm raises, lean, punches, arm jacks). */
  seated?: boolean;
  /** Jump threshold in body heights (0.12 by default; gentler intensities use less). */
  jumpRise?: number;
  /** How long to hold still for the first calibration (ms). */
  calibMs?: number;
  /** The frames are already mirrored (a selfie preview): flips which way is the player's right. */
  mirrored?: boolean;
}

interface Baseline { hipY: number; ankleY: number; noseY: number; T: number; SW: number; H: number }

/** Frame units: x scaled by the aspect ratio so distances are the same in both directions. */
type P = { x: number; y: number; z: number; v: boolean };

export class PoseTracker {
  private filters = TRACKED.map(() => [new OneEuro(1.2, 3), new OneEuro(1.2, 3), new OneEuro(0.8, 0.4)] as const);
  private base: Baseline | null = null;
  private steadyMs = 0;
  private lastT = 0;
  private refHip: number | null = null;
  private lostSince: number | null = null;
  private driftSince: number | null = null;
  private recal = false;
  private quality = 0;
  private squat = new SquatMachine();
  private jump: JumpMachine;
  private jack: JackMachine;
  private raise = new RaiseMachine();
  private punch = new PunchMachine();
  private head = new HeadMachine();
  readonly seated: boolean;
  private calibMs: number;

  constructor(private opts: TrackerOptions = {}) {
    this.seated = !!opts.seated;
    this.jump = new JumpMachine(opts.jumpRise ?? 0.12);
    this.jack = new JackMachine(this.seated);
    this.calibMs = opts.calibMs ?? 3000;
  }

  get calibrated() {
    return this.base !== null && !this.recal;
  }

  /** Start calibrating again (the player moved, or asked to). */
  recalibrate() {
    this.recal = true;
    this.steadyMs = 0;
    this.refHip = null;
  }

  step(input: PoseInput): PoseOutput {
    const dt = this.lastT ? Math.min(200, Math.max(0, input.t - this.lastT)) : 33;
    this.lastT = input.t;
    const out: PoseOutput = { state: "need-body", moves: [], lean: 0, depth: 0, calib: 0, quality: this.quality, message: "", points: null };
    const pts = this.smooth(input);
    if (pts) out.points = TRACKED.map((i) => ({ x: pts[i]!.x / (input.aspect ?? 4 / 3), y: pts[i]!.y, v: pts[i]!.v }));
    const needs = this.seated ? SEATED_NEEDS : STANDING_NEEDS;
    const visible = !!pts && needs.every((i) => pts[i]!.v);

    if (!this.calibrated) return this.calibrate(out, pts, visible, dt);

    if (!visible) {
      this.lostSince ??= input.t;
      if (input.t - this.lostSince > 300) {
        this.squat.reset();
        out.state = "lost";
        out.message = this.seated ? "Sit where the camera can see your arms and hips" : "Step back so your whole body fits · move into the light";
        return out;
      }
      out.state = "ready"; // a blink of lost tracking: keep going
      return out;
    }
    this.lostSince = null;
    const f = this.features(pts!, input.t);
    out.state = "ready";
    out.lean = leanAxis(f.leanDeg);
    out.depth = this.seated ? 0 : clamp01(f.hipDrop / 0.5);

    if (this.seated) {
      if (this.raise.update(f)) out.moves.push("raise");
      if (this.punch.update(f)) out.moves.push("punch");
    } else {
      const jumped = this.jump.update(f);
      if (jumped || this.jump.airborne) this.squat.lastAirAt = input.t;
      if (jumped) out.moves.push("jump");
      const rep = this.squat.update(f);
      if (rep) {
        this.quality = out.quality = rep.quality;
        out.moves.push("squat");
      }
      if (this.raise.update(f)) out.moves.push("raise");
    }
    if (this.jack.update(f)) out.moves.push("jack");
    if (this.head.update(f)) out.moves.push("hands-on-head");
    this.track(pts!, f, input.t, dt);
    return out;
  }

  /** Smooths the tracked joints; null when nobody is in view. */
  private smooth(input: PoseInput): P[] | null {
    const lm = input.landmarks;
    if (!lm || lm.length < 29) {
      for (const f of this.filters) f.forEach((x) => x.reset());
      return null;
    }
    const a = input.aspect ?? 4 / 3;
    const out: P[] = [];
    TRACKED.forEach((idx, k) => {
      const l = lm[idx]!;
      const [fx, fy, fz] = this.filters[k]!;
      const inFrame = l.x > -0.02 && l.x < 1.02 && l.y > -0.02 && l.y < 1.02;
      out[idx] = { x: fx.filter(l.x * a, input.t), y: fy.filter(l.y, input.t), z: fz.filter((l.z ?? 0) * a, input.t), v: (l.visibility ?? 1) > MIN_VIS && inFrame };
    });
    return out;
  }

  private calibrate(out: PoseOutput, p: P[] | null, visible: boolean, dt: number): PoseOutput {
    out.state = this.base && this.recal ? "calibrating" : "need-body";
    if (!p || !visible) {
      this.steadyMs = Math.max(0, this.steadyMs - dt * 2);
      out.calib = this.steadyMs / this.calibMs;
      const legs = !this.seated && p && !(p[LM.lAnkle]!.v && p[LM.rAnkle]!.v);
      const arms = p && !(p[LM.lWrist]!.v && p[LM.rWrist]!.v);
      out.message = !p ? "Step into view of the camera"
        : this.seated ? "Sit back so your head, arms and hips fit"
        : legs ? "Step back until your whole body fits, feet too"
        : arms ? "Keep your arms in view" : "Step back until your whole body fits";
      return out;
    }
    out.state = "calibrating";
    const hipY = mid(p[LM.lHip]!, p[LM.rHip]!).y;
    this.refHip ??= hipY;
    const T = dist(mid(p[LM.lShoulder]!, p[LM.rShoulder]!), mid(p[LM.lHip]!, p[LM.rHip]!));
    const armsDown = p[LM.lWrist]!.y > p[LM.lShoulder]!.y && p[LM.rWrist]!.y > p[LM.rShoulder]!.y;
    const steady = Math.abs(hipY - this.refHip) < 0.06 * T && armsDown;
    this.refHip += (hipY - this.refHip) * 0.15;
    const need = this.base ? Math.min(this.calibMs, 1500) : this.calibMs; // re-calibrating is quicker
    this.steadyMs = steady ? this.steadyMs + dt : Math.max(0, this.steadyMs - dt);
    out.calib = Math.min(1, this.steadyMs / need);
    out.message = steady ? "Great! Stand tall and hold still…" : "Stand still with your arms down";
    if (this.steadyMs >= need) {
      const ankleY = this.seated ? hipY : mid(p[LM.lAnkle]!, p[LM.rAnkle]!).y;
      const noseY = p[LM.nose]!.y;
      this.base = {
        hipY, ankleY, noseY, T,
        SW: Math.max(0.02, dist(p[LM.lShoulder]!, p[LM.rShoulder]!)),
        H: Math.max(T, ankleY - noseY),
      };
      this.recal = false;
      this.driftSince = null;
      this.squat.reset();
      this.jump.reset();
      out.state = "ready";
      out.calib = 1;
      out.message = "Calibrated!";
    }
    return out;
  }

  private features(p: P[], t: number): Features {
    const b = this.base!;
    const sh = mid(p[LM.lShoulder]!, p[LM.rShoulder]!), hip = mid(p[LM.lHip]!, p[LM.rHip]!);
    const nose = p[LM.nose]!;
    const legs = !this.seated && p[LM.lKnee]!.v && p[LM.rKnee]!.v && p[LM.lAnkle]!.v && p[LM.rAnkle]!.v;
    const ankle = legs ? mid(p[LM.lAnkle]!, p[LM.rAnkle]!) : { x: hip.x, y: b.ankleY, z: 0 };
    const knee = (h: P, k: P, a: P) => angle(h, k, a);
    const kneeAngle = legs ? (knee(p[LM.lHip]!, p[LM.lKnee]!, p[LM.lAnkle]!) + knee(p[LM.rHip]!, p[LM.rKnee]!, p[LM.rAnkle]!)) / 2 : NaN;
    const ankleGap = legs ? Math.abs(p[LM.lAnkle]!.x - p[LM.rAnkle]!.x) : NaN;
    const kneeGap = legs ? Math.abs(p[LM.lKnee]!.x - p[LM.rKnee]!.x) : NaN;
    // + = the player's right: in a camera image (not mirrored) their right is on the left of the picture
    const side = this.opts.mirrored ? 1 : -1;
    const leanDeg = (Math.atan2(side * (sh.x - hip.x), hip.y - sh.y) * 180) / Math.PI;
    const lw = p[LM.lWrist]!, rw = p[LM.rWrist]!, le = p[LM.lElbow]!, re = p[LM.rElbow]!;
    const headR = b.SW * 0.9;
    const onHead = (w: P) => w.y > nose.y - 0.45 * b.T && w.y < nose.y + 0.1 * b.T && Math.abs(w.x - nose.x) < headR;
    const elbowOut = (e: P) => e.y < sh.y + 0.05 * b.T && Math.abs(e.x - sh.x) > 0.8 * b.SW;
    const chest = (w: P, s: P) => w.y > s.y - 0.4 * b.T && w.y < s.y + 0.6 * b.T;
    return {
      t,
      hipDrop: (hip.y - b.hipY) / b.T,
      kneeAngle,
      kneeRatio: legs && ankleGap > 0.2 * b.SW ? kneeGap / ankleGap : NaN,
      ankleRise: legs ? (b.ankleY - ankle.y) / b.H : 0,
      hipRise: (b.hipY - hip.y) / b.H,
      ankleY: ankle.y,
      hipY: hip.y,
      H: b.H,
      leanDeg,
      wristUpL: (nose.y - lw.y) / b.T,
      wristUpR: (nose.y - rw.y) / b.T,
      wristDownL: (lw.y - p[LM.lShoulder]!.y) / b.T,
      wristDownR: (rw.y - p[LM.rShoulder]!.y) / b.T,
      ankleSpread: legs ? ankleGap / b.SW : 0,
      wristSpread: Math.abs(lw.x - rw.x) / b.SW,
      handsOnHead: onHead(lw) && onHead(rw) && elbowOut(le) && elbowOut(re),
      reachL: (p[LM.lShoulder]!.z - lw.z) / b.SW,
      reachR: (p[LM.rShoulder]!.z - rw.z) / b.SW,
      chestL: chest(lw, p[LM.lShoulder]!),
      chestR: chest(rw, p[LM.rShoulder]!),
      legsVisible: legs,
    };
  }

  /**
   * Follows a player who drifts a little (standing heights adapt slowly while idle) and re-calibrates when
   * their size changes by more than 20 % for a second (they stepped closer or further away).
   */
  private track(p: P[], f: Features, t: number, dt: number) {
    const b = this.base!;
    const idle = this.squat.state === "up" && !this.jump.airborne && Math.abs(f.hipDrop) < 0.08;
    const sw = dist(p[LM.lShoulder]!, p[LM.rShoulder]!);
    const ratio = sw / b.SW;
    // shoulder width hardly changes in a squat or a jack seen from the front, so a lasting change means distance
    if (!this.jump.airborne && (ratio < 0.8 || ratio > 1.25)) {
      this.driftSince ??= t;
      if (t - this.driftSince > 1000) this.recalibrate();
    } else this.driftSince = null;
    if (idle && Math.abs(f.leanDeg) < 8) {
      const k = Math.min(1, dt / 3000);
      b.hipY += (f.hipY - b.hipY) * k;
      if (f.legsVisible && f.ankleRise < 0.03) b.ankleY += (f.ankleY - b.ankleY) * k;
    }
  }
}

/** Lean in degrees → axis: a dead zone of ±3° (posture noise), full at ±15°. */
export function leanAxis(deg: number): number {
  const a = Math.abs(deg);
  if (a < 3) return 0;
  return Math.sign(deg) * Math.min(1, (a - 3) / 12);
}

function mid(a: P, b: P): P {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2, v: a.v && b.v };
}
function dist(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
/** Angle at b (degrees) between b→a and b→c. */
function angle(a: P, b: P, c: P) {
  const v1x = a.x - b.x, v1y = a.y - b.y, v2x = c.x - b.x, v2y = c.y - b.y;
  const d = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
  if (d < 1e-9) return 180;
  return (Math.acos(Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / d))) * 180) / Math.PI;
}
