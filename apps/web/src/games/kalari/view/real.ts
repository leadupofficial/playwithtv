/**
 * The high / ultra tiers: real-time 3D through kit3d/cinematic (AgX, HDRI image-based light, soft shadows, bloom,
 * GTAO + SMAA on ultra). The same Blender arena as the lite backdrop, as PBR glTF; the restyled fighters as skinned
 * PBR models driven by the KayKit clips; oil-lamp point lights that flicker; a perspective camera the director can
 * sweep, punch in and cut to a close-up for specials.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { cloneModel, loadGltf } from "../../kit3d/assets";
import { Character } from "../../kit3d/character";
import { createCinematic, prepareModel, type Cinematic } from "../../kit3d/cinematic";
import { Podium } from "../../kit3d/podium";
import type { QualityProfile } from "../../../quality/tier";
import { ACTIONS, pickAnim } from "../anim";
import type { ArenaDef } from "../arenas";
import { Director } from "../director";
import type { FighterId, KalariEvent, Match } from "../rules";
import { A, HDRI_URL, playerRing, type Look, type StageView } from "./common";
import { Effects } from "./effects";

export interface RealAssets { arena: GLTF; anims: GLTF; fighters: Map<FighterId, GLTF> }

export async function loadReal(arena: ArenaDef, chars: FighterId[], onProgress?: (p: number) => void): Promise<RealAssets> {
  const uniq = [...new Set(chars)];
  const urls = [`${A}${arena.id}.glb`, `${A}anims.glb`, ...uniq.map((c) => `${A}${c}.glb`)];
  let done = 0;
  const all = await Promise.all(urls.map((u) => loadGltf(u).then((g) => { onProgress?.(++done / urls.length); return g; })));
  return { arena: all[0]!, anims: all[1]!, fighters: new Map(uniq.map((c, i) => [c, all[i + 2]!])) };
}

const SUN: Record<string, { pos: [number, number, number]; color: string; intensity: number }> = {
  courtyard: { pos: [-8, 6, 7], color: "#ffa060", intensity: 3.4 },
  docks: { pos: [5, 12, 6], color: "#d8e2ee", intensity: 1.6 },
  rooftop: { pos: [-8, 8, 7], color: "#ffc884", intensity: 3.2 },
};
const SCALE = 0.85;

export class RealView implements StageView {
  readonly cine: Cinematic;
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(32, 16 / 9, 0.3, 300);
  readonly director = new Director();
  readonly fx: Effects;
  private chars = new Map<string, { c: Character; ring: THREE.Mesh; look: Look; last: string }>();
  private lamps: THREE.PointLight[] = [];
  private flames: THREE.Object3D[] = [];
  private time = 0;
  private bloom = 0.22;
  private podiumGroup: Podium | null = null;
  private target = new THREE.Vector3();
  ready: Promise<void>;

  constructor(canvas: HTMLCanvasElement, private profile: QualityProfile, private arena: ArenaDef, assets: RealAssets, looks: Look[]) {
    this.cine = createCinematic(canvas, profile, { scene: this.scene, camera: this.camera });
    this.renderer = this.cine.renderer;
    this.renderer.toneMappingExposure = arena.id === "courtyard" ? 1.05 : 0.95;
    this.ready = this.cine.environment(this.scene, HDRI_URL[arena.hdri]!, { background: true, blur: 0.02, intensity: arena.id === "courtyard" ? 0.4 : 0.7 }).then(() => undefined);
    this.scene.fog = new THREE.Fog(arena.fog, 30, 95);
    const sun = SUN[arena.id]!;
    this.cine.sun(this.scene, { position: sun.pos, color: sun.color, intensity: sun.intensity, extent: 11 });
    const world = assets.arena.scene.clone(true);
    prepareModel(world, profile, { envIntensity: 0.9 });
    world.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (/Flame/.test(mesh.name)) {
        mesh.castShadow = false;
        mat.emissiveIntensity = 18;
      }
      if (/doorglow|lantern/.test(mat.name)) mat.emissiveIntensity = 4;
      if (/water|sea|backwater/.test(mat.name)) {
        mesh.receiveShadow = true;
        mat.roughness = 0.06;
        mat.metalness = 0.1;
        mat.envMapIntensity = 1.4;
      }
      if (/palm_leaf/.test(mat.name)) mat.side = THREE.DoubleSide;
    });
    const merged = mergeStatic(world);
    merged.traverse((o) => { if (/Flame/.test(o.name)) this.flames.push(o); });
    this.scene.add(merged);
    // lamps: a few real point lights (the rest glow through bloom only)
    const maxLights = profile.tier === "ultra" ? 6 : 4;
    arena.lamps.slice(0, maxLights).forEach(([x, y, z]) => {
      const l = new THREE.PointLight("#ffa04a", 14, 9, 1.6);
      l.position.set(x, y + 0.15, z);
      this.scene.add(l);
      this.lamps.push(l);
    });
    for (const look of looks) {
      const src = assets.fighters.get(look.char)!;
      const c = new Character(cloneModel(src.scene), assets.anims.animations, { scale: SCALE, material: "keep" });
      prepareModel(c.root, profile, { envIntensity: 1 });
      c.model.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.castShadow = true;
        // the palette texture carries an alpha channel: render the fighters fully opaque
        for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) Object.assign(mat, { transparent: false, opacity: 1, alphaTest: 0, depthWrite: true });
      });
      const ring = playerRing(look.color);
      this.scene.add(c.root, ring);
      c.play(ACTIONS[look.char].idle, { fade: 0 });
      this.chars.set(look.id, { c, ring, look, last: "" });
    }
    this.fx = new Effects(this.scene, arena.weather, profile.particleBudget, arena.rules);
  }

  react(events: KalariEvent[], m: Match) {
    for (const e of events) {
      if (e.kind === "hit") {
        this.chars.get(e.on)?.c.flash(0.09, "#ffd6b0", 0.22); // PBR + bloom: a little goes a long way
        this.bloom = Math.max(this.bloom, 0.45 + 0.3 * Math.min(1, e.kb / 12));
      }
      if (e.kind === "special-start") this.bloom = 0.9;
      if (e.kind === "ringout") {
        const f = m.fighters.find((x) => x.id === e.id)!;
        setTimeout(() => (this.arena.edge === "water" ? this.fx.splash(f.x, -0.9, f.z) : this.fx.puff(f.x, f.z, 12)), 450);
      }
    }
  }

  head(id: string, out: THREE.Vector3) {
    const c = this.chars.get(id)?.c;
    if (!c) return out.set(0, 0, 0);
    return out.copy(c.root.position).setY(c.root.position.y + 2.3 * SCALE);
  }

  podium(order: string[]) {
    this.podiumGroup = new Podium(2.2);
    this.podiumGroup.group.position.set(0, 0, -1);
    // brass, silver and bronze steps that catch the HDRI, instead of the kit's flat Lambert
    const metals = ["#d9a441", "#c9d3e0", "#b8733a"];
    let k = 0;
    this.podiumGroup.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && (mesh.geometry as THREE.BufferGeometry).type === "BoxGeometry") {
        mesh.material = new THREE.MeshStandardMaterial({ color: metals[k++ % 3], metalness: 0.85, roughness: 0.32 });
      }
    });
    this.scene.add(this.podiumGroup.group);
    order.forEach((id, i) => {
      const ch = this.chars.get(id)!;
      ch.c.root.visible = true;
      ch.c.body.scale.setScalar(1);
      this.podiumGroup!.place(ch.c.root, i + 1);
      prepareModel(this.podiumGroup!.group, this.profile);
      ch.c.play(ACTIONS[ch.look.char][i < 2 ? "cheer" : i === 2 ? "idle" : "ko"], { fade: 0.3, once: i > 2 });
      ch.ring.visible = false;
    });
    this.director.cut();
  }

  render(m: Match, realDt: number, simDt: number, cheer: ReadonlySet<string>, shake: THREE.Vector3) {
    this.time += realDt;
    const pts: Array<{ x: number; z: number }> = [];
    for (const f of m.fighters) if (f.alive || f.state === "fall") pts.push({ x: f.x, z: f.z });
    const intro = m.phase === "intro" ? Math.min(1, m.t / m.introSeconds) : null;
    const shot = this.podiumGroup
      ? { cx: 0, cz: -1, width: 10 + Math.sin(this.time * 0.3) * 0.4, yaw: Math.sin(this.time * 0.25) * 0.15, lift: -0.05 }
      : this.director.update(pts, realDt, intro, m.arena);
    // perspective camera: distance so `width` metres fill the screen at the target
    const pitch = THREE.MathUtils.degToRad(29) + shot.lift;
    const hfov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * this.camera.aspect);
    const dist = shot.width / 2 / Math.tan(hfov / 2);
    this.target.set(shot.cx, this.podiumGroup ? 1.6 : 0.7, shot.cz + (this.podiumGroup ? 0 : 0.9));
    this.camera.position.set(
      this.target.x + Math.sin(shot.yaw) * Math.cos(pitch) * dist,
      this.target.y + Math.sin(pitch) * dist,
      this.target.z + Math.cos(shot.yaw) * Math.cos(pitch) * dist,
    ).add(shake);
    this.camera.lookAt(this.target.x + shake.x * 0.3, this.target.y + shake.y * 0.3, this.target.z);

    for (const f of m.fighters) {
      const ch = this.chars.get(f.id)!;
      const c = ch.c;
      if (this.podiumGroup) {
        c.update(realDt);
        continue;
      }
      c.root.visible = f.state !== "out";
      c.root.position.set(f.x, f.state === "fall" ? f.y : Math.max(0, f.y), f.z);
      c.root.rotation.y = f.face;
      ch.ring.visible = f.alive && f.y < 2;
      ch.ring.position.set(f.x, 0.03, f.z);
      const pick = pickAnim(f, m, cheer.has(f.id));
      const clip = ACTIONS[f.char][pick.clip];
      const key = `${pick.clip}:${f.state}:${f.move ?? ""}`;
      if (pick.progress === null) {
        c.play(clip, { fade: 0.15, timeScale: pick.clip === "run" ? Math.min(1.4, Math.max(0.8, Math.hypot(f.vx, f.vz) / 5)) : 1 });
      } else {
        // one-shot: scrub the clip to the engine's progress, so the hit frame lands with the hitbox
        if (ch.last !== key) c.play(clip, { fade: 0.06, once: true, restart: true });
        c.pose(clip, pick.progress * c.duration(clip) * 0.98, 0.06);
      }
      ch.last = key;
      c.update(simDt);
    }
    // lamp flicker, bloom easing back after a punch
    this.lamps.forEach((l, i) => { l.intensity = 13 + Math.sin(this.time * 11 + i * 2.1) * 1.6 + Math.sin(this.time * 23 + i) * 1.0; });
    for (const fl of this.flames) fl.scale.y = 1 + Math.sin(this.time * 17 + fl.id) * 0.12;
    this.bloom += (0.22 - this.bloom) * Math.min(1, realDt * 3);
    this.cine.setBloom(this.bloom);
    this.fx.update(simDt || realDt * 0.2);
    this.cine.render(this.scene, this.camera);
  }

  dispose() {
    this.fx.dispose();
    for (const ch of this.chars.values()) ch.c.dispose();
    this.cine.dispose();
  }
}


/**
 * Merges the arena's static meshes that share a material into one mesh each (world transforms baked in):
 * ~270 objects become ~20 draw calls (×2 with the shadow pass). Flames stay separate (they flicker).
 */
function mergeStatic(root: THREE.Object3D): THREE.Group {
  root.updateMatrixWorld(true);
  const groups = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const keep: THREE.Object3D[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (/Flame/.test(mesh.name) || Array.isArray(mesh.material)) { keep.push(mesh); return; }
    const g = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    for (const k of Object.keys(g.attributes)) if (!["position", "normal", "uv"].includes(k)) g.deleteAttribute(k);
    if (!g.getAttribute("uv")) g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(g.getAttribute("position").count * 2), 2));
    if (!g.getAttribute("normal")) g.computeVertexNormals();
    const list = groups.get(mesh.material) ?? [];
    list.push(g.index ? g.toNonIndexed() : g);
    groups.set(mesh.material, list);
  });
  const out = new THREE.Group();
  for (const [mat, list] of groups) {
    const merged = mergeGeometries(list, false);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.name = (mat as THREE.Material).name;
    mesh.castShadow = mesh.receiveShadow = true;
    out.add(mesh);
  }
  for (const k of keep) {
    const m = k as THREE.Mesh;
    m.updateWorldMatrix(true, false);
    const c = m.clone();
    c.matrixAutoUpdate = true;
    m.matrixWorld.decompose(c.position, c.quaternion, c.scale);
    out.add(c);
  }
  return out;
}
