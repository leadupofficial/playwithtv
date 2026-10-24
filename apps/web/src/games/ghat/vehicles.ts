/**
 * Drawing the racers, traffic, goats, tiffin pickups and coconuts.
 *   lite        Blender-lit sprite sheets (kit25d SpriteBatch): one draw call per sheet, paint recoloured by hue,
 *               plus a faint mirrored copy on the wet road (another call per racer sheet)
 *   high/ultra  the same vehicles as real-time PBR models (clear coat, baked AO), real shadows
 * Both read the same poses (actors.ts).
 */
import * as THREE from "three";
import { SpriteBatch, loadSpriteSheet } from "../kit25d/spriteBatch";
import { cloneModel, loadGltf } from "../kit3d/assets";
import { prepareModel } from "../kit3d/cinematic";
import type { QualityProfile } from "../../quality/tier";
import type { Kind } from "./racer";
import type { GoatPose, RacerPose, TrafficPose } from "./actors";
import type { TrafficKind } from "./traffic";

export const BASE = "/assets/ghat-rush";
const KINDS: Kind[] = ["auto", "scooter", "car"];
const TRAFFIC_LOOKS = ["#ffffff", "#e9c46a", "#9ec7d8", "#f4a261"];

export interface PickupPose { x: number; y: number; z: number; on: boolean }
export interface CoconutPose { x: number; y: number; z: number; spin: number }

export interface ActorLayer {
  group: THREE.Group;
  /** Draw calls this layer adds per view (for the debug state). */
  set(racers: RacerPose[], traffic: TrafficPose[], goats: GoatPose[], pickups: PickupPose[], coconuts: CoconutPose[], time: number): void;
  /** Called before each view renders (sprites face that camera). */
  view(camera: THREE.Camera, time: number): void;
  /** A lightning flash (0..1) lights sprites through their normal maps. */
  flash(amount: number): void;
  dispose(): void;
}

/** A steel tiffin carrier: three stacked tins, a lid knob and a handle (one merged geometry). */
function tiffinGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 3; k++) parts.push(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 18).translate(0, 0.17 + k * 0.33, 0));
  parts.push(new THREE.SphereGeometry(0.12, 10, 6).translate(0, 1.12, 0));
  parts.push(new THREE.TorusGeometry(0.36, 0.04, 6, 16, Math.PI).translate(0, 1.05, 0));
  const g = new THREE.BufferGeometry();
  const merged = parts.map((p) => p.toNonIndexed());
  const pos: number[] = [], nor: number[] = [];
  for (const p of merged) {
    pos.push(...(p.getAttribute("position").array as Float32Array));
    nor.push(...(p.getAttribute("normal").array as Float32Array));
  }
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  return g;
}

/** Tiffins and coconuts: two instanced meshes shared by both tiers. */
class Pickups {
  readonly tiffins: THREE.InstancedMesh;
  readonly coconuts: THREE.InstancedMesh;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  constructor(lite: boolean) {
    const steel = lite ? new THREE.MeshLambertMaterial({ color: "#d8dde2", emissive: "#3b4a55" }) : new THREE.MeshStandardMaterial({ color: "#e6eaee", metalness: 1, roughness: 0.18 });
    this.tiffins = new THREE.InstancedMesh(tiffinGeometry(), steel, 16);
    this.tiffins.frustumCulled = false;
    const husk = lite ? new THREE.MeshLambertMaterial({ color: "#5c4a1e" }) : new THREE.MeshStandardMaterial({ color: "#5c4a1e", roughness: 0.85 });
    this.coconuts = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.45, 1), husk, 12);
    this.coconuts.frustumCulled = false;
    this.tiffins.castShadow = this.coconuts.castShadow = !lite;
  }
  set(pickups: PickupPose[], coconuts: CoconutPose[], time: number) {
    let n = 0;
    for (const p of pickups) {
      if (!p.on || n >= 16) continue;
      this.q.setFromEuler(this.e.set(0, time * 2 + n, 0));
      this.m.compose(new THREE.Vector3(p.x, p.y + 0.6 + Math.sin(time * 3 + n) * 0.18, p.z), this.q, new THREE.Vector3(1, 1, 1));
      this.tiffins.setMatrixAt(n++, this.m);
    }
    this.tiffins.count = n;
    this.tiffins.instanceMatrix.needsUpdate = true;
    n = 0;
    for (const c of coconuts) {
      if (n >= 12) break;
      this.q.setFromEuler(this.e.set(c.spin, c.spin * 0.3, 0));
      this.m.compose(new THREE.Vector3(c.x, c.y + 0.45, c.z), this.q, new THREE.Vector3(1, 0.9, 1));
      this.coconuts.setMatrixAt(n++, this.m);
    }
    this.coconuts.count = n;
    this.coconuts.instanceMatrix.needsUpdate = true;
  }
}

// ---- lite: sprites -----------------------------------------------------------------------------------------

export async function spriteActors(onProgress?: (p: number) => void): Promise<ActorLayer> {
  const names = [...KINDS, "bus", "lorry", "goat"] as const;
  let done = 0;
  const sheets = await Promise.all(names.map((n) => loadSpriteSheet(`${BASE}/${n}.json`, { normals: true }).then((s) => {
    onProgress?.(++done / names.length);
    return s;
  })));
  const sheet = (n: (typeof names)[number]) => sheets[names.indexOf(n)]!;
  const group = new THREE.Group();
  const racers = new Map<Kind, SpriteBatch>(), mirrors = new Map<Kind, SpriteBatch>();
  for (const k of KINDS) {
    const mirror = new SpriteBatch(sheet(k), 8, { keyHue: 300, depthTest: false });
    mirror.mesh.renderOrder = 1;
    const main = new SpriteBatch(sheet(k), 8, { keyHue: 300, depthBias: 1.4 });
    main.mesh.renderOrder = 3;
    racers.set(k, main);
    mirrors.set(k, mirror);
    group.add(mirror.mesh, main.mesh);
  }
  const traffic = new Map<TrafficKind, SpriteBatch>();
  for (const k of ["bus", "lorry"] as const) {
    const b = new SpriteBatch(sheet(k), 6, { depthBias: 3 });
    b.mesh.renderOrder = 3;
    traffic.set(k, b);
    group.add(b.mesh);
  }
  const goats = new SpriteBatch(sheet("goat"), 8, { depthBias: 0.8 });
  goats.mesh.renderOrder = 3;
  group.add(goats.mesh);
  const pickups = new Pickups(true);
  group.add(pickups.tiffins, pickups.coconuts);
  const all = [...racers.values(), ...mirrors.values(), ...traffic.values(), goats];
  const bases = new Map<Kind, number[]>(KINDS.map((k) => [k, new Array(8).fill(1)]));
  const scale = (k: Kind) => (k === "scooter" ? 1.05 : 1);
  return {
    group,
    set(rs, ts, gs, ps, cs, time) {
      for (const b of all) for (let i = 0; i < b.capacity; i++) b.set(i, null);
      const used = new Map<string, number>();
      const slot = (key: string) => {
        const i = used.get(key) ?? 0;
        used.set(key, i + 1);
        return i;
      };
      for (const r of rs) {
        if (!r.visible) continue;
        const i = slot(r.kind);
        const hide = r.shield; // respawn blink
        racers.get(r.kind)!.set(i, { x: r.x, y: r.y, z: r.z, heading: r.yaw, tint: r.color, scale: scale(r.kind), opacity: hide ? 0.35 : 1 });
        bases.get(r.kind)![i] = hide ? 0.35 : 1;
        if (!r.wrecked) mirrors.get(r.kind)!.set(i, { x: r.x, y: r.y - 0.02, z: r.z, heading: r.yaw, tint: r.color, scale: scale(r.kind), opacity: 0.13, flipY: true });
      }
      for (const c of ts) {
        const i = slot(c.kind);
        traffic.get(c.kind)!.set(i, { x: c.x, y: c.y, z: c.z, heading: c.yaw, tint: c.kind === "lorry" ? TRAFFIC_LOOKS[c.look % 4] : null, tintStrength: 0.5 });
      }
      gs.forEach((g, i) => i < 8 && goats.set(i, { x: g.x, y: g.y, z: g.z, heading: g.yaw + g.tumble }));
      pickups.set(ps, cs, time);
    },
    view(camera, time) {
      // racers right on top of this camera (someone drafting you) fade out instead of filling the screen
      const cp = camera.position;
      for (const [k, b] of racers) {
        const base = bases.get(k)!;
        for (let i = 0; i < b.capacity; i++) {
          const st = b.get(i);
          if (!st) continue;
          const d = Math.hypot(st.x - cp.x, st.z - cp.z);
          st.opacity = base[i]! * Math.min(1, Math.max(0, (d - 2.2) / 2));
        }
      }
      for (const b of all) b.update(camera, time);
    },
    flash(a) {
      for (const b of [...racers.values(), ...traffic.values(), goats]) b.setLight([-0.4, 0.8, 0.45], "#d8e6ff", a * 1.3);
    },
    dispose() {
      for (const b of all) b.dispose();
    },
  };
}

// ---- high / ultra: models ----------------------------------------------------------------------------------

export async function modelActors(q: QualityProfile, field: Array<{ kind: Kind; color: string }>, onProgress?: (p: number) => void): Promise<ActorLayer> {
  const files = [...KINDS, "bus", "lorry", "goat"].map((n) => `${BASE}/${n}-high.glb`);
  let done = 0;
  const gltfs = await Promise.all(files.map((f) => loadGltf(f).then((g) => {
    onProgress?.(++done / files.length);
    return g;
  })));
  const src = (n: string) => gltfs[[...KINDS, "bus", "lorry", "goat"].indexOf(n)]!.scene;
  const group = new THREE.Group();
  const make = (name: string, color?: string) => {
    const root = new THREE.Group();
    const body = cloneModel(src(name));
    prepareModel(body, q, { envIntensity: 1.7 });
    body.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mats = (Array.isArray(m.material) ? m.material : [m.material]).map((mt) => {
        const c = mt.clone() as THREE.MeshStandardMaterial;
        if (color && mt.name === "paint") c.color.set(color).convertSRGBToLinear().multiplyScalar(1);
        return c;
      });
      m.material = Array.isArray(m.material) ? mats : mats[0]!;
    });
    root.add(body);
    group.add(root);
    return root;
  };
  const racers = field.map((f) => make(f.kind, f.color));
  const traffic = { bus: [] as THREE.Object3D[], lorry: [] as THREE.Object3D[] };
  for (let i = 0; i < 6; i++) {
    traffic.bus.push(make("bus"));
    traffic.lorry.push(make("lorry"));
  }
  const goats = Array.from({ length: 8 }, () => make("goat"));
  const pickups = new Pickups(false);
  group.add(pickups.tiffins, pickups.coconuts);
  const e = new THREE.Euler(0, 0, 0, "YXZ");
  const place = (o: THREE.Object3D, x: number, y: number, z: number, yaw: number, pitch = 0, roll = 0) => {
    o.visible = true;
    o.position.set(x, y, z);
    o.quaternion.setFromEuler(e.set(pitch, yaw, roll));
  };
  return {
    group,
    set(rs, ts, gs, ps, cs, time) {
      rs.forEach((r, i) => {
        const o = racers[i];
        if (!o) return;
        place(o, r.x, r.y, r.z, r.yaw, r.pitch + r.tumble * 0.6, r.roll + r.tumble);
        o.visible = o.userData.shown = r.visible && !r.shield;
      });
      const used = { bus: 0, lorry: 0 };
      for (const o of [...traffic.bus, ...traffic.lorry]) o.visible = false;
      for (const c of ts) {
        const o = traffic[c.kind][used[c.kind]++];
        if (o) place(o, c.x, c.y, c.z, c.yaw);
      }
      goats.forEach((o, i) => {
        const g = gs[i];
        if (!g) o.visible = false;
        else place(o, g.x, g.y, g.z, g.yaw, g.tumble, 0);
      });
      pickups.set(ps, cs, time);
    },
    view(camera) {
      const cp = camera.position;
      for (const o of racers) {
        if (!o.userData.shown) continue;
        o.visible = Math.hypot(o.position.x - cp.x, o.position.z - cp.z) > 2.6;
      }
    },
    flash() {},
    dispose() {
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => x.dispose());
      });
    },
  };
}
