import { describe, expect, it } from "vitest";
import { GOAL_HALF, HALF_W, MAX_PUCK, PUCK_R, SIDE_LIMIT, STRIKER_R, bounds, newTable, predictY, step, type Command, type HockeyEvent, type Table } from "./engine";
import { cpuCommand, newBrain } from "./cpu";

const DT = 1 / 60;
const run = (t: Table, seconds: number, cmds: (t: Table) => [Command | null, Command | null] = () => [null, null]) => {
  const ev: HockeyEvent[] = [];
  for (let i = 0; i < Math.round(seconds / DT); i++) ev.push(...step(t, DT, cmds(t)));
  return ev;
};
/** A table with the strikers parked out of the way and the puck placed by hand. */
const bare = (target = 7) => {
  const t = newTable(target, 3);
  t.strikers[0].y = t.strikers[1].y = HALF_W - STRIKER_R;
  t.strikers[0].x = -0.95; t.strikers[1].x = 0.95;
  return t;
};
const park = (t: Table): [Command, Command] => [{ kind: "target", x: -0.95, y: HALF_W }, { kind: "target", x: 0.95, y: HALF_W }];

describe("air hockey physics", () => {
  it("the puck bounces off the side rails, losing a little speed", () => {
    const t = bare();
    Object.assign(t.puck, { x: 0, y: 0, vx: 0, vy: 1.5 });
    run(t, 0.6, park);
    expect(t.puck.vy).toBeLessThan(0);
    expect(Math.abs(t.puck.vy)).toBeLessThan(1.5);
    expect(Math.abs(t.puck.y)).toBeLessThanOrEqual(HALF_W - PUCK_R + 1e-9);
  });

  it("the end rail outside the goal mouth bounces the puck back", () => {
    const t = bare();
    Object.assign(t.puck, { x: 0.5, y: -0.35, vx: 1.5, vy: 0 });
    run(t, 0.8, park);
    expect(t.puck.vx).toBeLessThan(0);
    expect(t.score).toEqual([0, 0]);
  });

  it("a puck into the right goal scores for the left player, who then faces a serve from the right", () => {
    const t = bare();
    Object.assign(t.puck, { x: 0.3, y: 0, vx: 2, vy: 0 });
    const ev = run(t, 0.6, park);
    expect(ev.some((e) => e.kind === "goal" && e.scorer === 0)).toBe(true);
    expect(t.score).toEqual([1, 0]);
    expect(t.phase).toBe("goal");
    run(t, 2, park);
    expect(t.phase).toBe("play");
    expect(t.puck.x).toBeGreaterThan(0);                 // the side that conceded serves
    expect(Math.hypot(t.puck.vx, t.puck.vy)).toBe(0);
  });

  it("a striker moving into the puck drives it away", () => {
    const t = bare();
    Object.assign(t.puck, { x: -0.3, y: 0, vx: 0, vy: 0 });
    t.strikers[0].x = -0.7; t.strikers[0].y = 0;
    const ev = run(t, 0.4, () => [{ kind: "target", x: -0.1, y: 0 }, { kind: "target", x: 0.95, y: HALF_W }]);
    expect(ev.some((e) => e.kind === "hit" && e.side === 0)).toBe(true);
    expect(t.puck.vx).toBeGreaterThan(1.5);
    expect(Math.hypot(t.puck.vx, t.puck.vy)).toBeLessThanOrEqual(MAX_PUCK + 1e-9);
  });

  it("strikers stay in their own half, whatever the command", () => {
    const t = newTable();
    run(t, 2, () => [{ kind: "target", x: 1, y: 2 }, { kind: "velocity", x: -1, y: -1 }]);
    expect(t.strikers[0].x).toBeLessThanOrEqual(bounds(0).x1);
    expect(t.strikers[0].y).toBeLessThanOrEqual(bounds(0).y1);
    expect(t.strikers[1].x).toBeGreaterThanOrEqual(bounds(1).x0);
    expect(t.strikers[1].y).toBeGreaterThanOrEqual(bounds(1).y0);
  });

  it("the joystick accelerates the striker rather than teleporting it", () => {
    const t = newTable();
    const x0 = t.strikers[0].x;
    run(t, 0.05, () => [{ kind: "velocity", x: 0, y: 1 }, null]);
    const early = t.strikers[0].y;
    run(t, 0.3, () => [{ kind: "velocity", x: 0, y: 1 }, null]);
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(0.08);
    expect(t.strikers[0].y).toBeGreaterThan(0.3);
    expect(t.strikers[0].x).toBeCloseTo(x0);
  });

  it("SMASH lunges at the puck, then has to recharge", () => {
    const t = bare();
    Object.assign(t.puck, { x: -0.3, y: 0.1, vx: 0, vy: 0 });
    t.strikers[0].x = -0.6; t.strikers[0].y = 0.1;
    const ev = run(t, 0.3, () => [{ kind: "velocity", x: 0, y: 0, smash: true }, null]);
    expect(ev.filter((e) => e.kind === "smash")).toHaveLength(1);
    expect(t.puck.vx).toBeGreaterThan(2);
  });

  it("first to the target wins and the game stops", () => {
    const t = bare(2);
    for (let g = 0; g < 2; g++) {
      Object.assign(t.puck, { x: -0.3, y: 0, vx: -2.5, vy: 0 });
      run(t, 2, park);
    }
    expect(t.score).toEqual([0, 2]);
    expect(t.phase).toBe("over");
    expect(t.winner).toBe(1);
    const before = { ...t.puck };
    run(t, 1, park);
    expect(t.puck.x).toBe(before.x);
  });

  it("a dead puck on the centre line goes back to the centre spot", () => {
    const t = bare();
    Object.assign(t.puck, { x: 0.02, y: 0.4, vx: 0, vy: 0 });
    const ev = run(t, 3.5, park);
    expect(ev.some((e) => e.kind === "faceoff")).toBe(true);
  });

  it("the 7-second rule: a puck kept on one side goes to the other player", () => {
    const t = bare();
    Object.assign(t.puck, { x: -0.5, y: 0.3, vx: 0, vy: 0 });
    const ev = run(t, SIDE_LIMIT + 0.2, park);
    expect(ev.some((e) => e.kind === "timeout" && e.side === 0)).toBe(true);
    expect(t.puck.x).toBeGreaterThan(0);
  });

  it("predicts where the puck crosses a line, with rail bounces", () => {
    expect(predictY({ x: 0, y: 0, vx: 1, vy: 0 }, 0.8)).toBeCloseTo(0);
    expect(predictY({ x: 0, y: 0, vx: -1, vy: 0 }, 0.8)).toBeNull();
    const y = predictY({ x: 0, y: 0.3, vx: 1, vy: 1 }, 0.8)!;   // bounces off the top rail
    expect(y).toBeLessThan(HALF_W);
    expect(y).toBeCloseTo(2 * (HALF_W - PUCK_R) - 1.1, 5);
  });

  it("is deterministic for a seed", () => {
    const a = newTable(7, 9), b = newTable(7, 9);
    const ba = newBrain(1), bb = newBrain(1);
    run(a, 10, (t) => [null, cpuCommand(t, ba, DT)]);
    run(b, 10, (t) => [null, cpuCommand(t, bb, DT)]);
    expect(a.puck).toEqual(b.puck);
  });
});

describe("air hockey CPU", () => {
  it("strikes a puck sitting in its half towards the other goal", () => {
    const t = bare();
    t.strikers[1].x = 0.78; t.strikers[1].y = 0;
    Object.assign(t.puck, { x: 0.4, y: 0.1, vx: 0, vy: 0 });
    const brain = newBrain(1);
    run(t, 2, (tt) => [{ kind: "target", x: -0.95, y: HALF_W }, cpuCommand(tt, brain, DT)]);
    expect(t.strikers[1].hits).toBeGreaterThan(0);
    expect(t.puck.x < 0 || t.puck.vx < 0 || t.score[1] > 0).toBe(true);
  });

  it("defends: blocks a straight shot at its goal", () => {
    let saves = 0;
    for (let s = 1; s <= 10; s++) {
      const t = bare();
      t.seed = s * 101;
      Object.assign(t.puck, { x: -0.2, y: (s % 5 - 2) * 0.05, vx: 1.6, vy: 0 });
      const brain = newBrain(1);
      run(t, 1.5, (tt) => [{ kind: "target", x: -0.95, y: HALF_W }, cpuCommand(tt, brain, DT)]);
      if (t.score[0] === 0) saves++;
    }
    expect(saves).toBeGreaterThanOrEqual(7);
  });

  it("scores against a player who does nothing", () => {
    const t = newTable(3, 5);
    const brain = newBrain(1);
    run(t, 90, (tt) => [null, cpuCommand(tt, brain, DT)]);
    expect(t.winner).toBe(1);
  });

  it("is beatable: a quicker, sharper player beats it most of the time", () => {
    let wins = 0;
    for (let s = 1; s <= 6; s++) {
      const t = newTable(3, s * 31);
      const cpu = newBrain(1);
      const human = newBrain(0, 1);
      human.speed = 3.2;       // a finger on the touchpad
      human.reaction = 0.06;
      run(t, 240, (tt) => (tt.phase === "over" ? [null, null] : [cpuCommand(tt, human, DT), cpuCommand(tt, cpu, DT)]));
      if (t.winner === 0) wins++;
    }
    expect(wins).toBeGreaterThanOrEqual(4);
  });

  it("is not trivial: it scores goals against an equal bot", () => {
    let cpuGoals = 0;
    for (let s = 1; s <= 4; s++) {
      const t = newTable(5, s * 17);
      const a = newBrain(0), b = newBrain(1);
      run(t, 240, (tt) => [cpuCommand(tt, a, DT), cpuCommand(tt, b, DT)]);
      cpuGoals += t.score[1];
      expect(t.score[0] + t.score[1]).toBeGreaterThan(0);
    }
    expect(cpuGoals).toBeGreaterThan(3);
    expect(GOAL_HALF).toBeGreaterThan(PUCK_R * 2);
  });
});
