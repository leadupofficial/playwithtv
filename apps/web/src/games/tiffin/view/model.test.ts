import { describe, expect, it } from "vitest";
import { newMatch } from "../engine";
import { item } from "../recipes";
import { LEVELS } from "../levels";
import { chefModel, carriedDraws, facingOf, kitchenModel, type FoodDraw } from "./model";

describe("view model", () => {
  it("faces stations towards their floor, like the Blender backdrops", () => {
    const L = LEVELS[0]!.layout;
    expect(facingOf(L, 2, 0)).toBe(0);              // back row faces the camera
    expect(facingOf(L, 0, 3)).toBeCloseTo(Math.PI / 2); // left column faces right
    expect(facingOf(L, 11, 1)).toBeCloseTo(-Math.PI / 2);
    expect(facingOf(L, 4, 6)).toBe(Math.PI);         // front row faces away
  });

  it("draws plates with their parts, a cooking dosa with a flip ring, and carried food", () => {
    const m = newMatch(["a"], { quick: true });
    const k = m.kitchen;
    const counter = k.tiles.find((t) => t.code === "#" && t.r === 2)!;
    counter.item = item("plate", [], { parts: ["dosa", "chutney"] });
    const tava = k.tiles.find((t) => t.code === "t")!;
    tava.item = item("batter");
    tava.cook = 2.6;
    const md = kitchenModel(m, LEVELS[0]!.layout);
    const onCounter = md.foods.filter((f) => Math.abs(f.z - (counter.r - (k.h - 1) / 2)) < 0.2 && Math.abs(f.x - (counter.c - (k.w - 1) / 2)) < 0.2);
    expect(onCounter.map((f) => f.name).sort()).toEqual(["chutney", "dosa", "plate"]);
    expect(md.foods.some((f) => f.name === "tava_dosa" && f.alpha > 0.9)).toBe(true);
    expect(md.rings.find((r) => r.key.startsWith("t"))!.icon).toBe("🍳");
    expect(md.fx.some((f) => f.kind === "sizzle")).toBe(true);
    m.chefs[0]!.holding = item("coffee");
    const out: FoodDraw[] = [];
    carriedDraws(m, out);
    expect(out[0]!.name).toBe("coffee");
    expect(chefModel(m)[0]!.clip).toBe("carry");
  });
});
