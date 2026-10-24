import { describe, expect, it } from "vitest";
import { DIVE_TIME, type Dive } from "./geometry";
import {
  MAX_CHARGE, QUICK_TIMING, TIMEOUT_POWER, cpuKeepPlan, cpuKeeperDive, cpuKickPlan, cpuKickerInput, newKick, stepKick,
  type KickEvent, type KickState, type KickerInput,
} from "./kick";
import { PadTrail, diveFor, swipeShot } from "./controls";

const DT = 1 / 60;
const clean = (() => { let i = 0; return () => (i++ % 2 === 0 ? Math.exp(-0.5) : 0.25); })(); // no aim error

function toAim(k: KickState) {
  while (k.phase === "intro") stepKick(k, DT, {}, null, clean);
}
/** Runs until the kick is resolved, feeding the same inputs every step (keeper dive only once). */
function run(k: KickState, kicker: (k: KickState) => KickerInput, keeper: (k: KickState) => Dive | null = () => null, maxS = 20) {
  const ev: KickEvent[] = [];
  for (let t = 0; t < maxS && k.phase !== "done"; t += DT) ev.push(...stepKick(k, DT, kicker(k), keeper(k), clean));
  return ev;
}
const outcomeOf = (ev: KickEvent[]) => (ev.find((e) => e.kind === "outcome") as { outcome: string } | undefined)?.outcome;

describe("a kick", () => {
  it("goes intro → aim → flight → result → done", () => {
    const k = newKick(QUICK_TIMING);
    const ev = run(k, (s) => (s.phase === "aim" && s.t > 0.5 ? { shoot: { power: 0.8, curve: 0, aim: { x: -0.7, y: 0.8 } } } : {}));
    expect(ev.map((e) => e.kind)).toEqual(["aim", "shot", "outcome", "done"]);
    expect(outcomeOf(ev)).toBe("goal");
  });

  it("buttons: the joystick moves the crosshair, holding KICK charges, releasing shoots", () => {
    const k = newKick(QUICK_TIMING);
    toAim(k);
    for (let i = 0; i < 30; i++) stepKick(k, DT, { aimVel: { x: 1, y: 1 } }, null, clean);
    expect(k.aim.x).toBeCloseTo(0.625, 2);
    for (let i = 0; i < 48; i++) stepKick(k, DT, { charging: true, aimVel: { x: -1, y: 0 }, curve: 0.5 }, null, clean);
    expect(k.aim.x).toBeCloseTo(0.625, 2); // locked while charging
    expect(k.charge).toBeGreaterThan(0.7);
    const ev = stepKick(k, DT, { charging: false }, null, clean);
    expect(ev[0]).toMatchObject({ kind: "shot", shot: { curve: 0.5 } });
    expect((ev[0] as { shot: { power: number } }).shot.power).toBeCloseTo(k.charge);
  });

  it("holding KICK too long overcharges (and sails over)", () => {
    const k = newKick(QUICK_TIMING);
    toAim(k);
    stepKick(k, DT, { aimAbs: { x: 0.2, y: 0.6 } }, null, clean);
    for (let i = 0; i < 120; i++) stepKick(k, DT, { charging: true }, null, clean);
    expect(k.charge).toBe(MAX_CHARGE);
    const ev = run(k, () => ({ charging: false }));
    expect(outcomeOf(ev)).toBe("over");
  });

  it("the aim timer shoots for you", () => {
    const k = newKick(QUICK_TIMING);
    const ev = run(k, () => ({}));
    const shot = ev.find((e) => e.kind === "shot") as { shot: { power: number } };
    expect(shot.shot.power).toBe(TIMEOUT_POWER);
  });

  it("a keeper's early guess is hidden until the kick, then carried out at once", () => {
    const k = newKick(QUICK_TIMING);
    toAim(k);
    const ev = stepKick(k, DT, {}, { dx: 1, dy: 0 }, clean);
    expect(ev).toEqual([{ kind: "guess", dive: { dx: 1, dy: 0 } }]);
    expect(k.dive).toBeNull();
    stepKick(k, DT, {}, { dx: -1, dy: 0 }, clean); // only the first counts
    const rest = run(k, () => ({ shoot: { power: 0.8, curve: 0, aim: { x: 0.6, y: 0.4 } } }));
    expect(rest[1]).toEqual({ kind: "dive", dive: { dx: 1, dy: 0 }, early: true });
    expect(outcomeOf(rest)).toBe("save");
  });

  it("a guess the wrong way loses; reacting late to a corner is too slow, to a slow shot in time", () => {
    const wrong = newKick(QUICK_TIMING);
    toAim(wrong);
    stepKick(wrong, DT, {}, { dx: -1, dy: 0 }, clean);
    expect(outcomeOf(run(wrong, () => ({ shoot: { power: 0.8, curve: 0, aim: { x: 0.6, y: 0.4 } } })))).toBe("goal");

    const react = (power: number, at: number) => {
      const k = newKick(QUICK_TIMING);
      toAim(k);
      return outcomeOf(run(k, () => ({ shoot: { power, curve: 0, aim: { x: 0.62, y: 0.38 } } }), (s) => (s.phase === "flight" && s.flightT >= at ? { dx: 1, dy: 0 } : null)));
    };
    expect(react(1, 0.4)).toBe("goal");   // 0.5 s shot, dive after 0.4 s
    expect(react(0.45, 0.25)).toBe("save"); // 0.78 s shot: time to get there
    expect(DIVE_TIME).toBeLessThan(0.5);
  });
});

describe("CPU", () => {
  const seeded = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  it("the CPU kicker glides the crosshair to its spot and shoots on time", () => {
    const plan = cpuKickPlan(seeded(3));
    const k = newKick(QUICK_TIMING);
    const ev = run(k, (s) => cpuKickerInput(plan, s));
    const shot = ev.find((e) => e.kind === "shot");
    expect(shot).toBeTruthy();
    expect(k.aim.x).toBeCloseTo(plan.aim.x, 5);
    expect(plan.power).toBeGreaterThanOrEqual(0.7);
    expect(plan.at).toBeLessThan(QUICK_TIMING.aim);
  });

  it("the CPU keeper reacts after its reaction time", () => {
    const plan = { guess: null, guessAt: 0, reaction: 0.25, errX: 0, errY: 0 };
    const k = newKick(QUICK_TIMING);
    toAim(k);
    stepKick(k, DT, { shoot: { power: 0.5, curve: 0, aim: { x: 0.55, y: 0.4 } } }, null, clean);
    expect(cpuKeeperDive(plan, k)).toBeNull();
    while (k.flightT < 0.26) stepKick(k, DT, {}, null, clean);
    const d = cpuKeeperDive(plan, k)!;
    expect(d.dx).toBeGreaterThan(0.9);
  });

  it("stays big for a central shot and jumps for a high central one", () => {
    const plan = { guess: null, guessAt: 0, reaction: 0, errX: 0, errY: 0 };
    const at = (x: number, y: number) => {
      const k = newKick(QUICK_TIMING);
      toAim(k);
      stepKick(k, DT, { shoot: { power: 0.7, curve: 0, aim: { x, y } } }, null, clean);
      stepKick(k, DT, {}, null, clean);
      return cpuKeeperDive(plan, k);
    };
    expect(at(0, 0.3)).toBeNull();
    expect(at(0.1, 0.85)).toEqual({ dx: 0, dy: 1 });
  });

  it("over many seeded kicks the CPU keeper saves some and concedes most", () => {
    const rand = seeded(42);
    let goals = 0, saves = 0;
    for (let i = 0; i < 300; i++) {
      const kp = cpuKickPlan(rand);
      const keep = cpuKeepPlan(rand);
      const k = newKick(QUICK_TIMING);
      let o: string | undefined;
      for (let t = 0; t < 20 && k.phase !== "done"; t += DT) {
        for (const e of stepKick(k, DT, cpuKickerInput(kp, k), cpuKeeperDive(keep, k), rand)) if (e.kind === "outcome") o = e.outcome;
      }
      if (o === "goal") goals++;
      if (o === "save") saves++;
    }
    expect(goals / 300).toBeGreaterThan(0.5);
    expect(goals / 300).toBeLessThan(0.9);
    expect(saves).toBeGreaterThan(20);
  });
});

describe("controls", () => {
  it("dive buttons and the joystick + DIVE", () => {
    expect(diveFor("diveL", { x: 0, y: 0 })).toEqual({ dx: -1, dy: 0 });
    expect(diveFor("diveR", { x: 0, y: -1 })).toEqual({ dx: 1, dy: -1 });
    expect(diveFor("jump", { x: 0, y: 0 })).toEqual({ dx: 0, dy: 1 });
    expect(diveFor("dive", { x: 0.1, y: 0 })).toBeNull();
    expect(diveFor("dive", { x: -0.8, y: 0.5 })).toEqual({ dx: -1, dy: 0.5 });
    expect(diveFor("dive", { x: 0, y: -0.9 })).toEqual({ dx: 0, dy: -1 });
    expect(diveFor("cheer", { x: 0, y: 0 })).toBeNull();
  });

  it("a straight swipe up shoots straight; a diagonal one aims to that side; release height sets the height", () => {
    const straight = swipeShot([{ x: 0, y: -0.8, t: 0 }, { x: 0, y: 0, t: 50 }, { x: 0, y: 0.8, t: 100 }]);
    expect(straight.aim.x).toBeCloseTo(0);
    expect(straight.aim.y).toBeGreaterThan(0.9);
    expect(straight.curve).toBeCloseTo(0);
    const right = swipeShot([{ x: 0, y: -0.8, t: 0 }, { x: 0.4, y: -0.3, t: 50 }, { x: 0.8, y: 0, t: 100 }]);
    expect(right.aim.x).toBeGreaterThan(0.6);
    expect(right.aim.y).toBeLessThan(straight.aim.y);
    expect(swipeShot([{ x: 0, y: -0.9, t: 0 }, { x: 0, y: 0.9, t: 100 }]).power).toBeGreaterThan(swipeShot([{ x: 0, y: -0.3, t: 0 }, { x: 0, y: 0.3, t: 100 }]).power);
  });

  it("an arced swipe curls the ball", () => {
    const bowLeft = swipeShot([{ x: 0, y: -0.8, t: 0 }, { x: -0.3, y: 0, t: 50 }, { x: 0, y: 0.8, t: 100 }]);
    expect(bowLeft.curve).toBeGreaterThan(0.5);
    const bowRight = swipeShot([{ x: 0, y: -0.8, t: 0 }, { x: 0.3, y: 0, t: 50 }, { x: 0, y: 0.8, t: 100 }]);
    expect(bowRight.curve).toBeLessThan(-0.5);
  });

  it("the pad trail keeps the drag that just ended", () => {
    const trail = new PadTrail();
    trail.add(0, -0.8, 0);
    trail.add(0.1, 0, 50);
    trail.add(0, 0, 100);   // finger lifted: ignored
    expect(trail.lastY(120)).toBe(0);
    expect(trail.take(140).length).toBe(2);
    expect(trail.take(150).length).toBe(0);
    trail.add(0.5, 0.5, 1000);
    expect(trail.take(2000)).toEqual([]); // too old
  });
});
