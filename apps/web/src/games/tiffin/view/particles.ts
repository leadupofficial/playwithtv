/**
 * Soft billboard particles (steam, smoke, flames, sparkles, splashes) in one instanced draw call per blend mode.
 * Pooled, no allocation per frame; a budget caps how many live at once (the quality profile's particleBudget).
 */
import * as THREE from "three";

export interface Puff {
  x: number; y: number; z: number;
  vx?: number; vy?: number; vz?: number;
  life: number;
  size: number;
  grow?: number;
  color: THREE.ColorRepresentation;
  alpha?: number;
  gravity?: number;
  /** 0 = soft round blob, 1 = 4-point sparkle. */
  shape?: number;
}

const VERT = /* glsl */ `
attribute vec4 iPos;     // xyz, size
attribute vec4 iCol;     // rgb, alpha
attribute float iShape;
varying vec2 vUv;
varying vec4 vCol;
varying float vShape;
void main() {
  vec4 mv = modelViewMatrix * vec4(iPos.xyz, 1.0);
  mv.xy += position.xy * iPos.w;
  gl_Position = projectionMatrix * mv;
  vUv = position.xy;
  vCol = iCol;
  vShape = iShape;
}`;

const FRAG = /* glsl */ `
varying vec2 vUv;
varying vec4 vCol;
varying float vShape;
void main() {
  float d = length(vUv) * 2.0;
  float soft = smoothstep(1.0, 0.0, d);
  float star = max(smoothstep(0.16, 0.0, abs(vUv.x) * (0.4 + abs(vUv.y) * 6.0)), smoothstep(0.16, 0.0, abs(vUv.y) * (0.4 + abs(vUv.x) * 6.0)));
  float a = mix(soft * soft, star, vShape) * vCol.a;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vCol.rgb, a);
  #include <colorspace_fragment>
}`;

export class Puffs {
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private n = 0;
  private p: Float32Array; private v: Float32Array; private life: Float32Array; private max: Float32Array;
  private size: Float32Array; private grow: Float32Array; private col: Float32Array; private grav: Float32Array; private shape: Float32Array;
  private aPos: THREE.InstancedBufferAttribute; private aCol: THREE.InstancedBufferAttribute; private aShape: THREE.InstancedBufferAttribute;
  private c = new THREE.Color();

  constructor(readonly capacity: number, additive: boolean) {
    const g = new THREE.InstancedBufferGeometry();
    const q = new THREE.PlaneGeometry(1, 1);
    g.index = q.index;
    g.setAttribute("position", q.getAttribute("position"));
    const at = (k: number) => new THREE.InstancedBufferAttribute(new Float32Array(capacity * k), k).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute("iPos", (this.aPos = at(4)));
    g.setAttribute("iCol", (this.aCol = at(4)));
    g.setAttribute("iShape", (this.aShape = at(1)));
    g.instanceCount = 0;
    const f = (k: number) => new Float32Array(capacity * k);
    this.p = f(3); this.v = f(3); this.life = f(1); this.max = f(1); this.size = f(1); this.grow = f(1); this.col = f(4); this.grav = f(1); this.shape = f(1);
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
  }

  get alive() {
    return this.n;
  }

  add(o: Puff) {
    if (this.n >= this.capacity) return;
    const i = this.n++;
    this.p.set([o.x, o.y, o.z], i * 3);
    this.v.set([o.vx ?? 0, o.vy ?? 0, o.vz ?? 0], i * 3);
    this.life[i] = this.max[i] = o.life;
    this.size[i] = o.size;
    this.grow[i] = o.grow ?? 0;
    this.c.set(o.color);
    this.col.set([this.c.r, this.c.g, this.c.b, o.alpha ?? 1], i * 4);
    this.grav[i] = o.gravity ?? 0;
    this.shape[i] = o.shape ?? 0;
  }

  update(dt: number) {
    let i = 0;
    while (i < this.n) {
      this.life[i]! -= dt;
      if (this.life[i]! <= 0) {
        const last = --this.n;
        if (i !== last) {
          for (const [a, k] of [[this.p, 3], [this.v, 3], [this.col, 4]] as const) a.copyWithin(i * k, last * k, last * k + k);
          for (const a of [this.life, this.max, this.size, this.grow, this.grav, this.shape]) a[i] = a[last]!;
        }
        continue;
      }
      const j = i * 3;
      this.v[j + 1]! -= this.grav[i]! * dt;
      this.p[j]! += this.v[j]! * dt; this.p[j + 1]! += this.v[j + 1]! * dt; this.p[j + 2]! += this.v[j + 2]! * dt;
      this.size[i]! += this.grow[i]! * dt;
      const t = this.life[i]! / this.max[i]!;
      const fade = Math.min(1, t * 3) * Math.min(1, (1 - t) * 8);
      this.aPos.setXYZW(i, this.p[j]!, this.p[j + 1]!, this.p[j + 2]!, this.size[i]!);
      this.aCol.setXYZW(i, this.col[i * 4]!, this.col[i * 4 + 1]!, this.col[i * 4 + 2]!, this.col[i * 4 + 3]! * fade);
      this.aShape.setX(i, this.shape[i]!);
      i++;
    }
    this.mesh.geometry.instanceCount = this.n;
    for (const a of [this.aPos, this.aCol, this.aShape]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, Math.max(1, this.n) * a.itemSize);
      a.needsUpdate = true;
    }
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

/** Emits continuous effects (steam over pots, flames on fires…) at a rate scaled by the particle budget. */
export class Emitters {
  private acc = new Map<string, number>();
  private seed = 3;
  constructor(private soft: Puffs, private glow: Puffs, private budget: number) {}

  private rnd() {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  emit(key: string, kind: "steam" | "smoke" | "fire" | "sizzle" | "bubbles", x: number, y: number, z: number, rate: number, dt: number) {
    const per = { steam: 7, smoke: 6, fire: 26, sizzle: 5, bubbles: 6 }[kind] * rate * Math.min(1, this.budget / 300);
    let a = (this.acc.get(key) ?? 0) + per * dt;
    const r = () => this.rnd() - 0.5;
    while (a >= 1) {
      a -= 1;
      if (kind === "steam") this.soft.add({ x: x + r() * 0.2, y, z: z + r() * 0.2, vx: r() * 0.1, vy: 0.5 + this.rnd() * 0.3, vz: r() * 0.1, life: 1.6, size: 0.18, grow: 0.35, color: "#ffffff", alpha: 0.45 });
      if (kind === "smoke") this.soft.add({ x: x + r() * 0.2, y, z: z + r() * 0.2, vx: r() * 0.15, vy: 0.6, vz: r() * 0.1, life: 1.8, size: 0.22, grow: 0.5, color: "#3a3330", alpha: 0.7 });
      if (kind === "bubbles") this.soft.add({ x: x + r() * 0.35, y, z: z + r() * 0.25, vy: 0.25, life: 0.7, size: 0.07, grow: 0.05, color: "#e8f6ff", alpha: 0.85 });
      if (kind === "sizzle") this.glow.add({ x: x + r() * 0.3, y, z: z + r() * 0.25, vx: r() * 0.8, vy: 0.8 + this.rnd(), vz: r() * 0.5, life: 0.35, size: 0.05, color: "#ffcf6a", alpha: 0.9, gravity: 4, shape: 1 });
      if (kind === "fire") {
        this.glow.add({ x: x + r() * 0.45, y, z: z + r() * 0.35, vx: r() * 0.2, vy: 1.0 + this.rnd() * 0.8, vz: r() * 0.2, life: 0.55, size: 0.32, grow: -0.3, color: this.rnd() < 0.5 ? "#ff7a1a" : "#ffc13a", alpha: 0.9 });
        if (this.rnd() < 0.25) this.soft.add({ x: x + r() * 0.3, y: y + 0.5, z, vy: 0.9, life: 1.4, size: 0.28, grow: 0.5, color: "#2a2220", alpha: 0.55 });
      }
    }
    this.acc.set(key, a);
  }

  /** A one-off burst (serve sparkles, a splash of water, a puff when something lands). */
  burst(kind: "sparkle" | "splash" | "poof" | "flip", x: number, y: number, z: number, n = 14) {
    for (let i = 0; i < n; i++) {
      const a = this.rnd() * Math.PI * 2, s = 0.6 + this.rnd() * 1.4;
      if (kind === "sparkle") this.glow.add({ x, y, z, vx: Math.cos(a) * s, vy: 1.5 + this.rnd() * 2, vz: Math.sin(a) * s * 0.5, life: 0.9, size: 0.16, color: this.rnd() < 0.5 ? "#ffd23f" : "#fff3b0", gravity: 4, shape: 1 });
      if (kind === "splash") this.soft.add({ x, y, z, vx: Math.cos(a) * s, vy: 1 + this.rnd() * 2, vz: Math.sin(a) * s * 0.5, life: 0.7, size: 0.1, color: "#9fd8ff", alpha: 0.9, gravity: 7 });
      if (kind === "poof") this.soft.add({ x, y, z, vx: Math.cos(a) * s * 0.4, vy: 0.4, vz: Math.sin(a) * s * 0.2, life: 0.6, size: 0.2, grow: 0.5, color: "#f4efe6", alpha: 0.7 });
      if (kind === "flip") this.glow.add({ x, y, z, vx: Math.cos(a) * s * 0.7, vy: 1 + this.rnd() * 1.5, vz: Math.sin(a) * s * 0.4, life: 0.6, size: 0.12, color: "#ffb43a", gravity: 5, shape: 1 });
    }
  }
}
