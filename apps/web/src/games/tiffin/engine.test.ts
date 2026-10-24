import { describe, expect, it } from "vitest";
import { DT, IDLE, type Ev, type Match, type TiffinInput, newMatch, step, verbFor } from "./engine";
import { find, steer } from "./bot";
import { flippable, ready, type Tile } from "./kitchen";
import { awardsFor } from "./awards";
import type { Chef } from "./chefs";

/** A plan names the tile to go to and whether to press the action button there. */
type Plan = (m: Match, c: Chef) => { tile: Tile | null; act: boolean };

/** Makes filter coffee forever: cup → filter → (wait) → window. */
const coffeeRunner: Plan = (m, c) => {
  const k = m.kitchen;
  const h = c.holding?.kind;
  if (h === "coffee") return { tile: find(k, "w"), act: true };
  if (h === "cup") return { tile: find(k, "f", (t) => !t.item), act: true };
  const done = find(k, "f", (t) => ready(t));
  if (done) return { tile: done, act: true };
  if (find(k, "f", (t) => !t.item) && m.book.orders.some((o) => o.recipe === "coffee")) return { tile: find(k, "c"), act: true };
  return { tile: null, act: false };
};

/** Plain dosa: a plate on a counter, chutney from the grinder onto it, a flipped dosa scooped onto it, served. */
function dosaChef(): Plan {
  let spot: Tile | null = null;
  return (m, c) => {
    const k = m.kitchen;
    const h = c.holding?.kind;
    spot ??= find(k, "#", (t) => t.r === 2 && !t.item);
    const plate = spot!.item;
    const tava = find(k, "t", (t) => !!t.item) ?? find(k, "t");
    if (tava && flippable(tava) && !h) return { tile: tava, act: true };
    if (h === "plate" && c.holding!.parts!.length === 2) return { tile: find(k, "w"), act: true };
    if (h === "plate" && c.holding!.parts!.includes("chutney")) return { tile: tava, act: ready(tava!) };
    if (h === "plate") return { tile: spot, act: true };
    if (h === "coconut") return { tile: find(k, "g"), act: true };
    if (h === "chutney") return { tile: spot, act: true };
    if (h === "batter") return { tile: tava, act: true };
    if (!plate) return { tile: find(k, "r"), act: true };
    const grinder = find(k, "g")!;
    if (grinder.item && !ready(grinder)) return { tile: grinder, act: true };
    if (ready(grinder) && !plate.parts!.includes("chutney")) return { tile: grinder, act: true };
    if (!grinder.item && !plate.parts!.includes("chutney")) return { tile: find(k, "o"), act: true };
    if (!tava!.item) return { tile: find(k, "b"), act: true };
    if (ready(tava!)) return { tile: spot, act: true }; // pick the plate up, then scoop
    return { tile: tava, act: false };
  };
}

function play(m: Match, plans: Map<string, Plan>, seconds: number, onEv?: (e: Ev) => void) {
  const pressed = new Map<string, boolean>();
  for (let i = 0; i < seconds / DT; i++) {
    const inputs = new Map<string, TiffinInput>();
    for (const c of m.chefs) {
      const plan = plans.get(c.id);
      if (!plan || m.phase !== "service") continue;
      const want = plan(m, c);
      if (!want.tile) { inputs.set(c.id, IDLE); continue; }
      const s = steer(m.kitchen, c, want.tile);
      const act = s.there && want.act && !pressed.get(c.id);
      pressed.set(c.id, act);
      inputs.set(c.id, { ...s.input, act });
    }
    for (const e of step(m, DT, inputs)) onEv?.(e);
    if (m.phase === "results") break;
  }
}

describe("a whole trip on the Tiffin Tornado Express", () => {
  it("two helper chefs serve coffee and dosas in the quick first service and earn stars", () => {
    const m = newMatch(["asha", "ravi"], { seed: 3, quick: true });
    const served: string[] = [];
    const phases: string[] = [];
    play(m, new Map([["asha", coffeeRunner], ["ravi", dosaChef()]]), 2 + 1 + 20 + 0.5, (e) => {
      if (e.kind === "serve") served.push(e.recipe);
      if (e.kind === "phase") phases.push(e.phase);
    });
    expect(phases.slice(0, 3)).toEqual(["countdown", "service", "levelEnd"]);
    expect(served).toContain("coffee");
    expect(served).toContain("dosa");
    const r = m.results[0]!;
    expect(r.points).toBeGreaterThan(0);
    expect(r.stars).toBeGreaterThanOrEqual(1);
    const ravi = m.chefs.find((c) => c.id === "ravi")!;
    expect(ravi.stats.chutneys).toBeGreaterThanOrEqual(1);
    expect(ravi.stats.flips).toBeGreaterThanOrEqual(1);
  });

  it("plays all three services to the results; the platform stop shuts the gangway for two chefs", () => {
    const m = newMatch(["asha", "ravi"], { seed: 5, quick: true });
    const doors: boolean[] = [];
    const levels = new Set<number>();
    play(m, new Map([["asha", coffeeRunner]]), 200, (e) => {
      if (e.kind === "doors") doors.push(e.shut);
      if (e.kind === "phase") levels.add(e.level);
    });
    expect(m.phase).toBe("results");
    expect([...levels]).toEqual([0, 1, 2]);
    expect(m.results.map((r) => r.level)).toEqual([1, 2, 3]);
    expect(doors).toEqual([true, false]);
    expect(m.teamPoints).toBe(m.results.reduce((s, r) => s + r.points, 0) + 0 * 1);
    const awards = awardsFor(m.chefs);
    expect(awards.find((a) => a.title === "Coffee Wallah")?.playerId).toBe("asha");
  });

  it("a solo chef keeps the gangway open and the action button names the verb", () => {
    const m = newMatch(["solo"], { seed: 9, quick: true, startLevel: 2 });
    let shut = false;
    play(m, new Map([["solo", coffeeRunner]]), 2 + 1 + 20, (e) => { if (e.kind === "doors") shut = true; });
    expect(shut).toBe(false);
    const m2 = newMatch(["a"], { seed: 1, quick: true });
    for (let i = 0; i < 3.2 / DT; i++) step(m2, DT, new Map());
    expect(m2.phase).toBe("service");
    const c = m2.chefs[0]!;
    const cups = find(m2.kitchen, "c")!;
    for (let i = 0; i < 400; i++) {
      const s = steer(m2.kitchen, c, cups);
      if (s.there) break;
      step(m2, DT, new Map([["a", s.input]]));
    }
    expect(verbFor(m2, "a")).toBe("pick");
  });

  it("an unattended kitchen loses points to expired tickets but never goes below zero", () => {
    const m = newMatch(["a", "b"], { seed: 2, quick: true });
    const expired: number[] = [];
    play(m, new Map(), 2 + 1 + 20 + 0.1, (e) => { if (e.kind === "expire") expired.push(e.order.id); });
    expect(expired.length).toBeGreaterThan(0);
    expect(m.results[0]!.points).toBe(0);
    expect(m.results[0]!.stars).toBe(0);
  });
});
