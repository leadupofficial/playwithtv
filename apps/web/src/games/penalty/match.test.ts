import { describe, expect, it } from "vitest";
import { CPU, NORMAL_MATCH, QUICK_MATCH, current, decided, newMatch, pairings, record, results, type Match } from "./match";

/** Plays kicks in order: `scores(kicker)` says whether that kicker scores. */
function play(m: Match, scores: (kicker: string, n: number) => boolean, max = 200) {
  const log: string[] = [];
  for (let n = 0; n < max && current(m); n++) {
    const p = current(m)!;
    log.push(`${p.kicker}>${p.keeper}`);
    record(m, scores(p.kicker, n));
  }
  return log;
}

describe("turn order", () => {
  it("everyone kicks at the next player, so each kicks and keeps once per round", () => {
    expect(pairings(["a", "b", "c"])).toEqual([{ kicker: "a", keeper: "b" }, { kicker: "b", keeper: "c" }, { kicker: "c", keeper: "a" }]);
    const m = newMatch(["a", "b", "c"], QUICK_MATCH);
    const log = play(m, (k) => k === "a");
    expect(log).toEqual(["a>b", "b>c", "c>a", "a>b", "b>c", "c>a"]);
  });

  it("solo: you kick at the CPU keeper, then keep against the CPU kicker", () => {
    const m = newMatch(["me"], NORMAL_MATCH);
    expect(m.takers).toEqual(["me", CPU]);
    expect(current(m)).toEqual({ kicker: "me", keeper: CPU });
    record(m, true);
    expect(current(m)).toEqual({ kicker: CPU, keeper: "me" });
  });
});

describe("scoring and the end", () => {
  it("most goals after the regular kicks wins; results rank by goals", () => {
    const m = newMatch(["a", "b", "c"], QUICK_MATCH);
    play(m, (k, n) => k === "a" || (k === "b" && n < 3));
    expect(m.phase).toBe("over");
    expect(m.goals).toEqual({ a: 2, b: 1, c: 0 });
    expect(m.winners).toEqual(["a"]);
    expect(results(m)).toEqual([{ playerId: "a", score: 2, place: 1 }, { playerId: "b", score: 1, place: 2 }, { playerId: "c", score: 0, place: 3 }]);
    expect(m.kicks.b).toEqual([true, false]);
  });

  it("solo: decided early once one side can't catch up", () => {
    const m = newMatch(["me"], NORMAL_MATCH);
    // me scores everything, the CPU misses everything: 3-0 with two kicks each left is not yet over…
    const log = play(m, (k) => k === "me");
    // after me 3 (kicks 3) and cpu 0 (kicks 2): cpu can reach 3 at most → still open; me 3, cpu 0 after 3 each: over
    expect(log).toHaveLength(6);
    expect(m.phase).toBe("over");
    expect(decided(m)).toBe(false); // over, so no longer "regular"
    expect(results(m)).toEqual([{ playerId: "me", score: 3, place: 1 }]);
  });

  it("solo: losing to the CPU is second place", () => {
    const m = newMatch(["me"], QUICK_MATCH);
    play(m, (k) => k === CPU);
    expect(results(m)).toEqual([{ playerId: "me", score: 0, place: 2 }]);
  });
});

describe("sudden death", () => {
  it("level leaders go to sudden death; the trailing player is out of it", () => {
    const m = newMatch(["a", "b", "c"], QUICK_MATCH);
    play(m, (k) => k !== "c", 6);
    expect(m.phase).toBe("sudden");
    expect(m.contenders).toEqual(["a", "b"]);
    expect(current(m)).toEqual({ kicker: "a", keeper: "b" });
    record(m, true);
    expect(current(m)).toEqual({ kicker: "b", keeper: "a" });
    record(m, false);
    expect(m.phase).toBe("over");
    expect(m.winners).toEqual(["a"]);
    expect(results(m).map((r) => [r.playerId, r.place])).toEqual([["a", 1], ["b", 2], ["c", 3]]);
  });

  it("goes on while both score or both miss, and shares the win after the last sudden-death round", () => {
    const m = newMatch(["a", "b"], QUICK_MATCH);
    const log = play(m, () => true);
    expect(log).toHaveLength(2 * 2 + 2 * QUICK_MATCH.maxSudden);
    expect(m.phase).toBe("over");
    expect(m.winners).toEqual(["a", "b"]);
    expect(results(m).map((r) => r.place)).toEqual([1, 1]);
  });

  it("solo sudden death against the CPU", () => {
    const m = newMatch(["me"], QUICK_MATCH);
    let sd = 0;
    play(m, (k) => {
      if (m.phase === "sudden") sd++;
      return m.phase === "regular" ? true : k === "me";
    });
    expect(sd).toBe(2);
    expect(m.winners).toEqual(["me"]);
    expect(m.goals).toEqual({ me: 3, cpu: 2 });
  });

  it("ignores records once the match is over", () => {
    const m = newMatch(["a", "b"], QUICK_MATCH);
    play(m, (k) => k === "a");
    const goals = { ...m.goals };
    record(m, true);
    expect(m.goals).toEqual(goals);
  });
});
