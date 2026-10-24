/**
 * The bedroom arena for Pillow Fort Brawl: a giant bed (the arena), "pretend lava" floor around it, walls with
 * a moonlit window, and furniture from the KayKit Furniture Bits pack. All static furniture shares one atlas
 * texture, so it is merged into a single mesh (one draw call). Lighting is a hemisphere plus one directional
 * light on Lambert/Toon materials: no shadow maps, no PBR, no post-processing (fill-rate bound TV GPUs).
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { cheapMaterials, cloneModel } from "../kit3d/assets";
import { HX, HZ } from "./rules";

export const RENDER_W = 1280, RENDER_H = 720;
export const FURNITURE_URL = "/assets/kaykit-furniture/bedroom.glb";
/** Furniture is toy-sized next to the adventurers: blow it up so the bed becomes a stadium. */
const S = 4.6;

export interface Room {
  scene: THREE.Scene;
  /** Height of the mattress top (the arena floor). */
  bedTop: number;
  /** Height of the lava floor. */
  floorY: number;
  hemi: THREE.HemisphereLight;
  sun: THREE.DirectionalLight;
  lava: THREE.Mesh;
  nightlight: THREE.Mesh;
  /** A pillow model ready to clone (fighters hold one, avalanches drop them). */
  pillow: THREE.Object3D;
}

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat = 1): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  return t;
}

/** Cartoon "the floor is lava" rug: warm orange with darker swirls (scrolls slowly). */
function lavaTexture() {
  return canvasTexture(256, 256, (g) => {
    g.fillStyle = "#e0521f";
    g.fillRect(0, 0, 256, 256);
    let s = 3;
    const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 26; i++) {
      const x = r() * 256, y = r() * 256, rad = 10 + r() * 34;
      const grad = g.createRadialGradient(x, y, 1, x, y, rad);
      const hot = r() < 0.5;
      grad.addColorStop(0, hot ? "#ff9a3c" : "#a8260c");
      grad.addColorStop(1, hot ? "rgba(255,154,60,0)" : "rgba(168,38,12,0)");
      g.fillStyle = grad;
      for (const dx of [-256, 0, 256]) for (const dy of [-256, 0, 256]) {
        g.beginPath();
        g.arc(x + dx, y + dy, rad, 0, 7);
        g.fill();
      }
    }
  }, 2);
}

function wallpaper() {
  return canvasTexture(256, 256, (g) => {
    g.fillStyle = "#6f6bd8";
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = "#7d79e3";
    for (let x = 0; x < 256; x += 64) g.fillRect(x, 0, 32, 256);
    g.fillStyle = "#ffe98a";
    for (const [x, y] of [[40, 40], [170, 90], [100, 180], [220, 220], [16, 140]] as const) {
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 - Math.PI / 2, rr = i % 2 ? 4 : 10;
        g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      }
      g.fill();
    }
  }, 4);
}

function windowTexture() {
  return canvasTexture(256, 256, (g) => {
    const sky = g.createLinearGradient(0, 0, 0, 256);
    sky.addColorStop(0, "#1c2a6b");
    sky.addColorStop(1, "#5b6fd6");
    g.fillStyle = sky;
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = "#fff6c8";
    g.beginPath(); g.arc(178, 74, 34, 0, 7); g.fill();
    g.fillStyle = "#1c2a6b";
    g.beginPath(); g.arc(196, 62, 30, 0, 7); g.fill();
    g.fillStyle = "#ffffff";
    for (let i = 0; i < 30; i++) g.fillRect((i * 97) % 256, (i * 53) % 200, 3, 3);
    g.fillStyle = "#f4efe6";
    g.fillRect(0, 0, 256, 12); g.fillRect(0, 244, 256, 12); g.fillRect(0, 0, 12, 256); g.fillRect(244, 0, 12, 256);
    g.fillRect(122, 0, 12, 256); g.fillRect(0, 122, 256, 12);
  });
}

/** Static furniture placements: [piece, x, z, rotationY, scale multiplier]. The bed sits at the origin. */
const PROPS: Array<[string, number, number, number, number?]> = [
  ["shelf_B_large_decorated", -9, -16.4, 0],
  ["cabinet_medium_decorated", 10.5, -16.2, 0],
  ["lamp_standing", 18, -14, 0],
  ["lamp_standing", -18.5, -13.5, 0],
  ["armchair_pillows", -17, -3, Math.PI / 2],
  ["table_low", -17.5, 7, Math.PI / 2, 0.9],
  ["lamp_table", -17.5, 6, 0, 0.6],
  ["couch_pillows", 17.5, 0, -Math.PI / 2],
  ["cactus_small_A", 16.5, -11, 0, 1.2],
  ["book_set", -13, 11, 0.4, 1.4],
  ["chair_A", 14, 10, -0.7],
];

const down = new THREE.Vector3(0, -1, 0);
function heightAt(obj: THREE.Object3D, x: number, z: number): number | null {
  const hit = new THREE.Raycaster(new THREE.Vector3(x, 100, z), down).intersectObject(obj, true)[0];
  return hit ? hit.point.y : null;
}

/**
 * Scales the bed so its flat blanket (in front of the head pillows) covers the arena with a small border, and
 * places it so the blanket's front edge is just past the arena's front. Measured by ray casts, so another bed
 * model works too.
 */
function fitBed(bed: THREE.Object3D) {
  bed.position.set(0, 0, 0);
  bed.scale.setScalar(1);
  bed.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(bed);
  const depth = box.max.z - box.min.z;
  const front = heightAt(bed, 0, box.max.z - depth * 0.08) ?? box.max.y / 2;
  let back = box.max.z - depth * 0.08;
  for (let z = back; z > box.min.z; z -= depth / 80) {
    const h = heightAt(bed, (box.max.x - box.min.x) * 0.25, z);
    if (h === null || Math.abs(h - front) > 0.1) break; // the turned-down fold counts as blanket
    back = z;
  }
  const blanket = box.max.z - back;
  const sx = ((HX + 0.45) * 2) / (box.max.x - box.min.x);
  const sz = ((HZ + 0.25) * 2) / blanket;
  const scale = new THREE.Vector3(sx, sx * 0.8, sz);
  // after scaling, the blanket's back edge sits at (back - centre) * sz: put it at -HZ (the wall)
  const cx = (box.min.x + box.max.x) / 2;
  const offset = new THREE.Vector3(-cx * sx, 0, -HZ - back * sz);
  return { scale, offset, top: front * sx * 0.8 };
}

/** Builds the room around a bed whose mattress top becomes the arena (HX × HZ half-size). */
export function buildRoom(furniture: THREE.Object3D): Room {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#241a4a");
  scene.fog = new THREE.Fog("#241a4a", 40, 90);
  const hemi = new THREE.HemisphereLight("#fff1dc", "#5a3f8a", 1.7);
  const sun = new THREE.DirectionalLight("#ffe2b8", 1.7);
  sun.position.set(-8, 20, 12);
  scene.add(hemi, sun);

  const piece = (name: string) => {
    const src = furniture.getObjectByName(name);
    if (!src) throw new Error(`missing furniture piece ${name}`);
    return cloneModel(src);
  };

  // the bed: the blanket becomes the arena, the head pillows and headboard sit behind it (the back wall)
  const bed = piece("bed_double_A");
  const { scale, offset, top } = fitBed(bed);
  bed.scale.copy(scale);
  bed.position.copy(offset);
  bed.updateMatrixWorld(true);
  const bedTop = top;

  // every static piece shares the furniture atlas: merge them into one mesh
  const parts: THREE.BufferGeometry[] = [];
  let material: THREE.Material | null = null;
  const collect = (root: THREE.Object3D) => {
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      material ??= m.material as THREE.Material;
      const g = m.geometry.clone().applyMatrix4(m.matrixWorld);
      for (const k of Object.keys(g.attributes)) if (!["position", "normal", "uv"].includes(k)) g.deleteAttribute(k);
      parts.push(g.index ? g.toNonIndexed() : g);
    });
  };
  collect(bed);
  for (const [name, x, z, ry, sc] of PROPS) {
    const p = piece(name);
    p.scale.setScalar(S * (sc ?? 1));
    p.position.set(x, 0, z);
    p.rotation.y = ry;
    collect(p);
  }
  const merged = new THREE.Mesh(mergeGeometries(parts, false)!, material!);
  merged.matrixAutoUpdate = false;
  cheapMaterials(merged, "lambert");
  scene.add(merged);

  // the lava floor, a wall on two sides, a window with the moon
  const lava = new THREE.Mesh(new THREE.PlaneGeometry(90, 90).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: lavaTexture() }));
  lava.position.y = 0.01;
  const wallMat = new THREE.MeshLambertMaterial({ map: wallpaper() });
  const back = new THREE.Mesh(new THREE.PlaneGeometry(70, 26), wallMat);
  back.position.set(0, 13, -18);
  const left = new THREE.Mesh(new THREE.PlaneGeometry(60, 26), wallMat);
  left.position.set(-22, 13, 8);
  left.rotation.y = Math.PI / 2;
  const right = left.clone();
  right.position.x = 22;
  right.rotation.y = -Math.PI / 2;
  const win = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), new THREE.MeshBasicMaterial({ map: windowTexture() }));
  win.position.set(0, 13, -17.9);
  // a nightlight plug on the wall that glows during the "lights out" chaos
  const nightlight = new THREE.Mesh(new THREE.CircleGeometry(0.9, 20), new THREE.MeshBasicMaterial({ color: "#7fe3ff" }));
  nightlight.position.set(-14, 3, -17.85);
  scene.add(lava, back, left, right, win, nightlight);

  const pillow = piece("pillow_A");
  cheapMaterials(pillow, "toon");
  return { scene, bedTop, floorY: 0, hemi, sun, lava, nightlight, pillow };
}

const BG_DAY = new THREE.Color("#241a4a"), BG_NIGHT = new THREE.Color("#0c0820");

/** Dims the room towards a blue nightlight (0 = normal, 1 = lights out) and scrolls the lava. */
export function animateRoom(room: Room, dark: number, time: number) {
  room.hemi.intensity = 1.7 - 1.25 * dark;
  room.sun.intensity = 1.7 - 1.5 * dark;
  room.hemi.color.setRGB(1 - 0.5 * dark, 0.95 - 0.3 * dark, 0.86 + 0.14 * dark);
  const map = (room.lava.material as THREE.MeshBasicMaterial).map!;
  map.offset.set(Math.sin(time * 0.1) * 0.2, time * 0.02);
  (room.lava.material as THREE.MeshBasicMaterial).color.setScalar(1 - 0.45 * dark);
  (room.nightlight.material as THREE.MeshBasicMaterial).color.set(dark > 0.1 ? "#bff4ff" : "#4c7f99");
  (room.scene.background as THREE.Color).copy(BG_DAY).lerp(BG_NIGHT, dark);
}
