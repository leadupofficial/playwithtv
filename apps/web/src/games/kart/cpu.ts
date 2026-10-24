/**
 * CPU drivers for Kart Knockout (also drives karts that have finished, for their victory lap). Each CPU follows
 * the centre line a little ahead on its own lane, eases off for sharp corners, drifts through long bends and
 * uses its items after a short think. Deterministic: randomness comes from the kart's own seed.
 */
import { pointAt, type Track } from "./track";
import { VMAX, type Kart, type KartInput, type Race } from "./engine";

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

function next(k: Kart) {
  k.aiSeed = (Math.imul(k.aiSeed, 1103515245) + 12345) >>> 0;
  return k.aiSeed / 4294967296;
}

/** Heading change of the road between two arc lengths (how sharp the coming bend is). */
export function bendAhead(t: Track, s: number, ahead: number) {
  const a = pointAt(t, s).a, b = pointAt(t, s + ahead).a;
  return wrap(b - a);
}

/** Signed angle (radians, + = turn right) from the kart's heading to a point `look` px ahead on its lane. */
export function aimError(r: Race, k: Kart, lane = 0) {
  const t = r.track;
  const f = Math.hypot(k.vx, k.vy);
  const look = 46 + f * 0.28;
  const p = pointAt(t, t.s[k.idx]! + look, lane * t.hw);
  return wrap(Math.atan2(p.y - k.y, p.x - k.x) - k.a);
}

export function drive(r: Race, k: Kart): KartInput {
  const t = r.track;
  const o = k.ai;
  const lane = ((k.slot % 3) - 1) * 0.32;
  const err = aimError(r, k, lane);
  const speed = Math.hypot(k.vx, k.vy);
  const bend = bendAhead(t, t.s[k.idx]!, 110);
  o.steer = Math.max(-1, Math.min(1, err * 2.6));
  // ease off for a hairpin unless drifting through it
  o.gas = !((Math.abs(err) > 0.9 && speed > 90) || (Math.abs(bend) > 1.4 && speed > VMAX * 0.8 && !k.drift));
  // drift through long bends in the direction of the bend
  if (k.drift) o.drift = Math.abs(bend) > 0.35 && Math.sign(bend) === k.drift && k.driftT < 2.2;
  else o.drift = Math.abs(bend) > 0.8 && speed > VMAX * 0.6 && Math.sign(o.steer) === Math.sign(bend) && next(k) < 0.25;
  // items: think for a moment, then use (a slick is best dropped when someone is close behind)
  o.item = false;
  if (k.item && k.rollT <= 0 && next(k) < 1 / 90) {
    if (k.item === "puddle") {
      const behind = r.karts.some((x) => x !== k && x.dist < k.dist && k.dist - x.dist < 140);
      o.item = behind || next(k) < 0.2;
    } else if (k.item === "zoom" || k.item === "triple") o.item = Math.abs(bend) < 0.5;
    else o.item = true;
  }
  return o;
}
