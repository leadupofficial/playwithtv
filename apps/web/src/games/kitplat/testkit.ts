/**
 * kitplat/testkit: shared checks every kitplat game runs on its own levels in Vitest: every level validates
 * (reachable goal and checkpoints, budgets), and simple bots finish the quick level in time, so the e2e test
 * (phones holding ▶ and tapping JUMP) can reach the results.
 */
import { DT } from "./feel";
import { NO_INPUT, type PadInput } from "./player";
import type { GameSpec, Mode, World } from "./types";
import { validateLevel } from "./validate";
import { createWorld, stepWorld } from "./world";

export function validateAll(spec: GameSpec) {
  return [...spec.levels, ...spec.quick].map((l) => validateLevel(l, spec.feel));
}

/** The phone bot of the e2e tests: hold right (+RUN), press JUMP every `period` seconds, hold it `hold` seconds. */
export function runBot(spec: GameSpec, levelIdx: number, quick: boolean, players = 2, mode: Mode = spec.modes[0]!, period = 0.45, hold = 0.3, maxS = 200, phase = 0): World {
  const def = (quick ? spec.quick : spec.levels)[levelIdx]!;
  const w = createWorld(spec, def, Array.from({ length: players }, (_, i) => `p${i}`), mode, 99);
  const inputs: PadInput[] = w.heroes.map(() => ({ ...NO_INPUT }));
  let t = phase;
  for (let i = 0; i < maxS / DT && !w.done; i++) {
    t += DT;
    w.heroes.forEach((h, k) => {
      const p = inputs[k]!;
      const tt = t + k * 0.13;
      const cyc = tt % period;
      p.x = 1;
      p.run = true;
      p.jumpPressed = cyc < DT;
      p.jump = cyc < hold;
      p.action = Math.floor(tt * 3) % 4 === 0 && cyc < DT;
      void h;
    });
    stepWorld(w, inputs, DT);
  }
  return w;
}

/**
 * Plays a game's boss level with heroes that wait beside the arena and drop onto the boss whenever it is
 * vulnerable (the way players learn to): returns the world when the boss is down and the level cleared, or at
 * the time limit.
 */
export function fightBoss(spec: GameSpec, levelIdx: number, maxS = 240): World {
  const def = spec.levels[levelIdx]!;
  const w = createWorld(spec, def, ["p0", "p1"], "coop", 5);
  const inputs: PadInput[] = w.heroes.map(() => ({ ...NO_INPUT }));
  for (let i = 0; i < maxS / DT && !w.done; i++) {
    const b = w.boss!;
    for (const h of w.heroes) {
      if (h.down) continue;
      h.inv = Math.max(h.inv, 0.5); // the test is about the boss pattern, not dodging
      if (!b.awake && !b.dead) { h.body.x = b.arena[0] + 3; h.body.y = b.floorY; }
      else if (!b.dead && h.body.grounded && b.hurtT <= 0 && (b.def.pattern.some((m) => m.vulnerable) ? bossOpen(w) : true)) {
        h.body.x = b.body.x;
        h.body.y = b.body.y + b.body.h + 1.2;
        h.body.vy = -1;
        h.body.grounded = false;
      }
    }
    stepWorld(w, inputs, DT);
  }
  return w;
}

function bossOpen(w: World): boolean {
  const b = w.boss!;
  const list = b.hp * 2 <= b.def.hp && b.def.angry ? b.def.angry : b.def.pattern;
  return list[b.move % list.length]!.vulnerable === true;
}
