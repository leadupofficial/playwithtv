/**
 * kit3d/particles: a pooled particle system drawn as ONE InstancedMesh (one draw call however many are
 * alive). No allocation per frame. Good for feathers, confetti, dust puffs and sparkles.
 *
 *   const feathers = new Particles(featherGeometry(), new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }), 240);
 *   scene.add(feathers.mesh);
 *   feathers.burst(point, { count: 14, color: "#fff", speed: 5, up: 3, gravity: 2.5, drag: 2.2, floor: bedTop });
 *   feathers.update(dt);
 */
import * as THREE from "three";

export interface BurstOptions {
  count: number;
  color?: THREE.ColorRepresentation;
  /** Random variation of the colour's lightness (0..1). */
  colorJitter?: number;
  speed?: number;
  /** Extra upward speed. */
  up?: number;
  gravity?: number;
  /** Air drag (1/s): feathers ~2, sparks ~0.5. */
  drag?: number;
  life?: number;
  size?: number;
  spin?: number;
  /** Side-to-side flutter while falling (feathers). */
  sway?: number;
  /** Particles come to rest on this height (and lie there until they fade). */
  floor?: number;
  /** Direction bias (unit-ish vector) added to the random spray. */
  dir?: THREE.Vector3;
}

const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();
const col = new THREE.Color();

export class Particles {
  readonly mesh: THREE.InstancedMesh;
  private n = 0;
  private readonly max: number;
  private pos: Float32Array; private vel: Float32Array; private rot: Float32Array; private spin: Float32Array;
  private life: Float32Array; private maxLife: Float32Array; private size: Float32Array;
  private grav: Float32Array; private drag: Float32Array; private sway: Float32Array; private floor: Float32Array;
  private colors: Float32Array;
  private seed = 1;

  constructor(geometry: THREE.BufferGeometry, material: THREE.Material, max = 200) {
    this.max = max;
    this.mesh = new THREE.InstancedMesh(geometry, material, max);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, col.set("#fff"));
    const f = (k: number) => new Float32Array(max * k);
    this.pos = f(3); this.vel = f(3); this.rot = f(3); this.spin = f(3); this.life = f(1); this.maxLife = f(1);
    this.size = f(1); this.grav = f(1); this.drag = f(1); this.sway = f(1); this.floor = f(1); this.colors = f(3);
  }

  private rnd() {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  get alive() {
    return this.n;
  }

  burst(at: THREE.Vector3, o: BurstOptions) {
    const base = new THREE.Color(o.color ?? "#ffffff");
    for (let k = 0; k < o.count; k++) {
      const i = this.n < this.max ? this.n++ : Math.floor(this.rnd() * this.max); // full: recycle a random one
      const a = this.rnd() * Math.PI * 2, el = (this.rnd() - 0.3) * Math.PI * 0.6;
      const sp = (o.speed ?? 4) * (0.4 + this.rnd() * 0.8);
      const d = o.dir;
      this.pos.set([at.x, at.y, at.z], i * 3);
      this.vel.set([
        Math.cos(a) * Math.cos(el) * sp + (d?.x ?? 0) * sp,
        Math.sin(el) * sp + (o.up ?? 2) * (0.6 + this.rnd() * 0.8) + (d?.y ?? 0) * sp,
        Math.sin(a) * Math.cos(el) * sp + (d?.z ?? 0) * sp,
      ], i * 3);
      this.rot.set([this.rnd() * 6, this.rnd() * 6, this.rnd() * 6], i * 3);
      const sn = o.spin ?? 6;
      this.spin.set([(this.rnd() - 0.5) * sn, (this.rnd() - 0.5) * sn, (this.rnd() - 0.5) * sn], i * 3);
      const life = (o.life ?? 1.5) * (0.7 + this.rnd() * 0.6);
      this.life[i] = life;
      this.maxLife[i] = life;
      this.size[i] = (o.size ?? 0.2) * (0.7 + this.rnd() * 0.6);
      this.grav[i] = o.gravity ?? 9;
      this.drag[i] = o.drag ?? 1;
      this.sway[i] = o.sway ?? 0;
      this.floor[i] = o.floor ?? -1e9;
      col.copy(base).offsetHSL(0, 0, (this.rnd() - 0.5) * (o.colorJitter ?? 0));
      this.colors.set([col.r, col.g, col.b], i * 3);
    }
  }

  /** Moves everything and rebuilds the instance list (dead particles are swapped out). */
  update(dt: number) {
    let i = 0;
    while (i < this.n) {
      this.life[i]! -= dt;
      if (this.life[i]! <= 0) {
        this.kill(i);
        continue;
      }
      const j = i * 3;
      const pos = this.pos, vel = this.vel;
      const k = Math.exp(-this.drag[i]! * dt);
      vel[j]! *= k; vel[j + 2]! *= k;
      vel[j + 1] = vel[j + 1]! * k - this.grav[i]! * dt;
      const sw = this.sway[i]!;
      const flutter = sw ? Math.sin((this.maxLife[i]! - this.life[i]!) * 7 + i) * sw : 0;
      pos[j]! += (vel[j]! + flutter) * dt;
      pos[j + 1]! += vel[j + 1]! * dt;
      pos[j + 2]! += vel[j + 2]! * dt;
      const resting = pos[j + 1]! <= this.floor[i]!;
      if (resting) {
        pos[j + 1] = this.floor[i]!;
        vel[j] = vel[j + 1] = vel[j + 2] = 0;
        this.rot[j] = 0; this.rot[j + 2] = 0; // lie flat
      } else {
        this.rot[j]! += this.spin[j]! * dt; this.rot[j + 1]! += this.spin[j + 1]! * dt; this.rot[j + 2]! += this.spin[j + 2]! * dt;
      }
      const fade = Math.min(1, this.life[i]! / 0.35);
      e.set(this.rot[j]!, this.rot[j + 1]!, this.rot[j + 2]!);
      q.setFromEuler(e);
      s.setScalar(this.size[i]! * fade);
      p.set(pos[j]!, pos[j + 1]!, pos[j + 2]!);
      this.mesh.setMatrixAt(i, m4.compose(p, q, s));
      this.mesh.setColorAt(i, col.setRGB(this.colors[j]!, this.colors[j + 1]!, this.colors[j + 2]!));
      i++;
    }
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  private kill(i: number) {
    const last = --this.n;
    if (i === last) return;
    const copy = (a: Float32Array, k: number) => a.copyWithin(i * k, last * k, last * k + k);
    copy(this.pos, 3); copy(this.vel, 3); copy(this.rot, 3); copy(this.spin, 3); copy(this.colors, 3);
    for (const a of [this.life, this.maxLife, this.size, this.grav, this.drag, this.sway, this.floor]) a[i] = a[last]!;
  }

  clear() {
    this.n = 0;
    this.mesh.count = 0;
  }
}

/** A small feather: a curved, pointed blade with a quill line (a dozen triangles). Unit length along x. */
export function featherGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-0.5, 0);
  shape.quadraticCurveTo(-0.1, 0.24, 0.5, 0.02);
  shape.quadraticCurveTo(-0.05, -0.16, -0.5, 0);
  const g = new THREE.ShapeGeometry(shape, 3);
  g.rotateX(-Math.PI / 2);
  return g;
}

/** A 4-point sparkle star (flat), for impact flashes. */
export function sparkleGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const pts = 8;
  for (let i = 0; i <= pts; i++) {
    const a = (i / pts) * Math.PI * 2;
    const r = i % 2 === 0 ? 0.5 : 0.14;
    if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  return new THREE.ShapeGeometry(shape);
}
