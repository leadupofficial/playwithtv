/**
 * kitplat/camera: one shared screen for 1–4 heroes. Frames everyone it can (zooming out up to MAX_ZOOM), looks a
 * little ahead of the motion, follows the ground rather than every jump, and stays inside the level (or a boss
 * arena). Heroes it cannot fit are reported as stragglers; the world bubbles or leashes them. Pure.
 */

export const VIEW_W = 24;            // tiles across at zoom 1 (16:9)
export const VIEW_H = VIEW_W * 9 / 16;
export const MAX_ZOOM = 1.3;

export interface Cam { x: number; y: number; zoom: number; vw: number; vh: number; lockX0: number; lockX1: number }

export function newCam(x: number, y: number): Cam {
  return { x, y, zoom: 1, vw: VIEW_W, vh: VIEW_H, lockX0: -Infinity, lockX1: Infinity };
}

export interface Target { x: number; y: number; vx: number; grounded: boolean; weight: number }

/**
 * Moves the camera towards framing `targets` (weight 0 = ignore). In a race the leader gets more weight, so the
 * camera keeps up with the front while the field still fits.
 */
export function updateCam(cam: Cam, targets: Target[], levelW: number, levelH: number, dt: number) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, sx = 0, sy = 0, sw = 0, svx = 0;
  for (const t of targets) {
    if (t.weight <= 0) continue;
    minX = Math.min(minX, t.x); maxX = Math.max(maxX, t.x);
    minY = Math.min(minY, t.y); maxY = Math.max(maxY, t.y);
    sx += t.x * t.weight; sy += t.y * t.weight; svx += t.vx * t.weight; sw += t.weight;
  }
  if (sw <= 0) return;
  const spanX = maxX - minX + 9, spanY = maxY - minY + 6;
  const want = Math.min(MAX_ZOOM, Math.max(1, spanX / VIEW_W, spanY / VIEW_H));
  cam.zoom += (want - cam.zoom) * Math.min(1, dt * 1.5);
  cam.vw = VIEW_W * cam.zoom;
  cam.vh = VIEW_H * cam.zoom;
  const lead = Math.max(-3, Math.min(3, (svx / sw) * 0.3));
  let tx = sx / sw + lead;
  // keep the extremes on screen when the span allows it
  const half = cam.vw / 2 - 2.5;
  if (maxX - minX < half * 2) tx = Math.max(maxX - half, Math.min(minX + half, tx));
  const ty = sy / sw + cam.vh * 0.12;
  cam.x += (tx - cam.x) * Math.min(1, dt * 4.5);
  cam.y += (ty - cam.y) * Math.min(1, dt * (Math.abs(ty - cam.y) > 3 ? 5 : 2.4));
  clampCam(cam, levelW, levelH);
}

export function clampCam(cam: Cam, levelW: number, levelH: number) {
  const x0 = Math.max(0, cam.lockX0), x1 = Math.min(levelW, cam.lockX1);
  cam.x = x1 - x0 <= cam.vw ? (x0 + x1) / 2 : Math.max(x0 + cam.vw / 2, Math.min(x1 - cam.vw / 2, cam.x));
  cam.y = Math.max(cam.vh / 2 - 0.6, Math.min(Math.max(cam.vh / 2, levelH - cam.vh / 2 + 1), cam.y));
}

/** Is a point outside the view (with a margin)? */
export function offScreen(cam: Cam, x: number, y: number, margin = 1): boolean {
  return x < cam.x - cam.vw / 2 - margin || x > cam.x + cam.vw / 2 + margin || y < cam.y - cam.vh / 2 - margin - 1 || y > cam.y + cam.vh / 2 + margin + 3;
}
