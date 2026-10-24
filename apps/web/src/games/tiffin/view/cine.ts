/**
 * The high/ultra view: the same kitchen carriage as a real-time 3D diorama (the Blender scene exported as a GLB),
 * through kit3d/cinematic: HDRI image-based light, a sun through the barred windows with soft shadows, warm lamps,
 * AgX, bloom on the steam, flames and bulbs (plus GTAO and SMAA on ultra). Chefs are animated KayKit characters
 * dressed as chefs (aprons in each player's colour), food is modelled, and the window scenery scrolls by.
 */
import * as THREE from "three";
import type { Ev, Match } from "../engine";
import { verbFor } from "../engine";
import { LEVELS } from "../levels";
import { VERB_ICON } from "../interact";
import type { QualityProfile } from "../../../quality/tier";
import { cloneModel, loadGltf } from "../../kit3d/assets";
import { Character } from "../../kit3d/character";
import { createCinematic, prepareModel, type Cinematic } from "../../kit3d/cinematic";
import { ANIMATIONS, BASE, CHEF_SHEETS, HDRI, PANO, SCENERY, type KitchenInfo, kitchenInfo, texture } from "./assets";
import { carriedDraws, chefModel, kitchenModel, type FoodDraw } from "./model";
import { Emitters, Puffs } from "./particles";
import { Overlay } from "./overlay";
import { Stage } from "./stage";
import { react } from "./feedback";
import type { KitchenView, ViewLook } from "./types";

const CLIP: Record<string, string> = { idle: "Idle", run: "Running_A", carry: "Idle", carryrun: "Running_A", work: "1H_Melee_Attack_Slice_Horizontal", cheer: "Cheer" };
const ARMS: Array<[string, THREE.Vector3]> = [
  ["upperarm.l", new THREE.Vector3(0.25, -0.55, 0.8)], ["upperarm.r", new THREE.Vector3(-0.25, -0.55, 0.8)],
  ["lowerarm.l", new THREE.Vector3(-0.35, 0.05, 0.9)], ["lowerarm.r", new THREE.Vector3(0.35, 0.05, 0.9)],
];

export class CineView implements KitchenView {
  readonly camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.1, 200);
  readonly renderer: THREE.WebGLRenderer;
  private cine: Cinematic;
  private scene = new THREE.Scene();
  private stage = new Stage();
  private overlay: Overlay;
  private kitchen = new THREE.Group();
  private doors: THREE.Object3D | null = null;
  private info_: KitchenInfo | null = null;
  private chefs = new Map<string, Character>();
  private food = new Map<string, THREE.Object3D>();
  private pool = new Map<string, THREE.Object3D[]>();
  private used = new Map<string, number>();
  private foodGroup = new THREE.Group();
  private soft: Puffs;
  private glow: Puffs;
  private fx: Emitters;
  private draws: FoodDraw[] = [];
  private scenery: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>[] = [];
  private lamps: THREE.PointLight[] = [];
  private sun: THREE.DirectionalLight | null = null;
  private hemi = new THREE.HemisphereLight("#fff2dc", "#3a2a20", 0.5);
  private shake = 0;
  private time = 0;
  private loaded = -1;
  private tmpQ = new THREE.Quaternion();
  private tmpV = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement, overlayEl: HTMLElement, private profile: QualityProfile, private looks: Map<string, ViewLook>) {
    this.cine = createCinematic(canvas, profile, { scene: this.scene, camera: this.camera });
    this.renderer = this.cine.renderer;
    this.overlay = new Overlay(overlayEl);
    const n = Math.min(900, profile.particleBudget);
    this.soft = new Puffs(n, false);
    this.glow = new Puffs(n, true);
    this.fx = new Emitters(this.soft, this.glow, profile.particleBudget);
    this.scene.add(this.kitchen, this.foodGroup, this.soft.mesh, this.glow.mesh, this.hemi);
    this.scene.background = new THREE.Color("#9cc6d8");
    this.scene.fog = new THREE.Fog("#cfe0dc", 30, 80);
  }

  async load(onProgress?: (p: number) => void) {
    let done = 0;
    const step = <T,>(p: Promise<T>) => p.then((v) => { onProgress?.(++done / 9); return v; });
    const [, foodGltf, anims, ...chefList] = await Promise.all([
      step(this.cine.environment(this.scene, HDRI, { background: false, intensity: 0.55 })),
      step(loadGltf(`${BASE}/food.glb`)),
      step(loadGltf(ANIMATIONS)),
      ...Array.from({ length: CHEF_SHEETS }, (_, i) => step(loadGltf(`${BASE}/chef-${i + 1}.glb`).catch(() => null))),
    ]);
    const chefs = chefList.filter((c): c is NonNullable<typeof c> => !!c);
    if (!chefs.length) throw new Error("no chef models");
    for (const child of foodGltf.scene.children) this.food.set(child.name, child);
    let slot = 0;
    for (const [id, look] of this.looks) {
      const src = chefs[slot % chefs.length]!.scene;
      const model = cloneModel(src);
      const c = new Character(model, anims.animations, { scale: 1 });
      model.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.castShadow = true;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const mm of mats) if (/magenta/i.test(mm.name)) (mm as THREE.MeshToonMaterial).color.set(look.color);
      });
      c.play("Idle");
      this.chefs.set(id, c);
      this.scene.add(c.root);
      slot++;
    }
    const [far, fields] = await Promise.all([texture(SCENERY.far, true), texture(SCENERY.fields, true)]);
    const [platform, tunnel] = await Promise.all([texture(SCENERY.platform, true), texture(SCENERY.tunnel, true)]);
    for (const [tex, depth, kind] of [[far, 13, "far"], [fields, 5.4, "fields"], [platform, 5.3, "platform"], [tunnel, 5.2, "tunnel"]] as const) {
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: kind === "far", fog: false });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
      const s = kind === "far" ? 2.2 : 1.0;
      mesh.scale.set(PANO.length * s, PANO.height * s, 1);
      mesh.position.set(0, (PANO.height * s) / 2 - (kind === "far" ? 4.5 : 2.2), -depth);
      mesh.userData.kind = kind;
      tex.repeat.set(1, 1);
      this.scenery.push(mesh);
      this.scene.add(mesh);
    }
    this.buildGround();
    onProgress?.(1);
  }

  private track: THREE.Texture | null = null;

  /** Grass all around and a ballast bed with sleepers under the carriage (scrolls with the train). */
  private buildGround() {
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(220, 220).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: "#5f8f3c", roughness: 0.95 }));
    grass.position.y = -1.0;
    grass.receiveShadow = true;
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 128;
    const g = c.getContext("2d")!;
    g.fillStyle = "#6e665c";
    g.fillRect(0, 0, 256, 128);
    let seed = 9;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 900; i++) {
      g.fillStyle = `hsl(30, ${8 + r() * 10}%, ${28 + r() * 30}%)`;
      g.fillRect(r() * 256, r() * 128, 2 + r() * 3, 2 + r() * 3);
    }
    g.fillStyle = "#4a3627";
    g.fillRect(96, 8, 64, 112);
    g.fillStyle = "#b8bec4";
    g.fillRect(0, 28, 256, 6);
    g.fillRect(0, 94, 256, 6);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.repeat.set(220 / 0.9, 1);
    tex.anisotropy = 4;
    this.track = tex;
    const bed = new THREE.Mesh(new THREE.PlaneGeometry(220, 7.6).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
    bed.position.y = -0.97;
    bed.receiveShadow = true;
    this.scene.add(grass, bed);
  }

  async level(m: Match) {
    if (this.loaded === m.levelIndex) return;
    const id = LEVELS[m.levelIndex]!.id;
    const [info, gltf] = await Promise.all([kitchenInfo(id), loadGltf(`${BASE}/kitchen-${id}.glb`)]);
    this.info_ = info;
    this.loaded = m.levelIndex;
    this.kitchen.clear();
    const k = cloneModel(gltf.scene);
    prepareModel(k, this.profile, { envIntensity: 0.9 });
    this.kitchen.add(k);
    this.doors = k.getObjectByName("doors") ?? null;
    for (const l of this.lamps) l.removeFromParent();
    this.lamps = [];
    const W = info.cols;
    for (let i = 0; i < 3; i++) {
      const l = new THREE.PointLight("#ffbf7a", 6, 7, 1.6);
      l.position.set((i - 1) * W * 0.33, 1.9, -info.rows / 2 + 0.6);
      this.lamps.push(l);
      this.scene.add(l);
    }
    if (!this.sun) {
      this.sun = this.cine.sun(this.scene, { position: [-4, 9, -7], intensity: 2.6, extent: 9, color: "#fff0d8" });
    }
  }

  private item(name: string): THREE.Object3D | null {
    const src = this.food.get(name);
    if (!src) return null;
    const list = this.pool.get(name) ?? [];
    this.pool.set(name, list);
    const i = this.used.get(name) ?? 0;
    this.used.set(name, i + 1);
    if (!list[i]) {
      const o = src.clone();
      o.position.set(0, 0, 0);
      o.traverse((x) => { if ((x as THREE.Mesh).isMesh) { x.castShadow = true; x.receiveShadow = true; } });
      prepareModel(o, this.profile);
      list.push(o);
      this.foodGroup.add(o);
    }
    const o = list[i]!;
    o.visible = true;
    return o;
  }

  frame(m: Match, dt: number, events: Ev[]) {
    const info = this.info_;
    if (!info) return;
    this.time += dt;
    const st = this.stage.update(m, dt);
    // camera: the same framing as the lite view, but in perspective (a narrow lens for the diorama look)
    const pitch = THREE.MathUtils.degToRad(info.pitchDeg);
    const dist = (1.3 * info.viewWidth / 2 / Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) / this.camera.aspect) / st.zoom; // perspective: the near edge needs room
    this.shake = Math.max(0, this.shake - dt * 2.2);
    const sh = this.shake * this.shake * 0.1;
    const tgt = new THREE.Vector3(info.target[0] + st.panX + Math.sin(this.time * 47) * sh, info.target[1] + st.bob + 0.25, info.target[2] + st.panZ + 0.9);
    this.camera.position.set(tgt.x, tgt.y + Math.sin(pitch) * dist, tgt.z + Math.cos(pitch) * dist);
    this.camera.up.set(Math.sin(st.roll), Math.cos(st.roll), 0);
    this.camera.lookAt(tgt);
    // light: day, tunnel dark (lamps carry the scene), the sun through the windows
    const dark = st.dark;
    if (this.sun) this.sun.intensity = 2.6 * (1 - dark) * (1 - 0.7 * st.tunnel);
    this.hemi.intensity = 0.5 * (1 - 0.8 * dark);
    this.scene.environmentIntensity = 0.55 * (1 - 0.75 * dark);
    for (const l of this.lamps) l.intensity = 6 + 14 * dark + Math.sin(this.time * 13 + l.position.x) * 0.3 * dark;
    this.cine.setBloom(0.22 + 0.25 * dark);
    for (const s of this.scenery) {
      const kind = s.userData.kind as string;
      const tex = s.material.map!;
      tex.offset.x = (st.run * (kind === "far" ? 0.12 : 1)) / PANO.length;
      s.material.opacity = kind === "platform" ? st.platform : kind === "tunnel" ? st.tunnel : kind === "fields" ? 1 - Math.max(st.platform, st.tunnel) : 1;
      s.visible = s.material.opacity > 0.01;
      s.material.color.setScalar(kind === "far" ? 1 - 0.8 * st.tunnel : 1);
    }
    if (this.track) this.track.offset.x = (st.run * this.track.repeat.x) / 220;
    if (this.doors) this.doors.visible = true;
    // food
    this.used.clear();
    for (const list of this.pool.values()) for (const o of list) o.visible = false;
    const model = kitchenModel(m, LEVELS[m.levelIndex]!.layout);
    this.draws.length = 0;
    this.draws.push(...model.foods);
    if (m.phase !== "levelEnd" && m.phase !== "results") carriedDraws(m, this.draws);
    for (const f of this.draws) {
      const o = this.item(f.name);
      if (!o) continue;
      o.position.set(f.x, f.y, f.z);
      o.scale.setScalar(1.25 * f.scale * (f.alpha < 0.5 && f.name.startsWith("tava_dosa") ? 0.001 : 1));
    }
    // chefs
    for (const c of chefModel(m)) {
      const ch = this.chefs.get(c.id);
      if (!ch) continue;
      ch.root.position.set(c.x, 0, c.z);
      ch.root.rotation.y = c.heading;
      const clip = CLIP[c.clip]!;
      ch.play(clip, { timeScale: c.clip === "run" || c.clip === "carryrun" ? Math.max(0.7, c.speed / 3.6) : c.clip === "work" ? 1.6 : 1 });
      ch.update(dt);
      if (c.carrying) this.holdOut(ch);
      const look = this.looks.get(c.id);
      const verb = verbFor(m, c.id);
      this.overlay.tag(c.id, look?.name ?? "", look?.color ?? "#fff", c.x, 1.95, c.z, m.phase === "service" && verb !== "none" ? VERB_ICON[verb] : "", this.camera);
    }
    for (const e of model.fx) this.fx.emit(`${e.kind}${e.x.toFixed(1)}${e.z.toFixed(1)}`, e.kind, e.x, e.y, e.z, e.rate, dt);
    react(m, events, this.fx, this.overlay, this.camera, (a) => { this.shake = Math.min(1, this.shake + a); });
    this.soft.update(dt);
    this.glow.update(dt);
    this.overlay.setRings(model.rings, this.camera, m.phase === "service");
    this.cine.render(this.scene, this.camera);
  }

  /** Arms forward, as if carrying a plate (after the animation pose). */
  private holdOut(ch: Character) {
    ch.root.updateMatrixWorld(true);
    for (const [name, local] of ARMS) {
      const bone = ch.model.getObjectByName(name);
      if (!bone?.parent) continue;
      const dir = local.clone().applyQuaternion(ch.root.quaternion).normalize();
      bone.updateMatrixWorld(true);
      const wq = bone.getWorldQuaternion(this.tmpQ);
      const yAxis = this.tmpV.set(0, 1, 0).applyQuaternion(wq).normalize();
      const turn = new THREE.Quaternion().setFromUnitVectors(yAxis, dir);
      const parentQ = bone.parent.getWorldQuaternion(new THREE.Quaternion());
      bone.quaternion.copy(parentQ.invert().multiply(turn.multiply(wq)));
      bone.updateMatrixWorld(true);
    }
  }

  info() {
    const r = this.renderer.info.render;
    return { calls: r.calls, tris: r.triangles };
  }

  dispose() {
    this.overlay.clear();
    this.soft.dispose();
    this.glow.dispose();
    this.cine.dispose();
  }
}
