import { describe, expect, it } from "vitest";
import {
  BOUNCE_V, COL_W, GRAVITY, MAX_GAP, POINTS, SPRING_V, heightM, newMatch, newWorld, nextTarget, score, scores, stepMatch,
  stepWorld, worldIndex, wrapDx, type JumperEvent, type JumperInput, type Platform, type World,
} from "./engine";

const DT = 1 / 60;
const IDLE: JumperInput = { x: 0, power: false };

function run(w: World, secs: number, input: (w: World, i: number) => JumperInput = () => IDLE): JumperEvent[] {
  const ev: JumperEvent[] = [];
  for (let i = 0; i < Math.round(secs / DT); i++) stepWorld(w, DT, input(w, i), ev);
  return ev;
}

/** Steers towards the next platform, like a decent player. */
const bot = (w: World): JumperInput => {
  const tx = nextTarget(w);
  return { x: tx === null ? 0 : Math.max(-1, Math.min(1, wrapDx(w.hero.x, tx) / 50)), power: false };
};

/** A world with only the given platforms (no enemies or pickups), the hero falling from `y`. */
function lab(platforms: Array<Partial<Platform>>, y = 200): World {
  const w = newWorld("a", 1, 600);
  w.platforms = platforms.map((p, i) => ({ id: 100 + i, kind: "normal", x: 200, y: 0, w: 90, x0: p.x ?? 200, range: 0, speed: 0, phase: 0, broken: false, fall: 0, boing: 0, ...p }));
  w.enemies = [];
  w.pickups = [];
  w.genY = 1e9; // no more generation
  w.hero.y = y;
  w.hero.vy = 0;
  w.hero.x = 200;
  return w;
}

describe("tilt jumper: generation", () => {
  it("the climb is always possible: solid platforms are never further apart than a bounce reaches", () => {
    expect(MAX_GAP).toBeLessThan((BOUNCE_V * BOUNCE_V) / (2 * GRAVITY) * 0.85);
    for (const seed of [1, 7, 42, 1234, 99991]) {
      const w = newWorld("a", seed, 30_000);
      const solid = w.platforms.filter((p) => p.kind !== "breaking").sort((a, b) => a.y - b.y);
      expect(solid.length).toBeGreaterThan(150);
      for (let i = 1; i < solid.length; i++) expect(solid[i]!.y - solid[i - 1]!.y).toBeLessThanOrEqual(MAX_GAP + 1e-6);
      for (const p of w.platforms) expect(p.x).toBeGreaterThanOrEqual(0), expect(p.x).toBeLessThan(COL_W);
    }
  });

  it("every kind of platform, enemies and power-ups appear as the tower grows", () => {
    const w = newWorld("a", 5, 30_000);
    const kinds = new Set(w.platforms.map((p) => p.kind));
    expect([...kinds].sort()).toEqual(["breaking", "moving", "normal", "spring"]);
    expect(w.enemies.length).toBeGreaterThan(5);
    expect(new Set(w.enemies.map((e) => e.kind)).size).toBe(2);
    expect(w.pickups.some((k) => k.kind === "rocket")).toBe(true);
    expect(w.pickups.some((k) => k.kind === "shield")).toBe(true);
    expect(w.pickups.some((k) => k.kind === "gem")).toBe(true);
    // higher up is harder: more moving platforms in the top half than in the bottom
    const mid = 15_000;
    const moving = (lo: number, hi: number) => w.platforms.filter((p) => p.kind === "moving" && p.y >= lo && p.y < hi).length;
    expect(moving(mid, 30_000)).toBeGreaterThan(moving(0, mid));
  });

  it("is seedable: the same seed builds the same tower, another seed a different one", () => {
    const a = newWorld("a", 77, 5000), b = newWorld("b", 77, 5000), c = newWorld("c", 78, 5000);
    expect(a.platforms.map((p) => [p.kind, p.x, p.y])).toEqual(b.platforms.map((p) => [p.kind, p.x, p.y]));
    expect(a.platforms.map((p) => p.x)).not.toEqual(c.platforms.map((p) => p.x));
  });

  it("starts with a full-width launch pad and a stored rocket", () => {
    const w = newWorld("a", 3, 700);
    expect(w.platforms[0]!.w).toBeGreaterThanOrEqual(COL_W);
    expect(w.hero.stored).toBe("rocket");
  });
});

describe("tilt jumper: bouncing and platforms", () => {
  it("the hero bounces by itself on the launch pad and rises about 27 m", () => {
    const w = lab([{ y: 0, w: 800 }], 0);
    w.hero.vy = BOUNCE_V;
    const ev = run(w, 3);
    expect(w.hero.alive).toBe(true);
    expect(ev.filter((e) => e.kind === "bounce").length).toBeGreaterThanOrEqual(2);
    expect(heightM(w)).toBeGreaterThanOrEqual(26);
    expect(heightM(w)).toBeLessThanOrEqual(28);
  });

  it("only lands while falling, and only within the platform's width", () => {
    const w = lab([{ y: 100, x: 200, w: 80 }], 60);
    w.hero.vy = 800; // rising through from below: no landing
    run(w, 0.1);
    expect(w.bounces).toBe(0);
    const miss = lab([{ y: 100, x: 200, w: 80 }], 200);
    miss.hero.x = 320; // 120 away: misses
    run(miss, 0.6);
    expect(miss.bounces).toBe(0);
    const hit = lab([{ y: 100, x: 200, w: 80 }], 200);
    hit.hero.x = 250; // within half width + feet
    const ev = run(hit, 0.6);
    expect(ev.some((e) => e.kind === "bounce")).toBe(true);
  });

  it("wraps around the column edges, also for landing", () => {
    const w = lab([{ y: 100, x: 5, w: 80 }], 200);
    w.hero.x = COL_W - 20; // 25 units away across the edge
    const ev = run(w, 0.6);
    expect(ev.some((e) => e.kind === "bounce")).toBe(true);
    const s = lab([{ y: -1000, w: 800 }], 400);
    run(s, 0.5, () => ({ x: 1, power: false }));
    expect(s.hero.x).toBeGreaterThanOrEqual(0);
    expect(s.hero.x).toBeLessThan(COL_W);
  });

  it("a breaking platform crumbles under the hero, who falls through to the one below", () => {
    const w = lab([{ y: 150, kind: "breaking" }, { y: 0, w: 800 }], 260);
    const ev = run(w, 1);
    expect(ev.find((e) => e.kind === "break")).toBeTruthy();
    expect(w.platforms[0]!.broken).toBe(true);
    expect(ev.find((e) => e.kind === "bounce")?.y).toBe(0);
  });

  it("a spring launches much higher than a normal bounce", () => {
    const w = lab([{ y: 0, kind: "spring", w: 800 }], 50);
    const ev = run(w, 1.2);
    expect(ev.some((e) => e.kind === "spring")).toBe(true);
    expect(w.maxY).toBeGreaterThan((SPRING_V * SPRING_V) / (2 * GRAVITY) * 0.9);
  });

  it("moving platforms move", () => {
    const w = lab([{ y: -100, kind: "moving", range: 80, speed: 2, x: 200, w: 800 }], 0);
    const x0 = w.platforms[0]!.x;
    run(w, 0.5);
    expect(w.platforms[0]!.x).not.toBeCloseTo(x0, 0);
  });

  it("steering moves the hero left and right", () => {
    const w = lab([{ y: 0, w: 800 }], 0);
    run(w, 0.5, () => ({ x: 1, power: false }));
    expect(w.hero.x).toBeGreaterThan(300);
    expect(w.hero.face).toBe(1);
  });
});

describe("tilt jumper: enemies, pickups and power-ups", () => {
  const withEnemy = (heroY: number, vy: number) => {
    const w = lab([{ y: -3000, w: 800 }], heroY);
    w.hero.vy = vy;
    w.hero.stored = null;
    w.enemies = [{ id: 1, kind: "spikeling", x: 200, y: 300, x0: 200, y0: 300, range: 0, speed: 0, t: 0, r: 20, alive: true }];
    return w;
  };

  it("landing on an enemy from above stomps it and bounces", () => {
    const w = withEnemy(320, -300);
    const ev = run(w, 0.1);
    expect(ev.some((e) => e.kind === "stomp")).toBe(true);
    expect(w.enemies[0]?.alive ?? false).toBe(false);
    expect(w.points).toBe(POINTS.stomp);
    expect(w.hero.vy).toBeGreaterThan(0);
  });

  it("touching an enemy from below knocks the hero out of the run", () => {
    const w = withEnemy(250, 600);
    const ev = run(w, 0.1);
    expect(ev.some((e) => e.kind === "hit")).toBe(true);
    expect(w.hero.stunned).toBe(true);
    const ev2 = run(w, 3);
    expect(ev2.some((e) => e.kind === "fell")).toBe(true);
    expect(w.hero.alive).toBe(false);
  });

  it("a shield smashes one enemy, then it is gone", () => {
    const w = withEnemy(150, 700);
    w.hero.stored = "shield";
    const ev: JumperEvent[] = [];
    stepWorld(w, DT, { x: 0, power: true }, ev);
    expect(w.hero.shieldT).toBeGreaterThan(0);
    ev.push(...run(w, 0.3));
    expect(ev.some((e) => e.kind === "smash")).toBe(true);
    expect(w.hero.stunned).toBe(false);
    expect(w.hero.shieldT).toBe(0);
  });

  it("the rocket blasts upwards, ignores platforms and is used up", () => {
    const w = lab([{ y: 0, w: 800 }], 0);
    w.hero.vy = 0;
    const ev: JumperEvent[] = [];
    stepWorld(w, DT, { x: 0, power: true }, ev);
    expect(ev[0]).toMatchObject({ kind: "power", power: "rocket" });
    expect(w.hero.stored).toBeNull();
    run(w, 2);
    expect(heightM(w)).toBeGreaterThan(150);
    const again: JumperEvent[] = [];
    stepWorld(w, DT, { x: 0, power: true }, again);
    expect(again.some((e) => e.kind === "power")).toBe(false); // nothing stored
  });

  it("gems score, power-ups fill the slot and a spare one is worth points", () => {
    const w = lab([{ y: 0, w: 800 }], 0);
    w.hero.stored = null;
    w.hero.vy = BOUNCE_V;
    w.pickups = [
      { id: 1, kind: "gem", x: 200, y: 60, taken: false },
      { id: 2, kind: "shield", x: 200, y: 120, taken: false },
      { id: 3, kind: "rocket", x: 200, y: 180, taken: false },
    ];
    const ev = run(w, 0.4);
    expect(ev.map((e) => e.kind)).toEqual(expect.arrayContaining(["gem", "pickup", "spare"]));
    expect(w.hero.stored).toBe("shield");
    expect(w.points).toBe(POINTS.gem + POINTS.spare);
    expect(score(w)).toBe(heightM(w) + w.points);
  });
});

describe("tilt jumper: runs and the match", () => {
  it("a steering player climbs through the worlds", () => {
    const w = newWorld("a", 2024, 700);
    w.hero.stored = null;
    const ev = run(w, 90, bot);
    expect(heightM(w)).toBeGreaterThan(300);
    expect(ev.some((e) => e.kind === "world")).toBe(true);
    expect(w.world).toBeGreaterThanOrEqual(1);
  });

  it("falling below the screen ends the run", () => {
    const w = lab([], 100);
    const ev = run(w, 2);
    expect(ev.some((e) => e.kind === "fell")).toBe(true);
    expect(w.hero.alive).toBe(false);
    expect(w.endedAt).not.toBeNull();
    const t = w.time;
    run(w, 1);
    expect(w.time).toBe(t); // frozen
  });

  it("the match ends when everyone has fallen", () => {
    const m = newMatch(["a", "b"], 9, 700, 120);
    for (const w of m.worlds) { w.platforms = []; w.genY = 1e9; }
    for (let i = 0; i < 600 && !m.over; i++) stepMatch(m, DT, () => IDLE, []);
    expect(m.over).toBe(true);
    expect(m.time).toBeLessThan(10);
  });

  it("the match ends at the time limit, highest score first", () => {
    const m = newMatch(["a", "b"], 9, 700, 5);
    for (let i = 0; i < 400 && !m.over; i++) stepMatch(m, DT, (id) => (id === "a" ? bot(m.worlds[0]!) : IDLE), []);
    expect(m.over).toBe(true);
    expect(m.time).toBeCloseTo(5, 1);
    const s = scores(m);
    expect(s.get("a")!).toBeGreaterThan(s.get("b")!);
  });

  it("names the world for a height", () => {
    expect(worldIndex(0)).toBe(0);
    expect(worldIndex(260)).toBe(1);
    expect(worldIndex(650)).toBe(2);
    expect(worldIndex(5000)).toBe(3);
  });
});
