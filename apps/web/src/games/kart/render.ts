/**
 * Canvas 2D drawing for Kart Knockout on a 1280×720 stage. The circuit (scenery, walls, kerbs, road) is painted
 * once into an offscreen canvas; each frame copies it and draws karts and items from pre-rendered sprites, so
 * a frame does no allocation-heavy work (fine for 1 GB TVs). Everything is drawn in code: no image assets.
 */
import { DRIFT_T1, DRIFT_T2, KART_R, placeOf, type Race } from "./engine";
import type { Track } from "./track";
import { ITEM_ICON } from "./items";

export const W = 1280, H = 720, PANEL_X = 1052;
export const LITE = typeof navigator !== "undefined" && ((navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 8) <= 2;
const FONT = "system-ui, 'Segoe UI', Roboto, sans-serif";

export interface KartLook { name: string; color: string; emoji: string; cpu: boolean }
interface Spark { x: number; y: number; vx: number; vy: number; life: number; color: string }
interface Burst { x: number; y: number; text: string; color: string; t: number }
export interface Banner { text: string; sub?: string; color: string; t: number; dur: number }

export interface View {
  bg: HTMLCanvasElement;
  looks: Map<string, KartLook>;
  sprites: Map<string, HTMLCanvasElement>;
  badges: Map<string, HTMLCanvasElement>;
  box: HTMLCanvasElement;
  slick: HTMLCanvasElement;
  nut: HTMLCanvasElement;
  sparks: Spark[];
  bursts: Burst[];
  banner: Banner | null;
  time: number;
  sponsor?: string;
}

const THEMES = {
  grove: { outside: "#2f6b2a", verge: "#7cc152", stripe: "#86ca5b", barrier: "#e9e4d4", deco: "tree" },
  harbour: { outside: "#1f6fa8", verge: "#e6cf8f", stripe: "#dcc37f", barrier: "#7a4b2a", deco: "boat" },
  park: { outside: "#3f8a3a", verge: "#8fd16a", stripe: "#9ad874", barrier: "#f4f4f4", deco: "flower" },
} as const;

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!];
}

function shade(hex: string, amt: number) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v + amt)));
  return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

function loop(c: CanvasRenderingContext2D, t: Track) {
  c.beginPath();
  c.moveTo(t.xs[0]!, t.ys[0]!);
  for (let i = 1; i < t.n; i++) c.lineTo(t.xs[i]!, t.ys[i]!);
  c.closePath();
}

function stroke(c: CanvasRenderingContext2D, t: Track, width: number, color: string, dash?: number[]) {
  loop(c, t);
  c.lineWidth = width;
  c.strokeStyle = color;
  c.setLineDash(dash ?? []);
  c.stroke();
  c.setLineDash([]);
}

/** Distance from (x, y) to the nearest centre-line sample (used only while painting scenery). */
function clearance(t: Track, x: number, y: number) {
  let best = Infinity;
  for (let i = 0; i < t.n; i += 2) best = Math.min(best, Math.hypot(x - t.xs[i]!, y - t.ys[i]!));
  return best;
}

function scenery(c: CanvasRenderingContext2D, t: Track, kind: "tree" | "boat" | "flower") {
  let s = 99;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let n = 0; n < 900; n++) {
    const x = rnd() * (PANEL_X - 10), y = rnd() * H;
    const room = clearance(t, x, y) - t.wall;
    if (room < 22) continue;
    if (kind === "tree") {
      const r = 12 + rnd() * 10;
      c.fillStyle = "rgba(0,0,0,0.22)";
      c.beginPath(); c.arc(x + 5, y + 6, r, 0, 7); c.fill();
      c.fillStyle = rnd() < 0.5 ? "#2b8a3e" : "#237a35";
      c.beginPath(); c.arc(x, y, r, 0, 7); c.fill();
      c.fillStyle = "#3aa64f";
      c.beginPath(); c.arc(x - r * 0.3, y - r * 0.3, r * 0.5, 0, 7); c.fill();
      if (rnd() < 0.6) {
        c.fillStyle = "#ffb020";
        for (let m = 0; m < 3; m++) { c.beginPath(); c.arc(x + (rnd() - 0.5) * r, y + (rnd() - 0.5) * r, 3, 0, 7); c.fill(); }
      }
      n += 6;
    } else if (kind === "boat") {
      if (rnd() < 0.75) {
        c.strokeStyle = "rgba(255,255,255,0.35)";
        c.lineWidth = 2;
        c.beginPath(); c.arc(x, y, 8, Math.PI * 1.1, Math.PI * 1.9); c.stroke();
        continue;
      }
      if (room < 40) continue;
      const a = rnd() * 6.28;
      c.save(); c.translate(x, y); c.rotate(a);
      c.fillStyle = "rgba(0,0,0,0.25)"; c.beginPath(); c.ellipse(3, 4, 22, 9, 0, 0, 7); c.fill();
      c.fillStyle = ["#e2384d", "#ffd23f", "#f4f4f4"][Math.floor(rnd() * 3)]!;
      c.beginPath(); c.moveTo(-20, -8); c.lineTo(14, -8); c.lineTo(24, 0); c.lineTo(14, 8); c.lineTo(-20, 8); c.closePath(); c.fill();
      c.fillStyle = "#7a4b2a"; c.fillRect(-12, -5, 14, 10);
      c.restore();
      n += 20;
    } else {
      const col = ["#ff6fb5", "#ffd23f", "#ffffff", "#ff7a59", "#b98cff"][Math.floor(rnd() * 5)]!;
      for (let m = 0; m < 5; m++) {
        c.fillStyle = col;
        c.beginPath(); c.arc(x + (rnd() - 0.5) * 26, y + (rnd() - 0.5) * 26, 3.5, 0, 7); c.fill();
      }
      if (rnd() < 0.15 && room > 40) {
        c.fillStyle = "rgba(0,0,0,0.2)"; c.beginPath(); c.arc(x + 5, y + 6, 18, 0, 7); c.fill();
        c.fillStyle = "#2f7d32"; c.beginPath(); c.arc(x, y, 18, 0, 7); c.fill();
      }
      n += 4;
    }
  }
}

function paintTrack(t: Track, sponsor?: string): HTMLCanvasElement {
  const [cv, c] = canvas(W, H);
  const th = THEMES[t.def.theme];
  c.lineJoin = "round";
  c.lineCap = "round";
  c.fillStyle = th.outside;
  c.fillRect(0, 0, W, H);
  scenery(c, t, th.deco);
  // wall, verge (with mown stripes), kerbs, road
  stroke(c, t, t.wall * 2 + 12, "rgba(0,0,0,0.25)");
  stroke(c, t, t.wall * 2 + 8, th.barrier);
  stroke(c, t, t.wall * 2 + 8, "#e2384d", [10, 10]);
  stroke(c, t, t.wall * 2, th.verge);
  stroke(c, t, t.wall * 2 - 14, th.stripe, [22, 22]);
  stroke(c, t, t.hw * 2 + 10, "#ffffff");
  stroke(c, t, t.hw * 2 + 10, "#e2384d", [16, 16]);
  stroke(c, t, t.hw * 2, "#4a4d5a");
  stroke(c, t, t.hw * 2 - 18, "#525564");
  stroke(c, t, 3, "rgba(255,255,255,0.35)", [18, 22]);
  // start/finish: a chequered band across the road at sample 0
  const nx = -t.ty[0]!, ny = t.tx[0]!;
  c.save();
  c.translate(t.xs[0]!, t.ys[0]!);
  c.rotate(Math.atan2(ny, nx));
  const cells = 8, cw = (t.hw * 2) / cells;
  for (let i = 0; i < cells; i++) {
    for (let j = 0; j < 2; j++) {
      c.fillStyle = (i + j) % 2 ? "#111" : "#fff";
      c.fillRect(-t.hw + i * cw, -cw + j * cw, cw, cw);
    }
  }
  c.restore();
  // speed pads: glowing chevrons
  for (const p of t.pads) {
    c.save();
    c.translate(p.x, p.y);
    c.rotate(p.a);
    c.fillStyle = "#1fb6ff";
    c.beginPath();
    c.roundRect(-20, -15, 40, 30, 6);
    c.fill();
    c.fillStyle = "#e8fbff";
    for (const o of [-10, 2]) {
      c.beginPath(); c.moveTo(o, -10); c.lineTo(o + 10, 0); c.lineTo(o, 10); c.lineTo(o + 5, 10); c.lineTo(o + 15, 0); c.lineTo(o + 5, -10); c.closePath(); c.fill();
    }
    c.restore();
  }
  // standings panel
  c.fillStyle = "#14112b";
  c.fillRect(PANEL_X, 0, W - PANEL_X, H);
  c.fillStyle = "#2a2450";
  c.fillRect(PANEL_X, 0, 4, H);
  c.fillStyle = "#ffd23f";
  c.font = `900 26px ${FONT}`;
  c.textAlign = "center";
  c.fillText("KART KNOCKOUT", (PANEL_X + W) / 2, 40);
  c.fillStyle = "#b9b4dd";
  c.font = `600 17px ${FONT}`;
  c.fillText(t.def.name, (PANEL_X + W) / 2, 64);
  if (sponsor) {
    c.fillStyle = "#8f89b8";
    c.font = `600 15px ${FONT}`;
    c.fillText(`presented by ${sponsor}`.slice(0, 30), (PANEL_X + W) / 2, H - 18);
  }
  return cv;
}

function kartSprite(color: string): HTMLCanvasElement {
  const [cv, c] = canvas(48, 36);
  c.translate(24, 18);
  c.fillStyle = "#15151c";
  for (const [x, y] of [[-12, -15], [-12, 9], [7, -14], [7, 8]]) { c.beginPath(); c.roundRect(x!, y!, 10, 6, 2); c.fill(); }
  c.fillStyle = shade(color, -70);
  c.beginPath(); c.roundRect(-19, -12, 6, 24, 2); c.fill();               // rear wing
  c.fillStyle = color;
  c.beginPath(); c.moveTo(-15, -10); c.lineTo(10, -9); c.quadraticCurveTo(21, -6, 21, 0); c.quadraticCurveTo(21, 6, 10, 9); c.lineTo(-15, 10); c.closePath(); c.fill();
  c.strokeStyle = shade(color, -60); c.lineWidth = 2; c.stroke();
  c.fillStyle = shade(color, 60);
  c.beginPath(); c.roundRect(4, -4, 12, 8, 3); c.fill();                   // nose stripe
  c.fillStyle = "#f4f4f4";
  c.beginPath(); c.arc(-5, 0, 7, 0, 7); c.fill();                         // helmet
  c.fillStyle = "#1d2a4a";
  c.beginPath(); c.ellipse(-2, 0, 3, 5, 0, 0, 7); c.fill();               // visor
  return cv;
}

function badge(look: KartLook): HTMLCanvasElement {
  const [cv, c] = canvas(34, 34);
  c.fillStyle = look.color;
  c.beginPath(); c.arc(17, 17, 15, 0, 7); c.fill();
  c.strokeStyle = "#fff"; c.lineWidth = 2.5; c.stroke();
  c.font = `18px ${FONT}`;
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillText(look.emoji, 17, 18);
  return cv;
}

function sprites() {
  const [box, b] = canvas(30, 30);
  b.fillStyle = "#ff4fa3"; b.beginPath(); b.roundRect(2, 2, 26, 26, 6); b.fill();
  b.fillStyle = "#ffd23f"; b.fillRect(12, 2, 6, 26); b.fillRect(2, 12, 26, 6);
  b.strokeStyle = "#fff"; b.lineWidth = 2; b.beginPath(); b.roundRect(2, 2, 26, 26, 6); b.stroke();
  const [slick, s] = canvas(44, 44);
  s.fillStyle = "rgba(170,230,255,0.85)";
  for (const [x, y, r] of [[22, 22, 15], [12, 18, 9], [32, 26, 10], [20, 32, 8]]) { s.beginPath(); s.arc(x!, y!, r!, 0, 7); s.fill(); }
  s.strokeStyle = "#fff"; s.lineWidth = 1.5;
  for (const [x, y, r] of [[17, 17, 4], [28, 21, 3], [22, 29, 2.5]]) { s.beginPath(); s.arc(x!, y!, r!, 0, 7); s.stroke(); }
  const [nut, n] = canvas(22, 22);
  n.fillStyle = "#6b3f1f"; n.beginPath(); n.arc(11, 11, 10, 0, 7); n.fill();
  n.fillStyle = "#3b220f";
  for (const [x, y] of [[8, 8], [14, 8], [11, 14]]) { n.beginPath(); n.arc(x!, y!, 2, 0, 7); n.fill(); }
  return { box, slick, nut };
}

export function newView(r: Race, looks: Map<string, KartLook>, sponsor?: string): View {
  const sp = new Map<string, HTMLCanvasElement>(), bd = new Map<string, HTMLCanvasElement>();
  for (const [id, l] of looks) { sp.set(id, kartSprite(l.color)); bd.set(id, badge(l)); }
  const pool = (n: number) => Array.from({ length: n }, () => ({ x: 0, y: 0, vx: 0, vy: 0, life: 0, color: "#fff" }));
  return {
    bg: paintTrack(r.track, sponsor), looks, sprites: sp, badges: bd, ...sprites(), sparks: pool(LITE ? 0 : 140),
    bursts: Array.from({ length: 12 }, () => ({ x: 0, y: 0, text: "", color: "#fff", t: 9 })), banner: null, time: 0, sponsor,
  };
}

export function burst(v: View, x: number, y: number, text: string, color: string) {
  let b = v.bursts[0]!;
  for (const x2 of v.bursts) if (x2.t > b.t) b = x2;
  b.x = x; b.y = y; b.text = text; b.color = color; b.t = 0;
}

function spark(v: View, x: number, y: number, color: string) {
  for (const s of v.sparks) {
    if (s.life > 0) continue;
    s.x = x; s.y = y; s.vx = (Math.random() - 0.5) * 90; s.vy = (Math.random() - 0.5) * 90; s.life = 0.35; s.color = color;
    return;
  }
}

/** Particles and floating words (visual only). */
export function animate(v: View, r: Race, dt: number) {
  v.time += dt;
  if (v.banner) {
    v.banner.t += dt;
    if (v.banner.t > v.banner.dur) v.banner = null;
  }
  for (const b of v.bursts) b.t += dt;
  for (const s of v.sparks) {
    if (s.life <= 0) continue;
    s.life -= dt; s.x += s.vx * dt; s.y += s.vy * dt;
  }
  if (LITE) return;
  for (const k of r.karts) {
    const bx = k.x - Math.cos(k.a) * 14, by = k.y - Math.sin(k.a) * 14;
    if (k.drift && k.driftT >= DRIFT_T1) spark(v, bx, by, k.driftT >= DRIFT_T2 ? "#ffb020" : "#5fd0ff");
    if (k.boostT > 0 && Math.random() < 0.6) spark(v, bx, by, "#ff7a00");
  }
}

function text(c: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = "center", weight = 800) {
  c.font = `${weight} ${size}px ${FONT}`;
  c.textAlign = align;
  c.fillStyle = color;
  c.fillText(s, x, y);
}

const ORD = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th"];

function panel(c: CanvasRenderingContext2D, r: Race, v: View) {
  const lead = r.order[0]!;
  const lap = Math.min(r.laps, lead.lap + 1);
  text(c, r.phase === "done" ? "FINISHED" : `LAP ${lap} / ${r.laps}`, (PANEL_X + W) / 2, 102, 26, "#fff");
  const rowH = Math.min(72, 560 / r.karts.length);
  r.order.forEach((k, i) => {
    const y = 124 + i * rowH;
    const look = v.looks.get(k.id)!;
    c.fillStyle = i % 2 ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.08)";
    c.fillRect(PANEL_X + 10, y, W - PANEL_X - 18, rowH - 6);
    c.fillStyle = look.color;
    c.fillRect(PANEL_X + 10, y, 6, rowH - 6);
    text(c, String(i + 1), PANEL_X + 34, y + rowH * 0.62, 26, i === 0 ? "#ffd23f" : "#fff");
    c.drawImage(v.badges.get(k.id)!, PANEL_X + 50, y + (rowH - 6) / 2 - 17);
    text(c, look.name.slice(0, 11), PANEL_X + 90, y + rowH * 0.45, 17, "#fff", "left", 700);
    const sub = k.finishedAt !== null ? `🏁 ${k.finishedAt.toFixed(1)}s` : `lap ${Math.min(r.laps, k.lap + 1)}/${r.laps}`;
    text(c, sub, PANEL_X + 90, y + rowH * 0.8, 15, "#b9b4dd", "left", 600);
    if (k.item) text(c, k.rollT > 0 ? "🎁" : ITEM_ICON[k.item], W - 18, y + rowH * 0.62, 22, "#fff", "right", 400);
  });
}

function drawKart(c: CanvasRenderingContext2D, r: Race, v: View, id: string) {
  const k = r.karts.find((x) => x.id === id)!;
  const hop = k.hopT > 0 ? Math.sin((k.hopT / 0.2) * Math.PI) * 6 : 0;
  c.fillStyle = "rgba(0,0,0,0.3)";
  c.beginPath(); c.ellipse(k.x + 3, k.y + 4, 19, 13, k.a, 0, 7); c.fill();
  c.save();
  c.translate(k.x, k.y - hop);
  c.rotate(k.a + (k.drift ? k.drift * 0.35 : 0));
  if (k.boostT > 0) {
    const f = 10 + Math.sin(v.time * 60) * 4;
    c.fillStyle = "#ffb020";
    c.beginPath(); c.moveTo(-18, -6); c.lineTo(-18 - f - 8, 0); c.lineTo(-18, 6); c.closePath(); c.fill();
    c.fillStyle = "#fff4b0";
    c.beginPath(); c.moveTo(-18, -3); c.lineTo(-18 - f, 0); c.lineTo(-18, 3); c.closePath(); c.fill();
  }
  c.drawImage(v.sprites.get(k.id)!, -24, -18);
  c.restore();
  if (k.shieldT > 0) {
    c.strokeStyle = `rgba(120,230,255,${0.55 + Math.sin(v.time * 12) * 0.3})`;
    c.lineWidth = 4;
    c.beginPath(); c.arc(k.x, k.y - hop, KART_R + 11, 0, 7); c.stroke();
  }
  c.drawImage(v.badges.get(k.id)!, k.x - 17, k.y - hop - 50);
  if (r.karts.length > 1 && k.finishedAt === null) {
    c.font = `900 15px ${FONT}`;
    c.textAlign = "center";
    c.lineWidth = 4;
    c.strokeStyle = "#000";
    const p = ORD[placeOf(r, k.id) - 1] ?? "";
    c.strokeText(p, k.x, k.y - hop - 54);
    c.fillStyle = "#fff";
    c.fillText(p, k.x, k.y - hop - 54);
  }
}

export function draw(c: CanvasRenderingContext2D, r: Race, v: View) {
  c.drawImage(v.bg, 0, 0);
  const bob = Math.sin(v.time * 4) * 2;
  for (const b of r.boxes) {
    if (b.t > 0) continue;
    c.save(); c.translate(b.x, b.y + bob); c.rotate(v.time * 1.5); c.drawImage(v.box, -15, -15); c.restore();
  }
  for (const p of r.puddles) if (p.on) c.drawImage(v.slick, p.x - 22, p.y - 22);
  for (const b of r.balls) {
    if (!b.on) continue;
    c.save(); c.translate(b.x, b.y); c.rotate(v.time * 14); c.drawImage(v.nut, -11, -11); c.restore();
  }
  for (const s of v.sparks) {
    if (s.life <= 0) continue;
    c.fillStyle = s.color;
    c.fillRect(s.x - 2, s.y - 2, 4, 4);
  }
  // back of the pack first, so the leader is drawn on top
  for (let i = r.order.length - 1; i >= 0; i--) drawKart(c, r, v, r.order[i]!.id);
  for (const b of v.bursts) {
    if (b.t > 1) continue;
    c.globalAlpha = 1 - b.t;
    c.lineWidth = 5;
    c.strokeStyle = "#000";
    c.font = `900 24px ${FONT}`;
    c.textAlign = "center";
    c.strokeText(b.text, b.x, b.y - b.t * 40);
    c.fillStyle = b.color;
    c.fillText(b.text, b.x, b.y - b.t * 40);
    c.globalAlpha = 1;
  }
  panel(c, r, v);
  if (r.phase === "countdown") {
    const n = Math.ceil(r.countdown);
    big(c, String(n), "#ffd23f", 1 - (r.countdown - Math.floor(r.countdown)));
  }
  const bn = v.banner;
  if (bn) {
    const fade = Math.min(1, bn.t * 5, (bn.dur - bn.t) * 3);
    c.globalAlpha = Math.max(0, fade);
    big(c, bn.text, bn.color, 0, bn.sub);
    c.globalAlpha = 1;
  }
}

function big(c: CanvasRenderingContext2D, s: string, color: string, pop: number, sub?: string) {
  const x = PANEL_X / 2, y = H / 2;
  c.save();
  c.translate(x, y);
  c.scale(1 + pop * 0.3, 1 + pop * 0.3);
  c.font = `900 120px ${FONT}`;
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.lineWidth = 12;
  c.strokeStyle = "#1a1238";
  c.strokeText(s, 0, 0);
  c.fillStyle = color;
  c.fillText(s, 0, 0);
  if (sub) {
    c.font = `800 40px ${FONT}`;
    c.lineWidth = 8;
    c.strokeText(sub, 0, 90);
    c.fillStyle = "#fff";
    c.fillText(sub, 0, 90);
  }
  c.restore();
}
