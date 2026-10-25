/**
 * LANTERN LANE levels: a festival night, classic co-op platforming. Bamboo bridges strung with marigolds, gift
 * boxes to bump for gems, ladders up to the lantern-lit roofs, kites and sparklers to find, a pond with rafts,
 * and the Grumble Puppet in the square at the end.
 */
import { LevelBuilder } from "../kitplat/builder";
import type { LevelDef } from "../kitplat/level";

const H = 16;

export function lanternLane(): LevelDef {
  const b = new LevelBuilder(H);
  b.ground(10, 3).start(2).gems(5, 3).on(7, "X", 3)
    .ground(8, 3).foe(5, "e").on(2, "X", 3).on(3, "X", 3)
    .pit(2).arc(0, 3, 2, 1)
    .ground(12, 3).power(3).foe(9, "h").gems(5, 3, 4)
    .bridge(6).gems(1, 4)
    .ground(8, 3).foe(4, "e");
  const lad = b.seg;
  b.ladder(6, 3, 7).shelf(lad + 7, 7, 6);
  for (let i = 0; i < 5; i++) b.at(lad + 7 + i, 8, "o");
  b.slope(2).ground(10, 5).checkpoint(2).foe(7, "f", 2)
    .pit(3).arc(0, 5, 3, 1)
    .ground(12, 4).on(3, "X", 3).on(4, "X", 3).foe(8, "k")
    .ground(6, 4).spring(3).arc(3, 4, 6, 3)
    .pit(2).ground(8, 6).power(2).gems(4, 3)
    .slope(-3).ground(12, 3).foe(4, "e").foe(9, "h").checkpoint(1)
    .bridge(5).foe(2, "f", 3)
    .ground(10, 3).on(4, "X", 3).gems(6, 3)
    .pit(3).arc(0, 4, 2, 1)
    .ground(14, 3).gems(1, 4).goal(11);
  return b.level({ id: "ll-1", name: "Lantern Lane", time: 200, backdrop: "festival", powerups: ["sparkler", "kite"] });
}

export function kiteHill(): LevelDef {
  const b = new LevelBuilder(H);
  b.ground(8, 3).start(2).gems(4, 3)
    .slope(2).ground(6, 5).foe(3, "e")
    .slope(2).ground(8, 7).power(2).foe(6, "h")
    .pit(3).ground(6, 7).on(2, "X", 3)
    .slope(-3).ground(6, 4).checkpoint(2);
  const pond = b.x;
  b.water(10, 1).ground(8, 4).foe(5, "k").gems(2, 3);
  b.at(pond + 1, 3, "M");
  for (let i = 0; i < 6; i++) b.at(pond + 2 + i, 6, "o");
  b.ground(6, 4);
  const lad = b.seg;
  b.ladder(4, 4, 9).shelf(lad + 5, 9, 6);
  for (let i = 0; i < 5; i++) b.at(lad + 5 + i, 10, "o");
  b.ground(6, 4).foe(3, "f", 3)
    .slope(3).ground(10, 7).checkpoint(1).foe(6, "e").on(4, "X", 3)
    .pit(2).ground(4, 7).spring(2).arc(2, 4, 6, 3)
    .pit(3).ground(10, 8).power(3).foe(7, "h")
    .slope(-4).ground(8, 4).foe(4, "k");
  const pond2 = b.x;
  b.water(9, 1).ground(14, 4).gems(2, 5).foe(9, "e").goal(12);
  b.at(pond2 + 1, 3, "M");
  return b.level({ id: "ll-2", name: "Kite Hill", time: 210, backdrop: "festival", powerups: ["kite", "lantern"], grade: "#e8dcff",
    movers: [{ w: 3, travel: 6, period: 5 }, { w: 3, travel: 5, period: 4.5 }] });
}

export function puppetSquare(): LevelDef {
  const b = new LevelBuilder(H);
  b.ground(10, 3).start(2).gems(4, 4)
    .ground(8, 3).foe(5, "e").on(3, "X", 3)
    .pit(2).ground(8, 3).power(3).checkpoint(6)
    .ground(26, 3);
  const arena = b.seg;
  b.on(18, "Z");
  for (let r = 3; r < 13; r++) b.at(arena + 25, r, "#");
  b.shelf(arena + 4, 6, 3).shelf(arena + 11, 7, 3).shelf(arena + 18, 6, 3);
  return b.level({ id: "ll-3", name: "The Grumble Puppet", time: 220, backdrop: "festival", boss: "puppet", powerups: ["sparkler"], grade: "#ffd6e8" });
}

export function festivalDash(): LevelDef {
  const b = new LevelBuilder(H);
  b.ground(10, 3).start(2).power(5).gems(7, 3)
    .ground(8, 3).foe(6, "e").on(3, "X", 3)
    .pit(2).arc(0, 3, 2, 1)
    .ground(10, 3).gems(3, 4)
    .bridge(4)
    .ground(6, 3).spring(3).arc(3, 4, 6, 3)
    .ground(6, 3).checkpoint(1)
    .pit(2).ground(12, 3).foe(6, "h").gems(2, 3)
    .ground(10, 3).goal(6);
  return b.level({ id: "ll-q", name: "Festival Dash", time: 80, backdrop: "festival", powerups: ["sparkler"] });
}

export const LEVELS = [lanternLane(), kiteHill(), puppetSquare()];
export const QUICK = [festivalDash()];
