/**
 * The TV picture: one scene, drawn once per split-screen view. Lite: a plain WebGLRenderer, unlit baked world,
 * sprite vehicles, no post. High/ultra: kit3d cinematic (HDRI light, shadows that follow each player, bloom,
 * AA, AgX) with real-time models. Effects (glows, trails, rain, sparks, spray, debris) are shared.
 */
import * as THREE from "three";
import type { QualityProfile } from "../../quality/tier";
import { createCinematic, type Cinematic } from "../kit3d/cinematic";
import { Particles, sparkleGeometry } from "../kit3d/particles";
import { renderViews, useMultiView, type MultiViewPass, type View } from "../kit3d/multiview";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import type { Feature } from "../../quality/adaptive";
import { FOG, buildWorld, type World } from "./world";
import { loadProps } from "./props";
import { BASE, modelActors, spriteActors, type ActorLayer, type CoconutPose, type PickupPose } from "./vehicles";
import { Glows, Puffs, Rain, Trails } from "./fx";
import { ChaseCam } from "./camera";
import { KINDS, type Kind } from "./racer";
import type { GoatPose, RacerPose, TrafficPose } from "./actors";
import type { Track } from "./track";

const HDRI = "/assets/cinematic/showroom/kloofendal_overcast_puresky_1k.hdr";
const LEVEL_COLOR = ["#ffffff", "#41b8ff", "#ff9a1f", "#d04bff"];
const v3 = new THREE.Vector3();

export interface DrawView { rect: { x: number; y: number; w: number; h: number }; camera: THREE.PerspectiveCamera; focus: RacerPose | null }

export class GhatView {
  readonly scene = new THREE.Scene();
  readonly renderer: THREE.WebGLRenderer;
  readonly cine: Cinematic | null;
  readonly cams: ChaseCam[] = [];
  readonly extra = [new THREE.PerspectiveCamera(50, 16 / 9, 0.3, 1400), new THREE.PerspectiveCamera(50, 16 / 9, 0.3, 1400)];
  world!: World;
  actors!: ActorLayer;
  readonly glows: Glows;
  readonly rain: Rain;
  readonly trails: Trails;
  readonly sparks: Particles;
  readonly spray: Puffs;
  readonly debris: Particles;
  /** Mist banks drifting in the valleys (normal blending). */
  readonly mist: Glows;
  private mistSpots: Array<{ x: number; y: number; z: number; size: number; k: number }> = [];
  private mv: MultiViewPass | null = null;
  private sun: THREE.DirectionalLight | null = null;
  private hemi: THREE.HemisphereLight;
  private flashT = 0;
  private nextFlash = 9;
  private fog: THREE.Fog;
  private fogBase = new THREE.Color(FOG);
  width: number;
  height: number;
  /** Full-size drawing buffer before the adaptive render scale. */
  readonly baseW: number;
  readonly baseH: number;
  scale = 1;

  private constructor(readonly canvas: HTMLCanvasElement, readonly q: QualityProfile, readonly track: Track, players: number) {
    const lite = q.prerendered;
    // GHAT RUSH draws at most 1080p (ultra keeps its materials, shadows and post; the 1440p buffer cost half the
    // frame rate) and at 960×540 on lite (the TV upscales; a Mali-G31 is fill-rate bound)
    const res = lite ? { w: 960, h: 540 } : q.resolution.w > 1920 ? { w: 1920, h: 1080 } : q.resolution;
    this.width = this.baseW = res.w;
    this.height = this.baseH = res.h;
    this.fog = new THREE.Fog(FOG, lite ? 18 : 45, lite ? 155 : 420);
    this.scene.fog = this.fog;
    this.scene.background = new THREE.Color(FOG);
    if (lite) {
      this.cine = null;
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance", stencil: false });
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(this.width, this.height, false);
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    } else {
      // no GTAO: at 1080p it alone cost ~15 ms on an M4; the sprites' and models' baked shading carries the look
      this.cine = createCinematic(canvas, { ...q, resolution: res, post: { ...q.post, ao: false } }, { scene: this.scene, camera: this.extra[0], adaptive: false }); // GHAT RUSH runs its own guard (session.ts), which can also step the tier down
      this.renderer = this.cine.renderer;
      // ACES: more contrast and colour than AgX for a rainy, overcast scene (AgX greys it out)
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.15;
      this.mv = useMultiView(this.cine, this.scene, players);
      this.sun = this.cine.sun(this.scene, { position: [-30, 60, 25], intensity: 1.6, color: "#fff3e0", extent: 26 });
      this.sun.shadow.camera.far = 160;
      this.sun.shadow.camera.updateProjectionMatrix();
    }
    this.hemi = new THREE.HemisphereLight("#dbe6e4", "#4a5a3a", lite ? 1.6 : 0.6);
    this.scene.add(this.hemi);
    for (let i = 0; i < Math.max(1, players); i++) this.cams.push(new ChaseCam());
    this.glows = new Glows(lite ? 140 : 380);
    this.rain = new Rain(lite ? 60 : Math.min(1400, q.particleBudget), lite ? 26 : 40);
    this.trails = new Trails(16, lite ? 10 : 16);
    const budget = q.particleBudget;
    this.sparks = new Particles(sparkleGeometry(), new THREE.MeshBasicMaterial({ color: "#ffffff", side: THREE.DoubleSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), Math.round(budget * 0.4));
    this.spray = new Puffs(this.glows, lite ? 40 : 140);
    this.debris = new Particles(new THREE.BoxGeometry(0.4, 0.12, 0.3), lite ? new THREE.MeshLambertMaterial({ color: "#ffffff" }) : new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.5 }), Math.round(budget * 0.25));
    this.mist = new Glows(lite ? 1 : 18, false);
    this.mist.mesh.renderOrder = 2;
    this.scene.add(this.glows.mesh, this.rain.mesh, this.sparks.mesh, this.debris.mesh);
    // lite: no tail-light ribbons or mist banks (big transparent quads are what a fill-rate bound TV can't afford)
    if (!lite) this.scene.add(this.trails.mesh, this.mist.mesh);
    for (const c of [...this.cams.map((x) => x.camera), ...this.extra]) c.far = lite ? 172 : 640; // fog hides everything past ~420 m anyway: do not draw it
    // mist banks: over the drops beside the road, below and around road level
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < (lite ? 0 : 18); k++) {
      for (let tries = 0; tries < 40; tries++) {
        const i = Math.floor(rnd() * track.n);
        const side = rnd() < 0.5 ? -1 : 1;
        if ((side > 0 ? track.right[i] : track.left[i]) !== "drop") continue;
        const h = track.heading[i]!, e = track.hw[i]! + 25 + rnd() * 90;
        this.mistSpots.push({ x: track.x[i]! - Math.cos(h) * e * side, y: track.y[i]! - 4 - rnd() * 10, z: track.z[i]! + Math.sin(h) * e * side, size: 45 + rnd() * 60, k: 0.35 + rnd() * 0.25 });
        break;
      }
    }
  }

  static async create(canvas: HTMLCanvasElement, q: QualityProfile, track: Track, field: Array<{ kind: Kind; color: string }>, players: number, onProgress?: (p: number) => void): Promise<GhatView> {
    const v = new GhatView(canvas, q, track, players);
    let a = 0, b = 0;
    const report = () => onProgress?.(a * 0.7 + b * 0.3);
    const [actors, kit] = await Promise.all([
      q.prerendered ? spriteActors((p) => { a = p; report(); }) : modelActors(q, field, (p) => { a = p; report(); }),
      loadProps(`${BASE}/props.glb`).then((k) => { b = 1; report(); return k; }),
      v.cine ? v.cine.environment(v.scene, HDRI, { background: false, intensity: 0.75 }) : Promise.resolve(null),
    ]);
    v.actors = actors;
    v.world = buildWorld(track, kit, q);
    v.scene.add(v.world.group, actors.group);
    return v;
  }

  /** Adaptive quality: draw at `s` × the full drawing-buffer size (the canvas is CSS-stretched). */
  setScale(s: number) {
    this.scale = s;
    this.width = Math.round(this.baseW * s);
    this.height = Math.round(this.baseH * s);
    this.renderer.setSize(this.width, this.height, false);
    this.cine?.composer?.setSize(this.width, this.height);
  }

  /** Adaptive quality: turn an expensive feature off. */
  drop(f: Feature) {
    const composer = this.cine?.composer;
    if (f === "ao" && composer) for (const p of [...composer.passes]) if (p instanceof GTAOPass) composer.removePass(p);
    if (f === "bloom" && composer) for (const p of [...composer.passes]) if (p instanceof UnrealBloomPass) composer.removePass(p);
    if (f === "shadows-small" && this.sun) {
      this.sun.shadow.mapSize.set(512, 512);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    if (f === "shadows" && this.sun) {
      this.sun.castShadow = false;
      this.renderer.shadowMap.enabled = false;
      this.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material;
        if (m) (Array.isArray(m) ? m : [m]).forEach((x) => (x.needsUpdate = true));
      });
    }
  }

  /** A burst for a race moment at a pose. */
  sparksAt(p: { x: number; y: number; z: number }, color: string, count: number, speed = 6) {
    this.sparks.burst(v3.set(p.x, p.y + 0.4, p.z), { count, color, speed, up: 2, gravity: 14, drag: 1.2, life: 0.45, size: 0.35, spin: 10 });
  }
  wreckAt(p: RacerPose) {
    this.debris.burst(v3.set(p.x, p.y + 0.7, p.z), { count: 14, color: p.color, colorJitter: 0.3, speed: 7, up: 5, gravity: 16, drag: 0.6, life: 1.6, size: 0.9, spin: 12, floor: p.y - p.hop + 0.05 });
    this.debris.burst(v3.set(p.x, p.y + 0.7, p.z), { count: 8, color: "#222", speed: 6, up: 4, gravity: 16, drag: 0.6, life: 1.5, size: 0.7, spin: 12, floor: p.y - p.hop + 0.05 });
    this.sparksAt(p, "#ffd27a", 18, 9);
    this.spray.burst(p.x, p.y + 0.6, p.z, 8, 4, 1.2, 2.2);
  }
  splashAt(p: { x: number; y: number; z: number }) {
    this.spray.burst(p.x, p.y + 0.4, p.z, 18, 9, 1.0, 1.8);
  }
  lightning() {
    this.flashT = 1;
  }

  private podiumGroup: THREE.Group | null = null;
  /** Gold, silver and bronze blocks at a spot (built once, when the podium starts). `spots` = [side offset, height]. */
  podium(x: number, y: number, z: number, heading: number, spots: Array<[number, number]>) {
    if (this.podiumGroup) return;
    const g = (this.podiumGroup = new THREE.Group());
    const cols = ["#f5c242", "#c9d3e0", "#d98b4b"];
    spots.forEach(([off, h], i) => {
      const mat = this.q.prerendered ? new THREE.MeshLambertMaterial({ color: cols[i] }) : new THREE.MeshStandardMaterial({ color: cols[i], roughness: 0.25, metalness: 0.6 });
      const box = new THREE.Mesh(new THREE.BoxGeometry(3.2, h, 4.2), mat);
      box.position.set(off, h / 2, 0);
      box.castShadow = box.receiveShadow = this.q.shadows.enabled;
      g.add(box);
    });
    g.position.set(x, y, z);
    g.rotation.y = heading;
    this.scene.add(g);
  }

  /** Per-frame dynamic dressing: glows, trails, continuous sparks and spray. */
  dress(racers: RacerPose[], traffic: TrafficPose[], goats: GoatPose[], pickups: PickupPose[], coconuts: CoconutPose[], time: number, dt: number) {
    this.actors.set(racers, traffic, goats, pickups, coconuts, time);
    const g = this.glows;
    g.begin();
    // a lamp and its smeared reflection in the wet road (mirrored about the ground under it)
    const lamp = (x: number, y: number, z: number, ground: number, size: number, color: string, k: number, dx: number, dz: number) => {
      g.add(x, y, z, size, color, k, dx, dz);
      g.add(x, 2 * ground - y + 0.05, z, -size * 1.7, color, k * 0.32, dx, dz);
    };
    racers.forEach((r, i) => {
      if (!r.visible) return;
      const k = KINDS[r.kind];
      const fx = Math.sin(r.yaw), fz = Math.cos(r.yaw), rx = -fz, rz = fx;
      const back = -k.len / 2 + 0.05, front = k.len / 2;
      const ground = r.y - r.hop;
      const lampY = r.y + (r.kind === "scooter" ? 0.62 : r.kind === "auto" ? 0.86 : 0.76);
      const tailW = r.kind === "scooter" ? 0 : k.wid * 0.36;
      for (const s of tailW ? [-1, 1] : [0]) lamp(r.x + fx * back + rx * s * tailW, lampY, r.z + fz * back + rz * s * tailW, ground, 0.32, "#ff2412", 1.1, -fx, -fz);
      lamp(r.x + fx * front, r.y + (r.kind === "auto" ? 0.98 : r.kind === "scooter" ? 1.3 : 0.76), r.z + fz * front, ground, 0.8, "#fff1cf", 0.9, fx, fz);
      if (r.boosting) {
        const fl = 0.9 + Math.sin(time * 40 + i) * 0.25;
        g.add(r.x + fx * (back - 0.45), r.y + 0.45, r.z + fz * (back - 0.45), 0.75 * fl, "#ff8a2a", 1.1);
        g.add(r.x + fx * (back - 0.25), r.y + 0.45, r.z + fz * (back - 0.25), 0.4 * fl, "#9fe0ff", 1.1);
      }
      if (r.drift && r.level > 0) {
        for (const s of [-1, 1]) g.add(r.x + fx * back + rx * s * k.wid * 0.5, r.y + 0.15, r.z + fz * back + rz * s * k.wid * 0.5, 0.35 + r.level * 0.12, LEVEL_COLOR[r.level]!, 1.6);
        if (Math.random() < 0.6) this.sparksAt({ x: r.x + fx * back, y: r.y - 0.2, z: r.z + fz * back }, LEVEL_COLOR[r.level]!, 1, 3);
      }
      // trails stretch only at speed
      this.trails.push(i, r.x + fx * back, lampY, r.z + fz * back, r.wrecked ? 0 : Math.min(1, Math.max(0, (r.speed - 22) / 12)) * (r.boosting ? 1 : 0.6));
      // wheel spray off the wet road
      if (!r.wrecked && r.speed > 18 && Math.random() < (this.q.prerendered ? 0.25 : 0.6)) {
        const s = Math.random() < 0.5 ? -1 : 1;
        this.spray.emit(r.x + fx * back + rx * s * k.wid * 0.4, r.y + 0.2, r.z + fz * back + rz * s * k.wid * 0.4, -fx * 3, 1.2, -fz * 3, 0.5, 0.5 + r.speed * 0.015);
      }
    });
    for (const c of traffic) {
      const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw), rx = -fz, rz = fx;
      for (const s of [-1, 1]) {
        lamp(c.x + fx * c.len * 0.5 + rx * s * 0.85, c.y + 1.1, c.z + fz * c.len * 0.5 + rz * s * 0.85, c.y, 1.3, "#fff3d6", 1.0, fx, fz);
        lamp(c.x - fx * c.len * 0.5 + rx * s * 0.95, c.y + 1.2, c.z - fz * c.len * 0.5 + rz * s * 0.95, c.y, 0.5, "#ff2a10", 1.2, -fx, -fz);
      }
    }
    for (const p of pickups) if (p.on) g.add(p.x, p.y + 1.1, p.z, 2.0, "#ffc94a", 0.5 + Math.sin(time * 4) * 0.15);
    this.spray.update(dt, "#9aa6aa", 0.35);
    g.end();
    this.trails.commit();
    this.rain.update(time);
    this.sparks.update(dt);
    this.sparks.mesh.visible = this.sparks.alive > 0;
    this.debris.update(dt);
    this.debris.mesh.visible = this.debris.alive > 0;
    this.world.update(time);
    this.mist.begin();
    this.mistSpots.forEach((m, i) => this.mist.add(m.x + Math.sin(time * 0.05 + i) * 12, m.y + Math.sin(time * 0.08 + i * 2) * 1.5, m.z + Math.cos(time * 0.04 + i) * 12, m.size, "#e4ebe8", m.k));
    this.mist.end();
    // monsoon lightning every so often
    this.nextFlash -= dt;
    if (this.nextFlash <= 0) {
      this.nextFlash = 11 + Math.random() * 9;
      this.flashT = 1;
    }
    const f = this.flashT > 0 ? Math.max(0, this.flashT) * (0.6 + 0.4 * Math.sin(this.flashT * 40)) : 0;
    this.flashT = Math.max(0, this.flashT - dt * 2.2);
    this.fog.color.copy(this.fogBase).lerp(new THREE.Color("#eef3ff"), f * 0.5);
    (this.scene.background as THREE.Color).copy(this.fog.color);
    (this.world.sky.material as THREE.MeshBasicMaterial).color.setScalar(1 + f * 0.6);
    this.hemi.intensity = (this.q.prerendered ? 1.6 : 0.6) * (1 + f * 1.5);
    this.actors.flash(f);
    if (this.cine) this.cine.setBloom(0.18 + f * 0.5);
  }

  /** Draws every view. */
  draw(views: DrawView[], time: number) {
    const W = this.width, H = this.height;
    const list: View[] = views.map((v) => {
      const px = { x: Math.round(v.rect.x * W), y: Math.round(H - (v.rect.y + v.rect.h) * H), w: Math.round(v.rect.w * W), h: Math.round(v.rect.h * H) };
      const gx = v.rect.x > 0 ? 2 : 0, gy = v.rect.y + v.rect.h < 0.999 ? 2 : 0;
      px.x += gx; px.w -= gx; px.y += gy; px.h -= gy;
      v.camera.aspect = px.w / px.h;
      v.camera.updateProjectionMatrix();
      return {
        camera: v.camera, ...px,
        before: () => {
          this.world.sky.position.copy(v.camera.position);
          this.actors.view(v.camera, time);
          if (this.sun && v.focus) {
            this.sun.target.position.set(v.focus.x, v.focus.y, v.focus.z);
            this.sun.position.set(v.focus.x - 30, v.focus.y + 60, v.focus.z + 25);
            this.sun.target.updateMatrixWorld();
          }
        },
      };
    });
    if (this.cine && this.mv) {
      this.mv.views = list;
      const composer = this.cine.composer!;
      for (const p of composer.passes) if (p instanceof GTAOPass) { p.scene = this.scene; p.camera = list[0]!.camera; }
      this.renderer.info.autoReset = false;
      this.renderer.info.reset();
      composer.render();
    } else renderViews(this.renderer, this.scene, list);
  }

  dispose() {
    this.world?.dispose();
    this.actors?.dispose();
    this.cine ? this.cine.dispose() : this.renderer.dispose();
  }
}
