import { describe, expect, it } from "vitest";
import { LEVELS } from "./levels";
import { levelPoints, newMaze, parseLevel, solvable, stepMaze, type MazeEvent } from "./physics";

const run = (s: ReturnType<typeof newMaze>, secs: number, tx: number, ty: number) => {
  const ev: MazeEvent[] = [];
  for (let t = 0; t < secs; t += 1 / 60) ev.push(...stepMaze(s, 1 / 60, tx, ty));
  return ev;
};

describe("maze levels", () => {
  it("every level is solvable and has a start and a goal", () => {
    for (const def of LEVELS) {
      const l = parseLevel(def);
      expect(def.rows.every((r) => r.length === l.w)).toBe(true);
      expect(solvable(l)).toBe(true);
    }
  });
});

describe("maze physics", () => {
  it("the ball rolls downhill and stays still on a level board", () => {
    const s = newMaze(parseLevel(LEVELS[0]!));
    const x0 = s.ball.x;
    run(s, 0.5, 0, 0);
    expect(s.ball.x).toBeCloseTo(x0, 5);
    run(s, 0.5, 1, 0);
    expect(s.ball.x).toBeGreaterThan(x0 + 0.5);
  });

  it("walls stop the ball", () => {
    const s = newMaze(parseLevel(LEVELS[0]!));
    run(s, 3, 0, -1); // roll up into the top wall
    expect(s.ball.y).toBeGreaterThan(1 + 0.29);
    run(s, 3, 0, 1);  // and down into the bottom wall
    expect(s.ball.y).toBeLessThan(4 - 0.29);
  });

  it("tilting right on the warm-up lane collects the coin and reaches the goal", () => {
    const s = newMaze(parseLevel(LEVELS[0]!));
    const ev = run(s, 6, 1, 0);
    expect(ev.map((e) => e.kind)).toContain("coin");
    expect(ev.map((e) => e.kind)).toContain("goal");
    expect(s.done).toBe(true);
    expect(levelPoints(s, true)).toBeGreaterThan(1000);
  });

  it("a hole sends the ball back to the checkpoint with a time penalty", () => {
    const l = parseLevel({ name: "t", timeLimit: 60, rows: ["#######", "#S.O.G#", "#######"] });
    const s = newMaze(l);
    let fell = false;
    for (let t = 0; t < 3 && !fell; t += 1 / 60) fell = stepMaze(s, 1 / 60, 1, 0).some((e) => e.kind === "fell");
    expect(fell).toBe(true);
    expect(s.falls).toBe(1);
    expect(s.time).toBeGreaterThan(3);
    expect(s.ball.x).toBe(1.5);     // back at the start (the only checkpoint so far)
    expect(s.ball.vx).toBe(0);
  });

  it("checkpoints move the respawn point", () => {
    const l = parseLevel({ name: "t", timeLimit: 60, rows: ["########", "#S.C.OG#", "########"] });
    const s = newMaze(l);
    const ev = run(s, 2, 0.6, 0);
    expect(ev.map((e) => e.kind)).toContain("checkpoint");
    expect(s.checkpoint.x).toBe(3.5);
  });

  it("the level ends when time runs out", () => {
    const s = newMaze(parseLevel({ name: "t", timeLimit: 1, rows: ["#####", "#S.G#", "#####"] }));
    const ev = run(s, 2, 0, 0);
    expect(ev.map((e) => e.kind)).toEqual(["timeout"]);
    expect(levelPoints(s, false)).toBe(0);
  });

  it("moving walls block and bounce the ball", () => {
    const l = parseLevel({ name: "t", timeLimit: 60, rows: ["#########", "#S..M..G#", "#########"] });
    const s = newMaze(l);
    let reversed = false;
    for (let t = 0; t < 4 && !s.done; t += 1 / 60) {
      stepMaze(s, 1 / 60, 1, 0);       // always tilted towards the goal, so only a wall can push the ball back
      if (s.ball.vx < -0.05) reversed = true;
    }
    expect(reversed).toBe(true);
  });
});
