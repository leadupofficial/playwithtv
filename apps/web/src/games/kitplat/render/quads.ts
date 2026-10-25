/**
 * kitplat/render/quads: QuadBatch draws any number of sprites from ONE atlas as instanced quads: one draw call,
 * two triangles per sprite, no per-frame allocations. Each sprite can be mirrored, rotated, squashed and
 * stretched, faded, flashed white, multiplied by a colour, and (with `keyHue`) have only its keyed "paint" texels
 * recoloured, so one hero sheet serves every player colour.
 *
 *   const b = new QuadBatch(atlas, 64, { keyHue: 330 });
 *   b.begin();                                  // every frame (dynamic batches)
 *   b.style.flipX = true; b.style.sy = 1.1;     // optional, reset after each put()
 *   b.put(atlas.manifest.sprites.run, frame, x, y);
 *   b.end();
 */
import * as THREE from "three";
import type { Atlas, SpriteDef } from "./atlas";

export interface QuadStyle {
  sx: number; sy: number; rot: number; alpha: number; flash: number; flipX: boolean;
  /** Multiply colour (0..1 each). */
  r: number; g: number; b: number;
  /** Keyed tint colour and strength (strength 0 = none). */
  tint: THREE.Color | null; tintK: number;
}

const VERT = /* glsl */ `
attribute vec3 iPos;
attribute vec4 iRect;   // size w, h (world), pivot x, y (cell fractions, top-left origin)
attribute vec4 iUv;
attribute vec4 iMul;    // rgb multiply, alpha
attribute vec4 iTint;   // rgb, strength
attribute vec2 iMisc;   // rotation, flash
varying vec2 vUv;
varying vec4 vMul;
varying vec4 vTint;
varying float vFlash;
void main() {
  vec2 c = position.xy + 0.5;
  vec2 off = vec2(c.x - iRect.z, c.y - (1.0 - iRect.w)) * iRect.xy;
  float s = sin(iMisc.x), k = cos(iMisc.x);
  off = vec2(off.x * k - off.y * s, off.x * s + off.y * k);
  gl_Position = projectionMatrix * viewMatrix * vec4(iPos.xy + off, iPos.z, 1.0);
  vUv = iUv.xy + c * iUv.zw;
  vMul = iMul;
  vTint = iTint;
  vFlash = iMisc.y;
}`;

const FRAG = /* glsl */ `
uniform sampler2D map;
uniform vec2 texel;
varying vec2 vUv;
varying vec4 vMul;
varying vec4 vTint;
varying float vFlash;
void main() {
  vec4 t = texture2D(map, vUv);
  float a = t.a * vMul.a;
#ifdef OUTLINE
  // a dark outline around the silhouette (readable from the sofa on any backdrop)
  if (t.a < 0.5) {
    float n = max(max(texture2D(map, vUv + vec2(texel.x, 0.0)).a, texture2D(map, vUv - vec2(texel.x, 0.0)).a),
                  max(texture2D(map, vUv + vec2(0.0, texel.y)).a, texture2D(map, vUv - vec2(0.0, texel.y)).a));
    if (n > 0.5) { gl_FragColor = vec4(0.07, 0.05, 0.1, n * vMul.a * 0.85); return; }
  }
#endif
  if (a < 0.01) discard;
  vec3 rgb = t.rgb;
#ifdef KEY_HUE
  float hi = max(rgb.r, max(rgb.g, rgb.b)), lo = min(rgb.r, min(rgb.g, rgb.b));
  float d = hi - lo;
  float sat = hi > 0.0 ? d / hi : 0.0;
  float h = d <= 0.0 ? 0.0 : hi == rgb.r ? mod((rgb.g - rgb.b) / d, 6.0) : hi == rgb.g ? (rgb.b - rgb.r) / d + 2.0 : (rgb.r - rgb.g) / d + 4.0;
  float dh = abs(h * 60.0 - KEY_HUE);
  dh = min(dh, 360.0 - dh);
  float mask = smoothstep(0.25, 0.45, sat) * (1.0 - smoothstep(24.0, 40.0, dh)) * vTint.a;
  float lum = dot(rgb, vec3(0.299, 0.587, 0.114));
  rgb = mix(rgb, vTint.rgb * (0.35 + lum * 1.6), mask);
#endif
  rgb *= vMul.rgb;
  rgb = mix(rgb, vec3(1.0), vFlash);
  gl_FragColor = vec4(rgb, a);
  #include <colorspace_fragment>
}`;

/** A safe frame index: wraps negatives, treats NaN as 0. */
export function frameIndex(f: number, n: number): number {
  const i = Math.floor(f) || 0;
  return ((i % n) + n) % n;
}

const DEFAULT: QuadStyle = { sx: 1, sy: 1, rot: 0, alpha: 1, flash: 0, flipX: false, r: 1, g: 1, b: 1, tint: null, tintK: 0 };

export class QuadBatch {
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  readonly style: QuadStyle = { ...DEFAULT };
  n = 0;
  private pos: THREE.InstancedBufferAttribute;
  private rect: THREE.InstancedBufferAttribute;
  private uv: THREE.InstancedBufferAttribute;
  private mul: THREE.InstancedBufferAttribute;
  private tint: THREE.InstancedBufferAttribute;
  private misc: THREE.InstancedBufferAttribute;
  private ppm: number;
  private aw: number;
  private ah: number;
  /** Instances below this index are kept by begin() (a static prefix, e.g. the level's tiles). */
  keep = 0;

  constructor(readonly atlas: Atlas, readonly capacity: number, opts: { keyHue?: number; z?: number; order?: number; outline?: number } = {}) {
    const g = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    g.index = quad.index;
    g.setAttribute("position", quad.getAttribute("position"));
    const attr = (n: number) => new THREE.InstancedBufferAttribute(new Float32Array(capacity * n), n).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute("iPos", (this.pos = attr(3)));
    g.setAttribute("iRect", (this.rect = attr(4)));
    g.setAttribute("iUv", (this.uv = attr(4)));
    g.setAttribute("iMul", (this.mul = attr(4)));
    g.setAttribute("iTint", (this.tint = attr(4)));
    g.setAttribute("iMisc", (this.misc = attr(2)));
    g.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide,
      defines: { ...(opts.keyHue !== undefined ? { KEY_HUE: opts.keyHue.toFixed(1) } : {}), ...(opts.outline ? { OUTLINE: "" } : {}) },
      uniforms: { map: { value: atlas.texture }, texel: { value: new THREE.Vector2(1, 1) } },
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    if (opts.outline) {
      // outline width in texels of the texture actually loaded (the half-size lite copy has half the texels)
      const img = atlas.texture.image as { width?: number; height?: number; naturalWidth?: number; naturalHeight?: number };
      const tw = img.naturalWidth || img.width || atlas.manifest.size.w, th = img.naturalHeight || img.height || atlas.manifest.size.h;
      (mat.uniforms.texel!.value as THREE.Vector2).set(opts.outline / tw, opts.outline / th);
    }
    this.mesh.renderOrder = opts.order ?? 0;
    this.ppm = atlas.manifest.ppm;
    this.aw = atlas.manifest.size.w;
    this.ah = atlas.manifest.size.h;
    this.z = opts.z ?? 0;
    this.attrs = [this.pos, this.rect, this.uv, this.mul, this.tint, this.misc];
  }

  private z: number;
  private attrs: THREE.InstancedBufferAttribute[] = [];

  sprite(id: string): SpriteDef {
    const s = this.atlas.manifest.sprites[id];
    if (!s) throw new Error(`sprite ${id} not in ${this.atlas.manifest.name}`);
    return s;
  }

  has(id: string): boolean {
    return id in this.atlas.manifest.sprites;
  }

  begin() {
    this.n = this.keep;
  }

  /** Draws frame `f` of a sprite with its pivot (ground point) at (x, y). Returns false when the batch is full. */
  put(s: SpriteDef, f: number, x: number, y: number): boolean {
    const r = s.frames[frameIndex(f, s.frames.length)]!;
    const st = this.style;
    const w = (r.w / this.ppm) * st.sx * (st.flipX ? -1 : 1), h = (r.h / this.ppm) * st.sy;
    return this.write(r, x, y, w, h, s.pivot.x, s.pivot.y);
  }

  /** Draws frame `f` of a sprite stretched over the box [x, x+w] × [y, y+h] (tiles). */
  putBox(s: SpriteDef, f: number, x: number, y: number, w: number, h: number): boolean {
    const r = s.frames[frameIndex(f, s.frames.length)]!;
    return this.write(r, x, y, w, h, 0, 1);
  }

  private write(r: { x: number; y: number; w: number; h: number }, x: number, y: number, w: number, h: number, px: number, py: number): boolean {
    const st = this.style;
    if (this.n >= this.capacity) { this.reset(); return false; }
    const i = this.n++;
    // half a texel inset so bilinear filtering never bleeds a neighbour's pixels in
    this.pos.setXYZ(i, x, y, this.z);
    this.rect.setXYZW(i, w, h, px, py);
    this.uv.setXYZW(i, (r.x + 0.5) / this.aw, 1 - (r.y + r.h - 0.5) / this.ah, (r.w - 1) / this.aw, (r.h - 1) / this.ah);
    this.mul.setXYZW(i, st.r, st.g, st.b, st.alpha);
    if (st.tint && st.tintK > 0) this.tint.setXYZW(i, st.tint.r, st.tint.g, st.tint.b, st.tintK);
    else this.tint.setXYZW(i, 1, 1, 1, 0);
    this.misc.setXY(i, st.rot, st.flash);
    this.reset();
    return true;
  }

  private reset() {
    const st = this.style;
    st.sx = st.sy = st.alpha = st.r = st.g = st.b = 1;
    st.rot = st.flash = st.tintK = 0;
    st.flipX = false;
    st.tint = null;
  }

  /** Uploads the instances written since begin() (or all, after a static fill). */
  end(from = this.keep) {
    const g = this.mesh.geometry;
    g.instanceCount = this.n;
    for (const a of this.attrs) {
      a.clearUpdateRanges();
      if (this.n > from) a.addUpdateRange(from * a.itemSize, (this.n - from) * a.itemSize);
      a.needsUpdate = this.n > from;
    }
  }

  /** Makes everything written so far permanent (kept by begin()). */
  freeze() {
    this.end(0);
    this.keep = this.n;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
