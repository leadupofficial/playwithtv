/**
 * MONSOON COURIER levels: rain-soaked rooftops built as a run from left to right (kitplat LevelBuilder).
 * Fast and flowing: long runs with boost pads and loops, tin-roof slopes to gather speed, springs up to the water
 * tanks, awnings over the gaps, and the Mango Bandit on the market roof at the end.
 */
import { LevelBuilder } from "../kitplat/builder";
import type { LevelDef } from "../kitplat/level";

const H = 16;

/** Gems along an awning: a one-way shelf `len` wide at height y starting at column c, with gems on it. */
function awning(b: LevelBuilder, c: number, y: number, len: number) {
  b.shelf(c, y, len);
  for (let i = 0; i < len; i++) b.at(c + i, y + 1, "o");
}

export function rooftopRun(): LevelDef {
  const b = new LevelBuilder(H);
  b.ground(10, 3).start(2).gems(5, 4)
    .ground(8, 3).foe(5, "e").gems(1, 3, 1)
    .pit(2).arc(0, 4, 2, 1)
    .ground(12, 3).boost(1).gems(4, 6).foe(10, "h")
    .slope(2).ground(6).gems(1, 4, 1);
  const a1 = b.x;
  b.pit(3).arc(0, 5, 3, 0)
    .ground(9, 4).foe(4, "e").spring(7).arc(7, 4, 6, 3)
    .ground(5, 4).checkpoint(2)
    .slope(-2).ground(14, 2).boost(0).loop(7).gems(3, 3).gems(10, 3)
    .pit(2)
    .ground(6, 3).foe(3, "f", 2)
    .pit(3).arc(0, 5, 3, 1)
    .ground(10, 5).power(2).foe(7, "k")
    .slope(-2).ground(8, 3).gems(1, 6)
    .pit(2).ground(4, 3).spring(2).arc(2, 5, 6, 3);
  const a2 = b.x;
  b.pit(4)
    .ground(12, 6).checkpoint(1).foe(6, "e").gems(4, 5)
    .slope(-3).ground(10, 3).boost(1).foe(7, "h")
    .pit(3).arc(0, 4, 2, 1)
    .ground(16, 3).gems(1, 4).goal(12);
  awning(b, a1 - 2, 8, 6);
  awning(b, a2 - 1, 9, 6);
  return b.level({ id: "mc-1", name: "Rooftop Run", time: 170, backdrop: "monsoon" });
}

export function waterTankHeights(): LevelDef {
  const b = new LevelBuilder(H);
  b.ground(9, 3).start(2).gems(4, 4)
    .ground(6, 3).spring(3).arc(3, 4, 6, 3)
    .pit(2).ground(7, 7).gems(1, 5).foe(5, "e")
    .pit(3).ground(6, 7).foe(3, "h")
    .slope(-3).ground(10, 4).boost(1).foe(8, "k");
  const gap = b.x;
  b.pit(7).ground(10, 4).checkpoint(1).gems(4, 5)
    .slope(2).ground(4, 6).pit(2).ground(5, 6).power(2)
    .pit(2).ground(3, 6).spring(1).pit(3).ground(8, 9).gems(1, 6).foe(5, "f", 2)
    .slope(-4).ground(16, 5).boost(1).loop(8).gems(4, 3).gems(12, 3)
    .pit(3).arc(0, 5, 3, 1)
    .ground(8, 4).checkpoint(2).foe(6, "e")
    .pit(4).ground(6, 4).foe(3, "h");
  const hi = b.x;
  b.slope(3).ground(12, 7).gems(1, 8).foe(9, "k")
    .pit(3).ground(14, 5).boost(1).foe(7, "e").foe(11, "f", 2)
    .slope(-2).ground(14, 3).gems(2, 5).goal(11);
  b.at(gap + 1, 3, "M"); // a plank shuttling across the widest gap
  for (let i = 0; i < 5; i++) b.at(gap + 1 + i, 6, "o");
  awning(b, hi - 6, 9, 4);
  return b.level({ id: "mc-2", name: "Water-Tank Heights", time: 190, backdrop: "monsoon", movers: [{ w: 3, travel: 4, period: 4 }], grade: "#e4eaff" });
}

export function bandit(): LevelDef {
  const b = new LevelBuilder(H);
  b.ground(10, 3).start(2).gems(4, 5)
    .ground(6, 3).foe(3, "e")
    .pit(2).ground(8, 4).spring(5).arc(5, 4, 5, 3)
    .slope(-1).ground(12, 3).boost(1).gems(5, 6)
    .pit(3).ground(8, 3).checkpoint(2).power(5)
    .ground(26, 3);
  const arena = b.seg;
  b.on(18, "Z");
  for (let r = 3; r < 13; r++) b.at(arena + 25, r, "#"); // the market roof's far wall
  b.shelf(arena + 4, 6, 3).shelf(arena + 18, 6, 3);
  return b.level({ id: "mc-3", name: "The Mango Bandit", time: 200, backdrop: "monsoon", boss: "bandit", grade: "#ffe0cc" });
}

export function quickDelivery(): LevelDef {
  const b = new LevelBuilder(H);
  b.ground(10, 3).start(2).gems(4, 5)
    .ground(8, 3).foe(6, "e")
    .pit(2).arc(0, 3, 2, 1)
    .ground(10, 3).boost(1).gems(4, 5)
    .ground(6, 3).spring(3).arc(3, 4, 6, 3)
    .ground(6, 3).checkpoint(1)
    .pit(2).ground(12, 3).foe(5, "h").gems(2, 3)
    .ground(12, 3).goal(8);
  return b.level({ id: "mc-q", name: "Quick Delivery", time: 75, backdrop: "monsoon" });
}

export const LEVELS = [rooftopRun(), waterTankHeights(), bandit()];
export const QUICK = [quickDelivery()];
