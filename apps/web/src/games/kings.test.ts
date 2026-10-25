import { describe, expect, it } from "vitest";
import { LEVELS } from "./kings-row/levels";
import { count, type Move, moves, parseBoard, play, startBoard, think } from "./kings-row/rules";
import { KingsSim } from "./kings-row/sim";
import { rng } from "./kitgrid/rng";

const sq = (x: number, y: number) => y * 8 + x;
const paths = (ms: Move[]) => ms.map((m) => m.path.join(">")).sort();

describe("Kings Row rules", () => {
  it("starts with 12 pieces each and 7 opening moves", () => {
    const b = startBoard();
    expect(count(b, 0).all).toBe(12);
    expect(count(b, 1).all).toBe(12);
    expect(moves(b, 0)).toHaveLength(7);
    expect(moves(b, 1)).toHaveLength(7);
  });

  it("men only step forward; kings step both ways", () => {
    const b = parseBoard(["........", "........", "........", "...o....", "........", "........", "........", "........"]);
    expect(paths(moves(b, 0))).toEqual([`${sq(3, 3)}>${sq(2, 2)}`, `${sq(3, 3)}>${sq(4, 2)}`].sort());
    b[sq(3, 3)] = 2;
    expect(moves(b, 0)).toHaveLength(4);
  });

  it("a capture is forced, and multi-jumps must be finished", () => {
    const b = parseBoard([
      "........",
      "........",
      "...x....",
      "........",
      ".x......",
      "o.......",
      ".......o",
      "........",
    ]);
    const ms = moves(b, 0);
    expect(ms).toHaveLength(1); // the h-file man may not just step: the jump is forced
    expect(ms[0]!.path).toEqual([sq(0, 5), sq(2, 3), sq(4, 1)]);
    expect(ms[0]!.caps.sort()).toEqual([sq(1, 4), sq(3, 2)].sort());
    const after = play(b, ms[0]!);
    expect(count(after, 1).all).toBe(0);
  });

  it("a man that jumps onto the far row is crowned and stops there", () => {
    const b = parseBoard(["........", "..x.x...", ".o......", "........", "........", "........", "........", "........"]);
    const ms = moves(b, 0);
    expect(ms).toHaveLength(1);
    expect(ms[0]!.path).toEqual([sq(1, 2), sq(3, 0)]); // a king could jump on over e7, a man can't
    expect(play(b, ms[0]!)[sq(3, 0)]).toBe(2);
  });

  it("a king can't jump the same piece twice and branches are all offered", () => {
    // the king starts beside a square of four and can jump all the way round, back to where it began
    const b = parseBoard(["........", "...O....", "..x.x...", "........", "..x.x...", "........", "........", "........"]);
    const ms = moves(b, 0);
    expect(ms).toHaveLength(2); // clockwise and anticlockwise
    for (const m of ms) {
      expect(new Set(m.caps).size).toBe(4);
      expect(m.path.at(-1)).toBe(sq(3, 1));
    }
  });

  it("the computer takes a free piece and avoids hanging one", () => {
    const b = parseBoard(["........", "........", "........", "...x....", "..o.....", "........", "........", "........"]);
    const m = think(b, 1, LEVELS[1]!.brain, rng(1))!;
    expect(m.caps).toHaveLength(1);
    // side 1 to move with a choice: stepping next to the o's would be jumped
    const c = parseBoard(["........", "........", ".x......", "........", "...o....", "........", "........", "........"]);
    for (let s = 0; s < 10; s++) {
      const mv = think(c, 1, LEVELS[4]!.brain, rng(s))!;
      expect(moves(play(c, mv), 0).some((x) => x.caps.length), `seed ${s}`).toBe(false);
    }
  });

  it("the ladder gets harder: each opponent beats the one two rungs below", () => {
    const game = (a: number, b: number, seed: number) => {
      let bd = startBoard(), turn = 0, quiet = 0;
      const r = rng(seed);
      for (let ply = 0; ply < 200; ply++) {
        const m = think(bd, turn, LEVELS[turn === 0 ? a : b]!.brain, r);
        if (!m) return 1 - turn;
        const man = Math.abs(bd[m.path[0]!]!) === 1;
        bd = play(bd, m);
        quiet = m.caps.length || man ? 0 : quiet + 1;
        if (quiet >= 100) return -1;
        turn = 1 - turn;
      }
      return -1;
    };
    for (const [weak, strong] of [[0, 2], [1, 3], [2, 4]] as const) {
      let wins = 0, losses = 0;
      for (let s = 0; s < 6; s++) {
        const w1 = game(strong, weak, s), w2 = game(weak, strong, s + 50);
        wins += (w1 === 0 ? 1 : 0) + (w2 === 1 ? 1 : 0);
        losses += (w1 === 1 ? 1 : 0) + (w2 === 0 ? 1 : 0);
      }
      expect(wins, `${LEVELS[strong]!.name} vs ${LEVELS[weak]!.name}`).toBeGreaterThan(losses + 4);
    }
  }, 60_000);

  it("Grandmaster Ada thinks fast enough for a slow TV", () => {
    let bd = startBoard();
    const r = rng(3);
    let worst = 0;
    for (let ply = 0; ply < 30; ply++) {
      const t = performance.now();
      const m = think(bd, ply % 2, LEVELS[5]!.brain, r);
      worst = Math.max(worst, performance.now() - t);
      if (!m) break;
      bd = play(bd, m);
    }
    expect(worst).toBeLessThan(150); // a weak TV is ~5x slower than this machine: still under a second
  });
});

describe("Kings Row on the TV", () => {
  const press = (s: KingsSim, p: number, ...dirs: string[]) => {
    for (const d of dirs) {
      const [x, y] = d === "R" ? [1, 0] : d === "L" ? [-1, 0] : d === "U" ? [0, 1] : [0, -1];
      s.steer(p, x, y);
      s.step(16);
      s.steer(p, 0, 0);
      s.step(16);
    }
  };
  const goTo = (s: KingsSim, p: number, target: number) => {
    const c = () => (s.debug().cursors as number[])[p]!;
    while ((c() & 7) < (target & 7)) press(s, p, "R");
    while ((c() & 7) > (target & 7)) press(s, p, "L");
    while (c() >> 3 < target >> 3) press(s, p, "D");
    while (c() >> 3 > target >> 3) press(s, p, "U");
  };

  it("pick a piece up, put it down, and the computer replies", () => {
    const s = new KingsSim(LEVELS[0]!, 1, "", ["#f00"], ["Ana"]);
    const m = s.legalMoves()[0]!;
    goTo(s, 0, m.path[0]!);
    expect(s.act("pick", 0)[0]!.sfx).toBe("select");
    goTo(s, 0, m.path[1]!);
    s.act("pick", 0);
    expect(s.debug().turn).toBe(1);
    expect(s.debug().thinking).toBe(true);
    for (let i = 0; i < 60; i++) s.step(16);
    expect(s.debug().turn).toBe(0);
    expect(s.debug().plies).toBe(2);
  });

  it("holding an arrow repeats; illegal picks are explained", () => {
    const s = new KingsSim(LEVELS[0]!, 1, "", ["#f00"], ["Ana"]);
    goTo(s, 0, sq(0, 7));
    for (let i = 0; i < 40; i++) { s.steer(0, 1, 0); s.step(16); } // 640 ms held: 1 + repeats
    s.steer(0, 0, 0);
    expect((s.debug().cursors as number[])[0]! & 7).toBeGreaterThanOrEqual(3);
    goTo(s, 0, sq(0, 7)); // a back-row piece is blocked
    expect(s.act("pick", 0)[0]!.toast).toMatch(/can't move/);
    goTo(s, 0, sq(1, 2)); // the enemy
    expect(s.act("pick", 0)[0]!.toast).toMatch(/your own/);
  });

  it("two phones take turns and only the player to move can pick", () => {
    const s = new KingsSim(LEVELS[0]!, 1, "", ["#f00", "#00f"], ["Ana", "Ben"]);
    expect(s.act("pick", 1)[0]!.toast).toMatch(/Wait for Ana/);
    const m = s.legalMoves()[0]!;
    goTo(s, 0, m.path[0]!); s.act("pick", 0); goTo(s, 0, m.path[1]!); s.act("pick", 0);
    expect(s.debug().turn).toBe(1);
    for (let i = 0; i < 80; i++) s.step(16);
    expect(s.debug().turn).toBe(1); // no computer in a duel
    const n = s.legalMoves()[0]!;
    goTo(s, 1, n.path[0]!); s.act("pick", 1); goTo(s, 1, n.path[1]!); s.act("pick", 1);
    expect(s.debug().turn).toBe(0);
  });

  it("↩ twice resigns: the other player wins", () => {
    const s = new KingsSim(LEVELS[0]!, 1, "", ["#f00", "#00f"], ["Ana", "Ben"]);
    expect(s.act("back", 1)[0]!.toast).toMatch(/again/);
    s.act("back", 1);
    expect(s.outcome()?.winner).toBe(0);
    expect(s.outcome()?.headline).toBe("Ana wins!");
  });

  it("beating the computer with a full army and two kings is three stars", () => {
    // play Milo with the strongest brain on our side, through the TV controls
    let best = 0;
    for (let seed = 0; seed < 4 && best < 3; seed++) {
      const s = new KingsSim(LEVELS[0]!, seed, "", ["#f00"], ["Ana"]);
      const r = rng(seed);
      for (let t = 0; t < 400 && !s.outcome(); t++) {
        if (s.debug().turn === 0) {
          const m = think(s.board, 0, { depth: 5, blunder: 0, noise: 1 }, r)!;
          for (const step of m.path) { goTo(s, 0, step); s.act("pick", 0); }
        } else for (let i = 0; i < 60; i++) s.step(16);
      }
      const o = s.outcome()!;
      expect(o.won, o.checks.map((c) => c.text).join(" | ")).toBe(true);
      best = Math.max(best, o.stars);
    }
    expect(best).toBe(3);
  }, 30_000);
});
