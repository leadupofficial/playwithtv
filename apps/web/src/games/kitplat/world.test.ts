import { describe, expect, it } from "vitest";
import type { BossDef } from "./boss";
import { DT, FEEL_CLASSIC } from "./feel";
import type { LevelDef } from "./level";
import { NO_INPUT, type PadInput } from "./player";
import type { GameSpec, Mode, World } from "./types";
import { validateLevel } from "./validate";
import { INTRO_S, createWorld, stepWorld } from "./world";

const BOSS: BossDef = {
  id: "ox", name: "Test Ox", sprite: "ox", hp: 2, hw: 0.9, h: 1.6, damage: ["stomp"],
  pattern: [{ kind: "rest", seconds: 1.5, vulnerable: true }, { kind: "walk", seconds: 1, speed: 1 }],
};
const SPEC: GameSpec = {
  id: "test", title: "Test", feel: FEEL_CLASSIC, levels: [], quick: [], modes: ["coop", "race"], hearts: 2, loopSpeed: 8,
  leverSeconds: 3, bosses: [BOSS],
  powers: [{ id: "wings", name: "Wings", icon: "wings", toast: "Wings!", seconds: 10, airJumps: 1 },
    { id: "spark", name: "Spark", icon: "spark", toast: "Spark!", seconds: 10, projectile: { speed: 12, cooldown: 0.3, sprite: "spark", life: 1.2 } }],
};
const L = (rows: string[], extra: Partial<LevelDef> = {}): LevelDef => ({ id: "t", name: "t", time: 120, rows, ...extra });
const inp = (o: Partial<PadInput> = {}): PadInput => ({ ...NO_INPUT, ...o });

function play(rows: string[], ids = ["a"], mode: Mode = "coop", extra: Partial<LevelDef> = {}) {
  const w = createWorld(SPEC, L(rows, extra), ids, mode, 7);
  for (let t = 0; t <= INTRO_S + DT; t += DT) stepWorld(w, [], DT);
  return w;
}
function steps(w: World, n: number, input: (i: number) => PadInput[] = () => []) {
  const kinds: string[] = [];
  for (let i = 0; i < n; i++) {
    stepWorld(w, input(i), DT);
    for (const e of w.events) kinds.push(e.kind);
  }
  return kinds;
}

const ROW = (s = "") => (s + " ".repeat(40)).slice(0, 40);
const FLOOR = "#".repeat(40);

describe("world: foes", () => {
  it("stomping a walker defeats it and bounces the hero; JUMP held bounces higher", () => {
    const w = play([ROW(), ROW(), ROW(), ROW(), ROW(), ROW("   P"), FLOOR]);
    const h = w.heroes[0]!;
    w.foes.push({ ...w.foes[0]!, id: 0, kind: "walker", body: { ...h.body, x: 5, y: 1, hw: 0.38, h: 0.8, vx: 0, vy: 0, grounded: true, platform: -1, ground: 1, slope: 0 },
      dir: -1, state: "move", t: 0, home: { x: 5, y: 1 }, deadT: 0, kicker: -1, grace: 0 } as never);
    h.body.x = 5;
    h.body.y = 4;
    const ev = steps(w, 40, () => [inp({ jump: true })]);
    expect(ev).toContain("stomp");
    expect(w.foes[0]!.state).toBe("dead");
    expect(h.stats.stomps).toBe(1);
    expect(h.score).toBeGreaterThanOrEqual(100);
    expect(h.hearts).toBe(2);
  });
  it("walking into a foe hurts (a heart, knock-back, invulnerability) and two hits take you down", () => {
    const w = play([ROW(), ROW(), ROW(), ROW(), ROW(), ROW("   P    e"), FLOOR], ["a", "b"]);
    const h = w.heroes[0]!;
    const ev = steps(w, 90, () => [inp({ x: 1 }), NO_INPUT]);
    expect(ev).toContain("hurt");
    expect(h.stats.hits).toBeGreaterThanOrEqual(1);
    expect(h.hearts).toBeLessThan(2);
  });
  it("a curler curls when stomped; kicking the ball bowls over other foes", () => {
    const w = play([ROW(), ROW(), ROW(), ROW(), ROW(), ROW("   P k          e"), FLOOR]);
    const h = w.heroes[0]!;
    h.body.x = 5.5;
    h.body.y = 3;
    steps(w, 30);
    const curler = w.foes.find((f) => f.kind === "curler")!;
    expect(curler.state).toBe("ball");
    h.inv = 5; // walk into the ball from the left, safely
    h.body.x = curler.body.x - 2;
    h.body.y = 1;
    h.body.vy = 0;
    const ev = steps(w, 160, () => [inp({ x: 1 })]);
    expect(ev).toContain("kick");
    expect(w.foes.find((f) => f.kind === "walker")!.state).toBe("dead");
  });
});

describe("world: items, springs, crates, levers, power-ups", () => {
  it("collects gems, breaks crates from below and launches off springs", () => {
    const w = play([ROW(), ROW(), ROW(), ROW("   X"), ROW(), ROW(), ROW("   P oooo  S"), FLOOR]);
    const h = w.heroes[0]!;
    steps(w, 3);
    steps(w, 30, (i) => [inp({ jump: i < 25, jumpPressed: i === 0 })]);
    expect(h.stats.crates).toBe(1);
    const ev = steps(w, 120, () => [inp({ x: 1 })]);
    expect(h.stats.gems).toBeGreaterThanOrEqual(3 + 3);
    expect(ev).toContain("spring");
  });
  it("a lever opens its gates for leverSeconds, then they close again", () => {
    const w = play([ROW(), ROW(), ROW(), ROW("        D"), ROW("        D"), ROW("   PL   D"), FLOOR]);
    const h = w.heroes[0]!;
    steps(w, 20, () => [inp({ x: 1 })]);
    expect(w.col.gateOpen[0]).toBe(false);
    steps(w, 1, () => [inp({ action: true })]);
    expect(w.col.gateOpen[0]).toBe(true);
    expect(h.stats.levers).toBe(1);
    steps(w, 60 * 2.2, () => [inp({ x: 1, run: true })]);
    expect(h.body.x).toBeGreaterThan(9);
    steps(w, 60 * 2);
    expect(w.col.gateOpen[0]).toBe(false);
  });
  it("power-ups: wings give an extra air jump, sparks are thrown with ACTION and defeat foes", () => {
    const w = play([ROW(), ROW(), ROW(), ROW(), ROW(), ROW("   PU        e"), FLOOR], ["a"], "coop", { powerups: ["spark"] });
    const h = w.heroes[0]!;
    steps(w, 30, () => [inp({ x: 1 })]);
    expect(h.power?.id).toBe("spark");
    const ev = steps(w, 90, (i) => [inp({ action: i % 20 === 0 })]);
    expect(ev).toContain("throw");
    expect(w.foes[0]!.state).toBe("dead");
  });
});

describe("world: co-op and race rules", () => {
  it("co-op: a hero who falls becomes a bubble; a team-mate's touch revives them", () => {
    const w = play([ROW(), ROW(), ROW(), ROW(), ROW(), ROW("   P"), "#".repeat(8) + "   " + "#".repeat(29)], ["a", "b"]);
    const [a, b] = w.heroes;
    a!.body.x = 9.5;
    a!.body.y = 1;
    steps(w, 60);
    expect(a!.down).toBe("bubble");
    const ev = steps(w, 240);
    expect(ev).toContain("revive");
    expect(a!.down).toBe("");
    expect(b!.stats.revives).toBe(1);
  });
  it("co-op: if everyone is down, the team respawns at the last checkpoint (never stalls)", () => {
    const w = play([ROW(), ROW(), ROW(), ROW(), ROW(), ROW("   P  C"), "#".repeat(10) + "    " + "#".repeat(26)], ["a", "b"]);
    steps(w, 50, () => [inp({ x: 1 }), inp({ x: 1 })]);
    expect(w.teamCheckpoint.x).toBe(6.5);
    for (const h of w.heroes) { h.body.x = 12; h.body.y = 1; }
    const ev = steps(w, 300);
    expect(ev).toContain("wipe");
    expect(w.continues).toBe(1);
    expect(w.heroes.every((h) => h.down === "")).toBe(true);
  });
  it("race: a fallen hero respawns at their own checkpoint after a moment", () => {
    const w = play([ROW(), ROW(), ROW(), ROW(), ROW(), ROW("   P"), "#".repeat(8) + "   " + "#".repeat(29)], ["a", "b"], "race");
    const a = w.heroes[0]!;
    a.body.x = 9.5;
    steps(w, 50);
    expect(a.down).toBe("wait");
    steps(w, 90);
    expect(a.down).toBe("");
    expect(a.body.x).toBeLessThan(5);
  });
  it("race: finishing order gives places and bonuses; the level clears once everyone is in", () => {
    const w = play([ROW(), ROW(), ROW(), ROW(), ROW(), ROW("   P         G"), FLOOR], ["a", "b"], "race");
    const ev = steps(w, 400, () => [inp({ x: 1, run: true }), inp({ x: 0.6 })]);
    expect(w.heroes[0]!.place).toBe(1);
    expect(w.heroes[1]!.place).toBe(2);
    expect(ev).toContain("clear");
    expect(w.heroes[0]!.score).toBeGreaterThan(w.heroes[1]!.score);
  });
  it("a straggler far off screen is bubbled (co-op) or leashed back into view (race)", () => {
    const rows = [ROW(), ROW(), ROW(), ROW(), ROW(), ROW("   P"), FLOOR + "#".repeat(60)].map((r) => (r + " ".repeat(100)).slice(0, 100));
    for (const mode of ["coop", "race"] as const) {
      const w = play(rows, ["a", "b"], mode);
      const ev = steps(w, 60 * 6, () => [inp({ x: 1, run: true }), NO_INPUT]);
      if (mode === "coop") expect(ev).toContain("bubble");
      else expect(w.heroes[1]!.body.x).toBeGreaterThan(10);
    }
  });
  it("time up ends the level", () => {
    const w = play([ROW(), ROW(), ROW(), ROW(), ROW(), ROW("   P         G"), FLOOR], ["a"], "coop", { time: 2 });
    const ev = steps(w, 200);
    expect(ev).toContain("timeup");
    steps(w, 220);
    expect(w.done).toBe(true);
  });
});

describe("world: boss", () => {
  it("stomping the boss while it is vulnerable wins the fight and clears the level", () => {
    const rows = [ROW(), ROW(), ROW(), ROW(), ROW(), ROW(), ROW("   P            Z"), FLOOR];
    const w = play(rows, ["a"], "coop", { boss: "ox" });
    const h = w.heroes[0]!;
    expect(w.boss).not.toBeNull();
    let ev: string[] = [];
    for (let k = 0; k < 6 && !w.boss!.dead; k++) {
      h.body.x = w.boss!.body.x;
      h.body.y = w.boss!.body.y + 3.5;
      h.body.vy = -2;
      h.inv = 0;
      ev = ev.concat(steps(w, 70));
    }
    expect(ev).toContain("bosswake");
    expect(ev).toContain("bosshit");
    expect(w.boss!.dead).toBe(true);
    ev = steps(w, 200);
    expect(ev).toContain("clear");
    expect(h.stats.bossHits).toBe(2);
  });
});

describe("level validation", () => {
  it("accepts a fair level and reports budgets", () => {
    const r = validateLevel(L([ROW(), ROW(), ROW(), ROW(), ROW("          ===        "), ROW("   P    C      ^     G"), "#".repeat(12) + "  " + "#".repeat(26)]), FEEL_CLASSIC);
    expect(r.problems).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.triangles).toBeGreaterThan(0);
  });
  it("rejects a gap no jump can clear and a wall too high to climb", () => {
    const gap = validateLevel(L([ROW(), ROW(), ROW(), ROW(), ROW(), ROW("   P               G"), "#".repeat(8) + " ".repeat(10) + "#".repeat(22)]), FEEL_CLASSIC);
    expect(gap.ok).toBe(false);
    expect(gap.problems.join()).toMatch(/goal/);
    const wall = validateLevel(L([ROW(), ROW("           #"), ROW("           #"), ROW("           #"), ROW("           #"), ROW("           #"), ROW("   P       #     G"), FLOOR]), FEEL_CLASSIC);
    expect(wall.ok).toBe(false);
  });
  it("counts springs and ladders as ways up", () => {
    const rows = [ROW(), ROW("        ########G"), ROW("        #"), ROW("        #"), ROW("        #"), ROW("        #"), ROW("   P  S #"), FLOOR];
    expect(validateLevel(L(rows), FEEL_CLASSIC).ok).toBe(true);
  });
});
