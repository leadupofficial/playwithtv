import { describe, expect, it } from "vitest";
import { runBot, validateAll } from "../kitplat/testkit";
import { DEF } from "./index";

describe("Lantern Lane levels", () => {
  it("every level validates: goal, checkpoints and the boss are reachable, budgets hold", () => {
    for (const r of validateAll(DEF.spec)) expect(r.problems, `${r.id}`).toEqual([]);
  });
  it("has three levels plus a quick one, with a boss finale", () => {
    expect(DEF.spec.levels).toHaveLength(3);
    expect(DEF.spec.levels[2]!.boss).toBe("puppet");
    expect(DEF.spec.quick).toHaveLength(1);
  });
  it("the e2e phone bot (hold ▶ + RUN, tap JUMP) finishes the festival dash in time", () => {
    for (const phase of [0, 0.11, 0.23, 0.31]) {
      const w = runBot(DEF.spec, 0, true, 2, "coop", 0.45, 0.3, 120, phase);
      expect(w.heroes.some((h) => h.finished), `phase ${phase}`).toBe(true);
      expect(w.done).toBe(true);
    }
  });
});
