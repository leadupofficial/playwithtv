/**
 * Kenney Space Kit models (CC0, apps/web/public/assets/kenney-space-kit) as cheap three.js objects for a 1 GB
 * TV: every material becomes an unlit-ish Lambert material shared by colour, and the kit's orange trim is
 * repainted in each player's colour. If a model can't load, a simple shape made in code stands in, so the
 * game always plays.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const BASE = "/assets/kenney-space-kit/";
export const MODEL_NAMES = [
  "rocket_baseA", "rocket_fuelA", "rocket_topA", "rocket_finsA", "meteor_detailed", "meteor", "rocks_smallA", "rock_largeA",
  "crater", "craterLarge", "hangar_roundA", "satelliteDish", "platform_large", "astronautA", "machine_generator",
] as const;
export type ModelName = (typeof MODEL_NAMES)[number];
export type Kit = Map<ModelName, THREE.Group>;

/** Kit colours, slightly richer than the originals (they read washed out on TVs). */
const PALETTE: Record<string, string> = {
  metal: "#e8ecf4", metalDark: "#9aa3b5", dark: "#3a4150", rock: "#e0784f", rockTrack: "#f08a5d", rockDark: "#a44d31",
  skin: "#ffc79c", _defaultMat: "#ffffff", metalRed: "#ff9d2e",
};
const shared = new Map<string, THREE.MeshLambertMaterial>();
function lambert(name: string, fallback: THREE.Color) {
  let m = shared.get(name);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color: PALETTE[name] ?? fallback });
    shared.set(name, m);
  }
  return m;
}

/** Loads every model in parallel; missing ones are simply absent (callers fall back to code-made shapes). */
export async function loadKit(): Promise<Kit> {
  const loader = new GLTFLoader();
  const kit: Kit = new Map();
  await Promise.all(MODEL_NAMES.map(async (name) => {
    try {
      const gltf = await loader.loadAsync(`${BASE}${name}.glb`);
      const g = gltf.scene;
      g.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const src = mesh.material as THREE.MeshStandardMaterial;
        mesh.material = lambert(src.name || "_defaultMat", src.color ?? new THREE.Color("#ccc"));
        mesh.userData.trim = src.name === "metalRed";
        src.dispose();
      });
      kit.set(name, g);
    } catch {
      /* offline or blocked: fall back */
    }
  }));
  return kit;
}

/** A copy of a model sharing its geometry; trim parts get `trim` (a player's colour) when given. */
export function place(kit: Kit, name: ModelName, trim?: THREE.Material): THREE.Object3D {
  const src = kit.get(name);
  if (!src) return fallback(name);
  const g = src.clone(true);
  if (trim) g.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.userData.trim) (o as THREE.Mesh).material = trim; });
  return g;
}

function fallback(name: ModelName): THREE.Object3D {
  const white = lambert("metal", new THREE.Color("#ddd"));
  const rock = lambert("rock", new THREE.Color("#d76"));
  if (name.startsWith("meteor") || name.startsWith("rock")) return new THREE.Mesh(new THREE.DodecahedronGeometry(0.4), rock);
  if (name === "rocket_baseA") return new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.7, 1.6, 10).translate(0, 0.8, 0), white);
  if (name === "rocket_fuelA") return new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.5, 10).translate(0, 0.25, 0), white);
  if (name === "rocket_topA") return new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.8, 10).translate(0, 0.4, 0), white);
  if (name === "platform_large") return new THREE.Mesh(new THREE.BoxGeometry(2, 0.1, 2).translate(0, 0.05, 0), lambert("metalDark", new THREE.Color("#999")));
  return new THREE.Group();
}

export const MAX_TANKS = 4;

/** One player's rocket: base, up to four fuel tanks that appear as it fills up, and the nose cone. */
export class RocketModel {
  readonly root = new THREE.Group();
  /** Squash-and-stretch pivot (at the base). */
  readonly body = new THREE.Group();
  private tanks: THREE.Object3D[] = [];
  private top: THREE.Object3D;
  readonly trim: THREE.MeshLambertMaterial;
  shown = -1;

  constructor(kit: Kit, color: string) {
    this.trim = new THREE.MeshLambertMaterial({ color, emissive: new THREE.Color(color).multiplyScalar(0.25) });
    this.root.add(this.body);
    const base = place(kit, "rocket_baseA", this.trim);
    const fins = place(kit, "rocket_finsA", this.trim);
    fins.position.y = 0.05;
    fins.scale.setScalar(1.15);
    this.body.add(base, fins);
    for (let i = 0; i < MAX_TANKS; i++) {
      const t = place(kit, "rocket_fuelA", this.trim);
      t.position.y = 1.6 + i * 0.5;
      t.visible = false;
      this.tanks.push(t);
      this.body.add(t);
    }
    this.top = place(kit, "rocket_topA", this.trim);
    this.body.add(this.top);
    this.setFuel(0);
  }

  /** Height of the rocket (model units) for the current fuel. */
  get height() {
    return 1.6 + Math.max(0, this.shown) * 0.5 + 0.8;
  }

  setFuel(f: number) {
    const n = Math.min(MAX_TANKS, Math.floor(f * MAX_TANKS + 1e-6));
    if (n === this.shown) return;
    this.shown = n;
    this.tanks.forEach((t, i) => (t.visible = i < n));
    this.top.position.y = 1.6 + n * 0.5;
  }
}

/** Soft round textures drawn once: flame/spark particles, blob shadows and stars. */
export function radialTexture(inner: string, outer: string, size = 64): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, inner);
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A five-point star sprite texture (collectibles). */
export function starTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const glow = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  glow.addColorStop(0, "rgba(255,240,150,0.9)");
  glow.addColorStop(1, "rgba(255,200,40,0)");
  g.fillStyle = glow;
  g.fillRect(0, 0, 128, 128);
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 18 : 42, a = -Math.PI / 2 + (i * Math.PI) / 5;
    g.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r);
  }
  g.closePath();
  g.fillStyle = "#ffe14d";
  g.fill();
  g.lineWidth = 5;
  g.strokeStyle = "#fff6c2";
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
