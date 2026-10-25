/**
 * Beat Blade's TV picture (three.js): a neon track of four lanes running into a dark city, blocks flying in,
 * one saber per player, sparks on every cut and a skyline whose windows light up as you progress.
 *
 * Built to stay cheap on a weak Android TV: unlit materials only (MeshBasic, no lights or shadows), a handful
 * of draw calls (instanced blocks, bombs, walls and buildings; one Points cloud for every spark), no textures
 * bigger than 128 px, and bloom only on tiers that have post-processing.
 */
import * as THREE from "three";
import type { QualityProfile } from "../../quality/tier";
import { createCinematic, type Cinematic } from "../kit3d/cinematic";
import type { Dir, Note } from "./beatmap";
import { LANES } from "./engine";

export const DEPTH = 17; // how far away blocks appear (world units)
const LANE_W = 0.72;
const ROW_H = 0.55;
const MAX_BLOCKS = 96;
const MAX_BOMBS = 32;
const MAX_WALLS = 8;
const ROT: Record<Dir, number> = { u: 0, d: Math.PI, l: Math.PI / 2, r: -Math.PI / 2, o: 0 };

export const laneX = (lane: number) => (lane - (LANES - 1) / 2) * LANE_W;
export const rowY = (row: number) => 0.5 + row * ROW_H;

/** One block face: a dark tile, glowing rim, and a white arrow (or dot for "any way"). */
function faceTexture(dot: boolean): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = "#1a1a24";
  g.fillRect(10, 10, 108, 108);
  g.fillStyle = "#ffffff";
  if (dot) {
    g.beginPath();
    g.arc(64, 64, 18, 0, Math.PI * 2);
    g.fill();
  } else {
    g.beginPath();
    g.moveTo(18, 58);
    g.lineTo(110, 58);
    g.lineTo(64, 18);
    g.closePath();
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Building windows: white panes on black, tinted per building (dark = unlit, the district's colour = lit). */
function windowTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  g.fillStyle = "#2a2840";
  g.fillRect(0, 0, 64, 64);
  const r = mulberry(3);
  for (let y = 4; y < 64; y += 10) for (let x = 4; x < 64; x += 10) {
    g.fillStyle = r() < 0.7 ? "#ffffff" : "#3a3850";
    g.fillRect(x, y, 5, 6);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(2, 6);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.3, "rgba(255,255,255,0.55)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

interface Saber { group: THREE.Group; blade: THREE.Mesh; glow: THREE.Sprite; swing: number; from: number; to: number; x: number; y: number }
interface Spark { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; r: number; g: number; b: number }

export class BeatView {
  readonly renderer: THREE.WebGLRenderer;
  private cine: Cinematic | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.1, 120);
  private arrows: THREE.InstancedMesh;
  private dots: THREE.InstancedMesh;
  private bombs: THREE.InstancedMesh;
  private walls: THREE.InstancedMesh;
  private city: THREE.InstancedMesh;
  private cityLit = -1;
  private laneMat: THREE.LineBasicMaterial;
  private edgeMat: THREE.MeshBasicMaterial;
  private sabers: Saber[] = [];
  private sparks: Spark[] = [];
  private points: THREE.Points;
  private sparkPos: Float32Array;
  private sparkCol: Float32Array;
  private maxSparks: number;
  private disposables: Array<{ dispose(): void }> = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private s = new THREE.Vector3();
  private p = new THREE.Vector3();
  private c = new THREE.Color();
  private tint = new THREE.Color();
  private pulse = 0;
  private skin: string | null = null;

  constructor(canvas: HTMLCanvasElement, profile: QualityProfile, private colors: string[]) {
    const lite = profile.tier === "lite" || profile.post.level === 0;
    const res = lite ? { w: 1280, h: 720 } : profile.resolution.w > 1920 ? { w: 1920, h: 1080 } : profile.resolution;
    if (lite) {
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance", stencil: false });
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(res.w, res.h, false);
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    } else {
      this.cine = createCinematic(canvas, { ...profile, resolution: res, post: { ...profile.post, ao: false } }, { scene: this.scene, camera: this.camera, adaptive: true });
      this.renderer = this.cine.renderer;
      this.cine.setBloom(0.9);
    }
    this.camera.position.set(0, 1.45, 2.9);
    this.camera.lookAt(0, 0.95, -9);
    this.scene.background = new THREE.Color("#05040c");
    this.scene.fog = new THREE.Fog("#05040c", 10, DEPTH + 18);

    // the track: a dark floor, lane lines and glowing edges
    const floorGeo = this.own(new THREE.PlaneGeometry(LANES * LANE_W + 0.4, DEPTH + 6));
    const floor = new THREE.Mesh(floorGeo, this.own(new THREE.MeshBasicMaterial({ color: "#0b0a18" })));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, -DEPTH / 2 + 2);
    this.scene.add(floor);
    const pts: number[] = [];
    for (let i = 0; i <= LANES; i++) {
      const x = (i - LANES / 2) * LANE_W;
      pts.push(x, 0.005, 3, x, 0.005, -DEPTH - 2);
    }
    const lineGeo = this.own(new THREE.BufferGeometry());
    lineGeo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    this.laneMat = this.own(new THREE.LineBasicMaterial({ color: "#29d3ff", transparent: true, opacity: 0.6 }));
    this.scene.add(new THREE.LineSegments(lineGeo, this.laneMat));
    const edgeGeo = this.own(new THREE.BoxGeometry(0.05, 0.05, DEPTH + 6));
    this.edgeMat = this.own(new THREE.MeshBasicMaterial({ color: "#29d3ff" }));
    for (const side of [-1, 1]) {
      const edge = new THREE.Mesh(edgeGeo, this.edgeMat);
      edge.position.set(side * (LANES * LANE_W / 2 + 0.2), 0.03, -DEPTH / 2 + 2);
      this.scene.add(edge);
    }
    // the hit line: where blocks meet the blade
    const hitGeo = this.own(new THREE.BoxGeometry(LANES * LANE_W + 0.4, 0.02, 0.02));
    const hit = new THREE.Mesh(hitGeo, this.edgeMat);
    hit.position.set(0, 0.02, 0);
    this.scene.add(hit);

    // the city: buildings left and right of the track, their windows light up with your progress
    const bGeo = this.own(new THREE.BoxGeometry(1, 1, 1));
    const bMat = this.own(new THREE.MeshBasicMaterial({ color: "#ffffff", map: this.own(windowTexture()) }));
    this.city = new THREE.InstancedMesh(bGeo, bMat, 60);
    const r = mulberry(42);
    for (let i = 0; i < 60; i++) {
      const side = i % 2 ? 1 : -1;
      const w = 1.5 + r() * 2.5, h = 3 + r() * 13;
      this.p.set(side * (8 + r() * 14), h / 2 - 0.5, -8 - r() * (DEPTH + 18));
      this.s.set(w, h, w);
      this.city.setMatrixAt(i, this.m.compose(this.p, this.q.identity(), this.s));
      this.city.setColorAt(i, this.c.set("#26243a"));
    }
    this.scene.add(this.city);

    // blocks (two instanced meshes: arrows and dots), bombs, walls
    const boxGeo = this.own(new THREE.BoxGeometry(0.5, 0.5, 0.5));
    const arrowTex = this.own(faceTexture(false)), dotTex = this.own(faceTexture(true));
    this.arrows = new THREE.InstancedMesh(boxGeo, this.own(new THREE.MeshBasicMaterial({ map: arrowTex })), MAX_BLOCKS);
    this.dots = new THREE.InstancedMesh(boxGeo, this.own(new THREE.MeshBasicMaterial({ map: dotTex })), MAX_BLOCKS);
    const bombGeo = this.own(new THREE.IcosahedronGeometry(0.2, 0));
    this.bombs = new THREE.InstancedMesh(bombGeo, this.own(new THREE.MeshBasicMaterial({ color: "#3a0b14", wireframe: false })), MAX_BOMBS);
    const bombWire = new THREE.InstancedMesh(bombGeo, this.own(new THREE.MeshBasicMaterial({ color: "#ff3355", wireframe: true })), MAX_BOMBS);
    this.bombs.add(bombWire);
    this.bombs.userData.wire = bombWire;
    const wallGeo = this.own(new THREE.BoxGeometry(1, 1, 1));
    this.walls = new THREE.InstancedMesh(wallGeo, this.own(new THREE.MeshBasicMaterial({ color: "#ff4fd8", transparent: true, opacity: 0.32, depthWrite: false })), MAX_WALLS);
    for (const mesh of [this.arrows, this.dots, this.bombs, bombWire, this.walls]) {
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.scene.add(mesh);
    }
    this.arrows.setColorAt(0, this.c.set("#ffffff"));
    this.dots.setColorAt(0, this.c.set("#ffffff"));

    // sabers
    const glowTex = this.own(glowTexture());
    const bladeGeo = this.own(new THREE.BoxGeometry(0.045, 0.95, 0.045));
    const hiltGeo = this.own(new THREE.BoxGeometry(0.08, 0.22, 0.08));
    const hiltMat = this.own(new THREE.MeshBasicMaterial({ color: "#3a3a48" }));
    colors.forEach((col) => {
      const group = new THREE.Group();
      const blade = new THREE.Mesh(bladeGeo, this.own(new THREE.MeshBasicMaterial({ color: col })));
      blade.position.y = 0.58;
      const hilt = new THREE.Mesh(hiltGeo, hiltMat);
      const glow = new THREE.Sprite(this.own(new THREE.SpriteMaterial({ map: glowTex, color: col, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.7 })));
      glow.scale.set(0.5, 1.5, 1);
      glow.position.y = 0.58;
      group.add(blade, hilt, glow);
      group.position.set(0, 0.4, 0.6);
      this.scene.add(group);
      this.sabers.push({ group, blade, glow, swing: 1, from: 0, to: 0, x: 0, y: 0 });
    });

    // sparks: one Points cloud for every burst
    this.maxSparks = Math.max(96, Math.min(480, profile.particleBudget));
    this.sparkPos = new Float32Array(this.maxSparks * 3);
    this.sparkCol = new Float32Array(this.maxSparks * 3);
    const sg = this.own(new THREE.BufferGeometry());
    sg.setAttribute("position", new THREE.BufferAttribute(this.sparkPos, 3).setUsage(THREE.DynamicDrawUsage));
    sg.setAttribute("color", new THREE.BufferAttribute(this.sparkCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(sg, this.own(new THREE.PointsMaterial({ size: 0.09, map: glowTex, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })));
    this.points.frustumCulled = false;
    this.scene.add(this.points);
  }

  private own<T extends { dispose(): void }>(x: T): T {
    this.disposables.push(x);
    return x;
  }

  /** District look: neon colour, sky colour, and how lit the city is (0..1). */
  setTheme(glow: string, sky: string, lit: number) {
    this.laneMat.color.set(glow);
    this.edgeMat.color.set(glow);
    (this.scene.background as THREE.Color).set(sky);
    (this.scene.fog as THREE.Fog).color.set(sky);
    const n = Math.round(4 + lit * 56);
    if (n === this.cityLit) return;
    this.cityLit = n;
    const r = mulberry(7);
    for (let i = 0; i < 60; i++) this.city.setColorAt(i, this.c.set(i < n ? (r() < 0.5 ? glow : "#ffd27a") : "#26243a").multiplyScalar(i < n ? 0.8 : 1));
    this.city.instanceColor!.needsUpdate = true;
  }

  /** A reward saber colour for everyone (null = each player's own colour). */
  setSkin(color: string | null) {
    if (color === this.skin) return;
    this.skin = color;
    this.sabers.forEach((s, i) => {
      const c = color ?? this.colors[i]!;
      (s.blade.material as THREE.MeshBasicMaterial).color.set(c);
      (s.glow.material as THREE.SpriteMaterial).color.set(c);
    });
  }

  /** Blade positions from the players' aims (-1..1 each way). */
  aim(p: number, x: number, y: number) {
    const s = this.sabers[p];
    if (!s) return;
    s.x += (x - s.x) * 0.45;
    s.y += (y - s.y) * 0.45;
  }

  /** A cut: the blade sweeps through the cut's direction. */
  swing(p: number, dir: Exclude<Dir, "o">) {
    const s = this.sabers[p];
    if (!s) return;
    const a = { u: [0.9, -0.9], d: [-0.9, 0.9], l: [-1.2, 1.2], r: [1.2, -1.2] }[dir];
    s.from = a[0]!;
    s.to = a[1]!;
    s.swing = 0;
  }

  /** Sparks where a block was cut (or a bomb went off). */
  burst(note: Note, color: string, big = false) {
    const n = big ? 34 : 18;
    this.c.set(color);
    const r = mulberry((note.t * 7 + note.lane * 13) | 0);
    for (let i = 0; i < n; i++) {
      if (this.sparks.length >= this.maxSparks) this.sparks.shift();
      const a = r() * Math.PI * 2, sp = 1.5 + r() * (big ? 4.5 : 3);
      this.sparks.push({ x: laneX(note.lane), y: rowY(note.row), z: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp + 1, vz: (r() - 0.3) * 2, life: 0.35 + r() * 0.35, r: this.c.r, g: this.c.g, b: this.c.b });
    }
  }

  beat() {
    this.pulse = 1;
  }

  /**
   * Draws song time `now`. `notes[from..]` are scanned until the first one out of view; `cut(i)` says whether a
   * note is gone (cut by everyone), `partly(i)` whether someone cut it already (it shrinks).
   */
  frame(now: number, dt: number, notes: Note[], from: number, ahead: number, cut: (i: number) => boolean, partly: (i: number) => boolean, tint: string) {
    let na = 0, nd = 0, nb = 0, nw = 0;
    const tintC = this.tint.set(tint);
    const wire = this.bombs.userData.wire as THREE.InstancedMesh;
    for (let i = from; i < notes.length; i++) {
      const n = notes[i]!;
      if (n.t - ahead > now) break;
      const end = n.t + (n.len ?? 0);
      if (end + 450 < now || cut(i)) continue;
      const z = -((n.t - now) / ahead) * DEPTH;
      if (n.kind === "wall") {
        if (nw >= MAX_WALLS) continue;
        const len = ((n.len ?? 0) / ahead) * DEPTH;
        const w = (n.width ?? 1) * LANE_W;
        this.p.set(laneX(n.lane) + (w - LANE_W) / 2, 0.75, z - len / 2);
        this.s.set(w - 0.06, 1.5, Math.max(0.05, len));
        this.walls.setMatrixAt(nw++, this.m.compose(this.p, this.q.identity(), this.s));
        continue;
      }
      // blocks drift in from a little higher and spin into place: easier to read from the sofa
      const far = Math.max(0, Math.min(1, (n.t - now) / ahead));
      this.p.set(laneX(n.lane), rowY(n.row) + far * far * 0.6, z);
      if (n.kind === "bomb") {
        if (nb >= MAX_BOMBS) continue;
        this.e.set(now * 0.002, now * 0.003, 0);
        this.s.setScalar(1);
        this.m.compose(this.p, this.q.setFromEuler(this.e), this.s);
        this.bombs.setMatrixAt(nb, this.m);
        wire.setMatrixAt(nb++, this.m);
        continue;
      }
      const mesh = n.dir === "o" ? this.dots : this.arrows;
      const k = n.dir === "o" ? nd++ : na++;
      if (k >= MAX_BLOCKS) continue;
      this.e.set(0, 0, ROT[n.dir] + far * far * 1.4);
      this.s.setScalar(partly(i) ? 0.7 : 1);
      mesh.setMatrixAt(k, this.m.compose(this.p, this.q.setFromEuler(this.e), this.s));
      mesh.setColorAt(k, this.c.copy(tintC).multiplyScalar(n.t < now ? 0.5 : 1));
    }
    this.arrows.count = na;
    this.dots.count = nd;
    this.bombs.count = nb;
    wire.count = nb;
    this.walls.count = nw;
    for (const m of [this.arrows, this.dots, this.bombs, wire, this.walls]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }

    // sabers: follow the aim, sweep on a cut
    const nS = this.sabers.length;
    this.sabers.forEach((s, i) => {
      const lane = nS > 1 ? (i - (nS - 1) / 2) * 0.12 : 0;
      s.group.position.set(s.x * 1.3 + lane, 0.35 + s.y * 0.45, 0.75);
      s.swing = Math.min(1, s.swing + dt / 0.14);
      const k = 1 - (1 - s.swing) ** 3;
      s.group.rotation.z = s.swing < 1 ? s.from + (s.to - s.from) * k : s.to * 0.15 - s.x * 0.35;
      (s.glow.material as THREE.SpriteMaterial).opacity = 0.55 + (1 - s.swing) * 0.45;
    });

    // sparks
    let live = 0;
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const p = this.sparks[i]!;
      p.life -= dt;
      if (p.life <= 0) { this.sparks.splice(i, 1); continue; }
      p.vy -= 6 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    }
    for (const p of this.sparks) {
      this.sparkPos.set([p.x, p.y, p.z], live * 3);
      const f = Math.min(1, p.life * 3);
      this.sparkCol.set([p.r * f, p.g * f, p.b * f], live * 3);
      live++;
    }
    const geo = this.points.geometry;
    geo.setDrawRange(0, live);
    geo.attributes.position!.needsUpdate = true;
    geo.attributes.color!.needsUpdate = true;

    // the track glows on the beat
    this.pulse = Math.max(0, this.pulse - dt * 4);
    this.laneMat.opacity = 0.5 + this.pulse * 0.5;

    if (this.cine) this.cine.render(this.scene, this.camera);
    else this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    for (const d of this.disposables) d.dispose();
    for (const m of [this.arrows, this.dots, this.bombs, this.bombs.userData.wire as THREE.InstancedMesh, this.walls, this.city]) m.dispose();
    if (this.cine) this.cine.dispose();
    else {
      this.renderer.dispose();
      this.renderer.forceContextLoss();
    }
  }
}

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
