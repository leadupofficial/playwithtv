import { describe, expect, it } from "vitest";
import {
  DIRS, NORMAL, QUICK, alive, currentSeq, input, inputLimit, litStep, makeSequence, newGame, ranking, rng, roundLen, showMs, tick, timing,
  type MemoryEvent, type MemoryGame,
} from "./engine";

const DT = 1000 / 60;

/** Runs fixed steps until `until` is true (or `maxMs` passes), collecting events. */
function runUntil(g: MemoryGame, until: (g: MemoryGame) => boolean, maxMs = 60_000, limits?: (id: string, len: number) => number) {
  const ev: MemoryEvent[] = [];
  for (let t = 0; t < maxMs && !until(g); t += DT) ev.push(...tick(g, DT, limits));
  return ev;
}
const toInput = (g: MemoryGame) => runUntil(g, (x) => x.phase === "input");
const answerAll = (g: MemoryGame, id: string) => currentSeq(g).flatMap((d) => input(g, id, d));
const wrongFor = (g: MemoryGame, i: number) => DIRS.find((d) => d !== currentSeq(g)[i])!;

describe("sequence generation", () => {
  it("is reproducible from the seed and uses only the four directions", () => {
    const a = makeSequence(40, rng(7));
    expect(a).toEqual(makeSequence(40, rng(7)));
    expect(a).not.toEqual(makeSequence(40, rng(8)));
    expect(a.every((d) => DIRS.includes(d))).toBe(true);
    expect(new Set(a).size).toBe(4);
  });

  it("never repeats a direction three times in a row", () => {
    for (let seed = 1; seed < 40; seed++) {
      const s = makeSequence(60, rng(seed));
      for (let i = 2; i < s.length; i++) expect(s[i] === s[i - 1] && s[i] === s[i - 2]).toBe(false);
    }
  });

  it("grows by one step per round and keeps the same prefix", () => {
    const g = newGame(["a"], NORMAL, 3);
    const first = currentSeq(g);
    expect(first).toHaveLength(NORMAL.startLen);
    toInput(g);
    answerAll(g, "a");
    runUntil(g, (x) => x.round === 1);
    const second = currentSeq(g);
    expect(second).toHaveLength(NORMAL.startLen + 1);
    expect(second.slice(0, first.length)).toEqual(first);
  });
});

describe("round timing", () => {
  it("plays faster every round, down to a floor", () => {
    expect(timing(1).stepMs).toBeLessThan(timing(0).stepMs);
    expect(timing(5).gapMs).toBeLessThan(timing(0).gapMs);
    expect(timing(100)).toEqual({ stepMs: 300, gapMs: 110 });
  });

  it("lights each step once, in order, during the show phase, then opens input", () => {
    const g = newGame(["a"], QUICK, 5);
    const ev = toInput(g);
    const shown = ev.filter((e) => e.kind === "show-step");
    expect(shown.map((e) => (e as { dir: string }).dir)).toEqual(currentSeq(g));
    expect(ev.at(-1)).toMatchObject({ kind: "input-start", round: 0, len: 2 });
    expect(showMs(g)).toBe(QUICK.leadMs + 2 * (timing(0).stepMs + timing(0).gapMs));
  });

  it("lights nothing during the lead-in and between steps", () => {
    const g = newGame(["a"], NORMAL, 1);
    const { stepMs } = timing(0);
    expect(litStep(g, 10)).toBe(-1);
    expect(litStep(g, NORMAL.leadMs + 5)).toBe(0);
    expect(litStep(g, NORMAL.leadMs + stepMs + 5)).toBe(-1);
  });

  it("gives motion players more time than buttons", () => {
    expect(inputLimit(5, "motion")).toBeGreaterThan(inputLimit(5, "touchpad"));
    expect(inputLimit(5, "touchpad")).toBeGreaterThan(inputLimit(5, "buttons"));
    expect(inputLimit(6)).toBeGreaterThan(inputLimit(5));
  });
});

describe("input checking", () => {
  it("ignores input while the sequence is being shown", () => {
    const g = newGame(["a"], QUICK, 2);
    expect(input(g, "a", currentSeq(g)[0]!)).toEqual([]);
    expect(g.players[0]!.progress).toBe(0);
  });

  it("counts partial progress and completes the round", () => {
    const g = newGame(["a", "b"], QUICK, 2);
    toInput(g);
    const seq = currentSeq(g);
    expect(input(g, "a", seq[0]!)).toEqual([{ kind: "step", id: "a", index: 0, dir: seq[0] }]);
    expect(g.players[0]).toMatchObject({ progress: 1, status: "entering", points: 10 });
    const ev = input(g, "a", seq[1]!);
    expect(ev.map((e) => e.kind)).toEqual(["step", "done"]);
    expect(g.players[0]).toMatchObject({ progress: 2, status: "done", cleared: 1, points: 70 });
    expect(input(g, "a", seq[0]!)).toEqual([]); // already done: extra taps don't count
    expect(g.phase).toBe("input");             // b is still entering
  });

  it("a wrong step costs a life and ends that player's round", () => {
    const g = newGame(["a", "b"], QUICK, 4);
    toInput(g);
    input(g, "a", currentSeq(g)[0]!);
    const ev = input(g, "a", wrongFor(g, 1));
    expect(ev).toEqual([
      { kind: "wrong", id: "a", index: 1, expected: currentSeq(g)[1], got: wrongFor(g, 1) },
      { kind: "life-lost", id: "a", lives: 2 },
    ]);
    expect(g.players[0]).toMatchObject({ status: "wrong", wrongAt: 1, progress: 1, lives: 2 });
    expect(input(g, "a", currentSeq(g)[1]!)).toEqual([]);
  });

  it("running out of time costs a life", () => {
    const g = newGame(["a"], QUICK, 4);
    toInput(g);
    const ev = runUntil(g, (x) => x.phase === "result");
    expect(ev.filter((e) => e.kind === "slow")).toEqual([{ kind: "slow", id: "a" }]);
    expect(g.players[0]!.lives).toBe(2);
  });

  it("uses each player's own time limit", () => {
    const g = newGame(["fast", "slow"], QUICK, 4);
    runUntil(g, (x) => x.phase === "input", 60_000, (id) => (id === "fast" ? 1000 : 5000));
    const ev = runUntil(g, (x) => x.players[0]!.status !== "entering", 60_000);
    expect(ev.find((e) => e.kind === "slow")).toEqual({ kind: "slow", id: "fast" });
    expect(g.players[1]!.status).toBe("entering");
  });
});

describe("lives, elimination and the winner", () => {
  it("three mistakes knock a player out; the last player standing wins", () => {
    const g = newGame(["a", "b"], NORMAL, 9);
    for (let r = 0; r < 3; r++) {
      toInput(g);
      answerAll(g, "a");
      const ev = input(g, "b", wrongFor(g, 0));
      if (r < 2) expect(ev.map((e) => e.kind)).toEqual(["wrong", "life-lost"]);
      else expect(ev.map((e) => e.kind)).toEqual(["wrong", "life-lost", "out"]);
      runUntil(g, (x) => x.phase !== "input");
      expect(g.phase).toBe("result");
      runUntil(g, (x) => x.phase !== "result");
    }
    expect(g.phase).toBe("over");
    expect(g.winners).toEqual(["a"]);
    expect(g.players[1]).toMatchObject({ out: true, outRound: 2, lives: 0 });
    expect(alive(g).map((p) => p.id)).toEqual(["a"]);
    expect(ranking(g)).toEqual([{ id: "a", points: 3 * 50 + (3 + 4 + 5) * 10, place: 1 }, { id: "b", points: 0, place: 2 }]);
  });

  it("a solo game goes on while lives last and ends at the last round", () => {
    const g = newGame(["solo"], QUICK, 11);
    for (let r = 0; r < QUICK.maxRounds; r++) {
      toInput(g);
      expect(roundLen(g)).toBe(QUICK.startLen + r);
      if (r === 1) input(g, "solo", wrongFor(g, 0));
      else answerAll(g, "solo");
      runUntil(g, (x) => x.phase !== "input" && x.phase !== "result");
    }
    expect(g.phase).toBe("over");
    expect(g.players[0]).toMatchObject({ out: false, lives: 2, cleared: 2 });
    expect(g.winners).toEqual(["solo"]);
  });

  it("when everyone is knocked out, the one who lasted longest wins", () => {
    const g = newGame(["a", "b", "c"], { ...NORMAL, lives: 1 }, 5);
    toInput(g);
    answerAll(g, "a");
    answerAll(g, "b");
    input(g, "c", wrongFor(g, 0));
    runUntil(g, (x) => x.round === 1 && x.phase === "input");
    input(g, "a", currentSeq(g)[0]!);   // a gets further than b before slipping
    input(g, "a", wrongFor(g, 1));
    input(g, "b", wrongFor(g, 0));
    runUntil(g, (x) => x.phase === "over");
    expect(g.winners).toEqual(["a"]);
    expect(ranking(g).map((r) => [r.id, r.place])).toEqual([["a", 1], ["b", 2], ["c", 3]]);
  });

  it("equal records share first place", () => {
    const g = newGame(["a", "b"], { ...QUICK, maxRounds: 1 }, 5);
    toInput(g);
    answerAll(g, "a");
    answerAll(g, "b");
    runUntil(g, (x) => x.phase === "over");
    expect(g.winners).toEqual(["a", "b"]);
    expect(ranking(g).map((r) => r.place)).toEqual([1, 1]);
  });

  it("does nothing once over", () => {
    const g = newGame(["a"], { ...QUICK, maxRounds: 1 }, 5);
    runUntil(g, (x) => x.phase === "over");
    expect(tick(g, DT)).toEqual([]);
    expect(input(g, "a", "up")).toEqual([]);
  });
});
