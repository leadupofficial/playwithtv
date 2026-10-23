import { describe, expect, it } from "vitest";
import { makeRounds, placings, points, rng, QUESTION_MS } from "./engine";
import { QUESTIONS } from "./questions";

describe("trivia engine", () => {
  it("question bank is well formed in both languages", () => {
    const ids = new Set<string>();
    for (const q of QUESTIONS) {
      expect(ids.has(q.id)).toBe(false);
      ids.add(q.id);
      expect(q.q.en.length).toBeGreaterThan(5);
      expect(q.q.ta.length).toBeGreaterThan(5);
      expect(q.options.en).toHaveLength(4);
      expect(q.options.ta).toHaveLength(4);
      expect(new Set(q.options.en).size).toBe(4);
      expect([0, 1, 2, 3]).toContain(q.answer);
    }
    expect(QUESTIONS.length).toBeGreaterThanOrEqual(30);
  });

  it("shuffles options but keeps track of the right answer", () => {
    const rounds = makeRounds(QUESTIONS, 8, rng(42));
    expect(rounds).toHaveLength(8);
    expect(new Set(rounds.map((r) => r.question.id)).size).toBe(8);
    for (const r of rounds) {
      expect([...r.order].sort()).toEqual([0, 1, 2, 3]);
      expect(r.order[r.correct]).toBe(r.question.answer);
    }
  });

  it("rewards correct and faster answers", () => {
    expect(points(false, QUESTION_MS)).toBe(0);
    expect(points(true, 0)).toBe(500);
    expect(points(true, QUESTION_MS)).toBe(1000);
    expect(points(true, QUESTION_MS / 2)).toBe(750);
  });

  it("ranks players with shared places for ties", () => {
    const r = placings(new Map([["a", 1500], ["b", 2000], ["c", 1500], ["d", 0]]));
    expect(r.map((x) => [x.playerId, x.place])).toEqual([["b", 1], ["a", 2], ["c", 2], ["d", 4]]);
  });
});
