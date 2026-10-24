/**
 * Split-screen layout: every player gets their own chase camera. 1 → full screen, 2 → stacked halves (wide, like
 * a windscreen), 3–4 → quarters, 5–6 → 3 × 2, 7–8 → 4 × 2. Spare cells show the "TV director" camera (the race
 * leader), so the screen is never empty. Rects are fractions of the stage, y from the top. Pure.
 */

export interface ViewRect { x: number; y: number; w: number; h: number }
export interface Layout { player: ViewRect[]; director: ViewRect[]; cols: number; rows: number }

export function splitLayout(players: number): Layout {
  const n = Math.max(1, Math.min(8, Math.floor(players)));
  const [cols, rows] = n === 1 ? [1, 1] : n === 2 ? [1, 2] : n <= 4 ? [2, 2] : n <= 6 ? [3, 2] : [4, 2];
  const cells: ViewRect[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells.push({ x: c / cols, y: r / rows, w: 1 / cols, h: 1 / rows });
  return { player: cells.slice(0, n), director: cells.slice(n), cols, rows };
}

/** A view rect in drawing-buffer pixels for WebGL (origin bottom-left), with a hairline gap between views. */
export function toPixels(r: ViewRect, width: number, height: number, gap = 2): { x: number; y: number; w: number; h: number } {
  const x0 = Math.round(r.x * width), x1 = Math.round((r.x + r.w) * width);
  const yTop = Math.round(r.y * height), yBot = Math.round((r.y + r.h) * height);
  const gx = r.x > 0 ? gap : 0, gy = r.y + r.h < 0.999 ? gap : 0;
  return { x: x0 + gx, y: height - yBot + gy, w: x1 - x0 - gx, h: yBot - yTop - gy };
}
