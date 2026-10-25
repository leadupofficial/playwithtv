/**
 * kitplat/feel: the numbers that make a platformer feel tight, one object per game. Units: tiles and seconds.
 * Tuned at 60 steps a second (DT). Every game starts from FEEL_CLASSIC and overrides what makes it different.
 */
export const DT = 1 / 60;

export interface Feel {
  /** Top speeds on flat ground (tiles/s): walking, holding RUN, and the cap slopes and boosts may push you to. */
  walk: number;
  run: number;
  maxSpeed: number;
  /** Ground acceleration, deceleration with no input, and the extra bite when reversing (tiles/s²). */
  accel: number;
  decel: number;
  turn: number;
  /** Air control (tiles/s²) and how fast extra speed above the target bleeds off (tiles/s²). */
  airAccel: number;
  overDecel: number;
  /** Gravity rising with JUMP held, rising after release (short hop), and falling (tiles/s²). */
  gravity: number;
  cutGravity: number;
  fallGravity: number;
  maxFall: number;
  /** Near the apex (|vy| < apexBand) with JUMP held, gravity is multiplied by apexMul: a little hang time. */
  apexBand: number;
  apexMul: number;
  /** Full jump height in tiles (JUMP held to the top). */
  jumpHeight: number;
  /** Seconds you may still jump after walking off a ledge, and a JUMP press is remembered before landing. */
  coyote: number;
  buffer: number;
  /** Speed added along slopes (tiles/s² down a 45° slope), 0 for none: momentum games. */
  slopeGravity: number;
  /** Heights (tiles) of a spring launch and of the bounce off a stomped foe (JUMP held: +stompBoost). */
  spring: number;
  stomp: number;
  stompBoost: number;
  /** Ladder climbing speed (tiles/s). */
  climb: number;
  /** Grab ledges while falling next to them (step-well traversal). */
  ledgeGrab: boolean;
  /** Knock-back on a hit (tiles/s) and invulnerability after it (s). */
  knockback: number;
  invulnerable: number;
}

export const FEEL_CLASSIC: Feel = {
  walk: 6.2, run: 9.5, maxSpeed: 14, accel: 38, decel: 46, turn: 70, airAccel: 30, overDecel: 10,
  gravity: 56, cutGravity: 120, fallGravity: 82, maxFall: 20, apexBand: 2.2, apexMul: 0.55,
  jumpHeight: 4.2, coyote: 0.1, buffer: 0.13, slopeGravity: 0, spring: 7.5, stomp: 2.2, stompBoost: 2.2,
  climb: 4.2, ledgeGrab: false, knockback: 7, invulnerable: 1.6,
};

/** Launch speed for a jump `height` tiles high under `gravity`. */
export function launchSpeed(height: number, gravity: number): number {
  return Math.sqrt(2 * gravity * Math.max(0, height));
}

/**
 * How far a full-height jump carries horizontally at speed `vx`, landing `dy` tiles higher (negative = lower).
 * Rising uses `gravity`, falling `fallGravity`; the apex hang is ignored (a safe, slightly short estimate).
 * NaN when the height cannot be reached.
 */
export function jumpReach(f: Feel, vx: number, dy: number, height = f.jumpHeight): number {
  const v = launchSpeed(height, f.gravity);
  const up = v / f.gravity;                    // time to the apex
  const peak = height;
  if (dy > peak) return NaN;
  const fall = Math.sqrt((2 * (peak - dy)) / f.fallGravity);
  return vx * (up + fall);
}
