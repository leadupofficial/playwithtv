/**
 * Kart Knockout track geometry. A track is a closed centre line (Catmull-Rom through control points, resampled
 * every few pixels) on the 1280×720 stage, a road half-width, and a wall further out. Everything between the
 * road edge and the wall is slow grass. Pure: no DOM.
 */
export interface TrackDef {
  name: string;
  /** Control points, driven in this order; point 0 is the start/finish line. */
  points: Array<[number, number]>;
  /** Road half-width (px). */
  hw: number;
  /** Checkpoints per lap (anti-shortcut). */
  cps: number;
  /** Item box rows, as fractions of the lap. */
  boxes: number[];
  /** Speed pads on the road: [fraction of the lap, lateral offset in half-widths]. */
  pads: Array<[number, number]>;
  /** Grass/decoration palette. */
  theme: "grove" | "harbour" | "park";
}

export interface Track {
  def: TrackDef;
  n: number;
  xs: Float32Array;
  ys: Float32Array;
  /** Unit tangent per sample. */
  tx: Float32Array;
  ty: Float32Array;
  /** Arc length at each sample. */
  s: Float32Array;
  len: number;
  hw: number;
  /** Distance from the centre line where the wall stands. */
  wall: number;
  spacing: number;
  boxes: Array<{ x: number; y: number }>;
  pads: Array<{ x: number; y: number; a: number }>;
}

export const GRASS = 30;
const SPACING = 6;

function catmull(p0: number, p1: number, p2: number, p3: number, t: number) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

export function buildTrack(def: TrackDef): Track {
  const P = def.points;
  const m = P.length;
  // dense curve
  const dx: number[] = [], dy: number[] = [];
  for (let i = 0; i < m; i++) {
    const a = P[(i - 1 + m) % m]!, b = P[i]!, c = P[(i + 1) % m]!, d = P[(i + 2) % m]!;
    for (let k = 0; k < 24; k++) {
      const t = k / 24;
      dx.push(catmull(a[0], b[0], c[0], d[0], t));
      dy.push(catmull(a[1], b[1], c[1], d[1], t));
    }
  }
  const cum = [0];
  for (let i = 1; i <= dx.length; i++) {
    const j = i % dx.length;
    cum.push(cum[i - 1]! + Math.hypot(dx[j]! - dx[i - 1]!, dy[j]! - dy[i - 1]!));
  }
  const len = cum[dx.length]!;
  const n = Math.round(len / SPACING);
  const spacing = len / n;
  const xs = new Float32Array(n), ys = new Float32Array(n), s = new Float32Array(n);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const want = i * spacing;
    while (cum[j + 1]! < want) j++;
    const k = (want - cum[j]!) / Math.max(1e-6, cum[j + 1]! - cum[j]!);
    const j2 = (j + 1) % dx.length;
    xs[i] = dx[j]! + (dx[j2]! - dx[j]!) * k;
    ys[i] = dy[j]! + (dy[j2]! - dy[j]!) * k;
    s[i] = want;
  }
  const tx = new Float32Array(n), ty = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = (i - 1 + n) % n, b = (i + 1) % n;
    const ux = xs[b]! - xs[a]!, uy = ys[b]! - ys[a]!;
    const l = Math.hypot(ux, uy) || 1;
    tx[i] = ux / l;
    ty[i] = uy / l;
  }
  const t: Track = { def, n, xs, ys, tx, ty, s, len, hw: def.hw, wall: def.hw + GRASS, spacing, boxes: [], pads: [] };
  for (const f of def.boxes) {
    for (const lat of [-0.55, 0, 0.55]) {
      const p = pointAt(t, f * len, lat * def.hw);
      t.boxes.push({ x: p.x, y: p.y });
    }
  }
  for (const [f, lat] of def.pads) {
    const p = pointAt(t, f * len, lat * def.hw);
    t.pads.push({ x: p.x, y: p.y, a: p.a });
  }
  return t;
}

/** A point at arc length `s` (wraps), shifted `lat` px to the right of the driving direction, and the heading there. */
export function pointAt(t: Track, s: number, lat = 0) {
  const ss = ((s % t.len) + t.len) % t.len;
  const i = Math.min(t.n - 1, Math.floor(ss / t.spacing));
  const i2 = (i + 1) % t.n;
  const k = (ss - t.s[i]!) / t.spacing;
  const x = t.xs[i]! + (t.xs[i2]! - t.xs[i]!) * k;
  const y = t.ys[i]! + (t.ys[i2]! - t.ys[i]!) * k;
  const ax = t.tx[i]!, ay = t.ty[i]!;
  // right of the driving direction in screen coordinates (y down) is (-ty, tx)
  return { x: x - ay * lat, y: y + ax * lat, a: Math.atan2(ay, ax) };
}

const d2 = (t: Track, i: number, x: number, y: number) => {
  const ex = x - t.xs[i]!, ey = y - t.ys[i]!;
  return ex * ex + ey * ey;
};

/**
 * Nearest centre-line sample to (x, y), searching downhill from a previous answer `hint` (karts move at most a
 * sample or two per step). Falls back to a full search when the hint is clearly wrong.
 */
export function nearest(t: Track, x: number, y: number, hint = -1): number {
  if (hint >= 0) {
    let i = hint, best = d2(t, i, x, y);
    for (let guard = 0; guard < t.n; guard++) {
      const a = (i + 1) % t.n, b = (i - 1 + t.n) % t.n;
      const da = d2(t, a, x, y), db = d2(t, b, x, y);
      if (da < best && da <= db) { i = a; best = da; }
      else if (db < best) { i = b; best = db; }
      else break;
    }
    if (best <= (t.wall + 12) * (t.wall + 12)) return i;
  }
  let bi = 0, bd = Infinity;
  for (let i = 0; i < t.n; i++) {
    const d = d2(t, i, x, y);
    if (d < bd) { bd = d; bi = i; }
  }
  return bi;
}

/** Arc length of (x, y) projected on the centre line near sample `i`, and its signed lateral offset (right +). */
export function project(t: Track, i: number, x: number, y: number) {
  const ex = x - t.xs[i]!, ey = y - t.ys[i]!;
  const along = Math.max(-t.spacing, Math.min(t.spacing, ex * t.tx[i]! + ey * t.ty[i]!));
  const lat = -ex * t.ty[i]! + ey * t.tx[i]!;
  return { s: (t.s[i]! + along + t.len) % t.len, lat, dist: Math.hypot(ex, ey) };
}

/** Smallest distance between two parts of the track that are at least `apart` px of road away from each other. */
export function minSeparation(t: Track, apart: number) {
  let best = Infinity;
  const step = 2;
  for (let i = 0; i < t.n; i += step) {
    for (let j = i + step; j < t.n; j += step) {
      const along = Math.min(t.s[j]! - t.s[i]!, t.len - (t.s[j]! - t.s[i]!));
      if (along < apart) continue;
      const d = Math.hypot(t.xs[i]! - t.xs[j]!, t.ys[i]! - t.ys[j]!);
      if (d < best) best = d;
    }
  }
  return best;
}

/** Original circuits. All fit the left 1040 px of the stage (the standings panel is on the right). */
export const TRACKS: Record<string, TrackDef> = {
  grove: {
    name: "Mango Grove Loop",
    theme: "grove",
    hw: 44,
    cps: 10,
    points: [[150, 420], [150, 240], [250, 120], [420, 105], [520, 215], [610, 215], [710, 120], [870, 120], [960, 260], [930, 440], [810, 600], [650, 530], [480, 620], [270, 620]],
    boxes: [0.2, 0.52, 0.8],
    pads: [[0.38, 0], [0.9, -0.3]],
  },
  harbour: {
    name: "Harbour Hairpins",
    theme: "harbour",
    hw: 42,
    cps: 12,
    points: [[130, 470], [130, 270], [240, 120], [410, 125], [480, 280], [590, 385], [690, 290], [730, 130], [870, 95], [960, 240], [880, 380], [960, 540], [820, 640], [580, 600], [380, 640], [200, 620]],
    boxes: [0.16, 0.47, 0.74],
    pads: [[0.3, 0.3], [0.62, 0], [0.92, 0]],
  },
  oval: {
    name: "Pocket Park Oval",
    theme: "park",
    hw: 50,
    cps: 8,
    points: Array.from({ length: 12 }, (_, i) => {
      const a = Math.PI + (i / 12) * Math.PI * 2; // start on the left, heading up (clockwise on screen)
      return [Math.round(530 + Math.cos(a) * 340), Math.round(370 + Math.sin(a) * 215)] as [number, number];
    }),
    boxes: [0.3, 0.72],
    pads: [[0.5, 0]],
  },
};
