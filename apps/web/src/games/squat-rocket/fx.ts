/**
 * Pooled additive particles (flames, sparks, smoke puffs, fireworks): one Points draw call, fixed buffers,
 * no allocation per frame, so the Mali-G31 TVs stay at 60 fps.
 */
import * as THREE from "three";
import { radialTexture } from "./models";

export class Particles {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private col: Float32Array;
  private vel: Float32Array;
  private base: Float32Array;
  private life: Float32Array;
  private max: Float32Array;
  private next = 0;
  private geo: THREE.BufferGeometry;

  constructor(private n = 500, size = 0.7) {
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.base = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.max = new Float32Array(n).fill(1);
    this.pos.fill(-9999);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute("color", new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.PointsMaterial({
      size, map: radialTexture("rgba(255,255,255,1)", "rgba(255,255,255,0)"), vertexColors: true,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, color: THREE.Color, life: number) {
    const i = this.next;
    this.next = (this.next + 1) % this.n;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.base[i * 3] = color.r; this.base[i * 3 + 1] = color.g; this.base[i * 3 + 2] = color.b;
    this.life[i] = life;
    this.max[i] = life;
  }

  /** A burst of `count` particles in all directions. */
  burst(x: number, y: number, z: number, count: number, speed: number, color: THREE.Color, life = 0.8) {
    for (let k = 0; k < count; k++) {
      const a = Math.random() * Math.PI * 2, b = Math.random() * Math.PI - Math.PI / 2;
      const s = speed * (0.4 + Math.random() * 0.6);
      this.emit(x, y, z, Math.cos(a) * Math.cos(b) * s, Math.sin(b) * s, Math.sin(a) * Math.cos(b) * s, color, life * (0.6 + Math.random() * 0.4));
    }
  }

  update(dt: number, gravity = 0) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i]! <= 0) continue;
      this.life[i]! -= dt;
      const k = Math.max(0, this.life[i]! / this.max[i]!);
      if (k <= 0) {
        this.pos[i * 3 + 1] = -9999;
        this.col[i * 3] = this.col[i * 3 + 1] = this.col[i * 3 + 2] = 0;
        continue;
      }
      this.vel[i * 3 + 1]! -= gravity * dt;
      this.pos[i * 3]! += this.vel[i * 3]! * dt;
      this.pos[i * 3 + 1]! += this.vel[i * 3 + 1]! * dt;
      this.pos[i * 3 + 2]! += this.vel[i * 3 + 2]! * dt;
      this.col[i * 3] = this.base[i * 3]! * k;
      this.col[i * 3 + 1] = this.base[i * 3 + 1]! * k;
      this.col[i * 3 + 2] = this.base[i * 3 + 2]! * k;
    }
    this.geo.attributes.position!.needsUpdate = true;
    this.geo.attributes.color!.needsUpdate = true;
  }
}

/** A vertical sky gradient for the background (drawn once). */
export function skyTexture(top: string, mid: string, bottom: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 4;
  c.height = 256;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, top);
  grad.addColorStop(0.6, mid);
  grad.addColorStop(1, bottom);
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Banded gas-giant texture for the big planet in the sky. */
export function planetTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 128;
  const g = c.getContext("2d")!;
  const bands = ["#6b3fa0", "#8a5cc2", "#c27bd6", "#f0a6c8", "#9b6bd1", "#5a3a8f", "#d58fd0", "#7d52b8"];
  let y = 0;
  let s = 7;
  while (y < 128) {
    s = (s * 16807) % 2147483647;
    const h = 6 + (s % 14);
    g.fillStyle = bands[s % bands.length]!;
    g.fillRect(0, y, 256, h);
    y += h;
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
