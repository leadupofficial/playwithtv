import { describe, expect, it } from "vitest";
import { AimLatch, BAT_SPEC, BOWL_SPEC, SWING_LAG, WATCH_SPEC, aimFrom, swingFrom } from "./controls";
import { boardState, overs } from "./board";
import { awards } from "./sim/awards";
import { makeTeams, newMatch, recordBall, type BallResult } from "./sim/match";
import { newGame } from "./sim/game";

describe("controls", () => {
  it("bat and bowl have their own titles (a player can swing in motion and bowl on the touchpad)", () => {
    expect(BAT_SPEC.title).not.toBe(BOWL_SPEC.title);
    expect(BAT_SPEC.modes[0]).toBe("motion");
    expect(BOWL_SPEC.modes[0]).toBe("touchpad");
    expect(BAT_SPEC.actions.find((a) => a.id === "swing")!.gestures).toEqual(["swing"]);
    expect(WATCH_SPEC.actions.map((a) => a.id)).toEqual(["cheer"]);
    for (const s of [BAT_SPEC, BOWL_SPEC, WATCH_SPEC]) for (const a of s.actions) expect(a.id.length).toBeLessThanOrEqual(16);
  });

  it("motion: swing strength sets the power, a gentle swing blocks", () => {
    const soft = swingFrom("swing", "motion", 1.1, { x: 0, y: 0 });
    const proper = swingFrom("swing", "motion", 2, { x: 0, y: 0 });
    const slog = swingFrom("swing", "motion", 3.4, { x: 0, y: 0 });
    expect(soft.defend).toBe(true);
    expect(proper.defend).toBeFalsy();
    expect(slog.power).toBeGreaterThan(proper.power);
    expect(slog.power).toBeLessThanOrEqual(1);
    expect(proper.lag).toBe(SWING_LAG.motion);
    expect(swingFrom("swing", "motion", 0, { x: 0, y: 0 }).defend).toBeFalsy(); // no strength sent: a normal swing
  });

  it("buttons: the stick aims and lofts, DEFEND blocks", () => {
    const s = swingFrom("swing", "buttons", 0, { x: -0.8, y: 1 });
    expect(s.aim).toBeCloseTo(-0.8);
    expect(s.loft).toBe(1);
    expect(s.power).toBeCloseTo(1);
    expect(swingFrom("defend", "buttons", 0, { x: 0, y: 0 }).defend).toBe(true);
  });

  it("aim: pad left = off side (screen left from the bowler's end), up = short", () => {
    expect(aimFrom(-1, 0).line).toBeGreaterThan(1);
    expect(aimFrom(1, 0).line).toBeLessThan(-1);
    expect(aimFrom(0, 1).length).toBe(1);
    expect(aimFrom(0, -1).length).toBe(0);
  });

  it("the latch keeps the last aim when the finger lifts, and a flick to bowl doesn't drag it", () => {
    const l = new AimLatch();
    l.feed(-0.5, -0.6, 1.0);
    l.feed(-0.5, -0.6, 1.2);
    l.feed(0, 0, 1.4); // lifted
    expect(l.aim.length).toBeCloseTo(0.2);
    // the release flick sweeps up the pad
    l.feed(0, -0.5, 1.6);
    l.feed(0, 0.4, 1.65);
    l.feed(0, 0.9, 1.7);
    const plan = l.release(1.72);
    expect(plan.line).toBeCloseTo(0.65);
    expect(plan.length).toBeCloseTo(0.2);
    l.kind = "spin";
    expect(l.release(1.72).kind).toBe("spin");
    l.reset();
    expect(l.aim.length).toBeCloseTo(0.45);
  });

  it("tilt (motion) follows live, including back to the centre", () => {
    const l = new AimLatch();
    l.feed(0.5, 0.5, 1, true);
    l.feed(0, 0, 2, true);
    expect(l.aim.line).toBeCloseTo(0);
  });
});

describe("board and awards", () => {
  const humans = [{ id: "a", name: "Asha", color: "#f00" }, { id: "b", name: "Ravi", color: "#00f" }];
  const r = (runs: number, extra: Partial<BallResult> = {}): BallResult => ({ runs, extras: 0, wicket: null, kind: runs === 6 ? "six" : runs ? "runs" : "dot", bonus: 0, ...extra });

  it("overs read like cricket", () => {
    expect(overs(0)).toBe("0.0");
    expect(overs(4)).toBe("0.4");
    expect(overs(7)).toBe("1.1");
  });

  it("the scoreboard shows the batting side, the chase equation and ball-by-ball dots", () => {
    const g = newGame(makeTeams(humans, ["Chintu", "Pinky"]), { ballsPerInnings: 3, bowlOutBalls: 3, maxSuddenDeath: 3 }, { quick: true });
    recordBall(g.match, r(6, { kind: "window", bonus: 2 }));
    recordBall(g.match, { ...r(0), wicket: "bowled", kind: "miss" });
    recordBall(g.match, r(1));
    const s = boardState(g);
    expect(s.batting).toBe(1);
    expect(s.target).toBe(10);
    expect(s.need).toBe("Need 10 off 3 balls");
    expect(s.teams[0]!.runs).toBe(9);
    expect(s.dots).toEqual([]); // the chase has no balls yet
    recordBall(g.match, r(4, { kind: "four" }));
    expect(boardState(g).dots).toEqual(["4"]);
  });

  it("awards: Gully King for runs, Window Smasher, Golden Arm for wickets", () => {
    const m = newMatch(makeTeams(humans, ["Chintu", "Pinky"]), { ballsPerInnings: 6, bowlOutBalls: 3, maxSuddenDeath: 3 });
    recordBall(m, r(6, { kind: "window", bonus: 2 })); // Asha (a) bats, Ravi (b) bowls
    recordBall(m, r(1));                                // cpu0 bats, cpu1 bowls
    recordBall(m, { ...r(0), wicket: "bowled", kind: "miss" }); // a out, b bowls
    const list = awards(m);
    const by = (id: string) => list.find((x) => x.id === id);
    expect(list[0]!.id).toBe("king");
    expect(by("king")!.playerId).toBe("a");
    expect(by("window")).toBeDefined();
    expect(by("arm")!.playerId).toBe("b");
    expect(by("arm")!.detail).toBe("1 wicket for 8");
  });
});
