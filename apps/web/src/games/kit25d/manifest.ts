/**
 * kit25d/manifest: the sprite-sheet manifest written by tools/blender/render_sprites.py, and the pure maths the
 * lite tier needs to draw it: which direction cell shows a heading, which frame plays at a time, where the cell
 * sits in the atlas (as texture UVs) and how big it is in world units. No DOM, no three.js: unit-tested.
 *
 * Heading convention (screen-relative, on the ground): 0 = facing screen-right, +π/2 = facing away from the
 * camera (up the screen), -π/2 = facing the viewer. Direction d shows angle0 + d·2π/directions.
 */

export interface Rect { x: number; y: number; w: number; h: number }

export interface SpriteManifest {
  format: "pwtv-sprites";
  version: 1;
  name: string;
  /** Atlas file, relative to the manifest (WebP). */
  image: string;
  /** Optional PNG fallback, relative to the manifest. */
  fallback: string | null;
  /** Optional camera-space normal-map atlas with the same layout. */
  normals: string | null;
  size: { w: number; h: number };
  cell: { w: number; h: number };
  grid: { cols: number; rows: number };
  directions: number;
  framesPerDirection: number;
  fps: number;
  angle0: number;
  /** Ground point under the model's centre, as fractions of a cell (top-left origin). */
  pivot: { x: number; y: number };
  /** Orthographic sheets: pixels per metre at render time (null for perspective sheets). */
  pixelsPerMetre: number | null;
  camera: { type: "ortho" | "persp"; elevationDeg: number; fovDeg: number | null };
  shadow: boolean;
  /** Cell rectangles in atlas pixels (top-left origin); index = direction * framesPerDirection + frame. */
  frames: Rect[];
  source?: Record<string, unknown>;
}

const TAU = Math.PI * 2;

/** Checks a parsed manifest and returns it typed, or throws an error that says what is wrong. */
export function parseManifest(json: unknown): SpriteManifest {
  const m = json as Partial<SpriteManifest> | null;
  const fail = (why: string): never => { throw new Error(`sprite manifest: ${why}`); };
  if (!m || typeof m !== "object") fail("not an object");
  if (m!.format !== "pwtv-sprites" || m!.version !== 1) fail("unknown format/version");
  const n = (v: unknown, name: string) => (typeof v === "number" && Number.isFinite(v) ? v : fail(`${name} must be a number`));
  if (typeof m!.image !== "string" || !m!.image) fail("image missing");
  n(m!.directions, "directions");
  n(m!.framesPerDirection, "framesPerDirection");
  if (m!.directions! < 1 || m!.framesPerDirection! < 1) fail("directions and framesPerDirection must be ≥ 1");
  n(m!.size?.w, "size.w");
  n(m!.size?.h, "size.h");
  n(m!.pivot?.x, "pivot.x");
  n(m!.pivot?.y, "pivot.y");
  if (!Array.isArray(m!.frames) || m!.frames.length !== m!.directions! * m!.framesPerDirection!) {
    fail(`frames must list directions × framesPerDirection = ${m!.directions! * m!.framesPerDirection!} rects`);
  }
  for (const r of m!.frames!) {
    if (r.x < 0 || r.y < 0 || r.x + r.w > m!.size!.w || r.y + r.h > m!.size!.h) fail(`frame ${JSON.stringify(r)} lies outside the atlas`);
  }
  return m as SpriteManifest;
}

/** Wraps an angle to [0, 2π). */
export function wrapAngle(a: number): number {
  const r = a % TAU;
  return r < 0 ? r + TAU : r;
}

/** The direction cell (0…directions-1) nearest to a screen-relative heading. */
export function directionIndex(heading: number, m: Pick<SpriteManifest, "directions" | "angle0">): number {
  const step = TAU / m.directions;
  return Math.round(wrapAngle(heading - m.angle0) / step) % m.directions;
}

/** The heading a direction cell shows. */
export function directionHeading(d: number, m: Pick<SpriteManifest, "directions" | "angle0">): number {
  return m.angle0 + (((d % m.directions) + m.directions) % m.directions) * (TAU / m.directions);
}

/** The animation frame (0…framesPerDirection-1) at `seconds`, looping at the sheet's fps (or a given one). */
export function frameAt(seconds: number, m: Pick<SpriteManifest, "framesPerDirection" | "fps">, fps = m.fps): number {
  if (m.framesPerDirection <= 1) return 0;
  const f = Math.floor(Math.max(0, seconds) * fps);
  return f % m.framesPerDirection;
}

/** Index into `frames` for a direction and frame (frames wrap). */
export function cellIndex(direction: number, frame: number, m: Pick<SpriteManifest, "directions" | "framesPerDirection">): number {
  const d = ((direction % m.directions) + m.directions) % m.directions;
  const f = ((frame % m.framesPerDirection) + m.framesPerDirection) % m.framesPerDirection;
  return d * m.framesPerDirection + f;
}

/**
 * Texture UV rectangle [u, v, width, height] of a cell for a texture uploaded with flipY (three.js's default for
 * images): v runs bottom-up, so the cell's top-left pixel row becomes the larger v.
 */
export function cellUv(i: number, m: Pick<SpriteManifest, "frames" | "size">): [number, number, number, number] {
  const r = m.frames[i]!;
  return [r.x / m.size.w, 1 - (r.y + r.h) / m.size.h, r.w / m.size.w, r.h / m.size.h];
}

/**
 * World size (width, height) of one cell at `scale` (1 = the size it was rendered at). Perspective sheets have no
 * fixed pixels-per-metre: pass `metresPerPixel` yourself.
 */
export function worldSize(m: Pick<SpriteManifest, "cell" | "pixelsPerMetre">, scale = 1, metresPerPixel?: number): { w: number; h: number } {
  const mpp = metresPerPixel ?? (m.pixelsPerMetre ? 1 / m.pixelsPerMetre : 0.01);
  return { w: m.cell.w * mpp * scale, h: m.cell.h * mpp * scale };
}

/**
 * Screen-relative heading of a ground-plane forward vector (fx, fz) seen by a camera whose own forward vector,
 * projected on the ground, is (cx, cz). three.js world: y up; the camera's right on the ground is (-cz, cx).
 */
export function screenHeading(fx: number, fz: number, cx: number, cz: number): number {
  const cl = Math.hypot(cx, cz) || 1;
  const ax = cx / cl, az = cz / cl;        // away from the camera
  const rx = -az, rz = ax;                 // screen right
  return Math.atan2(fx * ax + fz * az, fx * rx + fz * rz);
}
