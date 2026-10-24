/**
 * Squat Rocket's 3D view, tuned for a 1 GB Android TV (Mali-G31): 1280×720 internal, no antialiasing, Lambert
 * materials, no shadow maps or post-processing (blob shadows instead), one pooled additive particle system,
 * and ~60 draw calls. The match state (engine.ts) drives everything; this file only draws it.
 */
import * as THREE from "three";
import { MODEL_NAMES, RocketModel, place, radialTexture, starTexture, type Kit } from "./models";
import { Particles, planetTexture, skyTexture } from "./fx";
import { WARN, type Match } from "./engine";

export const RENDER_W = 1280, RENDER_H = 720;
const LANE = 4.4;
/** World units per metre of altitude. */
const K = 0.05;
const SCALE = 1.05;

export interface PlayerLook { id: string; name: string; color: string }

interface RocketView {
  id: string;
  model: RocketModel;
  shadow: THREE.Mesh;
  laneX: number;
  squash: number;
  hop: number;
  spin: number;
  flash: number;
  y: number;
  x: number;
  color: THREE.Color;
}

const FLAME_A = new THREE.Color("#ffb347"), FLAME_B = new THREE.Color("#ff5a1f"), SMOKE = new THREE.Color("#7d6a8a");
const SPARK = new THREE.Color("#ffe066"), BOOM = new THREE.Color("#ff7a3d"), CYAN = new THREE.Color("#58e6ff");
const RED = new THREE.Color("#ff5d73"), STREAK = new THREE.Color("#cfd8ff");

export class SquatScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(45, RENDER_W / RENDER_H, 0.1, 600);
  private rockets: RocketView[] = [];
  private fx = new Particles(520, 0.75);
  private streaks = new Particles(120, 0.25);
  private meteors: THREE.Object3D[] = [];
  private stars: THREE.Sprite[] = [];
  private assigned = new Map<number, THREE.Object3D>();
  private sky = new THREE.Group();
  private ground = new THREE.Group();
  private shield: THREE.Mesh;
  private shieldMat: THREE.MeshBasicMaterial;
  private stormRocks: THREE.Object3D[] = [];
  private shake = 0;
  private time = 0;
  private camY = 3;
  private camZ = 15;
  private shieldPulse = 0;
  private v = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement, kit: Kit, looks: PlayerLook[]) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(RENDER_W, RENDER_H, false);
    this.scene.background = skyTexture("#05031a", "#2a1460", "#7a2f6a");
    this.scene.add(new THREE.HemisphereLight("#c9d6ff", "#6a2e1e", 1.5));
    const sun = new THREE.DirectionalLight("#fff1dc", 1.7);
    sun.position.set(6, 12, 9);
    this.scene.add(sun);
    this.camZ = looks.length === 1 ? 11 : 15;

    // the sky: stars and a ringed planet that drift slowly as we climb (parallax)
    const n = 900, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 260;
      pos[i * 3 + 1] = Math.random() * 160 - 10;
      pos[i * 3 + 2] = -60 - Math.random() * 120;
    }
    const starGeo = new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.sky.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: "#ffffff", size: 1.6, sizeAttenuation: false, fog: false })));
    const planet = new THREE.Mesh(new THREE.SphereGeometry(16, 32, 16), new THREE.MeshLambertMaterial({ map: planetTexture() }));
    planet.position.set(-34, 34, -110);
    planet.rotation.z = 0.35;
    const ring = new THREE.Mesh(new THREE.RingGeometry(21, 29, 48), new THREE.MeshBasicMaterial({ color: "#f3c6ff", transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false }));
    ring.position.copy(planet.position);
    ring.rotation.set(1.25, 0.2, 0.35);
    const moon = new THREE.Mesh(new THREE.SphereGeometry(4, 20, 12), new THREE.MeshLambertMaterial({ color: "#9fd8ff" }));
    moon.position.set(40, 18, -95);
    this.sky.add(planet, ring, moon);
    this.scene.add(this.sky);

    // the launch site
    const floor = new THREE.Mesh(new THREE.CircleGeometry(90, 48), new THREE.MeshLambertMaterial({ color: "#c4653f" }));
    floor.rotation.x = -Math.PI / 2;
    this.ground.add(floor);
    const deco: Array<[(typeof MODEL_NAMES)[number], number, number, number, number]> = [
      ["hangar_roundA", -16, -12, 2.4, 0.5], ["satelliteDish", 13, -8, 4, -0.6], ["machine_generator", -8.5, -2.5, 2.4, 0.8],
      ["astronautA", 8.2, 1.8, 1.4, -0.5], ["craterLarge", -6, 6, 4, 0], ["crater", 9, 7, 3, 0.3], ["rock_largeA", 15, 1, 3.5, 0.4],
      ["rock_largeA", -17, 2, 4, 1.4], ["rocks_smallA", 4, 6.5, 3, 0.2], ["rocks_smallA", -3, -9, 4, 2], ["crater", -18, -14, 5, 1],
      ["rock_largeA", 22, -16, 6, 0.9], ["craterLarge", 18, -24, 8, 0], ["hangar_roundA", 24, -30, 5, 2.2],
    ];
    for (const [name, x, z, s, ry] of deco) {
      const o = place(kit, name);
      o.position.set(x, 0, z);
      o.scale.setScalar(s);
      o.rotation.y = ry;
      this.ground.add(o);
    }
    this.scene.add(this.ground);

    // one pad and rocket per player
    const blob = new THREE.MeshBasicMaterial({ map: radialTexture("rgba(0,0,0,0.55)", "rgba(0,0,0,0)"), transparent: true, depthWrite: false });
    looks.forEach((p, i) => {
      const laneX = (i - (looks.length - 1) / 2) * LANE;
      const pad = place(kit, "platform_large");
      pad.scale.setScalar(1.6);
      pad.position.set(laneX, 0, 0);
      this.ground.add(pad);
      const model = new RocketModel(kit, p.color);
      model.root.scale.setScalar(SCALE);
      model.root.position.set(laneX, 0.16, 0);
      this.scene.add(model.root);
      const shadow = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.4), blob);
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.set(laneX, 0.18, 0);
      this.ground.add(shadow);
      this.rockets.push({ id: p.id, model, shadow, laneX, squash: 0, hop: 0, spin: 0, flash: 0, y: 0.16, x: laneX, color: new THREE.Color(p.color) });
    });

    // pooled meteors and stars for the climb
    const starTex = starTexture();
    for (let i = 0; i < 8; i++) {
      const m = place(kit, i % 2 ? "meteor" : "meteor_detailed");
      m.scale.setScalar(2.2);
      m.visible = false;
      this.meteors.push(m);
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: starTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      s.scale.setScalar(1.6);
      s.visible = false;
      this.stars.push(s);
      this.scene.add(m, s);
    }
    // the storm: a team shield and a ring of tumbling rocks
    this.shieldMat = new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, wireframe: true });
    this.shield = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), this.shieldMat);
    this.shield.visible = false;
    this.scene.add(this.shield);
    for (let i = 0; i < 16; i++) {
      const r = place(kit, i % 3 ? "meteor" : "meteor_detailed");
      r.scale.setScalar(1.5 + (i % 4) * 0.5);
      r.visible = false;
      this.stormRocks.push(r);
      this.scene.add(r);
    }
    this.scene.add(this.fx.points, this.streaks.points);
    this.camera.position.set(0, 3, this.camZ);
  }

  private view(id: string) {
    return this.rockets.find((r) => r.id === id);
  }

  /** A rep: the rocket bounces and a puff of steam leaves the pad. */
  pump(id: string, perfect: boolean) {
    const r = this.view(id);
    if (!r) return;
    r.squash = perfect ? 0.32 : 0.22;
    for (let k = 0; k < (perfect ? 26 : 14); k++) {
      const a = Math.random() * Math.PI * 2;
      this.fx.emit(r.x + Math.cos(a) * 0.8, r.y + 0.3, Math.sin(a) * 0.8, Math.cos(a) * 2.2, 0.6 + Math.random(), Math.sin(a) * 2.2, perfect ? SPARK : SMOKE, 0.7);
    }
  }
  dodge(id: string) {
    const r = this.view(id);
    if (!r) return;
    r.hop = 1;
    r.spin = 1;
  }
  hit(id: string) {
    const r = this.view(id);
    if (!r) return;
    r.flash = 1;
    this.shake = Math.min(0.35, this.shake + 0.3);
    this.fx.burst(r.x, r.y + 3, 0.5, 40, 6, BOOM, 0.7);
  }
  star(id: string) {
    const r = this.view(id);
    if (r) this.fx.burst(r.x, r.y + 3, 0, 30, 4, SPARK, 0.6);
  }
  jack() {
    this.shieldPulse = 1;
  }
  tankFull(id: string) {
    const r = this.view(id);
    if (r) this.fx.burst(r.x, r.y + r.model.height * SCALE, 0, 40, 5, r.color, 0.9);
  }

  update(m: Match, dt: number) {
    this.time += dt;
    const flying = m.phase === "launch" || m.phase === "climb" || m.phase === "storm" || m.phase === "finale";
    const mean = m.rockets.reduce((a, r) => a + r.altitude, 0) / Math.max(1, m.rockets.length);
    for (const view of this.rockets) {
      const r = m.rockets.find((x) => x.id === view.id)!;
      if (m.phase === "warmup" || m.phase === "fuel") view.model.setFuel(r.fuel);
      const targetY = 0.16 + (flying ? mean * K + Math.max(-2.5, Math.min(2.5, (r.altitude - mean) * K * 0.4)) : 0);
      view.y += (targetY - view.y) * Math.min(1, dt * 6);
      const targetX = view.laneX + (flying ? r.x * 1.6 : 0);
      view.x += (targetX - view.x) * Math.min(1, dt * 8);
      view.squash *= Math.exp(-dt * 7);
      view.hop = Math.max(0, view.hop - dt * 1.8);
      view.spin = Math.max(0, view.spin - dt * 1.6);
      view.flash = Math.max(0, view.flash - dt * 2.5);
      const wobble = Math.sin(this.time * 18) * view.squash;
      const root = view.model.root;
      root.position.set(view.x, view.y + Math.sin(view.hop * Math.PI) * 1.4, 0);
      view.model.body.scale.set(1 - wobble * 0.5, 1 + wobble, 1 - wobble * 0.5);
      root.rotation.set(0, (1 - view.spin) * Math.PI * 2 * (view.spin > 0 ? 1 : 0), flying ? -r.x * 0.25 : 0);
      view.model.trim.emissive.setRGB(0.25 * view.color.r + view.flash, 0.25 * view.color.g, 0.25 * view.color.b);
      view.shadow.visible = view.y < 1.5;
      if (flying) {
        const power = Math.min(1, r.speed / 90);
        for (let k = 0; k < 2 + power * 3; k++) {
          this.fx.emit(view.x + (Math.random() - 0.5) * 0.5, view.y - 0.1, (Math.random() - 0.5) * 0.5,
            (Math.random() - 0.5) * 1.2, -5 - power * 6 - Math.random() * 3, (Math.random() - 0.5) * 1.2, Math.random() < 0.5 ? FLAME_A : FLAME_B, 0.35 + Math.random() * 0.25);
        }
      }
    }

    // meteors and stars heading for each rocket
    for (const [id, obj] of this.assigned) {
      if (!m.debris.some((d) => d.id === id && (d.state === "incoming" || d.state === "dodged") && m.time < d.at + 1.2)) {
        obj.visible = false;
        this.assigned.delete(id);
      }
    }
    for (const d of m.debris) {
      if (d.state !== "incoming" && d.state !== "dodged") continue;
      if (m.time > d.at + 1.2) continue;
      const view = this.view(d.target);
      if (!view) continue;
      let obj = this.assigned.get(d.id);
      if (!obj) {
        const pool: THREE.Object3D[] = d.kind === "meteor" ? this.meteors : this.stars;
        obj = pool.find((o) => !o.visible);
        if (!obj) continue;
        obj.visible = true;
        this.assigned.set(d.id, obj);
      }
      const p = 1 - (d.at - m.time) / WARN;
      if (d.kind === "meteor") {
        const side = d.id % 2 ? 1 : -1;
        const fromX = view.laneX + side * 7, fromY = view.y + 12, toX = view.laneX + d.x * 1.6, toY = view.y + 2.2;
        obj.position.set(fromX + (toX - fromX) * p, fromY + (toY - fromY) * p, -3 + 3.5 * p);
        obj.rotation.set(this.time * 2, this.time * 3, 0);
        if (d.state === "incoming" && p > 0.3) this.fx.emit(obj.position.x, obj.position.y, obj.position.z, 0, 0, 0, BOOM, 0.35);
      } else {
        obj.position.set(view.laneX + d.x * 1.6, view.y + 2.5 + (1 - p) * 10, 0.5);
        obj.scale.setScalar(1.4 + Math.sin(this.time * 8) * 0.2);
      }
    }

    // the storm
    const storm = m.phase === "storm" || (m.phase === "finale" && m.t < 1);
    this.shield.visible = storm;
    this.shieldPulse = Math.max(0, this.shieldPulse - dt * 3);
    for (const [i, rock] of this.stormRocks.entries()) {
      rock.visible = storm;
      if (!storm) continue;
      const a = (i / this.stormRocks.length) * Math.PI * 2 + this.time * (0.35 + (i % 3) * 0.1);
      const rad = 9 + (i % 4) * 2 + Math.sin(this.time * 1.3 + i) * 1.5;
      rock.position.set(Math.cos(a) * rad, mean * K + 3 + Math.sin(a * 2 + i) * 4, Math.sin(a) * rad * 0.5 - 2);
      rock.rotation.set(this.time + i, this.time * 1.3, 0);
    }
    if (storm) {
      const span = Math.max(5.5, (this.rockets.length - 1) * LANE * 0.5 + 4);
      this.shield.position.set(0, mean * K + 3, 0);
      this.shield.scale.setScalar(span * (1 + this.shieldPulse * 0.08));
      this.shield.rotation.y += dt * 0.4;
      const low = m.shield < 0.25;
      this.shieldMat.color.copy(CYAN).lerp(RED, low ? 0.7 : 0);
      this.shieldMat.opacity = 0.12 + m.shield * 0.55 + this.shieldPulse * 0.3 - (low ? Math.abs(Math.sin(this.time * 10)) * 0.1 : 0);
      if (Math.random() < 0.08) {
        const a = Math.random() * Math.PI * 2;
        this.fx.burst(Math.cos(a) * span, mean * K + 3 + Math.sin(a) * span * 0.7, 1, 10, 3, m.shield > 0.2 ? CYAN : BOOM, 0.5);
      }
    }
    if (m.phase === "finale" && Math.random() < 0.12) {
      const c = new THREE.Color().setHSL(Math.random(), 0.9, 0.6);
      this.fx.burst((Math.random() - 0.5) * 18, mean * K + 5 + Math.random() * 6, -4, 50, 6, c, 1.1);
    }

    // speed lines while flying
    if (flying) {
      for (let k = 0; k < 2; k++) this.streaks.emit((Math.random() - 0.5) * 30, this.camY + 12, -2 - Math.random() * 8, 0, -40 - mean * 0.002, 0, STREAK, 0.6);
    }
    this.fx.update(dt);
    this.streaks.update(dt);

    // camera: a wide shot of the pads, then follow the climb
    const wantY = flying ? mean * K + 2.6 : this.rockets.length === 1 ? 2.6 : 3.4;
    const wantZ = m.phase === "finale" ? this.camZ + 7 : m.phase === "storm" ? this.camZ + 4 : this.camZ;
    this.camY += (wantY - this.camY) * Math.min(1, dt * 3);
    const z = this.camera.position.z + (wantZ - this.camera.position.z) * Math.min(1, dt * 1.5);
    this.shake = Math.max(0, this.shake - dt * 1.2);
    const sx = (Math.random() - 0.5) * this.shake, sy = (Math.random() - 0.5) * this.shake;
    this.camera.position.set(sx, this.camY + sy, z);
    this.camera.lookAt(0, this.camY - 0.6, 0);
    this.sky.position.y = this.camY * 0.92;
    this.ground.visible = this.camY < 80;
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  /** Where a player's rocket is on the 1920×1080 stage (for the per-player prompts). */
  screenPos(id: string): { x: number; y: number } | null {
    const r = this.view(id);
    if (!r) return null;
    this.v.set(r.x, r.y + r.model.height * SCALE + 0.6, 0).project(this.camera);
    return { x: ((this.v.x + 1) / 2) * 1920, y: ((1 - this.v.y) / 2) * 1080 };
  }

  dispose() {
    this.renderer.dispose();
  }
}
