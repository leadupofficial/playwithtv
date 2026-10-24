import { BALL_R, HEAD, KICKBACK, LANE_HALF, PIN_H, PIT_Y, type Lane } from "./physics";

/**
 * Bowling Master's lane in canvas 2D pseudo-3D on a 1280×720 stage: a pinhole projection from a camera behind
 * the foul line that follows the ball down the lane. Built for weak TV GPUs: flat polygons and a handful of
 * pre-rendered sprites (pins, balls, the sign), no per-frame allocation, no blur or shadow effects.
 */
export const W = 1280, H = 720;
const F = 2400;                 // focal length (px)
const HORIZON = 150;            // screen y of the vanishing point
const PIN_W = 0.121;            // a pin at its widest
const NEIGHBOUR = 2.0;          // lane-to-lane spacing for the lanes beside ours

export interface Cam { x: number; y: number; h: number }
export const AIM_CAM: Cam = { x: 0, y: -6, h: 1.35 };
export const PIN_CAM_Y = HEAD - 8.4;

export interface Confetti { x: number; y: number; vx: number; vy: number; c: string; life: number }
export interface Banner { text: string; sub?: string; color: string; t: number; dur: number }

export interface Scene {
  cam: Cam;
  pinSprite: HTMLCanvasElement;
  ballSprites: Map<string, HTMLCanvasElement>;
  sign: HTMLCanvasElement;
  sky: CanvasGradient | null;
  gutter: CanvasGradient | null;
  order: number[];              // draw order scratch (pins 0–9, ball 10)
  confetti: Confetti[];
  banner: Banner | null;
  time: number;
}

const P = { x: 0, y: 0, s: 0 };
const Q = { x: 0, y: 0, s: 0 };

function proj(c: Cam, x: number, y: number, z: number, out: typeof P): boolean {
  const d = y - c.y;
  if (d < 0.25) return false;
  const s = F / d;
  out.x = W / 2 + (x - c.x) * s;
  out.y = HORIZON + (c.h - z) * s;
  out.s = s;
  return true;
}

function sprite(w: number, h: number, paint: (c: CanvasRenderingContext2D) => void) {
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  paint(cv.getContext("2d")!);
  return cv;
}

/** A ten-pin silhouette, bottom-centre at the bottom edge of the sprite. */
function pinArt() {
  const SW = 48, SH = 150;
  return sprite(SW, SH, (c) => {
    const k = SH / 15;                  // sprite px per inch (pin = 15 in tall)
    const r = (inch: number) => (inch * k * SW) / (4.77 * k); // radii scaled so the belly fills the width
    const y = (inch: number) => SH - inch * k;
    const half = SW / 2;
    const prof: Array<[number, number]> = [[0, 1.0], [1.5, 1.85], [4.5, 2.38], [7, 1.9], [9.7, 0.92], [11.2, 1.05], [13.2, 1.27], [14.5, 0.95], [15, 0.2]];
    c.beginPath();
    c.moveTo(half - r(prof[0]![1]), y(0));
    for (let i = 1; i < prof.length; i++) {
      const [a, ra] = prof[i - 1]!, [b, rb] = prof[i]!;
      c.quadraticCurveTo(half - r((ra + rb) / 2) - (i === 3 ? 1.5 : 0), y((a + b) / 2), half - r(rb), y(b));
    }
    for (let i = prof.length - 1; i > 0; i--) {
      const [a, ra] = prof[i]!, [b, rb] = prof[i - 1]!;
      c.quadraticCurveTo(half + r((ra + rb) / 2) + (i === 3 ? 1.5 : 0), y((a + b) / 2), half + r(rb), y(b));
    }
    c.closePath();
    const g = c.createLinearGradient(0, 0, SW, 0);
    g.addColorStop(0, "#9aa3b5");
    g.addColorStop(0.35, "#ffffff");
    g.addColorStop(0.6, "#f4f2ee");
    g.addColorStop(1, "#7d8597");
    c.fillStyle = g;
    c.fill();
    c.save();
    c.clip();
    c.fillStyle = "#d8203a";
    c.fillRect(0, y(10.6), SW, 0.45 * k);
    c.fillRect(0, y(9.9), SW, 0.3 * k);
    c.restore();
  });
}

function ballArt(color: string) {
  return sprite(64, 64, (c) => {
    const g = c.createRadialGradient(24, 22, 3, 32, 32, 32);
    g.addColorStop(0, "#ffffff");
    g.addColorStop(0.18, color);
    g.addColorStop(0.75, color);
    g.addColorStop(1, "#0a0618");
    c.fillStyle = g;
    c.beginPath();
    c.arc(32, 32, 31, 0, Math.PI * 2);
    c.fill();
    // a swirl of marbling, original art
    c.globalAlpha = 0.25;
    c.strokeStyle = "#ffffff";
    c.lineWidth = 3;
    c.beginPath();
    c.arc(36, 36, 18, 0.4, 2.6);
    c.stroke();
    c.beginPath();
    c.arc(26, 30, 11, 3.4, 5.4);
    c.stroke();
  });
}

function signArt() {
  return sprite(512, 128, (c) => {
    const g = c.createLinearGradient(0, 0, 0, 128);
    g.addColorStop(0, "#2a0f5c");
    g.addColorStop(1, "#120733");
    c.fillStyle = g;
    c.fillRect(0, 0, 512, 128);
    c.strokeStyle = "#ff6fb5";
    c.lineWidth = 6;
    c.strokeRect(6, 6, 500, 116);
    c.fillStyle = "#ffd23f";
    c.font = "800 54px 'Baloo 2', system-ui, sans-serif";
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText("BOWLING MASTER", 256, 58);
    c.fillStyle = "#7cf2ff";
    for (let i = 0; i < 9; i++) c.fillRect(40 + i * 54, 100, 26, 6);
  });
}

export function newScene(colors: string[]): Scene {
  const ballSprites = new Map<string, HTMLCanvasElement>();
  for (const c of colors) if (!ballSprites.has(c)) ballSprites.set(c, ballArt(c));
  return {
    cam: { ...AIM_CAM }, pinSprite: pinArt(), ballSprites, sign: signArt(), sky: null, gutter: null,
    order: Array.from({ length: 11 }, (_, i) => i), confetti: [], banner: null, time: 0,
  };
}

/** A flat quad on the lane surface (z = height), clipped at the camera. */
function quad(c: CanvasRenderingContext2D, cam: Cam, x0: number, x1: number, y0: number, y1: number, z: number, fill: string | CanvasGradient) {
  const near = Math.max(y0, cam.y + 0.3);
  if (near >= y1) return;
  c.fillStyle = fill;
  c.beginPath();
  proj(cam, x0, near, z, P); c.moveTo(P.x, P.y);
  proj(cam, x1, near, z, P); c.lineTo(P.x, P.y);
  proj(cam, x1, y1, z, P); c.lineTo(P.x, P.y);
  proj(cam, x0, y1, z, P); c.lineTo(P.x, P.y);
  c.closePath();
  c.fill();
}

function line(c: CanvasRenderingContext2D, cam: Cam, x0: number, y0: number, x1: number, y1: number) {
  const a = Math.max(y0, cam.y + 0.3);
  if (a >= y1) return;
  const xa = x0 + ((x1 - x0) * (a - y0)) / (y1 - y0 || 1);
  proj(cam, xa, a, 0, P);
  proj(cam, x1, y1, 0, Q);
  c.moveTo(P.x, P.y);
  c.lineTo(Q.x, Q.y);
}

function laneSurface(c: CanvasRenderingContext2D, cam: Cam, ox: number, dim: boolean) {
  quad(c, cam, ox - 1.0, ox - KICKBACK, -6, PIT_Y + 0.6, 0.02, dim ? "#1c1433" : "#2a1d4d");        // capping
  quad(c, cam, ox + KICKBACK, ox + 1.0, -6, PIT_Y + 0.6, 0.02, dim ? "#1c1433" : "#2a1d4d");
  quad(c, cam, ox - KICKBACK, ox - LANE_HALF, 0, PIT_Y, -0.03, dim ? "#262038" : "#3a3550");    // gutters
  quad(c, cam, ox + LANE_HALF, ox + KICKBACK, 0, PIT_Y, -0.03, dim ? "#262038" : "#3a3550");
  quad(c, cam, ox - LANE_HALF, ox + LANE_HALF, -6, 0, 0, dim ? "#6b5032" : "#caa06a");             // approach
  quad(c, cam, ox - LANE_HALF, ox + LANE_HALF, 0, HEAD - 0.45, 0, dim ? "#7a5a36" : "#e0b67c");   // lane
  quad(c, cam, ox - LANE_HALF, ox + LANE_HALF, HEAD - 0.45, PIT_Y, 0, dim ? "#86663f" : "#ecc68f"); // pin deck
  quad(c, cam, ox - KICKBACK, ox + KICKBACK, PIT_Y, PIT_Y + 0.6, -0.05, "#07040f");                 // pit
}

/** Everything that does not move: alley, lanes beside ours, markings, the sign. */
function drawAlley(c: CanvasRenderingContext2D, s: Scene) {
  const cam = s.cam;
  if (!s.sky) {
    s.sky = c.createLinearGradient(0, 0, 0, H);
    s.sky.addColorStop(0, "#0d0626");
    s.sky.addColorStop(0.35, "#1a0b3d");
    s.sky.addColorStop(1, "#05030c");
  }
  c.fillStyle = s.sky;
  c.fillRect(0, 0, W, H);
  // back wall with neon strips
  if (proj(cam, -4, PIT_Y + 0.6, 2.4, P) && proj(cam, 4, PIT_Y + 0.6, 0, Q)) {
    c.fillStyle = "#140a30";
    c.fillRect(P.x, P.y, Q.x - P.x, Q.y - P.y);
    c.fillStyle = "#ff6fb5";
    const strip = Math.max(2, 0.03 * P.s);
    c.fillRect(P.x, P.y + (Q.y - P.y) * 0.12, Q.x - P.x, strip);
    c.fillStyle = "#7cf2ff";
    c.fillRect(P.x, P.y + (Q.y - P.y) * 0.2, Q.x - P.x, strip * 0.6);
  }
  for (const k of [-2, -1, 1, 2]) laneSurface(c, cam, k * NEIGHBOUR, true);
  laneSurface(c, cam, 0, false);
  // boards and markings
  c.strokeStyle = "rgba(120, 72, 28, 0.35)";
  c.lineWidth = 1;
  c.beginPath();
  for (let b = 1; b < 13; b++) {
    const x = -LANE_HALF + (b * 2 * LANE_HALF) / 13;
    line(c, cam, x, -6, x, PIT_Y);
  }
  c.stroke();
  // lane shine: a soft reflection down the middle
  c.globalAlpha = 0.1;
  quad(c, cam, -0.18, 0.18, 0.5, HEAD - 1, 0.001, "#ffffff");
  c.globalAlpha = 1;
  // foul line
  quad(c, cam, -LANE_HALF, LANE_HALF, -0.02, 0.02, 0.001, "#1d1430");
  // approach dots and target arrows
  c.fillStyle = "#5a2a1a";
  for (let i = 0; i < 7; i++) {
    const x = -LANE_HALF + ((5 + i * 5) * 2 * LANE_HALF) / 39;
    if (proj(cam, x, 2.13, 0, P)) { c.beginPath(); c.ellipse(P.x, P.y, 0.012 * P.s, 0.004 * P.s, 0, 0, Math.PI * 2); c.fill(); }
    const tip = 4.57 + Math.abs(3 - i) * 0.3;
    c.beginPath();
    if (proj(cam, x, tip + 0.3, 0, P)) c.moveTo(P.x, P.y);
    if (proj(cam, x - 0.022, tip, 0, P)) c.lineTo(P.x, P.y);
    if (proj(cam, x + 0.022, tip, 0, P)) c.lineTo(P.x, P.y);
    c.fill();
  }
  // the sign above the pins (masking unit)
  if (proj(cam, -0.8, PIT_Y + 0.05, 1.5, P) && proj(cam, 0.8, PIT_Y + 0.05, 1.0, Q)) c.drawImage(s.sign, P.x, P.y, Q.x - P.x, Q.y - P.y);
  // pins standing on the lanes beside ours, for a busy alley
  c.globalAlpha = 0.55;
  for (const k of [-1, 1]) for (let i = 0; i < 4; i++) for (let j = 0; j <= i; j++) drawPinAt(c, s, k * NEIGHBOUR + (j - i / 2) * 0.3048, HEAD + i * 0.2639, 0, 0, 0);
  c.globalAlpha = 1;
}

/** A pin standing or lying: the sprite is stretched between its projected base and head. */
function drawPinAt(c: CanvasRenderingContext2D, s: Scene, x: number, y: number, z: number, tilt: number, dir: number) {
  const cam = s.cam;
  const hx = x + Math.sin(tilt) * Math.cos(dir) * PIN_H;
  const hy = y + Math.sin(tilt) * Math.sin(dir) * PIN_H;
  const hz = z + Math.cos(tilt) * PIN_H + (tilt > 0.3 ? 0.06 * Math.sin(tilt) : 0);
  const bz = z + (tilt > 0.3 ? 0.06 * Math.sin(tilt) : 0);
  if (!proj(cam, x, y, bz, P) || !proj(cam, hx, hy, hz, Q)) return;
  const vx = Q.x - P.x, vy = Q.y - P.y;
  const len = Math.hypot(vx, vy) || 1;
  const px = -vy / len, py = vx / len;
  const w = PIN_W * P.s;
  const sw = s.pinSprite.width, sh = s.pinSprite.height;
  const k = w / sw;
  // sprite x → across the pin, sprite y (downwards) → from head to base
  c.setTransform(px * k, py * k, -vx / sh, -vy / sh, P.x, P.y);
  c.drawImage(s.pinSprite, -sw / 2, -sh);
  c.setTransform(1, 0, 0, 1, 0, 0);
}

function shadow(c: CanvasRenderingContext2D, cam: Cam, x: number, y: number, r: number, alpha: number) {
  if (!proj(cam, x, y, 0, P)) return;
  c.fillStyle = `rgba(20, 8, 0, ${alpha})`;
  c.beginPath();
  c.ellipse(P.x, P.y, r * P.s, r * P.s * 0.35, 0, 0, Math.PI * 2);
  c.fill();
}

function drawBall(c: CanvasRenderingContext2D, s: Scene, x: number, y: number, rolled: number, color: string, gutter: boolean) {
  const cam = s.cam;
  const z = gutter ? BALL_R - 0.05 : BALL_R;
  shadow(c, cam, x, y + 0.04, BALL_R * 0.95, 0.4);
  if (!proj(cam, x, y, z, P)) return;
  const r = BALL_R * P.s;
  const spr = s.ballSprites.get(color) ?? s.ballSprites.values().next().value!;
  c.drawImage(spr, P.x - r, P.y - r, r * 2, r * 2);
  // finger holes turning with the roll
  const phase = rolled / BALL_R;
  c.fillStyle = "rgba(5, 3, 12, 0.85)";
  for (let i = 0; i < 3; i++) {
    const a = phase + [0, 0.55, 0.55][i]!;
    const cos = Math.cos(a);
    if (cos <= 0.15) continue;
    const hx = P.x + [0, -0.22, 0.22][i]! * r;
    const hy = P.y - Math.sin(a) * r * 0.62;
    c.beginPath();
    c.ellipse(hx, hy, r * 0.11, r * 0.11 * cos, 0, 0, Math.PI * 2);
    c.fill();
  }
}

/** The dotted aiming guide over the front of the lane (where the ball will go, not where it will end up). */
export function drawGuide(c: CanvasRenderingContext2D, s: Scene, path: Array<{ x: number; y: number }>, color: string, upTo: number) {
  c.fillStyle = color;
  for (let i = 1; i < path.length; i++) {
    const q = path[i]!;
    if (q.y > upTo) break;
    if (!proj(s.cam, q.x, q.y, 0.003, P)) continue;
    const r = Math.max(2, 0.028 * P.s);
    c.globalAlpha = 0.9 - (q.y / upTo) * 0.6;
    c.beginPath();
    c.ellipse(P.x, P.y, r, r * 0.4, 0, 0, Math.PI * 2);
    c.fill();
  }
  c.globalAlpha = 1;
}

/** Draws the lane, pins and ball. `standX` is where the ball waits before it is thrown. */
export function drawLane(c: CanvasRenderingContext2D, s: Scene, lane: Lane, color: string, standX: number, guide: (() => void) | null) {
  drawAlley(c, s);
  if (guide) guide();
  const cam = s.cam;
  // far to near: pins and the ball by distance from the camera
  const ball = lane.ball;
  const by = ball.thrown ? ball.y : -0.35;
  const depth = (i: number) => (i === 10 ? by : lane.pins[i]!.y);
  s.order.sort((a, b) => depth(b) - depth(a));
  for (const p of lane.pins) if (!p.cleared && !p.gone) shadow(c, cam, p.x, p.y, p.standing ? 0.065 : 0.09, 0.28);
  for (const i of s.order) {
    if (i === 10) {
      if (ball.thrown && ball.done) continue;
      drawBall(c, s, ball.thrown ? ball.x : standX, by, ball.rolled, color, ball.gutter);
    } else {
      const p = lane.pins[i]!;
      if (p.cleared || p.gone) continue;
      drawPinAt(c, s, p.x, p.y, p.z, p.tilt, p.dir);
    }
  }
}

/** Moves the camera: behind the foul line while aiming, following the ball, then looking at the pins. */
export function moveCamera(s: Scene, lane: Lane, aiming: boolean, dt: number) {
  const b = lane.ball;
  const ty = aiming || !b.thrown ? AIM_CAM.y : Math.min(PIN_CAM_Y, Math.max(AIM_CAM.y, b.y - 6));
  const th = aiming || !b.thrown ? AIM_CAM.h : 1.35 - 0.3 * Math.min(1, Math.max(0, (s.cam.y - AIM_CAM.y) / (PIN_CAM_Y - AIM_CAM.y)));
  const k = aiming ? Math.min(1, dt * 3) : Math.min(1, dt * 6);
  s.cam.y += (ty - s.cam.y) * k;
  s.cam.h += (th - s.cam.h) * k;
  s.time += dt;
}

const CONFETTI = ["#ffd23f", "#ff6fb5", "#7cf2ff", "#3ee08f", "#ff7a59"];
export function celebrate(s: Scene, n: number) {
  for (let i = 0; i < n && s.confetti.length < 90; i++) {
    s.confetti.push({ x: W / 2 + (Math.random() - 0.5) * 300, y: 330, vx: (Math.random() - 0.5) * 900, vy: -300 - Math.random() * 500, c: CONFETTI[i % CONFETTI.length]!, life: 1.6 + Math.random() });
  }
}

/** Banner text and confetti on top of the scene. */
export function drawEffects(c: CanvasRenderingContext2D, s: Scene, dt: number) {
  for (let i = s.confetti.length - 1; i >= 0; i--) {
    const p = s.confetti[i]!;
    p.vy += 900 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.life -= dt;
    if (p.life <= 0 || p.y > H) { s.confetti.splice(i, 1); continue; }
    c.fillStyle = p.c;
    c.fillRect(p.x, p.y, 10, 6);
  }
  const b = s.banner;
  if (!b) return;
  b.t += dt;
  if (b.t > b.dur) { s.banner = null; return; }
  const pop = Math.min(1, b.t / 0.18);
  const scale = 0.6 + 0.4 * pop + (b.t < 0.3 ? Math.sin((b.t / 0.3) * Math.PI) * 0.08 : 0);
  const fade = Math.min(1, (b.dur - b.t) / 0.3);
  c.globalAlpha = fade;
  c.save();
  c.translate(W / 2, 300);
  c.scale(scale, scale);
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.font = "900 120px 'Baloo 2', system-ui, sans-serif";
  c.lineWidth = 14;
  c.strokeStyle = "#140a30";
  c.strokeText(b.text, 0, 0);
  c.fillStyle = b.color;
  c.fillText(b.text, 0, 0);
  if (b.sub) {
    c.font = "800 44px 'Baloo 2', system-ui, sans-serif";
    c.lineWidth = 8;
    c.strokeText(b.sub, 0, 92);
    c.fillStyle = "#ffffff";
    c.fillText(b.sub, 0, 92);
  }
  c.restore();
  c.globalAlpha = 1;
}
