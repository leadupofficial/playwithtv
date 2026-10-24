/**
 * The camera director, shared by both tiers (pure maths, no three.js): decides WHAT the shot is, each view decides
 * how to film it (lite: an orthographic camera panning/zooming over the pre-rendered backdrop; high/ultra: a
 * perspective camera that also orbits). A shot is a ground-plane centre (cx, cz), a width in metres across the
 * screen, and an extra yaw/lift for intro sweeps and cinematic cuts.
 */

export interface Shot { cx: number; cz: number; width: number; yaw: number; lift: number }

export const MIN_W = 11;
export const MAX_W = 18;
const ASPECT = 16 / 9;

/** The width that frames every point with a margin, for a camera pitched `pitchDeg`. */
export function frameWidth(points: Array<{ x: number; z: number }>, pitchDeg = 30): number {
  if (!points.length) return MAX_W;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of points) {
    x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
    z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z);
  }
  const s = Math.sin((pitchDeg * Math.PI) / 180);
  const needX = x1 - x0 + 7;
  const needY = ((z1 - z0) * s + 5) * ASPECT; // fighters stand ~2 m tall above their feet
  return Math.max(MIN_W, Math.min(MAX_W, Math.max(needX, needY)));
}

export class Director {
  shot: Shot = { cx: 0, cz: 0, width: MAX_W, yaw: 0, lift: 0 };
  private punchT = 0; private punchDur = 1; private punchAmt = 0; private punchX = 0; private punchZ = 0;
  private close: { x: number; z: number; t: number; dur: number; face: number } | null = null;
  private snap = true;

  /** Punch in on a moment (a final KO) by `amount` (0..1 of the width) for `seconds`. */
  punch(x: number, z: number, amount: number, seconds: number) {
    Object.assign(this, { punchX: x, punchZ: z, punchAmt: amount, punchT: seconds, punchDur: seconds });
  }

  /** A cinematic close-up (a special): a tight shot swung round to the fighter's side. */
  closeUp(x: number, z: number, face: number, seconds: number) {
    this.close = { x, z, t: seconds, dur: seconds, face };
  }

  get inCloseUp() {
    return !!this.close;
  }

  cut() {
    this.snap = true;
  }

  /**
   * points: fighters to frame. intro: 0..1 progress of the intro sweep (null when over). Returns the shot.
   */
  update(points: Array<{ x: number; z: number }>, dt: number, intro: number | null, bounds: { hx: number; hz: number }): Shot {
    let cx = 0, cz = 0;
    if (points.length) {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const p of points) {
        x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
        z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z);
      }
      cx = (x0 + x1) / 2;
      cz = (z0 + z1) / 2;
    }
    let width = frameWidth(points);
    // keep a little of the arena's middle in the shot so the edges (the danger) read
    cx = Math.max(-bounds.hx * 0.45, Math.min(bounds.hx * 0.45, cx * 0.8));
    cz = Math.max(-bounds.hz * 0.4, Math.min(bounds.hz * 0.5, cz * 0.7));
    let yaw = 0, lift = 0;
    if (intro !== null) {
      const e = 1 - (1 - intro) ** 3;
      width = MAX_W + (1 - e) * 4;
      cz = -bounds.hz * 1.6 * (1 - e) + cz * e;
      yaw = (1 - e) * 0.9;
      lift = (1 - e) * 0.35;
    }
    const k = this.snap ? 1 : 1 - Math.exp(-3.2 * dt);
    this.snap = false;
    const s = this.shot;
    s.cx += (cx - s.cx) * k;
    s.cz += (cz - s.cz) * k;
    s.width += (width - s.width) * k;
    s.yaw += (yaw - s.yaw) * (intro !== null ? 1 : k);
    s.lift += (lift - s.lift) * (intro !== null ? 1 : k);
    const out = { ...s };
    if (this.punchT > 0) {
      this.punchT = Math.max(0, this.punchT - dt);
      const p = this.punchT / this.punchDur;
      const w = Math.sin(Math.PI * Math.min(1, (1 - p) * 1.4)) * this.punchAmt;
      out.cx += (this.punchX - out.cx) * Math.min(1, w * 1.6);
      out.cz += (this.punchZ - out.cz) * Math.min(1, w * 1.6);
      out.width *= 1 - w;
    }
    if (this.close) {
      const c = this.close;
      c.t = Math.max(0, c.t - dt);
      const p = 1 - c.t / c.dur;
      const w = Math.sin(Math.PI * Math.min(1, p * 1.25)); // in fast, hold, ease out
      out.cx += (c.x - out.cx) * w;
      out.cz += (c.z - out.cz) * w;
      out.width += (5.2 - out.width) * w;
      out.yaw += Math.sin(c.face) * 0.55 * w;
      out.lift -= 0.12 * w;
      if (c.t === 0) this.close = null;
    }
    return out;
  }
}
