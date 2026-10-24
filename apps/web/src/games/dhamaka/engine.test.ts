import { describe, expect, it } from "vitest";
import { QUICK, NORMAL, answer, buzz, lockWager, newGame, player, round, setAway, setWager, skip, standings, tick, type Game, type GameEvent, type Phase } from "./engine";
import { NORMAL_PLAN, QUICK_PLAN, correctPos, correctSeq, makePlan, rng } from "./plan";
import { awards } from "./awards";
import { emojiPoints, speedPoints, streakBonus, withComeback } from "./scoring";

const plan = (seed = 7) => makePlan(QUICK_PLAN, "en", rng(seed));
const game = (ids = ["a", "b", "c"], seed = 7) => newGame(ids, plan(seed), QUICK);

/** Ticks until the game reaches `phase` (fails after `maxMs` of simulated time). */
function until(g: Game, phase: Phase, ev: GameEvent[] = [], maxMs = 120_000): GameEvent[] {
  for (let t = 0; t < maxMs && g.phase !== phase; t += 100) ev.push(...tick(g, 100));
  expect(g.phase).toBe(phase);
  return ev;
}
const wrong = (g: Game) => (correctPos(round(g)) + 1) % 4;
const score = (g: Game, id: string) => player(g, id)!.score;

describe("Emoji Dhamaka rounds", () => {
  it("reveals emoji one by one and pays more for an early buzz", () => {
    const g = game();
    until(g, "reveal");
    expect(g.revealed).toBe(1);
    tick(g, QUICK.revealStep);
    expect(g.revealed).toBe(2);
    buzz(g, "a");
    expect(g.phase).toBe("answer");
    expect(buzz(g, "b")).toEqual([]); // only one buzzer at a time
    answer(g, "b", correctPos(round(g))); // not their turn
    expect(g.phase).toBe("answer");
    answer(g, "a", correctPos(round(g)));
    expect(g.phase).toBe("result");
    expect(score(g, "a")).toBe(emojiPoints(2));
    expect(g.outcome).toMatchObject({ buzzer: "a", buzzerRight: true, winners: ["a"] });
  });

  it("a wrong buzz costs points, locks the buzzer out and opens a steal; the first right steal wins", () => {
    const g = game();
    until(g, "reveal");
    buzz(g, "a");
    const ev = answer(g, "a", wrong(g));
    expect(ev.map((e) => e.kind)).toEqual(["wrong-buzz", "phase", "steal-open"]);
    expect(g.phase).toBe("steal");
    expect(player(g, "a")!.locked).toBe(true);
    expect(g.revealed).toBe(round(g).q.emoji!.length); // every clue shows for the steal
    answer(g, "a", correctPos(round(g)));              // locked out: ignored
    answer(g, "b", wrong(g));                          // the eliminated option is ignored
    expect(player(g, "b")!.answer).toBeNull();
    answer(g, "b", (correctPos(round(g)) + 2) % 4);    // a different wrong answer
    expect(g.phase).toBe("steal");
    answer(g, "c", correctPos(round(g)));
    expect(g.phase).toBe("result");
    expect(g.outcome).toMatchObject({ stealer: "c", buzzerRight: false });
    expect(score(g, "c")).toBe(500);
    expect(score(g, "a")).toBe(0); // the penalty never takes a score below zero
    expect(player(g, "a")!.stats.wrongBuzzes).toBe(1);
  });

  it("the buzzer running out of time counts as a wrong buzz", () => {
    const g = game(["a", "b"]);
    until(g, "reveal");
    buzz(g, "a");
    const ev = until(g, "steal");
    expect(ev.some((e) => e.kind === "wrong-buzz" && e.timeout)).toBe(true);
  });

  it("nobody buzzing turns the puzzle into an all-answer round for fewer points", () => {
    const g = game(["a", "b"]);
    until(g, "reveal");
    until(g, "all");
    answer(g, "a", correctPos(round(g)));
    answer(g, "b", wrong(g));
    expect(g.phase).toBe("result");
    expect(score(g, "a")).toBeLessThanOrEqual(500);
    expect(score(g, "a")).toBeGreaterThanOrEqual(250);
  });

  it("all-answer rounds pay for speed and end once everyone has answered", () => {
    const g = game(["a", "b"]);
    until(g, "reveal");
    until(g, "all");
    until(g, "result");
    until(g, "all"); // round 2: a fact question
    expect(round(g).kind).toBe("mcq");
    answer(g, "a", correctPos(round(g)));
    tick(g, 3000);
    answer(g, "b", correctPos(round(g)));
    expect(g.phase).toBe("result");
    expect(score(g, "a")).toBe(1000);
    expect(score(g, "b")).toBe(speedPoints(3000, QUICK.all) + streakBonus(1));
  });

  it("order rounds: the last film fills itself in; partial orders earn per film", () => {
    const g = game(["a", "b"]);
    while (round(g).kind !== "order") until(g, "result"), tick(g, QUICK.result);
    until(g, "all");
    const seq = correctSeq(round(g));
    for (const pos of seq.slice(0, 3)) answer(g, "a", pos);
    expect(player(g, "a")!.answer).toMatchObject({ done: true, seq });
    answer(g, "b", seq[1]!);
    answer(g, "b", seq[0]!);
    answer(g, "b", seq[2]!);
    expect(g.phase).toBe("result");
    expect(g.outcome!.winners).toEqual(["a"]);
    expect(g.outcome!.gains.b).toBe(200); // two of four in the right place
  });

  it("streaks add a bonus and trailing players get a comeback boost", () => {
    expect(streakBonus(1)).toBe(0);
    expect(streakBonus(3)).toBe(200);
    expect(streakBonus(20)).toBe(500);
    expect(withComeback(1000, true)).toBe(1300);
  });

  it("the final: wagers lock in, right doubles the bet, wrong loses it; then the podium and the end", () => {
    const g = game(["a", "b", "c"]);
    while (round(g).kind !== "final") until(g, "result"), tick(g, QUICK.result);
    until(g, "wager");
    player(g, "a")!.score = 1000;
    player(g, "b")!.score = 1000;
    setWager(g, "a", 1);
    setWager(g, "b", 0.3);
    lockWager(g, "a");
    lockWager(g, "b");
    expect(g.phase).toBe("wager");
    lockWager(g, "c"); // c keeps the default half of the house money
    expect(g.phase).toBe("all");
    answer(g, "a", correctPos(round(g)));
    answer(g, "b", wrong(g));
    answer(g, "c", wrong(g));
    expect(g.phase).toBe("result");
    expect(score(g, "a")).toBe(2000);
    expect(score(g, "b")).toBe(700);
    expect(score(g, "c")).toBe(0);
    expect(standings(g).map((p) => p.id)).toEqual(["a", "b", "c"]);
    const ev = until(g, "over");
    expect(ev.some((e) => e.kind === "over")).toBe(true);
    expect(awards(g).find((x) => x.id === "gambler")).toMatchObject({ playerId: "a", value: 1000 });
  });

  it("an absent player does not hold up all-answer rounds", () => {
    const g = game(["a", "b"]);
    until(g, "reveal");
    until(g, "all");
    setAway(g, ["b"]);
    answer(g, "a", correctPos(round(g)));
    expect(g.phase).toBe("result");
  });

  it("the remote can skip the intro", () => {
    const g = game();
    skip(g);
    expect(g.phase).toBe("round-intro");
  });

  it("a full normal game lasts about 6 minutes when people play, and ends even if nobody answers", () => {
    const g = newGame(["a"], makePlan(NORMAL_PLAN, "ta", rng(3)), NORMAL);
    let ms = 0;
    for (; g.phase !== "over" && ms < 900_000; ms += 100) tick(g, 100);
    expect(g.ri).toBe(NORMAL_PLAN.length - 1);
    expect(ms / 60_000).toBeLessThan(12);
    // a typical table: someone buzzes after about 3 s, answers take 3-5 s
    const p = newGame(["a", "b", "c"], makePlan(NORMAL_PLAN, "en", rng(4)), NORMAL);
    ms = 0;
    for (; p.phase !== "over" && ms < 900_000; ms += 100) {
      tick(p, 100);
      if (p.phase === "reveal" && p.t >= 3000) buzz(p, "a");
      if (p.phase === "answer" && p.t >= 2500) answer(p, "a", ms % 3 ? correctPos(round(p)) : wrong(p));
      if ((p.phase === "steal" && p.t >= 2000) || (p.phase === "all" && p.t >= 4000)) {
        for (const id of ["a", "b", "c"]) round(p).kind === "order" ? correctSeq(round(p)).forEach((s) => answer(p, id, s)) : answer(p, id, correctPos(round(p)));
      }
      if (p.phase === "wager" && p.t >= 4000) ["a", "b", "c"].forEach((id) => lockWager(p, id));
    }
    expect(ms / 60_000).toBeGreaterThan(5);
    expect(ms / 60_000).toBeLessThan(8);
  });

  it("a quick game is about a minute", () => {
    const g = game(["a"]);
    let ms = 0;
    for (; g.phase !== "over" && ms < 300_000; ms += 100) tick(g, 100);
    expect(ms / 1000).toBeLessThan(80);
  });
});

describe("Emoji Dhamaka plans", () => {
  it("picks distinct questions of the right kind for every language", () => {
    for (const lang of ["en", "ta", "hi"] as const) {
      const p = makePlan(NORMAL_PLAN, lang, rng(11));
      expect(new Set(p.map((r) => r.q.id)).size).toBe(p.length);
      p.forEach((r, i) => {
        const k = NORMAL_PLAN[i];
        expect(r.kind).toBe(k);
        if (k === "emoji") expect(r.q.type).toBe("emoji");
        if (k === "order") expect(r.q.type).toBe("order");
        if (k === "mcq" || k === "final") expect(["mcq", "number"]).toContain(r.q.type);
        expect([...r.order].sort().join()).toBe("0,1,2,3");
      });
      expect(p.filter((r) => r.q.i18n[lang] && r.q.i18n[lang]!.status !== "mt-draft").length).toBe(p.length);
    }
  });

  it("a Tamil room leans to Tamil cinema", () => {
    const p = makePlan(NORMAL_PLAN, "ta", rng(5)).filter((r) => r.kind === "emoji");
    expect(p.filter((r) => r.q.regions.includes("tn")).length).toBeGreaterThanOrEqual(6);
  });

  it("is reproducible with a seed", () => {
    expect(makePlan(QUICK_PLAN, "en", rng(9)).map((r) => r.q.id)).toEqual(makePlan(QUICK_PLAN, "en", rng(9)).map((r) => r.q.id));
  });
});
