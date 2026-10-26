/**
 * Groove Party's stage, drawn on a 2D canvas: cheap enough for the weakest TV (no WebGL, a handful of
 * shapes per frame, glow only above the lite tier).
 *
 * The coach dances the routine (blending into each pose a little before its beat, so you can read it in
 * time), the move cards slide along the rail towards the NOW ring, and the crowd bounces with the hype.
 */
import type { QualityProfile } from "../../quality/tier";
import { IDLE, MOVES, blend, type Pose } from "./moves";
import type { Step } from "./routine";

/** How far ahead the rail shows moves, ms. */
export const RAIL_AHEAD = 2600;
/** The coach starts moving into a pose this long before its beat. */
const LEAD = 200;

interface Look {
  top: string;
  legs: string;
  glow: string;
  sky: [string, string];
}

export class GrooveView {
  private ctx: CanvasRenderingContext2D;
  private w: number;
  private h: number;
  private fancy: boolean;
  private look: Look = { top: "#ffd23f", legs: "#3b2a6b", glow: "#ffd23f", sky: ["#2a0b3d", "#08040f"] };
  private flashes: Array<{ at: number; color: string }> = [];
  private crowd: Array<{ x: number; s: number; ph: number; c: string }>;
  private pose: Pose = IDLE;
  private nowRing = 0;

  constructor(private canvas: HTMLCanvasElement, q: QualityProfile) {
    this.w = canvas.width = q.resolution.w;
    this.h = canvas.height = q.resolution.h;
    this.ctx = canvas.getContext("2d", { alpha: false })!;
    this.fancy = !q.prerendered;
    const hues = ["#ff4fd8", "#29d3ff", "#ffd23f", "#3ddc97", "#ff9f1c", "#9b5cff"];
    this.crowd = Array.from({ length: this.fancy ? 26 : 14 }, (_, i) => ({ x: (i + 0.5) / (this.fancy ? 26 : 14), s: 0.8 + ((i * 37) % 10) / 25, ph: i * 1.7, c: hues[i % hues.length]! }));
  }

  setLook(l: Partial<Look>) {
    this.look = { ...this.look, ...l };
  }

  /** A burst of stage light (a sync, a streak). */
  flash(color: string) {
    this.flashes.push({ at: performance.now(), color });
  }

  /** The coach's pose at song time t (null: no song, idle groove). */
  private poseAt(steps: Step[] | null, t: number): Pose {
    if (!steps || !steps.length) return IDLE;
    // the step being shown is the last one whose (beat - LEAD) has passed
    let k = -1;
    for (let i = 0; i < steps.length; i++) { if (steps[i]!.t - LEAD <= t) k = i; else break; }
    if (k < 0) return blend(IDLE, MOVES[steps[0]!.move].pose, 1 - (steps[0]!.t - LEAD - t) / 400);
    const s = steps[k]!;
    const from = k > 0 && steps[k - 1]!.t + steps[k - 1]!.hold >= s.t - 1 ? MOVES[steps[k - 1]!.move].pose : IDLE;
    const into = Math.min(1, (t - (s.t - LEAD)) / LEAD);
    const ease = into * into * (3 - 2 * into);
    const p = blend(from, MOVES[s.move].pose, ease);
    // a rest after the move: drift back to idle
    const end = s.t + s.hold;
    const next = steps[k + 1];
    if (t > end - LEAD && (!next || next.t > end + 1)) return blend(p, IDLE, (t - (end - LEAD)) / (LEAD * 2));
    return p;
  }

  frame(t: number, beatMs: number, steps: Step[] | null, done: (i: number) => boolean, hype: number) {
    const { ctx, w, h } = this;
    const now = performance.now();
    const beat = t / beatMs;
    const pulse = Math.pow(1 - (((beat % 1) + 1) % 1), 3); // 1 on the beat, fading

    // sky and stage
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, this.look.sky[0]);
    g.addColorStop(1, this.look.sky[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // spotlights sweeping with the beat
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 3; i++) {
      const a = Math.sin(beat * 0.5 + i * 2.1) * 0.35;
      const x0 = w * (0.2 + i * 0.3);
      ctx.fillStyle = this.alpha(this.look.glow, 0.06 + pulse * 0.05);
      ctx.beginPath();
      ctx.moveTo(x0 - w * 0.01, 0);
      ctx.lineTo(x0 + w * 0.01, 0);
      ctx.lineTo(x0 + Math.sin(a) * h + w * 0.12, h * 0.86);
      ctx.lineTo(x0 + Math.sin(a) * h - w * 0.12, h * 0.86);
      ctx.fill();
    }
    for (const f of this.flashes) {
      const k = 1 - (now - f.at) / 500;
      if (k <= 0) continue;
      ctx.fillStyle = this.alpha(f.color, 0.25 * k);
      ctx.fillRect(0, 0, w, h);
    }
    this.flashes = this.flashes.filter((f) => now - f.at < 500);
    ctx.globalCompositeOperation = "source-over";
    // floor
    const floorY = h * 0.8;
    ctx.fillStyle = "#0b0714";
    ctx.fillRect(0, floorY, w, h - floorY);
    ctx.fillStyle = this.alpha(this.look.glow, 0.25 + pulse * 0.25);
    ctx.beginPath();
    ctx.ellipse(w / 2, floorY + h * 0.02, w * 0.16, h * 0.03, 0, 0, Math.PI * 2);
    ctx.fill();

    // crowd silhouettes along the front, jumping more as the hype climbs
    for (const c of this.crowd) {
      const jump = Math.max(0, Math.sin(beat * Math.PI + c.ph)) * h * 0.025 * (0.3 + hype * 1.4);
      const x = c.x * w, y = h + h * 0.02 - jump, r = h * 0.045 * c.s;
      ctx.fillStyle = "#05030a";
      ctx.beginPath();
      ctx.arc(x, y - r * 2.1, r * 0.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(x - r, y - r * 1.4, r * 2, r * 2);
      if (hype > 0.55) { // hands up
        ctx.fillStyle = this.alpha(c.c, 0.8);
        ctx.fillRect(x - r * 1.05, y - r * 3.4 - jump * 0.5, r * 0.3, r * 1.6);
        ctx.fillRect(x + r * 0.75, y - r * 3.4 - jump * 0.5, r * 0.3, r * 1.6);
      }
    }

    // the coach
    this.pose = this.poseAt(steps, t);
    this.drawCoach(w / 2, floorY, h * 0.072, this.pose, steps ? pulse : Math.pow(1 - ((now / 600) % 1), 3));

    // the rail of moves coming up
    if (steps) this.drawRail(t, steps, done, pulse);
  }

  private drawCoach(cx: number, groundY: number, u: number, p: Pose, pulse: number) {
    const { ctx } = this;
    const dir = (deg: number, len: number) => [Math.sin((deg * Math.PI) / 180) * len, Math.cos((deg * Math.PI) / 180) * len] as const;
    const thigh = 1.9 * u, shin = 1.9 * u, torso = 2.4 * u, upper = 1.45 * u, fore = 1.35 * u, head = 0.62 * u;
    const bob = pulse * u * 0.12;
    // legs from the hip; the hip sits so the lower foot touches the floor
    const legs = [p.fl, p.pl].map((a) => {
      const [kx, ky] = dir(a, thigh);
      const [fx, fy] = dir(a * 0.25, shin);
      return { kx, ky, fx: kx + fx, fy: ky + fy };
    });
    const footY = Math.max(...legs.map((l) => l.fy));
    const hx = cx + p.hip * torso, hy = groundY - footY - p.drop * thigh + bob * 0.5;
    const [sx, sy] = dir(180 + p.lean, torso);
    const shx = hx + sx, shy = hy + sy + bob;
    const perp = [Math.cos((p.lean * Math.PI) / 180) * 0.62 * u, Math.sin((p.lean * Math.PI) / 180) * 0.62 * u];
    const fancy = this.fancy;
    if (fancy) { ctx.shadowColor = this.look.glow; ctx.shadowBlur = u * 0.6; }
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const limb = (x0: number, y0: number, pts: Array<readonly [number, number]>, width: number, color: string) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      let x = x0, y = y0;
      for (const [dx, dy] of pts) { x += dx; y += dy; ctx.lineTo(x, y); }
      ctx.stroke();
      return [x, y] as const;
    };
    // legs
    for (const l of legs) limb(hx, hy, [[l.kx, l.ky], [l.fx - l.kx, l.fy - l.ky]], u * 0.62, this.look.legs);
    // torso
    limb(hx, hy, [[sx, sy + bob]], u * 1.25, this.look.top);
    // free arm (screen left), then the phone arm (screen right) with the phone
    const lsx = shx - perp[0]!, lsy = shy - perp[1]!, rsx = shx + perp[0]!, rsy = shy + perp[1]!;
    limb(lsx, lsy, [dir(p.fa, upper), dir(p.ff, fore)], u * 0.5, this.look.top);
    const [px, py] = limb(rsx, rsy, [dir(p.pa, upper * p.reach), dir(p.pf, fore * p.reach)], u * 0.5 * (2 - p.reach), this.look.top);
    // head
    ctx.fillStyle = "#f4d5b8";
    ctx.beginPath();
    ctx.arc(shx + Math.sin((p.lean * Math.PI) / 180) * head * 1.5, shy - head * 1.45, head, 0, Math.PI * 2);
    ctx.fill();
    // the phone in the right hand, glowing on the beat
    ctx.shadowBlur = fancy ? u * (0.8 + pulse * 1.2) : 0;
    ctx.fillStyle = "#ffffff";
    const ph = u * 0.62 * p.hand, pw = ph * 0.55;
    ctx.fillRect(px - pw / 2, py - ph / 2, pw, ph);
    ctx.fillStyle = this.alpha(this.look.glow, 0.85);
    ctx.fillRect(px - pw / 2 + pw * 0.15, py - ph / 2 + ph * 0.1, pw * 0.7, ph * 0.8);
    ctx.shadowBlur = 0;
  }

  private drawRail(t: number, steps: Step[], done: (i: number) => boolean, pulse: number) {
    const { ctx, w, h } = this;
    const y = h * 0.885, nowX = w * 0.12, railW = w * 0.8, size = h * 0.085;
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(0, y - size * 0.75, w, size * 1.5);
    // the NOW ring
    this.nowRing += (pulse - this.nowRing) * 0.3;
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = size * (0.06 + this.nowRing * 0.05);
    ctx.beginPath();
    ctx.arc(nowX, y, size * 0.62, 0, Math.PI * 2);
    ctx.stroke();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i]!;
      const dt = s.t - t;
      if (dt > RAIL_AHEAD) break;
      if (dt < -s.hold || dt < -500) continue;
      const m = MOVES[s.move];
      const x = nowX + Math.max(0, dt / RAIL_AHEAD) * railW;
      const live = dt <= 0;
      const k = live ? 1.15 : 1;
      ctx.globalAlpha = done(i) && dt < 0 ? 0.35 : 1;
      ctx.fillStyle = m.color;
      ctx.beginPath();
      ctx.arc(x, y, size * 0.5 * k, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = `${Math.round(size * 0.5 * k)}px sans-serif`;
      ctx.fillStyle = "#000";
      ctx.fillText(m.emoji, x, y + size * 0.03);
      if (dt < RAIL_AHEAD * 0.45) {
        ctx.font = `bold ${Math.round(size * 0.24)}px sans-serif`;
        ctx.fillStyle = "#fff";
        ctx.fillText(m.name.toUpperCase(), x, y - size * 0.72);
      }
      ctx.globalAlpha = 1;
    }
  }

  private alpha(hex: string, a: number) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a.toFixed(3)})`;
  }

  dispose() {
    this.canvas.width = this.canvas.height = 0;
  }
}
