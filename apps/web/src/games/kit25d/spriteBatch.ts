/**
 * kit25d/spriteBatch: pre-rendered direction sprites (render_sprites.py output) drawn as camera-facing quads in
 * ONE InstancedMesh: one draw call for every car, scooter or fighter of a sheet, on a 1 GB TV.
 *
 *   const sheet = await loadSpriteSheet("/assets/cinematic/showroom/hatchback.json");
 *   const batch = new SpriteBatch(sheet, 8);               // capacity 8 sprites
 *   scene.add(batch.mesh);
 *   batch.set(0, { x, y: 0, z, heading, tint: "#ff4fa0" }); // heading in the world (radians, see below)
 *   batch.update(camera, seconds);                          // once per frame, before renderer.render()
 *
 * World headings: `heading` is the yaw of the object's forward vector on the ground, three.js style:
 * forward = (sin(heading), 0, cos(heading)) (0 = +Z). update() converts it to the screen-relative heading the
 * sheet is indexed by, so sprites turn correctly whatever the camera's yaw. Keep the game camera's pitch close
 * to the sheet's camera.elevationDeg (30° by default) or the illusion breaks.
 *
 * Extras: tint recolours only the saturated "paint" texels (keeps tyres, glass and shading); with a normals
 * sheet, setLight() relights sprites cheaply (lightning flashes, headlights sweeping past).
 */
import * as THREE from "three";
import { type SpriteManifest, cellIndex, cellUv, directionIndex, frameAt, parseManifest, screenHeading, worldSize } from "./manifest";

export interface SpriteSheet {
  manifest: SpriteManifest;
  texture: THREE.Texture;
  normals: THREE.Texture | null;
  /** Base URL the manifest's files were resolved against. */
  url: string;
}

const sheets = new Map<string, Promise<SpriteSheet>>();

function loadTexture(url: string): Promise<THREE.Texture> {
  // TextureLoader decodes through an <img> element: allowed by our CSP (img-src 'self'), no blob: fetch.
  return new THREE.TextureLoader().loadAsync(url).then((t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    t.generateMipmaps = false; // atlases are NPOT; bilinear without mips is crisp at TV sprite sizes
    t.minFilter = THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    return t;
  });
}

/** Loads a manifest and its atlas (WebP, falling back to PNG if listed); cached per URL. */
export function loadSpriteSheet(manifestUrl: string, opts: { normals?: boolean } = {}): Promise<SpriteSheet> {
  const key = `${manifestUrl}|${opts.normals ? 1 : 0}`;
  let p = sheets.get(key);
  if (!p) {
    p = (async () => {
      const res = await fetch(manifestUrl);
      if (!res.ok) throw new Error(`sprite manifest ${manifestUrl}: HTTP ${res.status}`);
      const manifest = parseManifest(await res.json());
      const base = new URL(manifestUrl, location.href);
      const at = (f: string) => new URL(f, base).pathname;
      const texture = await loadTexture(at(manifest.image)).catch((e) => {
        if (!manifest.fallback) throw e;
        return loadTexture(at(manifest.fallback));
      });
      const normals = opts.normals && manifest.normals ? await loadTexture(at(manifest.normals)) : null;
      if (normals) normals.colorSpace = THREE.NoColorSpace;
      return { manifest, texture, normals, url: manifestUrl };
    })();
    p.catch(() => sheets.delete(key));
    sheets.set(key, p);
  }
  return p;
}

export interface SpriteState {
  x: number; y: number; z: number;
  /** World yaw of the object's forward vector (0 = +Z). */
  heading: number;
  /** Animation time in seconds (frames loop at the sheet's fps). */
  time?: number;
  /** Size multiplier (1 = rendered size). */
  scale?: number;
  /** Player colour for the paint; null keeps the original. */
  tint?: THREE.ColorRepresentation | null;
  /** 0..1 how strongly the paint takes the tint (default 0.85). */
  tintStrength?: number;
  opacity?: number;
  visible?: boolean;
}

const VERT = /* glsl */ `
attribute vec3 iPos;
attribute vec2 iSize;
attribute vec4 iUv;
attribute vec4 iTint;
attribute float iAlpha;
uniform vec2 pivot;
varying vec2 vUv;
varying vec4 vTint;
varying float vAlpha;
void main() {
  // corner in cell space (0..1, y up), shifted so the pivot (the model's ground point) sits on iPos
  vec2 c = position.xy + 0.5;
  vec2 off = vec2(c.x - pivot.x, c.y - (1.0 - pivot.y)) * iSize;
  vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
  mv.xy += off;                       // screen-aligned billboard: the sheet already has the camera's pitch
  gl_Position = projectionMatrix * mv;
  vUv = iUv.xy + c * iUv.zw;
  vTint = iTint;
  vAlpha = iAlpha;
}`;

const FRAG = /* glsl */ `
uniform sampler2D map;
#ifdef USE_NORMALS
uniform sampler2D normalSheet;
uniform vec3 lightDir;
uniform vec3 lightColor;
uniform float relight;
#endif
varying vec2 vUv;
varying vec4 vTint;
varying float vAlpha;
void main() {
  vec4 t = texture2D(map, vUv);
  if (t.a * vAlpha < 0.004) discard;
  vec3 rgb = t.rgb;
  // recolour saturated (paint) texels only, keeping their lighting
  float hi = max(rgb.r, max(rgb.g, rgb.b)), lo = min(rgb.r, min(rgb.g, rgb.b));
  float sat = hi > 0.0 ? (hi - lo) / hi : 0.0;
  float mask = smoothstep(0.18, 0.4, sat) * vTint.a;
  float lum = dot(rgb, vec3(0.299, 0.587, 0.114));
  rgb = mix(rgb, vTint.rgb * lum * 1.7, mask);
#ifdef USE_NORMALS
  vec3 n = texture2D(normalSheet, vUv).rgb * 2.0 - 1.0;
  float d = max(dot(normalize(n), lightDir), 0.0);
  rgb += rgb * lightColor * d * relight;
#endif
  gl_FragColor = vec4(rgb, t.a * vAlpha);
  #include <colorspace_fragment>
}`;

/** Draws up to `capacity` sprites of one sheet in a single draw call. */
export class SpriteBatch {
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  readonly sheet: SpriteSheet;
  private states: (SpriteState | null)[];
  private pos: THREE.InstancedBufferAttribute;
  private size: THREE.InstancedBufferAttribute;
  private uv: THREE.InstancedBufferAttribute;
  private tint: THREE.InstancedBufferAttribute;
  private alpha: THREE.InstancedBufferAttribute;
  private order: number[] = [];
  private tmp = new THREE.Vector3();
  private camPos = new THREE.Vector3();
  private col = new THREE.Color();

  constructor(sheet: SpriteSheet, readonly capacity: number) {
    this.sheet = sheet;
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
    g.setAttribute("iAlpha", (this.alpha = attr(1)));
    g.instanceCount = 0;
    const m = sheet.manifest;
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      defines: sheet.normals ? { USE_NORMALS: "" } : {},
      uniforms: {
        map: { value: sheet.texture },
        pivot: { value: new THREE.Vector2(m.pivot.x, m.pivot.y) },
        normalSheet: { value: sheet.normals },
        lightDir: { value: new THREE.Vector3(0, 0.6, 0.8).normalize() },
        lightColor: { value: new THREE.Color(0, 0, 0) },
        relight: { value: 0 },
      },
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false; // instances move freely; culling the whole batch by one box would be wrong
  }

  /** Sets (or with null, removes) sprite `i`. */
  set(i: number, s: SpriteState | null) {
    this.states[i] = s;
  }

  /**
   * Adds light from a camera-space direction (x right, y up, z towards the viewer), e.g. a lightning flash:
   * setLight([0.3, 0.8, 0.5], "#cfe4ff", 1.2). Needs a sheet loaded with { normals: true }.
   */
  setLight(dir: [number, number, number], color: THREE.ColorRepresentation, strength: number) {
    const u = this.mesh.material.uniforms;
    (u.lightDir!.value as THREE.Vector3).set(...dir).normalize();
    (u.lightColor!.value as THREE.Color).set(color);
    u.relight!.value = strength;
  }

  /** Writes every visible sprite's cell, size and colour for this camera; far sprites first (correct blending). */
  update(camera: THREE.Camera, seconds = 0) {
    const m = this.sheet.manifest;
    camera.getWorldDirection(this.tmp);
    const cx = this.tmp.x, cz = this.tmp.z;
    const camPos = camera.getWorldPosition(this.camPos);
    this.order.length = 0;
    for (let i = 0; i < this.capacity; i++) {
      const s = this.states[i];
      if (s && s.visible !== false) this.order.push(i);
    }
    const d2 = (i: number) => {
      const s = this.states[i]!;
      return (s.x - camPos.x) ** 2 + (s.y - camPos.y) ** 2 + (s.z - camPos.z) ** 2;
    };
    this.order.sort((a, b) => d2(b) - d2(a));
    let n = 0;
    for (const i of this.order) {
      const s = this.states[i]!;
      const h = screenHeading(Math.sin(s.heading), Math.cos(s.heading), cx, cz);
      const cell = cellIndex(directionIndex(h, m), frameAt(s.time ?? seconds, m), m);
      const [u, v, w, hh] = cellUv(cell, m);
      const size = worldSize(m, s.scale ?? 1);
      this.pos.setXYZ(n, s.x, s.y, s.z);
      this.size.setXY(n, size.w, size.h);
      this.uv.setXYZW(n, u, v, w, hh);
      if (s.tint != null) {
        this.col.set(s.tint);
        this.tint.setXYZW(n, this.col.r, this.col.g, this.col.b, s.tintStrength ?? 0.85);
      } else this.tint.setXYZW(n, 1, 1, 1, 0);
      this.alpha.setX(n, s.opacity ?? 1);
      n++;
    }
    const g = this.mesh.geometry;
    g.instanceCount = n;
    for (const a of [this.pos, this.size, this.uv, this.tint, this.alpha]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, n * a.itemSize);
      a.needsUpdate = true;
    }
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
