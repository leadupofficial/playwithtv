import { scoreFrames, totalScore } from "./scoring";
import { pinSpot, type Lane } from "./physics";
import { W, H } from "./render";

/** Score sheet and side panels for Bowling Master. The sheet is drawn to its own canvas only when it changes. */

export interface HudPlayer { id: string; name: string; color: string; emoji: string }

const FONT = "'Baloo 2', system-ui, sans-serif";
const ROW = 50;

export function boardSize(players: number, frames: number) {
  const cw = frames >= 10 ? 76 : 120;
  return { w: 210 + frames * cw + 110, h: players * ROW + 8, cw };
}

/** Redraws the score sheet (names, marks per ball, running totals) into `cv`. */
export function paintBoard(cv: HTMLCanvasElement, players: HudPlayer[], rolls: Map<string, number[]>, frames: number, current: number) {
  const { w, h, cw } = boardSize(players.length, frames);
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  const c = cv.getContext("2d")!;
  c.clearRect(0, 0, w, h);
  c.fillStyle = "rgba(14, 7, 36, 0.97)";
  c.beginPath();
  c.roundRect(0, 0, w, h, 16);
  c.fill();
  c.textBaseline = "middle";
  players.forEach((p, r) => {
    const y = 4 + r * ROW;
    if (r === current) {
      c.fillStyle = "rgba(255, 255, 255, 0.12)";
      c.beginPath();
      c.roundRect(4, y, w - 8, ROW - 2, 12);
      c.fill();
      c.fillStyle = p.color;
      c.fillRect(4, y + 6, 6, ROW - 14);
    }
    c.fillStyle = p.color;
    c.font = `800 24px ${FONT}`;
    c.textAlign = "left";
    const name = p.name.length > 9 ? `${p.name.slice(0, 8)}…` : p.name;
    c.fillText(`${p.emoji} ${name}`, 18, y + ROW / 2);
    const fv = scoreFrames(rolls.get(p.id) ?? [], frames);
    for (let f = 0; f < frames; f++) {
      const x = 210 + f * cw;
      c.strokeStyle = "rgba(255, 255, 255, 0.18)";
      c.lineWidth = 1;
      c.strokeRect(x + 0.5, y + 2.5, cw - 3, ROW - 7);
      const fr = fv[f];
      if (!fr) continue;
      const boxes = f === frames - 1 ? 3 : 2;
      const bw = Math.min(26, (cw - 6) / boxes);
      c.font = `800 19px ${FONT}`;
      c.textAlign = "center";
      fr.marks.forEach((m, i) => {
        // a strike in a normal frame is shown in the right-hand box, like a paper sheet
        const slot = boxes === 2 && fr.strike ? 1 : i;
        const bx = x + cw - 3 - (boxes - slot) * bw;
        c.fillStyle = m === "X" ? "#ffd23f" : m === "/" ? "#7cf2ff" : "#ffffff";
        c.fillText(m, bx + bw / 2, y + 15);
      });
      if (fr.total !== null) {
        c.font = `700 21px ${FONT}`;
        c.fillStyle = "#f7f4ff";
        c.fillText(String(fr.total), x + cw / 2 - 2, y + 36);
      }
    }
    c.font = `900 30px ${FONT}`;
    c.textAlign = "center";
    c.fillStyle = "#ffffff";
    c.fillText(String(totalScore(rolls.get(p.id) ?? [], frames)), 210 + frames * cw + 52, y + ROW / 2 + 1);
  });
}

export interface SideInfo {
  name: string;
  color: string;
  emoji: string;
  frameText: string;
  spin: number;
  hint: string;
  /** Power meter 0…1 while charging (buttons), else null. */
  meter: number | null;
  clock: number | null;
}

/** The bowler's panel (left), the pin diagram and the power meter (right). Cheap: a few shapes and lines of text. */
export function drawSide(c: CanvasRenderingContext2D, lane: Lane, info: SideInfo | null) {
  // pin diagram: which pins are still standing for this ball
  const ox = 1110, oy = 690;
  c.fillStyle = "rgba(12, 6, 32, 0.78)";
  c.beginPath();
  c.roundRect(ox - 98, oy - 128, 196, 136, 18);
  c.fill();
  for (const p of lane.pins) {
    const s = pinSpot(p.n);
    const x = ox + s.x * 190, y = oy - 24 - (s.y - pinSpot(1).y) * 118;
    const up = !p.cleared && p.standing && !p.gone && Math.abs(p.x) < 0.53;
    c.fillStyle = up ? "#ffffff" : p.cleared ? "rgba(255,255,255,0.08)" : "rgba(255, 93, 115, 0.55)";
    c.beginPath();
    c.arc(x, y, 12, 0, Math.PI * 2);
    c.fill();
    if (up) { c.fillStyle = "#d8203a"; c.fillRect(x - 7, y - 2, 14, 4); }
  }
  if (!info) return;
  c.fillStyle = "rgba(12, 6, 32, 0.78)";
  c.beginPath();
  c.roundRect(36, H - 196, 420, 168, 20);
  c.fill();
  c.fillStyle = info.color;
  c.fillRect(36, H - 196, 8, 168);
  c.textAlign = "left";
  c.textBaseline = "middle";
  c.font = `900 40px ${FONT}`;
  c.fillStyle = info.color;
  c.fillText(`${info.emoji} ${info.name.length > 12 ? `${info.name.slice(0, 11)}…` : info.name}`, 60, H - 160);
  c.font = `700 26px ${FONT}`;
  c.fillStyle = "#f7f4ff";
  c.fillText(info.frameText, 60, H - 118);
  c.fillStyle = info.spin === 0 ? "#b9b2dd" : "#7cf2ff";
  c.fillText(info.spin < 0 ? "Hook ↶ left" : info.spin > 0 ? "Hook ↷ right" : "Straight ball", 60, H - 84);
  c.font = `600 20px ${FONT}`;
  c.fillStyle = "#b9b2dd";
  c.fillText(info.hint, 60, H - 50);
  if (info.meter !== null) {
    const x = W - 70, top = 250, hgt = 300;
    c.fillStyle = "rgba(12, 6, 32, 0.8)";
    c.beginPath();
    c.roundRect(x - 22, top - 44, 64, hgt + 60, 16);
    c.fill();
    const fill = hgt * info.meter;
    c.fillStyle = info.meter > 0.85 ? "#ff5d73" : info.meter > 0.5 ? "#ffd23f" : "#3ee08f";
    c.fillRect(x - 8, top + hgt - fill, 36, fill);
    c.strokeStyle = "#ffffff";
    c.lineWidth = 2;
    c.strokeRect(x - 8, top, 36, hgt);
    c.font = `800 20px ${FONT}`;
    c.textAlign = "center";
    c.fillStyle = "#ffffff";
    c.fillText("POWER", x + 10, top - 22);
  }
  if (info.clock !== null) {
    c.font = `900 54px ${FONT}`;
    c.textAlign = "center";
    c.fillStyle = info.clock <= 3 ? "#ff5d73" : "#ffd23f";
    c.fillText(String(Math.ceil(info.clock)), W - 70, 620);
  }
}
