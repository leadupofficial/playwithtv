/**
 * kitplat/player: one hero's movement for one fixed step: acceleration curves, coyote time, jump buffering,
 * variable jump height, apex hang, slope momentum, one-way drop-through, ladders and ledge grabs. Pure; the
 * world (world.ts) adds everything that touches other things (foes, items, hazards, co-op).
 */
import { type Body, Collider, STEP, newBody } from "./collide";
import { type Feel, launchSpeed } from "./feel";
import { Tile } from "./level";

/** One player's controls for a step. `jumpPressed`/`action` are edges (consumed by the world each step). */
export interface PadInput { x: number; y: number; jump: boolean; jumpPressed: boolean; run: boolean; action: boolean }
export const NO_INPUT: PadInput = { x: 0, y: 0, jump: false, jumpPressed: false, run: false, action: false };

export type MoveState = "ground" | "air" | "climb" | "hang" | "climbup";

/** What a power-up changes about moving (see powerups.ts). */
export interface MoveMods { speed: number; jump: number; airJumps: number; glide: number }
export const NO_MODS: MoveMods = { speed: 1, jump: 1, airJumps: 0, glide: 0 };

export interface Mover {
  body: Body;
  state: MoveState;
  facing: 1 | -1;
  coyote: number;
  buffer: number;
  /** True while a jump's rise can still be cut short by releasing JUMP. */
  jumpHeld: boolean;
  /** Launched by a spring or a bounce: rises at full height whatever JUMP does. */
  launched: boolean;
  airJumpsUsed: number;
  dropT: number;
  /** Time since the ledge grab/climb-up started (hang states). */
  hangT: number;
  ledge: { x: number; y: number } | null;
  noGrabT: number;
  /** Seconds in the air (for landing dust and squash). */
  airT: number;
  /** Fastest fall speed of this airtime (landing squash strength). */
  fallV: number;
}

export interface MoveEvents { jumped: boolean; airJump: boolean; landed: number; bumped: number; wall: number; climbed: boolean }

export function newMover(x: number, y: number): Mover {
  return { body: newBody(x, y, 0.3, 1.15), state: "air", facing: 1, coyote: 0, buffer: 0, jumpHeld: false, launched: false, airJumpsUsed: 0,
    dropT: 0, hangT: 0, ledge: null, noGrabT: 0, airT: 0, fallV: 0 };
}

const ev: MoveEvents = { jumped: false, airJump: false, landed: 0, bumped: -1, wall: -1, climbed: false };

function approach(v: number, target: number, step: number): number {
  return v < target ? Math.min(target, v + step) : Math.max(target, v - step);
}

/** Advances one mover by dt. Returns a shared events object (read it before the next call). */
export function stepMover(m: Mover, inp: PadInput, f: Feel, col: Collider, dt: number, mods: MoveMods = NO_MODS): MoveEvents {
  ev.jumped = ev.airJump = ev.climbed = false;
  ev.landed = 0;
  ev.bumped = ev.wall = -1;
  const b = m.body;
  if (inp.jumpPressed) m.buffer = f.buffer;
  else m.buffer = Math.max(0, m.buffer - dt);
  m.dropT = Math.max(0, m.dropT - dt);
  m.noGrabT = Math.max(0, m.noGrabT - dt);
  if (Math.abs(inp.x) > 0.25) m.facing = inp.x > 0 ? 1 : -1;
  const jumpV = (launchSpeed(f.jumpHeight, f.gravity) + f.gravity * dt * 0.5) * mods.jump; // + half a step: exact peak

  // ---- ladders
  if (m.state !== "climb" && m.state !== "hang" && m.state !== "climbup" && col.onLadder(b) &&
      (inp.y > 0.5 || (inp.y < -0.5 && b.grounded && b.ground === Tile.Ladder))) {
    m.state = "climb";
    b.vx = 0;
  }
  if (m.state === "climb") {
    if (m.buffer > 0) {
      m.buffer = 0;
      m.state = "air";
      b.vy = jumpV * 0.75;
      b.vx = inp.x * f.walk;
      m.jumpHeld = true;
      ev.jumped = true;
    } else {
      const c = Math.floor(b.x);
      b.x += (c + 0.5 - b.x) * Math.min(1, dt * 12);
      b.vy = inp.y * f.climb;
      b.vx = 0;
      ev.climbed = inp.y !== 0;
      if (b.vy > 0) col.moveY(b, b.vy * dt);
      else if (b.vy < 0) {
        const r = col.moveY(b, b.vy * dt, { drop: true });
        if (r.landed && col.tile(c, Math.floor(b.y - 0.05)) !== Tile.Ladder) { m.state = "ground"; return ev; }
      }
      // climbed past the top rung: stand on the ladder's top
      if (b.vy > 0 && col.tile(c, Math.floor(b.y + 0.05)) !== Tile.Ladder && col.tile(c, Math.floor(b.y - 0.05)) === Tile.Ladder) {
        b.y = Math.floor(b.y + 0.05);
        b.vy = 0;
        b.grounded = true;
        b.ground = Tile.Ladder;
        m.state = "ground";
        return ev;
      }
      if (col.onLadder(b) || (inp.y <= 0 && col.tile(c, Math.floor(b.y - 0.1)) === Tile.Ladder)) return ev;
      m.state = "air";
    }
  }

  // ---- ledge hang and climb-up (step-well traversal)
  if (m.state === "hang" || m.state === "climbup") {
    m.hangT += dt;
    b.vx = b.vy = 0;
    const L = m.ledge!;
    if (m.state === "hang") {
      if (inp.y < -0.5) {
        m.state = "air";
        m.noGrabT = 0.35;
      } else if (m.buffer > 0 || inp.y > 0.5 || (Math.sign(inp.x) === m.facing && m.hangT > 0.25)) {
        m.buffer = 0;
        m.state = "climbup";
        m.hangT = 0;
      }
      return ev;
    }
    if (m.hangT >= 0.28) {
      b.x = L.x + m.facing * (b.hw + 0.05);
      b.y = L.y;
      b.grounded = true;
      m.state = "ground";
      ev.climbed = true;
    }
    return ev;
  }

  // ---- horizontal
  const target = inp.x * (inp.run ? f.run : f.walk) * mods.speed;
  const ground = b.grounded;
  let a: number;
  if (ground) {
    if (target === 0) a = f.decel;
    else if (b.vx !== 0 && Math.sign(target) !== Math.sign(b.vx)) a = f.turn;
    else a = f.accel;
  } else a = target === 0 ? f.airAccel * 0.25 : f.airAccel;
  if (Math.abs(b.vx) > Math.abs(target) && Math.sign(b.vx) === Math.sign(target) && target !== 0) {
    b.vx = approach(b.vx, target, f.overDecel * dt); // keep momentum from slopes and boosts, bleed it slowly
  } else b.vx = approach(b.vx, target, a * dt);
  if (ground && f.slopeGravity > 0 && b.slope !== 0) b.vx -= b.slope * f.slopeGravity * dt;
  b.vx = Math.max(-f.maxSpeed, Math.min(f.maxSpeed, b.vx));

  // ---- jumping (buffered press + coyote time), drop-through, double jumps
  if (ground) {
    m.coyote = f.coyote;
    m.airJumpsUsed = 0;
  } else m.coyote = Math.max(0, m.coyote - dt);
  if (m.buffer > 0 && inp.y < -0.5 && ground && (b.ground === Tile.OneWay || b.ground === Tile.Ladder)) {
    m.buffer = 0;
    m.dropT = 0.25;
    b.grounded = false;
    b.y -= 0.02;
  } else if (m.buffer > 0 && (ground || m.coyote > 0)) {
    m.buffer = 0;
    m.coyote = 0;
    b.vy = jumpV + Math.abs(b.vx) * 0.04; // a running jump goes a touch higher
    b.grounded = false;
    b.platform = -1;
    m.jumpHeld = true;
    ev.jumped = true;
  } else if (m.buffer > 0 && !ground && m.airJumpsUsed < mods.airJumps && m.buffer === f.buffer) {
    m.buffer = 0;
    m.airJumpsUsed++;
    b.vy = jumpV * 0.85;
    m.jumpHeld = true;
    ev.jumped = ev.airJump = true;
  }

  // ---- gravity: full rise while JUMP is held, a quick cut when released, heavier fall, apex hang
  if (!b.grounded) {
    if (m.jumpHeld && !inp.jump && b.vy > 0) {
      m.jumpHeld = false;
      b.vy *= 0.55; // released early: a crisp short hop
    }
    if (b.vy <= 0) m.launched = false;
    let g = b.vy > 0 ? (m.jumpHeld || m.launched ? f.gravity : f.cutGravity) : f.fallGravity;
    if (inp.jump && Math.abs(b.vy) < f.apexBand) g *= f.apexMul;
    b.vy -= g * dt;
    if (mods.glide > 0 && inp.jump && b.vy < -mods.glide) b.vy = Math.max(b.vy, -mods.glide);
    if (b.vy < -f.maxFall) b.vy = -f.maxFall;
  }

  // ---- move
  const wasGround = b.grounded;
  ev.wall = col.moveX(b, b.vx * dt);
  if (b.vy > 0) {
    const r = col.moveY(b, b.vy * dt);
    ev.bumped = r.bumped;
    if (r.bumped >= 0) m.jumpHeld = false;
  } else {
    const fallBefore = -b.vy;
    const snap = wasGround ? Math.abs(b.vx * dt) + 0.12 : 0;
    const r = col.moveY(b, b.vy * dt, { drop: m.dropT > 0, snap, climbUp: wasGround ? STEP + Math.abs(b.vx * dt) : 0 });
    if (r.landed && !wasGround) {
      ev.landed = Math.max(m.fallV, fallBefore);
      m.jumpHeld = false;
    }
  }
  if (b.grounded) {
    m.airT = 0;
    m.fallV = 0;
    m.state = "ground";
  } else {
    m.airT += dt;
    m.fallV = Math.max(m.fallV, -b.vy);
    m.state = "air";
    if (f.ledgeGrab && m.noGrabT <= 0 && b.vy <= 1) tryGrab(m, col, inp);
  }
  return ev;
}

/** Catches a ledge in front of the hands: a wall tile with two free tiles above it. */
function tryGrab(m: Mover, col: Collider, inp: PadInput) {
  const b = m.body;
  const dir = Math.abs(inp.x) > 0.25 ? Math.sign(inp.x) : 0;
  if (dir === 0 || dir !== m.facing) return;
  const c = Math.floor(b.x + dir * (b.hw + 0.12));
  const hand = b.y + b.h - 0.05;
  const r = Math.floor(hand);
  const top = r + 1;
  if (top - hand > 0.45 || !col.solidAt(c, r) || col.solidAt(c, r + 1) || col.solidAt(c, r + 2)) return;
  if (col.solidAt(Math.floor(b.x), r + 1)) return; // a ceiling over our head: nothing to climb onto
  m.state = "hang";
  m.hangT = 0;
  m.ledge = { x: dir > 0 ? c : c + 1, y: top };
  b.x = dir > 0 ? c - b.hw - 0.01 : c + 1 + b.hw + 0.01;
  b.y = top - b.h + 0.05;
  b.vx = b.vy = 0;
  m.airJumpsUsed = 0;
}
