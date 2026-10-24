import { describe, expect, it } from "vitest";
import { bowler, makeTeams, newMatch, nonStriker, playerScores, recordBall, recordBowlOut, striker, target, type BallResult, type MatchConfig } from "./match";

const cfg: MatchConfig = { ballsPerInnings: 6, bowlOutBalls: 3, maxSuddenDeath: 3 };
const humans = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, color: "#fff" }));
const CPU = ["Chintu", "Pinky", "Golu", "Munni", "Bablu", "Tinku"];
const runs = (n: number, extra: Partial<BallResult> = {}): BallResult => ({ runs: n, extras: 0, wicket: null, kind: n === 6 ? "six" : n === 4 ? "four" : n ? "runs" : "dot", bonus: 0, ...extra });
const out = (wicket: BallResult["wicket"] = "bowled"): BallResult => ({ runs: 0, extras: 0, wicket, kind: "miss", bonus: 0 });

describe("teams", () => {
  it("splits players alternately and fills both teams with CPU kids to the same size (at least 2)", () => {
    const solo = makeTeams(humans(1), CPU);
    expect(solo.filter((m) => m.team === 0).length).toBe(2);
    expect(solo.filter((m) => m.team === 1).length).toBe(2);
    expect(solo.filter((m) => !m.cpu).map((m) => m.team)).toEqual([0]);
    const five = makeTeams(humans(5), CPU);
    expect(five.filter((m) => m.team === 0).length).toBe(3);
    expect(five.filter((m) => m.team === 1).length).toBe(3);
    expect(five.filter((m) => m.cpu).length).toBe(1);
    const eight = makeTeams(humans(8), CPU);
    expect(eight.every((m) => !m.cpu)).toBe(true);
    expect(new Set(eight.map((m) => m.id)).size).toBe(8);
  });
});

describe("an innings", () => {
  it("rotates the striker through the whole batting team every ball, and the bowlers too", () => {
    const m = newMatch(makeTeams(humans(4), CPU), cfg);
    const batters: string[] = [], bowlers: string[] = [];
    for (let i = 0; i < 4; i++) {
      batters.push(striker(m));
      bowlers.push(bowler(m));
      recordBall(m, runs(1));
    }
    expect(batters).toEqual(["p0", "p2", "p0", "p2"]);
    expect(bowlers).toEqual(["p1", "p3", "p1", "p3"]);
  });

  it("skips batters who are out; the partner is the next one in", () => {
    const m = newMatch(makeTeams(humans(6), CPU), cfg); // team 0: p0, p2, p4
    expect(striker(m)).toBe("p0");
    expect(nonStriker(m)).toBe("p2");
    recordBall(m, out());                // p0 out
    expect(striker(m)).toBe("p2");
    recordBall(m, runs(2));
    expect(striker(m)).toBe("p4");
    recordBall(m, runs(0));
    expect(striker(m)).toBe("p2");       // p0 is skipped from now on
    expect(m.stats.get("p0")!.out).toBe(true);
    expect(m.teams[0].wickets).toBe(1);
  });

  it("counts runs, boundaries, window bonuses, extras and the bowler's figures", () => {
    const m = newMatch(makeTeams(humans(2), CPU), cfg);
    recordBall(m, runs(6, { kind: "window", bonus: 2 }));
    recordBall(m, runs(0, { extras: 1, kind: "wide" }));
    recordBall(m, runs(4));
    const t = m.teams[0];
    expect(t.runs).toBe(8 + 1 + 4);
    expect(t.extras).toBe(1);
    expect(t.balls).toBe(3);
    const p0 = m.stats.get("p0")!;
    expect(p0.sixes).toBe(1);
    expect(p0.windows).toBe(1);
    expect(p0.runs).toBe(8 + 4); // the striker rotates p0, cpu0, p0: the window and the four
    expect(m.stats.get("cpu0")!.runs).toBe(0); // the wide is an extra, not the batter's
    expect(m.stats.get("p1")!.conceded + m.stats.get("cpu1")!.conceded).toBe(13);
  });

  it("ends after the balls, or when everyone is out, then the chase needs the target", () => {
    const m = newMatch(makeTeams(humans(2), CPU), cfg);
    let r = recordBall(m, runs(4));
    for (let i = 1; i < 6; i++) r = recordBall(m, runs(1));
    expect(r.inningsOver).toBe(true);
    expect(m.stage).toBe(1);
    expect(m.batting).toBe(1);
    expect(target(m)).toBe(10);
    recordBall(m, out());
    r = recordBall(m, out());
    expect(r.matchOver).toBe(true); // all out
    expect(m.winner).toBe(0);
    expect(m.decided).toBe("runs");
  });

  it("a successful chase ends at once", () => {
    const m = newMatch(makeTeams(humans(2), CPU), { ...cfg, ballsPerInnings: 3 });
    for (let i = 0; i < 3; i++) recordBall(m, runs(1));
    const r = recordBall(m, runs(6));
    expect(r.matchOver).toBe(true);
    expect(m.winner).toBe(1);
    expect(m.decided).toBe("wickets");
    expect(m.teams[1].balls).toBe(1);
  });

  it("a tie goes to a bowl-out", () => {
    const m = newMatch(makeTeams(humans(2), CPU), { ...cfg, ballsPerInnings: 2 });
    recordBall(m, runs(2));
    recordBall(m, runs(2));
    recordBall(m, runs(4));
    const r = recordBall(m, runs(0));
    expect(r.bowlOut).toBe(true);
    expect(m.stage).toBe(2);
  });
});

describe("the bowl-out", () => {
  const tied = () => {
    const m = newMatch(makeTeams(humans(2), CPU), { ...cfg, ballsPerInnings: 1 });
    recordBall(m, runs(1));
    recordBall(m, runs(1));
    return m;
  };

  it("alternates teams (the chasing side bowls first) and stops when one side can't catch up", () => {
    const m = tied();
    expect(m.bowlOut.turn).toBe(1);
    const order: number[] = [];
    let done = false;
    const hits = [true, false, true, false, true];
    for (const h of hits) {
      order.push(m.bowlOut.turn);
      done = recordBowlOut(m, h);
      if (done) break;
    }
    expect(order.slice(0, 4)).toEqual([1, 0, 1, 0]);
    expect(done).toBe(true);
    expect(m.winner).toBe(1);
    expect(m.decided).toBe("bowl-out");
  });

  it("goes to sudden death when level after three each, and to a toss after that", () => {
    const m = tied();
    for (let i = 0; i < 6; i++) expect(recordBowlOut(m, true)).toBe(false);
    expect(recordBowlOut(m, false)).toBe(false);
    expect(recordBowlOut(m, true)).toBe(true); // team 0 hits, team 1 missed: team 0 wins the pair
    expect(m.winner).toBe(0);

    const n = tied();
    let done = false;
    for (let i = 0; i < 40 && !done; i++) done = recordBowlOut(n, false, () => 0.2);
    expect(done).toBe(true);
    expect(n.decided).toBe("toss");
    expect(n.bowlOut.balls[0]).toBe(cfg.bowlOutBalls + cfg.maxSuddenDeath);
  });
});

describe("scores for the results screen", () => {
  it("runs + 10 per wicket + 5 per catch", () => {
    const m = newMatch(makeTeams(humans(2), CPU), cfg);
    recordBall(m, runs(4));
    recordBall(m, { ...out("caught"), catcher: "p1" });
    const s = playerScores(m);
    expect(s.get("p0")).toBe(4);
    // p1 bowled ball 1 (no wicket); cpu1 bowled the wicket ball; p1 took the catch
    expect(s.get("p1")).toBe(5);
    expect(s.get("cpu1")).toBe(10);
  });
});
