import * as THREE from "three";
import { BALL_R, MAX_TILT, moverPos, type Level, type MazeState } from "./physics";

/** Internal render size; the canvas is stretched to the 1920×1080 stage. Keeps low-end TV GPUs at 60 fps. */
export const RENDER_W = 1280, RENDER_H = 720;

/**
 * Low-memory TVs (e.g. 1–2 GB Android TVs with Mali-G31 GPUs) drop to ~40 fps on the bigger mazes with full
 * shadows and anti-aliasing. Lite mode: no MSAA, only the ball casts a shadow, smaller shadow map.
 */
const LITE = typeof navigator !== "undefined" && ((navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 8) <= 2;

/** The 3D board: floor texture (tiles, holes, checkpoints), walls, moving walls, coins, goal and ball. */
export class MazeScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(42, RENDER_W / RENDER_H, 0.1, 200);
  private board = new THREE.Group();
  private ball: THREE.Mesh;
  private coins = new Map<string, THREE.Mesh>();
  private movers: THREE.Mesh[] = [];
  private goal: THREE.Mesh;
  private level: Level | null = null;
  private time = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !LITE, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(RENDER_W, RENDER_H, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene.background = new THREE.Color("#0b0820");
    this.scene.add(new THREE.HemisphereLight("#c9c3ff", "#1a1030", 1.4));
    const sun = new THREE.DirectionalLight("#ffffff", 2.2);
    sun.position.set(-6, 14, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(LITE ? 512 : 1024, LITE ? 512 : 1024);
    Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12 });
    this.scene.add(sun, this.board);
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 32, 16), new THREE.MeshStandardMaterial({ color: "#ffffff", metalness: 0.4, roughness: 0.25 }));
    this.ball.castShadow = true;
    this.goal = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.08, 12, 32), new THREE.MeshStandardMaterial({ color: "#7cf29c", emissive: "#3ee08f", emissiveIntensity: 1.2 }));
  }

  setLevel(level: Level, ballColor: string) {
    this.level = level;
    this.board.clear();
    this.coins.clear();
    this.movers = [];
    const { w, h } = level;
    const at = (x: number, y: number) => new THREE.Vector3(x - w / 2, 0, y - h / 2);

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, h), surface({ map: floorTexture(level), roughness: 0.9 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.board.add(floor);

    const wallCells: Array<[number, number]> = [];
    level.cells.forEach((row, y) => row.forEach((c, x) => c === "#" && wallCells.push([x, y])));
    const walls = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.5, 1), surface({ color: "#5b4bd6", roughness: 0.5 }), wallCells.length);
    const m = new THREE.Matrix4();
    wallCells.forEach(([x, y], i) => walls.setMatrixAt(i, m.makeTranslation(at(x + 0.5, y + 0.5).setY(0.25))));
    walls.castShadow = !LITE;
    walls.receiveShadow = true;
    this.board.add(walls);

    const moverMat = surface({ color: "#ff6fb5", emissive: "#5a1440", roughness: 0.4 });
    for (let i = 0; i < level.movers.length; i++) {
      const mv = new THREE.Mesh(new THREE.BoxGeometry(1, 0.5, 1), moverMat);
      mv.castShadow = !LITE;
      this.movers.push(mv);
      this.board.add(mv);
    }

    const coinGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.06, 24);
    const coinMat = surface({ color: "#ffd23f", metalness: 0.8, roughness: 0.25, emissive: "#5a4500" });
    level.cells.forEach((row, y) => row.forEach((c, x) => {
      if (c !== "*") return;
      const coin = new THREE.Mesh(coinGeo, coinMat);
      coin.position.copy(at(x + 0.5, y + 0.5).setY(0.35));
      coin.rotation.x = Math.PI / 2;
      coin.castShadow = !LITE;
      this.coins.set(`${x},${y}`, coin);
      this.board.add(coin);
    }));

    this.goal.position.copy(at(level.goal.x, level.goal.y).setY(0.12));
    this.goal.rotation.x = Math.PI / 2;
    this.board.add(this.goal);
    (this.ball.material as THREE.MeshStandardMaterial).color.set(ballColor);
    this.board.add(this.ball);

    // frame the whole board on a 16:9 screen, seen from the player's side at an angle
    const span = Math.max(w * 0.58, h);
    this.camera.position.set(0, span * 1.6, span * 0.7);
    this.camera.lookAt(0, 0, 0.3);
  }

  render(s: MazeState, tiltX: number, tiltY: number, dt: number) {
    if (!this.level) return;
    this.time += dt;
    const { w, h } = this.level;
    this.board.rotation.z = -tiltX * MAX_TILT;
    this.board.rotation.x = tiltY * MAX_TILT;
    const b = s.ball;
    const prev = this.ball.position.clone();
    this.ball.position.set(b.x - w / 2, BALL_R, b.y - h / 2);
    const d = this.ball.position.clone().sub(prev);
    const dist = Math.hypot(d.x, d.z);
    if (dist > 1e-4 && dist < 1) {
      const axis = new THREE.Vector3(d.z, 0, -d.x).normalize();
      this.ball.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, dist / BALL_R));
    }
    for (const [k, c] of this.coins) {
      c.visible = !s.coins.has(k);
      c.rotation.z = this.time * 3;
    }
    this.level.movers.forEach((mv, i) => {
      const p = moverPos(mv, s.t);
      this.movers[i]!.position.set(p.x - w / 2, 0.25, p.y - h / 2);
    });
    this.goal.rotation.z = this.time * 1.5;
    this.goal.scale.setScalar(1 + Math.sin(this.time * 4) * 0.08);
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.renderer.dispose();
  }
}

/** Physically based shading normally; the much cheaper Lambert model on lite TVs (most of the screen is floor and walls). */
function surface(p: { color?: string; map?: THREE.Texture; roughness?: number; metalness?: number; emissive?: string }): THREE.Material {
  if (!LITE) return new THREE.MeshStandardMaterial(p);
  const { roughness: _r, metalness: _m, ...lambert } = p;
  return new THREE.MeshLambertMaterial(lambert);
}

/** Floor tiles drawn once per level: checkerboard, holes, checkpoints and the start pad. */
function floorTexture(l: Level): THREE.CanvasTexture {
  const px = 48;
  const c = document.createElement("canvas");
  c.width = l.w * px;
  c.height = l.h * px;
  const g = c.getContext("2d")!;
  l.cells.forEach((row, y) => row.forEach((cell, x) => {
    g.fillStyle = (x + y) % 2 ? "#2a2160" : "#30276d";
    g.fillRect(x * px, y * px, px, px);
    const cx = x * px + px / 2, cy = y * px + px / 2;
    if (cell === "O") {
      const grad = g.createRadialGradient(cx, cy, 2, cx, cy, px * 0.42);
      grad.addColorStop(0, "#000");
      grad.addColorStop(0.8, "#05030d");
      grad.addColorStop(1, "#3b2f8f");
      g.fillStyle = grad;
      g.beginPath(); g.arc(cx, cy, px * 0.42, 0, Math.PI * 2); g.fill();
    }
    if (cell === "C") {
      g.fillStyle = "rgba(0,229,255,0.35)";
      g.fillRect(x * px + 4, y * px + 4, px - 8, px - 8);
    }
    if (cell === "S") {
      g.strokeStyle = "rgba(255,255,255,0.5)";
      g.lineWidth = 3;
      g.beginPath(); g.arc(cx, cy, px * 0.32, 0, Math.PI * 2); g.stroke();
    }
    if (cell === "G") {
      g.fillStyle = "rgba(62,224,143,0.45)";
      g.beginPath(); g.arc(cx, cy, px * 0.44, 0, Math.PI * 2); g.fill();
    }
  }));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
