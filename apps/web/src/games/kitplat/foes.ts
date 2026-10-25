/**
 * kitplat/foes: simple enemy behaviours, all stompable.
 *   walker   paces, turning at walls and ledges
 *   hopper   waits, then hops towards the nearest hero
 *   flyer    drifts in a slow figure-of-eight around its home, ignoring walls
 *   curler   paces; stomp it and it curls into a ball; touch the ball to kick it, and the rolling ball bowls over
 *            other foes (and bumps heroes other than the kicker); stomp the rolling ball to stop it
 */
import { type Body, Collider, newBody } from "./collide";
import { Tile } from "./level";

export type FoeKind = "walker" | "hopper" | "flyer" | "curler";
export type FoeState = "move" | "wait" | "hop" | "ball" | "roll" | "dead";

export interface Foe {
  id: number;
  kind: FoeKind;
  body: Body;
  dir: 1 | -1;
  state: FoeState;
  t: number;
  home: { x: number; y: number };
  /** Seconds since death (the view plays the squash/pop), or since the ball stopped. */
  deadT: number;
  /** Hero slot that kicked the ball, and the grace time it cannot hit that hero. */
  kicker: number;
  grace: number;
}

const SIZE: Record<FoeKind, [number, number]> = { walker: [0.38, 0.8], hopper: [0.34, 0.72], flyer: [0.4, 0.6], curler: [0.4, 0.78] };
export const FOE_SPEED = { walker: 1.7, curler: 1.3, roll: 11, hop: 10.5 };
const G = 60;

export function newFoe(id: number, kind: FoeKind, x: number, y: number): Foe {
  const [hw, h] = SIZE[kind];
  return { id, kind, body: newBody(x, y + (kind === "flyer" ? 1 : 0), hw, h), dir: -1, state: kind === "hopper" ? "wait" : "move",
    t: (id * 0.37) % 1.5, home: { x, y: y + (kind === "flyer" ? 1 : 0) }, deadT: 0, kicker: -1, grace: 0 };
}

/** Is there floor right in front of the foe's feet? */
function floorAhead(col: Collider, b: Body, dir: number): boolean {
  const c = Math.floor(b.x + dir * (b.hw + 0.1));
  const r = Math.floor(b.y - 0.1);
  const t = col.tile(c, r);
  return col.wall(t) || t === Tile.OneWay || t === Tile.SlopeUp || t === Tile.SlopeDown || col.tile(c, r + 1) === Tile.SlopeUp || col.tile(c, r + 1) === Tile.SlopeDown;
}

function fall(col: Collider, b: Body, dt: number) {
  b.vy = Math.max(-18, b.vy - G * dt);
  col.moveY(b, b.vy * dt, { snap: b.grounded ? 0.15 : 0, climbUp: b.grounded ? 0.45 : 0 });
}

/** Advances a foe; `targetX` is the nearest hero's x (hoppers aim at it), NaN if none. */
export function stepFoe(f: Foe, col: Collider, dt: number, targetX: number) {
  const b = f.body;
  f.t += dt;
  f.grace = Math.max(0, f.grace - dt);
  if (f.state === "dead") {
    f.deadT += dt;
    return;
  }
  switch (f.kind) {
    case "flyer": {
      const px = f.home.x + Math.sin(f.t * 0.8) * 3;
      const py = f.home.y + Math.sin(f.t * 1.6) * 0.7;
      const nd = px > b.x ? 1 : -1;
      if (Math.abs(px - b.x) > 0.01) f.dir = nd;
      b.vx = (px - b.x) / dt;
      b.x = px;
      b.y = py;
      return;
    }
    case "hopper": {
      if (f.state === "wait") {
        b.vx = 0;
        fall(col, b, dt);
        if (f.t > 1.4 && b.grounded) {
          f.state = "hop";
          f.t = 0;
          if (!Number.isNaN(targetX) && Math.abs(targetX - b.x) < 12) f.dir = targetX > b.x ? 1 : -1;
          b.vy = FOE_SPEED.hop;
          b.vx = f.dir * 3;
          b.grounded = false;
        }
      } else {
        if (col.moveX(b, b.vx * dt) >= 0) f.dir = (f.dir * -1) as 1 | -1;
        fall(col, b, dt);
        if (b.grounded && f.t > 0.1) {
          f.state = "wait";
          f.t = 0;
        }
      }
      return;
    }
    default: {
      if (f.state === "ball") {
        b.vx = 0;
        f.deadT += dt;
        fall(col, b, dt);
        return;
      }
      const speed = f.state === "roll" ? FOE_SPEED.roll : f.kind === "walker" ? FOE_SPEED.walker : FOE_SPEED.curler;
      b.vx = f.dir * speed;
      if (col.moveX(b, b.vx * dt) >= 0) f.dir = (f.dir * -1) as 1 | -1;
      else if (f.state !== "roll" && b.grounded && !floorAhead(col, b, f.dir)) f.dir = (f.dir * -1) as 1 | -1;
      fall(col, b, dt);
    }
  }
}

/** Curler stomped: curl into a ball (shorter body). */
export function curl(f: Foe) {
  f.state = "ball";
  f.deadT = 0;
  f.grace = 0.3;
  f.body.h = 0.6;
  f.body.vx = 0;
}

/** A hero touched the ball: kick it away from them. */
export function kick(f: Foe, fromX: number, slot: number) {
  f.state = "roll";
  f.dir = f.body.x >= fromX ? 1 : -1;
  f.kicker = slot;
  f.grace = 0.45;
}

export function kill(f: Foe) {
  f.state = "dead";
  f.deadT = 0;
  f.body.vx = 0;
}

/** Overlap of two bodies' boxes. */
export function overlaps(a: Body, b: Body, shrink = 0.08): boolean {
  return Math.abs(a.x - b.x) < a.hw + b.hw - shrink && a.y < b.y + b.h - shrink && b.y < a.y + a.h - shrink;
}
