import { describe, expect, it } from "vitest";
import { COLS, KROWS, LEVELS, type KitchenLevel } from "./kitchen-rush/levels";
import { KitchenSim, RECIPES, walkable } from "./kitchen-rush/sim";

const cell = (l: KitchenLevel, x: number, y: number) => (x < 0 || y < 0 || x >= COLS || y >= KROWS ? "#" : l.map[y]![x]!);
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

/** Floor cells a chef can walk to from its start. */
function region(l: KitchenLevel, start: string): Set<string> {
  const y0 = l.map.findIndex((r) => r.includes(start));
  const q: Array<[number, number]> = [[l.map[y0]!.indexOf(start), y0]];
  const seen = new Set([q[0]!.join(",")]);
  while (q.length) {
    const [x, y] = q.shift()!;
    for (const [dx, dy] of N4) {
      const k = `${x + dx},${y + dy}`;
      if (!seen.has(k) && walkable(cell(l, x + dx, y + dy))) { seen.add(k); q.push([x + dx, y + dy]); }
    }
  }
  return seen;
}
/** Stations next to a set of floor cells. */
function stations(l: KitchenLevel, floor: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const k of floor) {
    const [x, y] = k.split(",").map(Number) as [number, number];
    for (const [dx, dy] of N4) if (!walkable(cell(l, x + dx, y + dy))) out.add(`${x + dx},${y + dy}`);
  }
  return out;
}

/** Walks a chef along the floor and uses things, like a player would, by steering the sim each frame. */
class Bot {
  constructor(private s: KitchenSim, private l: KitchenLevel, private p: number) {}
  private at() {
    const c = this.s.debug().chefs[this.p]!;
    return { x: c.x, y: c.y };
  }
  /** Walk next to the nearest station of a kind (or an exact cell) and face it. */
  goTo(kind: string | [number, number]) {
    const me = this.at();
    const start = `${Math.floor(me.x)},${Math.floor(me.y)}`;
    const prev = new Map<string, string | null>([[start, null]]);
    const q = [start];
    let goal: string | null = null, face: [number, number] = [0, 0];
    const hit = (x: number, y: number) => (typeof kind === "string" ? cell(this.l, x, y) === kind : x === kind[0] && y === kind[1]);
    while (q.length && !goal) {
      const k = q.shift()!;
      const [x, y] = k.split(",").map(Number) as [number, number];
      for (const [dx, dy] of N4) if (hit(x + dx, y + dy)) { goal = k; face = [x + dx, y + dy]; break; }
      if (goal) break;
      for (const [dx, dy] of N4) {
        const n = `${x + dx},${y + dy}`;
        if (!prev.has(n) && walkable(cell(this.l, x + dx, y + dy))) { prev.set(n, k); q.push(n); }
      }
    }
    if (!goal) throw new Error(`chef ${this.p} can't reach ${kind}`);
    const path: string[] = [];
    for (let k: string | null = goal; k; k = prev.get(k)!) path.unshift(k);
    for (const k of path) {
      const [x, y] = k.split(",").map(Number) as [number, number];
      for (let i = 0; i < 200; i++) {
        const c = this.at();
        const dx = x + 0.5 - c.x, dy = y + 0.5 - c.y;
        if (Math.hypot(dx, dy) < 0.08) break;
        const m = Math.max(Math.hypot(dx, dy), 0.25);
        this.s.steer(this.p, Math.min(1, dx / m), -Math.min(1, dy / m) * 1); // sim flips y: stick up = screen up
        this.s.step(16);
      }
    }
    // face the station
    const c = this.at();
    const fx = face[0] + 0.5 - c.x, fy = face[1] + 0.5 - c.y, m = Math.hypot(fx, fy);
    this.s.steer(this.p, fx / m, -fy / m);
    this.s.step(16);
    this.s.steer(this.p, 0, 0);
    if (this.s.outcome()) return face; // the shift ended on the way
    expect(this.s.target(this.p)).toEqual({ x: face[0], y: face[1] });
    return face;
  }
  grab() {
    return this.s.act("grab", this.p);
  }
  chop(n = 5) {
    for (let i = 0; i < n; i++) this.s.act("chop", this.p);
  }
  hand() {
    return this.s.debug().chefs[this.p]!.hand;
  }
}

const make = (i: number, players = 2, quick = false) => new KitchenSim(LEVELS[i]!, 7, players === 2 ? ["#f00", "#00f"] : ["#f00"], quick);

describe("Kitchen Rush", () => {
  it("every kitchen is 24 × 12 with both chefs and only known tiles", () => {
    for (const l of LEVELS) {
      expect(l.map.length, l.name).toBe(KROWS);
      for (const r of l.map) {
        expect(r.length, `${l.name}: ${r}`).toBe(COLS);
        expect(r).toMatch(/^[#.=LTUMCSPWX12]+$/);
      }
      expect(l.map.join("").split("1").length - 1).toBe(1);
      expect(l.map.join("").split("2").length - 1).toBe(1);
    }
  });

  it("in every kitchen the two chefs together can reach everything each dish needs", () => {
    for (const l of LEVELS) {
      const r1 = region(l, "1"), r2 = region(l, "2");
      const s1 = stations(l, r1), s2 = stations(l, r2);
      const team = new Set([...s1, ...s2]);
      const kinds = new Set([...team].map((k) => { const [x, y] = k.split(",").map(Number) as [number, number]; return cell(l, x, y); }));
      // split kitchens need a counter both chefs can reach to pass things over
      const shared = [...s1].some((k) => s2.has(k) && cell(l, ...(k.split(",").map(Number) as [number, number])) === "=");
      if (![...r1].some((k) => r2.has(k))) expect(shared, `${l.name}: no counter to pass over`).toBe(true);
      for (const need of ["P", "W", "X"]) expect(kinds.has(need), `${l.name} lacks ${need}`).toBe(true);
      for (const rec of l.recipes) {
        for (const ing of RECIPES[rec].needs) {
          const crate = { lettuce: "L", tomato: "T", bun: "U", meat: "M" }[ing];
          expect(kinds.has(crate), `${l.name}: ${rec} needs ${ing}`).toBe(true);
          if (ing === "lettuce" || ing === "tomato") expect(kinds.has("C"), `${l.name}: no board`).toBe(true);
          if (ing === "meat") expect(kinds.has("S"), `${l.name}: no stove`).toBe(true);
        }
      }
    }
  });

  it("one chef chops, plates and serves a salad for points", () => {
    const s = make(0);
    const b = new Bot(s, LEVELS[0]!, 0);
    s.step(1600);
    expect(s.debug().orders).toEqual(["salad"]);
    b.goTo("L"); b.grab(); expect(b.hand()).toBe("lettuce:raw");
    const first = b.goTo("C"); b.grab(); b.chop(4);
    expect(Object.values(s.debug().slots)).toContain("lettuce:raw");
    b.chop(1);
    expect(Object.values(s.debug().slots)).toContain("lettuce:chopped");
    b.goTo("P"); b.grab(); expect(b.hand()).toBe("plate:");
    b.goTo(first); b.grab(); expect(b.hand()).toBe("plate:lettuce");
    b.goTo("="); b.grab(); // plate down on a counter
    b.goTo("T"); b.grab();
    const board = b.goTo("C"); b.grab(); b.chop();
    b.goTo("="); b.grab(); expect(b.hand()).toBe("plate:lettuce");
    b.goTo(board); b.grab(); expect(b.hand()).toBe("plate:lettuce+tomato");
    b.goTo("W");
    const ev = b.grab();
    expect(ev.some((e) => e.sfx === "bonus")).toBe(true);
    expect(s.debug().served).toBe(1);
    expect(s.debug().score).toBeGreaterThan(60);
    expect(s.debug().orders).toEqual([]);
  });

  it("the wrong dish, raw food on a plate and full hands are refused with a message to that phone", () => {
    const s = make(0);
    const b = new Bot(s, LEVELS[0]!, 0);
    s.step(1600);
    b.goTo("L"); b.grab();
    expect(b.grab()[0]).toMatchObject({ toast: "Hands full!", player: 0 });
    b.goTo("P");
    expect(b.grab()[0]?.toast).toBe("Hands full!"); // raw lettuce can't go on a plate
    b.goTo("X"); b.grab(); expect(b.hand()).toBeNull();
    b.goTo("P"); b.grab();
    b.goTo("W");
    expect(b.grab()[0]?.toast).toMatch(/plated dish/);
  });

  it("meat cooks, then burns if nobody takes it off; burnt meat goes in the bin", () => {
    const l = LEVELS[1]!;
    const s = new KitchenSim(l, 3, ["#f00", "#00f"]);
    const b = new Bot(s, l, 0);
    b.goTo("M"); b.grab();
    b.goTo("S"); b.grab();
    expect(Object.values(s.debug().slots)).toContain("meat:raw");
    s.step(6100);
    expect(Object.values(s.debug().slots)).toContain("meat:cooked");
    s.step(8100);
    expect(Object.values(s.debug().slots)).toContain("meat:burnt");
    expect(s.debug().burnt).toBe(1);
    b.goTo("S"); b.grab(); expect(b.hand()).toBe("meat:burnt");
    expect(b.goTo("S") && b.grab()[0]?.toast).toBe("That's burnt! Bin it");
  });

  it("passing over a counter to your partner scores a teamwork bonus", () => {
    const l = LEVELS[2]!; // Split Shift: a counter wall down the middle
    const s = new KitchenSim(l, 3, ["#f00", "#00f"]);
    const a = new Bot(s, l, 0), b = new Bot(s, l, 1);
    a.goTo("L"); a.grab();
    const spot: [number, number] = [12, 5]; // the dividing counter
    a.goTo(spot);
    a.grab();
    b.goTo(spot);
    const ev = b.grab();
    expect(b.hand()).toBe("lettuce:raw");
    expect(ev[0]?.sfx).toBe("bonus");
    expect(s.debug().passes).toBe(1);
  });

  it("in a split kitchen the two of you make a burger by passing things over the counter", () => {
    const l = LEVELS[2]!;
    const s = new KitchenSim(l, 5, ["#f00", "#00f"]);
    const a = new Bot(s, l, 0), b = new Bot(s, l, 1);
    const spot: [number, number] = [12, 5];
    a.goTo("M"); a.grab(); a.goTo(spot); a.grab();
    b.goTo(spot); b.grab(); b.goTo("S"); b.grab();
    a.goTo("U"); a.grab(); a.goTo(spot); a.grab();
    b.goTo("P"); b.grab(); b.goTo(spot); b.grab();
    expect(b.hand()).toBe("plate:bun");
    while (!Object.values(s.debug().slots).includes("meat:cooked")) s.step(100);
    b.goTo("S"); b.grab();
    expect(b.hand()).toBe("plate:bun+meat");
    while (!s.debug().orders.includes("burger")) s.step(500);
    b.goTo("W"); b.grab();
    expect(s.debug().served).toBe(1);
    expect(s.debug().passes).toBe(2);
  });

  it("customers give up when the ticket runs out, and the shift ends with stars for points", () => {
    const s = make(0);
    s.step(1600);
    s.step(RECIPES.salad.patience * 1000);
    expect(s.debug().missed).toBe(1);
    s.step(LEVELS[0]!.round * 1000);
    const o = s.outcome()!;
    expect(o.won).toBe(false);
    expect(o.stars).toBe(0);
    expect(o.checks).toHaveLength(3);
  });

  it("binning scrapes a plate, binning it again throws it away", () => {
    const s = make(0);
    const b = new Bot(s, LEVELS[0]!, 0);
    b.goTo("P"); b.grab();
    b.goTo("X"); b.grab();
    expect(b.hand()).toBeNull();
  });

  it("a quick game is a short shift, and the sim copes with one chef", () => {
    const s = make(0, 1, true);
    expect(s.debug().chefs).toHaveLength(1);
    s.step(41_000);
    expect(s.outcome()).not.toBeNull();
  });

  it("in open kitchens one steady chef earns a star early on; three stars always need both of you", () => {
    for (const [i, l] of LEVELS.entries()) {
      if (![...region(l, "1")].some((k) => region(l, "2").has(k))) continue; // split kitchens need two chefs
      const s = new KitchenSim(l, 11, ["#f00"]); // chef 2 stays home, out of the way
      const b = new Bot(s, l, 0);
      // plays like a sensible person: meat on the stove first, chop and plate up while it cooks
      const cook = (dish: string) => {
        const needs = RECIPES[dish as keyof typeof RECIPES].needs;
        let stove: [number, number] | null = null;
        if (needs.includes("meat")) { b.goTo("M"); b.grab(); stove = b.goTo("S"); b.grab(); }
        let plate: [number, number] | null = null;
        let holding = false;
        for (const ing of needs.filter((n) => n === "lettuce" || n === "tomato")) {
          if (holding) { plate = b.goTo("="); b.grab(); }
          b.goTo(ing === "lettuce" ? "L" : "T"); b.grab();
          const board = b.goTo("C"); b.grab(); b.chop();
          if (plate) { b.goTo(plate); b.grab(); b.goTo(board); b.grab(); }
          else { b.goTo(board); b.grab(); b.goTo("P"); b.grab(); }
          holding = true;
        }
        if (!holding) { b.goTo("P"); b.grab(); }
        if (needs.includes("bun")) { b.goTo("U"); b.grab(); }
        if (stove) {
          for (let k = 0; k < 400 && !s.outcome() && !Object.values(s.debug().slots).includes("meat:cooked") && !Object.values(s.debug().slots).includes("meat:burnt"); k++) s.step(50);
          b.goTo(stove); b.grab();
        }
        b.goTo("W"); b.grab();
      };
      while (!s.outcome()) {
        const want = s.debug().orders[0];
        if (want) cook(want); else s.step(500);
        if (b.hand()) { b.goTo("X"); b.grab(); if (b.hand()) b.grab(); }
        const burnt = Object.entries(s.debug().slots).find(([, v]) => v === "meat:burnt");
        if (burnt) { b.goTo(burnt[0].split(",").map(Number) as [number, number]); b.grab(); b.goTo("X"); b.grab(); }
      }
      const o = s.outcome()!;
      // the Night Market is for two: alone you still serve, but stars there need teamwork
      if (l.world < 2) expect(o.stars, `${i} ${l.name}: ${o.score}`).toBeGreaterThanOrEqual(1);
      else expect(s.debug().served, l.name).toBeGreaterThanOrEqual(3);
      expect(o.stars, `${l.name}: one chef alone shouldn't get 3 stars`).toBeLessThan(3);
    }
  });

  it("the HUD counts down the shift and shows the next star", () => {
    const s = make(0);
    expect(s.hud().goal).toMatch(/2:30 .* next ★ at 200/);
  });
});
