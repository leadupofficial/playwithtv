import { COL_W, HERO_R, ROCKET_T, WORLD_NAMES, type Enemy, type Hero, type Pickup, type Platform, type World } from "./engine";

/** Canvas drawing for Tilt Jumper Worlds on a 1280x720 stage: one column per player. Shapes only, no images. */
export const CW = 1280, CH = 720;
const LITE = typeof navigator !== "undefined" && ((navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 8) <= 2;

export interface Column { x: number; w: number; s: number; viewH: number }

/** Side-by-side columns: wide for one or two players, narrower for three or four. */
export function columns(n: number): Column[] {
  const w = n <= 2 ? 520 : n === 3 ? 400 : 310;
  const gap = n <= 2 ? 40 : n === 3 ? 20 : 10;
  const total = n * w + (n - 1) * gap;
  const x0 = (CW - total) / 2;
  return Array.from({ length: n }, (_, i) => ({ x: x0 + i * (w + gap), w, s: w / COL_W, viewH: CH / (w / COL_W) }));
}

interface Theme { sky: [string, string]; top: string; body: string; edge: string; decor: "clouds" | "mesas" | "crystals" | "planets"; star: boolean }
const THEMES: Theme[] = [
  { sky: ["#58b8f5", "#d4f1ff"], top: "#58c957", body: "#8b5a2b", edge: "#3c9a3b", decor: "clouds", star: false },
  { sky: ["#ff6f61", "#ffc27a"], top: "#f2c57c", body: "#b8642a", edge: "#d88b45", decor: "mesas", star: false },
  { sky: ["#140f3d", "#4a2a7d"], top: "#9cf0ff", body: "#5a4bc0", edge: "#c7f7ff", decor: "crystals", star: true },
  { sky: ["#020109", "#151c42"], top: "#d6dde6", body: "#4a5568", edge: "#00e5ff", decor: "planets", star: true },
];
const KIND_TOP = { moving: "#5aa9ff", breaking: "#a87b4f", spring: "", normal: "" };

/** Pooled effects: a fixed number of particles and pop-up texts, reused (no allocations while playing). */
interface Particle { on: boolean; col: number; x: number; y: number; vx: number; vy: number; t: number; life: number; r: number; c: string }
interface Popup { on: boolean; col: number; x: number; y: number; t: number; text: string; c: string }
interface Banner { t: number; text: string }

export interface JumperView {
  cols: Column[];
  colors: string[];
  skies: CanvasGradient[][];
  stars: Float32Array; // x (0..1), y (0..1), size, per star
  particles: Particle[];
  popups: Popup[];
  banners: Banner[];
  /** Background cross-fade per column: from which world, and how far (0..1). */
  fade: Array<{ from: number; to: number; k: number }>;
  time: number;
}

export function newView(ctx: CanvasRenderingContext2D, n: number, colors: string[]): JumperView {
  const cols = columns(n);
  const skies = cols.map(() => THEMES.map((th) => {
    const g = ctx.createLinearGradient(0, 0, 0, CH);
    g.addColorStop(0, th.sky[0]);
    g.addColorStop(1, th.sky[1]);
    return g;
  }));
  let s = 11;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const stars = new Float32Array((LITE ? 30 : 60) * 3);
  for (let i = 0; i < stars.length; i += 3) { stars[i] = rnd(); stars[i + 1] = rnd(); stars[i + 2] = 0.6 + rnd() * 1.8; }
  const particles: Particle[] = Array.from({ length: LITE ? 80 : 200 }, () => ({ on: false, col: 0, x: 0, y: 0, vx: 0, vy: 0, t: 0, life: 1, r: 3, c: "#fff" }));
  const popups: Popup[] = Array.from({ length: 16 }, () => ({ on: false, col: 0, x: 0, y: 0, t: 0, text: "", c: "#fff" }));
  return { cols, colors, skies, stars, particles, popups, banners: cols.map(() => ({ t: 9, text: "" })), fade: cols.map(() => ({ from: 0, to: 0, k: 1 })), time: 0 };
}

// ---- effects ----------------------------------------------------------------------------------

/** Emits `n` particles at a world position in column `col` (from the pool; the oldest are not replaced). */
export function burst(v: JumperView, col: number, x: number, y: number, n: number, c: string, speed = 220) {
  for (const p of v.particles) {
    if (n <= 0) break;
    if (p.on) continue;
    const a = Math.random() * Math.PI * 2, sp = speed * (0.3 + Math.random() * 0.7);
    p.on = true; p.col = col; p.x = x; p.y = y; p.vx = Math.cos(a) * sp; p.vy = Math.sin(a) * sp + speed * 0.4;
    p.t = 0; p.life = 0.5 + Math.random() * 0.4; p.r = 2 + Math.random() * 3; p.c = c;
    n--;
  }
}

export function popup(v: JumperView, col: number, x: number, y: number, text: string, c: string) {
  const p = v.popups.find((q) => !q.on) ?? v.popups[0]!;
  p.on = true; p.col = col; p.x = x; p.y = y; p.t = 0; p.text = text; p.c = c;
}

export function enterWorld(v: JumperView, col: number, world: number) {
  const f = v.fade[col]!;
  f.from = f.to; f.to = world; f.k = 0;
  v.banners[col] = { t: 0, text: WORLD_NAMES[world] ?? "" };
}

export function animate(v: JumperView, dt: number) {
  v.time += dt;
  for (const p of v.particles) {
    if (!p.on) continue;
    p.t += dt;
    if (p.t >= p.life) { p.on = false; continue; }
    p.vy -= 600 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }
  for (const p of v.popups) if (p.on && (p.t += dt) > 1.1) p.on = false;
  for (const b of v.banners) b.t += dt;
  for (const f of v.fade) f.k = Math.min(1, f.k + dt * 0.7);
}

// ---- drawing ----------------------------------------------------------------------------------

function rrect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function drawBackground(c: CanvasRenderingContext2D, v: JumperView, i: number, w: World) {
  const col = v.cols[i]!, f = v.fade[i]!;
  c.globalAlpha = 1;
  c.fillStyle = v.skies[i]![f.from]!;
  c.fillRect(col.x, 0, col.w, CH);
  if (f.k < 1 || f.from !== f.to) {
    c.globalAlpha = f.k;
    c.fillStyle = v.skies[i]![f.to]!;
    c.fillRect(col.x, 0, col.w, CH);
    c.globalAlpha = 1;
  }
  const th = THEMES[f.to]!;
  const cam = w.camY * col.s;
  if (th.star) {
    c.fillStyle = "#ffffff";
    for (let k = 0; k < v.stars.length; k += 3) {
      const y = (((v.stars[k + 1]! * CH + cam * 0.08) % CH) + CH) % CH;
      c.globalAlpha = 0.4 + 0.6 * Math.abs(Math.sin(v.time * 1.3 + k));
      c.fillRect(col.x + v.stars[k]! * col.w, y, v.stars[k + 2]!, v.stars[k + 2]!);
    }
    c.globalAlpha = 1;
  }
  const band = 900;
  if (th.decor === "clouds") {
    c.fillStyle = "rgba(255,255,255,0.75)";
    for (let k = 0; k < 4; k++) {
      const y = ((k * 230 + cam * 0.3) % band) - 120;
      const x = col.x + ((k * 0.37 + 0.12) % 1) * col.w;
      c.beginPath();
      c.ellipse(x, y, 46 * col.s, 18 * col.s, 0, 0, Math.PI * 2);
      c.ellipse(x + 30 * col.s, y - 10 * col.s, 30 * col.s, 18 * col.s, 0, 0, Math.PI * 2);
      c.fill();
    }
    // the meadow's hills sink out of view as you climb
    const hy = CH - 60 * col.s + cam * 0.5;
    if (hy < CH + 40) {
      c.fillStyle = "#7fd36e";
      c.beginPath();
      c.ellipse(col.x + col.w * 0.25, hy + 40, col.w * 0.45, 80 * col.s, 0, Math.PI, 0);
      c.ellipse(col.x + col.w * 0.8, hy + 50, col.w * 0.4, 70 * col.s, 0, Math.PI, 0);
      c.fill();
    }
  } else if (th.decor === "mesas") {
    c.fillStyle = "rgba(255,240,200,0.85)";
    c.beginPath();
    c.arc(col.x + col.w * 0.7, 140, 40 * col.s, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = "rgba(150,52,60,0.35)";
    for (let k = 0; k < 3; k++) {
      const y = ((k * 300 + cam * 0.25) % band) - 60;
      const x = col.x + ((k * 0.41 + 0.05) % 1) * col.w;
      c.fillRect(x, y, 70 * col.s, 26 * col.s);
      c.fillRect(x + 10 * col.s, y + 26 * col.s, 50 * col.s, 60 * col.s);
    }
  } else if (th.decor === "crystals") {
    c.fillStyle = "rgba(160,230,255,0.22)";
    for (let k = 0; k < 4; k++) {
      const y = ((k * 240 + cam * 0.3) % band) - 60;
      const x = col.x + ((k * 0.29 + 0.1) % 1) * col.w;
      c.beginPath();
      c.moveTo(x, y - 40 * col.s); c.lineTo(x + 16 * col.s, y); c.lineTo(x, y + 40 * col.s); c.lineTo(x - 16 * col.s, y);
      c.fill();
    }
  } else {
    const y = ((cam * 0.12) % (CH + 300)) - 150;
    c.fillStyle = "#6b4bd1";
    c.beginPath();
    c.arc(col.x + col.w * 0.3, y, 48 * col.s, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = "rgba(255,200,120,0.8)";
    c.lineWidth = 4;
    c.beginPath();
    c.ellipse(col.x + col.w * 0.3, y, 80 * col.s, 16 * col.s, -0.3, 0, Math.PI * 2);
    c.stroke();
  }
}

function drawPlatform(c: CanvasRenderingContext2D, p: Platform, sx: number, sy: number, s: number, th: Theme) {
  const w = Math.min(p.w, COL_W * 2) * s, h = 16 * s;
  const x = sx - w / 2;
  if (p.kind === "breaking") {
    c.fillStyle = p.broken ? "rgba(140,100,60,0.6)" : KIND_TOP.breaking;
    if (p.broken) {
      rrect(c, x, sy, w / 2 - 3, h, 5); c.fill();
      rrect(c, x + w / 2 + 3, sy + 4, w / 2 - 3, h, 5); c.fill();
      return;
    }
    rrect(c, x, sy, w, h, 6); c.fill();
    c.strokeStyle = "#5e3b1c"; c.lineWidth = 2;
    c.beginPath();
    c.moveTo(x + w * 0.3, sy); c.lineTo(x + w * 0.38, sy + h * 0.6); c.lineTo(x + w * 0.33, sy + h);
    c.moveTo(x + w * 0.7, sy); c.lineTo(x + w * 0.62, sy + h * 0.5); c.lineTo(x + w * 0.68, sy + h);
    c.stroke();
    return;
  }
  c.fillStyle = th.body;
  rrect(c, x, sy + 4 * s, w, h, 6); c.fill();
  c.fillStyle = p.kind === "moving" ? KIND_TOP.moving : th.top;
  rrect(c, x, sy, w, h * 0.6, 6); c.fill();
  c.fillStyle = th.edge;
  c.fillRect(x + 6, sy + h * 0.6 - 2, w - 12, 2);
  if (p.kind === "moving") {
    c.fillStyle = "#ffffff";
    c.beginPath();
    c.moveTo(x + 8, sy + h * 0.3); c.lineTo(x + 16, sy + 1); c.lineTo(x + 16, sy + h * 0.6 - 1);
    c.moveTo(x + w - 8, sy + h * 0.3); c.lineTo(x + w - 16, sy + 1); c.lineTo(x + w - 16, sy + h * 0.6 - 1);
    c.fill();
  }
  if (p.kind === "spring") {
    const ext = (12 + p.boing * 14) * s;
    c.strokeStyle = "#e0e0e0"; c.lineWidth = 3 * s;
    c.beginPath();
    for (let k = 0; k <= 4; k++) c.lineTo(sx + (k % 2 ? 8 : -8) * s, sy - (ext * k) / 4);
    c.stroke();
    c.fillStyle = "#ff4d6d";
    rrect(c, sx - 14 * s, sy - ext - 6 * s, 28 * s, 7 * s, 3); c.fill();
  }
}

function drawPickup(c: CanvasRenderingContext2D, k: Pickup, sx: number, sy: number, s: number, t: number) {
  const bob = Math.sin(t * 3 + k.id) * 4 * s;
  if (k.kind === "gem") {
    const sw = Math.abs(Math.cos(t * 2.5 + k.id)) * 12 * s + 3;
    c.fillStyle = "#ffe14d";
    c.beginPath();
    c.moveTo(sx, sy - 15 * s + bob); c.lineTo(sx + sw, sy + bob); c.lineTo(sx, sy + 15 * s + bob); c.lineTo(sx - sw, sy + bob);
    c.fill();
    c.fillStyle = "rgba(255,255,255,0.7)";
    c.fillRect(sx - 2, sy - 9 * s + bob, 3, 6 * s);
    return;
  }
  c.fillStyle = "rgba(255,255,255,0.25)";
  c.beginPath(); c.arc(sx, sy + bob, 24 * s, 0, Math.PI * 2); c.fill();
  if (k.kind === "rocket") drawRocket(c, sx, sy + bob, s * 0.9, false);
  else {
    c.strokeStyle = "#7df9ff"; c.lineWidth = 4 * s;
    c.beginPath(); c.arc(sx, sy + bob, 16 * s, 0, Math.PI * 2); c.stroke();
    c.fillStyle = "#7df9ff";
    c.beginPath(); c.arc(sx - 5 * s, sy - 5 * s + bob, 4 * s, 0, Math.PI * 2); c.fill();
  }
}

function drawRocket(c: CanvasRenderingContext2D, x: number, y: number, s: number, flame: boolean) {
  if (flame) {
    c.fillStyle = Math.random() < 0.5 ? "#ffb703" : "#fb5607";
    c.beginPath(); c.moveTo(x - 8 * s, y + 10 * s); c.lineTo(x, y + (30 + Math.random() * 14) * s); c.lineTo(x + 8 * s, y + 10 * s); c.fill();
  }
  c.fillStyle = "#e63946";
  rrect(c, x - 9 * s, y - 14 * s, 18 * s, 26 * s, 6 * s); c.fill();
  c.fillStyle = "#f1faee";
  c.beginPath(); c.arc(x, y - 4 * s, 5 * s, 0, Math.PI * 2); c.fill();
}

function drawEnemy(c: CanvasRenderingContext2D, e: Enemy, sx: number, sy: number, s: number, t: number) {
  const r = e.r * s;
  if (e.kind === "spikeling") {
    c.fillStyle = "#3d1a5b";
    c.beginPath();
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2 + t * 1.5;
      const rr = k % 2 ? r : r * 1.45;
      c.lineTo(sx + Math.cos(a) * rr, sy + Math.sin(a) * rr);
    }
    c.fill();
    c.fillStyle = "#b5179e";
    c.beginPath(); c.arc(sx, sy, r * 0.8, 0, Math.PI * 2); c.fill();
  } else {
    c.fillStyle = "#38b000";
    const wob = Math.sin(t * 6 + e.id) * 3 * s;
    c.beginPath();
    c.arc(sx, sy, r, Math.PI, 0);
    c.lineTo(sx + r, sy + r * 0.7 + wob);
    c.quadraticCurveTo(sx + r * 0.5, sy + r * 0.3, sx, sy + r * 0.8 - wob);
    c.quadraticCurveTo(sx - r * 0.5, sy + r * 0.3, sx - r, sy + r * 0.7 + wob);
    c.fill();
    c.fillStyle = "rgba(255,255,255,0.35)";
    c.beginPath(); c.arc(sx - r * 0.4, sy - r * 0.4, r * 0.25, 0, Math.PI * 2); c.fill();
  }
  // angry eyes
  c.fillStyle = "#fff";
  c.beginPath(); c.arc(sx - r * 0.32, sy - r * 0.05, r * 0.24, 0, Math.PI * 2); c.arc(sx + r * 0.32, sy - r * 0.05, r * 0.24, 0, Math.PI * 2); c.fill();
  c.fillStyle = "#111";
  c.beginPath(); c.arc(sx - r * 0.28, sy, r * 0.11, 0, Math.PI * 2); c.arc(sx + r * 0.28, sy, r * 0.11, 0, Math.PI * 2); c.fill();
  c.strokeStyle = "#111"; c.lineWidth = 2;
  c.beginPath(); c.moveTo(sx - r * 0.55, sy - r * 0.4); c.lineTo(sx - r * 0.12, sy - r * 0.22); c.moveTo(sx + r * 0.55, sy - r * 0.4); c.lineTo(sx + r * 0.12, sy - r * 0.22); c.stroke();
}

/** "Boing", the hero: a round critter in the player's colour that squashes on every bounce. */
function drawHero(c: CanvasRenderingContext2D, h: Hero, sx: number, sy: number, s: number, color: string, t: number) {
  const sq = h.squash;
  const rx = HERO_R * s * (1 + 0.22 * sq), ry = HERO_R * s * (1 - 0.22 * sq);
  const cy = sy - ry;
  if (h.rocketT > 0) drawRocket(c, sx - h.face * 14 * s, cy + 4 * s, s * 0.8, true);
  c.fillStyle = "#1b1b2f";
  c.fillRect(sx - 9 * s, sy - 4 * s, 6 * s, 5 * s);
  c.fillRect(sx + 3 * s, sy - 4 * s, 6 * s, 5 * s);
  c.fillStyle = color;
  c.beginPath(); c.ellipse(sx, cy, rx, ry, h.stunned ? t * 12 : 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = "rgba(255,255,255,0.35)";
  c.beginPath(); c.ellipse(sx, cy + ry * 0.35, rx * 0.6, ry * 0.45, 0, 0, Math.PI * 2); c.fill();
  // antenna
  c.strokeStyle = color; c.lineWidth = 3 * s;
  c.beginPath(); c.moveTo(sx, cy - ry); c.quadraticCurveTo(sx + 6 * s * h.face, cy - ry - 10 * s, sx + 2 * s * h.face, cy - ry - 16 * s); c.stroke();
  c.fillStyle = "#ffe14d";
  c.beginPath(); c.arc(sx + 2 * s * h.face, cy - ry - 16 * s, 4 * s, 0, Math.PI * 2); c.fill();
  // eyes look where it is going
  const ex = h.face * 4 * s;
  c.fillStyle = "#fff";
  c.beginPath(); c.arc(sx - 6 * s + ex, cy - 4 * s, 6 * s, 0, Math.PI * 2); c.arc(sx + 6 * s + ex, cy - 4 * s, 6 * s, 0, Math.PI * 2); c.fill();
  c.fillStyle = "#111";
  if (h.stunned) {
    c.font = `bold ${Math.round(10 * s)}px system-ui`;
    c.textAlign = "center";
    c.fillText("x", sx - 6 * s + ex, cy - 1 * s);
    c.fillText("x", sx + 6 * s + ex, cy - 1 * s);
  } else {
    c.beginPath(); c.arc(sx - 5 * s + ex * 1.4, cy - 3 * s, 3 * s, 0, Math.PI * 2); c.arc(sx + 7 * s + ex * 1.4, cy - 3 * s, 3 * s, 0, Math.PI * 2); c.fill();
  }
  if (h.shieldT > 0) {
    const blink = h.shieldT < 2 && Math.floor(t * 8) % 2 === 0;
    if (!blink) {
      c.strokeStyle = "rgba(125,249,255,0.9)"; c.lineWidth = 3;
      c.fillStyle = "rgba(125,249,255,0.18)";
      c.beginPath(); c.arc(sx, cy, HERO_R * s * 1.7, 0, Math.PI * 2); c.fill(); c.stroke();
    }
  }
}

/** The x positions to draw something at: also on the other side when it straddles the column edge. */
const ALT = new Float64Array(2);
function alts(x: number, margin: number): number {
  ALT[0] = x;
  if (x < margin) { ALT[1] = x + COL_W; return 2; }
  if (x > COL_W - margin) { ALT[1] = x - COL_W; return 2; }
  return 1;
}

export function draw(c: CanvasRenderingContext2D, v: JumperView, worlds: World[]) {
  c.fillStyle = "#0b0820";
  c.fillRect(0, 0, CW, CH);
  for (let i = 0; i < worlds.length; i++) {
    const w = worlds[i]!, col = v.cols[i]!, s = col.s, th = THEMES[v.fade[i]!.to]!;
    const ox = col.x, oy = CH + w.camY * s; // screen = (ox + x*s, oy - y*s)
    c.save();
    c.beginPath(); c.rect(col.x, 0, col.w, CH); c.clip();
    drawBackground(c, v, i, w);
    const top = w.camY + col.viewH + 60, bottom = w.camY - 60;
    for (const p of w.platforms) {
      if (p.y < bottom || p.y > top) continue;
      for (let j = 0, n = alts(p.x, p.w / 2); j < n; j++) drawPlatform(c, p, ox + ALT[j]! * s, oy - p.y * s, s, th);
    }
    for (const k of w.pickups) {
      if (k.taken || k.y < bottom || k.y > top) continue;
      for (let j = 0, n = alts(k.x, 30); j < n; j++) drawPickup(c, k, ox + ALT[j]! * s, oy - k.y * s, s, v.time);
    }
    for (const e of w.enemies) {
      if (!e.alive || e.y < bottom || e.y > top) continue;
      for (let j = 0, n = alts(e.x, 40); j < n; j++) drawEnemy(c, e, ox + ALT[j]! * s, oy - e.y * s, s, v.time);
    }
    const h = w.hero;
    if (h.alive) for (let j = 0, n = alts(h.x, HERO_R * 2); j < n; j++) drawHero(c, h, ox + ALT[j]! * s, oy - h.y * s, s, v.colors[i]!, v.time);
    for (const p of v.particles) {
      if (!p.on || p.col !== i) continue;
      c.globalAlpha = 1 - p.t / p.life;
      c.fillStyle = p.c;
      c.fillRect(ox + p.x * s - p.r, oy - p.y * s - p.r, p.r * 2, p.r * 2);
    }
    c.globalAlpha = 1;
    c.textAlign = "center";
    for (const p of v.popups) {
      if (!p.on || p.col !== i) continue;
      c.globalAlpha = Math.max(0, 1 - p.t / 1.1);
      c.font = "bold 26px system-ui, sans-serif";
      c.fillStyle = "rgba(0,0,0,0.5)";
      c.fillText(p.text, ox + p.x * s + 2, oy - p.y * s - p.t * 60 + 2);
      c.fillStyle = p.c;
      c.fillText(p.text, ox + p.x * s, oy - p.y * s - p.t * 60);
    }
    c.globalAlpha = 1;
    const b = v.banners[i]!;
    if (b.t < 2.4 && b.text) {
      c.globalAlpha = Math.min(1, (2.4 - b.t) * 2);
      c.fillStyle = "rgba(0,0,0,0.45)";
      c.fillRect(col.x, CH * 0.36, col.w, 64);
      c.fillStyle = "#ffe14d";
      c.font = `bold ${col.w < 350 ? 28 : 36}px system-ui, sans-serif`;
      c.fillText(b.text, col.x + col.w / 2, CH * 0.36 + 44);
      c.globalAlpha = 1;
    }
    if (h.rocketT > 0) {
      c.fillStyle = "rgba(255,183,3,0.9)";
      c.fillRect(col.x + 10, CH - 14, (col.w - 20) * (h.rocketT / ROCKET_T), 6);
    }
    c.restore();
    c.strokeStyle = v.colors[i]!;
    c.lineWidth = 3;
    c.strokeRect(col.x + 1.5, 1.5, col.w - 3, CH - 3);
  }
}
