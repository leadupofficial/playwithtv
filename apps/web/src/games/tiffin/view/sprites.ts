/**
 * Upright pre-rendered sprites for the lite tier: like kit25d's SpriteBatch (one InstancedMesh, one draw call per
 * sheet) but each quad stands UPRIGHT (vertical, turned to face the camera) and is stretched by 1/cos(pitch), so it
 * covers exactly the pixels it was rendered for while its depth matches a real standing object. With depth-only
 * boxes for the counters, a chef walking behind an island is hidden by it, and in front of it is not.
 *
 * Frames are picked by index (a sheet's clips sit back to back), and an optional key-colour tint recolours the
 * chefs' magenta aprons to each player's colour.
 */
import * as THREE from "three";
import { type SpriteSheet } from "../../kit25d/spriteBatch";
import { cellIndex, cellUv, directionIndex, screenHeading } from "../../kit25d/manifest";

export interface UprightState {
  x: number; y: number; z: number;
  /** World yaw (three.js: forward = (sin h, 0, cos h)); only used by sheets with several directions. */
  heading?: number;
  /** Frame index within a direction. */
  frame: number;
  scale?: number;
  alpha?: number;
  tint?: THREE.ColorRepresentation | null;
  /** Brightness multiplier (tunnel darkness). */
  light?: number;
}

const VERT = /* glsl */ `
attribute vec3 iPos;
attribute vec2 iSize;
attribute vec4 iUv;
attribute vec4 iTint;
attribute vec2 iAlpha;
uniform vec2 pivot;
uniform vec3 right;
uniform float upScale;
varying vec2 vUv;
varying vec4 vTint;
varying vec2 vAlpha;
void main() {
  vec2 c = position.xy + 0.5;
  vec2 off = vec2(c.x - pivot.x, c.y - (1.0 - pivot.y)) * iSize;
  vec3 world = iPos + right * off.x + vec3(0.0, off.y * upScale, 0.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  vUv = iUv.xy + c * iUv.zw;
  vTint = iTint;
  vAlpha = iAlpha;
}`;

const FRAG = /* glsl */ `
uniform sampler2D map;
varying vec2 vUv;
varying vec4 vTint;
varying vec2 vAlpha;
void main() {
  vec4 t = texture2D(map, vUv);
  if (t.a * vAlpha.x < 0.01) discard;
  vec3 rgb = t.rgb;
#ifdef KEY_TINT
  // the apron's key magenta: red and blue well above green
  float key = smoothstep(0.12, 0.3, min(rgb.r, rgb.b) - rgb.g) * vTint.a;
  float lum = max(rgb.r, rgb.b);
  rgb = mix(rgb, vTint.rgb * (0.25 + lum * 1.1), key);
#endif
  gl_FragColor = vec4(rgb * vAlpha.y, t.a * vAlpha.x);
  #include <colorspace_fragment>
}`;

export class UprightSprites {
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private states: (UprightState | null)[];
  private pos: THREE.InstancedBufferAttribute;
  private size: THREE.InstancedBufferAttribute;
  private uv: THREE.InstancedBufferAttribute;
  private tint: THREE.InstancedBufferAttribute;
  private alpha: THREE.InstancedBufferAttribute;
  private order: number[] = [];
  private depth: number[] = [];
  private dir = new THREE.Vector3();
  private col = new THREE.Color();
  private ppm: number;

  constructor(readonly sheet: SpriteSheet, readonly capacity: number, opts: { keyTint?: boolean; pitchDeg: number }) {
    this.states = new Array(capacity).fill(null);
    const g = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    g.index = quad.index;
    g.setAttribute("position", quad.getAttribute("position"));
    const attr = (n: number) => new THREE.InstancedBufferAttribute(new Float32Array(capacity * n), n).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute("iPos", (this.pos = attr(3)));
    g.setAttribute("iSize", (this.size = attr(2)));
    g.setAttribute("iUv", (this.uv = attr(4)));
    g.setAttribute("iTint", (this.tint = attr(4)));
    g.setAttribute("iAlpha", (this.alpha = attr(2)));
    g.instanceCount = 0;
    const m = sheet.manifest;
    this.ppm = m.pixelsPerMetre ?? 100;
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, depthTest: true,
      defines: opts.keyTint ? { KEY_TINT: "" } : {},
      uniforms: {
        map: { value: sheet.texture },
        pivot: { value: new THREE.Vector2(m.pivot.x, m.pivot.y) },
        right: { value: new THREE.Vector3(1, 0, 0) },
        upScale: { value: 1 / Math.cos(THREE.MathUtils.degToRad(opts.pitchDeg)) },
      },
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
  }

  set(i: number, s: UprightState | null) {
    this.states[i] = s;
  }

  clear() {
    this.states.fill(null);
  }

  /** Writes every sprite for this camera, far ones first. */
  update(camera: THREE.Camera) {
    const m = this.sheet.manifest;
    camera.getWorldDirection(this.dir);
    const cx = this.dir.x, cz = this.dir.z;
    const r = this.mesh.material.uniforms.right!.value as THREE.Vector3;
    const l = Math.hypot(cx, cz) || 1;
    r.set(-cz / l, 0, cx / l);
    this.order.length = 0;
    for (let i = 0; i < this.capacity; i++) {
      const s = this.states[i];
      if (!s) continue;
      this.order.push(i);
      this.depth[i] = s.x * cx + s.y * this.dir.y + s.z * cz;
    }
    this.order.sort((a, b) => this.depth[b]! - this.depth[a]!);
    let n = 0;
    for (const i of this.order) {
      const s = this.states[i]!;
      const d = m.directions > 1 ? directionIndex(screenHeading(Math.sin(s.heading ?? 0), Math.cos(s.heading ?? 0), cx, cz), m) : 0;
      const [u, v, w, h] = cellUv(cellIndex(d, s.frame, m), m);
      const k = (s.scale ?? 1) / this.ppm;
      this.pos.setXYZ(n, s.x, s.y, s.z);
      this.size.setXY(n, m.cell.w * k, m.cell.h * k);
      this.uv.setXYZW(n, u, v, w, h);
      if (s.tint != null) {
        this.col.set(s.tint);
        this.tint.setXYZW(n, this.col.r, this.col.g, this.col.b, 1);
      } else this.tint.setXYZW(n, 1, 1, 1, 0);
      this.alpha.setXY(n, s.alpha ?? 1, s.light ?? 1);
      n++;
    }
    this.mesh.geometry.instanceCount = n;
    for (const a of [this.pos, this.size, this.uv, this.tint, this.alpha]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, Math.max(1, n) * a.itemSize);
      a.needsUpdate = true;
    }
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
