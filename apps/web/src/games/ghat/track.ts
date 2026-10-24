/**
 * GHAT RUSH track: a closed mountain road built from "turtle" segments (straights and arcs with an elevation
 * change), closed with a smooth Hermite curve, resampled every STEP metres. Pure: no DOM, no three.js.
 *
 * Racers live in the road's own frame: s = distance along the centre line (it keeps growing lap after lap),
 * d = lateral offset (+ = to the right of the direction of travel), so laps, positions and "inside line" maths
 * are trivial and nobody can cut a corner. toWorld() turns (s, d) into a 3D point.
 *
 * World axes follow three.js: y up; a heading h means forward = (sin h, 0, cos h); right = (-cos h, 0, sin h).
 * Curvature κ = dh/ds (> 0 turns left).
 */

export const STEP = 2;

export type Side = "cliff" | "drop" | "estate" | "village";

export interface Segment {
  /** Length along the centre line (m). */
  len: number;
  /** Total turn (degrees, + = left). 0 = straight. */
  turn?: number;
  /** Elevation change over the segment (m). */
  dy?: number;
  /** Road half-width (m); hairpins are wider. */
  hw?: number;
  /** Crests (bumps that throw you into the air) spread along the segment. */
  crests?: number;
  crestAmp?: number;
  /** Length of each crest bump (m). */
  crestLen?: number;
  /** Scenery on the left and right of the road. */
  left?: Side;
  right?: Side;
  /** A label for the HUD / commentary ("Hairpin 1"). */
  name?: string;
}

export interface CourseDef {
  id: string;
  name: string;
  segments: Segment[];
  /** Default half width. */
  hw: number;
}

export interface Track {
  def: CourseDef;
  /** Lap length (m). */
  length: number;
  n: number;
  x: Float32Array; y: Float32Array; z: Float32Array;
  heading: Float32Array;
  curv: Float32Array;
  /** dy/ds. */
  slope: Float32Array;
  hw: Float32Array;
  left: Side[];
  right: Side[];
  /** Segment index per sample. */
  seg: Uint16Array;
}

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

export function wrapAngle(a: number): number {
  a = (a + Math.PI) % TAU;
  return (a < 0 ? a + TAU : a) - Math.PI;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

interface Pt { x: number; z: number; y: number; hw: number; seg: number }

/** Walks the segments at 1 m steps; returns the polyline and the end pose. */
function walk(def: CourseDef) {
  const pts: Pt[] = [];
  let x = 0, z = 0, h = 0, y = 0;
  def.segments.forEach((sg, si) => {
    const n = Math.max(1, Math.round(sg.len));
    const dh = ((sg.turn ?? 0) * DEG) / n;
    const y0 = y, dy = sg.dy ?? 0, hw = sg.hw ?? def.hw;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      h += dh / 2;
      x += Math.sin(h);
      z += Math.cos(h);
      h += dh / 2;
      y = y0 + dy * smooth((i + 1) / n);
      let bump = 0;
      if (sg.crests) {
        // raised-cosine bumps centred in equal slices of the segment
        const k = t * sg.crests, f = k - Math.floor(k);
        const w = Math.min(1, (sg.crestLen ?? 26) / (sg.len / sg.crests)); // bump width as a share of the slice
        const u = (f - 0.5) / w + 0.5;
        if (u > 0 && u < 1) bump = (sg.crestAmp ?? 2.4) * 0.5 * (1 - Math.cos(TAU * u));
      }
      pts.push({ x, z, y: y + bump, hw, seg: si });
    }
  });
  return { pts, x, z, h, y };
}

/** Where the segments end (before the automatic closing piece): distance from the start and heading error. */
export function closingGap(def: CourseDef): { dist: number; heading: number; y: number; x: number; z: number } {
  const { x, z, h, y } = walk(def);
  return { dist: Math.hypot(x, z), heading: wrapAngle(h) / DEG, y, x, z };
}

/** Builds the sampled track: walk, close with a Hermite curve, resample every STEP metres. */
export function buildTrack(def: CourseDef): Track {
  const { pts, x, z, h, y } = walk(def);
  // close: Hermite from the end pose back to the start pose (0,0 heading 0), elevation eased back to 0
  const dist = Math.hypot(x, z);
  const k = dist * 1.1;
  const t0 = { x: Math.sin(h) * k, z: Math.cos(h) * k }, t1 = { x: 0, z: k };
  const nClose = Math.max(8, Math.round(dist * 1.25));
  const lastSeg = def.segments.length; // the closing piece counts as one more segment
  for (let i = 1; i <= nClose; i++) {
    const t = i / nClose, t2 = t * t, t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
    pts.push({
      x: h00 * x + h10 * t0.x + h11 * t1.x,
      z: h00 * z + h10 * t0.z + h11 * t1.z,
      y: y * (1 - smooth(t)),
      hw: def.hw,
      seg: lastSeg,
    });
  }
  // cumulative length of the closed polyline (the start point (0,0) is the last point)
  const cum = new Float64Array(pts.length + 1);
  let px = 0, pz = 0;
  for (let i = 0; i < pts.length; i++) {
    cum[i + 1] = cum[i]! + Math.hypot(pts[i]!.x - px, pts[i]!.z - pz);
    px = pts[i]!.x;
    pz = pts[i]!.z;
  }
  const total = cum[pts.length]!;
  const n = Math.round(total / STEP);
  const length = n * STEP;
  const scale = total / length;
  const tr: Track = {
    def, length, n,
    x: new Float32Array(n), y: new Float32Array(n), z: new Float32Array(n),
    heading: new Float32Array(n), curv: new Float32Array(n), slope: new Float32Array(n), hw: new Float32Array(n),
    left: new Array(n), right: new Array(n), seg: new Uint16Array(n),
  };
  const at = (i: number): Pt => (i === 0 ? { ...pts[pts.length - 1]!, x: 0, z: 0, y: 0 } : pts[i - 1]!);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const s = i * STEP * scale;
    while (j < pts.length - 1 && cum[j + 1]! < s) j++;
    const a = at(j), b = at(j + 1);
    const f = (s - cum[j]!) / Math.max(1e-6, cum[j + 1]! - cum[j]!);
    tr.x[i] = a.x + (b.x - a.x) * f;
    tr.z[i] = a.z + (b.z - a.z) * f;
    tr.y[i] = a.y + (b.y - a.y) * f;
    tr.hw[i] = b.hw;
    tr.seg[i] = b.seg;
    const sg = def.segments[b.seg];
    tr.left[i] = sg?.left ?? "estate";
    tr.right[i] = sg?.right ?? "estate";
  }
  // smooth the half width so hairpins widen gently
  const hw = Float32Array.from(tr.hw);
  for (let i = 0; i < n; i++) {
    let acc = 0;
    for (let k2 = -10; k2 <= 10; k2++) acc += hw[(i + k2 + n) % n]!;
    tr.hw[i] = acc / 21;
  }
  for (let i = 0; i < n; i++) {
    const a = (i - 1 + n) % n, b = (i + 1) % n;
    tr.heading[i] = Math.atan2(tr.x[b]! - tr.x[a]!, tr.z[b]! - tr.z[a]!);
    tr.slope[i] = (tr.y[b]! - tr.y[a]!) / (2 * STEP);
  }
  for (let i = 0; i < n; i++) tr.curv[i] = wrapAngle(tr.heading[(i + 1) % n]! - tr.heading[i]!) / STEP;
  return tr;
}

/** s wrapped into [0, length). */
export function wrapS(t: Track, s: number): number {
  const r = s % t.length;
  return r < 0 ? r + t.length : r;
}

export interface Frame {
  x: number; y: number; z: number;
  heading: number; curv: number; slope: number; hw: number;
  i: number;
}

/** Interpolated road frame at distance s (any s: laps wrap). Pass `out` to avoid allocation. */
export function frameAt(t: Track, s: number, out: Frame = { x: 0, y: 0, z: 0, heading: 0, curv: 0, slope: 0, hw: 0, i: 0 }): Frame {
  const w = wrapS(t, s) / STEP;
  const i = Math.floor(w) % t.n, j = (i + 1) % t.n, f = w - Math.floor(w);
  out.i = i;
  out.x = t.x[i]! + (t.x[j]! - t.x[i]!) * f;
  out.y = t.y[i]! + (t.y[j]! - t.y[i]!) * f;
  out.z = t.z[i]! + (t.z[j]! - t.z[i]!) * f;
  out.heading = t.heading[i]! + wrapAngle(t.heading[j]! - t.heading[i]!) * f;
  out.curv = t.curv[i]! + (t.curv[j]! - t.curv[i]!) * f;
  out.slope = t.slope[i]! + (t.slope[j]! - t.slope[i]!) * f;
  out.hw = t.hw[i]! + (t.hw[j]! - t.hw[i]!) * f;
  return out;
}

export interface WorldPoint { x: number; y: number; z: number; heading: number }

/** World position of a point d metres right of the centre line at s (on the road surface). */
export function toWorld(t: Track, s: number, d: number, out: WorldPoint = { x: 0, y: 0, z: 0, heading: 0 }): WorldPoint {
  const f = frameAt(t, s, scratch);
  out.x = f.x - Math.cos(f.heading) * d;
  out.z = f.z + Math.sin(f.heading) * d;
  out.y = f.y;
  out.heading = f.heading;
  return out;
}
const scratch: Frame = { x: 0, y: 0, z: 0, heading: 0, curv: 0, slope: 0, hw: 0, i: 0 };

/** Maximum |curvature| in [s, s + ahead] (sampled), signed by the larger turn: what a driver sees coming. */
export function curvAhead(t: Track, s: number, ahead: number): number {
  let best = 0;
  for (let a = 0; a <= ahead; a += STEP * 2) {
    const c = frameAt(t, s + a, scratch).curv;
    if (Math.abs(c) > Math.abs(best)) best = c;
  }
  return best;
}

/** Smallest distance between two parts of the road that are more than `gap` metres apart along it, ignoring
 * pairs separated vertically by more than `clearance` (bridges). Used by tests to keep legs from overlapping. */
export function closestApproach(t: Track, gap = 120, clearance = 9): { dist: number; a: number; b: number } {
  let best = { dist: Infinity, a: 0, b: 0 };
  const stride = 2;
  for (let i = 0; i < t.n; i += stride) {
    for (let j = i + stride; j < t.n; j += stride) {
      const along = Math.min((j - i) * STEP, t.length - (j - i) * STEP);
      if (along < gap) continue;
      if (Math.abs(t.y[i]! - t.y[j]!) > clearance) continue;
      const d = Math.hypot(t.x[i]! - t.x[j]!, t.z[i]! - t.z[j]!);
      if (d < best.dist) best = { dist: d, a: i * STEP, b: j * STEP };
    }
  }
  return best;
}
