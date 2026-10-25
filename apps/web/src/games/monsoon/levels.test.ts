import { describe, expect, it } from "vitest";
import { fightBoss, runBot, validateAll } from "../kitplat/testkit";
import { DEF } from "./index";

describe("Monsoon Courier levels", () => {
  it("every level validates: goal, checkpoints and the boss are reachable, budgets hold", () => {
    for (const r of validateAll(DEF.spec)) expect(r.problems, `${r.id}`).toEqual([]);
  });
  it("has three levels plus a quick one, with a boss finale", () => {
    expect(DEF.spec.levels).toHaveLength(3);
    expect(DEF.spec.levels[2]!.boss).toBe("bandit");
    expect(DEF.spec.quick).toHaveLength(1);
  });
  it("the e2e phone bot (hold ▶ + RUN, tap JUMP) finishes the quick delivery in time", () => {
    for (const phase of [0, 0.11, 0.23, 0.31]) {
      const w = runBot(DEF.spec, 0, true, 2, "race", 0.45, 0.3, 120, phase);
      expect(w.heroes.some((h) => h.finished), `phase ${phase}`).toBe(true);
      expect(w.done).toBe(true);
    }
  });
  it("the Mango Bandit can be beaten (stomped while it is open) and the level then clears", () => {
    const w = fightBoss(DEF.spec, 2);
    expect(w.boss!.dead).toBe(true);
    expect(w.done).toBe(true);
    expect(w.heroes.reduce((n, h) => n + h.stats.bossHits, 0)).toBe(DEF.spec.bosses[0]!.hp);
  });
});
