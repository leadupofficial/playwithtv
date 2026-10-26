/**
 * CITY RIVALS on the TV: one scene, drawn once per split-screen view. Dusk in an Indian city: warm low sun, lit
 * windows, shop signs, street lamps, rooftop water tanks, a maidan with trees, a plaza fountain.
 *
 * The whole world is built in code from district.ts (a handful of merged meshes: ~30 draw calls a view), the
 * vehicles are the GHAT RUSH models (tools/blender/models/ghat_rush.py). Lite (TV boxes): Lambert, no shadows,
 * 960 × 540. High / ultra: Standard materials, one sun shadow over the whole district, a room environment for
 * the wet-asphalt sheen, MSAA where the profile has it.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { QualityProfile } from "../../quality/tier";
import { cloneModel, loadGltf } from "../kit3d/assets";
import { prepareModel } from "../kit3d/cinematic";
import { blobShadow, fadeBlob } from "../kit3d/blobShadow";
import { renderViews, type View } from "../kit3d/multiview";
import { loadProps, type PropName } from "../ghat/props";
import { BASE } from "../ghat/vehicles";
import { BOUND, EXTENT, GRID, ROAD_HW, at, type District } from "./district";
import { KINDS, STATS, type Car, type Kind } from "./car";
import { follow, newChase, type Chase } from "./chase";

export const FOG = "#c98a74";
const SKY_TOP = "#3b3f78", SKY_MID = "#c77a8a", SKY_LOW = "#ffb07a";
const SIGNS = ["CHAI", "VADA PAV", "MOBILES", "SWEETS", "TAILOR", "BIRYANI", "CINEMA", "PHARMACY"];
const SIGN_COLORS = ["#ff4f7b", "#41e0ff", "#ffd23f", "#7cff6b", "#ff8c2b", "#c77dff", "#ff4f4f", "#4fff9c"];

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return { c, g: c.getContext("2d")! };
}

/** Facade: 4 × 4 window cells (3.5 m × 3.2 m each). `lit` → the emissive version (only some windows glow). */
function facadeTextures(): { map: THREE.Texture; glow: THREE.Texture } {
  const N = 4, S = 512, cell = S / N;
  const a = canvas(S, S), b = canvas(S, S), rnd = rng(77);
  a.g.fillStyle = "#d9d2c5";
  a.g.fillRect(0, 0, S, S);
  b.g.fillStyle = "#000";
  b.g.fillRect(0, 0, S, S);
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const x = i * cell, y = j * cell;
      // plaster noise
      a.g.fillStyle = `rgba(0,0,0,${0.03 + rnd() * 0.05})`;
      a.g.fillRect(x, y, cell, cell);
      // floor band
      a.g.fillStyle = "rgba(0,0,0,0.12)";
      a.g.fillRect(x, y + cell - 8, cell, 8);
      // window with a sunshade
      const wx = x + cell * 0.2, wy = y + cell * 0.22, ww = cell * 0.6, wh = cell * 0.5;
      a.g.fillStyle = "#2a3242";
      a.g.fillRect(wx, wy, ww, wh);
      a.g.fillStyle = "rgba(255,255,255,0.18)";
      a.g.fillRect(wx + 3, wy + 3, ww * 0.35, wh - 6);
      a.g.fillStyle = "#6b6258";
      a.g.fillRect(wx - 6, wy - 9, ww + 12, 7);
      a.g.fillStyle = "#3d3832";
      for (let k = 1; k < 4; k++) a.g.fillRect(wx + (ww * k) / 4 - 1, wy, 2, wh); // grille
      if (rnd() < 0.45) {
        const warm = rnd() < 0.75;
        b.g.fillStyle = warm ? `rgb(255,${190 + Math.floor(rnd() * 40)},${110 + Math.floor(rnd() * 40)})` : "#bfe3ff";
        b.g.fillRect(wx, wy, ww, wh);
        a.g.fillStyle = warm ? "#e8c27e" : "#a8c8e0";
        a.g.fillRect(wx, wy, ww, wh);
        b.g.fillStyle = "#000";
        for (let k = 1; k < 4; k++) b.g.fillRect(wx + (ww * k) / 4 - 1, wy, 2, wh);
      }
    }
  }
  const t = (c: HTMLCanvasElement) => {
    const x = new THREE.CanvasTexture(c);
    x.wrapS = x.wrapT = THREE.RepeatWrapping;
    x.colorSpace = THREE.SRGBColorSpace;
    x.anisotropy = 4;
    return x;
  };
  return { map: t(a.c), glow: t(b.c) };
}

function asphaltTexture(): THREE.Texture {
  const S = 256, { c, g } = canvas(S, S), rnd = rng(5);
  g.fillStyle = "#3a3b40";
  g.fillRect(0, 0, S, S);
  for (let k = 0; k < 2600; k++) {
    const v = 40 + Math.floor(rnd() * 40);
    g.fillStyle = `rgba(${v},${v},${v + 4},0.5)`;
    g.fillRect(rnd() * S, rnd() * S, 2, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(40, 40);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function signAtlas(): THREE.Texture {
  const W = 512, H = 64 * SIGNS.length, { c, g } = canvas(W, H);
  g.fillStyle = "#000";
  g.fillRect(0, 0, W, H);
  SIGNS.forEach((s, i) => {
    const y = i * 64;
    g.fillStyle = "#14101c";
    g.fillRect(4, y + 4, W - 8, 56);
    g.strokeStyle = SIGN_COLORS[i]!;
    g.lineWidth = 4;
    g.strokeRect(8, y + 8, W - 16, 48);
    g.fillStyle = SIGN_COLORS[i]!;
    g.font = "bold 40px sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(s, W / 2, y + 33);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function skyTexture(): THREE.Texture {
  const { c, g } = canvas(4, 256);
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, SKY_TOP);
  grd.addColorStop(0.32, SKY_MID);
  grd.addColorStop(0.5, SKY_LOW);
  grd.addColorStop(0.56, FOG);
  grd.addColorStop(1, "#4a3a44");
  g.fillStyle = grd;
  g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function glowTexture(): THREE.Texture {
  const { c, g } = canvas(64, 64);
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, "rgba(255,240,200,1)");
  grd.addColorStop(0.25, "rgba(255,200,120,0.6)");
  grd.addColorStop(1, "rgba(255,160,80,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/** Quads into growing arrays (position, normal, uv, color), merged into one geometry at the end. */
class QuadBuilder {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  idx: number[] = [];
  /** Four corners in order (counter-clockwise seen from the front), normal, uvs per corner, colour. */
  quad(p: Array<[number, number, number]>, n: [number, number, number], uv: Array<[number, number]>, c: THREE.Color) {
    const base = this.pos.length / 3;
    p.forEach((v, i) => {
      this.pos.push(...v);
      this.nor.push(...n);
      this.uv.push(...uv[i]!);
      this.col.push(c.r, c.g, c.b);
    });
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    return g;
  }
}

const CELL_W = 3.5 * 4, CELL_H = 3.2 * 4; // the facade texture covers 4 × 4 cells

export interface CarModel { root: THREE.Group; bodies: Map<Kind, THREE.Object3D>; shadow: THREE.Mesh; kind: Kind }

export interface ViewSlot {
  rect: { x: number; y: number; w: number; h: number };
  /** The car this view follows (index into cars) or null for the overview camera. */
  car: number | null;
  /** Gate index to light up for this view. */
  gate: number;
  color: string;
}

export class CityView {
  readonly scene = new THREE.Scene();
  readonly renderer: THREE.WebGLRenderer;
  private width: number;
  private height: number;
  private cams: THREE.PerspectiveCamera[] = [];
  private chases: Chase[] = [];
  private overview = new THREE.PerspectiveCamera(50, 16 / 9, 1, 1200);
  cars: CarModel[] = [];
  private coins!: THREE.InstancedMesh;
  private beacons: THREE.Mesh[] = [];
  private rings: THREE.Mesh[] = [];
  private tmp = new THREE.Object3D();
  private disposables: Array<{ dispose(): void }> = [];
  readonly lite: boolean;
  private time = 0;
  private coinsOn: boolean[][] = [];

  private constructor(readonly canvas: HTMLCanvasElement, readonly q: QualityProfile, readonly d: District, views: number) {
    this.lite = q.prerendered;
    const res = this.lite ? { w: 960, h: 540 } : q.resolution.w > 1920 ? { w: 1920, h: 1080 } : q.resolution;
    this.width = res.w;
    this.height = res.h;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !this.lite && q.msaa, powerPreference: "high-performance", stencil: false });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(this.width, this.height, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    if (!this.lite) {
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.05;
      if (q.shadows.enabled) {
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = q.shadows.soft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
      }
      const pm = new THREE.PMREMGenerator(this.renderer);
      const env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
      this.scene.environment = env;
      this.disposables.push(env, pm);
    }
    const sky = skyTexture();
    this.disposables.push(sky);
    this.scene.background = sky;
    this.scene.fog = new THREE.Fog(FOG, this.lite ? 60 : 90, this.lite ? 230 : 330);
    for (let i = 0; i < Math.max(1, views); i++) {
      this.cams.push(new THREE.PerspectiveCamera(62, 16 / 9, 0.3, this.lite ? 240 : 420));
      this.chases.push(newChase());
    }
    this.lights();
  }

  static async create(canvas: HTMLCanvasElement, q: QualityProfile, d: District, field: Array<{ color: string }>, views: number, onProgress?: (p: number) => void): Promise<CityView> {
    const v = new CityView(canvas, q, d, views);
    let n = 0;
    const files = KINDS.map((k) => `${BASE}/${k}-high.glb`);
    const step = () => onProgress?.(++n / (files.length + 1));
    const [models, props] = await Promise.all([
      Promise.all(files.map((f) => loadGltf(f).then((g) => (step(), g)))),
      loadProps(`${BASE}/props.glb`).then((p) => (step(), p)),
    ]);
    v.buildWorld(props);
    v.buildCars(models.map((m) => m.scene), field);
    return v;
  }

  private lights() {
    const hemi = new THREE.HemisphereLight("#ffd2b0", "#3a3048", this.lite ? 1.5 : 0.9);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight("#ffb27a", this.lite ? 1.7 : 2.4);
    const c = EXTENT / 2;
    sun.position.set(c - 120, 70, c + 60);
    sun.target.position.set(c, 0, c);
    this.scene.add(sun, sun.target);
    if (!this.lite && this.q.shadows.enabled) {
      sun.castShadow = true;
      sun.shadow.mapSize.set(this.q.shadows.mapSize >= 2048 ? 4096 : 2048, this.q.shadows.mapSize >= 2048 ? 4096 : 2048);
      const s = sun.shadow.camera;
      s.left = -150; s.right = 150; s.top = 150; s.bottom = -150; s.near = 10; s.far = 320;
      sun.shadow.bias = -0.0006;
      sun.shadow.normalBias = 0.4;
      s.updateProjectionMatrix();
    }
  }

  private mat(o: { color?: THREE.ColorRepresentation; map?: THREE.Texture; emissive?: THREE.ColorRepresentation; emissiveMap?: THREE.Texture; emissiveIntensity?: number; rough?: number; metal?: number; vertexColors?: boolean; transparent?: boolean; opacity?: number }) {
    const base = { color: o.color ?? "#ffffff", map: o.map ?? null, emissive: o.emissive ?? "#000000", emissiveMap: o.emissiveMap ?? null, emissiveIntensity: o.emissiveIntensity ?? 1, vertexColors: !!o.vertexColors, transparent: !!o.transparent, opacity: o.opacity ?? 1 };
    const m = this.lite ? new THREE.MeshLambertMaterial(base) : new THREE.MeshStandardMaterial({ ...base, roughness: o.rough ?? 0.8, metalness: o.metal ?? 0 });
    this.disposables.push(m);
    return m;
  }

  private add(geo: THREE.BufferGeometry, m: THREE.Material, shadows: { cast?: boolean; receive?: boolean } = {}) {
    const mesh = new THREE.Mesh(geo, m);
    const sh = !this.lite && this.q.shadows.enabled;
    mesh.castShadow = sh && !!shadows.cast;
    mesh.receiveShadow = sh && !!shadows.receive;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.scene.add(mesh);
    this.disposables.push(geo);
    return mesh;
  }

  private buildWorld(props: Map<PropName, THREE.BufferGeometry>) {
    const d = this.d, rnd = rng(42), white = new THREE.Color(1, 1, 1);
    // ground: asphalt everywhere, then pavements, grass and the plaza on top
    const asphalt = asphaltTexture();
    this.disposables.push(asphalt);
    const size = BOUND.max - BOUND.min + 240;
    const ground = new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2).translate(EXTENT / 2, 0, EXTENT / 2);
    this.add(ground, this.mat({ map: asphalt, color: "#8a8a92", rough: 0.78 }), { receive: true });
    const slabs: THREE.BufferGeometry[] = [], grass: THREE.BufferGeometry[] = [], plaza: THREE.BufferGeometry[] = [];
    for (const b of d.blocks) {
      const g = new THREE.BoxGeometry(b.x1 - b.x0, 0.2, b.z1 - b.z0).translate((b.x0 + b.x1) / 2, 0.1, (b.z0 + b.z1) / 2);
      (b.kind === "park" ? grass : b.kind === "plaza" ? plaza : slabs).push(g);
    }
    this.add(mergeGeometries(slabs)!, this.mat({ color: "#857e76", rough: 0.95 }), { receive: true });
    this.add(mergeGeometries(grass)!, this.mat({ color: "#4f7a3a", rough: 1 }), { receive: true });
    this.add(mergeGeometries(plaza)!, this.mat({ color: "#c9b79a", rough: 0.85 }), { receive: true });
    // the outer wall: a low concrete barrier with a fence feel, and a dark ring of far buildings beyond it
    const wall = new QuadBuilder(), wc = new THREE.Color("#7d746c");
    const lo = BOUND.min, hi = BOUND.max, wh = 1.4;
    wall.quad([[lo, 0, lo], [hi, 0, lo], [hi, wh, lo], [lo, wh, lo]], [0, 0, 1], [[0, 0], [1, 0], [1, 1], [0, 1]], wc);
    wall.quad([[hi, 0, hi], [lo, 0, hi], [lo, wh, hi], [hi, wh, hi]], [0, 0, -1], [[0, 0], [1, 0], [1, 1], [0, 1]], wc);
    wall.quad([[lo, 0, hi], [lo, 0, lo], [lo, wh, lo], [lo, wh, hi]], [1, 0, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], wc);
    wall.quad([[hi, 0, lo], [hi, 0, hi], [hi, wh, hi], [hi, wh, lo]], [-1, 0, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], wc);
    this.add(wall.build(), this.mat({ vertexColors: true, rough: 0.9 }), { receive: true });
    const tex = facadeTextures();
    this.disposables.push(tex.map, tex.glow);
    // the rest of the city: a ring of towers beyond the wall, darker and hazier with distance (one draw call)
    const sky: Array<[number, number, number, number, number]> = [];
    const c0 = EXTENT / 2;
    for (let k = 0; k < 90; k++) {
      const a = (k / 90) * Math.PI * 2 + rnd() * 0.03;
      const r = 225 + rnd() * 110 + (k % 3) * 25;
      sky.push([c0 + Math.cos(a) * r, c0 + Math.sin(a) * r, 10 + rnd() * 14, 25 + rnd() * 60, 10 + rnd() * 14]);
    }
    const tg = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    const towers = new THREE.InstancedMesh(tg, this.mat({ map: tex.map, emissive: "#ffffff", emissiveMap: tex.glow, emissiveIntensity: this.lite ? 0.6 : 0.9, color: "#9a8f9e", rough: 0.9 }), sky.length);
    sky.forEach(([x, z, w, h, dd], i) => {
      this.tmp.position.set(x, 0, z);
      this.tmp.rotation.set(0, Math.atan2(c0 - x, c0 - z), 0);
      this.tmp.scale.set(w, h, dd);
      this.tmp.updateMatrix();
      towers.setMatrixAt(i, this.tmp.matrix);
    });
    this.tmp.rotation.set(0, 0, 0);
    this.tmp.scale.setScalar(1);
    this.scene.add(towers);
    this.disposables.push(tg);
    // road markings: centre dashes on every street, zebra crossings at every junction
    const marks: THREE.BufferGeometry[] = [];
    for (let k = 0; k < GRID; k++) {
      for (let s = 0; s < GRID - 1; s++) {
        for (let m = at(s) + ROAD_HW + 4; m < at(s + 1) - ROAD_HW - 3; m += 6) {
          marks.push(new THREE.PlaneGeometry(0.25, 3).rotateX(-Math.PI / 2).translate(at(k), 0.02, m + 1.5));
          marks.push(new THREE.PlaneGeometry(3, 0.25).rotateX(-Math.PI / 2).translate(m + 1.5, 0.02, at(k)));
        }
      }
    }
    for (let i = 0; i < GRID; i++) {
      for (let j = 0; j < GRID; j++) {
        for (let s = -ROAD_HW + 1; s < ROAD_HW - 0.5; s += 1.4) {
          for (const side of [-1, 1]) {
            marks.push(new THREE.PlaneGeometry(0.7, 2.4).rotateX(-Math.PI / 2).translate(at(i) + s + 0.35, 0.02, at(j) + side * (ROAD_HW + 1.6)));
            marks.push(new THREE.PlaneGeometry(2.4, 0.7).rotateX(-Math.PI / 2).translate(at(i) + side * (ROAD_HW + 1.6), 0.02, at(j) + s + 0.35));
          }
        }
      }
    }
    this.add(mergeGeometries(marks)!, this.mat({ color: "#e8e4d8", rough: 0.6 }), { receive: true });
    // buildings: walls with the facade texture (uv in facade tiles), tinted per building; flat roofs
    const walls = new QuadBuilder(), roofs = new QuadBuilder();
    const tints = ["#f0d8b0", "#e8b8a0", "#c8d8e0", "#f0e0c0", "#d8c0e0", "#b8d8c0", "#f8c890", "#e0e0e0"];
    const tanks: Array<[number, number, number]> = [];
    const signs: Array<{ p: Array<[number, number, number]>; n: [number, number, number]; s: number }> = [];
    for (const b of d.boxes) {
      const c = new THREE.Color(tints[Math.floor(b.tint * tints.length)]!);
      const { x0, x1, z0, z1, h } = b;
      const u = (w: number) => w / CELL_W, v = h / CELL_H;
      // random vertical offset per building so floors don't line up block-wide
      const o = Math.floor(b.tint * 4) / 4;
      walls.quad([[x0, 0, z1], [x1, 0, z1], [x1, h, z1], [x0, h, z1]], [0, 0, 1], [[0, o], [u(x1 - x0), o], [u(x1 - x0), o + v], [0, o + v]], c);
      walls.quad([[x1, 0, z0], [x0, 0, z0], [x0, h, z0], [x1, h, z0]], [0, 0, -1], [[0, o], [u(x1 - x0), o], [u(x1 - x0), o + v], [0, o + v]], c);
      walls.quad([[x1, 0, z1], [x1, 0, z0], [x1, h, z0], [x1, h, z1]], [1, 0, 0], [[0, o], [u(z1 - z0), o], [u(z1 - z0), o + v], [0, o + v]], c);
      walls.quad([[x0, 0, z0], [x0, 0, z1], [x0, h, z1], [x0, h, z0]], [-1, 0, 0], [[0, o], [u(z1 - z0), o], [u(z1 - z0), o + v], [0, o + v]], c);
      roofs.quad([[x0, h, z1], [x1, h, z1], [x1, h, z0], [x0, h, z0]], [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], new THREE.Color("#5a5450").lerp(c, 0.15));
      if (rnd() < 0.7) tanks.push([x0 + 2 + rnd() * (x1 - x0 - 4), h, z0 + 2 + rnd() * (z1 - z0 - 4)]);
      // a shop sign on the street side at first-floor height (the side facing the nearest street)
      if (rnd() < 0.55) {
        const s = Math.floor(rnd() * SIGNS.length), y = 4.2, sh = 1.3;
        const sides: Array<() => void> = [
          () => { const w = Math.min(7, x1 - x0 - 1), cx = (x0 + x1) / 2; signs.push({ p: [[cx - w / 2, y, z1 + 0.05], [cx + w / 2, y, z1 + 0.05], [cx + w / 2, y + sh, z1 + 0.05], [cx - w / 2, y + sh, z1 + 0.05]], n: [0, 0, 1], s }); },
          () => { const w = Math.min(7, x1 - x0 - 1), cx = (x0 + x1) / 2; signs.push({ p: [[cx + w / 2, y, z0 - 0.05], [cx - w / 2, y, z0 - 0.05], [cx - w / 2, y + sh, z0 - 0.05], [cx + w / 2, y + sh, z0 - 0.05]], n: [0, 0, -1], s }); },
          () => { const w = Math.min(7, z1 - z0 - 1), cz = (z0 + z1) / 2; signs.push({ p: [[x1 + 0.05, y, cz + w / 2], [x1 + 0.05, y, cz - w / 2], [x1 + 0.05, y + sh, cz - w / 2], [x1 + 0.05, y + sh, cz + w / 2]], n: [1, 0, 0], s }); },
          () => { const w = Math.min(7, z1 - z0 - 1), cz = (z0 + z1) / 2; signs.push({ p: [[x0 - 0.05, y, cz - w / 2], [x0 - 0.05, y, cz + w / 2], [x0 - 0.05, y + sh, cz + w / 2], [x0 - 0.05, y + sh, cz - w / 2]], n: [-1, 0, 0], s }); },
        ];
        sides[Math.floor(rnd() * 4)]!();
      }
    }
    this.add(walls.build(), this.mat({ map: tex.map, emissive: "#ffffff", emissiveMap: tex.glow, emissiveIntensity: this.lite ? 0.75 : 1.1, vertexColors: true, rough: 0.85 }), { cast: true, receive: true });
    this.add(roofs.build(), this.mat({ vertexColors: true, rough: 0.95 }), { receive: true });
    const sb = new QuadBuilder(), atlas = signAtlas();
    this.disposables.push(atlas);
    for (const s of signs) {
      const v0 = 1 - (s.s + 1) / SIGNS.length, v1 = 1 - s.s / SIGNS.length;
      sb.quad(s.p, s.n, [[0, v0], [1, v0], [1, v1], [0, v1]], white);
    }
    if (signs.length) {
      const m = this.lite ? new THREE.MeshBasicMaterial({ map: atlas }) : new THREE.MeshStandardMaterial({ map: atlas, emissive: "#ffffff", emissiveMap: atlas, emissiveIntensity: 1.6, roughness: 0.5 });
      this.disposables.push(m);
      this.add(sb.build(), m);
    }
    // rooftop water tanks (black Sintex-style cylinders)
    if (tanks.length) {
      const g = new THREE.CylinderGeometry(1, 1, 1.6, 10).translate(0, 0.8, 0);
      const im = new THREE.InstancedMesh(g, this.mat({ color: "#1d1f22", rough: 0.6 }), tanks.length);
      tanks.forEach(([x, y, z], i) => {
        this.tmp.position.set(x, y, z);
        this.tmp.scale.setScalar(1);
        this.tmp.updateMatrix();
        im.setMatrixAt(i, this.tmp.matrix);
      });
      im.castShadow = !this.lite && this.q.shadows.enabled;
      this.scene.add(im);
      this.disposables.push(g);
    }
    // trees in the maidan, from the Kenney Nature Kit props
    const kinds: PropName[] = ["tree_default_dark", "tree_detailed_dark", "tree_tall_dark"];
    const byKind = new Map<PropName, Array<{ x: number; z: number; s: number }>>();
    d.trees.forEach((t, i) => {
      const k = kinds[i % kinds.length]!;
      byKind.set(k, [...(byKind.get(k) ?? []), t]);
    });
    for (const [k, list] of byKind) {
      const g = props.get(k);
      if (!g) continue;
      const im = new THREE.InstancedMesh(g, this.mat({ vertexColors: true, rough: 0.9 }), list.length);
      list.forEach((t, i) => {
        this.tmp.position.set(t.x, 0.2, t.z);
        this.tmp.rotation.set(0, t.x * 7.1, 0);
        this.tmp.scale.setScalar(t.s * 2.6);
        this.tmp.updateMatrix();
        im.setMatrixAt(i, this.tmp.matrix);
      });
      im.castShadow = !this.lite && this.q.shadows.enabled;
      this.scene.add(im);
    }
    this.tmp.rotation.set(0, 0, 0);
    // the plaza fountain
    for (const f of d.discs) {
      const rim = new THREE.CylinderGeometry(f.r, f.r + 0.3, 0.8, 28).translate(f.x, 0.6, f.z);
      this.add(rim, this.mat({ color: "#d8cbb4", rough: 0.7 }), { cast: true, receive: true });
      const water = new THREE.CylinderGeometry(f.r - 0.4, f.r - 0.4, 0.1, 28).translate(f.x, 0.95, f.z);
      this.add(water, this.mat({ color: "#4fa8c8", emissive: "#1a5a78", rough: 0.1, metal: 0.2 }));
      const spout = new THREE.CylinderGeometry(0.5, 0.8, 2.6, 12).translate(f.x, 1.6, f.z);
      this.add(spout, this.mat({ color: "#d8cbb4", rough: 0.7 }), { cast: true });
    }
    // ramps: a hump across the street, yellow and black chevrons
    const ramps: THREE.BufferGeometry[] = [];
    for (const r of d.ramps) {
      const L = r.len / 2, W = r.wid / 2, H = r.h;
      const g = new THREE.BufferGeometry();
      // along = local x, across = local z; tent with its crest at x = 0
      const p = [
        -L, 0, -W, 0, H, -W, 0, H, W, -L, 0, W, // up slope
        0, H, -W, L, 0, -W, L, 0, W, 0, H, W, // down slope
        -L, 0, -W, L, 0, -W, 0, H, -W, 0, H, -W, // side (degenerate quad as a triangle)
        L, 0, W, -L, 0, W, 0, H, W, 0, H, W,
      ];
      const uv = [0, 0, 1, 0, 1, 1, 0, 1, 1, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex([0, 2, 1, 0, 3, 2, 4, 6, 5, 4, 7, 6, 8, 10, 9, 12, 14, 13]);
      g.computeVertexNormals();
      if (r.axis === "z") g.rotateY(-Math.PI / 2);
      g.translate(r.x, 0, r.z);
      ramps.push(g);
    }
    const chev = canvas(64, 64);
    chev.g.fillStyle = "#ffcc1a";
    chev.g.fillRect(0, 0, 64, 64);
    chev.g.fillStyle = "#1a1a1a";
    for (let k = -2; k < 4; k++) {
      chev.g.beginPath();
      chev.g.moveTo(k * 22, 64);
      chev.g.lineTo(k * 22 + 11, 64);
      chev.g.lineTo(k * 22 + 43, 0);
      chev.g.lineTo(k * 22 + 32, 0);
      chev.g.fill();
    }
    const chevT = new THREE.CanvasTexture(chev.c);
    chevT.wrapS = chevT.wrapT = THREE.RepeatWrapping;
    chevT.repeat.set(1, 3);
    chevT.colorSpace = THREE.SRGBColorSpace;
    this.disposables.push(chevT);
    this.add(mergeGeometries(ramps)!, this.mat({ map: chevT, rough: 0.6 }), { cast: true, receive: true });
    // street lamps: poles and their glows
    const poles: THREE.BufferGeometry[] = [];
    const glows: number[] = [];
    for (const l of d.lamps) {
      poles.push(new THREE.CylinderGeometry(0.09, 0.14, 7, 6).translate(l.x, 3.5, l.z));
      glows.push(l.x, 6.9, l.z);
    }
    this.add(mergeGeometries(poles)!, this.mat({ color: "#2a2c30", rough: 0.5, metal: 0.6 }));
    const gt = glowTexture();
    this.disposables.push(gt);
    const pg = new THREE.BufferGeometry();
    pg.setAttribute("position", new THREE.Float32BufferAttribute(glows, 3));
    const pm = new THREE.PointsMaterial({ map: gt, size: 4.5, sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: "#ffd9a0" });
    this.disposables.push(pg, pm);
    this.scene.add(new THREE.Points(pg, pm));
    // coins
    const cg = new THREE.CylinderGeometry(0.75, 0.75, 0.16, 18).rotateX(Math.PI / 2);
    this.coins = new THREE.InstancedMesh(cg, this.mat({ color: "#ffcf3a", emissive: "#ff9a00", emissiveIntensity: 0.6, rough: 0.25, metal: 0.8 }), d.coins.length);
    this.coins.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.coins.frustumCulled = false;
    this.scene.add(this.coins);
    this.disposables.push(cg);
    // gates: a ring on the ground and a beacon of light above it (lit for the gate a view's driver wants next)
    const ringG = new THREE.RingGeometry(d.gates[0]!.r - 0.8, d.gates[0]!.r, 48).rotateX(-Math.PI / 2);
    const beamG = new THREE.CylinderGeometry(2.2, 2.2, 60, 16, 1, true).translate(0, 30, 0);
    this.disposables.push(ringG, beamG);
    d.gates.forEach((g, i) => {
      const rm = new THREE.MeshBasicMaterial({ color: i === 0 ? "#ffffff" : "#ffd23f", transparent: true, opacity: 0.85, depthWrite: false, fog: false });
      const ring = new THREE.Mesh(ringG, rm);
      ring.position.set(g.x, 0.05, g.z);
      ring.renderOrder = 1;
      const bm = new THREE.MeshBasicMaterial({ color: "#ffd23f", transparent: true, opacity: 0.32, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
      const beam = new THREE.Mesh(beamG, bm);
      beam.position.set(g.x, 0, g.z);
      beam.renderOrder = 2;
      this.disposables.push(rm, bm);
      this.scene.add(ring, beam);
      this.rings.push(ring);
      this.beacons.push(beam);
    });
    // the start / finish line: a chequered strip across the west street at gate 0
    const chk = canvas(64, 8);
    for (let i = 0; i < 16; i++) for (let j = 0; j < 2; j++) {
      chk.g.fillStyle = (i + j) % 2 ? "#111" : "#f5f5f5";
      chk.g.fillRect(i * 4, j * 4, 4, 4);
    }
    const ct = new THREE.CanvasTexture(chk.c);
    ct.magFilter = THREE.NearestFilter;
    ct.colorSpace = THREE.SRGBColorSpace;
    this.disposables.push(ct);
    const g0 = d.gates[0]!;
    this.add(new THREE.PlaneGeometry(ROAD_HW * 2, 1.8).rotateX(-Math.PI / 2).translate(g0.x, 0.03, g0.z - 6), this.mat({ map: ct, rough: 0.7 }), { receive: true });
    // a gantry over the start: two posts and a banner
    const gan = [
      new THREE.BoxGeometry(0.5, 7, 0.5).translate(g0.x - ROAD_HW - 0.6, 3.5, g0.z - 6),
      new THREE.BoxGeometry(0.5, 7, 0.5).translate(g0.x + ROAD_HW + 0.6, 3.5, g0.z - 6),
    ];
    this.add(mergeGeometries(gan)!, this.mat({ color: "#30323a", metal: 0.6, rough: 0.4 }), { cast: true });
    const ban = canvas(512, 64);
    ban.g.fillStyle = "#c81e3c";
    ban.g.fillRect(0, 0, 512, 64);
    ban.g.fillStyle = "#fff";
    ban.g.font = "bold 44px sans-serif";
    ban.g.textAlign = "center";
    ban.g.textBaseline = "middle";
    ban.g.fillText("CITY RIVALS", 256, 34);
    const bt = new THREE.CanvasTexture(ban.c);
    bt.colorSpace = THREE.SRGBColorSpace;
    this.disposables.push(bt);
    const banner = new THREE.PlaneGeometry(ROAD_HW * 2 + 1.7, 1.8);
    const bmat = new THREE.MeshBasicMaterial({ map: bt, side: THREE.DoubleSide });
    this.disposables.push(bmat);
    this.add(banner.translate(g0.x, 6.4, g0.z - 6), bmat);
  }

  private buildCars(models: THREE.Object3D[], field: Array<{ color: string }>) {
    field.forEach((f) => {
      const root = new THREE.Group();
      const bodies = new Map<Kind, THREE.Object3D>();
      KINDS.forEach((k, i) => {
        const body = cloneModel(models[i]!);
        prepareModel(body, this.q, { envIntensity: 1.2 });
        body.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          const mats = (Array.isArray(m.material) ? m.material : [m.material]).map((mt) => {
            const src = mt as THREE.MeshStandardMaterial;
            const c = this.lite
              ? new THREE.MeshLambertMaterial({ color: src.color, map: src.map ?? null, emissive: src.emissive ?? new THREE.Color(0), emissiveMap: src.emissiveMap ?? null })
              : (src.clone() as THREE.MeshStandardMaterial);
            if (mt.name === "paint") c.color.set(f.color).convertSRGBToLinear();
            this.disposables.push(c);
            return c;
          });
          m.material = Array.isArray(m.material) ? mats : mats[0]!;
          if (this.lite) m.castShadow = m.receiveShadow = false;
        });
        body.visible = false;
        root.add(body);
        bodies.set(k, body);
      });
      const shadow = blobShadow(STATS.auto.radius * 1.6, 0.7);
      this.scene.add(root, shadow);
      this.cars.push({ root, bodies, shadow, kind: "auto" });
    });
  }

  /** Copy the simulation into the scene. */
  sync(cars: Car[], coinsOn: boolean[][], dt: number) {
    this.time += dt;
    cars.forEach((c, i) => {
      const m = this.cars[i];
      if (!m) return;
      if (m.kind !== c.kind || !m.bodies.get(c.kind)!.visible) {
        for (const [k, b] of m.bodies) b.visible = k === c.kind;
        m.kind = c.kind;
      }
      m.root.position.set(c.x, c.y, c.z);
      // lean into turns, pitch with the jump
      const lean = -c.steer * Math.min(1, Math.hypot(c.vx, c.vz) / 20) * (c.kind === "scooter" ? 0.35 : 0.07);
      const pitch = c.air ? Math.max(-0.35, Math.min(0.35, -c.vy * 0.03)) : 0;
      m.root.rotation.set(pitch, c.yaw, lean, "YXZ");
      m.shadow.position.set(c.x, 0.04, c.z);
      m.shadow.visible = this.lite || !this.q.shadows.enabled || c.air;
      fadeBlob(m.shadow, c.y);
    });
    this.coinsOn = coinsOn;
  }

  /** Lay the coins out for one view: its driver's own set (the overview shows them all). */
  private placeCoins(rider: number | null) {
    const on = rider === null ? null : this.coinsOn[rider];
    this.d.coins.forEach((p, i) => {
      this.tmp.position.set(p.x, p.y + Math.sin(this.time * 2 + i) * 0.15, p.z);
      this.tmp.rotation.set(0, this.time * 3 + i, 0);
      this.tmp.scale.setScalar(on && !on[i] ? 0.0001 : 1);
      this.tmp.updateMatrix();
      this.coins.setMatrixAt(i, this.tmp.matrix);
    });
    this.coins.instanceMatrix.needsUpdate = true;
    this.tmp.rotation.set(0, 0, 0);
    this.tmp.scale.setScalar(1);
  }

  /** Overview: a slow orbit high over the district (intro, garage and results). */
  private orbit(t: number) {
    const c = EXTENT / 2, r = 175;
    this.overview.position.set(c + Math.cos(t * 0.08) * r, 95, c + Math.sin(t * 0.08) * r);
    this.overview.lookAt(c, 0, c);
  }

  /** Garage shot: low, at the start grid, looking at the cars. */
  private grid(t: number) {
    const g = this.d.gates[0]!;
    this.overview.position.set(g.x + 13 + Math.sin(t * 0.3) * 2, 3.2, g.z - 22);
    this.overview.lookAt(g.x, 0.8, g.z - 18);
  }

  draw(slots: ViewSlot[], cars: Car[], mode: "chase" | "orbit" | "grid", dt: number) {
    const W = this.width, H = this.height;
    // outside the race the whole screen is one overview shot
    if (mode !== "chase") slots = [{ rect: { x: 0, y: 0, w: 1, h: 1 }, car: null, gate: -1, color: "#ffd23f" }];
    const views: View[] = [];
    // the sun's shadow covers the whole district from a fixed place: draw it once a frame, not once a view
    const shadows = this.renderer.shadowMap.enabled;
    if (shadows) this.renderer.shadowMap.autoUpdate = false;
    slots.forEach((s, i) => {
      const px = { x: Math.round(s.rect.x * W), y: Math.round(H - (s.rect.y + s.rect.h) * H), w: Math.round(s.rect.w * W), h: Math.round(s.rect.h * H) };
      // a hairline between views
      if (s.rect.x > 0) { px.x += 2; px.w -= 2; }
      if (s.rect.y + s.rect.h < 0.999) { px.y += 2; px.h -= 2; }
      let cam: THREE.PerspectiveCamera;
      if (mode === "chase" && s.car !== null && cars[s.car]) {
        cam = this.cams[i] ?? this.cams[0]!;
        const ch = this.chases[i] ?? this.chases[0]!;
        follow(this.d, ch, cars[s.car]!, dt);
        cam.position.set(ch.x, ch.y, ch.z);
        cam.lookAt(ch.tx, ch.ty, ch.tz);
        cam.fov = ch.fov;
      } else {
        cam = this.overview;
        (mode === "grid" ? this.grid : this.orbit).call(this, this.time);
        for (const c of this.chases) c.ready = false;     // the chase cams start fresh behind the cars
      }
      cam.aspect = px.w / Math.max(1, px.h);
      cam.updateProjectionMatrix();
      views.push({
        camera: cam, ...px,
        before: () => {
          if (shadows) this.renderer.shadowMap.needsUpdate = i === 0;
          this.placeCoins(mode === "chase" ? s.car : null);
          this.beacons.forEach((b, k) => {
            const want = mode !== "chase" || k === s.gate;
            b.visible = want;
            (b.material as THREE.MeshBasicMaterial).color.set(mode === "chase" ? s.color : "#ffd23f");
          });
          this.rings.forEach((r, k) => (r.visible = mode !== "chase" || k === s.gate || k === 0));
          // the followed car never fills its own lens when the camera pulls in
          this.cars.forEach((c, k) => (c.root.visible = !(mode === "chase" && k === s.car && cam.position.distanceTo(c.root.position) < 2.2)));
        },
      });
    });
    renderViews(this.renderer, this.scene, views);
  }

  dispose() {
    for (const c of this.cars) c.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
    this.disposables.forEach((x) => x.dispose());
    this.renderer.dispose();
  }
}
