import { PUNCHES, facing, type Fight, type Fighter } from "./engine";

/** Canvas drawing for Ring Kings Boxing on a 1280x720 stage. Everything is drawn with shapes; no image assets. */
export const W = 1280, H = 720, FLOOR = 575;

type Pt = { x: number; y: number };

export interface Burst { x: number; y: number; text: string; color: string; t: number; big: boolean }
export interface Banner { text: string; sub?: string; color: string; t: number; dur: number }

export interface View {
  shownHp: Record<string, number>; // health bars ease down to show a red damage trail
  bursts: Burst[];
  banner: Banner | null;
  flashes: { x: number; y: number; t: number }[];
  crowd: { x: number; y: number; r: number; c: string }[];
  emoji: Record<string, string>;
  time: number;
  /** A booked sponsor's name, painted on the ring apron next to the game's own name. */
  sponsor?: string;
}

export function newView(f: Fight, emoji: Record<string, string>): View {
  let s = 7;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const crowd: View["crowd"] = [];
  const shades = ["#2a2150", "#33285e", "#251c47", "#3b2f6b"];
  for (let row = 0; row < 5; row++) {
    for (let i = 0; i < 46; i++) {
      crowd.push({ x: i * 28 + (row % 2) * 14 + rand() * 6, y: 250 - row * 26 + rand() * 6, r: 11 + rand() * 3 - row, c: shades[(i + row) % 4]! });
    }
  }
  return { shownHp: { [f.a.id]: 100, [f.b.id]: 100 }, bursts: [], banner: null, flashes: [], crowd, emoji, time: 0 };
}

// ---- helpers ----------------------------------------------------------------------

function shade(hex: string, amt: number) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v + amt)));
  return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

/** Two-bone IK: the elbow for a shoulder→hand reach with the bend pointing `bend` (+1 down, -1 up). */
function elbow(s: Pt, h: Pt, l1: number, l2: number, bend: number): Pt {
  const dx = h.x - s.x, dy = h.y - s.y;
  const d = Math.min(Math.hypot(dx, dy), l1 + l2 - 0.01);
  const a = Math.atan2(dy, dx);
  const cos = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d);
  const off = Math.acos(Math.max(-1, Math.min(1, cos)));
  const ang = a + off * bend;
  return { x: s.x + Math.cos(ang) * l1, y: s.y + Math.sin(ang) * l1 };
}

function limb(c: CanvasRenderingContext2D, a: Pt, b: Pt, w: number, color: string) {
  c.strokeStyle = color;
  c.lineWidth = w;
  c.lineCap = "round";
  c.beginPath();
  c.moveTo(a.x, a.y);
  c.lineTo(b.x, b.y);
  c.stroke();
}

/** 0 → 1 → 0 over the punch, peaking at the moment it lands. */
function extension(t: number, active: number, dur: number) {
  if (t < active) return Math.sin((t / active) * Math.PI * 0.5);
  return Math.max(0, 1 - (t - active) / (dur - active));
}

// ---- boxer --------------------------------------------------------------------------

/** Draws a boxer in local space facing right with feet at (0, 0). */
function boxer(c: CanvasRenderingContext2D, x: Fighter, t: number) {
  const skin = x.skin, glove = x.color, shorts = shade(x.color, -60);
  const bob = x.state === "idle" ? Math.sin(t * 5 + x.side) * 3 : 0;
  let lean = 0, duck = 0, headBack = 0;
  let lead: Pt = { x: 58, y: -268 }, rear: Pt = { x: 36, y: -282 };
  let leadBend = 1, rearBend = 1;
  if (x.state === "punch" && x.punch) {
    const spec = PUNCHES[x.punch];
    const e = extension(x.stateT, spec.activeAt, spec.dur);
    if (x.punch === "jab") {
      lead = { x: 58 + 105 * e, y: -268 - 6 * e };
      lean = 8 * e;
    } else if (x.punch === "hook") {
      const ang = -Math.PI * 0.9 + Math.PI * 0.75 * e;
      lead = { x: 30 + Math.cos(ang) * -95 * e + 60 * e, y: -280 + Math.sin(ang) * 20 };
      leadBend = -1;
      lean = 14 * e;
    } else if (x.punch === "upper") {
      rear = { x: 36 + 62 * e, y: -205 - 100 * e };
      rearBend = 1;
      duck = 18 * (1 - e);
      lean = 10 * e;
    } else {
      rear = { x: 36 + 135 * e, y: -282 + 8 * e };
      lean = 22 * e;
    }
  } else if (x.blocking) {
    lead = { x: 38, y: -292 };
    rear = { x: 30, y: -262 };
  } else if (x.state === "dodge") {
    const d = Math.sin(Math.min(1, x.stateT / 0.42) * Math.PI);
    lean = -26 * d;
    duck = 34 * d;
  } else if (x.state === "hit") {
    headBack = 1;
    lean = -16;
    lead = { x: 40, y: -250 };
    rear = { x: 20, y: -255 };
  } else if (x.state === "win") {
    lead = { x: 30, y: -380 };
    rear = { x: -10, y: -385 };
    leadBend = -1;
    rearBend = -1;
  }
  const hipY = -150 + duck * 0.4, shoulderY = -255 + duck + bob;

  // legs (stance; a walk swings them)
  const stride = x.walking ? Math.sin(t * 12) * 14 : 0;
  limb(c, { x: 8, y: hipY }, { x: 34 + stride, y: -2 }, 26, skin);
  limb(c, { x: -8, y: hipY }, { x: -34 - stride, y: -2 }, 26, shade(skin, -18));
  c.fillStyle = "#1d1d24";
  c.beginPath(); c.ellipse(42 + stride, -4, 22, 9, 0, 0, Math.PI * 2); c.fill();
  c.beginPath(); c.ellipse(-26 - stride, -4, 22, 9, 0, 0, Math.PI * 2); c.fill();

  c.save();
  c.translate(lean, 0);
  // rear arm (behind the body)
  const rs = { x: -6, y: shoulderY + 8 };
  const re = elbow(rs, { x: rear.x + lean * 0.3, y: rear.y + duck }, 58, 54, rearBend);
  limb(c, rs, re, 20, shade(skin, -22));
  limb(c, re, { x: rear.x, y: rear.y + duck }, 18, shade(skin, -22));
  c.fillStyle = shade(glove, -35);
  c.beginPath(); c.arc(rear.x, rear.y + duck, 19, 0, Math.PI * 2); c.fill();

  // torso and shorts
  c.fillStyle = skin;
  c.beginPath();
  c.moveTo(-26, shoulderY);
  c.quadraticCurveTo(0, shoulderY - 10, 28, shoulderY);
  c.lineTo(22, hipY - 12);
  c.lineTo(-20, hipY - 12);
  c.closePath();
  c.fill();
  c.fillStyle = "rgba(0,0,0,0.12)";
  c.fillRect(-4, shoulderY + 20, 4, hipY - shoulderY - 40);
  c.fillStyle = shorts;
  c.beginPath();
  c.moveTo(-24, hipY - 18); c.lineTo(26, hipY - 18); c.lineTo(32, hipY + 34); c.lineTo(-30, hipY + 34);
  c.closePath(); c.fill();
  c.fillStyle = "#fff";
  c.fillRect(-24, hipY - 18, 50, 7);
  c.fillStyle = shade(x.color, 40);
  c.fillRect(-30, hipY + 6, 6, 26);

  // head
  const hx = 10 - headBack * 14, hy = shoulderY - 36 - headBack * 2;
  c.fillStyle = skin;
  c.beginPath(); c.arc(hx, hy, 27, 0, Math.PI * 2); c.fill();
  c.fillStyle = "#151018";
  c.beginPath(); c.arc(hx - 2, hy - 6, 27, Math.PI * 1.05, Math.PI * 1.95); c.fill();
  c.fillStyle = "#fff";
  c.beginPath(); c.arc(hx + 14, hy - 2, 4.5, 0, Math.PI * 2); c.fill();
  c.fillStyle = "#111";
  c.beginPath(); c.arc(hx + 15.5, hy - 2, 2.2, 0, Math.PI * 2); c.fill();
  c.strokeStyle = shade(skin, -60);
  c.lineWidth = 2.5;
  c.beginPath(); c.moveTo(hx + 12, hy + 12); c.lineTo(hx + 20, hy + 11); c.stroke();

  // lead arm (in front)
  const ls = { x: 16, y: shoulderY + 6 };
  const le = elbow(ls, lead, 58, 54, leadBend);
  limb(c, ls, le, 21, skin);
  limb(c, le, lead, 19, skin);
  c.fillStyle = glove;
  c.beginPath(); c.arc(lead.x, lead.y, 21, 0, Math.PI * 2); c.fill();
  c.fillStyle = "rgba(255,255,255,0.35)";
  c.beginPath(); c.arc(lead.x - 6, lead.y - 7, 7, 0, Math.PI * 2); c.fill();
  if (x.punch === "super" && x.state === "punch") {
    c.fillStyle = "rgba(120,200,255,0.45)";
    c.beginPath(); c.arc(rear.x, rear.y, 34, 0, Math.PI * 2); c.fill();
  }
  c.restore();
}

function drawFighter(c: CanvasRenderingContext2D, f: Fight, x: Fighter, t: number) {
  const dir = facing(x, x === f.a ? f.b : f.a);
  c.save();
  c.fillStyle = "rgba(0,0,0,0.35)";
  c.beginPath(); c.ellipse(x.x, FLOOR + 4, 90, 16, 0, 0, Math.PI * 2); c.fill();
  c.translate(x.x, FLOOR);
  c.scale(dir, 1);
  if (x.state === "down" || x.state === "out") {
    c.translate(-150, -18);
    c.rotate(-Math.PI / 2 + 0.06);
    c.translate(0, 0);
  }
  if (x.state === "hit" && x.stateT < 0.06) c.filter = "brightness(2.2)";
  boxer(c, x, t);
  c.restore();
}

// ---- stage ----------------------------------------------------------------------------

function stage(c: CanvasRenderingContext2D, v: View, t: number) {
  const g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#07051a");
  g.addColorStop(0.55, "#1b1340");
  g.addColorStop(1, "#0c0920");
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
  for (const p of v.crowd) {
    c.fillStyle = p.c;
    c.beginPath(); c.arc(p.x, p.y, p.r, 0, Math.PI * 2); c.fill();
    c.fillRect(p.x - p.r, p.y + p.r * 0.6, p.r * 2, p.r * 1.6);
  }
  for (const fl of v.flashes) {
    const a = 1 - fl.t / 0.25;
    if (a <= 0) continue;
    const rg = c.createRadialGradient(fl.x, fl.y, 0, fl.x, fl.y, 26);
    rg.addColorStop(0, `rgba(255,255,255,${a})`);
    rg.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = rg;
    c.fillRect(fl.x - 26, fl.y - 26, 52, 52);
  }
  for (const sx of [300, 640, 980]) {                      // spotlights
    const sg = c.createRadialGradient(sx, -40, 10, sx, 380, 520);
    sg.addColorStop(0, "rgba(255,240,200,0.22)");
    sg.addColorStop(1, "rgba(255,240,200,0)");
    c.fillStyle = sg;
    c.beginPath(); c.moveTo(sx - 30, 0); c.lineTo(sx + 30, 0); c.lineTo(sx + 260, FLOOR); c.lineTo(sx - 260, FLOOR); c.closePath(); c.fill();
  }
  // mat and apron
  c.fillStyle = "#cfd6e6";
  c.beginPath(); c.moveTo(150, 470); c.lineTo(1130, 470); c.lineTo(1240, FLOOR + 40); c.lineTo(40, FLOOR + 40); c.closePath(); c.fill();
  c.fillStyle = "rgba(60,40,140,0.18)";
  c.beginPath(); c.ellipse(640, 530, 170, 46, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = "rgba(60,40,140,0.35)";
  c.font = "800 44px 'Baloo 2', system-ui";
  c.textAlign = "center";
  c.fillText("RK", 640, 546);
  c.fillStyle = "#1f2a6b";
  c.fillRect(40, FLOOR + 40, 1200, 120);
  c.fillStyle = "#ffd23f";
  const apron = v.sponsor ? `RING  KINGS  BOXING   ·   ${v.sponsor.toUpperCase()}` : "RING  KINGS  BOXING";
  let size = 40;
  do c.font = `800 ${size}px 'Baloo 2', system-ui`; while (c.measureText(apron).width > 1120 && --size > 18);
  c.fillText(apron, 640, FLOOR + 102);
  // back ropes and posts
  for (const [i, col] of ["#e2384d", "#f4f4f4", "#1f7ae0"].entries()) limb(c, { x: 150, y: 330 + i * 45 }, { x: 1130, y: 330 + i * 45 }, 5, col);
  c.fillStyle = "#2b2b38";
  c.fillRect(140, 300, 20, 175);
  c.fillRect(1120, 300, 20, 175);
  void t;
}

function frontRopes(c: CanvasRenderingContext2D) {
  c.globalAlpha = 0.85;
  for (const [i, col] of ["#e2384d", "#f4f4f4", "#1f7ae0"].entries()) limb(c, { x: 30, y: 470 + i * 40 }, { x: 1250, y: 470 + i * 40 }, 7, col);
  c.globalAlpha = 1;
  c.fillStyle = "#2b2b38";
  c.fillRect(20, 440, 28, 230);
  c.fillRect(1232, 440, 28, 230);
}

// ---- HUD ------------------------------------------------------------------------------

function bar(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, frac: number, color: string, rtl: boolean, back = "rgba(255,255,255,0.12)") {
  c.fillStyle = back;
  c.fillRect(x, y, w, h);
  c.fillStyle = color;
  const fw = w * Math.max(0, Math.min(1, frac));
  c.fillRect(rtl ? x + w - fw : x, y, fw, h);
}

function hud(c: CanvasRenderingContext2D, f: Fight, v: View) {
  const side = (x: Fighter, left: boolean) => {
    const bx = left ? 60 : W - 60 - 470;
    c.fillStyle = "rgba(10,8,30,0.7)";
    c.fillRect(bx - 12, 18, 494, 112);
    c.textAlign = left ? "left" : "right";
    c.fillStyle = "#fff";
    c.font = "800 28px 'Baloo 2', system-ui";
    c.fillText(`${v.emoji[x.id] ?? "🥊"} ${x.name}`, left ? bx : bx + 470, 52);
    bar(c, bx, 64, 470, 26, v.shownHp[x.id]! / 100, "#ff5d73", !left);
    bar(c, bx, 64, 470, 26, x.hp / 100, x.hp > 30 ? "#3ee08f" : "#ffd23f", !left, "transparent");
    bar(c, bx, 96, 470, 8, x.stamina / 100, "#ffd23f", !left);
    const full = x.superMeter >= 1;
    bar(c, bx, 110, 470, 10, x.superMeter, full ? (Math.floor(v.time * 6) % 2 ? "#6fc3ff" : "#ffffff") : "#2f8cff", !left);
    if (full) {
      c.font = "800 18px 'Baloo 2', system-ui";
      c.fillStyle = "#6fc3ff";
      c.fillText("SUPER READY!", left ? bx : bx + 470, 146);
    }
    for (let i = 0; i < x.knockdowns; i++) {
      c.fillStyle = "#ff5d73";
      c.beginPath(); c.arc(left ? bx + 8 + i * 22 : bx + 462 - i * 22, 146, 7, 0, Math.PI * 2); c.fill();
    }
  };
  side(f.a, true);
  side(f.b, false);
  c.textAlign = "center";
  c.fillStyle = "rgba(10,8,30,0.85)";
  c.fillRect(W / 2 - 80, 18, 160, 104);
  c.fillStyle = "#b9b2dd";
  c.font = "700 20px 'Baloo 2', system-ui";
  c.fillText(`ROUND ${f.round}`, W / 2, 46);
  c.fillStyle = f.clock < 10 && f.phase === "fight" ? "#ff5d73" : "#fff";
  c.font = "800 54px 'Baloo 2', system-ui";
  c.fillText(String(Math.ceil(f.clock)), W / 2, 104);

  for (const b of v.bursts) {
    const life = b.big ? 0.9 : 0.6;
    if (b.t > life) continue;
    const s = Math.min(1, b.t / 0.08) * (1 + b.t * 0.6);
    c.save();
    c.translate(b.x, b.y - b.t * 60);
    c.scale(s, s);
    c.globalAlpha = Math.max(0, 1 - b.t / life);
    if (b.big) {
      c.fillStyle = "#ffd23f";
      c.beginPath();
      for (let i = 0; i < 16; i++) {
        const r = i % 2 ? 34 : 62, a = (i / 16) * Math.PI * 2;
        c.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      c.closePath(); c.fill();
    }
    c.font = `800 ${b.big ? 34 : 28}px 'Baloo 2', system-ui`;
    c.lineWidth = 6;
    c.strokeStyle = "#1a0f2e";
    c.strokeText(b.text, 0, 10);
    c.fillStyle = b.color;
    c.fillText(b.text, 0, 10);
    c.restore();
  }

  const down = f.a.state === "down" ? f.a : f.b.state === "down" ? f.b : null;
  if (down && f.phase === "fight") {
    const n = Math.min(10, Math.floor(f.count) + 1);
    c.fillStyle = "rgba(0,0,0,0.35)";
    c.fillRect(0, 0, W, H);
    c.font = "800 160px 'Baloo 2', system-ui";
    c.lineWidth = 12;
    c.strokeStyle = "#1a0f2e";
    c.strokeText(String(n), W / 2, 380);
    c.fillStyle = "#fff";
    c.fillText(String(n), W / 2, 380);
    c.font = "800 34px 'Baloo 2', system-ui";
    c.fillStyle = "#ffd23f";
    c.fillText(`${down.name}: TAP "GET UP" ON YOUR PHONE!`, W / 2, 440);
    bar(c, W / 2 - 220, 462, 440, 18, down.mashCount / down.mashNeeded, "#3ee08f", false);
  }
  if (v.banner) {
    const b = v.banner;
    const a = Math.min(1, b.t / 0.15, (b.dur - b.t) / 0.25);
    if (a > 0) {
      c.save();
      c.globalAlpha = a;
      c.fillStyle = "rgba(0,0,0,0.45)";
      c.fillRect(0, 250, W, b.sub ? 210 : 160);
      c.font = "800 110px 'Baloo 2', system-ui";
      c.lineWidth = 12;
      c.strokeStyle = "#1a0f2e";
      c.strokeText(b.text, W / 2, 365);
      c.fillStyle = b.color;
      c.fillText(b.text, W / 2, 365);
      if (b.sub) {
        c.font = "700 36px 'Baloo 2', system-ui";
        c.fillStyle = "#fff";
        c.fillText(b.sub, W / 2, 425);
      }
      c.restore();
    }
  }
}

/** Draws one frame. */
export function draw(c: CanvasRenderingContext2D, f: Fight, v: View) {
  const t = v.time;
  c.save();
  if (f.shake > 0) c.translate((Math.random() - 0.5) * f.shake * 40, (Math.random() - 0.5) * f.shake * 30);
  stage(c, v, t);
  // the fighter further back is drawn first; a knocked-down fighter goes underneath
  const order = [f.a, f.b].sort((p, q) => Number(q.state === "down" || q.state === "out") - Number(p.state === "down" || p.state === "out"));
  for (const x of order) drawFighter(c, f, x, t);
  frontRopes(c);
  c.restore();
  hud(c, f, v);
}

/** Ages bursts, flashes and the damage trail. */
export function animate(v: View, f: Fight, dt: number, rand: () => number) {
  v.time += dt;
  for (const x of [f.a, f.b]) v.shownHp[x.id] = Math.max(x.hp, (v.shownHp[x.id] ?? 100) - 18 * dt);
  for (const b of v.bursts) b.t += dt;
  v.bursts = v.bursts.filter((b) => b.t < 1);
  for (const fl of v.flashes) fl.t += dt;
  v.flashes = v.flashes.filter((fl) => fl.t < 0.25);
  const excitement = f.shake > 0.2 ? 18 : 1.2;
  if (rand() < excitement * dt) v.flashes.push({ x: rand() * W, y: 140 + rand() * 120, t: 0 });
  if (v.banner) {
    v.banner.t += dt;
    if (v.banner.t > v.banner.dur) v.banner = null;
  }
}
