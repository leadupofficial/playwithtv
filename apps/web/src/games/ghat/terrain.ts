/**
 * The mountainside around the road: a heightfield carved by the road (cliffs rise on one side, drops fall to the
 * river valley on the other, tea estates roll gently), coloured per vertex (laterite verges, rock faces, grass,
 * tea), dressed with trees, rocks and tea hedgerows, and cut into chunks: each chunk is ONE merged mesh (terrain
 * and props share a vertex-colour material), so a view draws only the chunks in front of it.
 *
 * On the lite tier the lighting is baked into the vertex colours (MeshBasicMaterial: no lighting cost at all);
 * high/ultra keep albedo colours and light them in real time.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Side, Track } from "./track";
import { makeRng } from "./race";
import { hedgeRow, type PropKit, type PropName } from "./props";

export const WATER_Y = -57;
const SUN = new THREE.Vector3(-0.45, 0.75, 0.35).normalize();

/** Fractal value noise in 2D, roughly [-1, 1]. */
function noise2(seed: number) {
  const hash = (x: number, z: number) => {
    let h = (x * 374761393 + z * 668265263 + seed * 2147483647) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const vn = (x: number, z: number) => {
    const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
    const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
    const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  };
  return (x: number, z: number) => {
    let s = 0, a = 1, f = 1 / 60, tot = 0;
    for (let o = 0; o < 4; o++) {
      s += a * vn(x * f, z * f);
      tot += a;
      a *= 0.5;
      f *= 2.1;
    }
    return (s / tot) * 2 - 1;
  };
}

interface Near { i: number; r: number; side: number }

/** Nearest road sample to (x, z), optionally avoiding samples within `avoid` metres (along the road) of `notNear`. */
function nearest(t: Track, x: number, z: number, notNear = -1, avoid = 0): Near {
  let best = -1, bd = Infinity;
  const along = (i: number) => {
    const d = Math.abs(i - notNear) * 2;
    return Math.min(d, t.length - d);
  };
  for (let i = 0; i < t.n; i += 4) {
    if (notNear >= 0 && along(i) < avoid) continue;
    const d = (t.x[i]! - x) ** 2 + (t.z[i]! - z) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  if (best < 0) return { i: 0, r: Infinity, side: 1 };
  for (let k = -5; k <= 5; k++) {
    const i = (best + k + t.n) % t.n;
    if (notNear >= 0 && along(i) < avoid) continue;
    const d = (t.x[i]! - x) ** 2 + (t.z[i]! - z) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  const h = t.heading[best]!;
  // right = (-cos h, sin h): positive side = right of travel
  const side = Math.sign(-(x - t.x[best]!) * Math.cos(h) + (z - t.z[best]!) * Math.sin(h)) || 1;
  return { i: best, r: Math.sqrt(bd), side };
}

export class Ground {
  private n = noise2(17);
  /** Half-width of the flat road bed: the road, its verge and one grid cell (so no terrain triangle can rise
   * over the asphalt between two grid points). */
  private bed: (i: number) => number;
  constructor(readonly track: Track, spacing = 6) {
    this.bed = (i) => track.hw[i]! + 2.2 + spacing * 1.05;
  }

  sideOf(nr: Near): Side {
    return nr.side > 0 ? this.track.right[nr.i]! : this.track.left[nr.i]!;
  }

  /** Height of the land a road leg implies at distance r from its centre. */
  private legHeight(nr: Near, x: number, z: number): number {
    const t = this.track;
    const yr = t.y[nr.i]!, e = Math.max(0, nr.r - this.bed(nr.i));
    const n = this.n(x, z);
    switch (this.sideOf(nr)) {
      case "cliff": return yr - 0.3 + 1.4 * Math.min(e, 3) + 0.8 * e + n * Math.min(1, e / 8) * 6;
      case "drop": return Math.max(WATER_Y - 9, yr - 0.4 - 1.1 * Math.min(e, 3) - 0.6 * e + n * Math.min(1, e / 8) * 4);
      case "village": return yr - 0.3 + 0.05 * e + n * Math.min(1, e / 25) * 2;
      default: return yr - 0.3 + 0.16 * e + n * Math.min(1, e / 12) * 3.5;
    }
  }

  /** Terrain height at (x, z): the nearest road leg's land, blended with the next leg's so hillsides meet. */
  heightAt(x: number, z: number): number {
    const a = nearest(this.track, x, z);
    const b = nearest(this.track, x, z, a.i, 90);
    const ea = Math.max(0.5, a.r - this.bed(a.i)), eb = Math.max(0.5, b.r - this.bed(b.i));
    if (a.r < this.bed(a.i)) return this.track.y[a.i]! - 0.35;
    const wa = 1 / (ea * ea), wb = b.r < Infinity ? 1 / (eb * eb) : 0;
    return (this.legHeight(a, x, z) * wa + this.legHeight(b, x, z) * wb) / (wa + wb);
  }

  /** Distance to the nearest road edge (negative = on the road), and the side type there. */
  roadside(x: number, z: number): { e: number; side: Side; i: number; s: number } {
    const a = nearest(this.track, x, z);
    return { e: a.r - this.track.hw[a.i]!, side: this.sideOf(a), i: a.i, s: a.side };
  }

  noise(x: number, z: number) {
    return this.n(x, z);
  }
}

export interface TerrainOpts {
  spacing: number;
  margin: number;
  chunk: number;
  trees: number;
  rocks: number;
  hedgeRows: number;
  bakeLight: boolean;
  seed: number;
}

export const LITE_TERRAIN: TerrainOpts = { spacing: 7, margin: 170, chunk: 110, trees: 230, rocks: 60, hedgeRows: 5, bakeLight: true, seed: 5 };
export const HIGH_TERRAIN: TerrainOpts = { spacing: 4.5, margin: 200, chunk: 110, trees: 520, rocks: 120, hedgeRows: 9, bakeLight: false, seed: 5 };

const c = new THREE.Color();
function albedo(ground: Ground, x: number, z: number, y: number, slope: number, out: THREE.Color) {
  const rs = ground.roadside(x, z);
  const n = ground.noise(x * 3, z * 3);
  if (y < WATER_Y + 0.8) return out.setRGB(0.16, 0.17, 0.12);
  if (rs.e < 3.2) return out.setRGB(0.36 + n * 0.04, 0.16, 0.09); // laterite verge
  if (slope > 1.05) return n > 0.25 ? out.setRGB(0.07, 0.13 + n * 0.05, 0.05) : out.setRGB(0.12 + n * 0.04, 0.12 + n * 0.035, 0.105); // wet rock, mossy in places
  if (rs.side === "village" && rs.e < 22) return out.setRGB(0.17 + n * 0.03, 0.15, 0.07);
  if (rs.side === "estate") return out.setRGB(0.07 + n * 0.02, 0.19 + n * 0.04, 0.05);
  return out.setRGB(0.07 + n * 0.03, 0.17 + n * 0.05, 0.06 + n * 0.02);
}

/** Bakes overcast light (sky dome + soft sun + a little bounce) into vertex colours. */
function bake(g: THREE.BufferGeometry) {
  const col = g.getAttribute("color") as THREE.BufferAttribute;
  const nor = g.getAttribute("normal") as THREE.BufferAttribute;
  for (let i = 0; i < col.count; i++) {
    const ny = nor.getY(i), ndl = Math.max(0, nor.getX(i) * SUN.x + ny * SUN.y + nor.getZ(i) * SUN.z);
    const light = 0.62 + 0.38 * (ny * 0.5 + 0.5) + 0.55 * ndl;
    col.setXYZ(i, Math.min(1, col.getX(i) * light * 1.35), Math.min(1, col.getY(i) * light * 1.35), Math.min(1, col.getZ(i) * light * 1.35));
  }
}

export interface TerrainChunk { geometry: THREE.BufferGeometry; center: THREE.Vector3; radius: number }

/** Builds every chunk (terrain + props). Takes ~100–300 ms; run it during the intro/loading screen. */
export function buildTerrain(t: Track, kit: PropKit, o: TerrainOpts): { chunks: TerrainChunk[]; ground: Ground } {
  const ground = new Ground(t, o.spacing);
  const rnd = makeRng(o.seed);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < t.n; i++) {
    minX = Math.min(minX, t.x[i]!); maxX = Math.max(maxX, t.x[i]!);
    minZ = Math.min(minZ, t.z[i]!); maxZ = Math.max(maxZ, t.z[i]!);
  }
  minX -= o.margin; maxX += o.margin; minZ -= o.margin; maxZ += o.margin;
  const nx = Math.ceil((maxX - minX) / o.spacing) + 1, nz = Math.ceil((maxZ - minZ) / o.spacing) + 1;
  const H = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) H[j * nx + i] = ground.heightAt(minX + i * o.spacing, minZ + j * o.spacing);

  const cx = Math.ceil((maxX - minX) / o.chunk), cz = Math.ceil((maxZ - minZ) / o.chunk);
  const parts: THREE.BufferGeometry[][] = Array.from({ length: cx * cz }, () => []);
  const chunkOf = (x: number, z: number) => Math.min(cx - 1, Math.max(0, Math.floor((x - minX) / o.chunk))) + Math.min(cz - 1, Math.max(0, Math.floor((z - minZ) / o.chunk))) * cx;

  // terrain: one indexed grid per chunk (shared edges duplicated so chunks are independent)
  const per = Math.round(o.chunk / o.spacing);
  for (let ccz = 0; ccz < cz; ccz++) {
    for (let ccx = 0; ccx < cx; ccx++) {
      const i0 = ccx * per, j0 = ccz * per;
      const i1 = Math.min(nx - 1, i0 + per), j1 = Math.min(nz - 1, j0 + per);
      if (i1 <= i0 || j1 <= j0) continue;
      const w = i1 - i0 + 1, h = j1 - j0 + 1;
      const pos = new Float32Array(w * h * 3), col = new Float32Array(w * h * 3);
      for (let j = 0; j < h; j++) {
        for (let i = 0; i < w; i++) {
          const gi = i0 + i, gj = j0 + j, k = (j * w + i) * 3;
          const x = minX + gi * o.spacing, z = minZ + gj * o.spacing, y = H[gj * nx + gi]!;
          pos[k] = x; pos[k + 1] = y; pos[k + 2] = z;
          const hx = H[gj * nx + Math.min(nx - 1, gi + 1)]! - H[gj * nx + Math.max(0, gi - 1)]!;
          const hz = H[Math.min(nz - 1, gj + 1) * nx + gi]! - H[Math.max(0, gj - 1) * nx + gi]!;
          const slope = Math.hypot(hx, hz) / (2 * o.spacing);
          albedo(ground, x, z, y, slope, c);
          col[k] = c.r; col[k + 1] = c.g; col[k + 2] = c.b;
        }
      }
      const idx: number[] = [];
      for (let j = 0; j < h - 1; j++) for (let i = 0; i < w - 1; i++) {
        const a = j * w + i, b = a + 1, d = a + w, e = d + 1;
        idx.push(a, d, b, b, d, e);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      g.setAttribute("color", new THREE.BufferAttribute(col, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      parts[ccx + ccz * cx]!.push(g.toNonIndexed());
    }
  }

  // props
  const place = (name: PropName, x: number, z: number, scale: number, yaw: number, sink = 0.1) => {
    const src = kit.get(name);
    if (!src) return;
    const y = ground.heightAt(x, z) - sink;
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(scale, scale * (0.9 + rnd() * 0.3), scale));
    const g = src.clone().applyMatrix4(m);
    parts[chunkOf(x, z)]!.push(g);
  };
  const spot = (minE: number, maxE: number) => {
    const i = Math.floor(rnd() * t.n), side = rnd() < 0.5 ? -1 : 1, h = t.heading[i]!;
    const r = t.hw[i]! + minE + Math.pow(rnd(), 1.4) * (maxE - minE);
    const x = t.x[i]! - Math.cos(h) * r * side, z = t.z[i]! + Math.sin(h) * r * side;
    const rs = ground.roadside(x, z);
    return rs.e < minE * 0.8 ? null : { x, z, side: rs.side, e: rs.e };
  };
  for (let k = 0, tries = 0; k < o.trees && tries < o.trees * 6; tries++) {
    const p = spot(5, 90);
    if (!p || ground.heightAt(p.x, p.z) < WATER_Y + 0.5) continue;
    k++;
    const pick: PropName = p.side === "village" ? (rnd() < 0.7 ? "tree_palmTall" : "tree_palmDetailedTall")
      : p.side === "estate" ? (rnd() < 0.6 ? "tree_tall_dark" : "tree_palmTall")
      : p.side === "drop" ? (["tree_detailed_dark", "tree_palmDetailedTall", "tree_default_dark"] as const)[Math.floor(rnd() * 3)]!
      : (["tree_detailed_dark", "tree_default_dark", "tree_tall_dark"] as const)[Math.floor(rnd() * 3)]!;
    place(pick, p.x, p.z, 3.2 + rnd() * 2.6, rnd() * 6.28);
  }
  for (let k = 0, tries = 0; k < o.rocks && tries < o.rocks * 6; tries++) {
    const p = spot(3, 40);
    if (!p || p.side === "estate") continue;
    k++;
    const pick: PropName = rnd() < 0.4 ? "rock_tallB" : rnd() < 0.5 ? "rock_largeA" : "plant_bushLarge";
    place(pick, p.x, p.z, pick === "plant_bushLarge" ? 2.5 + rnd() * 2 : 2 + rnd() * 3.5, rnd() * 6.28, 0.4);
  }

  // tea hedgerows along the estate stretch, parallel to the road on both sides
  for (let side = -1; side <= 1; side += 2) {
    for (let row = 0; row < o.hedgeRows; row++) {
      const off = 6.5 + row * 3.6;
      let pts: Array<[number, number, number]> = [];
      const flush = () => {
        if (pts.length > 3) {
          const g = hedgeRow(pts, 2.2, 1.15, rnd);
          const mid = pts[Math.floor(pts.length / 2)]!;
          parts[chunkOf(mid[0], mid[2])]!.push(g.toNonIndexed());
        }
        pts = [];
      };
      for (let i = 0; i < t.n; i += 2) {
        const sideType = side > 0 ? t.right[i] : t.left[i];
        const h = t.heading[i]!, r = t.hw[i]! + off;
        const x = t.x[i]! - Math.cos(h) * r * side, z = t.z[i]! + Math.sin(h) * r * side;
        const ok = sideType === "estate" && ground.roadside(x, z).e > off - 1.5;
        if (ok) {
          pts.push([x, ground.heightAt(x, z) - 0.15, z]);
          if (pts.length >= 24) {
            const last = pts[pts.length - 1]!;
            flush();
            pts.push(last);
          }
        } else flush();
      }
      flush();
    }
  }

  const chunks: TerrainChunk[] = [];
  for (const list of parts) {
    if (!list.length) continue;
    const g = mergeGeometries(list.map((p) => {
      const q = p.index ? p.toNonIndexed() : p;
      for (const k of Object.keys(q.attributes)) if (k !== "position" && k !== "normal" && k !== "color") q.deleteAttribute(k);
      if (!q.getAttribute("normal")) q.computeVertexNormals();
      return q;
    }))!;
    if (o.bakeLight) bake(g);
    // world-space UVs for the detail texture (grass, rock grain): 1 repeat per 7 m
    const pos = g.getAttribute("position");
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      uv[i * 2] = pos.getX(i) / 7 + pos.getY(i) * 0.05;
      uv[i * 2 + 1] = pos.getZ(i) / 7 - pos.getY(i) * 0.05;
    }
    g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    g.computeBoundingSphere();
    const bs = g.boundingSphere!;
    chunks.push({ geometry: g, center: bs.center.clone(), radius: bs.radius });
  }
  return { chunks, ground };
}
