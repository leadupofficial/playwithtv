/**
 * Canvas 2D drawing for Motion Sumo on a 1280×720 stage: a raised clay platform with a rope ring that shrinks,
 * round wrestlers seen from above, a scoreboard on the left and round info on the right. The platform is
 * painted once into an offscreen canvas; wrestlers use pre-rendered badges. All art is drawn in code.
 */
import { BODY_R, RING_R, RING_X, RING_Y, type Bout, type Wrestler } from "./engine";

export const W = 1280, H = 720;
const FONT = "system-ui, 'Segoe UI', Roboto, sans-serif";
export const LITE = typeof navigator !== "undefined" && ((navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 8) <= 2;

export interface Look { name: string; color: string; emoji: string; cpu: boolean }
interface Burst { x: number; y: number; text: string; color: string; t: number; big: boolean }
export interface Banner { text: string; sub?: string; color: string; t: number; dur: number }

export interface View {
  bg: HTMLCanvasElement;
  looks: Map<string, Look>;
  badges: Map<string, HTMLCanvasElement>;
  bursts: Burst[];
  banner: Banner | null;
  shake: number;
  time: number;
  dust: Array<{ x: number; y: number; t: number }>;
}

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

function paintArena(sponsor?: string): HTMLCanvasElement {
  const [cv, c] = canvas(W, H);
  // hall floor: dark wooden boards
  c.fillStyle = "#1c1430";
  c.fillRect(0, 0, W, H);
  c.strokeStyle = "rgba(255,255,255,0.035)";
  c.lineWidth = 2;
  for (let y = 0; y < H; y += 36) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
  // raised clay platform
  const s = RING_R + 34;
  c.fillStyle = "rgba(0,0,0,0.45)";
  c.fillRect(RING_X - s + 10, RING_Y - s + 14, s * 2, s * 2);
  c.fillStyle = "#a8683a";
  c.fillRect(RING_X - s, RING_Y - s, s * 2, s * 2);
  c.fillStyle = "#c98a52";
  c.fillRect(RING_X - s + 10, RING_Y - s + 10, s * 2 - 20, s * 2 - 20);
  // danger zone (where the ring has shrunk away): cracked red clay
  c.fillStyle = "#9c3b2a";
  c.beginPath(); c.arc(RING_X, RING_Y, RING_R + 6, 0, 7); c.fill();
  c.strokeStyle = "rgba(0,0,0,0.25)";
  c.lineWidth = 3;
  let seed = 5;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 36; i++) {
    const a = rnd() * 6.28, r = 60 + rnd() * (RING_R - 60);
    c.beginPath();
    c.moveTo(RING_X + Math.cos(a) * r, RING_Y + Math.sin(a) * r);
    c.lineTo(RING_X + Math.cos(a + 0.08) * (r + 30), RING_Y + Math.sin(a + 0.08) * (r + 30));
    c.stroke();
  }
  // lanterns at the corners
  const lamps = ["#e2384d", "#2f8cff", "#23a55a", "#ffd23f"];
  [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([dx, dy], i) => {
    const x = RING_X + dx! * (s - 22), y = RING_Y + dy! * (s - 22);
    c.fillStyle = "rgba(255,220,140,0.12)";
    c.beginPath(); c.arc(x, y, 34, 0, 7); c.fill();
    c.fillStyle = lamps[i]!;
    c.beginPath(); c.arc(x, y, 16, 0, 7); c.fill();
    c.fillStyle = "rgba(255,255,255,0.5)";
    c.beginPath(); c.arc(x - 4, y - 5, 5, 0, 7); c.fill();
  });
  c.fillStyle = "#ffd23f";
  c.font = `900 30px ${FONT}`;
  c.textAlign = "left";
  c.fillText("MOTION SUMO", 24, 46);
  if (sponsor) {
    c.fillStyle = "#8f89b8";
    c.font = `600 16px ${FONT}`;
    c.textAlign = "right";
    c.fillText(`presented by ${sponsor}`.slice(0, 34), W - 20, H - 18);
  }
  return cv;
}

function badge(l: Look): HTMLCanvasElement {
  const [cv, c] = canvas(30, 30);
  c.font = `20px ${FONT}`;
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillText(l.emoji, 15, 16);
  return cv;
}

export function newView(looks: Map<string, Look>, sponsor?: string): View {
  const badges = new Map<string, HTMLCanvasElement>();
  for (const [id, l] of looks) badges.set(id, badge(l));
  return {
    bg: paintArena(sponsor), looks, badges, banner: null, shake: 0, time: 0,
    bursts: Array.from({ length: 12 }, () => ({ x: 0, y: 0, text: "", color: "#fff", t: 9, big: false })),
    dust: Array.from({ length: LITE ? 0 : 24 }, () => ({ x: 0, y: 0, t: 9 })),
  };
}

export function burst(v: View, x: number, y: number, text: string, color: string, big = false) {
  let b = v.bursts[0]!;
  for (const x2 of v.bursts) if (x2.t > b.t) b = x2;
  Object.assign(b, { x, y, text, color, t: 0, big });
}

export function puff(v: View, x: number, y: number) {
  let d = v.dust[0];
  if (!d) return;
  for (const x2 of v.dust) if (x2.t > d.t) d = x2;
  d.x = x; d.y = y; d.t = 0;
}

export function animate(v: View, dt: number) {
  v.time += dt;
  v.shake = Math.max(0, v.shake - dt * 30);
  for (const b of v.bursts) b.t += dt;
  for (const d of v.dust) d.t += dt;
  if (v.banner) {
    v.banner.t += dt;
    if (v.banner.t > v.banner.dur) v.banner = null;
  }
}

function text(c: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = "center", weight = 800) {
  c.font = `${weight} ${size}px ${FONT}`;
  c.textAlign = align;
  c.fillStyle = color;
  c.fillText(s, x, y);
}

function wrestler(c: CanvasRenderingContext2D, b: Bout, v: View, w: Wrestler) {
  const look = v.looks.get(w.id)!;
  let scale = 1;
  if (w.out) {
    if (w.outT > 1.2) return;
    scale = Math.max(0.2, 1 - w.outT * 0.7);
    c.globalAlpha = Math.max(0, 1 - w.outT * 0.8);
  }
  const R = BODY_R * scale;
  const fa = Math.atan2(w.fy, w.fx);
  c.fillStyle = "rgba(0,0,0,0.3)";
  c.beginPath(); c.ellipse(w.x + 4, w.y + 7, R * 1.05, R * 0.9, 0, 0, 7); c.fill();
  c.save();
  c.translate(w.x, w.y);
  c.rotate(fa);
  // body: a round belly in the player's colour, with a lighter highlight
  c.fillStyle = w.hitT > 0 ? "#fff" : look.color;
  c.beginPath(); c.arc(0, 0, R, 0, 7); c.fill();
  c.lineWidth = (w.bracing ? 8 : 4) * scale;
  c.strokeStyle = w.bracing ? "#7fe3ff" : shade(look.color, -70);
  c.stroke();
  c.fillStyle = "rgba(255,255,255,0.22)";
  c.beginPath(); c.arc(R * 0.2, -R * 0.15, R * 0.55, 0, 7); c.fill();
  // hands push forward during a shove
  const reach = w.dashT > 0 ? 18 : 2;
  c.fillStyle = "#f1c27d";
  c.strokeStyle = "#c98f4f";
  c.lineWidth = 2 * scale;
  for (const side of [-1, 1]) { c.beginPath(); c.arc(R * 0.6 + reach * scale, side * R * 0.68, 10 * scale, 0, 7); c.fill(); c.stroke(); }
  // head (seen from above): face to the front, hair and a little bun behind
  const hx = R * 0.12;
  c.fillStyle = "#f1c27d";
  c.beginPath(); c.arc(hx, 0, 14 * scale, 0, 7); c.fill();
  c.fillStyle = "#2b1d14";
  c.beginPath(); c.arc(hx, 0, 14 * scale, Math.PI / 2, Math.PI * 1.5); c.fill();
  c.beginPath(); c.arc(hx - 17 * scale, 0, 6 * scale, 0, 7); c.fill();
  c.beginPath(); c.arc(hx + 8 * scale, -5 * scale, 2.2 * scale, 0, 7); c.arc(hx + 8 * scale, 5 * scale, 2.2 * scale, 0, 7); c.fill();
  c.restore();
  c.globalAlpha = 1;
  if (w.out) return;
  // stamina ring
  if (w.stamina < 99) {
    c.strokeStyle = w.stamina < 30 ? "#ff5d73" : "#ffd23f";
    c.lineWidth = 5;
    c.beginPath(); c.arc(w.x, w.y, R + 8, -Math.PI / 2, -Math.PI / 2 + (w.stamina / 100) * Math.PI * 2); c.stroke();
  }
  c.drawImage(v.badges.get(w.id)!, w.x - 15, w.y - R - 40);
  c.font = `800 17px ${FONT}`;
  c.textAlign = "center";
  c.lineWidth = 4;
  c.strokeStyle = "#1a1238";
  c.strokeText(look.name.slice(0, 10), w.x, w.y + R + 22);
  c.fillStyle = "#fff";
  c.fillText(look.name.slice(0, 10), w.x, w.y + R + 22);
}

function scoreboard(c: CanvasRenderingContext2D, b: Bout, v: View) {
  const n = b.wrestlers.length;
  const rowH = Math.min(70, 600 / n);
  b.wrestlers.forEach((w, i) => {
    const look = v.looks.get(w.id)!;
    const y = 74 + i * rowH;
    c.fillStyle = w.out ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.08)";
    c.beginPath(); c.roundRect(16, y, 262, rowH - 8, 10); c.fill();
    c.fillStyle = look.color;
    c.beginPath(); c.arc(42, y + (rowH - 8) / 2, 16, 0, 7); c.fill();
    c.drawImage(v.badges.get(w.id)!, 27, y + (rowH - 8) / 2 - 15);
    text(c, look.name.slice(0, 10), 68, y + rowH * 0.48, 19, w.out ? "#8f89b8" : "#fff", "left", 700);
    let pips = "";
    for (let k = 0; k < b.toWin; k++) pips += k < w.wins ? "● " : "○ ";
    text(c, pips, 68, y + rowH * 0.8, 15, "#ffd23f", "left", 700);
    if (w.out && b.phase !== "intro") text(c, "OUT", 266, y + rowH * 0.6, 17, "#ff5d73", "right", 900);
  });
}

export function draw(c: CanvasRenderingContext2D, b: Bout, v: View) {
  const sx = v.shake ? (Math.random() - 0.5) * v.shake : 0, sy = v.shake ? (Math.random() - 0.5) * v.shake : 0;
  c.save();
  c.translate(sx, sy);
  c.drawImage(v.bg, 0, 0);
  // the ring as it is now: sand inside, rope on the edge
  c.fillStyle = "#e7c189";
  c.beginPath(); c.arc(RING_X, RING_Y, b.ring, 0, 7); c.fill();
  c.strokeStyle = "rgba(255,255,255,0.18)";
  c.lineWidth = 3;
  c.beginPath(); c.arc(RING_X, RING_Y, b.ring * 0.62, 0, 7); c.stroke();
  c.fillStyle = "rgba(255,255,255,0.14)";
  c.beginPath(); c.arc(RING_X, RING_Y, 26, 0, 7); c.fill();
  c.strokeStyle = "#f6e7bd";
  c.lineWidth = 12;
  c.beginPath(); c.arc(RING_X, RING_Y, b.ring, 0, 7); c.stroke();
  c.strokeStyle = "#8a6a3a";
  c.lineWidth = 12;
  c.setLineDash([3, 15]);
  c.lineDashOffset = b.ring < RING_R ? v.time * 30 : 0;
  c.beginPath(); c.arc(RING_X, RING_Y, b.ring, 0, 7); c.stroke();
  c.setLineDash([]);
  for (const d of v.dust) {
    if (d.t > 0.5) continue;
    c.fillStyle = `rgba(240,220,180,${0.5 - d.t})`;
    c.beginPath(); c.arc(d.x, d.y, 10 + d.t * 50, 0, 7); c.fill();
  }
  for (const w of b.wrestlers) if (w.out) wrestler(c, b, v, w);
  for (const w of b.wrestlers) if (!w.out) wrestler(c, b, v, w);
  for (const x of v.bursts) {
    if (x.t > 1) continue;
    c.globalAlpha = 1 - x.t;
    c.font = `900 ${x.big ? 40 : 26}px ${FONT}`;
    c.textAlign = "center";
    c.lineWidth = 6;
    c.strokeStyle = "#1a1238";
    c.strokeText(x.text, x.x, x.y - x.t * 50);
    c.fillStyle = x.color;
    c.fillText(x.text, x.x, x.y - x.t * 50);
    c.globalAlpha = 1;
  }
  c.restore();
  scoreboard(c, b, v);
  text(c, `ROUND ${b.round}`, W - 140, 60, 34, "#fff");
  text(c, b.toWin > 1 ? `first to ${b.toWin} wins` : "one round", W - 140, 90, 18, "#b9b4dd", "center", 600);
  const left = b.wrestlers.filter((w) => !w.out).length;
  text(c, `${left} in the ring`, W - 140, 140, 22, "#ffd23f");
  if (b.phase === "fight" && b.ring < RING_R) text(c, "⚠ RING SHRINKING", W - 140, 180, 20, "#ff5d73");
  const bn = v.banner;
  if (bn) {
    c.globalAlpha = Math.max(0, Math.min(1, bn.t * 5, (bn.dur - bn.t) * 3));
    c.save();
    c.translate(RING_X, RING_Y);
    c.font = `900 96px ${FONT}`;
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.lineWidth = 12;
    c.strokeStyle = "#1a1238";
    c.strokeText(bn.text, 0, 0);
    c.fillStyle = bn.color;
    c.fillText(bn.text, 0, 0);
    if (bn.sub) {
      c.font = `800 38px ${FONT}`;
      c.lineWidth = 8;
      c.strokeText(bn.sub, 0, 78);
      c.fillStyle = "#fff";
      c.fillText(bn.sub, 0, 78);
    }
    c.restore();
    c.globalAlpha = 1;
  }
}
