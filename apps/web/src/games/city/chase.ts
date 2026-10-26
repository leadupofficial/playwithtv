/**
 * CITY RIVALS chase camera, as plain numbers (the view copies them into a three.js camera). Sits behind and above
 * the car, swings towards the direction of travel (so a drift shows the car sideways), lifts off the ground for
 * jumps, and pulls in rather than ending up inside a building (the street canyon would otherwise hide the car).
 */
import type { District } from "./district";
import { speedOf, type Car } from "./car";

export interface Chase { x: number; y: number; z: number; tx: number; ty: number; tz: number; yaw: number; fov: number; ready: boolean }

export const newChase = (): Chase => ({ x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0, yaw: 0, fov: 62, ready: false });

const DIST = 8.5;
const HEIGHT = 3.6;

/** How far back (≤ want) the camera can sit along (dx, dz) from (x, z) at height y before it would enter a building. */
export function clearDistance(d: District, x: number, z: number, y: number, dx: number, dz: number, want: number): number {
  const pad = 0.7;
  for (let t = 1; t <= want; t += 0.5) {
    const px = x + dx * t, pz = z + dz * t;
    for (const b of d.boxes) {
      if (b.h < y - 0.5) continue;
      if (px > b.x0 - pad && px < b.x1 + pad && pz > b.z0 - pad && pz < b.z1 + pad) return Math.max(3, t - 0.6);
    }
  }
  return want;
}

export function follow(d: District, c: Chase, car: Car, dt: number): void {
  const v = speedOf(car);
  // look along the velocity once moving (a drift swings the view less than the car)
  const velYaw = v > 4 ? Math.atan2(car.vx, car.vz) : car.yaw;
  const blend = Math.min(1, v / 10) * 0.55;
  const want = car.yaw + Math.atan2(Math.sin(velYaw - car.yaw), Math.cos(velYaw - car.yaw)) * blend;
  // a respawn teleports the car: cut to it rather than fly the camera across the city
  if (c.ready && Math.hypot(car.x - c.x, car.z - c.z) > 25) c.ready = false;
  if (!c.ready) c.yaw = want;
  c.yaw += Math.atan2(Math.sin(want - c.yaw), Math.cos(want - c.yaw)) * (1 - Math.exp(-dt * 5));
  const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
  const boost = car.boostT > 0 ? 1 : 0;
  const back = clearDistance(d, car.x, car.z, car.y + HEIGHT, -fx, -fz, DIST + boost * 1.5 + Math.min(1.5, v / 20));
  const wx = car.x - fx * back, wz = car.z - fz * back, wy = car.y * 0.7 + HEIGHT + (car.air ? 1.2 : 0);
  const k = c.ready ? 1 - Math.exp(-dt * 8) : 1;
  c.x += (wx - c.x) * k;
  c.z += (wz - c.z) * k;
  c.y += (wy - c.y) * (c.ready ? 1 - Math.exp(-dt * 4) : 1);
  c.tx = car.x + fx * 6;
  c.tz = car.z + fz * 6;
  c.ty = car.y + 1.1;
  c.fov += (62 + boost * 10 + Math.min(6, v / 5) - c.fov) * (1 - Math.exp(-dt * 4));
  c.ready = true;
}
