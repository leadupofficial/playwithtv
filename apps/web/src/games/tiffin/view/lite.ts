/**
 * The lite view (1 GB Mali-G31 TVs): a Blender-baked backdrop of the kitchen carriage (Cycles light, AO, soft
 * shadows) drawn as one quad, window scenery as scrolling pre-rendered strips, depth-only boxes for the counters,
 * and every chef and dish as pre-lit sprites. About ten draw calls; no real-time lighting at all.
 */
import * as THREE from "three";
import type { Ev, Match } from "../engine";
import { LEVELS } from "../levels";
import type { QualityProfile } from "../../../quality/tier";
import { type ChefSheet, PANO, SCENERY, type KitchenInfo, chefSheet, foodSheet, kitchenInfo, texture, BASE, CHEF_SHEETS } from "./assets";
import { BLOCK, carriedDraws, chefModel, kitchenModel, type FoodDraw } from "./model";
import { UprightSprites } from "./sprites";
import { Emitters, Puffs } from "./particles";
import { Overlay } from "./overlay";
import { Stage } from "./stage";
import { react } from "./feedback";
import type { KitchenView, ViewLook } from "./types";
import type { SpriteSheet } from "../../kit25d/spriteBatch";
import { verbFor } from "../engine";
import { VERB_ICON } from "../interact";

const SCROLL_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

/** Up to three textures mixed (fields / platform / tunnel, or day / shut / dark), scrolled, dimmed. */
const MIX_FRAG = /* glsl */ `
uniform sampler2D a; uniform sampler2D b; uniform sampler2D c;
uniform float wb; uniform float wc; uniform float offset; uniform float repeat; uniform float light; uniform vec3 tint;
varying vec2 vUv;
void main() {
  vec2 uv = vec2(vUv.x * repeat + offset, vUv.y);
  vec4 col = texture2D(a, uv);
  col = mix(col, texture2D(b, uv), wb);
  col = mix(col, texture2D(c, uv), wc);
  if (col.a < 0.004) discard;
  gl_FragColor = vec4(col.rgb * light * tint, col.a);
  #include <colorspace_fragment>
}`;

function mixMaterial(a: THREE.Texture, b: THREE.Texture, c: THREE.Texture) {
  return new THREE.ShaderMaterial({
    vertexShader: SCROLL_VERT, fragmentShader: MIX_FRAG, transparent: true, depthWrite: false, depthTest: false,
    uniforms: { a: { value: a }, b: { value: b }, c: { value: c }, wb: { value: 0 }, wc: { value: 0 }, offset: { value: 0 }, repeat: { value: 1 }, light: { value: 1 }, tint: { value: new THREE.Color(1, 1, 1) } },
  });
}

export class LiteView implements KitchenView {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.OrthographicCamera;
  private scene = new THREE.Scene();
  private stage = new Stage();
  private overlay: Overlay;
  private info_: KitchenInfo | null = null;
  private levelGroup = new THREE.Group();
  private far!: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private near!: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private track!: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private backdrop: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> | null = null;
  private chefs: UprightSprites[] = [];
  private chefSheets: ChefSheet[] = [];
  private food!: UprightSprites;
  private foodIndex = new Map<string, number>();
  private soft = new Puffs(260, false);
  private glow = new Puffs(260, true);
  private fx: Emitters;
  private animT = new Map<string, number>();
  private foods: FoodDraw[] = [];
  private shake = 0;
  private time = 0;
  private loadedLevel = -1;
  private panoK = 0.45;

  constructor(canvas: HTMLCanvasElement, overlayEl: HTMLElement, private profile: QualityProfile, private looks: Map<string, ViewLook>) {
    const { w, h } = profile.resolution;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(w, h, false);
    this.renderer.setClearColor("#1a2a22");
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.camera = new THREE.OrthographicCamera(-8, 8, 4.5, -4.5, 0.1, 200);
    this.overlay = new Overlay(overlayEl);
    this.fx = new Emitters(this.soft, this.glow, profile.particleBudget);
    this.scene.add(this.levelGroup, this.soft.mesh, this.glow.mesh);
  }

  /** Loads the shared sheets once (chefs, food, scenery). */
  async load(onProgress?: (p: number) => void) {
    let done = 0;
    const step = <T,>(p: Promise<T>) => p.then((v) => { onProgress?.(++done / 8); return v; });
    const [chefs, food, far, fields, platform, tunnel, track] = await Promise.all([
      step(Promise.allSettled(Array.from({ length: CHEF_SHEETS }, (_, i) => chefSheet(i + 1))).then((r) => {
        const ok = r.flatMap((x) => (x.status === "fulfilled" ? [x.value] : []));
        if (!ok.length) throw new Error("no chef sprites");
        return ok;
      })),
      step(foodSheet()),
      step(texture(SCENERY.far, true)), step(texture(SCENERY.fields, true)), step(texture(SCENERY.platform, true)),
      step(texture(SCENERY.tunnel, true)), step(texture(SCENERY.track, true)),
    ]);
    this.chefSheets = chefs;
    this.food = new UprightSprites(food.sheet, 240, { pitchDeg: 45 });
    this.foodIndex = food.index;
    this.food.mesh.renderOrder = 3;
    this.scene.add(this.food.mesh);
    const plane = () => new THREE.PlaneGeometry(1, 1);
    this.far = new THREE.Mesh(plane(), mixMaterial(far, far, far));
    this.near = new THREE.Mesh(plane(), mixMaterial(fields, platform, tunnel));
    this.track = new THREE.Mesh(plane(), mixMaterial(track, track, track));
    this.far.renderOrder = -4;
    this.near.renderOrder = -3;
    this.track.renderOrder = -2;
    this.scene.add(this.far, this.near, this.track);
    onProgress?.(1);
  }

  async level(m: Match) {
    if (this.loadedLevel === m.levelIndex) return;
    const id = LEVELS[m.levelIndex]!.id;
    const info = await kitchenInfo(id);
    const b = info.backdrops;
    const [day, shut, dark] = await Promise.all([
      texture(`${BASE}/${b.day}`), texture(`${BASE}/${b.shut ?? b.day}`), texture(`${BASE}/${b.dark ?? b.day}`),
    ]);
    this.levelGroup.clear();
    this.backdrop?.geometry.dispose();
    this.backdrop?.material.dispose();
    this.info_ = info;
    this.loadedLevel = m.levelIndex;
    const pitch = THREE.MathUtils.degToRad(info.pitchDeg);
    const right = new THREE.Vector3(1, 0, 0), up = new THREE.Vector3(0, Math.cos(pitch), -Math.sin(pitch));
    const back = new THREE.Vector3(0, -Math.sin(pitch), -Math.cos(pitch));
    const target = new THREE.Vector3(...info.target);
    const sOf = (p: THREE.Vector3) => p.dot(up);
    const sT = sOf(target);
    /** A camera-facing quad of w × h screen metres centred at screen offset (a, s) from the target, pushed back. */
    const quad = (mesh: THREE.Mesh, w: number, h: number, a: number, s: number, depth: number) => {
      mesh.scale.set(w, h, 1);
      mesh.position.copy(target).addScaledVector(right, a).addScaledVector(up, s - sT).addScaledVector(back, depth);
      mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, back.clone().negate()));
    };
    const W = info.viewWidth * info.margin, H = (W * info.image.h) / info.image.w;
    this.backdrop = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mixMaterial(day, shut, dark));
    this.backdrop.renderOrder = -1;
    quad(this.backdrop, W, H, 0, sT, 30);
    this.levelGroup.add(this.backdrop);
    // window scenery: the panorama's ground line sits a little above the back wall's foot
    // panoramas tile across the whole width (a tile is PANO.length × k metres)
    const pk = 0.45, ph = PANO.height * pk;
    quad(this.far, W, ph, 0, 2.95 + ph / 2, 60);
    quad(this.near, W, ph, 0, 2.85 + ph / 2, 50);
    quad(this.track, W, (PANO.length * 844) / 1500, 0, sT, 40);
    this.far.material.uniforms.repeat!.value = W / (PANO.length * pk);
    this.near.material.uniforms.repeat!.value = W / (PANO.length * pk);
    this.track.material.uniforms.repeat!.value = W / PANO.length;
    this.panoK = pk;
    // depth-only blocks for the counters, so sprites behind an island are hidden by it
    const layout = LEVELS[m.levelIndex]!.layout;
    const boxes: THREE.BufferGeometry[] = [];
    const k = m.kitchen;
    for (const t of k.tiles) {
      const h = BLOCK[t.code];
      if (!h) continue;
      const g = new THREE.BoxGeometry(1, h, 1);
      g.translate((t.c - (k.w - 1) / 2), h / 2, (t.r - (k.h - 1) / 2));
      boxes.push(g);
    }
    void layout;
    const { mergeGeometries } = await import("three/examples/jsm/utils/BufferGeometryUtils.js");
    const occ = new THREE.Mesh(mergeGeometries(boxes)!, new THREE.MeshBasicMaterial({ colorWrite: false }));
    occ.renderOrder = 0;
    this.levelGroup.add(occ);
    // chefs: one batch per sheet (players share a sheet when there are more than four)
    for (const c of this.chefs) { this.scene.remove(c.mesh); c.dispose(); }
    this.chefs = this.chefSheets.map((s) => {
      const b2 = new UprightSprites(s as SpriteSheet, 2, { keyTint: true, pitchDeg: info.pitchDeg });
      b2.mesh.renderOrder = 2;
      this.scene.add(b2.mesh);
      return b2;
    });
  }

  frame(m: Match, dt: number, events: Ev[]) {
    const info = this.info_;
    if (!info) return;
    this.time += dt;
    const st = this.stage.update(m, dt);
    const pitch = THREE.MathUtils.degToRad(info.pitchDeg);
    // camera: orthographic, the backdrop's exact pitch; zoom, drift, roll and shake within the backdrop's margin
    const halfW = info.viewWidth / 2 / st.zoom;
    const cam = this.camera;
    cam.left = -halfW; cam.right = halfW; cam.top = (halfW * 9) / 16; cam.bottom = -(halfW * 9) / 16;
    cam.updateProjectionMatrix();
    this.shake = Math.max(0, this.shake - dt * 2.2);
    const sh = this.shake * this.shake * 0.12;
    const slack = Math.max(0, (info.viewWidth * info.margin) / 2 - halfW - 0.35);
    const px = THREE.MathUtils.clamp(st.panX + Math.sin(this.time * 47) * sh, -slack, slack);
    const pz = THREE.MathUtils.clamp(st.panZ + Math.cos(this.time * 39) * sh, -slack * 0.5, slack * 0.5);
    const tgt = new THREE.Vector3(info.target[0] + px, info.target[1] + st.bob, info.target[2] + pz);
    cam.position.set(tgt.x, tgt.y + Math.sin(pitch) * 50, tgt.z + Math.cos(pitch) * 50);
    cam.up.set(Math.sin(st.roll), Math.cos(st.roll), 0);
    cam.lookAt(tgt);
    // scenery and backdrop
    const light = 1 - 0.62 * st.dark;
    const warm = new THREE.Color(1, 1 - 0.12 * st.dark, 1 - 0.3 * st.dark);
    const setMix = (mesh: { material: THREE.ShaderMaterial }, offset: number, wb: number, wc: number, l: number) => {
      const u = mesh.material.uniforms;
      u.offset!.value = offset; u.wb!.value = wb; u.wc!.value = wc; u.light!.value = l;
    };
    setMix(this.far, (st.run * 0.12) / (PANO.length * this.panoK), 0, 0, 1 - 0.85 * st.tunnel);
    setMix(this.near, (st.run * 0.6) / (PANO.length * this.panoK), st.platform, st.tunnel, 1);
    setMix(this.track, (st.run * 1.0) / PANO.length, 0, 0, light);
    if (this.backdrop) {
      setMix(this.backdrop, 0, st.doors, st.dark, 1);
      this.backdrop.material.uniforms.tint!.value.setRGB(1, 1, 1);
    }
    // food and dishes
    const model = kitchenModel(m, LEVELS[m.levelIndex]!.layout);
    this.foods.length = 0;
    for (const f of model.foods) this.foods.push(f);
    if (m.phase !== "levelEnd" && m.phase !== "results") carriedDraws(m, this.foods);
    this.food.clear();
    const fps = this.food.sheet.manifest.fps;
    void fps;
    let n = 0;
    for (const f of this.foods) {
      const idx = this.foodIndex.get(f.name);
      if (idx === undefined || n >= this.food.capacity) continue;
      this.food.set(n++, { x: f.x, y: f.y + 0.004, z: f.z, frame: idx, scale: f.scale * 1.25, alpha: f.alpha, light: light * 1.02 });
    }
    this.food.update(cam);
    // chefs
    for (const b of this.chefs) b.clear();
    const used = new Map<number, number>();
    for (const c of chefModel(m)) {
      const sheetIx = c.slot % this.chefSheets.length;
      const sheet = this.chefSheets[sheetIx]!;
      const clip = sheet.clips[c.clip] ?? sheet.clips.idle!;
      const t = (this.animT.get(c.id) ?? 0) + dt * (c.clip === "run" || c.clip === "carryrun" ? Math.max(0.7, c.speed / 3.9) : 1);
      this.animT.set(c.id, t);
      const frame = clip.start + (Math.floor(t * clip.fps) % clip.count);
      const slot = used.get(sheetIx) ?? 0;
      used.set(sheetIx, slot + 1);
      const look = this.looks.get(c.id);
      this.chefs[sheetIx]!.set(slot, { x: c.x, y: 0, z: c.z, heading: c.heading, frame, tint: look?.color ?? null, light: light * 1.04 });
      const verb = verbFor(m, c.id);
      this.overlay.tag(c.id, look?.name ?? "", look?.color ?? "#fff", c.x, 1.95, c.z, m.phase === "service" && verb !== "none" ? VERB_ICON[verb] : "", cam);
    }
    for (const b of this.chefs) b.update(cam);
    // effects
    for (const e of model.fx) this.fx.emit(`${e.kind}${e.x.toFixed(1)}${e.z.toFixed(1)}`, e.kind, e.x, e.y, e.z, e.rate, dt);
    react(m, events, this.fx, this.overlay, cam, (a) => { this.shake = Math.min(1, this.shake + a); });
    this.soft.update(dt);
    this.glow.update(dt);
    this.overlay.setRings(model.rings, cam, m.phase === "service");
    this.renderer.render(this.scene, cam);
  }

  info() {
    const r = this.renderer.info.render;
    return { calls: r.calls, tris: r.triangles };
  }

  dispose() {
    this.overlay.clear();
    for (const c of this.chefs) c.dispose();
    this.food?.dispose();
    this.soft.dispose();
    this.glow.dispose();
    this.renderer.dispose();
  }
}
