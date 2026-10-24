import { HALF_W, STICK_SPEED, bounds, home, type Command } from "./engine";

/**
 * A phone's movement → this player's striker command, pure.
 *   touchpad  absolute: the pad is your half of the table (left edge = your goal end for the left player,
 *             your centre line end … and the other way round for the right player, exactly as on the TV).
 *             Lifting the finger leaves the striker where it is.
 *   motion    absolute tilt: level = the middle of your half, tilt to move across it (like holding a tray).
 *   buttons   the joystick drives the striker with velocity and a quick acceleration; SMASH makes up for
 *             the stick being slower than a finger.
 */
export type HockeyMode = "buttons" | "motion" | "hybrid" | "touchpad";

export const PAD_SPEED = 3.8;
export const TILT_SPEED = 3.2;

export interface PadMemory { x: number; y: number; touched: boolean }

export function newPadMemory(side: 0 | 1): PadMemory {
  return { ...home(side), touched: false };
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Maps [-1, 1] × [-1, 1] onto a side's half of the table. */
export function toHalf(side: 0 | 1, x: number, y: number) {
  const b = bounds(side);
  return { x: b.x0 + ((clamp(x, -1, 1) + 1) / 2) * (b.x1 - b.x0), y: clamp(y, -1, 1) * b.y1 };
}

export function commandFor(side: 0 | 1, mode: HockeyMode, inp: { ok: boolean; x: number; y: number }, mem: PadMemory, smash: boolean): Command {
  if (mode === "buttons") return { kind: "velocity", x: inp.ok ? inp.x : 0, y: inp.ok ? inp.y : 0, speed: STICK_SPEED, smash };
  if (mode === "touchpad") {
    const lifted = !inp.ok || (inp.x === 0 && inp.y === 0);   // the pad reports exactly 0,0 with no finger
    if (!lifted) {
      const p = toHalf(side, inp.x, inp.y);
      mem.x = p.x;
      mem.y = p.y;
      mem.touched = true;
    }
    return { kind: "target", x: mem.x, y: mem.y, speed: PAD_SPEED, smash };
  }
  // motion / hybrid: tilt is a position; a little extra gain so the rails are reachable without straining
  if (inp.ok) {
    const p = toHalf(side, inp.x * 1.25, inp.y * 1.25);
    mem.x = p.x;
    mem.y = clamp(p.y, -HALF_W, HALF_W);
  }
  return { kind: "target", x: mem.x, y: mem.y, speed: TILT_SPEED, smash };
}
