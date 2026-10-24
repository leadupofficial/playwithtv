import { aimToGoal } from "./geometry";
import { CX, W, project, type Scene, type View } from "./render";

/** The overlay: scoreboard, stadium, matchup, aim timer, crosshair with power meter, and big banners. */
function pill(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string) {
  c.fillStyle = fill;
  c.beginPath();
  c.roundRect(x, y, w, h, Math.min(h / 2, 14));
  c.fill();
}

export function drawHud(c: CanvasRenderingContext2D, sc: Scene, v: View) {
  c.textBaseline = "middle";
  // scoreboard
  const rows = sc.board.length, rowH = rows > 6 ? 30 : 36;
  pill(c, 14, 14, 360, 46 + rows * rowH, "rgba(6, 8, 24, 0.82)");
  c.textAlign = "left";
  c.fillStyle = "#ffd23f";
  c.font = "800 18px system-ui, sans-serif";
  c.fillText(sc.roundLabel, 30, 37);
  sc.board.forEach((r, i) => {
    const y = 62 + i * rowH + rowH / 2 - 4;
    c.globalAlpha = r.out ? 0.45 : 1;
    if (r.active) pill(c, 20, y - rowH / 2 + 2, 348, rowH - 4, "rgba(255,255,255,0.12)");
    c.fillStyle = r.color;
    c.fillRect(28, y - 9, 8, 18);
    c.fillStyle = "#fff";
    c.font = `700 ${rows > 6 ? 17 : 20}px system-ui, sans-serif`;
    c.fillText(r.name.slice(0, 11), 44, y);
    const n = Math.max(sc.regular, r.kicks.length);
    for (let j = 0; j < n; j++) {
      const cx = 186 + j * (n > 7 ? 15 : 20), kk = r.kicks[j];
      c.fillStyle = kk === undefined ? "rgba(255,255,255,0.18)" : kk ? "#3ee08f" : "#ff5d73";
      c.beginPath();
      c.arc(cx, y, 7, 0, Math.PI * 2);
      c.fill();
    }
    c.fillStyle = "#fff";
    c.textAlign = "right";
    c.font = "900 22px system-ui, sans-serif";
    c.fillText(String(r.goals), 358, y);
    c.textAlign = "left";
  });
  c.globalAlpha = 1;
  // stadium
  c.textAlign = "right";
  pill(c, W - 300, 14, 286, 40, "rgba(6, 8, 24, 0.82)");
  c.fillStyle = "#fff";
  c.font = "700 18px system-ui, sans-serif";
  c.fillText(`🏟 ${v.stadium}`, W - 28, 34);
  // matchup
  c.textAlign = "center";
  const label = `⚽ ${sc.kicker.emoji} ${sc.kicker.name}   vs   🧤 ${sc.keeper.emoji} ${sc.keeper.name}`;
  c.font = "800 24px system-ui, sans-serif";
  const lw = c.measureText(label).width + 48;
  pill(c, CX - lw / 2, 14, lw, 46, "rgba(6, 8, 24, 0.85)");
  c.fillStyle = "#fff";
  c.fillText(label, CX, 38);
  if (sc.hint) {
    c.font = "600 18px system-ui, sans-serif";
    c.fillStyle = "rgba(255,255,255,0.85)";
    c.fillText(sc.hint, CX, 700);
  }
  const k = sc.kick;
  if (k.phase === "aim") {
    const f = Math.max(0, 1 - k.t / k.timing.aim);
    c.fillStyle = "rgba(255,255,255,0.2)";
    c.fillRect(CX - lw / 2 + 20, 64, lw - 40, 5);
    c.fillStyle = f > 0.3 ? "#3ee08f" : "#ff5d73";
    c.fillRect(CX - lw / 2 + 20, 64, (lw - 40) * f, 5);
  }
}

export function drawAim(c: CanvasRenderingContext2D, sc: Scene, t: number) {
  const k = sc.kick;
  const g = aimToGoal(k.aim.x, k.aim.y);
  const p = project(g.x, g.y, 0);
  const r = 18 + Math.sin(t * 8) * 2;
  c.strokeStyle = sc.kicker.team.shirt;
  c.lineWidth = 4;
  c.beginPath();
  c.arc(p.x, p.y, r, 0, Math.PI * 2);
  c.stroke();
  c.strokeStyle = "#fff";
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(p.x - r - 8, p.y);
  c.lineTo(p.x - 6, p.y);
  c.moveTo(p.x + 6, p.y);
  c.lineTo(p.x + r + 8, p.y);
  c.moveTo(p.x, p.y - r - 8);
  c.lineTo(p.x, p.y - 6);
  c.moveTo(p.x, p.y + 6);
  c.lineTo(p.x, p.y + r + 8);
  c.stroke();
  if (sc.showCharge) {
    const x = 900, y0 = 660, h = 190;
    pill(c, x - 4, y0 - h - 4, 34, h + 8, "rgba(6, 8, 24, 0.8)");
    c.fillStyle = "rgba(62, 224, 143, 0.35)";
    c.fillRect(x, y0 - h * (1 / 1.3), 26, h * (0.25 / 1.3));
    c.fillStyle = "rgba(255, 93, 115, 0.35)";
    c.fillRect(x, y0 - h, 26, h * (0.3 / 1.3));
    const f = Math.min(1, k.charge / 1.3);
    c.fillStyle = k.charge > 1 ? "#ff5d73" : k.charge > 0.75 ? "#3ee08f" : "#ffd23f";
    c.fillRect(x + 5, y0 - h * f, 16, h * f);
    c.fillStyle = "#fff";
    c.font = "800 16px system-ui, sans-serif";
    c.textAlign = "center";
    c.fillText("POWER", x + 13, y0 - h - 18);
  }
}

export function drawBanner(c: CanvasRenderingContext2D, v: View) {
  const b = v.banner;
  if (!b) return;
  const pop = Math.min(1, b.t / 0.18);
  const fade = Math.min(1, (b.dur - b.t) / 0.3);
  c.save();
  c.globalAlpha = Math.max(0, fade);
  c.translate(CX, 200);
  c.scale(0.6 + 0.4 * pop, 0.6 + 0.4 * pop);
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.font = "900 112px system-ui, sans-serif";
  c.lineWidth = 12;
  c.strokeStyle = "rgba(0,0,0,0.75)";
  c.strokeText(b.text, 0, 0);
  c.fillStyle = b.color;
  c.fillText(b.text, 0, 0);
  if (b.sub) {
    c.font = "800 38px system-ui, sans-serif";
    c.lineWidth = 8;
    c.strokeText(b.sub, 0, 82);
    c.fillStyle = "#fff";
    c.fillText(b.sub, 0, 82);
  }
  c.restore();
}

