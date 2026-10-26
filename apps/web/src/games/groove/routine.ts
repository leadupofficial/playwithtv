/**
 * Dance routines as plain text, so anyone can write one without code.
 *
 *   intro:  . . . . | . . . .
 *   A:      up - down - | left - right -
 *   B:      punch punch pull - | shimmy - - -
 *   song:   intro A A B B A A B B
 *
 * Each phrase is one or more bars split by "|"; a bar has 4 beats (or 8 half-beats for quick steps).
 * A beat is a move name (see moves.ts: up, down, punch, pull, left, right, twist-l, twist-r, shimmy),
 * "-" = keep dancing the last move (no new move), "." = rest. The "song:" line plays the phrases in order;
 * write "A*4" to repeat a phrase. The routine must last exactly as many bars as its song (a test checks).
 */
import { MOVE_IDS, type MoveId } from "./moves";

export interface Step {
  /** Song time of the move, ms. */
  t: number;
  move: MoveId;
  /** How long until the next move or rest, ms (the coach holds the pose this long). */
  hold: number;
  /** Bar and beat, for messages. */
  bar: number;
  beat: number;
}

export interface Routine {
  steps: Step[];
  bars: number;
}

export type Difficulty = "easy" | "normal" | "hard";
export const DIFFICULTIES: Difficulty[] = ["easy", "normal", "hard"];

const isMove = (s: string): s is MoveId => (MOVE_IDS as string[]).includes(s);

/** Parses a routine; throws with a line-and-bar message a non-coder can act on. */
export function parseRoutine(text: string, bpm: number): Routine {
  const phrases = new Map<string, string[][]>();
  let order: string[] | null = null;
  const lines = text.split("\n").map((l) => l.replace(/#.*/, "").trim()).filter(Boolean);
  for (const line of lines) {
    const m = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) throw new Error(`routine: "${line}" needs a name and a colon, like "A: up - down -"`);
    const [, name, body] = m as unknown as [string, string, string];
    if (name === "song") {
      order = body.split(/\s+/).filter(Boolean).flatMap((tok) => {
        const r = /^(.+?)(?:\*(\d+))?$/.exec(tok)!;
        return Array.from({ length: Number(r[2] ?? 1) }, () => r[1]!);
      });
      continue;
    }
    const bars = body.split("|").map((b) => b.trim().split(/\s+/).filter(Boolean));
    bars.forEach((b, i) => {
      if (b.length !== 4 && b.length !== 8) throw new Error(`routine: phrase ${name}, bar ${i + 1} has ${b.length} beats (use 4, or 8 for half-beats)`);
      for (const tok of b) if (tok !== "-" && tok !== "." && !isMove(tok)) throw new Error(`routine: phrase ${name} has "${tok}": use a move name, "-" or "."`);
    });
    phrases.set(name, bars);
  }
  if (!order) throw new Error('routine: missing the "song:" line');
  const beatMs = 60_000 / bpm;
  const steps: Step[] = [];
  let bar = 0;
  let lastAt = -1; // index of the step still being held
  for (const name of order) {
    const p = phrases.get(name);
    if (!p) throw new Error(`routine: the song plays "${name}" but there is no phrase called that`);
    for (const b of p) {
      const per = 4 / b.length;
      b.forEach((tok, i) => {
        const t = (bar * 4 + i * per) * beatMs;
        if (tok === "-") return;
        if (lastAt >= 0) { steps[lastAt]!.hold = t - steps[lastAt]!.t; lastAt = -1; }
        if (tok === ".") return;
        steps.push({ t, move: tok as MoveId, hold: beatMs, bar: bar + 1, beat: i * per + 1 });
        lastAt = steps.length - 1;
      });
      bar++;
    }
  }
  if (lastAt >= 0) steps[lastAt]!.hold = bar * 4 * beatMs - steps[lastAt]!.t;
  return { steps, bars: bar };
}

/**
 * The routine for a difficulty. Normal and hard dance it as written (hard judges tighter); easy keeps one
 * move per half bar at most and turns quick half-beat steps into the move on the beat.
 */
export function forDifficulty(r: Routine, d: Difficulty, bpm: number): Step[] {
  if (d !== "easy") return r.steps;
  const half = (2 * 60_000) / bpm;
  const out: Step[] = [];
  for (const s of r.steps) {
    const prev = out[out.length - 1];
    if (prev && s.t - prev.t < half - 1) { prev.hold = s.t + s.hold - prev.t; continue; }
    out.push({ ...s });
  }
  return out;
}
