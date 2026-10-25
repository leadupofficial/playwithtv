/**
 * STEPWELL SECRETS levels: down through an ancient step-well, Prince-of-Persia style traversal. Walls too high
 * to jump are climbed by grabbing their ledges; levers open iron gates for a few seconds (a friend can hold the way
 * open); floors crumble; spike traps breathe in and out; the well's green water waits below. The Stone Makara
 * guards the pool at the bottom: lure it under the hanging bells and pull the levers.
 */
import { LevelBuilder } from "../kitplat/builder";
import type { LevelDef } from "../kitplat/level";

const H = 18;

export function upperSteps(): LevelDef {
  const b = new LevelBuilder(H);
  b.ground(8, 12).start(2).gems(4, 3)
    .slope(-3).ground(7, 9).gems(2, 3).foe(5, "e")
    .pit(2).ground(5, 9)
    .ground(5, 13).gems(1, 3)                      // a wall 4 high: grab the ledge
    .ground(5, 13).checkpoint(1).power(3)
    .bridge(4, "Y")                               // crumbling floor over the shaft
    .ground(8, 13).on(5, "L").pillar(7, 3, "D")   // pull the lever, the gate opens for a few seconds
    .ground(8, 13).gems(1, 5)
    .slope(-4).ground(12, 9);
  const traps = b.seg;
  for (const dx of [3, 4, 7, 8]) b.at(traps + dx, 9, "T");
  b.foe(10, "f", 2)
    .water(4, 2).ground(8, 9).foe(5, "h").checkpoint(1)
    .ground(8, 5);
  const lad = b.seg;
  b.ladder(2, 5, 9).shelf(lad + 3, 9, 4);
  for (let i = 0; i < 4; i++) b.at(lad + 3 + i, 10, "o");
  b.ground(6, 5).foe(3, "e")
    .ground(4, 9).ground(6, 9).power(2)
    .slope(-4).ground(14, 5).gems(2, 4).goal(11);
  return b.level({ id: "sw-1", name: "The Upper Steps", time: 220, backdrop: "stepwell", powerups: ["feather", "bell"] });
}

export function hallOfPillars(): LevelDef {
  const b = new LevelBuilder(H);
  b.ground(8, 10).start(2).gems(4, 3)
    .ground(8, 10).foe(5, "e");
  const t1 = b.seg;
  for (const dx of [2, 3, 5, 6]) b.at(t1 + dx, 10, "T");
  b.pit(3).ground(5, 10)
    .ground(5, 14).on(2, "U", 1)                  // ledge climb up to a feather
    .bridge(5, "Y").ground(6, 14).checkpoint(1).foe(3, "f", 2)
    .ground(10, 14).on(2, "L").on(7, "K").pillar(4, 3, "D").pillar(9, 3, "E")
    .ground(6, 14).gems(1, 4)
    .pit(2).ground(4, 14)
    .slope(-4).ground(8, 10).foe(4, "k")
    .water(5, 2).ground(6, 10).checkpoint(2);
  const shaft = b.x;
  b.pit(4).ground(8, 14).power(2).foe(5, "h");
  b.at(shaft + 1, 9, "N");                         // a rising slab in the shaft
  const t2 = b.seg;
  for (const dx of [5, 6]) b.at(t2 + dx, 14, "T");
  b.bridge(4, "Y").ground(6, 14).foe(3, "e")
    .slope(-4).ground(6, 10)
    .ground(6, 6).gems(1, 4)
    .ground(12, 6).foe(6, "f", 2).gems(2, 3).goal(10);
  return b.level({ id: "sw-2", name: "Hall of Pillars", time: 240, backdrop: "stepwell", powerups: ["feather", "lamp"], grade: "#ffe9cf",
    movers: [{ w: 3, travel: 4.5, period: 5 }] });
}

export function makaraPool(): LevelDef {
  const b = new LevelBuilder(H);
  b.ground(8, 6).start(2).gems(4, 3)
    .ground(6, 6).foe(4, "e")
    .ground(5, 10).power(2)                        // a ledge to climb
    .bridge(3, "Y").ground(5, 10).checkpoint(1)
    .slope(-4).ground(4, 6)
    .ground(26, 6);
  const arena = b.seg;
  b.on(18, "Z");
  for (let r = 6; r < 16; r++) b.at(arena + 25, r, "#");
  // upper ledges with levers: the bells hang over the pool floor beneath each lever
  b.shelf(arena + 5, 10, 4).at(arena + 6, 11, "L");
  b.shelf(arena + 16, 10, 4).at(arena + 17, 11, "K");
  b.ladder(3, 6, 10).ladder(20, 6, 10);
  return b.level({ id: "sw-3", name: "The Makara's Pool", time: 240, backdrop: "stepwell", boss: "makara", powerups: ["bell"], grade: "#d9f2e6" });
}

export function quickDescent(): LevelDef {
  const b = new LevelBuilder(H);
  b.ground(8, 9).start(2).gems(4, 3)
    .slope(-3).ground(8, 6).gems(2, 4).foe(6, "e")
    .ground(4, 6).ground(5, 10).power(2)         // a ledge to climb
    .bridge(3, "Y").ground(6, 10).checkpoint(1)
    .ground(6, 10).on(3, "L").pillar(4, 3, "D")
    .ground(6, 10).gems(1, 4)
    .slope(-4).ground(12, 6).foe(6, "h").gems(2, 3).goal(9);
  return b.level({ id: "sw-q", name: "Quick Descent", time: 90, backdrop: "stepwell", powerups: ["feather"] });
}

export const LEVELS = [upperSteps(), hallOfPillars(), makaraPool()];
export const QUICK = [quickDescent()];
