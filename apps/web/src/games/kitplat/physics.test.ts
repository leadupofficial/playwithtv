import { describe, expect, it } from "vitest";
import { Collider } from "./collide";
import { DT, FEEL_CLASSIC, type Feel, jumpReach, launchSpeed } from "./feel";
import { parseLevel, Tile, type LevelDef } from "./level";
import { type Mover, type PadInput, newMover, stepMover } from "./player";

const F = FEEL_CLASSIC;
const def = (rows: string[], extra: Partial<LevelDef> = {}): LevelDef => ({ id: "t", name: "t", time: 99, rows, ...extra });
const idle = (): PadInput => ({ x: 0, y: 0, jump: false, jumpPressed: false, run: false, action: false });

function world(rows: string[]) {
  const level = parseLevel(def(rows));
  return { level, col: new Collider(level) };
}

/** Runs n steps with an input function; returns the mover and the per-step y trace. */
function run(col: Collider, m: Mover, n: number, input: (i: number) => Partial<PadInput>, f: Feel = F) {
  const ys: number[] = [];
  for (let i = 0; i < n; i++) {
    stepMover(m, { ...idle(), ...input(i) }, f, col, DT);
    ys.push(m.body.y);
  }
  return ys;
}

const FLAT = [
  "                              ",
  "                              ",
  "                              ",
  "                              ",
  "                              ",
  "                              ",
  "  P                           ",
  "##############################",
];

describe("level format", () => {
  it("parses rows bottom-up with entities and a start", () => {
    const l = parseLevel(def(["  o  G", "P  e  ", "######"]));
    expect(l.w).toBe(6);
    expect(l.h).toBe(3);
    expect(l.tiles[0]).toBe(Tile.Solid);
    expect(l.start).toEqual({ x: 0.5, y: 1 });
    expect(l.goal).toEqual({ x: 5.5, y: 2 });
    expect(l.entities.find((e) => e.kind === "walker")).toMatchObject({ x: 3.5, y: 1 });
    expect(l.entities.find((e) => e.kind === "gem")).toMatchObject({ x: 2.5, y: 2 });
  });
  it("rejects unknown glyphs and levels without a start", () => {
    expect(() => parseLevel(def(["P  @", "####"]))).toThrow(/unknown glyph/);
    expect(() => parseLevel(def(["    ", "####"]))).toThrow(/no player start/);
  });
});

describe("ground, walls and gravity", () => {
  it("falls onto the floor and stands on it exactly", () => {
    const { col } = world(FLAT);
    const m = newMover(5.5, 4);
    run(col, m, 60, () => ({}));
    expect(m.body.y).toBe(1);
    expect(m.body.grounded).toBe(true);
    expect(m.state).toBe("ground");
  });
  it("accelerates to walking speed in a fraction of a second, and runs faster holding RUN", () => {
    const { col } = world(FLAT);
    const m = newMover(3.5, 1);
    run(col, m, 2, () => ({}));
    let t = 0;
    while (m.body.vx < F.walk - 1e-6 && t < 60) { run(col, m, 1, () => ({ x: 1 })); t++; }
    expect(t * DT).toBeLessThan(0.25);
    run(col, m, 30, () => ({ x: 1, run: true }));
    expect(m.body.vx).toBeCloseTo(F.run, 3);
  });
  it("turns around quickly (turn bite) and stops when let go", () => {
    const { col } = world(FLAT);
    const m = newMover(10.5, 1);
    run(col, m, 40, () => ({ x: 1 }));
    let n = 0;
    while (m.body.vx > 0) { run(col, m, 1, () => ({ x: -1 })); n++; }
    expect(n * DT).toBeLessThan(0.12);
    run(col, m, 30, () => ({}));
    expect(m.body.vx).toBe(0);
  });
  it("stops at walls", () => {
    const { col } = world(["         ", "  P  #   ", "#########"]);
    const m = newMover(2.5, 1);
    run(col, m, 120, () => ({ x: 1, run: true }));
    expect(m.body.x).toBeCloseTo(5 - m.body.hw, 3);
  });
});

describe("jumping", () => {
  it("a held jump reaches the tuned height; a tap is a short hop (variable jump height)", () => {
    const { col } = world(FLAT);
    const full = newMover(5.5, 1);
    run(col, full, 2, () => ({}));
    const ys = run(col, full, 90, (i) => ({ jump: true, jumpPressed: i === 0 }));
    const peak = Math.max(...ys) - 1;
    expect(peak).toBeGreaterThan(F.jumpHeight - 0.1);
    expect(peak).toBeLessThan(F.jumpHeight + 0.8); // apex hang adds a little
    const tap = newMover(5.5, 1);
    run(col, tap, 2, () => ({}));
    const ys2 = run(col, tap, 90, (i) => ({ jump: i < 4, jumpPressed: i === 0 }));
    const hop = Math.max(...ys2) - 1;
    expect(hop).toBeLessThan(peak * 0.5);
    expect(hop).toBeGreaterThan(0.6);
  });
  it("coyote time: a jump just after walking off a ledge still works, a late one does not", () => {
    const rows = ["               ", "               ", "               ", "               ", "  P            ", "#####          ", "#####          "];
    for (const [late, ok] of [[3, true], [12, false]] as const) {
      const { col } = world(rows);
      const m = newMover(3.5, 2);
      run(col, m, 3, () => ({}));
      let i = 0;
      while (m.body.grounded && i++ < 200) run(col, m, 1, () => ({ x: 1 }));
      run(col, m, late, () => ({ x: 1 }));
      const vy0 = m.body.vy;
      run(col, m, 1, () => ({ x: 1, jump: true, jumpPressed: true }));
      expect(m.body.vy > 5, `jump ${late} frames after the ledge`).toBe(ok);
      void vy0;
    }
  });
  it("jump buffering: a press just before landing jumps on touchdown", () => {
    const { col } = world(FLAT);
    const m = newMover(5.5, 3);
    run(col, m, 1, () => ({}));
    // fall, pressing JUMP ~5 frames before landing
    let i = 0;
    while (m.body.y > 1.4 && i++ < 100) run(col, m, 1, () => ({}));
    run(col, m, 1, () => ({ jump: true, jumpPressed: true }));
    run(col, m, 12, () => ({ jump: true }));
    expect(m.body.y).toBeGreaterThan(1.5);
  });
  it("corner correction slides a head past the edge of a block", () => {
    const rows = ["          ", "          ", "    ###   ", "          ", "          ", "          ", " P        ", "##########"];
    const { col } = world(rows);
    const m = newMover(3.82, 1); // right edge pokes 0.12 under the block's left edge
    run(col, m, 2, () => ({}));
    const ys = run(col, m, 40, (i) => ({ jump: true, jumpPressed: i === 0 }));
    expect(Math.max(...ys)).toBeGreaterThan(4); // went past the block's bottom (y = 5 - h)
  });
  it("jump reach estimate agrees with the simulation", () => {
    const { col } = world(["                                   ", "                                   ", "                                   ", "                                   ", "                                   ", "  P                                ", "###################################"]);
    const m = newMover(3.5, 1);
    run(col, m, 2, () => ({}));
    run(col, m, 60, () => ({ x: 1, run: true }));
    const x0 = m.body.x;
    let i = 0;
    run(col, m, 1, () => ({ x: 1, run: true, jump: true, jumpPressed: true }));
    while (!m.body.grounded && i++ < 200) run(col, m, 1, () => ({ x: 1, run: true, jump: true }));
    const sim = m.body.x - x0;
    const est = jumpReach(F, F.run, 0);
    expect(sim).toBeGreaterThan(est * 0.95);
    expect(launchSpeed(4, 50)).toBeCloseTo(20, 6);
  });
});

describe("slopes, one-ways, ladders, ledges and platforms", () => {
  it("walks up a 45° slope smoothly onto the plateau, and back down without hopping", () => {
    const rows = ["               ", "               ", "               ", "       /#######", "      /########", "  P  /#########", "###############"];
    const { col } = world(rows);
    const m = newMover(2.5, 1);
    run(col, m, 2, () => ({}));
    const ys = run(col, m, 120, () => ({ x: 1 }));
    expect(m.body.y).toBe(4);
    for (let i = 1; i < ys.length; i++) expect(ys[i]! - ys[i - 1]!).toBeLessThan(0.2); // no pops
    let airborne = 0;
    for (let i = 0; i < 160; i++) {
      run(col, m, 1, () => ({ x: -1 }));
      if (!m.body.grounded) airborne++;
    }
    expect(m.body.y).toBe(1);
    expect(airborne).toBe(0); // glued to the slope all the way down
  });
  it("one-way platforms: jump up through, land on top, drop through with down + JUMP", () => {
    const rows = ["          ", "          ", "          ", "   ====   ", "          ", "          ", "    P     ", "##########"];
    const { col } = world(rows);
    const m = newMover(4.5, 1);
    run(col, m, 2, () => ({}));
    run(col, m, 80, (i) => ({ jump: true, jumpPressed: i === 0 }));
    expect(m.body.y).toBe(5);
    expect(m.body.ground).toBe(Tile.OneWay);
    run(col, m, 1, () => ({ y: -1, jump: true, jumpPressed: true }));
    run(col, m, 60, () => ({}));
    expect(m.body.y).toBe(1);
  });
  it("climbs a ladder to the top and stands on it", () => {
    const rows = ["          ", "          ", "    #H#   ", "     H    ", "     H    ", "   P H    ", "##########"];
    const { col } = world(rows);
    const m = newMover(5.5, 1);
    run(col, m, 2, () => ({}));
    run(col, m, 120, () => ({ y: 1 }));
    expect(m.body.y).toBe(5);
    expect(m.body.grounded).toBe(true);
  });
  it("grabs a ledge while falling past it (when the game allows) and climbs up", () => {
    const rows = ["          ", "          ", "          ", "      ####", "      ####", "      ####", "  P   ####", "##########"];
    const f: Feel = { ...F, ledgeGrab: true, jumpHeight: 3.5 };
    const { col } = world(rows);
    const m = newMover(4.8, 1);
    run(col, m, 2, () => ({}), f);
    let hung = false;
    for (let i = 0; i < 90 && !hung; i++) {
      stepMover(m, { ...idle(), x: 1, jump: i < 30, jumpPressed: i === 0 }, f, col, DT);
      hung = m.state === "hang";
    }
    expect(hung).toBe(true);
    run(col, m, 30, () => ({ y: 1 }), f);
    expect(m.body.y).toBe(5);
    expect(m.state).toBe("ground");
  });
  it("a moving platform carries a hero standing on it", () => {
    const { col } = world(FLAT);
    col.platforms.push({ x: 8, y: 3, hw: 1.5, dx: 0, dy: 0, active: true });
    const m = newMover(8, 4);
    run(col, m, 40, () => ({}));
    expect(m.body.y).toBe(3);
    expect(m.body.platform).toBe(0);
  });
});
