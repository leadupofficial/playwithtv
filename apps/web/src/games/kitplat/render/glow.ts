/**
 * kitplat/render/glow: high/ultra-tier extras that cost fill-rate the 1 GB TV does not have. GlowBatch draws soft
 * additive halos (gems, lamps, lanterns, sparks: one draw call, no texture), and Vignette darkens the screen's edges
 * and warms its centre (one full-screen quad).
 */
import * as THREE from "three";

const GLOW_VERT = /* glsl */ `
attribute vec4 iGlow;   // x, y, radius, strength
attribute vec3 iColor;
varying vec2 vP;
varying vec3 vColor;
varying float vK;
void main() {
  vP = position.xy * 2.0;
  vColor = iColor;
  vK = iGlow.w;
  gl_Position = projectionMatrix * viewMatrix * vec4(iGlow.xy + position.xy * 2.0 * iGlow.z, 0.0, 1.0);
}`;

const GLOW_FRAG = /* glsl */ `
varying vec2 vP;
varying vec3 vColor;
varying float vK;
void main() {
  float d = 1.0 - dot(vP, vP);
  if (d <= 0.0) discard;
  gl_FragColor = vec4(vColor * d * d * vK, 1.0);
}`;

export class GlowBatch {
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private glow: THREE.InstancedBufferAttribute;
  private color: THREE.InstancedBufferAttribute;
  private attrs: THREE.InstancedBufferAttribute[];
  n = 0;

  constructor(readonly capacity: number, order: number) {
    const g = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    g.index = quad.index;
    g.setAttribute("position", quad.getAttribute("position"));
    this.glow = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.color = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.attrs = [this.glow, this.color];
    g.setAttribute("iGlow", this.glow);
    g.setAttribute("iColor", this.color);
    g.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = order;
  }

  begin() { this.n = 0; }

  private cache = new Map<string, THREE.Color>();

  /** Adds a halo; `color` is a CSS colour string (parsed once, then cached). */
  add(x: number, y: number, radius: number, color: string, strength = 0.5) {
    if (this.n >= this.capacity) return;
    let c = this.cache.get(color);
    if (!c) { c = new THREE.Color(color); this.cache.set(color, c); }
    this.glow.setXYZW(this.n, x, y, radius, strength);
    this.color.setXYZ(this.n, c.r, c.g, c.b);
    this.n++;
  }

  end() {
    this.mesh.geometry.instanceCount = this.n;
    for (const a of this.attrs) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, this.n * a.itemSize);
      a.needsUpdate = true;
    }
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

const VIG_FRAG = /* glsl */ `
varying vec2 vUv;
uniform vec3 warm;
void main() {
  vec2 p = (vUv - 0.5) * vec2(1.25, 1.0);
  float v = smoothstep(0.38, 0.95, length(p));
  float top = smoothstep(0.55, 1.0, vUv.y) * 0.18;
  gl_FragColor = vec4(mix(warm * top, vec3(0.0), v), clamp(v * 0.6 + top, 0.0, 1.0));
}`;

export class Vignette {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  constructor(order: number, warm: THREE.ColorRepresentation = "#fff2d0") {
    const mat = new THREE.ShaderMaterial({
      vertexShader: "varying vec2 vUv; void main() { vUv = position.xy + 0.5; gl_Position = vec4(position.xy * 2.0, 0.0, 1.0); }",
      fragmentShader: VIG_FRAG, transparent: true, depthTest: false, depthWrite: false, uniforms: { warm: { value: new THREE.Color(warm) } },
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = order;
  }
  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
