/**
 * The road itself, in chunks along the lap (each ONE mesh, one material): wet asphalt with laterite shoulders,
 * ghat-style striped parapets (yellow-black above the drops, white-black along the cliffs, kerbs in the village),
 * milestones, and the river bridge's pillars. Rails and props use the white column of the road texture, so their
 * colour comes from vertex colours and everything shares the road's material.
 */
import * as THREE from "three";
import { STEP, type Side, type Track } from "./track";
import { ROAD_REPEAT, ROAD_U, WHITE_U } from "./textures";
import { WATER_Y } from "./terrain";

const SHOULDER = 1.6;
const WU = (WHITE_U + 1) / 2;

interface Buf { pos: number[]; uv: number[]; col: number[]; idx: number[] }

function quad(b: Buf, p: THREE.Vector3[], col: [number, number, number], uv?: number[][]) {
  const base = b.pos.length / 3;
  p.forEach((v, k) => {
    b.pos.push(v.x, v.y, v.z);
    const u = uv?.[k] ?? [WU, 0.5];
    b.uv.push(u[0]!, u[1]!);
    b.col.push(...col);
  });
  b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

const STRIPES: Record<Side, [[number, number, number], [number, number, number], number, number]> = {
  // colour A, colour B, height, thickness
  drop: [[0.95, 0.72, 0.08], [0.06, 0.06, 0.06], 0.8, 0.4],
  cliff: [[0.92, 0.92, 0.88], [0.06, 0.06, 0.06], 0.65, 0.35],
  estate: [[0.92, 0.92, 0.88], [0.06, 0.06, 0.06], 0.55, 0.3],
  village: [[0.9, 0.9, 0.86], [0.12, 0.12, 0.12], 0.28, 0.35],
};

export interface RoadChunk { geometry: THREE.BufferGeometry; center: THREE.Vector3; radius: number }

/** Builds the road in chunks of `per` samples. `bakeLight` darkens wall feet and wall sides (lite tier). */
export function buildRoad(t: Track, opts: { per?: number; bakeLight: boolean; bridgeSeg?: number }): RoadChunk[] {
  const per = opts.per ?? 30;
  const chunks: RoadChunk[] = [];
  const P = (i: number, d: number, up = 0) => {
    const k = ((i % t.n) + t.n) % t.n, h = t.heading[k]!;
    return new THREE.Vector3(t.x[k]! - Math.cos(h) * d, t.y[k]! + up, t.z[k]! + Math.sin(h) * d);
  };
  const shade = (c: [number, number, number], f: number): [number, number, number] => (opts.bakeLight ? [c[0] * f, c[1] * f, c[2] * f] : c);
  for (let start = 0; start < t.n; start += per) {
    const b: Buf = { pos: [], uv: [], col: [], idx: [] };
    const end = Math.min(t.n, start + per);
    for (let i = start; i < end; i++) {
      const j = i + 1;
      const hwA = t.hw[i % t.n]!, hwB = t.hw[j % t.n]!;
      const vA = (i * STEP) / ROAD_REPEAT, vB = (j * STEP) / ROAD_REPEAT;
      // road surface: shoulder | asphalt | shoulder
      const cols = [-(hwA + SHOULDER), -hwA, hwA, hwA + SHOULDER];
      const colsB = [-(hwB + SHOULDER), -hwB, hwB, hwB + SHOULDER];
      const us = [0, 0.085 * ROAD_U, 0.915 * ROAD_U, ROAD_U];
      for (let k = 0; k < 3; k++) {
        const edge = k !== 1;
        const f = edge ? 0.82 : 1;
        // note the winding: +d is to the right, so walk from right to left for an upward normal
        quad(b, [P(i, cols[k + 1]!), P(i, cols[k]!), P(j, colsB[k]!), P(j, colsB[k + 1]!)], shade([1, 1, 1], f),
          [[us[k + 1]!, vA], [us[k]!, vA], [us[k]!, vB], [us[k + 1]!, vB]]);
      }
      // parapets, one colour block per sample (2 m stripes)
      for (const side of [-1, 1] as const) {
        const type = side > 0 ? t.right[i % t.n]! : t.left[i % t.n]!;
        const [ca, cb, hgt, th] = STRIPES[type];
        const c = Math.floor(i / 1) % 2 ? ca : cb;
        const dIn = side * (hwA + 0.15), dOut = side * (hwA + 0.15 + th);
        const dInB = side * (hwB + 0.15), dOutB = side * (hwB + 0.15 + th);
        const top = shade(c, 1.05), face = shade(c, 0.85), back = shade(c, 0.6);
        const order = side > 0 ? 1 : -1;
        const q = (a: THREE.Vector3[], col: [number, number, number]) => quad(b, order > 0 ? a : [a[0]!, a[3]!, a[2]!, a[1]!], col);
        q([P(i, dIn, 0), P(i, dIn, hgt), P(j, dInB, hgt), P(j, dInB, 0)], face);       // road-facing side
        q([P(i, dIn, hgt), P(i, dOut, hgt), P(j, dOutB, hgt), P(j, dInB, hgt)], top);   // top
        q([P(i, dOut, hgt), P(i, dOut, -0.6), P(j, dOutB, -0.6), P(j, dOutB, hgt)], back); // outer side
        // milestones every 200 m on the left verge: white block, yellow cap
        if (side < 0 && i % 100 === 50) {
          const m = side * (hwA + 1.2);
          const w = 0.25;
          const h0 = 0.0, h1 = 0.55, h2 = 0.8;
          const corner = (dd: number, ds: number, y: number) => {
            const p = P(i, m + dd, y);
            const hh = t.heading[i % t.n]!;
            return p.add(new THREE.Vector3(Math.sin(hh) * ds, 0, Math.cos(hh) * ds));
          };
          for (const [y0, y1, col] of [[h0, h1, [0.95, 0.95, 0.92]], [h1, h2, [0.98, 0.75, 0.1]]] as const) {
            quad(b, [corner(-w, -w, y0), corner(-w, -w, y1), corner(w, -w, y1), corner(w, -w, y0)], shade(col as [number, number, number], 0.9));
            quad(b, [corner(w, -w, y0), corner(w, -w, y1), corner(w, w, y1), corner(w, w, y0)], shade(col as [number, number, number], 0.75));
            quad(b, [corner(-w, w, y0), corner(-w, w, y1), corner(-w, -w, y1), corner(-w, -w, y0)], shade(col as [number, number, number], 0.75));
          }
        }
      }
      // the bridge: pillars down to the river
      if (opts.bridgeSeg !== undefined && t.seg[i % t.n] === opts.bridgeSeg && i % 10 === 5) {
        for (const side of [-1, 1]) {
          const d0 = side * (hwA * 0.7), w = 0.9;
          const y0 = WATER_Y - 2, y1 = -0.4;
          const c0 = P(i, d0 - w, 0), c1 = P(i, d0 + w, 0);
          const hh = t.heading[i % t.n]!;
          const fwd = new THREE.Vector3(Math.sin(hh), 0, Math.cos(hh)).multiplyScalar(w);
          const at = (p: THREE.Vector3, f: number, y: number) => p.clone().addScaledVector(fwd, f).setY(t.y[i % t.n]! + y);
          const grey = shade([0.55, 0.55, 0.52], 0.85);
          quad(b, [at(c0, -1, y0), at(c0, -1, y1), at(c1, -1, y1), at(c1, -1, y0)], grey);
          quad(b, [at(c1, 1, y0), at(c1, 1, y1), at(c0, 1, y1), at(c0, 1, y0)], grey);
          quad(b, [at(c0, 1, y0), at(c0, 1, y1), at(c0, -1, y1), at(c0, -1, y0)], shade([0.55, 0.55, 0.52], 0.6));
          quad(b, [at(c1, -1, y0), at(c1, -1, y1), at(c1, 1, y1), at(c1, 1, y0)], shade([0.55, 0.55, 0.52], 0.6));
        }
        // deck underside
        const under = shade([0.4, 0.4, 0.38], 0.5);
        quad(b, [P(i, -hwA - 0.6, -0.9), P(i, hwA + 0.6, -0.9), P(j, hwB + 0.6, -0.9), P(j, -hwB - 0.6, -0.9)], under);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(b.pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(b.uv, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(b.col, 3));
    g.setIndex(b.idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    chunks.push({ geometry: g, center: g.boundingSphere!.center.clone(), radius: g.boundingSphere!.radius });
  }
  return chunks;
}
