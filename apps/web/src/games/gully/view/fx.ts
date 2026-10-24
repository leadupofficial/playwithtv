/**
 * Juice for the lane, all in pooled particle systems (one draw call each): fireworks over the gully for sixes,
 * glass shards for a smashed window, dust where the ball pitches, confetti for wickets.
 */
import * as THREE from "three";
import { Particles, sparkleGeometry } from "../../kit3d/particles";

const FIREWORK = ["#ffd23f", "#ff4d6d", "#3bceac", "#2f9bff", "#ff9f1c", "#ffffff"];

export class Fx {
  readonly group = new THREE.Group();
  private sparks: Particles;
  private bits: Particles;
  private queue: Array<{ at: number; fn: () => void }> = [];
  private t = 0;

  constructor(budget: number) {
    const glow = new THREE.MeshBasicMaterial({ color: "#ffffff", toneMapped: false });
    this.sparks = new Particles(sparkleGeometry(), glow, Math.min(600, Math.max(120, budget)));
    const bitMat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
    this.bits = new Particles(new THREE.PlaneGeometry(1, 1), bitMat, Math.min(300, Math.max(60, budget / 2)));
    this.group.add(this.sparks.mesh, this.bits.mesh);
  }

  /** A volley of fireworks above the far end of the lane. */
  fireworks(n = 4, z = -24) {
    for (let k = 0; k < n; k++) {
      this.later(k * 0.35, () => {
        const at = new THREE.Vector3((Math.random() - 0.5) * 7, 9 + Math.random() * 4, z - Math.random() * 8);
        const color = FIREWORK[Math.floor(Math.random() * FIREWORK.length)]!;
        this.sparks.burst(at, { count: 40, color, speed: 7, up: 0.5, gravity: 2.2, drag: 1.4, life: 1.6, size: 0.22, spin: 3 });
      });
    }
  }

  glass(at: THREE.Vector3) {
    this.bits.burst(at, { count: 36, color: "#cfefff", colorJitter: 0.1, speed: 4, up: 1.5, gravity: 9, drag: 0.6, life: 2.2, size: 0.12, spin: 14, floor: 0.01 });
    this.sparks.burst(at, { count: 18, color: "#ffffff", speed: 3, up: 1, gravity: 4, drag: 1, life: 0.6, size: 0.12 });
  }

  dust(at: THREE.Vector3, amount = 1) {
    this.bits.burst(at, { count: Math.round(8 * amount), color: "#d8c8a8", colorJitter: 0.08, speed: 1.2, up: 0.8, gravity: 1, drag: 2.5, life: 0.8, size: 0.12 * amount, spin: 4 });
  }

  confetti(at: THREE.Vector3) {
    for (const c of FIREWORK) this.bits.burst(at, { count: 10, color: c, speed: 3.5, up: 4, gravity: 3, drag: 1.6, life: 2.4, size: 0.1, spin: 10, sway: 1.2, floor: 0.01 });
  }

  /** Bat on ball: a little flash. */
  spark(at: THREE.Vector3, strong: boolean) {
    this.sparks.burst(at, { count: strong ? 22 : 10, color: strong ? "#fff3b0" : "#ffffff", speed: strong ? 5 : 3, up: 0.5, gravity: 2, drag: 3, life: 0.35, size: 0.12 });
  }

  private later(dt: number, fn: () => void) {
    this.queue.push({ at: this.t + dt, fn });
  }

  update(dt: number) {
    this.t += dt;
    for (let i = this.queue.length - 1; i >= 0; i--) {
      if (this.queue[i]!.at <= this.t) {
        this.queue[i]!.fn();
        this.queue.splice(i, 1);
      }
    }
    this.sparks.update(dt);
    this.bits.update(dt);
  }

  clear() {
    this.sparks.clear();
    this.bits.clear();
    this.queue = [];
  }
}
