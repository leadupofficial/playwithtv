import { describe, expect, it } from "vitest";
import { LM, PoseTracker, leanAxis, type PoseOutput, type TrackerOptions } from "./poseActions";
import { OneEuro } from "./oneEuro";
import { bodyLandmarks, moveTimeline, seeded, type BodyPose, type Move } from "./synthetic";

const FRAME = 33; // ~30 fps, like a phone camera

/** A tracker fed with synthetic frames at 30 fps. */
function rig(opts: TrackerOptions = {}, seed = 7) {
  const tr = new PoseTracker({ calibMs: 1000, ...opts });
  const rnd = seeded(seed);
  let t = 1000;
  const frame = (p: BodyPose | null) => {
    t += FRAME;
    return tr.step({ t, landmarks: p ? bodyLandmarks(p, rnd) : null });
  };
  const hold = (p: BodyPose | null, ms: number) => {
    const out: PoseOutput[] = [];
    for (let e = 0; e < ms; e += FRAME) out.push(frame(p));
    return out;
  };
  const play = (move: Move, base: BodyPose = {}, n = 1, restMs = 300) => {
    const out: PoseOutput[] = [];
    for (let k = 0; k < n; k++) {
      const m = moveTimeline(move, base);
      for (let e = 0; e < m.ms; e += FRAME) out.push(frame(m.at(e)));
      out.push(...hold(base, restMs));
    }
    return out;
  };
  const calibrate = (base: BodyPose = {}) => {
    const out = hold(base, 1500);
    expect(out.at(-1)!.state).toBe("ready");
    return out;
  };
  return { tr, frame, hold, play, calibrate };
}
const movesOf = (o: PoseOutput[]) => o.flatMap((x) => x.moves);
const count = (o: PoseOutput[], m: string) => movesOf(o).filter((x) => x === m).length;

describe("calibration", () => {
  it("refuses to start until the whole body (feet and hands) is in view", () => {
    const r = rig();
    expect(r.hold(null, 300).at(-1)!.message).toMatch(/Step into view/);
    const noFeet = r.hold({ hide: [LM.lAnkle, LM.rAnkle] }, 2000).at(-1)!;
    expect(noFeet.state).toBe("need-body");
    expect(noFeet.calib).toBe(0);
    expect(noFeet.message).toMatch(/feet/);
    const noHands = r.hold({ hide: [LM.lWrist] }, 2000).at(-1)!;
    expect(noHands.state).toBe("need-body");
    expect(noHands.message).toMatch(/arms/);
    expect(r.tr.calibrated).toBe(false);
  });

  it("calibrates after holding still with arms down, but not while moving the arms around", () => {
    const r = rig();
    const waving = r.play("raise", {}, 3, 0);
    expect(waving.every((o) => o.state !== "ready")).toBe(true);
    const out = r.hold({}, 1300);
    expect(out[5]!.state).toBe("calibrating");
    expect(out.some((o) => o.calib > 0.4 && o.calib < 0.9)).toBe(true);
    expect(out.at(-1)!.state).toBe("ready");
    expect(r.tr.calibrated).toBe(true);
  });

  it("a body too close to the camera (feet out of the picture) is asked to step back", () => {
    const r = rig();
    const o = r.hold({ height: 1.0, feetY: 1.15 }, 1500).at(-1)!;
    expect(o.state).toBe("need-body");
    expect(o.message).toMatch(/Step back/);
  });
});

describe("squats", () => {
  it("counts deep squats once each, with perfect form", () => {
    const r = rig();
    r.calibrate();
    const out = r.play("squat", {}, 5);
    expect(count(out, "squat")).toBe(5);
    expect(count(out, "jump")).toBe(0);
    expect(out.filter((o) => o.moves.includes("squat")).every((o) => o.quality >= 0.8)).toBe(true);
    expect(Math.max(...out.map((o) => o.depth))).toBeGreaterThan(0.6);
  });

  it("half squats count with lower form; knees caving in is not perfect", () => {
    const r = rig();
    r.calibrate();
    const half = r.play("half-squat", {}, 3);
    expect(count(half, "squat")).toBe(3);
    expect(half.find((o) => o.moves.includes("squat"))!.quality).toBeLessThan(0.8);
    const bad = r.play("bad-squat", {}, 2);
    expect(count(bad, "squat")).toBe(2);
    expect(bad.find((o) => o.moves.includes("squat"))!.quality).toBeLessThan(0.8);
  });

  it("a small dip (less than a quarter torso) is not a squat", () => {
    const r = rig();
    r.calibrate();
    expect(count(r.hold({ squat: 0.3 }, 1000).concat(r.hold({}, 600)), "squat")).toBe(0);
  });

  it("still counts every squat through camera noise", () => {
    const r = rig({}, 3);
    r.calibrate({ noise: 0.006 });
    expect(count(r.play("squat", { noise: 0.006 }, 6), "squat")).toBe(6);
  });
});

describe("jumps, jacks, raises and lean", () => {
  it("detects each jump at take-off and never counts its crouch as a squat", () => {
    const r = rig();
    r.calibrate();
    const out = r.play("jump", {}, 4, 400);
    expect(count(out, "jump")).toBe(4);
    expect(count(out, "squat")).toBe(0);
    // fires while rising (take-off at 150 ms), by the top of the jump (350 ms), long before landing
    const firstJump = out.findIndex((o) => o.moves.includes("jump"));
    expect(firstJump * FRAME).toBeLessThanOrEqual(350);
  });

  it("a tiny hop below the threshold is not a jump; a gentler setting accepts it", () => {
    const hop = (opts: TrackerOptions) => {
      const r = rig(opts);
      r.calibrate();
      const out: PoseOutput[] = [];
      for (let e = 0; e < 400; e += FRAME) out.push(r.frame({ lift: 0.1 * Math.sin((Math.PI * e) / 400) }));
      out.push(...r.hold({}, 400));
      return count(out, "jump");
    };
    expect(hop({})).toBe(0);
    expect(hop({ jumpRise: 0.07 })).toBe(1);
  });

  it("counts jumping jacks (open then closed) and raises separately", () => {
    const r = rig();
    r.calibrate();
    const jacks = r.play("jack", {}, 4);
    expect(count(jacks, "jack")).toBe(4);
    expect(count(jacks, "squat") + count(jacks, "jump")).toBe(0);
    const raises = r.play("raise", {}, 3);
    expect(count(raises, "raise")).toBe(3);
    expect(count(raises, "jack")).toBe(0); // arms up but feet together: not a jack
  });

  it("turns lean into a continuous axis: + for the player's right, a dead zone when upright", () => {
    const r = rig();
    r.calibrate();
    expect(Math.abs(r.hold({ lean: 2 }, 400).at(-1)!.lean)).toBe(0);
    expect(r.hold({ lean: 14 }, 400).at(-1)!.lean).toBeGreaterThan(0.8);
    expect(r.hold({ lean: -14 }, 400).at(-1)!.lean).toBeLessThan(-0.8);
    const halfway = r.hold({ lean: 8 }, 400).at(-1)!.lean;
    expect(halfway).toBeGreaterThan(0.25);
    expect(halfway).toBeLessThan(0.65);
    expect([leanAxis(0), leanAxis(15), leanAxis(-30)]).toEqual([0, 1, -1]);
  });

  it("mirrored frames flip which way is right", () => {
    const r = rig({ mirrored: true });
    r.calibrate();
    expect(r.hold({ lean: 14 }, 400).at(-1)!.lean).toBeLessThan(-0.8);
  });

  it("both hands on the head for a second is the pause gesture (once per hold, not a raise)", () => {
    const r = rig();
    r.calibrate();
    const out = r.hold({ head: true }, 3000).concat(r.hold({}, 500));
    expect(count(out, "hands-on-head")).toBe(1);
    expect(count(out, "raise")).toBe(0);
    expect(count(r.hold({ head: true }, 600), "hands-on-head")).toBe(0); // too short
  });

  it("standing still for 10 s with jitter fires nothing", () => {
    const r = rig({}, 11);
    r.calibrate({ noise: 0.008 });
    const out = r.hold({ noise: 0.008 }, 10_000);
    expect(movesOf(out)).toEqual([]);
    expect(out.every((o) => o.state === "ready")).toBe(true);
    expect(Math.max(...out.map((o) => Math.abs(o.lean)))).toBeLessThan(0.2);
  });
});

describe("tracking", () => {
  it("reports tracking lost when the feet leave the picture, and pauses moves until they are back", () => {
    const r = rig();
    r.calibrate();
    const hidden = { hide: [LM.lAnkle, LM.rAnkle, LM.lKnee] };
    const blink = r.hold(hidden, 200);
    expect(blink.at(-1)!.state).toBe("ready"); // a blink is forgiven
    const lost = r.play("squat", hidden, 2);
    expect(lost.at(-1)!.state).toBe("lost");
    expect(lost.at(-1)!.message).toMatch(/Step back/);
    expect(count(lost, "squat")).toBe(0);
    const back = r.play("squat", {}, 2);
    expect(back.at(-1)!.state).toBe("ready");
    expect(count(back, "squat")).toBe(2);
  });

  it("nobody in view is tracking lost", () => {
    const r = rig();
    r.calibrate();
    expect(r.hold(null, 500).at(-1)!.state).toBe("lost");
  });

  it("re-calibrates when the player steps much closer (> 20 % bigger), then counts squats at the new size", () => {
    const r = rig();
    r.calibrate({ height: 0.62 });
    const closer: BodyPose = { height: 0.8, feetY: 0.93 };
    const moving = r.hold(closer, 1300);
    expect(moving.some((o) => o.state === "calibrating")).toBe(true);
    expect(r.hold(closer, 1600).at(-1)!.state).toBe("ready");
    expect(count(r.play("squat", closer, 3), "squat")).toBe(3);
  });

  it("small drift (stepping a little) does not re-calibrate", () => {
    const r = rig();
    r.calibrate({ height: 0.7 });
    const out = r.hold({ height: 0.75, cx: 0.55 }, 3000);
    expect(out.every((o) => o.state === "ready")).toBe(true);
    expect(count(r.play("squat", { height: 0.75, cx: 0.55 }, 2), "squat")).toBe(2);
  });
});

describe("seated mode (upper body only)", () => {
  const seat: BodyPose = { seated: true, hide: [LM.lAnkle, LM.rAnkle] };
  it("calibrates without the feet and recognises raises, arm jacks and punches", () => {
    const r = rig({ seated: true });
    r.calibrate(seat);
    expect(count(r.play("raise", seat, 3), "raise")).toBe(3);
    const jacks = r.play("arm-jack", seat, 3);
    expect(count(jacks, "jack")).toBe(3);
    expect(count(r.play("punch", seat, 3), "punch")).toBe(3);
    expect(r.hold({ ...seat, lean: 14 }, 400).at(-1)!.lean).toBeGreaterThan(0.8);
  });

  it("never reports squats or jumps", () => {
    const r = rig({ seated: true });
    r.calibrate(seat);
    const out = r.play("squat", seat, 2).concat(r.play("jump", seat, 2));
    expect(count(out, "squat") + count(out, "jump")).toBe(0);
  });
});

describe("one-euro filter", () => {
  it("smooths jitter on a still value and follows a fast step quickly", () => {
    const f = new OneEuro();
    const rnd = seeded(5);
    let maxDev = 0;
    for (let i = 0; i < 90; i++) {
      const v = f.filter(0.5 + (rnd() - 0.5) * 0.02, i * 33);
      if (i > 10) maxDev = Math.max(maxDev, Math.abs(v - 0.5));
    }
    expect(maxDev).toBeLessThan(0.008);
    let v = 0;
    for (let i = 90; i < 96; i++) v = f.filter(0.8, i * 33); // 200 ms after a 0.3 step
    expect(v).toBeGreaterThan(0.7);
  });
});
