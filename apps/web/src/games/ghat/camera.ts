/**
 * Cameras: the per-player chase cam (lags into corners, pulls back and widens with speed, kicks on boost, shakes
 * on hits, swings round to watch your own wreck), the intro flyover down the ghat, the "TV director" for spare
 * split-screen cells, the slow-motion replay orbit and the podium.
 */
import * as THREE from "three";
import { wrapAngle } from "./track";
import { toWorld, frameAt, type Track } from "./track";
import type { RacerPose } from "./actors";

const tmp = new THREE.Vector3();
const look = new THREE.Vector3();

export class ChaseCam {
  readonly camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.3, 1400);
  private yaw = 0;
  private pos = new THREE.Vector3();
  private fov = 62;
  private trauma = 0;
  private crashA = 0;
  private started = false;
  /** Seconds of FOV punch left (boost / mini-turbo). */
  private kick = 0;

  shake(amount: number) {
    this.trauma = Math.min(1, this.trauma + amount);
  }
  punch(seconds = 0.5) {
    this.kick = Math.max(this.kick, seconds);
  }

  /** Snap behind a pose (start of the race, after a cut). */
  snap(p: RacerPose) {
    this.started = false;
    this.update(p, 1, 0, 0);
  }

  update(p: RacerPose, dt: number, speedFrac: number, time: number) {
    const cam = this.camera;
    if (!this.started) {
      this.yaw = p.travel;
      this.started = true;
      dt = 10;
    }
    if (p.wrecked) {
      // crash cam: swing round the tumbling vehicle, low and close
      this.crashA += dt * 0.9;
      const a = this.yaw + Math.PI * 0.6 + this.crashA;
      tmp.set(p.x + Math.sin(a) * 7, p.y + 2.2, p.z + Math.cos(a) * 7);
      this.pos.lerp(tmp, 1 - Math.exp(-dt * 4));
      cam.position.copy(this.pos);
      cam.lookAt(p.x, p.y + 0.8, p.z);
      this.fov += (48 - this.fov) * (1 - Math.exp(-dt * 3));
    } else {
      this.crashA = 0;
      const want = p.travel * 0.75 + (p.travel + wrapAngle(p.yaw - p.travel)) * 0.25;
      this.yaw += wrapAngle(want - this.yaw) * (1 - Math.exp(-dt * 4.5));
      const near = p.kind === "scooter" ? 0.8 : p.kind === "car" ? 1.06 : 1;
      const dist = (4.4 + speedFrac * 1.3) * near, height = (1.95 + speedFrac * 0.2) * (0.9 + near * 0.1);
      const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
      tmp.set(p.x - fx * dist, p.y + height, p.z - fz * dist);
      // the yaw is smoothed, the distance is not (a positional lag would leave the car 3 m further away at speed)
      this.pos.x = tmp.x;
      this.pos.z = tmp.z;
      this.pos.y += (tmp.y - this.pos.y) * (1 - Math.exp(-dt * 7));
      cam.position.copy(this.pos);
      look.set(p.x + fx * 4, p.y + 1.0, p.z + fz * 4);
      cam.lookAt(look);
      cam.rotateZ(-p.drift * 0.035);
      const target = 60 + speedFrac * 13 + (this.kick > 0 ? 9 : 0);
      this.fov += (target - this.fov) * (1 - Math.exp(-dt * (this.kick > 0 ? 8 : 3)));
    }
    this.kick = Math.max(0, this.kick - dt);
    // trauma shake
    if (this.trauma > 0) {
      const s = this.trauma * this.trauma;
      cam.position.x += Math.sin(time * 61) * s * 0.35;
      cam.position.y += Math.sin(time * 47 + 1) * s * 0.25;
      cam.rotateZ(Math.sin(time * 37 + 2) * s * 0.05);
      this.trauma = Math.max(0, this.trauma - dt * 1.6);
    }
    cam.fov = this.fov;
    cam.updateProjectionMatrix();
  }
}

/** Intro flyover: from high over the hairpins, sweeping back up the road to the grid (u: 0 → 1). */
export function flyover(cam: THREE.PerspectiveCamera, t: Track, u: number) {
  const e = u < 0 ? 0 : u > 1 ? 1 : u * u * (3 - 2 * u);
  const s = 520 - 545 * e; // ends 25 m behind the start line
  const f = frameAt(t, s);
  const height = 70 * (1 - e) + 3.2 * e;
  const side = -45 * (1 - e) * (1 - e);
  const p = toWorld(t, s, side);
  cam.position.set(p.x, f.y + height, p.z);
  const aim = toWorld(t, s + 40 + 60 * (1 - e), 0);
  cam.lookAt(aim.x, aim.y + 1 + 10 * (1 - e), aim.z);
  cam.fov = 55;
  cam.updateProjectionMatrix();
}

/** TV director: alternates a low front shot, a side tracking shot and a high chase on whoever it follows. */
export function director(cam: THREE.PerspectiveCamera, p: RacerPose, time: number) {
  const shot = Math.floor(time / 6) % 3;
  const fx = Math.sin(p.travel), fz = Math.cos(p.travel);
  const rx = -fz, rz = fx;
  if (shot === 0) cam.position.set(p.x + fx * 14 + rx * 3, p.y + 1.4, p.z + fz * 14 + rz * 3);
  else if (shot === 1) cam.position.set(p.x + rx * 9 - fx * 2, p.y + 2.5, p.z + rz * 9 - fz * 2);
  else cam.position.set(p.x - fx * 16, p.y + 9, p.z - fz * 16);
  cam.lookAt(p.x, p.y + 0.8, p.z);
  cam.fov = 50;
  cam.updateProjectionMatrix();
}

/** Replay: a slow orbit around the takedown's victim. */
export function replayCam(cam: THREE.PerspectiveCamera, p: RacerPose, a: number) {
  cam.position.set(p.x + Math.sin(a) * 9, p.y + 2.6, p.z + Math.cos(a) * 9);
  cam.lookAt(p.x, p.y + 0.6, p.z);
  cam.fov = 45;
  cam.updateProjectionMatrix();
}
