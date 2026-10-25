/**
 * kitplat/anim: which clip and frame a hero, foe or boss shows, plus squash-and-stretch. Pure (tested); the view
 * keeps one AnimState per character so run cycles advance with speed instead of the clock.
 */
import type { Boss } from "./boss";
import type { Foe } from "./foes";
import type { Hero } from "./types";

export interface AnimState { clip: string; phase: number; t: number }
export interface Pose { clip: string; t: number; sx: number; sy: number; rot: number; flipX: boolean; alpha: number }

export function newAnim(): AnimState {
  return { clip: "idle", phase: 0, t: 0 };
}

const pose: Pose = { clip: "idle", t: 0, sx: 1, sy: 1, rot: 0, flipX: false, alpha: 1 };

/** The hero's pose this frame. `walk` is the feel's walking speed (run cycles scale with it). Returns a shared object. */
export function heroPose(h: Hero, a: AnimState, dt: number, time: number, walk: number): Pose {
  const b = h.body;
  let clip: string;
  let rate = 1;
  if (h.loop) clip = "run";
  else if (h.finished) clip = "victory";
  else if (h.hurtT > 0) clip = "hurt";
  else if (h.state === "climb") { clip = "climb"; rate = b.vy === 0 ? 0 : 1; }
  else if (h.state === "hang" || h.state === "climbup") clip = "hang";
  else if (h.flipT > 0 && !b.grounded) clip = "flip";
  else if (!b.grounded) clip = b.vy > 1.5 ? "jump" : "fall";
  else if (Math.abs(b.vx) < 0.4) clip = "idle";
  else if (Math.sign(b.vx) !== h.facing && Math.abs(b.vx) > 2.5) clip = "skid";
  else { clip = "run"; rate = Math.max(0.6, Math.abs(b.vx) / walk); }
  if (clip !== a.clip) { a.clip = clip; a.t = 0; }
  a.t += dt * rate;
  pose.clip = clip;
  pose.t = a.t;
  pose.rot = h.loop ? h.loop.a + Math.PI / 2 : 0;
  pose.flipX = h.facing < 0;
  // squash on landing, stretch on take-off
  let sx = 1, sy = 1;
  if (h.landT < 0.16 && b.grounded) {
    const k = Math.min(0.32, h.landV / 45) * (1 - h.landT / 0.16);
    sy = 1 - k;
    sx = 1 + k * 0.8;
  } else if (!b.grounded && b.vy > 8) {
    sy = 1.1;
    sx = 0.92;
  }
  pose.sx = sx;
  pose.sy = sy;
  pose.alpha = h.inv > 0 && Math.floor(time * 12) % 2 === 0 ? 0.35 : 1;
  return pose;
}

/** A foe's sprite id suffix and pose. */
export function foePose(f: Foe, time: number): Pose {
  pose.rot = 0;
  pose.sx = pose.sy = 1;
  pose.alpha = 1;
  pose.flipX = f.dir < 0;
  pose.t = time + f.id * 0.31;
  switch (f.kind) {
    case "walker": pose.clip = f.state === "dead" ? "walker-squash" : "walker-walk"; break;
    case "hopper": pose.clip = f.state === "hop" ? "hopper-jump" : "hopper-idle"; if (f.state === "hop") pose.t = f.t; break;
    case "flyer": pose.clip = "flyer-fly"; break;
    case "curler": pose.clip = f.state === "ball" || f.state === "roll" ? "curler-ball" : "curler-walk"; if (f.state === "ball") pose.t = 0; break;
  }
  if (f.state === "dead") {
    const k = Math.min(1, f.deadT / 0.5);
    pose.alpha = 1 - k;
    if (f.kind !== "walker") { pose.sy = 1 - 0.6 * k; pose.sx = 1 + 0.3 * k; }
    if (f.kind === "flyer" || f.kind === "hopper") pose.rot = Math.PI * k;
  }
  return pose;
}

export function bossPose(b: Boss, time: number, vulnerable: boolean): Pose {
  pose.rot = 0;
  pose.sx = pose.sy = 1;
  pose.alpha = b.hurtT > 0 && Math.floor(time * 14) % 2 === 0 ? 0.5 : 1;
  pose.flipX = b.dir < 0;
  pose.t = time;
  const kind = b.dead ? "hurt" : b.hurtT > 0 ? "hurt" : vulnerable ? "dizzy" : null;
  if (kind) pose.clip = `boss-${kind}`;
  else {
    const mv = b.def.pattern.length ? (b.hp * 2 <= b.def.hp && b.def.angry ? b.def.angry : b.def.pattern)[b.move % (b.hp * 2 <= b.def.hp && b.def.angry ? b.def.angry : b.def.pattern).length]! : null;
    pose.clip = !mv || !b.awake ? "boss-idle" : mv.kind === "walk" || mv.kind === "swoop" || (mv.kind === "charge" && !b.telegraph) || mv.kind === "hop" ? "boss-move" : mv.kind === "rest" ? "boss-idle" : "boss-attack";
    if (b.telegraph) pose.sx = 1 + 0.04 * Math.sin(time * 60);
  }
  if (b.dead) {
    const k = Math.min(1, b.deadT / 1.5);
    pose.alpha = 1 - k * 0.9;
    pose.rot = (b.dir < 0 ? -1 : 1) * k * 0.6;
  }
  return pose;
}
