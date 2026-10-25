/**
 * kitplat/render/particles: a fixed pool of juice particles (dust puffs, sparkles, gem twinkles, splashes,
 * confetti) stored as flat arrays, drawn through a QuadBatch. No allocation after construction.
 */
import * as THREE from "three";
import type { SpriteDef } from "./atlas";
import type { QuadBatch } from "./quads";

export const PUFF = 0, STAR = 1, CONFETTI = 2, DROP = 3;

export class Particles {
  private x: Float32Array; private y: Float32Array; private vx: Float32Array; private vy: Float32Array;
  private life: Float32Array; private max: Float32Array; private size: Float32Array; private rot: Float32Array; private vr: Float32Array;
  private kind: Uint8Array; private col: Float32Array; private grav: Float32Array;
  private next = 0;
  private c = new THREE.Color();

  constructor(readonly cap: number) {
    const f = () => new Float32Array(cap);
    this.x = f(); this.y = f(); this.vx = f(); this.vy = f(); this.life = f(); this.max = f(); this.size = f(); this.rot = f(); this.vr = f();
    this.grav = f();
    this.kind = new Uint8Array(cap);
    this.col = new Float32Array(cap * 3);
  }

  spawn(kind: number, x: number, y: number, vx: number, vy: number, life: number, size: number, color = 0xffffff, grav = 0) {
    const i = this.next;
    this.next = (this.next + 1) % this.cap;
    this.x[i] = x; this.y[i] = y; this.vx[i] = vx; this.vy[i] = vy; this.life[i] = life; this.max[i] = life; this.size[i] = size;
    this.rot[i] = Math.random() * 6.28; this.vr[i] = (Math.random() - 0.5) * 8; this.kind[i] = kind; this.grav[i] = grav;
    this.col[i * 3] = ((color >> 16) & 255) / 255; this.col[i * 3 + 1] = ((color >> 8) & 255) / 255; this.col[i * 3 + 2] = (color & 255) / 255;
  }

  burst(kind: number, x: number, y: number, n: number, speed: number, life: number, size: number, color = 0xffffff, grav = 0, up = 0) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, s = speed * (0.4 + Math.random() * 0.6);
      this.spawn(kind, x, y, Math.cos(a) * s, Math.sin(a) * s + up, life * (0.7 + Math.random() * 0.5), size * (0.7 + Math.random() * 0.6), color, grav);
    }
  }

  /** Dust kicked up at the feet (landing, skidding, running). */
  dust(x: number, y: number, n: number, dir = 0) {
    for (let k = 0; k < n; k++) {
      this.spawn(PUFF, x + (Math.random() - 0.5) * 0.4, y + 0.08, (dir || (Math.random() - 0.5) * 2) * (1 + Math.random() * 2), 0.6 + Math.random() * 1.2, 0.45, 0.35 + Math.random() * 0.25, 0xf2ead8);
    }
  }

  update(dt: number) {
    for (let i = 0; i < this.cap; i++) {
      if (this.life[i]! <= 0) continue;
      this.life[i]! -= dt;
      this.vy[i]! -= this.grav[i]! * dt;
      const drag = this.kind[i] === PUFF ? 3 : 0.6;
      this.vx[i]! *= Math.max(0, 1 - drag * dt);
      this.vy[i]! *= this.kind[i] === PUFF ? Math.max(0, 1 - drag * dt) : 1;
      this.x[i]! += this.vx[i]! * dt;
      this.y[i]! += this.vy[i]! * dt;
      this.rot[i]! += this.vr[i]! * dt;
    }
  }

  draw(b: QuadBatch, puff: SpriteDef, star: SpriteDef, drop: SpriteDef) {
    for (let i = 0; i < this.cap; i++) {
      const l = this.life[i]!;
      if (l <= 0) continue;
      const k = l / this.max[i]!;
      const kind = this.kind[i]!;
      const st = b.style;
      st.r = this.col[i * 3]!; st.g = this.col[i * 3 + 1]!; st.b = this.col[i * 3 + 2]!;
      if (kind === PUFF) {
        const s = this.size[i]! * (1.6 - k * 0.8);
        st.sx = st.sy = s / 0.55;
        st.alpha = k * 0.85;
        b.put(puff, 0, this.x[i]!, this.y[i]!);
      } else if (kind === DROP) {
        st.sx = 0.08; st.sy = this.size[i]!;
        st.alpha = 0.45;
        st.rot = 0.18;
        b.put(drop, 0, this.x[i]!, this.y[i]!);
      } else {
        st.sx = st.sy = this.size[i]! * (kind === CONFETTI ? 1 : 0.4 + k * 0.8);
        if (kind === CONFETTI) { st.sy *= 0.5; }
        st.rot = this.rot[i]!;
        st.alpha = Math.min(1, k * 2);
        b.put(star, 0, this.x[i]!, this.y[i]!);
      }
    }
  }

  clear() {
    this.life.fill(0);
  }
}
