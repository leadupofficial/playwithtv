import { H, W, type Blade, type Round, type TargetKind } from "./engine";

/**
 * Canvas drawing for Motion Blade Trial on a 1280x720 stage. The courtyard and every target are painted once
 * into offscreen canvases (sprites), then each frame only copies them: cheap on low-end TVs. Effects are pooled.
 */
const LITE = typeof navigator !== "undefined" && ((navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 8) <= 2;
const TRAIL = 10;

const JUICE: Record<TargetKind, string> = { plum: "#c77dff", lemon: "#ffe14d", gourd: "#80ed99", lantern: "#ff5d5d", golden: "#ffd166", bomb: "#999999" };

interface Half { on: boolean; kind: TargetKind; x: number; y: number; vx: number; vy: number; rot: number; spin: number; side: number; t: number }
interface Spark { on: boolean; x: number; y: number; vx: number; vy: number; t: number; life: number; c: string; r: number }
interface Streak { on: boolean; x1: number; y1: number; x2: number; y2: number; t: number; c: string }
interface Pop { on: boolean; x: number; y: number; t: number; text: string; c: string; big: boolean }

export interface BladeView {
  bg: HTMLCanvasElement;
  sprites: Record<TargetKind, HTMLCanvasElement>;
  colors: string[];
  trails: Float32Array[]; // per blade: TRAIL points (x, y), newest first
  halves: Half[];
  sparks: Spark[];
  streaks: Streak[];
  pops: Pop[];
  flash: number;
  shake: number;
  time: number;
}

function sprite(size: number, paint: (c: CanvasRenderingContext2D, r: number) => void) {
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const c = cv.getContext("2d")!;
  c.translate(size / 2, size / 2);
  paint(c, size / 2);
  return cv;
}

function glow(c: CanvasRenderingContext2D, r: number, color: string) {
  if (LITE) return;
  const g = c.createRadialGradient(0, 0, r * 0.3, 0, 0, r);
  g.addColorStop(0, color);
  g.addColorStop(1, "rgba(0,0,0,0)");
  c.fillStyle = g;
  c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.fill();
}

function orb(c: CanvasRenderingContext2D, r: number, dark: string, light: string) {
  const g = c.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.1, 0, 0, r);
  g.addColorStop(0, light);
  g.addColorStop(1, dark);
  c.fillStyle = g;
  c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.fill();
  c.fillStyle = "rgba(255,255,255,0.55)";
  c.beginPath(); c.ellipse(-r * 0.35, -r * 0.4, r * 0.22, r * 0.12, -0.6, 0, Math.PI * 2); c.fill();
}

function leaf(c: CanvasRenderingContext2D, x: number, y: number, s: number, color: string) {
  c.fillStyle = color;
  c.beginPath(); c.ellipse(x, y, s, s * 0.45, -0.5, 0, Math.PI * 2); c.fill();
}

function makeSprites(): Record<TargetKind, HTMLCanvasElement> {
  return {
    plum: sprite(128, (c) => { glow(c, 64, "rgba(199,125,255,0.45)"); orb(c, 42, "#5a189a", "#e0aaff"); leaf(c, 10, -40, 13, "#52b788"); }),
    lemon: sprite(128, (c) => {
      glow(c, 64, "rgba(255,225,77,0.4)");
      c.save(); c.scale(1.2, 0.9); orb(c, 38, "#e09f3e", "#fff3b0"); c.restore();
      c.fillStyle = "#e09f3e"; c.beginPath(); c.arc(46, 0, 6, 0, Math.PI * 2); c.arc(-46, 0, 6, 0, Math.PI * 2); c.fill();
    }),
    gourd: sprite(128, (c) => {
      glow(c, 64, "rgba(128,237,153,0.4)");
      c.save(); c.translate(0, 12); orb(c, 34, "#1b4332", "#95d5b2"); c.restore();
      c.save(); c.translate(0, -24); orb(c, 22, "#1b4332", "#b7e4c7"); c.restore();
      c.fillStyle = "#6f4518"; c.fillRect(-3, -54, 6, 12);
    }),
    lantern: sprite(128, (c) => {
      glow(c, 64, "rgba(255,93,93,0.5)");
      c.save(); c.scale(1, 1.15); orb(c, 38, "#9d0208", "#ffba08"); c.restore();
      c.strokeStyle = "rgba(120,0,0,0.6)"; c.lineWidth = 2;
      for (const k of [-0.55, 0, 0.55]) { c.beginPath(); c.ellipse(0, 0, 38 * Math.abs(k) + 4, 43, 0, 0, Math.PI * 2); c.stroke(); }
      c.fillStyle = "#ffd166"; c.fillRect(-16, -50, 32, 8); c.fillRect(-16, 42, 32, 8);
    }),
    golden: sprite(144, (c) => {
      glow(c, 72, "rgba(255,209,102,0.7)");
      for (let k = 0; k < 8; k++) {
        c.save(); c.rotate((k / 8) * Math.PI * 2);
        const g = c.createLinearGradient(0, 0, 0, -44);
        g.addColorStop(0, "#ffb703"); g.addColorStop(1, "#fff1c1");
        c.fillStyle = g;
        c.beginPath(); c.ellipse(0, -24, 12, 24, 0, 0, Math.PI * 2); c.fill();
        c.restore();
      }
      orb(c, 16, "#e85d04", "#ffea00");
    }),
    bomb: sprite(128, (c) => {
      c.fillStyle = "#2b2d42";
      c.beginPath();
      for (let k = 0; k < 20; k++) {
        const a = (k / 20) * Math.PI * 2, rr = k % 2 ? 36 : 50;
        c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      c.fill();
      orb(c, 33, "#14151f", "#5c5f7a");
      c.fillStyle = "#ff1744"; c.beginPath(); c.arc(0, 0, 9, 0, Math.PI * 2); c.fill();
      c.strokeStyle = "#ff1744"; c.lineWidth = 3;
      c.beginPath(); c.moveTo(-14, -14); c.lineTo(14, 14); c.moveTo(14, -14); c.lineTo(-14, 14); c.stroke();
    }),
  };
}

/** The courtyard at dusk: sky, moon, distant hills, a lantern string and a wooden deck. Painted once. */
function makeBackground(sponsor?: string) {
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const c = cv.getContext("2d")!;
  const sky = c.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, "#10002b"); sky.addColorStop(0.55, "#3c096c"); sky.addColorStop(1, "#ff7b54");
  c.fillStyle = sky; c.fillRect(0, 0, W, H);
  let s = 3;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  c.fillStyle = "#ffffff";
  for (let i = 0; i < 90; i++) { c.globalAlpha = 0.3 + rnd() * 0.7; c.fillRect(rnd() * W, rnd() * H * 0.5, 2, 2); }
  c.globalAlpha = 1;
  c.fillStyle = "#ffe8d6"; c.beginPath(); c.arc(1040, 130, 70, 0, Math.PI * 2); c.fill();
  c.fillStyle = "rgba(255,232,214,0.12)"; c.beginPath(); c.arc(1040, 130, 110, 0, Math.PI * 2); c.fill();
  c.fillStyle = "#240046";
  c.beginPath(); c.moveTo(0, 560);
  for (let x = 0; x <= W; x += 80) c.lineTo(x, 520 - Math.sin(x / 170) * 50 - rnd() * 20);
  c.lineTo(W, H); c.lineTo(0, H); c.fill();
  c.strokeStyle = "rgba(0,0,0,0.6)"; c.lineWidth = 2;
  c.beginPath(); c.moveTo(0, 60); c.quadraticCurveTo(W / 2, 150, W, 60); c.stroke();
  for (let i = 1; i < 12; i++) {
    const x = (W * i) / 12, y = 60 + Math.sin((i / 12) * Math.PI) * 45;
    c.fillStyle = i % 2 ? "#ff5d5d" : "#ffd166";
    c.beginPath(); c.ellipse(x, y + 12, 9, 12, 0, 0, Math.PI * 2); c.fill();
  }
  c.fillStyle = "#3b1f0e"; c.fillRect(0, 640, W, 80);
  c.fillStyle = "#5c3317";
  for (let x = 0; x < W; x += 160) c.fillRect(x, 640, 150, 8);
  if (sponsor) {
    c.fillStyle = "rgba(255,255,255,0.35)"; c.font = "bold 22px system-ui, sans-serif"; c.textAlign = "right";
    c.fillText(`Motion Blade Trial · ${sponsor}`, W - 24, 700);
  }
  return cv;
}

export function newView(colors: string[], sponsor?: string): BladeView {
  const n = LITE ? 0.5 : 1;
  return {
    bg: makeBackground(sponsor), sprites: makeSprites(), colors,
    trails: colors.map(() => new Float32Array(TRAIL * 2)),
    halves: Array.from({ length: 24 }, () => ({ on: false, kind: "plum" as TargetKind, x: 0, y: 0, vx: 0, vy: 0, rot: 0, spin: 0, side: 1, t: 0 })),
    sparks: Array.from({ length: Math.round(160 * n) }, () => ({ on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, life: 1, c: "#fff", r: 3 })),
    streaks: Array.from({ length: 12 }, () => ({ on: false, x1: 0, y1: 0, x2: 0, y2: 0, t: 0, c: "#fff" })),
    pops: Array.from({ length: 16 }, () => ({ on: false, x: 0, y: 0, t: 0, text: "", c: "#fff", big: false })),
    flash: 0, shake: 0, time: 0,
  };
}

// ---- effects (all from pools) ----------------------------------------------------------------

export function cutFx(v: BladeView, kind: TargetKind, x: number, y: number, angle: number) {
  let made = 0;
  for (const h of v.halves) {
    if (h.on || made === 2) continue;
    const side = made === 0 ? -1 : 1;
    const nx = -Math.sin(angle) * side, ny = Math.cos(angle) * side;
    h.on = true; h.kind = kind; h.x = x; h.y = y; h.vx = nx * 160 + Math.cos(angle) * 80; h.vy = ny * 160 - 120;
    h.rot = angle; h.spin = side * 3; h.side = side; h.t = 0;
    made++;
  }
  sparks(v, x, y, 14, JUICE[kind], 300);
}

export function sparks(v: BladeView, x: number, y: number, n: number, c: string, speed: number) {
  for (const p of v.sparks) {
    if (n <= 0) break;
    if (p.on) continue;
    const a = Math.random() * Math.PI * 2, sp = speed * (0.3 + Math.random() * 0.7);
    p.on = true; p.x = x; p.y = y; p.vx = Math.cos(a) * sp; p.vy = Math.sin(a) * sp - 100; p.t = 0; p.life = 0.4 + Math.random() * 0.4; p.c = c; p.r = 2 + Math.random() * 3;
    n--;
  }
}

export function streak(v: BladeView, x1: number, y1: number, x2: number, y2: number, c: string) {
  const s = v.streaks.find((q) => !q.on) ?? v.streaks[0]!;
  s.on = true; s.x1 = x1; s.y1 = y1; s.x2 = x2; s.y2 = y2; s.t = 0; s.c = c;
}

export function pop(v: BladeView, x: number, y: number, text: string, c: string, big = false) {
  const p = v.pops.find((q) => !q.on) ?? v.pops[0]!;
  p.on = true; p.x = x; p.y = y; p.t = 0; p.text = text; p.c = c; p.big = big;
}

export function blast(v: BladeView, x: number, y: number) {
  v.flash = 1;
  v.shake = 0.4;
  sparks(v, x, y, 30, "#ff9100", 520);
  sparks(v, x, y, 12, "#555", 300);
}

/** Records blade positions for the trails (call once per frame). */
export function trackBlades(v: BladeView, blades: Blade[]) {
  for (let i = 0; i < blades.length; i++) {
    const t = v.trails[i]!;
    t.copyWithin(2, 0, TRAIL * 2 - 2);
    t[0] = blades[i]!.x;
    t[1] = blades[i]!.y;
  }
}

export function animate(v: BladeView, dt: number) {
  v.time += dt;
  v.flash = Math.max(0, v.flash - dt * 3);
  v.shake = Math.max(0, v.shake - dt);
  for (const h of v.halves) {
    if (!h.on) continue;
    h.t += dt; h.vy += 900 * dt; h.x += h.vx * dt; h.y += h.vy * dt; h.rot += h.spin * dt;
    if (h.y > H + 80 || h.t > 2.5) h.on = false;
  }
  for (const p of v.sparks) {
    if (!p.on) continue;
    p.t += dt;
    if (p.t >= p.life) { p.on = false; continue; }
    p.vy += 700 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
  }
  for (const s of v.streaks) if (s.on && (s.t += dt) > 0.3) s.on = false;
  for (const p of v.pops) if (p.on && (p.t += dt) > 1) p.on = false;
}

// ---- drawing -----------------------------------------------------------------------------------

export function draw(c: CanvasRenderingContext2D, v: BladeView, r: Round) {
  const sh = v.shake > 0 ? (Math.random() - 0.5) * 16 * v.shake : 0;
  c.setTransform(1, 0, 0, 1, sh, sh * 0.6);
  c.drawImage(v.bg, 0, 0);
  for (const t of r.targets) {
    const img = v.sprites[t.kind];
    const size = img.width * (t.r / 44);
    c.save();
    c.translate(t.x, t.y);
    c.rotate(t.rot);
    c.drawImage(img, -size / 2, -size / 2, size, size);
    c.restore();
    if (t.kind === "bomb") { // fuse spark
      c.fillStyle = Math.floor(v.time * 12) % 2 ? "#ffea00" : "#ff6d00";
      c.beginPath(); c.arc(t.x + Math.cos(t.rot - 1) * 46, t.y + Math.sin(t.rot - 1) * 46, 6, 0, Math.PI * 2); c.fill();
    }
  }
  for (const h of v.halves) {
    if (!h.on) continue;
    const img = v.sprites[h.kind];
    c.save();
    c.translate(h.x, h.y);
    c.rotate(h.rot);
    c.globalAlpha = Math.max(0, 1 - h.t / 2.5);
    c.beginPath();
    c.rect(-img.width / 2, h.side < 0 ? -img.height / 2 : 0, img.width, img.height / 2);
    c.clip();
    c.drawImage(img, -img.width / 2, -img.height / 2);
    c.restore();
  }
  c.globalAlpha = 1;
  for (const p of v.sparks) {
    if (!p.on) continue;
    c.globalAlpha = 1 - p.t / p.life;
    c.fillStyle = p.c;
    c.fillRect(p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
  }
  c.globalAlpha = 1;
  c.lineCap = "round";
  for (const s of v.streaks) {
    if (!s.on) continue;
    const a = 1 - s.t / 0.3;
    c.globalAlpha = a;
    c.strokeStyle = s.c; c.lineWidth = 16 * a + 2;
    c.beginPath(); c.moveTo(s.x1, s.y1); c.lineTo(s.x2, s.y2); c.stroke();
    c.strokeStyle = "#ffffff"; c.lineWidth = 5 * a + 1;
    c.beginPath(); c.moveTo(s.x1, s.y1); c.lineTo(s.x2, s.y2); c.stroke();
  }
  c.globalAlpha = 1;
  for (let i = 0; i < r.blades.length; i++) drawBlade(c, v, r.blades[i]!, v.trails[i]!, v.colors[i]!);
  c.textAlign = "center";
  for (const p of v.pops) {
    if (!p.on) continue;
    c.globalAlpha = Math.max(0, 1 - p.t);
    c.font = `900 ${p.big ? 46 : 32}px system-ui, sans-serif`;
    c.fillStyle = "rgba(0,0,0,0.6)";
    c.fillText(p.text, p.x + 3, p.y - p.t * 50 + 3);
    c.fillStyle = p.c;
    c.fillText(p.text, p.x, p.y - p.t * 50);
  }
  c.globalAlpha = 1;
  if (v.flash > 0) {
    c.fillStyle = `rgba(255,120,40,${(v.flash * 0.35).toFixed(3)})`;
    c.fillRect(0, 0, W, H);
  }
  c.setTransform(1, 0, 0, 1, 0, 0);
}

function drawBlade(c: CanvasRenderingContext2D, v: BladeView, b: Blade, t: Float32Array, color: string) {
  const fast = b.speed > 500;
  if (fast && b.stunT <= 0) {
    for (let k = 0; k < TRAIL - 1; k++) {
      const a = 1 - k / TRAIL;
      c.globalAlpha = a * 0.9;
      c.strokeStyle = k < 2 ? "#ffffff" : color;
      c.lineWidth = 12 * a + 1;
      c.beginPath(); c.moveTo(t[k * 2]!, t[k * 2 + 1]!); c.lineTo(t[k * 2 + 2]!, t[k * 2 + 3]!); c.stroke();
    }
    c.globalAlpha = 1;
  }
  const stunned = b.stunT > 0;
  const pulse = 1 + Math.sin(v.time * 6) * 0.08;
  c.strokeStyle = stunned ? "#888" : color;
  c.lineWidth = 5;
  c.beginPath(); c.arc(b.x, b.y, 22 * pulse, 0, Math.PI * 2); c.stroke();
  c.strokeStyle = "rgba(0,0,0,0.5)"; c.lineWidth = 2;
  c.beginPath(); c.arc(b.x, b.y, 26 * pulse, 0, Math.PI * 2); c.stroke();
  c.fillStyle = stunned ? "#888" : "#ffffff";
  c.beginPath(); c.arc(b.x, b.y, 5, 0, Math.PI * 2); c.fill();
  if (stunned) {
    c.font = "900 28px system-ui, sans-serif"; c.textAlign = "center"; c.fillStyle = "#ff5d73";
    c.fillText("✖", b.x, b.y - 32);
  }
}
