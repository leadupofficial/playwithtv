/**
 * Kings Row rules: classic 8×8 draughts (English checkers), written from scratch.
 *
 *  - Pieces sit on the dark squares; side 0 starts at the bottom and moves up, side 1 at the top moves down.
 *  - Men step one square diagonally forward; kings step one square diagonally either way.
 *  - Captures jump an enemy piece onto the empty square beyond it. If you can capture, you must, and you keep
 *    jumping while you can (you pick which way). A man that reaches the far row becomes a king and its move ends.
 *  - You lose when it's your turn and you have no move (no pieces, or every piece blocked).
 *  - Draw: 50 moves in a row (each side) without a capture or a man moving.
 *
 * The board is 64 numbers, index = y * 8 + x, y = 0 at the top: 0 empty, 1/2 side 0 man/king, -1/-2 side 1.
 */
export type Board = Int8Array;

export interface Move {
  /** Squares visited: start, then each landing square. */
  path: number[];
  /** Squares of the pieces jumped (empty for a step). */
  caps: number[];
}

export const N = 8;
export const DRAW_PLIES = 100;
export const dark = (i: number) => ((i >> 3) + (i & 7)) % 2 === 1;
export const side = (p: number) => (p > 0 ? 0 : p < 0 ? 1 : -1);

export function startBoard(): Board {
  const b = new Int8Array(64);
  for (let i = 0; i < 64; i++) {
    if (!dark(i)) continue;
    const y = i >> 3;
    if (y <= 2) b[i] = -1;
    else if (y >= 5) b[i] = 1;
  }
  return b;
}

/** A board from 8 lines of text: `.` empty, `o`/`O` side 0 man/king, `x`/`X` side 1 man/king (tests, puzzles). */
export function parseBoard(rows: string[]): Board {
  const b = new Int8Array(64);
  rows.forEach((r, y) => [...r].forEach((c, x) => (b[y * 8 + x] = c === "o" ? 1 : c === "O" ? 2 : c === "x" ? -1 : c === "X" ? -2 : 0)));
  return b;
}

const DIRS: Array<[number, number]> = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
function dirsFor(p: number): Array<[number, number]> {
  if (Math.abs(p) === 2) return DIRS;
  return p > 0 ? DIRS.slice(0, 2) : DIRS.slice(2);
}
const at = (x: number, y: number) => (x >= 0 && x < 8 && y >= 0 && y < 8 ? y * 8 + x : -1);
const crownRow = (s: number) => (s === 0 ? 0 : 7);

function jumps(b: Board, from: number, piece: number, path: number[], caps: number[], out: Move[]) {
  let more = false;
  const x = from & 7, y = from >> 3, me = side(piece);
  for (const [dx, dy] of dirsFor(piece)) {
    const over = at(x + dx, y + dy), to = at(x + 2 * dx, y + 2 * dy);
    if (over < 0 || to < 0 || b[to] !== 0 || side(b[over]!) !== 1 - me || caps.includes(over)) continue;
    more = true;
    const crowned = Math.abs(piece) === 1 && to >> 3 === crownRow(me);
    if (crowned) out.push({ path: [...path, to], caps: [...caps, over] });
    else {
      // the jumping piece is lifted off its start square while it jumps
      const saved = b[from]!;
      b[from] = 0;
      jumps(b, to, piece, [...path, to], [...caps, over], out);
      b[from] = saved;
    }
  }
  if (!more && caps.length) out.push({ path, caps });
}

/** Every legal move for side `s` (captures only, when any capture exists). */
export function moves(b: Board, s: number): Move[] {
  const caps: Move[] = [];
  for (let i = 0; i < 64; i++) if (side(b[i]!) === s) {
    const piece = b[i]!;
    b[i] = 0;
    jumps(b, i, piece, [i], [], caps);
    b[i] = piece;
  }
  if (caps.length) return caps;
  const steps: Move[] = [];
  for (let i = 0; i < 64; i++) if (side(b[i]!) === s) {
    for (const [dx, dy] of dirsFor(b[i]!)) {
      const to = at((i & 7) + dx, (i >> 3) + dy);
      if (to >= 0 && b[to] === 0) steps.push({ path: [i, to], caps: [] });
    }
  }
  return steps;
}

/** The board after a move (a new array). */
export function play(b: Board, m: Move): Board {
  const n = new Int8Array(b);
  const from = m.path[0]!, to = m.path[m.path.length - 1]!;
  let p = n[from]!;
  n[from] = 0;
  for (const c of m.caps) n[c] = 0;
  if (Math.abs(p) === 1 && to >> 3 === crownRow(side(p))) p *= 2;
  n[to] = p;
  return n;
}

export function count(b: Board, s: number) {
  let men = 0, kings = 0;
  for (const p of b) if (side(p) === s) Math.abs(p) === 2 ? kings++ : men++;
  return { men, kings, all: men + kings };
}

export const sameMove = (a: Move, b: Move) => a.path.length === b.path.length && a.path.every((v, i) => v === b.path[i]);

// ---------------------------------------------------------------- the computer player

/** How good the board is for side `s` (positive: good). */
export function evaluate(b: Board, s: number): number {
  let v = 0;
  for (let i = 0; i < 64; i++) {
    const p = b[i]!;
    if (!p) continue;
    const y = i >> 3, x = i & 7;
    let w = Math.abs(p) === 2 ? 165 : 100;
    if (Math.abs(p) === 1) w += (p > 0 ? 7 - y : y) * 3; // men that have marched forward
    if (Math.abs(p) === 1 && y === (p > 0 ? 7 : 0)) w += 6; // the back row guards against kings
    if (x >= 2 && x <= 5 && y >= 2 && y <= 5) w += 4; // the centre
    v += side(p) === s ? w : -w;
  }
  return v;
}

export interface Brain {
  /** How many moves ahead it reads (plies). */
  depth: number;
  /** Chance of just playing a random legal move instead. */
  blunder: number;
  /** Random noise added to every score (bigger = sloppier). */
  noise: number;
}

/** Searches at most this many positions per move, so a slow TV never stalls. */
export const NODE_CAP = 40_000;

export function think(b: Board, s: number, brain: Brain, r: () => number): Move | null {
  const all = moves(b, s);
  if (!all.length) return null;
  if (all.length === 1) return all[0]!;
  if (r() < brain.blunder) return all[Math.floor(r() * all.length)]!;
  let nodes = 0;
  const cap = NODE_CAP / all.length; // every first move gets the same share of the reading
  const search = (bd: Board, me: number, depth: number, alpha: number, beta: number): number => {
    nodes++;
    const ms = moves(bd, me);
    if (!ms.length) return -10_000 - depth; // no moves: lost (sooner is worse)
    // at the horizon, keep reading while there are captures (never stop in the middle of an exchange)
    if ((depth <= 0 && !ms[0]!.caps.length) || nodes > cap) return evaluate(bd, me);
    let best = -Infinity;
    for (const m of ms) {
      const v = -search(play(bd, m), 1 - me, depth - 1, -beta, -alpha);
      if (v > best) best = v;
      if (v > alpha) alpha = v;
      if (alpha >= beta) break;
    }
    return best;
  };
  let pick = all[0]!, top = -Infinity;
  for (const m of all) {
    nodes = 0;
    const v = -search(play(b, m), 1 - s, brain.depth - 1, -Infinity, Infinity) + (r() - 0.5) * 2 * brain.noise;
    if (v > top) { top = v; pick = m; }
  }
  return pick;
}
