import { describe, expect, it } from "vitest";
import { songBars, songMs } from "./beat-blade/music";
import { DanceRun, POINTS, SYNC_BONUS, WINDOWS } from "./groove/engine";
import { GESTURE_ACTIONS, MOVES, MOVE_IDS, matchOf } from "./groove/moves";
import { forDifficulty, parseRoutine } from "./groove/routine";
import { CITIES, DANCES, REWARDS } from "./groove/songs";

const BPM = 120; // a beat = 500 ms

describe("routine text", () => {
  it("reads moves, holds and rests, bar by bar, in song order", () => {
    const r = parseRoutine(`
      # a comment
      A: up - down . | . . punch -
      song: A*2
    `, BPM);
    expect(r.bars).toBe(4);
    expect(r.steps.map((s) => [s.t, s.move, s.hold])).toEqual([
      [0, "up", 1000], [1000, "down", 500], [3000, "punch", 1000],
      [4000, "up", 1000], [5000, "down", 500], [7000, "punch", 1000],
    ]);
    expect(r.steps[2]).toMatchObject({ bar: 2, beat: 3 });
  });
  it("reads half-beat bars", () => {
    const r = parseRoutine("Q: up . down . left . right .\nsong: Q", BPM);
    expect(r.steps.map((s) => s.t)).toEqual([0, 500, 1000, 1500]);
    const h = parseRoutine("Q: up down - - left - right -\nsong: Q", BPM);
    expect(h.steps.map((s) => [s.t, s.hold])).toEqual([[0, 250], [250, 750], [1000, 500], [1500, 500]]);
  });
  it("explains mistakes in words", () => {
    expect(() => parseRoutine("A: up - -\nsong: A", BPM)).toThrow(/bar 1 has 3 beats/);
    expect(() => parseRoutine("A: up - moonwalk -\nsong: A", BPM)).toThrow(/"moonwalk"/);
    expect(() => parseRoutine("A: up - - -", BPM)).toThrow(/song:/);
    expect(() => parseRoutine("A: up - - -\nsong: A B", BPM)).toThrow(/no phrase called that/);
    expect(() => parseRoutine("up - - -", BPM)).toThrow(/needs a name/);
  });
  it("easy keeps at most one move per half bar", () => {
    const r = parseRoutine("A: up down left right | punch - - -\nsong: A", BPM);
    const easy = forDifficulty(r, "easy", BPM);
    expect(easy.map((s) => [s.t, s.move])).toEqual([[0, "up"], [1000, "left"], [2000, "punch"]]);
    expect(easy[0]!.hold).toBe(1000);
    expect(forDifficulty(r, "hard", BPM)).toBe(r.steps);
  });
});

describe("the songs", () => {
  it("every routine is valid and exactly as long as its music", () => {
    for (const d of DANCES) {
      const r = parseRoutine(d.routine, d.bpm);
      expect(r.bars, d.id).toBe(songBars(d));
      expect(r.steps.length, d.id).toBeGreaterThan(30);
      // no move closer than the phone's gesture cooldown (280 ms), on any difficulty
      for (const steps of [r.steps, forDifficulty(r, "easy", d.bpm)]) {
        for (let i = 1; i < steps.length; i++) expect(steps[i]!.t - steps[i - 1]!.t, `${d.id} step ${i}`).toBeGreaterThanOrEqual(400);
      }
    }
  });
  it("ids are unique, every city has a story and rewards climb within reach", () => {
    expect(new Set(DANCES.map((d) => d.id)).size).toBe(DANCES.length);
    for (const c of CITIES) expect(c.story.length).toBeGreaterThan(80);
    const stars = REWARDS.map((r) => r.stars);
    expect(stars).toEqual([...stars].sort((a, b) => a - b));
    expect(Math.max(...stars)).toBeLessThanOrEqual(DANCES.length * 3);
    expect(songMs(DANCES[0]!)).toBeGreaterThan(60_000);
  });
  it("every move can be danced by some gesture the phone sends", () => {
    const sent = new Set(GESTURE_ACTIONS.map((a) => a.gesture));
    for (const id of MOVE_IDS) expect(sent.has(MOVES[id].gesture), id).toBe(true);
    expect(matchOf(MOVES.left, "flick-left")).toBe("match");
    expect(matchOf(MOVES.left, "flick-right")).toBe("mirror");
    expect(matchOf(MOVES.up, "flick-down")).toBe("other");
  });
});

const routine = (text: string) => parseRoutine(text + "\nsong: A", BPM).steps;

describe("judging dances", () => {
  const steps = routine("A: up - left - | right - punch -"); // 0 up, 1000 left, 2000 right, 3000 punch

  it("scores the right move by timing", () => {
    const w = WINDOWS.normal;
    const run = new DanceRun(steps, 1, "normal");
    expect(run.dance(0, "flick-up", 40)[0]).toMatchObject({ judgement: "perfect", points: POINTS.perfect });
    expect(run.dance(0, "flick-left", 1000 + w.super - 10)[0]).toMatchObject({ judgement: "super" });
    expect(run.dance(0, "flick-right", 2000 - w.good + 10)[0]).toMatchObject({ judgement: "good" });
    expect(run.dancers[0]!.streak).toBe(3);
  });

  it("a mirrored move pencils in GOOD, and the right move still upgrades it", () => {
    const run = new DanceRun(steps, 1, "normal");
    expect(run.dance(0, "flick-right", 1000)).toEqual([]); // mirror of left
    expect(run.update(1500).find((e) => e.kind === "judge" && e.step === 1)).toMatchObject({ judgement: "good" });
    const again = new DanceRun(steps, 1, "normal");
    again.dance(0, "flick-right", 950);
    expect(again.dance(0, "flick-left", 1050)[0]).toMatchObject({ judgement: "perfect", step: 1 });
  });

  it("a flick's swing back does not steal the next step", () => {
    // flick up on the beat, the phone feels the return as a flick down 250 ms later; the next move is left
    const run = new DanceRun(steps, 1, "normal");
    run.dance(0, "flick-up", 0);
    run.dance(0, "flick-down", 250);
    expect(run.dance(0, "flick-left", 1020)[0]).toMatchObject({ judgement: "perfect", step: 1 });
  });

  it("any other move near the beat is OK; nothing is a MISS; misses break the streak", () => {
    const run = new DanceRun(steps, 1, "normal");
    run.dance(0, "flick-up", 0);
    run.dance(0, "shake", 1000);
    const evs = run.update(5000);
    expect(evs.filter((e) => e.kind === "judge").map((e) => e.kind === "judge" && e.judgement)).toEqual(["ok", "miss", "miss"]);
    expect(run.dancers[0]!.streak).toBe(0);
    expect(run.dancers[0]!.best).toBe(1);
    expect(run.accuracy(0)).toBeCloseTo((100 + 20) / 400);
  });

  it("gestures between moves score nothing", () => {
    const run = new DanceRun(routine("A: up - - - | punch - - -"), 1, "hard");
    expect(run.dance(0, "push", 900)).toEqual([]);
    expect(run.dance(0, "push", 2000)[0]).toMatchObject({ judgement: "perfect", step: 1 });
  });

  it("streaks raise the multiplier", () => {
    const many = routine("A: up - down - | up - down - | up - down - | up - down - | up - down -");
    const run = new DanceRun(many, 1, "normal");
    let mult: unknown = null;
    many.forEach((s) => run.dance(0, MOVES[s.move].gesture, s.t).forEach((e) => { if (e.kind === "mult") mult = e.mult; }));
    expect(mult).toBe(2);
    expect(run.dancers[0]!.score).toBe(8 * 100 + 2 * 200);
    expect(run.stars()).toBe(3);
    expect(run.rating(0)).toBe("SUPERSTAR");
  });

  it("dancers who nail the same step together are IN SYNC", () => {
    const run = new DanceRun(steps, 3, "normal");
    run.dance(0, "flick-up", 0);
    const evs = run.dance(1, "flick-up", 60);
    expect(evs.find((e) => e.kind === "sync")).toMatchObject({ players: [0, 1] });
    expect(run.dancers[0]!.score).toBe(100 + SYNC_BONUS);
    run.dance(2, "flick-up", 90); // joins late
    expect(run.dancers[2]!.syncs).toBe(1);
    run.dance(0, "flick-left", 1000);
    run.dance(1, "flick-right", 1000); // mirror: no sync
    expect(run.dancers[0]!.syncs).toBe(1);
  });

  it("the room's stars come from its best dancer; nobody fails", () => {
    const run = new DanceRun(steps, 2, "easy");
    steps.forEach((s) => run.dance(0, MOVES[s.move].gesture, s.t));
    run.update(10_000);
    expect(run.accuracy(1)).toBe(0);
    expect(run.stars()).toBe(3);
    expect(run.over(run.end + 601)).toBe(true);
  });
});
