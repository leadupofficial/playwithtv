/**
 * Cheap, good-looking effects, each ONE draw call however many there are:
 *   Glows  additive camera-facing light blobs: tail lights, headlamps, boost flames, drift-charge sparks, lamps
 *   Rain   wind-blown streaks that live in a box around whichever camera is drawing (positions computed on the GPU)
 *   Trails tail-light ribbons that stretch behind fast vehicles (camera-facing strips)
 * Plus the kit3d Particles for sparks, spray, debris and splashes.
 */
import * as THREE from "three";
import { glowTexture } from "./textures";

const GLOW_VERT = /* glsl */ `
attribute vec3 iPos;
attribute vec4 iCol;
attribute float iSize;
attribute vec3 iDir;
varying vec2 vUv;
varying vec4 vCol;
void main() {
  vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
  float facing = 1.0;
  if (dot(iDir, iDir) > 0.0) facing = smoothstep(-0.1, 0.5, dot(normalize(cameraPosition - iPos), iDir));
  float sz = abs(iSize);
  mv.xy += position.xy * sz;
  // pull towards the camera: lamps a little (not hidden by their own body), reflections (negative size, below
  // the road) a lot, so the wet road in front of them does not hide them
  mv.z += iSize < 0.0 ? -mv.z * 0.45 : min(0.6, sz);
  gl_Position = projectionMatrix * mv;
  vUv = position.xy + 0.5;
  vCol = iCol * vec4(1.0, 1.0, 1.0, facing);
}`;
const GLOW_FRAG = /* glsl */ `
uniform sampler2D map;
varying vec2 vUv;
varying vec4 vCol;
void main() {
  float a = texture2D(map, vUv).a * vCol.a;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vCol.rgb * a, a);
}`;

export class Glows {
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private pos: THREE.InstancedBufferAttribute;
  private col: THREE.InstancedBufferAttribute;
  private size: THREE.InstancedBufferAttribute;
  private dir: THREE.InstancedBufferAttribute;
  private n = 0;
  private c = new THREE.Color();

  /** `additive` (lamps, sparks) or normal alpha blending (mist banks). */
  constructor(readonly capacity: number, additive = true) {
    const g = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    g.index = quad.index;
    g.setAttribute("position", quad.getAttribute("position"));
    const attr = (k: number) => new THREE.InstancedBufferAttribute(new Float32Array(capacity * k), k).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute("iPos", (this.pos = attr(3)));
    g.setAttribute("iCol", (this.col = attr(4)));
    g.setAttribute("iSize", (this.size = attr(1)));
    g.setAttribute("iDir", (this.dir = attr(3)));
    g.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG, uniforms: { map: { value: glowTexture() } },
      transparent: true, depthWrite: false, blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor, blendDst: additive ? THREE.OneFactor : THREE.OneMinusSrcAlphaFactor, // premultiplied
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
  }

  begin() {
    this.n = 0;
  }

  /** A glow; with a direction (dx, dz on the ground) it shows only to cameras on that side (lamps). */
  add(x: number, y: number, z: number, size: number, color: THREE.ColorRepresentation, intensity = 1, dx = 0, dz = 0) {
    if (this.n >= this.capacity) return;
    this.c.set(color);
    this.dir.setXYZ(this.n, dx, 0, dz);
    this.pos.setXYZ(this.n, x, y, z);
    this.col.setXYZW(this.n, this.c.r * intensity, this.c.g * intensity, this.c.b * intensity, 1);
    this.size.setX(this.n, size);
    this.n++;
  }

  end() {
    const g = this.mesh.geometry;
    g.instanceCount = this.n;
    for (const a of [this.pos, this.col, this.size, this.dir]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, this.n * a.itemSize);
      a.needsUpdate = true;
    }
  }
}

const RAIN_VERT = /* glsl */ `
attribute vec4 seed;              // x, z in 0..1, phase 0..1, length factor
uniform float time;
uniform vec3 wind;
uniform float box;
uniform float speed;
varying float vA;
void main() {
  vec3 c = cameraPosition;
  float h = box * 0.6;
  float fall = mod(seed.z * h - time * speed, h);
  vec3 p = vec3(seed.x * box, fall, seed.y * box);
  // wrap around the camera so the rain box follows it
  p.xz = mod(p.xz - c.xz + box * 0.5, box) + c.xz - box * 0.5;
  p.y += c.y - h * 0.45;
  vec3 dir = normalize(vec3(wind.x, -speed, wind.z));
  vec3 tail = p - dir * (0.45 + seed.w * 0.5) * (speed / 18.0);
  vec3 q = position.y > 0.5 ? p : tail;
  vec4 mv = modelViewMatrix * vec4(q, 1.0);
  vec4 mvp = modelViewMatrix * vec4(p, 1.0), mvt = modelViewMatrix * vec4(tail, 1.0);
  vec2 d = normalize(mvp.xy - mvt.xy + 1e-5);
  mv.xy += vec2(-d.y, d.x) * position.x * 0.012 * -mv.z * 0.18;
  gl_Position = projectionMatrix * mv;
  float dist = length(q - c);
  vA = smoothstep(box * 0.5, box * 0.2, dist) * smoothstep(0.6, 2.0, dist);
}`;
const RAIN_FRAG = /* glsl */ `
uniform float alpha;
varying float vA;
void main() {
  gl_FragColor = vec4(0.82, 0.88, 0.92, vA * alpha);
}`;

/** Rain streaks around the camera. `count` from the quality profile's particle budget. */
export class Rain {
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  constructor(count: number, box = 36) {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const seeds = new Float32Array(count * 4);
    for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
    g.setAttribute("seed", new THREE.InstancedBufferAttribute(seeds, 4));
    g.instanceCount = count;
    const mat = new THREE.ShaderMaterial({
      vertexShader: RAIN_VERT, fragmentShader: RAIN_FRAG, transparent: true, depthWrite: false,
      uniforms: { time: { value: 0 }, wind: { value: new THREE.Vector3(3, 0, 1.5) }, box: { value: box }, speed: { value: 19 }, alpha: { value: 0.32 } },
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
  }
  update(t: number) {
    this.mesh.material.uniforms.time!.value = t;
  }
}

const TRAIL_VERT = /* glsl */ `
attribute vec3 other;   // the neighbouring point along the trail
attribute float side;   // -1 / 1
attribute float fade;   // 1 at the vehicle, 0 at the tail
varying float vF;
uniform float width;
void main() {
  vec4 a = modelViewMatrix * vec4(position, 1.0);
  vec4 b = modelViewMatrix * vec4(other, 1.0);
  vec2 d = normalize(b.xy - a.xy + 1e-5);
  a.xy += vec2(-d.y, d.x) * side * width * (0.35 + 0.65 * fade);
  gl_Position = projectionMatrix * a;
  vF = fade;
}`;
const TRAIL_FRAG = /* glsl */ `
varying float vF;
uniform vec3 color;
void main() { gl_FragColor = vec4(color * vF * vF, vF * vF); }`;

/** Red tail-light streaks behind each vehicle (a ring of recent points per trail). */
export class Trails {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private hist: Float32Array;
  private head: Int32Array;
  private pos: THREE.BufferAttribute;
  private other: THREE.BufferAttribute;
  private fade: THREE.BufferAttribute;
  constructor(readonly trails: number, readonly points = 14) {
    this.hist = new Float32Array(trails * points * 3);
    this.head = new Int32Array(trails);
    const verts = trails * points * 2;
    const g = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(verts * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.other = new THREE.BufferAttribute(new Float32Array(verts * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.fade = new THREE.BufferAttribute(new Float32Array(verts), 1).setUsage(THREE.DynamicDrawUsage);
    const side = new Float32Array(verts);
    const idx: number[] = [];
    for (let t = 0; t < trails; t++) for (let p = 0; p < points; p++) {
      const v = (t * points + p) * 2;
      side[v] = -1;
      side[v + 1] = 1;
      if (p < points - 1) idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
    }
    g.setAttribute("position", this.pos);
    g.setAttribute("other", this.other);
    g.setAttribute("fade", this.fade);
    g.setAttribute("side", new THREE.BufferAttribute(side, 1));
    g.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      vertexShader: TRAIL_VERT, fragmentShader: TRAIL_FRAG, transparent: true, depthWrite: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      uniforms: { width: { value: 0.09 }, color: { value: new THREE.Color("#ff2a1a") } },
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
  }

  /** Pushes the newest point of trail `i`; `strength` 0 hides it (slow or wrecked). */
  push(i: number, x: number, y: number, z: number, strength: number) {
    const P = this.points;
    const h = (this.head[i] = (this.head[i]! + 1) % P);
    this.hist.set([x, y, z], (i * P + h) * 3);
    for (let k = 0; k < P; k++) {
      const a = (i * P + ((h - k + P) % P)) * 3, b = (i * P + ((h - k - 1 + P * 2) % P)) * 3;
      const v = (i * P + k) * 2;
      for (const s of [0, 1]) {
        this.pos.setXYZ(v + s, this.hist[a]!, this.hist[a + 1]!, this.hist[a + 2]!);
        this.other.setXYZ(v + s, this.hist[b]!, this.hist[b + 1]!, this.hist[b + 2]!);
        this.fade.setX(v + s, strength * (1 - k / (P - 1)));
      }
    }
  }

  /** Teleport (respawn): fill the history with one point so no streak is drawn across the map. */
  reset(i: number, x: number, y: number, z: number) {
    for (let k = 0; k < this.points; k++) this.hist.set([x, y, z], (i * this.points + k) * 3);
  }

  commit() {
    this.pos.needsUpdate = this.other.needsUpdate = this.fade.needsUpdate = true;
  }
}

/** Soft mist puffs (wheel spray, splashes, wreck smoke): CPU-moved, drawn through a Glows batch. */
export class Puffs {
  private p: Float32Array;
  private n = 0;
  constructor(readonly glows: Glows, readonly max: number) {
    this.p = new Float32Array(max * 9); // x y z vx vy vz life maxLife size
  }
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number) {
    const i = this.n < this.max ? this.n++ : Math.floor(Math.random() * this.max);
    this.p.set([x, y, z, vx, vy, vz, life, life, size], i * 9);
  }
  burst(x: number, y: number, z: number, count: number, speed: number, life: number, size: number) {
    for (let k = 0; k < count; k++) {
      const a = Math.random() * Math.PI * 2, u = Math.random();
      this.emit(x, y, z, Math.cos(a) * speed * u, speed * (0.3 + Math.random() * 0.6), Math.sin(a) * speed * u, life * (0.7 + Math.random() * 0.6), size);
    }
  }
  /** Moves puffs and adds them to the glows batch (call between glows.begin() and end()). */
  update(dt: number, color: THREE.ColorRepresentation, intensity: number) {
    let i = 0;
    while (i < this.n) {
      const o = i * 9, p = this.p;
      p[o + 6]! -= dt;
      if (p[o + 6]! <= 0) {
        this.p.copyWithin(o, (this.n - 1) * 9, this.n * 9);
        this.n--;
        continue;
      }
      const k = Math.exp(-2.2 * dt);
      p[o + 3]! *= k; p[o + 5]! *= k; p[o + 4] = p[o + 4]! * k - 1.5 * dt;
      p[o]! += p[o + 3]! * dt; p[o + 1]! += p[o + 4]! * dt; p[o + 2]! += p[o + 5]! * dt;
      const t = p[o + 6]! / p[o + 7]!;
      this.glows.add(p[o]!, p[o + 1]!, p[o + 2]!, p[o + 8]! * (1.6 - t * 0.6), color, intensity * t);
      i++;
    }
  }
}
