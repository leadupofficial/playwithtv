/**
 * Beat Blade beat maps: what flies at you, and when.
 *
 * A map is plain text, so anyone can write one without code. One line = one step (half a beat by default),
 * four cells per line = the four lanes, left to right:
 *
 *   .      nothing
 *   m^     a block in the middle row, cut UP      rows: l (low), m (middle), h (high)
 *   lv     a block in the low row, cut DOWN       directions: ^ up, v down, < left, > right, o any way
 *   B / Bh a bomb (default middle row): don't cut it
 *   W3     a wall in this lane for 3 steps: lean (aim) out of its way. Neighbouring W cells join into one wall.
 *
 *   # comments and blank lines are ignored
 *   step 1/4    changes the step length (beats per line) from here on: 1, 1/2, 1/4
 *
 * One phone is one saber, so a good map flows: after cutting down, the next cut is up; after left, right.
 * `generate()` writes maps from the song's own beats for every song that has no hand-made map.
 */
import { songBeats, type Song } from "./music";

export type Dir = "u" | "d" | "l" | "r" | "o";
export type Difficulty = "easy" | "normal" | "hard";
export const DIFFICULTIES: Difficulty[] = ["easy", "normal", "hard"];

export interface Note {
  /** Song time of the beat, ms. */
  t: number;
  kind: "block" | "bomb" | "wall";
  /** 0..3 left to right (a wall: its leftmost lane). */
  lane: number;
  /** 0 low, 1 middle, 2 high. */
  row: number;
  dir: Dir;
  /** Walls: how many lanes wide and how long (ms). */
  width?: number;
  len?: number;
}

const DIR_OF: Record<string, Dir> = { "^": "u", v: "d", "<": "l", ">": "r", o: "o" };
const ROW_OF: Record<string, number> = { l: 0, m: 1, h: 2 };
export const DIR_CHAR: Record<Dir, string> = { u: "^", d: "v", l: "<", r: ">", o: "o" };

export class MapError extends Error {}

/** Text → notes, sorted by time. Throws MapError with the line number on anything it can't read. */
export function parseMap(text: string, bpm: number): Note[] {
  const beatMs = 60_000 / bpm;
  let step = 0.5;
  let t = 0;
  const notes: Note[] = [];
  text.split("\n").forEach((raw, i) => {
    const line = raw.replace(/#.*/, "").trim();
    if (!line) return;
    const m = /^step\s+(\d+)(?:\/(\d+))?$/.exec(line);
    if (m) {
      step = Number(m[1]) / Number(m[2] ?? 1);
      if (!(step > 0) || step > 4) throw new MapError(`line ${i + 1}: step must be between 1/16 and 4 beats`);
      return;
    }
    const cells = line.split(/\s+/);
    if (cells.length !== 4) throw new MapError(`line ${i + 1}: needs 4 cells (one per lane), found ${cells.length}`);
    let wall: Note | null = null;
    cells.forEach((c, lane) => {
      if (c === ".") { wall = null; return; }
      const w = /^W(\d*)$/.exec(c);
      if (w) {
        const len = Number(w[1] || 1) * step * beatMs;
        if (wall && wall.len === len) wall.width! += 1;
        else notes.push((wall = { t, kind: "wall", lane, row: 1, dir: "o", width: 1, len }));
        return;
      }
      wall = null;
      const b = /^B([lmh]?)$/.exec(c);
      if (b) { notes.push({ t, kind: "bomb", lane, row: ROW_OF[b[1] || "m"]!, dir: "o" }); return; }
      const k = /^([lmh])([\^v<>o])$/.exec(c);
      if (!k) throw new MapError(`line ${i + 1}, lane ${lane + 1}: "${c}" is not a block (like m^), bomb (B) or wall (W2)`);
      notes.push({ t, kind: "block", lane, row: ROW_OF[k[1]!]!, dir: DIR_OF[k[2]!]! });
    });
    t += step * beatMs;
  });
  return notes.sort((a, b) => a.t - b.t);
}

/** Notes → text (one line per half beat), e.g. to start a hand-made map from a generated one. */
export function formatMap(notes: Note[], bpm: number): string {
  const half = 30_000 / bpm;
  const end = Math.max(0, ...notes.map((n) => n.t));
  const lines: string[] = [];
  for (let s = 0; s * half <= end + 1; s++) {
    const cells = [".", ".", ".", "."];
    for (const n of notes) {
      if (Math.abs(n.t - s * half) > 1) continue;
      for (let w = 0; w < (n.width ?? 1); w++) {
        cells[n.lane + w] = n.kind === "wall" ? `W${Math.max(1, Math.round((n.len ?? half) / half))}`
          : n.kind === "bomb" ? `B${"lmh"[n.row]}` : `${"lmh"[n.row]}${DIR_CHAR[n.dir]}`;
      }
    }
    lines.push(cells.join(" "));
  }
  return lines.join("\n");
}

/** Deterministic random from a seed (maps must come out the same on every TV). */
export function rng(seed: number) {
  let s = (seed >>> 0) || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

const FLOW: Record<Dir, Dir> = { u: "d", d: "u", l: "r", r: "l", o: "o" };

/**
 * A map from the song itself: blocks land on its kicks and snares, more of them where the music is busier.
 *   easy    every other beat, middle row, up/down/any, no bombs or walls
 *   normal  every beat (half beats in the loudest parts), all directions, a few bombs
 *   hard    half beats when the music is busy, all rows, bombs and walls
 * Blocks always flow (down → up, left → right) and the aim moves at most two lanes between quick cuts.
 */
export function generate(song: Song, d: Difficulty, bars = song.sections.reduce((a, s) => a + s.bars, 0)): Note[] {
  const r = rng(hash(`${song.id}:${d}`));
  const beatMs = 60_000 / song.bpm;
  const beats = songBeats(song, bars);
  const notes: Note[] = [];
  let dir: Dir = "d";
  let lane = 1, row = 1, lastT = -1e9, wallUntil = -1;
  for (const b of beats) {
    if (b.energy === 0 && d !== "hard") continue; // intros breathe
    // half beats only where the music is busy, and never quicker than one saber can follow comfortably
    const halfMs = beatMs / 2;
    const halfOk = d === "hard" ? b.energy >= 2 && (song.bpm < 128 || b.bar % 2 === 0) && halfMs >= 190
      : d === "normal" ? b.energy >= 3 && song.bpm < 116 && b.beatInBar % 2 === 1 : false;
    const halves = halfOk ? [0, 0.5] : [0];
    for (const h of halves) {
      if (d === "easy" && b.index % 2 === 1) continue;
      if (b.bar % 8 === 7 && b.beatInBar === 3 && h === 0) continue; // a breath before each phrase
      const t = (b.index + h) * beatMs;
      if (t < wallUntil) continue;
      // a wall now and then (hard): lean away from it, nothing else to do meanwhile
      if (d === "hard" && h === 0 && b.beatInBar === 0 && b.bar % 4 === 2 && r() < 0.6) {
        const left = r() < 0.5;
        notes.push({ t, kind: "wall", lane: left ? 0 : 2, row: 1, dir: "o", width: 2, len: beatMs * 2 });
        lane = left ? 3 : 0;
        wallUntil = t + beatMs * 2.5;
        continue;
      }
      const quick = t - lastT < beatMs * 0.75;
      if (d === "easy") {
        dir = r() < 0.25 ? "o" : dir === "d" ? "u" : "d";
        lane = clamp(lane + pick(r, [-1, 0, 1]), 1, 2);
        row = 1;
      } else {
        const turn = !quick && r() < (d === "hard" ? 0.35 : 0.25); // switch between vertical and sideways swings
        const prev: Dir = dir === "o" ? "d" : dir;
        dir = turn ? (prev === "u" || prev === "d" ? (r() < 0.5 ? "l" : "r") : (r() < 0.5 ? "u" : "d")) : FLOW[prev];
        if (!quick && r() < 0.12) dir = "o";
        // cutting left ends on the left: the next block sits where the saber is heading
        const step = dir === "l" ? -1 : dir === "r" ? 1 : pick(r, [-1, 0, 0, 1]);
        lane = clamp(lane + (quick ? Math.sign(step) : step * (r() < 0.3 ? 2 : 1)), 0, 3);
        row = d === "hard" ? clamp(row + pick(r, [-1, 0, 0, 1]), 0, 2) : dir === "u" ? 0 : dir === "d" ? 2 : 1;
        if (d === "normal" && row !== 1 && r() < 0.5) row = 1;
      }
      notes.push({ t, kind: "block", lane, row, dir });
      lastT = t;
      // bombs sit in the lanes the saber is NOT heading for
      if (d !== "easy" && h === 0 && r() < (d === "hard" ? 0.18 : 0.08)) {
        const far = lane <= 1 ? 3 : 0;
        notes.push({ t: t + beatMs * 0.5, kind: "bomb", lane: far, row: 1, dir: "o" });
      }
    }
  }
  return notes.sort((a, b) => a.t - b.t);
}

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const pick = <T,>(r: () => number, a: T[]) => a[Math.floor(r() * a.length)]!;
