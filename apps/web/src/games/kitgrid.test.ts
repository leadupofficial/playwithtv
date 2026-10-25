import { describe, expect, it } from "vitest";
import { LEVELS as WORM_LEVELS, COLS as WC, ROWS as WR } from "./glowworm/levels";
import { WormSim, parseMap } from "./glowworm/sim";
import { LEVELS as STACK_LEVELS, StackSim, cells, W, H } from "./skyline/sim";
import { LEVELS as KITTY_LEVELS, MAZES, COLS as KC, ROWS as KR } from "./comet-kitty/levels";
import { KittySim, parseMaze } from "./comet-kitty/sim";
import { FieldSim, LEVELS as FIELD_LEVELS } from "./buzz-field/sim";
import type { Sim } from "./kitgrid/types";

/** Run a sim for `ms` in 16 ms frames, stopping early when it finishes. */
function run(sim: Sim, ms: number) {
  for (let t = 0; t < ms && !sim.outcome(); t += 16) sim.step(16);
}

describe("Glowworm Grove", () => {
  it("every garden is valid and every lantern can be reached from the start", () => {
    for (const l of WORM_LEVELS) {
      const m = parseMap(l.map);
      const seen = new Set([m.start[1] * WC + m.start[0]]);
      const stack = [m.start];
      while (stack.length) {
        const [x, y] = stack.pop()!;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          let nx = x + dx, ny = y + dy;
          if (m.wrap) { nx = (nx + WC) % WC; ny = (ny + WR) % WR; }
          if (nx < 0 || ny < 0 || nx >= WC || ny >= WR || m.hedge[ny * WC + nx] || seen.has(ny * WC + nx)) continue;
          seen.add(ny * WC + nx);
          stack.push([nx, ny]);
          const exit = m.burrows.get(ny * WC + nx);
          if (exit && !seen.has(exit[1] * WC + exit[0])) { seen.add(exit[1] * WC + exit[0]); stack.push(exit); }
        }
      }
      for (const [x, y] of m.lanterns) expect(seen.has(y * WC + x), `${l.name}: lantern ${x},${y}`).toBe(true);
      // Glo needs room to move off the start without turning
      expect(m.hedge[m.start[1] * WC + m.start[0] + 1], `${l.name}: start faces a hedge`).toBe(false);
    }
  });

  it("eating fireflies grows Glo and finishes the level", () => {
    const sim = new WormSim(WORM_LEVELS[0]!, 0, 1, "", true);
    const steer = () => {
      // walk straight at the firefly: line up the row first, then the column
      const { worm, firefly, dir } = sim.debug() as { worm: [number, number][]; firefly: [number, number]; dir: string };
      const [hx, hy] = worm[0]!;
      const want = hy !== firefly[1] ? (hy < firefly[1] ? "down" : "up") : hx < firefly[0] ? "right" : "left";
      if (want !== dir) sim.act(want);
    };
    for (let t = 0; t < 60_000 && !sim.outcome(); t += 16) { steer(); sim.step(16); }
    const o = sim.outcome()!;
    expect(o.won).toBe(true);
    expect(o.stars).toBeGreaterThanOrEqual(1);
    expect((sim.debug() as { worm: unknown[] }).worm.length).toBeGreaterThan(3);
  });

  it("running into the hedge costs a life and three crashes end the run", () => {
    const sim = new WormSim(WORM_LEVELS[0]!, 0, 1);
    run(sim, 20_000);
    const o = sim.outcome()!;
    expect(o.won).toBe(false);
    expect(sim.lives).toBe(0);
  });

  it("can't reverse straight into its own neck", () => {
    const sim = new WormSim(WORM_LEVELS[0]!, 0, 1);
    run(sim, 1300); // past the ready pause: Glo has grown a neck
    expect((sim.debug() as { worm: unknown[] }).worm.length).toBeGreaterThan(1);
    expect(sim.act("left")).toEqual([]);
    expect(sim.act("up").length).toBe(1);
  });
});

describe("Skyline Stacker", () => {
  it("every shape has four cells at every rotation", () => {
    for (const shape of ["I", "O", "T", "S", "Z", "J", "L"] as const) {
      for (let rot = 0; rot < 4; rot++) expect(new Set(cells({ shape, rot, x: 0, y: 0 }).map((c) => c.join())).size).toBe(4);
    }
  });

  it("dropping the I into the gap builds a floor and wins the quick level", () => {
    const sim = new StackSim(STACK_LEVELS[0]!, 0, 3, true);
    expect(sim.piece.shape).toBe("I");
    sim.act("drop");
    run(sim, 1000);
    expect(sim.outcome()?.won).toBe(true);
    expect(sim.built).toBe(1);
  });

  it("blocks keep falling and stacking until the pile tops out", () => {
    const sim = new StackSim(STACK_LEVELS[0]!, 0, 3);
    for (let i = 0; i < 200 && !sim.outcome(); i++) sim.act("drop"), sim.step(16);
    expect(sim.outcome()?.won).toBe(false);
    expect(sim.used).toBeGreaterThan(8);
  });

  it("pieces can't move through walls; rubble levels start with gapped rows", () => {
    const sim = new StackSim(STACK_LEVELS[3]!, 3, 9);
    for (let i = 0; i < 12; i++) sim.act("left");
    expect(Math.min(...cells(sim.piece).map((c) => c[0]))).toBe(0);
    const rows = (sim.debug() as { board: string[] }).board.slice(H - STACK_LEVELS[3]!.rubble);
    for (const r of rows) expect(r.split("r").length - 1).toBe(W - 1);
  });
});

describe("Comet Kitty", () => {
  it("every maze: right size, all stardust reachable, no dead ends", () => {
    for (const rows of MAZES) {
      const m = parseMaze(rows);
      const open = (x: number, y: number) => y >= 0 && y < KR && !m.wall[y * KC + ((x + KC) % KC)] && !m.dock[y * KC + ((x + KC) % KC)];
      const seen = new Set<number>([m.kitty[1] * KC + m.kitty[0]]);
      const stack = [m.kitty];
      while (stack.length) {
        const [x, y] = stack.pop()!;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = (x + dx + KC) % KC, ny = y + dy;
          if (!open(nx, ny) || seen.has(ny * KC + nx)) continue;
          seen.add(ny * KC + nx);
          stack.push([nx, ny]);
        }
      }
      for (const i of [...m.dust, ...m.nova]) expect(seen.has(i)).toBe(true);
      for (const i of seen) {
        const x = i % KC, y = Math.floor(i / KC);
        const exits = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => open(x + dx!, y + dy!)).length;
        expect(exits, `dead end at ${x},${y}`).toBeGreaterThan(1);
      }
    }
  });

  it("the quick level: three specks to the left, collected = win", () => {
    const sim = new KittySim(KITTY_LEVELS[0]!, 0, 1, "", true);
    run(sim, 5000);
    expect(sim.outcome()?.won).toBe(true);
  });

  it("standing still, the dustbots eventually catch Kitty", () => {
    const sim = new KittySim(KITTY_LEVELS[2]!, 2, 7);
    run(sim, 180_000);
    const o = sim.outcome();
    expect(o?.won).toBe(false);
    expect(sim.lives).toBe(0);
  });

  it("a nova star overloads the bots", () => {
    const sim = new KittySim(KITTY_LEVELS[0]!, 0, 1);
    const m = parseMaze(MAZES[0]!);
    // steer along the shortest path to the nearest nova star
    const toward = (from: [number, number]): string | null => {
      const key = (x: number, y: number) => y * KC + x;
      const back = new Map<number, [number, string]>();
      const q: [number, number][] = [from];
      back.set(key(...from), [-1, ""]);
      while (q.length) {
        const [x, y] = q.shift()!;
        if (m.nova.has(key(x, y))) {
          let k = key(x, y), dir = "";
          while (back.get(k)![0] !== -1) [k, dir] = back.get(k)!;
          return dir;
        }
        for (const [d, dx, dy] of [["right", 1, 0], ["left", -1, 0], ["down", 0, 1], ["up", 0, -1]] as const) {
          const nx = (x + dx + KC) % KC, ny = y + dy;
          if (ny < 0 || ny >= KR || m.wall[key(nx, ny)] || m.dock[key(nx, ny)] || back.has(key(nx, ny))) continue;
          back.set(key(nx, ny), [key(x, y), d]);
          q.push([nx, ny]);
        }
      }
      return null;
    };
    for (let t = 0; t < 20000 && !(sim.debug() as { power: boolean }).power && !sim.outcome(); t += 16) {
      const d = toward((sim.debug() as { kitty: [number, number] }).kitty);
      if (d) sim.act(d);
      sim.step(16);
    }
    expect((sim.debug() as { power: boolean }).power).toBe(true);
  });
});

describe("Buzz Field", () => {
  it("the first dig is always safe and opens an area", () => {
    for (let seed = 1; seed < 40; seed++) {
      const l = FIELD_LEVELS[9]!;
      const sim = new FieldSim(l, 9, seed);
      sim.act("dig");
      expect(sim.outcome()).toBeNull();
      expect(sim.stings).toBe(0);
      const opened = (sim.debug() as { view: string[] }).view.join("").replace(/[#F]/g, "").length;
      expect(opened).toBeGreaterThan(1);
      expect(sim.hive!.filter(Boolean).length).toBe(l.hives);
    }
  });

  it("the quick field: one dig clears the 5 × 5 meadow with one hive", () => {
    const sim = new FieldSim(FIELD_LEVELS[0]!, 0, 1, true);
    sim.act("dig");
    expect(sim.outcome()?.won).toBe(true);
  });

  it("solving by the rules (flag certain hives, mow certain safe patches) clears early meadows", () => {
    let wins = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const sim = new FieldSim(FIELD_LEVELS[0]!, 0, seed);
      sim.act("dig");
      // a tiny logic solver, using only what a player can see
      for (let pass = 0; pass < 60 && !sim.outcome(); pass++) {
        let moved = false;
        for (let i = 0; i < sim.open.length && !sim.outcome(); i++) {
          if (!sim.open[i] || sim.hive![i]) continue;
          const nb = sim.neighbours(i);
          const hidden = nb.filter((j) => !sim.open[j] && !sim.flag[j]);
          const flags = nb.filter((j) => sim.flag[j]).length;
          if (!hidden.length) continue;
          if (sim.near[i] === flags) for (const j of hidden) { (sim as unknown as { reveal(n: number): void }).reveal(j); moved = true; }
          else if (sim.near[i] === flags + hidden.length) for (const j of hidden) { sim.flag[j] = true; moved = true; }
        }
        if (!moved) break;
      }
      if (sim.outcome()?.won) wins++;
      expect(sim.stings).toBe(0); // rule-based moves never wake a hive
    }
    expect(wins).toBeGreaterThan(5);
  });

  it("digging a hive spends a honey jar; with none left the run ends", () => {
    const sim = new FieldSim(FIELD_LEVELS[0]!, 0, 2);
    sim.act("dig");
    const hives = sim.hive!.map((h, i) => (h ? i : -1)).filter((i) => i >= 0);
    const dig = (i: number) => (sim as unknown as { reveal(n: number): void }).reveal(i);
    dig(hives[0]!);
    expect(sim.jars).toBe(1);
    dig(hives[1]!);
    dig(hives[2]!);
    expect(sim.outcome()?.won).toBe(false);
  });
});
