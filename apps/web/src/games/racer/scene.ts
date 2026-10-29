import * as THREE from "three";
import { GATE_R, type Race } from "./engine";

export const RENDER_W = 1280, RENDER_H = 720;

/** Screen rectangles (0..1, origin top-left) for 1–4 players: full, side by side, or quarters. */
export function viewports(n: number): Array<{ x: number; y: number; w: number; h: number }> {
  if (n <= 1) return [{ x: 0, y: 0, w: 1, h: 1 }];
  if (n === 2) return [{ x: 0, y: 0, w: 0.5, h: 1 }, { x: 0.5, y: 0, w: 0.5, h: 1 }];
  return [{ x: 0, y: 0, w: 0.5, h: 0.5 }, { x: 0.5, y: 0, w: 0.5, h: 0.5 }, { x: 0, y: 0.5, w: 0.5, h: 0.5 }, { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }].slice(0, n);
}

function shipMesh(color: string): THREE.Group {
  const g = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color, metalness: 0.45, roughness: 0.35 });
  const body = new THREE.Mesh(new THREE.ConeGeometry(0.42, 2.8, 8), paint);
  body.rotation.x = -Math.PI / 2;                       // nose points down the course (-z)
  // swept wings: a flat triangle either side
  const wingShape = new THREE.Shape([new THREE.Vector2(0, -0.6), new THREE.Vector2(1.7, 0.7), new THREE.Vector2(0, 0.9)]);
  const wingGeo = new THREE.ExtrudeGeometry(wingShape, { depth: 0.08, bevelEnabled: false });
  for (const side of [1, -1]) {
    const w = new THREE.Mesh(wingGeo, paint);
    w.rotation.x = Math.PI / 2;
    w.scale.x = side;
    w.position.set(0, 0, 0.2);
    g.add(w);
  }
  const cockpit = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 10), new THREE.MeshStandardMaterial({ color: "#bfefff", metalness: 0.2, roughness: 0.1 }));
  cockpit.scale.set(1, 0.7, 1.6);
  cockpit.position.set(0, 0.28, -0.3);
  const glow = new THREE.Group();
  glow.name = "glow";
  for (const x of [-0.28, 0.28]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), new THREE.MeshBasicMaterial({ color: "#7fe7ff" }));
    e.position.set(x, 0, 1.35);
    glow.add(e);
  }
  g.add(body, cockpit, glow);
  return g;
}

/** Space course with gates, rocks and every ship, rendered once per player viewport (chase camera). */
export class RacerScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private cams: THREE.PerspectiveCamera[] = [];
  private ships = new Map<string, THREE.Group>();
  private gates: THREE.Mesh[] = [];
  private rocks: THREE.Mesh[] = [];
  private time = 0;

  /** `views`: how many of the ships (the players, listed first) get a split-screen view; rivals only fly. */
  constructor(canvas: HTMLCanvasElement, race: Race, colors: Map<string, string>, private views = race.ships.length) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(RENDER_W, RENDER_H, false);
    this.renderer.setScissorTest(true);
    this.scene.background = new THREE.Color("#05031a");
    this.scene.fog = new THREE.Fog("#05031a", 60, 220);
    this.scene.add(new THREE.HemisphereLight("#b9b2ff", "#200a30", 1.6));
    const sun = new THREE.DirectionalLight("#ffffff", 1.8);
    sun.position.set(5, 10, 6);
    this.scene.add(sun);

    // stars spread along the whole course
    const n = 1600;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 260;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 160;
      pos[i * 3 + 2] = 40 - Math.random() * (race.track.length + 260);
    }
    const stars = new THREE.Points(new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(pos, 3)), new THREE.PointsMaterial({ color: "#ffffff", size: 0.6, fog: false }));
    this.scene.add(stars);

    const gateGeo = new THREE.TorusGeometry(GATE_R, 0.22, 10, 40);
    race.track.gates.forEach((g, i) => {
      const last = i === race.track.gates.length - 1;
      const m = new THREE.Mesh(gateGeo, new THREE.MeshBasicMaterial({ color: last ? "#ffd23f" : "#00e5ff" }));
      m.position.set(g.x, g.y, g.z);
      this.gates.push(m);
      this.scene.add(m);
    });
    const rockGeo = new THREE.IcosahedronGeometry(1, 0);
    const rockMat = new THREE.MeshStandardMaterial({ color: "#8a6f5a", roughness: 0.9, flatShading: true });
    for (const r of race.track.rocks) {
      const m = new THREE.Mesh(rockGeo, rockMat);
      m.position.set(r.x, r.y, r.z);
      m.scale.setScalar(r.r);
      this.rocks.push(m);
      this.scene.add(m);
    }
    for (const s of race.ships) {
      const g = shipMesh(colors.get(s.id) ?? "#ffffff");
      this.ships.set(s.id, g);
      this.scene.add(g);
    }
    for (const vp of viewports(views)) {
      this.cams.push(new THREE.PerspectiveCamera(65, (vp.w * RENDER_W) / (vp.h * RENDER_H), 0.1, 400));
    }
  }

  render(race: Race, tilt: Map<string, { steer: number; climb: number }>, dt: number) {
    this.time += dt;
    for (const s of race.ships) {
      const g = this.ships.get(s.id)!;
      const t = tilt.get(s.id) ?? { steer: 0, climb: 0 };
      g.position.set(s.x, s.y, -s.dist);
      g.rotation.z += (-t.steer * 0.6 - g.rotation.z) * Math.min(1, dt * 6);
      g.rotation.x += (-t.climb * 0.35 - g.rotation.x) * Math.min(1, dt * 6);
      const glow = g.getObjectByName("glow")!;
      glow.scale.setScalar(s.boostT > 0 ? 1.8 : 1);
      g.visible = s.bumpT <= 0 || Math.floor(this.time * 12) % 2 === 0;
    }
    for (const r of this.rocks) r.rotation.y += dt * 0.6;
    viewports(this.views).forEach((vp, i) => {
      const s = race.ships[i]!;
      const cam = this.cams[i]!;
      const back = s.boostT > 0 ? 11.5 : 10;
      cam.position.set(s.x, s.y + 3.2, -s.dist + back);
      cam.lookAt(s.x, s.y + 0.8, -s.dist - 16);
      const x = vp.x * RENDER_W, y = (1 - vp.y - vp.h) * RENDER_H, w = vp.w * RENDER_W, h = vp.h * RENDER_H;
      this.renderer.setViewport(x, y, w, h);
      this.renderer.setScissor(x, y, w, h);
      this.renderer.render(this.scene, cam);
    });
  }

  dispose() {
    this.renderer.dispose();
  }
}
