import { describe, expect, it } from "vitest";
import { LEVELS } from "./drop-four/levels";
import { drop, empty, four, full, type Grid, landing, NODE_CAP, open, SLICE, think, thinking, W } from "./drop-four/rules";
import { FourSim, STEP_SLICES } from "./drop-four/sim";
import { rng } from "./kitgrid/rng";

/** Builds a grid from drops: "3,3,4" = side 0 in col 3, side 1 in col 3, side 0 in col 4. */
const play = (cols: number[]) => {
  const g = empty();
  cols.forEach((c, i) => drop(g, c, i % 2));
  return g;
};

describe("Drop Four rules", () => {
  it("discs fall to the bottom and stack; a full column takes no more", () => {
    const g = empty();
    expect(drop(g, 2, 0)).toBe(0);
    expect(drop(g, 2, 1)).toBe(1);
    for (let i = 0; i < 4; i++) drop(g, 2, 0);
    expect(landing(g, 2)).toBe(-1);
    expect(drop(g, 2, 0)).toBe(-1);
    expect(open(g)).not.toContain(2);
  });

  it("four across, up and on both slants win; three don't", () => {
    expect(four(play([0, 0, 1, 1, 2, 2]), 0)).toBeNull();
    expect(four(play([0, 0, 1, 1, 2, 2, 3]), 0)).toHaveLength(4); // across
    expect(four(play([0, 1, 0, 1, 0, 1, 0]), 0)).toHaveLength(4); // up
    expect(four(play([0, 1, 1, 2, 2, 3, 2, 3, 3, 6, 3]), 0)).toHaveLength(4); // slant up-right
    expect(four(play([6, 5, 5, 4, 4, 3, 4, 3, 3, 0, 3]), 0)).toHaveLength(4); // slant up-left
  });

  it("the board fills up to a draw", () => {
    const g: Grid = empty();
    // a pattern with no four anywhere: columns alternate in pairs of rows
    const order = [0, 1, 2, 3, 4, 5, 6];
    for (let r = 0; r < 6; r++) for (const c of order) drop(g, c, ((c + Math.floor(r / 2)) % 2));
    expect(four(g, 0)).toBeNull();
    expect(four(g, 1)).toBeNull();
    expect(full(g)).toBe(true);
  });

  it("everyone above the first rung takes a win in one and blocks a loss in one", () => {
    const win = play([0, 6, 1, 6, 2, 5]); // side 0 to move with three across: col 3 wins
    for (const l of LEVELS) expect(think(win, 0, l.brain, rng(1)), l.name).toBe(3);
    const block = play([0, 6, 1, 6, 2]); // side 1 to move must block col 3
    for (const l of LEVELS.slice(2)) for (let s = 0; s < 5; s++) expect(think(block, 1, l.brain, rng(s)), l.name).toBe(3);
  });

  const game = (a: number, b: number, seed: number) => {
    const g = empty();
    const r = rng(seed);
    for (let ply = 0; ply < W * 6; ply++) {
      const s = ply % 2;
      const c = think(g, s, LEVELS[s === 0 ? a : b]!.brain, r);
      drop(g, c, s);
      if (four(g, s)) return s;
    }
    return -1;
  };

  it("the ladder gets harder: each opponent beats the one two rungs below", () => {
    for (const [weak, strong] of [[0, 2], [1, 3], [2, 4], [3, 5]] as const) {
      let wins = 0, losses = 0;
      for (let s = 0; s < 6; s++) {
        const w1 = game(strong, weak, s), w2 = game(weak, strong, s + 50);
        wins += (w1 === 0 ? 1 : 0) + (w2 === 1 ? 1 : 0);
        losses += (w1 === 1 ? 1 : 0) + (w2 === 0 ? 1 : 0);
      }
      expect(wins, `${LEVELS[strong]!.name} vs ${LEVELS[weak]!.name}`).toBeGreaterThan(losses + 4);
    }
  }, 60_000);

  it("Ringmaster Rex thinks fast enough for a slow TV", () => {
    const g = empty();
    const r = rng(2);
    let worst = 0;
    for (let ply = 0; ply < 20; ply++) {
      const t = performance.now();
      const c = think(g, ply % 2, LEVELS[5]!.brain, r);
      worst = Math.max(worst, performance.now() - t);
      drop(g, c, ply % 2);
      if (four(g, ply % 2)) break;
    }
    expect(worst).toBeLessThan(150);
  });
});

describe("Drop Four on the TV", () => {
  const move = (s: FourSim, p: number, col: number) => {
    const at = () => (s.debug().cols as number[])[p]!;
    for (let guard = 0; at() !== col; guard++) {
      if (guard > 20) throw new Error(`cursor stuck at ${at()} (wanted ${col})`);
      const dir = at() < col ? 1 : -1;
      s.steer(p, dir); s.step(16); s.steer(p, 0); s.step(16);
    }
  };
  const settle = (s: FourSim) => { for (let i = 0; i < 120 && (s.debug().falling || s.debug().thinking); i++) s.step(16); };

  it("a dropped disc falls, then the computer answers", () => {
    const s = new FourSim(LEVELS[0]!, 1, "", ["#f00"], ["Ana"]);
    move(s, 0, 2);
    s.act("drop", 0);
    expect(s.debug().falling).toBe(true);
    settle(s);
    expect((s.debug().rows as string[])[5]![2]).toBe("o");
    expect(s.debug().drops).toEqual([1, 1]);
    expect(s.debug().turn).toBe(0);
  });

  it("two phones take turns; a full column is refused; four in a row ends it", () => {
    const s = new FourSim(LEVELS[0]!, 1, "", ["#f00", "#00f"], ["Ana", "Ben"]);
    expect(s.act("drop", 1)[0]!.toast).toMatch(/Wait for Ana/);
    for (const [p, c] of [[0, 0], [1, 0], [0, 0], [1, 0], [0, 0], [1, 0]] as const) { move(s, p, c); s.act("drop", p); settle(s); }
    move(s, 0, 0);
    expect(s.act("drop", 0)[0]!.toast).toMatch(/full/);
    // the bottom row is Ana's from column 0: three more across wins
    for (const [p, c] of [[0, 1], [1, 6], [0, 2], [1, 6]] as const) { move(s, p, c); s.act("drop", p); settle(s); }
    expect(s.outcome()).toBeNull();
    move(s, 0, 3); s.act("drop", 0); settle(s);
    expect(s.outcome()?.winner).toBe(0);
    expect(s.outcome()?.headline).toBe("Ana wins!");
  });

  it("a sharp player beats every early opponent, and three stars are reachable", () => {
    for (const lvl of [0, 1, 2]) {
      let best = 0;
      for (let seed = 0; seed < 4 && best < 3; seed++) {
        const s = new FourSim(LEVELS[lvl]!, seed, "", ["#f00"], ["Ana"]);
        const r = rng(seed + 9);
        for (let t = 0; t < 60 && !s.outcome(); t++) {
          move(s, 0, think(s.grid, 0, { depth: 7, blunder: 0, blind: 0 }, r));
          s.act("drop", 0);
          settle(s);
        }
        best = Math.max(best, s.outcome()?.stars ?? 0);
      }
      expect(best, LEVELS[lvl]!.name).toBeGreaterThanOrEqual(lvl < 2 ? 3 : 1);
    }
  }, 30_000);

  it("the strongest computer reads in small slices across frames, so the TV keeps drawing on its turn", () => {
    // the per-frame budget: STEP_SLICES slices of SLICE positions, far below one whole search
    expect(STEP_SLICES * SLICE).toBeLessThan(NODE_CAP / 20);
    const s = new FourSim(LEVELS[5]!, 7, "", ["#f00"], ["Ana"]);
    const steps = (n: number) => { for (let i = 0; i < n; i++) s.step(16); };
    for (const col of [3, 3, 2, 4, 1]) {
      if (s.outcome()) break;
      move(s, 0, col);
      if (s.debug().turn !== 0 || s.act("drop", 0).length === 0) continue;
      let frames = 0;
      while ((s.debug().turn === 1 || s.debug().falling) && !s.outcome() && frames < 600) { s.step(16); frames++; }
      expect(frames).toBeLessThan(600); // the computer still answers, a second or so later
      steps(5);
    }
    expect(s.debug().drops).not.toEqual([0, 0]);
    expect(s.debug().aiPeak).toBeGreaterThan(0);
    expect(s.debug().aiPeak).toBeLessThanOrEqual(STEP_SLICES);
  });

  it("slicing the search changes nothing: the step-by-step search picks what the whole search picks", () => {
    const g = empty();
    for (let ply = 0; ply < 14; ply++) {
      const a = think(g, ply % 2, LEVELS[5]!.brain, rng(ply));
      const it = thinking(g, ply % 2, LEVELS[5]!.brain, rng(ply));
      let n = it.next();
      while (!n.done) n = it.next();
      expect(n.value).toBe(a);
      drop(g, a, ply % 2);
      if (four(g, ply % 2)) break;
    }
  });
});
