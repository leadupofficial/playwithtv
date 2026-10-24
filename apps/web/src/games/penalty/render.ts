import { BALL_R, DIVE_TIME, GOAL_H, HALF_W, POST_R, SPOT, aimToGoal, ballAt, keeperBody, type Outcome, type Vec } from "./geometry";
import type { KickState } from "./kick";
import type { Team } from "./teams";
import { drawAim, drawBanner, drawHud } from "./hud";

/**
 * Canvas drawing for Global Penalty Cup on a 1280×720 stage: a night stadium seen from behind the spot.
 * The stands, pitch and goal frame are drawn once into an offscreen layer; each frame adds the keeper,
 * the ball, the kicker and the HUD with plain shapes (no images, no per-frame gradients).
 */
export const W = 1280, H = 720;
const CAM_Z = 17.5, CAM_H = 1.9, F = 1243, HOR = 290;
export const CX = 640;

/** Screen position and pixels-per-metre for a point `dist` metres in front of the goal line. */
export function project(x: number, y: number, dist: number) {
  const s = F / Math.max(0.5, CAM_Z - dist);
  return { x: CX + x * s, y: HOR + (CAM_H - y) * s, s };
}

export interface Side { name: string; team: Team; emoji: string; cpu: boolean }
export interface BoardRow { name: string; color: string; kicks: boolean[]; goals: number; active: boolean; out: boolean }
export interface Scene {
  kick: KickState;
  kicker: Side;
  keeper: Side;
  board: BoardRow[];
  regular: number;
  roundLabel: string;
  /** Show the crosshair (buttons / motion / CPU kickers; touchpad kickers aim with the swipe itself). */
  showAim: boolean;
  /** The kicker is charging a buttons shot: draw the power meter. */
  showCharge: boolean;
  hint: string;
}

interface Particle { x: number; y: number; vx: number; vy: number; c: string; life: number }
export interface View {
  time: number;
  stadium: string;
  layer: HTMLCanvasElement | null;
  banner: { text: string; sub?: string; color: string; t: number; dur: number } | null;
  confetti: Particle[];
  shake: number;
  /** Crowd excitement 0…1 (bounces the stands). */
  cheer: number;
  spin: number;
}

export function newView(stadium: string): View {
  const confetti: Particle[] = [];
  for (let i = 0; i < 90; i++) confetti.push({ x: 0, y: 0, vx: 0, vy: 0, c: "#fff", life: 0 });
  return { time: 0, stadium, layer: null, banner: null, confetti, shake: 0, cheer: 0, spin: 0 };
}

export function celebrate(v: View, colors: string[], rand: () => number) {
  for (const p of v.confetti) {
    p.x = rand() * W;
    p.y = -20 - rand() * 200;
    p.vx = (rand() - 0.5) * 120;
    p.vy = 120 + rand() * 160;
    p.c = colors[Math.floor(rand() * colors.length)]!;
    p.life = 2.5 + rand();
  }
}

export function animate(v: View, dt: number) {
  v.time += dt;
  if (v.banner) {
    v.banner.t += dt;
    if (v.banner.t > v.banner.dur) v.banner = null;
  }
  for (const p of v.confetti) {
    if (p.life <= 0) continue;
    p.life -= dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }
  v.shake = Math.max(0, v.shake - dt * 2.5);
  v.cheer = Math.max(0, v.cheer - dt * 0.35);
}

// ---- the static layer ----------------------------------------------------------------------

function quad(c: CanvasRenderingContext2D, pts: Array<{ x: number; y: number }>, fill: string) {
  c.fillStyle = fill;
  c.beginPath();
  c.moveTo(pts[0]!.x, pts[0]!.y);
  for (const p of pts.slice(1)) c.lineTo(p.x, p.y);
  c.closePath();
  c.fill();
}

function line(c: CanvasRenderingContext2D, a: { x: number; y: number }, b: { x: number; y: number }, w: number, color: string) {
  c.strokeStyle = color;
  c.lineWidth = w;
  c.beginPath();
  c.moveTo(a.x, a.y);
  c.lineTo(b.x, b.y);
  c.stroke();
}

function buildLayer(stadium: string, colors: string[]): HTMLCanvasElement {
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const c = cv.getContext("2d")!;
  // night sky and stands
  const sky = c.createLinearGradient(0, 0, 0, 380);
  sky.addColorStop(0, "#050817");
  sky.addColorStop(1, "#1a1440");
  c.fillStyle = sky;
  c.fillRect(0, 0, W, 380);
  let s = 11;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let tier = 0; tier < 2; tier++) {
    const top = tier === 0 ? 150 : 40, bottom = tier === 0 ? 335 : 140;
    quad(c, [{ x: 0, y: bottom }, { x: W, y: bottom }, { x: W, y: top }, { x: 0, y: top }], tier === 0 ? "#14102f" : "#0f0c26");
    const rows = tier === 0 ? 8 : 5;
    for (let r = 0; r < rows; r++) {
      const y = top + 10 + r * ((bottom - top - 16) / rows);
      for (let x = 4 + (r % 2) * 7; x < W; x += 14) {
        const pick = rand();
        c.fillStyle = pick < 0.32 ? colors[0]! : pick < 0.64 ? colors[1]! : pick < 0.8 ? "#e8e4f0" : "#3a3266";
        c.globalAlpha = 0.55 + rand() * 0.4;
        c.fillRect(x, y + rand() * 3, 7, 8);
      }
    }
    c.globalAlpha = 1;
  }
  // floodlights
  for (const fx of [90, W - 90]) {
    const g = c.createRadialGradient(fx, 40, 4, fx, 40, 170);
    g.addColorStop(0, "rgba(255,250,220,0.85)");
    g.addColorStop(0.25, "rgba(255,245,200,0.22)");
    g.addColorStop(1, "rgba(255,245,200,0)");
    c.fillStyle = g;
    c.fillRect(fx - 170, 0, 340, 220);
    c.fillStyle = "#fffbe6";
    for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) c.fillRect(fx - 26 + i * 14, 26 + j * 14, 10, 10);
  }
  // pitch with mowing stripes
  c.fillStyle = "#1f7a3a";
  c.fillRect(0, 335, W, H - 335);
  for (let d = -12; d < 16; d += 2.4) {
    const a = project(0, 0, d), b = project(0, 0, Math.min(16.9, d + 1.2));
    c.fillStyle = "#238443";
    c.fillRect(0, a.y, W, b.y - a.y);
  }
  // advertising boards (the game's own name and the stadium)
  const bTop = project(0, 1, -9).y, bBot = project(0, 0, -9).y;
  c.fillStyle = "#0c1a3a";
  c.fillRect(0, bTop, W, bBot - bTop);
  c.fillStyle = "rgba(255, 210, 63, 0.6)";
  c.font = "800 20px system-ui, sans-serif";
  c.textBaseline = "middle";
  const msg = `GLOBAL PENALTY CUP  ·  ${stadium.toUpperCase()}  ·  `;
  const mw = c.measureText(msg).width;
  for (let x = -80; x < W; x += mw) c.fillText(msg, x, (bTop + bBot) / 2);
  // lines: goal line, six-yard box, penalty spot
  const white = "rgba(255,255,255,0.85)";
  line(c, project(-40, 0, 0), project(40, 0, 0), 3, white);
  line(c, project(-9.16, 0, 0), project(-9.16, 0, 5.5), 3, white);
  line(c, project(9.16, 0, 0), project(9.16, 0, 5.5), 3, white);
  line(c, project(-9.16, 0, 5.5), project(9.16, 0, 5.5), 3, white);
  line(c, project(-20.16, 0, 0), project(-20.16, 0, 15), 4, white);
  line(c, project(20.16, 0, 0), project(20.16, 0, 15), 4, white);
  const spot = project(0, 0, SPOT);
  c.fillStyle = white;
  c.beginPath();
  c.ellipse(spot.x, spot.y, 0.12 * spot.s, 0.05 * spot.s, 0, 0, Math.PI * 2);
  c.fill();
  // goal: back net, side nets, then the frame
  const DEPTH = -2;
  const bl = project(-HALF_W, 0, DEPTH), br = project(HALF_W, 0, DEPTH), tl = project(-HALF_W, 1.9, DEPTH), tr = project(HALF_W, 1.9, DEPTH);
  const fl = project(-HALF_W, 0, 0), fr = project(HALF_W, 0, 0), ftl = project(-HALF_W, GOAL_H, 0), ftr = project(HALF_W, GOAL_H, 0);
  quad(c, [bl, br, tr, tl], "rgba(10, 20, 40, 0.35)");
  c.strokeStyle = "rgba(255,255,255,0.28)";
  c.lineWidth = 1;
  c.beginPath();
  for (let i = 0; i <= 24; i++) {
    const x = -HALF_W + (i / 24) * HALF_W * 2;
    const a = project(x, 0, DEPTH), b = project(x, 1.9, DEPTH), t = project(x, GOAL_H, 0);
    c.moveTo(a.x, a.y);
    c.lineTo(b.x, b.y);
    c.lineTo(t.x, t.y);
  }
  for (let j = 0; j <= 8; j++) {
    const y = (j / 8) * 1.9;
    const a = project(-HALF_W, y, DEPTH), b = project(HALF_W, y, DEPTH);
    c.moveTo(a.x, a.y);
    c.lineTo(b.x, b.y);
  }
  for (const sx of [-HALF_W, HALF_W]) {
    for (let k = 0; k <= 5; k++) {
      const d = DEPTH * (k / 5);
      const a = project(sx, 0, d), b = project(sx, GOAL_H - (GOAL_H - 1.9) * (k / 5), d);
      c.moveTo(a.x, a.y);
      c.lineTo(b.x, b.y);
    }
  }
  c.stroke();
  const pw = POST_R * 2 * fl.s;
  line(c, bl, fl, 2, "rgba(255,255,255,0.5)");
  line(c, br, fr, 2, "rgba(255,255,255,0.5)");
  line(c, tl, ftl, 2, "rgba(255,255,255,0.5)");
  line(c, tr, ftr, 2, "rgba(255,255,255,0.5)");
  c.lineCap = "round";
  c.strokeStyle = "#f8f8f8";
  c.lineWidth = pw;
  c.beginPath();
  c.moveTo(fl.x - pw / 2, fl.y);
  c.lineTo(ftl.x - pw / 2, ftl.y - pw / 2);
  c.lineTo(ftr.x + pw / 2, ftr.y - pw / 2);
  c.lineTo(fr.x + pw / 2, fr.y);
  c.stroke();
  c.lineCap = "butt";
  return cv;
}

// ---- moving things ---------------------------------------------------------------------

/** Where the ball goes after it reaches the goal line, `t` seconds into the result. */
function afterBall(o: Outcome, b: Vec, t: number): Vec & { dist: number } {
  const out = Math.sign(b.x) || 1;
  if (o === "goal") {
    const k = Math.min(1, t / 0.22);
    const drop = Math.max(BALL_R, b.y - Math.max(0, t - 0.22) * 4.5);
    return { x: b.x * (1 + 0.05 * k), y: t < 0.22 ? b.y : drop, dist: -1.7 * k };
  }
  if (o === "save") {
    const k = Math.min(1, t / 0.6);
    return { x: b.x + out * 1.8 * k, y: Math.max(BALL_R, b.y + Math.sin(k * Math.PI) * 0.8 - k * 0.6), dist: 2.5 * k };
  }
  if (o === "post" || o === "bar") {
    const k = Math.min(1, t / 0.5);
    return { x: b.x + out * 2.2 * k, y: Math.max(BALL_R, b.y + (o === "bar" ? 1.2 : 0.3) * Math.sin(k * Math.PI)), dist: 3 * k };
  }
  const k = Math.min(1, t / 0.5);
  return { x: b.x * (1 + 0.4 * k), y: b.y * (1 + 0.3 * k), dist: -7 * k };
}

function drawBall(c: CanvasRenderingContext2D, x: number, y: number, dist: number, spin: number) {
  const g = project(x, 0, dist), p = project(x, y, dist);
  const r = Math.max(3, BALL_R * p.s);
  c.fillStyle = "rgba(0,0,0,0.35)";
  c.beginPath();
  c.ellipse(g.x, g.y, r * 1.1, r * 0.35, 0, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = "#fafafa";
  c.beginPath();
  c.arc(p.x, p.y, r, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = "#1d2433";
  for (let i = 0; i < 3; i++) {
    const a = spin + (i * Math.PI * 2) / 3;
    c.beginPath();
    c.arc(p.x + Math.cos(a) * r * 0.55, p.y + Math.sin(a) * r * 0.55, r * 0.28, 0, Math.PI * 2);
    c.fill();
  }
  c.strokeStyle = "rgba(0,0,0,0.25)";
  c.lineWidth = 1.5;
  c.beginPath();
  c.arc(p.x, p.y, r, 0, Math.PI * 2);
  c.stroke();
}

function drawKeeper(c: CanvasRenderingContext2D, k: KickState, team: Team, t: number) {
  let tau = 0;
  if (k.phase === "flight") tau = k.flightT - k.diveAt;
  else if (k.phase === "result" || k.phase === "done") tau = (k.shot?.time ?? 0) - k.diveAt + k.t;
  const body = keeperBody(k.dive, Math.min(DIVE_TIME, tau));
  const bob = !k.dive && k.phase === "aim" ? Math.sin(t * 6) * 0.03 : 0;
  const P = (v: Vec) => project(v.x, v.y + bob, 0);
  const ax = body.b.x - body.a.x, ay = body.b.y - body.a.y;
  const len = Math.hypot(ax, ay) || 1;
  const ux = ax / len, uy = ay / len, nx = -uy, ny = ux;
  const at = (f: number, side = 0) => P({ x: body.a.x + ax * f + nx * side, y: body.a.y + ay * f + ny * side });
  const s = project(0, 0, 0).s;
  const diving = !!k.dive && tau > 0;
  const stretch = diving ? Math.min(1, tau / DIVE_TIME) : 0;
  c.lineCap = "round";
  // legs, torso, arms, head, gloves
  const hip = at(0.42), sh = at(0.76);
  line(c, hip, at(0, 0.16), 0.17 * s, "#1a1a1a");
  line(c, hip, at(0, -0.16), 0.17 * s, "#1a1a1a");
  line(c, at(0.3), at(0.5), 0.36 * s, team.trim);
  line(c, hip, sh, 0.42 * s, team.keeper);
  const reachF = 0.76 + 0.42 * stretch;
  const gl = at(reachF, 0.62 * (1 - stretch) + 0.13), gr = at(reachF, -0.62 * (1 - stretch) - 0.13);
  const glUp = diving ? gl : { x: gl.x, y: gl.y - 0.25 * s };
  const grUp = diving ? gr : { x: gr.x, y: gr.y - 0.25 * s };
  line(c, sh, glUp, 0.13 * s, team.keeper);
  line(c, sh, grUp, 0.13 * s, team.keeper);
  const head = at(0.93);
  c.fillStyle = "#c68a5a";
  c.beginPath();
  c.arc(head.x, head.y, 0.13 * s, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = "#b8f03a";
  for (const g of [glUp, grUp]) {
    c.beginPath();
    c.arc(g.x, g.y, 0.1 * s, 0, Math.PI * 2);
    c.fill();
  }
  c.lineCap = "butt";
}

/** The kicker from behind, big in the left foreground; steps into the ball when shooting. */
function drawKicker(c: CanvasRenderingContext2D, k: KickState, side: Side) {
  const shooting = k.phase === "flight" || k.phase === "result" || k.phase === "done";
  const run = k.phase === "flight" ? Math.min(1, k.flightT / 0.18) : shooting ? 1 : 0;
  const x = -1.95 + 0.55 * run, dist = SPOT + 1.3 - 0.9 * run;
  const foot = project(x, 0, dist), s = foot.s;
  const P = (dx: number, y: number) => ({ x: foot.x + dx * s, y: foot.y - y * s });
  const lean = run * 0.12;
  c.lineCap = "round";
  line(c, P(-0.1, 0.05), P(-0.1 + lean, 0.85), 0.16 * s, "#e9d2b5");
  line(c, P(0.12 + 0.25 * run, 0.1 + 0.2 * run), P(0.1 + lean, 0.85), 0.16 * s, "#e9d2b5");
  line(c, P(-0.1, 0.05), P(-0.1, 0.45), 0.17 * s, side.team.trim);
  line(c, P(0.12 + 0.25 * run, 0.1 + 0.2 * run), P(0.12 + 0.12 * run, 0.45), 0.17 * s, side.team.trim);
  line(c, P(lean, 0.82), P(lean + 0.02, 1.0), 0.46 * s, side.team.trim);
  line(c, P(lean + 0.02, 1.0), P(lean + 0.05, 1.45), 0.5 * s, side.team.shirt);
  line(c, P(lean - 0.2, 1.4), P(lean - 0.34, 1.0), 0.12 * s, side.team.shirt);
  line(c, P(lean + 0.28, 1.4), P(lean + 0.44, 1.02), 0.12 * s, side.team.shirt);
  c.fillStyle = "#2a1d14";
  c.beginPath();
  c.arc(P(lean + 0.06, 1.68).x, P(lean + 0.06, 1.68).y, 0.13 * s, 0, Math.PI * 2);
  c.fill();
  c.lineCap = "butt";
  const back = P(lean + 0.04, 1.2);
  c.fillStyle = side.team.trim;
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.font = `900 ${Math.round(0.26 * s)}px system-ui, sans-serif`;
  c.fillText("10", back.x, back.y + 0.05 * s);
  c.font = `800 ${Math.round(0.09 * s)}px system-ui, sans-serif`;
  c.fillText(side.name.toUpperCase().slice(0, 10), back.x, back.y - 0.16 * s);
}

export function draw(c: CanvasRenderingContext2D, sc: Scene, v: View) {
  v.layer ??= buildLayer(v.stadium, [sc.kicker.team.shirt, sc.keeper.team.shirt]);
  const sx = v.shake > 0 ? Math.sin(v.time * 90) * v.shake * 10 : 0;
  c.save();
  c.translate(sx, 0);
  c.drawImage(v.layer, 0, 0);
  // the crowd bounces when excited (a cheap shift of the stands strip)
  if (v.cheer > 0.05) {
    const jump = Math.abs(Math.sin(v.time * 14)) * 6 * v.cheer;
    c.drawImage(v.layer, 0, 40, W, 295, 0, 40 - jump, W, 295);
  }
  const k = sc.kick;
  // the ball: on the spot, in flight, or after the goal line
  let b: Vec & { dist: number };
  if (k.phase === "flight" && k.shot) b = ballAt(k.shot, k.flightT / k.shot.time);
  else if ((k.phase === "result" || k.phase === "done") && k.shot && k.outcome) b = afterBall(k.outcome, ballAt(k.shot, 1), k.t);
  else b = { x: 0, y: BALL_R, dist: SPOT };
  if (k.phase === "flight") v.spin += 0.35;
  if (b.dist < 0) drawBall(c, b.x, b.y, b.dist, v.spin); // in the net / past the goal: behind the keeper
  drawKeeper(c, k, sc.keeper.team, v.time);
  if (sc.showAim && k.phase === "aim") drawAim(c, sc, v.time);
  if (b.dist >= 0) drawBall(c, b.x, b.y, b.dist, v.spin);
  drawKicker(c, k, sc.kicker);
  c.restore();
  for (const p of v.confetti) {
    if (p.life <= 0 || p.y > H) continue;
    c.fillStyle = p.c;
    c.fillRect(p.x, p.y, 8, 12);
  }
  drawHud(c, sc, v);
  drawBanner(c, v);
}
