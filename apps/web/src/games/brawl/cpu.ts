/**
 * CPU fighters: walk up to someone (preferring whoever stands near an edge), charge a swing that is bigger
 * when the target is close to falling off, stay away from the edges themselves, and sometimes dodge a
 * telegraphed smash. As ghosts they float over a fighter and drop a sock or feathers. Seeded, so tests replay.
 */
import { HX, HZ, IDLE, angleDiff, edgeDistance, rand, type BrawlInput, type Fighter, type Match } from "./rules";
import { windupTime } from "./combat";

export interface Brain {
  target: string | null;
  think: number;
  /** Charge to build before letting go (0..1). */
  plan: number;
  wander: number;
}

export const newBrain = (): Brain => ({ target: null, think: 0, plan: 0.4, wander: 0 });

function pickTarget(m: Match, f: Fighter): Fighter | null {
  let best: Fighter | null = null, bestScore = Infinity;
  for (const o of m.fighters) {
    if (o === f || !o.alive) continue;
    const d = Math.hypot(o.x - f.x, o.z - f.z);
    const s = d - 2.2 * Math.max(0, 2 - edgeDistance(o.x, o.z)) - o.damage / 60;
    if (s < bestScore) { bestScore = s; best = o; }
  }
  return best;
}

/** This step's controls for a CPU fighter. `skill` 0..1 scales reactions and aim. */
export function cpuInput(m: Match, f: Fighter, brain: Brain, dt: number, skill = 0.6): BrawlInput {
  if (m.phase !== "fight") return IDLE;
  const inp: BrawlInput = { x: 0, z: 0, charge: false, swing: 0, dodge: false };
  brain.think -= dt;

  if (!f.alive) {
    if (f.state !== "ghost") return IDLE;
    const prey = pickTarget(m, f);
    if (!prey) return IDLE;
    const dx = prey.x + prey.vx * 0.6 - f.x, dz = prey.z + prey.vz * 0.6 - f.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.4) { inp.x = (dx / d) * 0.8; inp.z = (dz / d) * 0.8; }
    if (d < 1.2 && f.ghostCd === 0 && rand(m) < 0.05) inp.swing = 0.5;
    return inp;
  }

  if (brain.think <= 0 || !m.fighters.find((o) => o.id === brain.target)?.alive) {
    brain.think = 0.25 + (1 - skill) * 0.35 + rand(m) * 0.2;
    brain.target = pickTarget(m, f)?.id ?? null;
    brain.wander = (rand(m) - 0.5) * 1.2;
  }
  const t = m.fighters.find((o) => o.id === brain.target);
  let mx = 0, mz = 0;
  if (t) {
    const dx = t.x - f.x, dz = t.z - f.z;
    const d = Math.hypot(dx, dz);
    const want = 1.35;
    if (d > want) { mx = dx / d; mz = dz / d; }
    else if (d < 0.9) { mx = -dx / d * 0.4; mz = -dz / d * 0.4; }
    // circle a little so CPUs do not just walk in straight lines
    mx += (-dz / Math.max(d, 0.1)) * brain.wander * 0.4;
    mz += (dx / Math.max(d, 0.1)) * brain.wander * 0.4;
    // aim: face the target while charging
    const aim = Math.abs(angleDiff(Math.atan2(dx, dz), f.face));
    if (f.state === "ok" && d < 2.1 && aim < 0.9 && f.cooldown === 0 && rand(m) < 0.06 + 0.08 * skill) {
      const edge = edgeDistance(t.x, t.z);
      brain.plan = Math.min(1, 0.15 + rand(m) * 0.5 + (edge < 1.8 ? 0.35 : 0) + t.damage / 300);
      inp.charge = true;
    }
    if (f.state === "charge") {
      inp.charge = f.charge < brain.plan && d < 3;
      if (d > 0.3) { mx = dx / d * 0.6; mz = dz / d * 0.6; }
    }
    // dodge a smash being wound up right next to us
    for (const o of m.fighters) {
      if (o === f || !o.alive) continue;
      const od = Math.hypot(o.x - f.x, o.z - f.z);
      const winding = (o.state === "charge" && o.charge > 0.5) || (o.state === "windup" && o.t < windupTime(o.power) * 0.6 && o.power > 0.5);
      if (winding && od < 2.2 && f.dodgeCd === 0 && rand(m) < 0.02 + 0.05 * skill) {
        inp.dodge = true;
        mx = (f.z - o.z) / Math.max(od, 0.1); // sideways
        mz = -(f.x - o.x) / Math.max(od, 0.1);
      }
    }
  }
  // stay on the bed: steer back towards the middle near an edge
  const edge = edgeDistance(f.x, f.z);
  if (edge < 1.3) {
    const back = (1.3 - edge) / 1.3;
    const cx = -f.x / HX, cz = -f.z / HZ;
    const cl = Math.hypot(cx, cz) || 1;
    mx = mx * (1 - back) + (cx / cl) * back * 1.4;
    mz = mz * (1 - back) + (cz / cl) * back * 1.4;
  }
  const l = Math.hypot(mx, mz);
  inp.x = l > 1 ? mx / l : mx;
  inp.z = l > 1 ? mz / l : mz;
  return inp;
}
