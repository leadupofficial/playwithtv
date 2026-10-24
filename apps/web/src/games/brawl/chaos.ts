/**
 * Mid-round chaos (the bed bounces, the lights go down to a nightlight, a pillow avalanche) and the hazards
 * ghosts drop (feather piles slow you down, socks make you slip). Pure and seeded.
 */
import { HX, HZ, rand, type BrawlEvent, type ChaosKind, type Fighter, type Match } from "./rules";

export const CHAOS_DUR: Record<ChaosKind, number> = { bounce: 2.2, nightlight: 7, avalanche: 5 };
const KINDS: ChaosKind[] = ["bounce", "avalanche", "nightlight"];
export const FEATHER_R = 1.3, SOCK_R = 0.65, DROP_R = 1.15, DROP_FALL = 0.9;

/** Seconds into a round until the next chaos event. */
export function chaosGap(m: Match): number {
  return 13 + rand(m) * 7;
}

function startChaos(m: Match, ev: BrawlEvent[]) {
  const options = KINDS.filter((k) => k !== m.lastChaos);
  const kind = options[Math.floor(rand(m) * options.length)] ?? "bounce";
  m.chaos = { kind, t: 0, dur: CHAOS_DUR[kind], n: 0 };
  m.lastChaos = kind;
  ev.push({ kind: "chaos", chaos: kind });
}

function bounce(m: Match, ev: BrawlEvent[]) {
  for (const f of m.fighters) {
    if (!f.alive || f.y > 0.05) continue;
    f.vy = 8.5 + rand(m) * 2.5;
    const a = rand(m) * Math.PI * 2;
    f.vx += Math.sin(a) * 2.4;
    f.vz += Math.cos(a) * 2.4;
    f.charge = 0;
    if (f.state === "charge") { f.state = "ok"; f.t = 0; }
  }
  ev.push({ kind: "bounce" });
}

function spawnDrop(m: Match) {
  // half the pillows aim at someone, so standing still is not safe
  const alive = m.fighters.filter((f) => f.alive);
  let x: number, z: number;
  if (alive.length && rand(m) < 0.5) {
    const f = alive[Math.floor(rand(m) * alive.length)]!;
    x = f.x + (rand(m) - 0.5) * 1.6;
    z = f.z + (rand(m) - 0.5) * 1.6;
  } else {
    x = (rand(m) * 2 - 1) * (HX - 0.8);
    z = (rand(m) * 2 - 1) * (HZ - 0.8);
  }
  m.drops.push({ id: m.nextId++, x, z, t: DROP_FALL });
}

function landDrop(m: Match, x: number, z: number, ev: BrawlEvent[]) {
  const hits: string[] = [];
  for (const f of m.fighters) {
    if (!f.alive || f.state === "dodge") continue;
    const dx = f.x - x, dz = f.z - z;
    const d = Math.hypot(dx, dz);
    if (d > DROP_R) continue;
    const nx = d > 1e-3 ? dx / d : 1, nz = d > 1e-3 ? dz / d : 0;
    const kb = 8 * (1 + f.damage / 120);
    f.vx = nx * kb;
    f.vz = nz * kb;
    f.vy = 4;
    f.damage += 6;
    f.stun = 0.35;
    f.charge = 0;
    f.state = "hit";
    f.t = 0;
    hits.push(f.id);
  }
  ev.push({ kind: "drop-land", x, z, hits });
}

/** Runs the chaos timer and the current chaos event. `elapsed` = seconds since the round started. */
export function updateChaos(m: Match, elapsed: number, dt: number, ev: BrawlEvent[]) {
  if (!m.chaos) {
    if (elapsed >= m.nextChaos && m.roundLeft > 6) startChaos(m, ev);
  } else {
    const c = m.chaos;
    c.t += dt;
    if (c.kind === "bounce" && c.t >= c.n * 0.7 && c.n < 3) {
      c.n++;
      bounce(m, ev);
    }
    if (c.kind === "avalanche" && c.t >= c.n * 0.32 && c.t < c.dur - 1) {
      c.n++;
      spawnDrop(m);
    }
    if (c.t >= c.dur) {
      m.chaos = null;
      m.nextChaos = elapsed + chaosGap(m);
    }
  }
  for (const d of m.drops) {
    d.t -= dt;
    if (d.t <= 0) landDrop(m, d.x, d.z, ev);
  }
  m.drops = m.drops.filter((d) => d.t > 0);
}

/** Feathers slow anyone standing in them; a sock sends the first fighter to step on it skidding. */
export function updateHazards(m: Match, dt: number, ev: BrawlEvent[]) {
  for (const h of m.hazards) h.age += dt;
  m.hazards = m.hazards.filter((h) => h.age < h.life);
  for (const f of m.fighters) {
    if (!f.alive || f.y > 0.1 || f.state === "dodge") continue;
    for (const h of m.hazards) {
      const d = Math.hypot(f.x - h.x, f.z - h.z);
      if (h.kind === "feathers" && d < FEATHER_R) f.slowed = 0.15;
      if (h.kind === "sock" && h.life > 0 && d < SOCK_R && h.age > 0.4) {
        slip(m, f, h.by, ev, h.x, h.z);
        h.life = 0;
      }
    }
  }
  m.hazards = m.hazards.filter((h) => h.age < h.life);
}

function slip(m: Match, f: Fighter, by: string, ev: BrawlEvent[], x: number, z: number) {
  const sp = Math.hypot(f.vx, f.vz);
  const a = sp > 0.5 ? Math.atan2(f.vx, f.vz) : rand(m) * Math.PI * 2;
  const turn = (rand(m) - 0.5) * 1.2;
  f.vx = Math.sin(a + turn) * 9;
  f.vz = Math.cos(a + turn) * 9;
  f.vy = 3;
  f.stun = 0.55;
  f.charge = 0;
  f.state = "hit";
  f.t = 0;
  f.lastHitBy = by;
  f.lastHitAt = m.time;
  const g = m.fighters.find((o) => o.id === by);
  if (g) g.stats.slipsCaused++;
  ev.push({ kind: "slip", id: f.id, by, x, z });
}
