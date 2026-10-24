/**
 * CPU wrestlers: stay away from the edge, pick a victim (someone near the edge and near me), get between them
 * and the centre, then shove outwards. They brace when someone charges at them near the rope. A short
 * "think" interval keeps them beatable. Deterministic: randomness comes from the wrestler's own seed.
 */
import { RING_X, RING_Y, type Bout, type SumoInput, type Wrestler } from "./engine";

function next(w: Wrestler) {
  w.aiSeed = (Math.imul(w.aiSeed, 1103515245) + 12345) >>> 0;
  return w.aiSeed / 4294967296;
}

export function cpuInput(b: Bout, w: Wrestler, dt: number): SumoInput {
  const o = w.ai;
  o.shove = false;
  o.braceTap = false;
  w.aiThink -= dt;
  const cx = w.x - RING_X, cy = w.y - RING_Y;
  const fromCentre = Math.hypot(cx, cy);
  // danger: an opponent dashing at me while I'm near the edge → brace
  let threat = false;
  for (const x of b.wrestlers) {
    if (x === w || x.out || x.dashT <= 0) continue;
    const dx = w.x - x.x, dy = w.y - x.y, d = Math.hypot(dx, dy);
    if (d < 130 && (x.vx * dx + x.vy * dy) / (d * Math.hypot(x.vx, x.vy) + 1e-6) > 0.7) threat = true;
  }
  o.brace = threat && fromCentre > b.ring * 0.55 && w.stamina > 25 && next(w) < 0.5;
  if (w.aiThink > 0) return o;
  w.aiThink = 0.25 + next(w) * 0.3;
  // too close to the edge: walk back in
  if (fromCentre > b.ring - 70) {
    o.x = -cx / fromCentre;
    o.y = cy / fromCentre; // input y is up
    return o;
  }
  // choose a victim: near the edge and near me
  let target: Wrestler | null = null, best = -Infinity;
  for (const x of b.wrestlers) {
    if (x === w || x.out) continue;
    const edge = Math.hypot(x.x - RING_X, x.y - RING_Y) / b.ring;
    const near = Math.hypot(x.x - w.x, x.y - w.y);
    const score = edge * 1.2 - near / 500 + (x.cpu ? 0 : 0.1) + next(w) * 0.3;
    if (score > best) { best = score; target = x; }
  }
  if (!target) { o.x = 0; o.y = 0; return o; }
  // approach from the centre side, then shove outwards through them
  const tx = target.x - RING_X, ty = target.y - RING_Y, td = Math.hypot(tx, ty) || 1;
  const ax = target.x - (tx / td) * 70, ay = target.y - (ty / td) * 70;
  const toT = Math.hypot(target.x - w.x, target.y - w.y);
  const gx = (toT < 150 ? target.x : ax) - w.x, gy = (toT < 150 ? target.y : ay) - w.y, gd = Math.hypot(gx, gy) || 1;
  o.x = gx / gd;
  o.y = -gy / gd;
  const aligned = ((target.x - w.x) * tx + (target.y - w.y) * ty) / (toT * td + 1e-6) > 0.2;
  if (toT < 125 && w.cooldown <= 0 && w.stamina >= 30 && (aligned || next(w) < 0.2) && next(w) < 0.55) {
    o.shove = true;
    o.x = (target.x - w.x) / toT;
    o.y = -(target.y - w.y) / toT;
  }
  return o;
}
