export interface Vec3 { x: number; y: number; z: number }

export const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
export const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
export const scale = (a: Vec3, s: number): Vec3 => v(a.x * s, a.y * s, a.z * s);
export const add = (a: Vec3, b: Vec3): Vec3 => v(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a: Vec3, b: Vec3): Vec3 => v(a.x - b.x, a.y - b.y, a.z - b.z);
export const len = (a: Vec3) => Math.hypot(a.x, a.y, a.z);
export const cross = (a: Vec3, b: Vec3): Vec3 => v(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
export const lerp = (a: Vec3, b: Vec3, k: number): Vec3 => v(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k);
export function norm(a: Vec3): Vec3 {
  const l = len(a);
  return l > 1e-9 ? scale(a, 1 / l) : v(0, 0, 0);
}
export const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
export const deg = (rad: number) => (rad * 180) / Math.PI;

/**
 * Device axes -> screen axes (x right, y up, z out of the screen towards the player) for the current
 * screen orientation angle, so "right" means right on screen however the phone is turned.
 */
export function toScreen(a: Vec3, angle: number): Vec3 {
  switch (((angle % 360) + 360) % 360) {
    case 90: return v(-a.y, a.x, a.z);
    case 180: return v(-a.x, -a.y, a.z);
    case 270: return v(a.y, -a.x, a.z);
    default: return a;
  }
}
