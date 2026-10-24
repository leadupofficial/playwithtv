import { GOAL_HALF, HALF_W, PUCK_R, STRIKER_R, type Table } from "./engine";

/**
 * Air Hockey Motion, top-down on a 1280×720 stage. The table is painted once to its own canvas; each frame
 * only draws the puck (with a short trail), two strikers, a few sparks and the score. Light enough for a
 * 1 GB TV: no blur, no shadows, no per-frame allocation.
 */
export const W = 1280, H = 720;
const SC = 520;                     // pixels per table unit
const CX = W / 2, CY = 400;
const RAIL = 26;
export const sx = (x: number) => CX + x * SC;
export const sy = (y: number) => CY - y * SC;

export interface Spark { x: number; y: number; vx: number; vy: number; life: number; c: string }
export interface Banner { text: string; sub?: string; color: string; t: number; dur: number }

export interface HockeyView {
  table: HTMLCanvasElement;
  puck: HTMLCanvasElement;
  strikers: [HTMLCanvasElement, HTMLCanvasElement];
  colors: [string, string];
  names: [string, string];
  trail: Float32Array;              // x, y pairs (screen px)
  trailI: number;
  sparks: Spark[];
  banner: Banner | null;
  flash: [number, number];          // goal light per side, seconds left
  bg: CanvasGradient | null;
}

function canvas(w: number, h: number, paint: (c: CanvasRenderingContext2D) => void) {
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  paint(cv.getContext("2d")!);
  return cv;
}

function tableArt(colors: [string, string]) {
  const w = 2 * SC + RAIL * 2, h = 2 * HALF_W * SC + RAIL * 2;
  return canvas(w, h, (c) => {
    const ox = RAIL, oy = RAIL, tw = 2 * SC, th = 2 * HALF_W * SC;
    // rails
    c.fillStyle = "#1b1440";
    c.beginPath();
    c.roundRect(0, 0, w, h, 34);
    c.fill();
    c.strokeStyle = "#ff2bd6";
    c.lineWidth = 4;
    c.beginPath();
    c.roundRect(4, 4, w - 8, h - 8, 30);
    c.stroke();
    // playing surface
    const g = c.createLinearGradient(0, oy, 0, oy + th);
    g.addColorStop(0, "#e9f6ff");
    g.addColorStop(1, "#cfe6f7");
    c.fillStyle = g;
    c.beginPath();
    c.roundRect(ox, oy, tw, th, 18);
    c.fill();
    // air holes
    c.fillStyle = "rgba(40, 80, 120, 0.16)";
    for (let y = oy + 18; y < oy + th - 8; y += 26) for (let x = ox + 18 + ((y / 26) % 2) * 13; x < ox + tw - 8; x += 26) c.fillRect(x, y, 3, 3);
    // markings: halves tinted by player colour, centre line and circle, creases
    c.globalAlpha = 0.09;
    c.fillStyle = colors[0];
    c.fillRect(ox, oy, tw / 2, th);
    c.fillStyle = colors[1];
    c.fillRect(ox + tw / 2, oy, tw / 2, th);
    c.globalAlpha = 1;
    c.strokeStyle = "#e2384d";
    c.lineWidth = 6;
    c.beginPath();
    c.moveTo(ox + tw / 2, oy);
    c.lineTo(ox + tw / 2, oy + th);
    c.stroke();
    c.strokeStyle = "#3a7bd5";
    c.lineWidth = 5;
    c.beginPath();
    c.arc(ox + tw / 2, oy + th / 2, 0.2 * SC, 0, Math.PI * 2);
    c.stroke();
    c.beginPath();
    c.arc(ox + tw / 2, oy + th / 2, 10, 0, Math.PI * 2);
    c.fillStyle = "#3a7bd5";
    c.fill();
    for (const side of [0, 1]) {
      const gx = side === 0 ? ox : ox + tw;
      c.strokeStyle = colors[side as 0 | 1];
      c.lineWidth = 5;
      c.beginPath();
      c.arc(gx, oy + th / 2, 0.3 * SC, side === 0 ? -Math.PI / 2 : Math.PI / 2, side === 0 ? Math.PI / 2 : (3 * Math.PI) / 2);
      c.stroke();
      // goal mouth
      c.fillStyle = "#07040f";
      c.fillRect(side === 0 ? 0 : w - RAIL - 6, oy + th / 2 - GOAL_HALF * SC, RAIL + 6, GOAL_HALF * 2 * SC);
      c.fillStyle = colors[side as 0 | 1];
      c.fillRect(side === 0 ? RAIL - 6 : w - RAIL, oy + th / 2 - GOAL_HALF * SC - 8, 6, 8);
      c.fillRect(side === 0 ? RAIL - 6 : w - RAIL, oy + th / 2 + GOAL_HALF * SC, 6, 8);
    }
    c.font = "800 34px 'Baloo 2', system-ui, sans-serif";
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillStyle = "rgba(40, 80, 140, 0.18)";
    c.fillText("AIR HOCKEY", ox + tw / 2, oy + th * 0.78);
  });
}

function puckArt() {
  const r = Math.ceil(PUCK_R * SC);
  return canvas(r * 2 + 4, r * 2 + 4, (c) => {
    const m = r + 2;
    c.fillStyle = "#14121f";
    c.beginPath();
    c.arc(m, m, r, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = "#ffd23f";
    c.lineWidth = 3;
    c.beginPath();
    c.arc(m, m, r * 0.62, 0, Math.PI * 2);
    c.stroke();
    c.fillStyle = "rgba(255,255,255,0.35)";
    c.beginPath();
    c.arc(m - r * 0.35, m - r * 0.35, r * 0.25, 0, Math.PI * 2);
    c.fill();
  });
}

function strikerArt(color: string) {
  const r = Math.ceil(STRIKER_R * SC);
  return canvas(r * 2 + 6, r * 2 + 6, (c) => {
    const m = r + 3;
    c.fillStyle = "rgba(0,0,0,0.25)";
    c.beginPath();
    c.arc(m + 3, m + 4, r, 0, Math.PI * 2);
    c.fill();
    const g = c.createRadialGradient(m - r * 0.3, m - r * 0.3, 2, m, m, r);
    g.addColorStop(0, "#ffffff");
    g.addColorStop(0.25, color);
    g.addColorStop(1, color);
    c.fillStyle = g;
    c.beginPath();
    c.arc(m, m, r, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = "rgba(0,0,0,0.35)";
    c.lineWidth = 3;
    c.beginPath();
    c.arc(m, m, r * 0.72, 0, Math.PI * 2);
    c.stroke();
    // the handle knob
    c.fillStyle = "#ffffff";
    c.globalAlpha = 0.9;
    c.beginPath();
    c.arc(m, m, r * 0.36, 0, Math.PI * 2);
    c.fill();
    c.globalAlpha = 1;
    c.fillStyle = color;
    c.beginPath();
    c.arc(m, m, r * 0.24, 0, Math.PI * 2);
    c.fill();
  });
}

export function newView(colors: [string, string], names: [string, string]): HockeyView {
  return {
    table: tableArt(colors), puck: puckArt(), strikers: [strikerArt(colors[0]), strikerArt(colors[1])], colors, names,
    trail: new Float32Array(24), trailI: 0, sparks: [], banner: null, flash: [0, 0], bg: null,
  };
}

export function sparks(v: HockeyView, x: number, y: number, n: number, color: string) {
  for (let i = 0; i < n && v.sparks.length < 60; i++) {
    const a = Math.random() * Math.PI * 2, s = 120 + Math.random() * 380;
    v.sparks.push({ x: sx(x), y: sy(y), vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.3 + Math.random() * 0.3, c: color });
  }
}

export function draw(c: CanvasRenderingContext2D, t: Table, v: HockeyView, dt: number) {
  if (!v.bg) {
    v.bg = c.createRadialGradient(W / 2, H / 2, 100, W / 2, H / 2, 800);
    v.bg.addColorStop(0, "#1d1150");
    v.bg.addColorStop(1, "#06030f");
  }
  c.fillStyle = v.bg;
  c.fillRect(0, 0, W, H);
  // goal lights behind the goals
  for (const side of [0, 1] as const) {
    v.flash[side] = Math.max(0, v.flash[side] - dt);
    if (v.flash[side] > 0 && Math.floor(v.flash[side] * 8) % 2 === 0) {
      c.fillStyle = v.colors[side === 0 ? 1 : 0];
      c.globalAlpha = 0.55;
      c.fillRect(side === 0 ? 0 : W - 70, CY - 160, 70, 320);
      c.globalAlpha = 1;
    }
  }
  c.drawImage(v.table, CX - SC - RAIL, CY - HALF_W * SC - RAIL);
  // puck trail
  const p = t.puck;
  const px = sx(p.x), py = sy(p.y);
  v.trail[v.trailI * 2] = px;
  v.trail[v.trailI * 2 + 1] = py;
  v.trailI = (v.trailI + 1) % 12;
  const speed = Math.hypot(p.vx, p.vy);
  if (speed > 0.8 && t.phase === "play") {
    c.fillStyle = "#ffd23f";
    for (let k = 1; k < 12; k++) {
      const i = (v.trailI - 1 - k + 24) % 12;
      c.globalAlpha = (0.32 * (12 - k)) / 12 * Math.min(1, (speed - 0.8) / 1.2);
      c.beginPath();
      c.arc(v.trail[i * 2]!, v.trail[i * 2 + 1]!, PUCK_R * SC * (1 - k / 16), 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 1;
  }
  if (Math.abs(p.x) <= 1.05) c.drawImage(v.puck, px - v.puck.width / 2, py - v.puck.height / 2);
  for (const s of t.strikers) {
    const img = v.strikers[s.side];
    c.drawImage(img, sx(s.x) - img.width / 2, sy(s.y) - img.height / 2);
    if (s.smashT > 0) {
      c.strokeStyle = "#ffffff";
      c.lineWidth = 4;
      c.beginPath();
      c.arc(sx(s.x), sy(s.y), STRIKER_R * SC + 8, 0, Math.PI * 2);
      c.stroke();
    }
  }
  for (let i = v.sparks.length - 1; i >= 0; i--) {
    const k = v.sparks[i]!;
    k.life -= dt;
    if (k.life <= 0) { v.sparks.splice(i, 1); continue; }
    k.x += k.vx * dt;
    k.y += k.vy * dt;
    c.fillStyle = k.c;
    c.fillRect(k.x - 3, k.y - 3, 6, 6);
  }
  drawScore(c, t, v);
  drawBanner(c, v, dt);
}

function drawScore(c: CanvasRenderingContext2D, t: Table, v: HockeyView) {
  c.textBaseline = "middle";
  c.fillStyle = "rgba(12, 6, 32, 0.85)";
  c.beginPath();
  c.roundRect(W / 2 - 330, 12, 660, 68, 22);
  c.fill();
  c.font = "800 34px 'Baloo 2', system-ui, sans-serif";
  c.textAlign = "right";
  c.fillStyle = v.colors[0];
  c.fillText(v.names[0], W / 2 - 92, 47);
  c.textAlign = "left";
  c.fillStyle = v.colors[1];
  c.fillText(v.names[1], W / 2 + 92, 47);
  c.font = "900 58px 'Baloo 2', system-ui, sans-serif";
  c.textAlign = "center";
  c.fillStyle = "#ffffff";
  c.fillText(`${t.score[0]}`, W / 2 - 50, 48);
  c.fillText(`${t.score[1]}`, W / 2 + 50, 48);
  c.fillStyle = "#b9b2dd";
  c.font = "800 30px 'Baloo 2', system-ui, sans-serif";
  c.fillText(":", W / 2, 46);
  c.font = "700 24px 'Baloo 2', system-ui, sans-serif";
  c.textAlign = "right";
  c.fillText(`first to ${t.target}`, W - 40, 47);
}

function drawBanner(c: CanvasRenderingContext2D, v: HockeyView, dt: number) {
  const b = v.banner;
  if (!b) return;
  b.t += dt;
  if (b.t > b.dur) { v.banner = null; return; }
  const scale = 0.7 + 0.3 * Math.min(1, b.t / 0.15);
  c.globalAlpha = Math.min(1, (b.dur - b.t) / 0.25);
  c.save();
  c.translate(W / 2, CY - 20);
  c.scale(scale, scale);
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.font = "900 130px 'Baloo 2', system-ui, sans-serif";
  c.lineWidth = 14;
  c.strokeStyle = "#140a30";
  c.strokeText(b.text, 0, 0);
  c.fillStyle = b.color;
  c.fillText(b.text, 0, 0);
  if (b.sub) {
    c.font = "800 46px 'Baloo 2', system-ui, sans-serif";
    c.lineWidth = 8;
    c.strokeText(b.sub, 0, 100);
    c.fillStyle = "#ffffff";
    c.fillText(b.sub, 0, 100);
  }
  c.restore();
  c.globalAlpha = 1;
}
