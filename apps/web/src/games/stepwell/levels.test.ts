import { describe, expect, it } from "vitest";
import { fightBoss, runBot, validateAll } from "../kitplat/testkit";
import { DEF } from "./index";
import { DT } from "../kitplat/feel";
import { NO_INPUT } from "../kitplat/player";
import { createWorld, stepWorld } from "../kitplat/world";

describe("Stepwell Secrets levels", () => {
  it("every level validates: goal, checkpoints and the boss are reachable, budgets hold", () => {
    for (const r of validateAll(DEF.spec)) expect(r.problems, `${r.id}`).toEqual([]);
  });
  it("has three levels plus a quick one, with a boss finale", () => {
    expect(DEF.spec.levels).toHaveLength(3);
    expect(DEF.spec.levels[2]!.boss).toBe("makara");
    expect(DEF.spec.quick).toHaveLength(1);
  });
  it("the e2e phone bot (hold ▶ + RUN, tap JUMP and ACTION) finishes the quick descent in time", () => {
    for (const phase of [0, 0.11, 0.23, 0.31]) {
      const w = runBot(DEF.spec, 0, true, 2, "coop", 0.45, 0.3, 120, phase);
      expect(w.heroes.some((h) => h.finished), `phase ${phase}`).toBe(true);
      expect(w.done).toBe(true);
    }
  });
  it("the Stone Makara can be beaten (stomped while it is open) and the level then clears", () => {
    const w = fightBoss(DEF.spec, 2);
    expect(w.boss!.dead).toBe(true);
    expect(w.done).toBe(true);
    expect(w.heroes.reduce((n, h) => n + h.stats.bossHits, 0)).toBe(DEF.spec.bosses[0]!.hp);
  });
  it("pulling a lever while the Stone Makara stands under its bell hurts it", () => {
    const w = createWorld(DEF.spec, DEF.spec.levels[2]!, ["p0"], "coop", 3);
    const h = w.heroes[0]!, b = w.boss!;
    const lever = w.items.find((i) => i.kind === "leverB")!;
    h.body.x = b.arena[0] + 3;
    h.body.y = b.floorY;
    for (let i = 0; i < 200; i++) stepWorld(w, [NO_INPUT], DT); // through the intro
    expect(b.awake).toBe(true);
    h.body.x = lever.x;
    h.body.y = lever.y;
    b.body.x = lever.x;
    const hp = b.hp;
    stepWorld(w, [{ ...NO_INPUT, action: true }], DT);
    expect(b.hp).toBe(hp - 1);
    expect(h.stats.bossHits).toBe(1);
  });
});
