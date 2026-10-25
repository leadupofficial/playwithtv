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
 * Options (SpriteBatchOptions): `keyHue` tints only paint of one hue (e.g. magenta paint, so skin and lamps keep
 * their colour), `depthBias` lets billboards stand on a 3D road under a low perspective camera, and
 * `flipY` on a sprite draws its reflection (a wet road: a second batch with depthTest off and low opacity).
 */
import * as THREE from "three";
import { getQuality } from "../../quality/store";
import { type SpriteManifest, cellIndex, cellUv, directionIndex, frameAt, parseManifest, screenHeading, worldSize } from "./manifest";

export interface SpriteSheet {
  manifest: SpriteManifest;
  texture: THREE.Texture;
  normals: THREE.Texture | null;
  /** Base URL the manifest's files were resolved against. */
  url: string;
}

const sheets = new Map<string, Promise<SpriteSheet>>();

/**
 * Largest atlas side kept in memory on the lite tier. A 1 GB TV's WebView is killed when a game decodes a few
 * hundred MB of sprite atlases (Kalari Clash ships 3840 px sheets: 57 MB of RGBA each). Capped at 1536 px a sheet
 * costs at most 9.4 MB. UVs are fractions of the atlas, so a shrunk atlas needs no other change. 0 = no cap.
 */
export function liteAtlasCap(): number {
  return getQuality().profile.prerendered ? 1536 : 0;
}

/** The scale an atlas of w×h needs to fit `cap` (1 when it already fits or there is no cap). */
export function atlasScale(w: number, h: number, cap: number): number {
  return cap > 0 && Math.max(w, h) > cap ? cap / Math.max(w, h) : 1;
}

function loadTexture(url: string, cap: number): Promise<THREE.Texture> {
  // TextureLoader decodes through an <img> element: allowed by our CSP (img-src 'self'), no blob: fetch.
  return new THREE.TextureLoader().loadAsync(url).then((loaded) => {
    let t: THREE.Texture = loaded;
    const img = loaded.image as HTMLImageElement;
    const k = atlasScale(img.naturalWidth || img.width, img.naturalHeight || img.height, cap);
    if (k < 1) {
      // shrink once on a canvas, upload it, then give the canvas memory back (the TV never re-uploads)
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(img.naturalWidth * k));
      c.height = Math.max(1, Math.round(img.naturalHeight * k));
      const g = c.getContext("2d")!;
      g.imageSmoothingQuality = "high";
      g.drawImage(img, 0, 0, c.width, c.height);
      loaded.dispose();
      t = new THREE.CanvasTexture(c);
      t.onUpdate = () => {
        c.width = c.height = 1;
      };
    }
    t.colorSpace = THREE.SRGBColorSpace;
    t.generateMipmaps = false; // atlases are NPOT; bilinear without mips is crisp at TV sprite sizes
    t.minFilter = THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    return t;
  });
}

/**
 * Loads a manifest and its atlas (WebP, falling back to PNG if listed); cached per URL. On the lite tier atlases
 * are shrunk to fit `maxSize` (default liteAtlasCap(): 1536 px) and the normal sheet is skipped, to protect 1 GB TVs
 * (setLight() then does nothing). Pass maxSize: 0 to keep full size.
 */
export function loadSpriteSheet(manifestUrl: string, opts: { normals?: boolean; maxSize?: number } = {}): Promise<SpriteSheet> {
  const cap = opts.maxSize ?? liteAtlasCap();
  const key = `${manifestUrl}|${opts.normals ? 1 : 0}|${cap}`;
  let p = sheets.get(key);
  if (!p) {
    p = (async () => {
      const res = await fetch(manifestUrl);
      if (!res.ok) throw new Error(`sprite manifest ${manifestUrl}: HTTP ${res.status}`);
      const manifest = parseManifest(await res.json());
      const base = new URL(manifestUrl, location.href);
      const at = (f: string) => new URL(f, base).pathname;
      // a TV loads the pre-shrunk copy when there is one, so it never decodes the full-size atlas at all
      const lite = cap && manifest.lite ? await loadTexture(at(manifest.lite), cap).catch(() => null) : null;
      const texture = lite ?? await loadTexture(at(manifest.image), cap).catch((e) => {
        if (!manifest.fallback) throw e;
        return loadTexture(at(manifest.fallback), cap);
      });
      // the normal sheet only adds light (lightning flashes): a capped (TV) budget skips it, saving half the memory
      const normals = opts.normals && manifest.normals && !cap ? await loadTexture(at(manifest.normals), 0) : null;
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
  /** Mirror the sprite about its ground line (a reflection on a wet road; draw it before the real sprites). */
  flipY?: boolean;
}

/** Optional batch settings (all default off, so existing batches draw exactly as before). */
export interface SpriteBatchOptions {
  /** Tint only paint of this hue (degrees, e.g. 300 for magenta paint), so skin, lamps and trim keep colour. */
  keyHue?: number;
  /** Half-width of the keyed hue band (degrees, default 40). */
  hueWidth?: number;
  /**
   * Pulls every sprite this many metres towards a perspective camera (keeping its screen size), so the part of
   * a billboard below its ground point is not clipped by the road it stands on.
   */
  depthBias?: number;
  /** Turn depth testing off (e.g. reflections drawn straight onto the road). */
  depthTest?: boolean;
}

const VERT = /* glsl */ `
attribute vec3 iPos;
attribute vec2 iSize;
attribute vec4 iUv;
attribute vec4 iTint;
attribute float iAlpha;
uniform vec2 pivot;
uniform float depthBias;
varying vec2 vUv;
varying vec4 vTint;
varying float vAlpha;
void main() {
  // corner in cell space (0..1, y up), shifted so the pivot (the model's ground point) sits on iPos
  vec2 c = position.xy + 0.5;
  vec2 off = vec2(c.x - pivot.x, c.y - (1.0 - pivot.y)) * iSize;
  vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
  if (depthBias > 0.0 && mv.z < 0.0) {
    float b = min(depthBias, -mv.z * 0.5);
    off *= (-mv.z - b) / -mv.z;       // closer but the same size on screen
    mv.z += b;
  }
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
#ifdef KEY_HUE
  // only texels near the paint's hue take the tint
  float hd = hi - lo;
  float h = hd <= 0.0 ? 0.0 : hi == rgb.r ? mod((rgb.g - rgb.b) / hd, 6.0) : hi == rgb.g ? (rgb.b - rgb.r) / hd + 2.0 : (rgb.r - rgb.g) / hd + 4.0;
  float dh = abs(h * 60.0 - KEY_HUE);
  dh = min(dh, 360.0 - dh);
  mask *= 1.0 - smoothstep(HUE_WIDTH * 0.6, HUE_WIDTH, dh);
#endif
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

  constructor(sheet: SpriteSheet, readonly capacity: number, opts: SpriteBatchOptions = {}) {
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
      depthTest: opts.depthTest ?? true,
      side: THREE.DoubleSide, // a flipY reflection reverses the quad's winding
      defines: {
        ...(sheet.normals ? { USE_NORMALS: "" } : {}),
        ...(opts.keyHue !== undefined ? { KEY_HUE: opts.keyHue.toFixed(1), HUE_WIDTH: (opts.hueWidth ?? 40).toFixed(1) } : {}),
      },
      uniforms: {
        map: { value: sheet.texture },
        depthBias: { value: opts.depthBias ?? 0 },
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

  /** Sprite `i`'s current state (null if empty), e.g. to adjust it per view before update(). */
  get(i: number): SpriteState | null {
    return this.states[i] ?? null;
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
      this.size.setXY(n, size.w, s.flipY ? -size.h : size.h);
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
