import { describe, expect, it } from "vitest";
import { SWING_LAG } from "../controls";
import { LATEST_SWING, QUICK, newGame, step, type Game, type GameEvent, type Inputs, type Phase } from "./game";
import { makeTeams } from "./match";

const DT = 1 / 60;
const CPU = ["Chintu", "Pinky", "Golu", "Munni", "Bablu", "Tinku"];
const cfg = { ballsPerInnings: 3, bowlOutBalls: 3, maxSuddenDeath: 3 };

function game(humans = 1, seed = 3) {
  const players = Array.from({ length: humans }, (_, i) => ({ id: `p${i}`, name: `P${i}`, color: "#fff" }));
  return newGame(makeTeams(players, CPU), cfg, { quick: true, seed });
}

/** Steps until a phase (or a time limit); `input` is asked every step. */
function until(g: Game, phase: Phase, input: (g: Game) => Inputs = () => ({}), maxS = 60): GameEvent[] {
  const ev: GameEvent[] = [];
  for (let t = 0; t < maxS && g.phase !== phase; t += DT) ev.push(...step(g, DT, input(g)));
  return ev;
}

describe("the director", () => {
  it("an all-CPU match plays from the intro to the podium with a winner", () => {
    const g = newGame(makeTeams([], CPU), cfg, { quick: true, seed: 9 });
    const ev = until(g, "podium", () => ({}), 600);
    expect(g.phase).toBe("podium");
    expect(g.match.winner).not.toBeNull();
    const kinds = new Set(ev.map((e) => e.kind));
    for (const k of ["release", "result", "innings", "over"]) expect(kinds.has(k as GameEvent["kind"])).toBe(true);
    // both innings were played (unless a tie went to the bowl-out, which needs both innings too)
    expect(g.match.teams[0].balls + g.match.teams[1].balls).toBeGreaterThanOrEqual(4);
  });

  it("goes intro → innings → aim; a human bowler releases when they choose (or after the time limit)", () => {
    const g = game(2);
    until(g, "aim");
    expect(g.ball!.bowler).toBe("p1");                  // team 1 fields first; p1 is its first bowler
    step(g, DT, { aim: { line: 0.3, length: 0.8, kind: "spin" } });
    expect(g.ball!.aim).toEqual({ line: 0.3, length: 0.8, kind: "spin" });
    step(g, DT, {});
    expect(g.phase).toBe("aim");
    const ev = step(g, DT, { release: true });
    expect(ev.some((e) => e.kind === "release")).toBe(true);
    expect(g.phase).toBe("runup");
    expect(g.ball!.delivery!.plan.kind).toBe("spin");

    const h = game(2);
    until(h, "aim");
    until(h, "runup", () => ({}), QUICK.aimMax + 1);
    expect(h.phase).toBe("runup");
  });

  it("a perfectly timed human swing makes contact and plays the shot out", () => {
    const g = game(1);
    until(g, "delivery", (s) => (s.phase === "aim" ? {} : {}));
    expect(g.ball!.batter).toBe("p0");
    const d = g.ball!.delivery!;
    let swung = false;
    const ev = until(g, "result", (s) => {
      if (!swung && s.phase === "delivery" && s.ball!.t >= d.tContact) {
        swung = true;
        return { swing: { dtMs: 0, power: 0.9, lag: 0 } };
      }
      return {};
    });
    const sw = ev.find((e) => e.kind === "swing") as Extract<GameEvent, { kind: "swing" }>;
    expect(sw.timing).toBe("perfect");
    expect(sw.contact).toBe(true);
    expect(ev.some((e) => e.kind === "hit")).toBe(true);
    expect(g.ball!.result).not.toBeNull();
  });

  it("latency compensation: a swing that arrives late by the lag still counts as on time", () => {
    const g = game(1, 4);
    until(g, "delivery");
    const d = g.ball!.delivery!;
    let swung = false;
    const ev = until(g, "result", (s) => {
      if (!swung && s.phase === "delivery" && s.ball!.t >= d.tContact + 0.05) {
        swung = true;
        return { swing: { dtMs: 0, power: 0.5, lag: 0.05 } };
      }
      return {};
    });
    const sw = ev.find((e) => e.kind === "swing") as Extract<GameEvent, { kind: "swing" }>;
    expect(sw.timing).toBe("perfect");
  });

  it("a perfectly timed motion swing still counts when it reaches the TV after the late window, even on a ball at the stumps", () => {
    // motion swings arrive SWING_LAG.motion (0.12 s) after they were made, plus Wi-Fi jitter: past the 85 ms late window
    for (const extra of [0, 0.06]) {
      let tested = 0;
      for (let seed = 1; seed < 40 && tested < 3; seed++) {
        const g = game(1, seed);
        until(g, "delivery");
        const d = g.ball!.delivery!;
        if (!d.hitsStumps) continue; // the hard case: without the swing this ball is bowled
        tested++;
        const arrive = d.tContact + SWING_LAG.motion + extra;
        let swung = false;
        const ev = until(g, "result", (s) => {
          if (!swung && s.phase === "delivery" && s.ball!.t >= arrive) {
            swung = true;
            return { swing: { dtMs: 0, power: 0.8, aim: 0, loft: 0, lag: SWING_LAG.motion + extra } };
          }
          return {};
        });
        const sw = ev.find((e) => e.kind === "swing") as Extract<GameEvent, { kind: "swing" }>;
        expect(sw.timing, `seed ${seed} +${extra}s`).toBe("perfect");
        expect(sw.contact).toBe(true);
        expect(ev.some((e) => e.kind === "stumps")).toBe(false);
        expect(g.ball!.result!.wicket).not.toBe("bowled");
      }
      expect(tested).toBe(3);
    }
    expect(SWING_LAG.motion + 0.06).toBeLessThanOrEqual(LATEST_SWING);
  });

  it("a swing really made too late is still a miss: the ball goes on to the stumps", () => {
    for (let seed = 1; seed < 40; seed++) {
      const g = game(1, seed);
      until(g, "delivery");
      const d = g.ball!.delivery!;
      if (!d.hitsStumps) continue;
      let swung = false;
      const ev = until(g, "result", (s) => {
        // made 0.15 s after the ball passed the bat (well past the 85 ms late window), delivered with no lag
        if (!swung && s.phase === "delivery" && s.ball!.t >= d.tContact + 0.15) {
          swung = true;
          return { swing: { dtMs: 0, power: 0.8, lag: 0 } };
        }
        return {};
      });
      expect((ev.find((e) => e.kind === "swing") as Extract<GameEvent, { kind: "swing" }>).contact).toBe(false);
      expect(g.ball!.result!.wicket).toBe("bowled");
      return;
    }
    throw new Error("no delivery hit the stumps");
  });

  it("no swing at a ball on the stumps: bowled", () => {
    for (let seed = 1; seed < 40; seed++) {
      const g = game(1, seed);
      until(g, "delivery");
      if (!g.ball!.delivery!.hitsStumps) continue;
      const ev = until(g, "result");
      expect(ev.some((e) => e.kind === "stumps")).toBe(true);
      expect(g.ball!.result!.wicket).toBe("bowled");
      return;
    }
    throw new Error("no delivery hit the stumps");
  });

  it("sixes and wickets get a replay, other balls don't", () => {
    const g = newGame(makeTeams([], CPU), { ...cfg, ballsPerInnings: 6 }, { quick: true, seed: 21 });
    let replays = 0, big = 0, results = 0;
    for (let t = 0; t < 900 && g.phase !== "podium"; t += DT) {
      const before = g.phase, ball = g.ball;
      step(g, DT);
      if (before === "result" && g.phase !== "result" && ball && !ball.bowlOut) {
        results++;
        const r = ball.result!;
        const isBig = r.kind === "six" || r.kind === "window" || (!!r.wicket && r.wicket !== "runout");
        if (isBig) big++;
        if (g.phase === "replay") replays++;
        expect(g.phase === "replay").toBe(isBig);
      }
    }
    expect(results).toBeGreaterThan(4);
    expect(replays).toBe(big);
  });

  it("a tied match goes to a bowl-out and still ends on the podium", () => {
    // find a seed whose all-CPU match is tied
    for (let seed = 1; seed < 400; seed++) {
      const g = newGame(makeTeams([], CPU), { ...cfg, ballsPerInnings: 1 }, { quick: true, seed });
      const ev = until(g, "podium", () => ({}), 300);
      if (g.match.decided !== "bowl-out" && g.match.decided !== "toss") continue;
      expect(ev.filter((e) => e.kind === "result").length).toBeGreaterThan(2);
      expect(g.match.bowlOut.balls[0] + g.match.bowlOut.balls[1]).toBeGreaterThanOrEqual(2);
      expect(g.phase).toBe("podium");
      return;
    }
    throw new Error("no tie found");
  });
});
