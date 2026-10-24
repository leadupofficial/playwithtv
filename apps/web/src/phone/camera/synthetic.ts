/**
 * Synthetic bodies for camera mode: 33 BlazePose-style landmarks for a player in a given pose, plus timed
 * moves (a squat, a jump, a jumping jack…). The unit tests drive the tracker with these, and the browser tests
 * feed them into the real phone pipeline instead of a camera (see fakePose.ts). Proportions follow an adult
 * seen from the front by an unmirrored phone camera (the player's left is on the right of the picture).
 */
import type { Landmark } from "./poseActions";

export interface BodyPose {
  /** Centre of the body, normalised x (0.5 = middle of the picture). */
  cx?: number;
  /** Ankle height when standing on the floor, normalised y. */
  feetY?: number;
  /** Nose-to-ankle height in frame heights (smaller = further away). */
  height?: number;
  /** 0..1: hip drop of up to 0.6 torso lengths (1 = a deep squat). */
  squat?: number;
  /** Knees caving inwards during a squat, 0..1 (poor form). */
  kneesIn?: number;
  /** The whole body off the floor, in body heights (a jump). */
  lift?: number;
  /** Arm angle from hanging down (0) through sideways (90) to straight up (180), degrees. */
  arms?: number;
  /** Both hands resting on the head, elbows out. */
  head?: boolean;
  /** One arm punching towards the camera, and how far (0..1). */
  punch?: { side: "L" | "R"; amount: number } | null;
  /** Feet apart, 0..1 (1 = jumping-jack wide). */
  legs?: number;
  /** Upper-body lean in degrees, + = the player's right. */
  lean?: number;
  /** Sitting on a chair (knees forward, hips low). */
  seated?: boolean;
  /** Landmark indices the camera can't see (low visibility). */
  hide?: number[];
  /** Random jitter, normalised units. */
  noise?: number;
}

const DEG = Math.PI / 180;

/** Landmarks for one pose. `rnd` drives the jitter (seed it for repeatable tests). */
export function bodyLandmarks(p: BodyPose, rnd: () => number = Math.random, aspect = 4 / 3): Landmark[] {
  const H = p.height ?? 0.7;
  const shin = 0.27 * H, thigh = 0.27 * H, torso = 0.32 * H, neck = 0.14 * H;
  const SW = 0.24 * H, hipW = 0.15 * H, ua = 0.19 * H, fa = 0.17 * H;
  const cx = (p.cx ?? 0.5) * aspect;
  const squat = p.squat ?? 0;
  const ankleY = (p.feetY ?? 0.9) - (p.lift ?? 0) * H;
  const spread = (p.legs ?? 0) * 0.2 * H;
  const pts: Array<{ x: number; y: number; z: number }> = Array.from({ length: 33 }, () => ({ x: cx, y: ankleY, z: 0 }));
  const set = (i: number, x: number, y: number, z = 0) => (pts[i] = { x, y, z });

  // legs: index 27 = left ankle, on the right of the picture (+x)
  const kneeOut = squat * 0.04 * H - (p.kneesIn ?? 0) * squat * 0.11 * H;
  for (const [s, ank, kn, hp] of [[1, 27, 25, 23], [-1, 28, 26, 24]] as const) {
    const ax = cx + s * (hipW / 2 + spread);
    set(ank, ax, ankleY);
    if (p.seated) {
      set(kn, ax - s * 0.01 * H, ankleY - shin);
      set(hp, cx + s * hipW / 2, ankleY - shin - 0.03 * H);
    } else {
      const ky = ankleY - shin * (1 - 0.15 * squat);
      set(kn, cx + s * (hipW / 2 + spread * 0.5) + s * kneeOut, ky);
      set(hp, cx + s * hipW / 2, Math.min(ankleY - shin - thigh + squat * 0.6 * torso, ky - 0.03 * H));
    }
  }
  const hipMid = { x: (pts[23]!.x + pts[24]!.x) / 2, y: (pts[23]!.y + pts[24]!.y) / 2 };
  // upper body leans around the hips: the player's right is towards -x
  const th = (p.lean ?? 0) * DEG;
  const up = { x: -Math.sin(th), y: -Math.cos(th) };
  const side = { x: Math.cos(th), y: -Math.sin(th) };
  const sc = { x: hipMid.x + up.x * torso, y: hipMid.y + up.y * torso };
  const nose = { x: sc.x + up.x * neck, y: sc.y + up.y * neck };
  set(0, nose.x, nose.y, -0.05 * H);
  for (const [i, dx, dy] of [[1, 0.02, -0.02], [2, 0.03, -0.02], [3, 0.04, -0.02], [4, -0.02, -0.02], [5, -0.03, -0.02], [6, -0.04, -0.02], [7, 0.06, -0.01], [8, -0.06, -0.01], [9, 0.015, 0.025], [10, -0.015, 0.025]] as const) {
    set(i, nose.x + dx * H, nose.y + dy * H, -0.04 * H);
  }
  for (const [s, sh, el, wr] of [[1, 11, 13, 15], [-1, 12, 14, 16]] as const) {
    const shx = sc.x + side.x * s * SW / 2, shy = sc.y + side.y * s * SW / 2;
    set(sh, shx, shy);
    const punch = p.punch && (p.punch.side === "L") === (s === 1) ? p.punch.amount : 0;
    if (p.head) {
      set(el, shx + s * 0.12 * H, shy - 0.06 * H);
      set(wr, nose.x + s * 0.06 * H, nose.y - 0.1 * H);
    } else if (punch > 0) {
      set(el, shx - s * 0.02 * H * punch, shy + 0.04 * H * (1 - punch), -0.18 * H * punch);
      set(wr, shx - s * 0.05 * H * punch, shy + 0.02 * H + 0.2 * H * (1 - punch), -0.36 * H * punch);
    } else {
      const a = (p.arms ?? 8) * DEG;
      const d = { x: s * Math.sin(a), y: Math.cos(a) };
      set(el, shx + d.x * ua, shy + d.y * ua);
      set(wr, shx + d.x * (ua + fa), shy + d.y * (ua + fa));
    }
  }
  for (const [i, from] of [[17, 15], [19, 15], [21, 15], [18, 16], [20, 16], [22, 16], [29, 27], [31, 27], [30, 28], [32, 28]] as const) {
    const f = pts[from]!;
    set(i, f.x + (i % 2 ? 0.01 : -0.01) * H, f.y + (i >= 29 ? 0.02 : 0.03) * H, f.z);
  }

  const hidden = new Set(p.hide ?? []);
  const n = p.noise ?? 0;
  return pts.map((q, i) => {
    const x = q.x / aspect + (n ? (rnd() - 0.5) * n : 0);
    const y = q.y + (n ? (rnd() - 0.5) * n : 0);
    const inside = x > 0 && x < 1 && y > 0 && y < 1;
    return { x, y, z: q.z / aspect, visibility: hidden.has(i) ? 0.15 : inside ? 0.97 : 0.3 };
  });
}

export type Move = "squat" | "half-squat" | "bad-squat" | "jump" | "jack" | "arm-jack" | "raise" | "punch" | "head" | "lean-left" | "lean-right" | "stand";

const ease = (t: number) => 0.5 - 0.5 * Math.cos(Math.PI * Math.max(0, Math.min(1, t)));

/** A timed move from a base pose: how long it takes and the pose at each moment (ms from its start). */
export function moveTimeline(move: Move, base: BodyPose = {}): { ms: number; at(t: number): BodyPose } {
  const b = { ...base };
  switch (move) {
    case "squat":
    case "half-squat":
    case "bad-squat": {
      const depth = move === "half-squat" ? 0.5 : 1;
      return { ms: 1800, at: (t) => ({ ...b, squat: depth * Math.sin(Math.PI * Math.min(1, t / 1500)) ** 2, kneesIn: move === "bad-squat" ? 1 : 0 }) };
    }
    case "jump":
      return {
        ms: 900,
        at: (t) => t < 150 ? { ...b, squat: 0.3 * ease(t / 150) }
          : t < 550 ? { ...b, squat: 0.3 * (1 - ease((t - 150) / 80)), lift: 0.17 * Math.sin((Math.PI * (t - 150)) / 400) }
          : { ...b, squat: 0.25 * Math.sin((Math.PI * Math.min(1, (t - 550) / 250))) },
      };
    case "jack":
      return { ms: 800, at: (t) => { const k = t < 400 ? ease(t / 250) : 1 - ease((t - 400) / 250); return { ...b, arms: 8 + 152 * k, legs: k }; } };
    case "arm-jack":
      return { ms: 800, at: (t) => { const k = t < 400 ? ease(t / 250) : 1 - ease((t - 400) / 250); return { ...b, arms: 8 + 152 * k }; } };
    case "raise":
      return { ms: 1000, at: (t) => ({ ...b, arms: 8 + 172 * (t < 500 ? ease(t / 300) : 1 - ease((t - 500) / 300)) }) };
    case "punch":
      return { ms: 600, at: (t) => ({ ...b, punch: { side: "L", amount: t < 300 ? ease(t / 150) : 1 - ease((t - 300) / 150) } }) };
    case "head":
      return { ms: 1700, at: (t) => ({ ...b, head: t < 1500 }) };
    case "lean-left":
    case "lean-right":
      return { ms: 900, at: (t) => ({ ...b, lean: (move === "lean-left" ? -14 : 14) * (t < 700 ? ease(t / 200) : 1 - ease((t - 700) / 200)) }) };
    case "stand":
      return { ms: 500, at: () => b };
  }
}

/** A seeded random source (repeatable noise in tests). */
export function seeded(seed = 1): () => number {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}
