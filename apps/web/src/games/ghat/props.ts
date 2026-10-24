/**
 * Scenery props (Kenney Nature Kit trees, bushes, rocks, merged into props.glb by tools/blender/models/ghat_rush.py)
 * turned into plain vertex-coloured geometry, so a whole chunk of hillside (terrain + every tree on it) can be one
 * merged mesh and one draw call. Also: tea-estate hedgerows (the rows of clipped tea bushes) built in code.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { loadGltf } from "../kit3d/assets";

export type PropName =
  | "tree_palmTall" | "tree_palmDetailedTall" | "tree_detailed_dark" | "tree_tall_dark" | "tree_default_dark"
  | "plant_bushLarge" | "plant_bushDetailed" | "rock_largeA" | "rock_tallB" | "rock_smallC";

/** One geometry per prop with position, normal and color (the material colour baked per vertex). */
export type PropKit = Map<PropName, THREE.BufferGeometry>;

/** Kenney's bright cartoon palette → wet monsoon greens and dark bark. */
function monsoon(c: THREE.Color): THREE.Color {
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  const deg = hsl.h * 360;
  if (deg > 70 && deg < 210) return c.setHSL((100 + (deg - 70) * 0.15) / 360, Math.min(0.75, hsl.s * 1.1 + 0.1), hsl.l * 0.55);
  if (deg < 50 || deg > 330) return c.setHSL(hsl.h, hsl.s * 0.55, hsl.l * 0.5); // trunks and earth
  return c.multiplyScalar(0.7);
}

export async function loadProps(url: string): Promise<PropKit> {
  const gltf = await loadGltf(url);
  const kit: PropKit = new Map();
  gltf.scene.updateMatrixWorld(true);
  for (const node of gltf.scene.children) {
    const parts: THREE.BufferGeometry[] = [];
    node.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      const g = m.geometry.clone().applyMatrix4(m.matrixWorld);
      const groups = g.groups.length ? g.groups : [{ start: 0, count: g.index ? g.index.count : g.getAttribute("position").count, materialIndex: 0 }];
      const flat = g.index ? g.toNonIndexed() : g;
      const n = flat.getAttribute("position").count;
      const col = new Float32Array(n * 3);
      for (const grp of groups) {
        const c = monsoon(((mats[grp.materialIndex ?? 0] as THREE.MeshStandardMaterial).color ?? new THREE.Color(1, 1, 1)).clone());
        for (let i = grp.start; i < Math.min(n, grp.start + grp.count); i++) col.set([c.r, c.g, c.b], i * 3);
      }
      flat.setAttribute("color", new THREE.BufferAttribute(col, 3));
      for (const k of Object.keys(flat.attributes)) if (k !== "position" && k !== "normal" && k !== "color") flat.deleteAttribute(k);
      if (!flat.getAttribute("normal")) flat.computeVertexNormals();
      parts.push(flat);
    });
    if (parts.length) kit.set(node.name as PropName, parts.length === 1 ? parts[0]! : mergeGeometries(parts)!);
  }
  return kit;
}

/**
 * A tea hedgerow following a polyline (x, y, z points): a rounded, lumpy half-tube of clipped tea bushes.
 * Returns non-indexed-free indexed geometry with position, normal, color.
 */
export function hedgeRow(points: Array<[number, number, number]>, width: number, height: number, rnd: () => number): THREE.BufferGeometry {
  const prof = [[-1, 0], [-0.85, 0.6], [-0.4, 1], [0.4, 1], [0.85, 0.6], [1, 0]] as const;
  const P = prof.length;
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const [x, y, z] = points[i]!;
    const [nx, , nz] = points[Math.min(points.length - 1, i + 1)]!;
    const [px, , pz] = points[Math.max(0, i - 1)]!;
    let dx = nx - px, dz = nz - pz;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    const sx = -dz, sz = dx; // sideways
    const lump = 0.82 + rnd() * 0.36;
    const shade = 0.85 + rnd() * 0.3;
    for (const [u, v] of prof) {
      pos.push(x + sx * u * width * 0.5 * lump, y + v * height * lump, z + sz * u * width * 0.5 * lump);
      const top = v > 0.9;
      col.push((top ? 0.2 : 0.11) * shade, (top ? 0.42 : 0.27) * shade, (top ? 0.12 : 0.08) * shade);
    }
    if (i > 0) {
      const a = (i - 1) * P, b = i * P;
      for (let k = 0; k < P - 1; k++) idx.push(a + k, b + k, a + k + 1, a + k + 1, b + k, b + k + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
