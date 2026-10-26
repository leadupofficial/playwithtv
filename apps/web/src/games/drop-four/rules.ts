/**
 * Drop Four rules: 7 columns × 6 rows, discs fall to the lowest free space, four in a row (across, up or
 * diagonal) wins, a full board is a draw. Written from scratch.
 *
 * The board is 42 numbers, index = row * 7 + col with row 0 at the BOTTOM: 0 empty, 1 side 0, 2 side 1.
 */
export const W = 7;
export const H = 6;
export type Grid = Int8Array;

export const empty = (): Grid => new Int8Array(W * H);

/** The row a disc dropped in `col` lands on, or -1 when the column is full. */
export function landing(g: Grid, col: number): number {
  for (let r = 0; r < H; r++) if (g[r * W + col] === 0) return r;
  return -1;
}

export const open = (g: Grid) => Array.from({ length: W }, (_, c) => c).filter((c) => landing(g, c) >= 0);

/** Drops a disc for side `s` (in place); returns the row, or -1 if the column is full. */
export function drop(g: Grid, col: number, s: number): number {
  const r = landing(g, col);
  if (r >= 0) g[r * W + col] = s + 1;
  return r;
}

const LINES: number[][] = (() => {
  const out: number[][] = [];
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    for (const [dc, dr] of [[1, 0], [0, 1], [1, 1], [1, -1]] as const) {
      const cells = [0, 1, 2, 3].map((k) => [c + dc * k, r + dr * k] as const);
      if (cells.every(([x, y]) => x >= 0 && x < W && y >= 0 && y < H)) out.push(cells.map(([x, y]) => y * W + x));
    }
  }
  return out;
})();

/** The winning four (cell indexes) if side `s` has one. */
export function four(g: Grid, s: number): number[] | null {
  const v = s + 1;
  for (const l of LINES) if (g[l[0]!] === v && g[l[1]!] === v && g[l[2]!] === v && g[l[3]!] === v) return l;
  return null;
}

export const full = (g: Grid) => open(g).length === 0;

// ---------------------------------------------------------------- the computer player

/** How good the board is for side `s`: open threes and twos in every line of four, and the middle column. */
export function evaluate(g: Grid, s: number): number {
  const me = s + 1, them = 2 - s;
  let v = 0;
  for (const l of LINES) {
    let a = 0, b = 0;
    for (const i of l) {
      if (g[i] === me) a++;
      else if (g[i] === them) b++;
    }
    if (a && b) continue;
    v += a === 3 ? 12 : a === 2 ? 3 : 0;
    v -= b === 3 ? 14 : b === 2 ? 3 : 0;
  }
  for (let r = 0; r < H; r++) v += g[r * W + 3] === me ? 4 : g[r * W + 3] === them ? -4 : 0;
  return v;
}

export interface Brain {
  /** How many discs ahead it reads. */
  depth: number;
  /** Chance of dropping anywhere instead of thinking (it still never skips a win in one). */
  blunder: number;
  /** Chance of missing that the other side is about to win. */
  blind: number;
}

export const NODE_CAP = 60_000;
const ORDER = [3, 2, 4, 1, 5, 0, 6];
const WIN = 100_000;

/** The search pauses after this many positions, so the TV can draw a frame in between (see thinking()). */
export const SLICE = 250;

/** The computer's whole decision at once (tests, tools): the same answer thinking() reaches frame by frame. */
export function think(g: Grid, s: number, brain: Brain, r: () => number): number {
  const it = thinking(g, s, brain, r);
  for (;;) {
    const n = it.next();
    if (n.done) return n.value;
  }
}

/**
 * The computer's decision, one slice of reading at a time: it yields every SLICE positions so the game can
 * spread the search over several frames instead of stalling the TV. The answer depends only on the board,
 * the brain and the random numbers, never on how many slices a frame runs.
 */
export function* thinking(g0: Grid, s: number, brain: Brain, r: () => number): Generator<void, number, void> {
  const g = new Int8Array(g0);
  const cols = open(g);
  if (!cols.length) return -1;
  // a win in one is never missed
  for (const c of cols) {
    const row = drop(g, c, s);
    const won = four(g, s);
    g[row * W + c] = 0;
    if (won) return c;
  }
  if (r() < brain.blunder) return cols[Math.floor(r() * cols.length)]!;
  if (r() >= brain.blind) {
    // block their win in one
    for (const c of cols) {
      const row = drop(g, c, 1 - s);
      const won = four(g, 1 - s);
      g[row * W + c] = 0;
      if (won) return c;
    }
  }
  let nodes = 0;
  let aborted = false;
  const search = function* (me: number, depth: number, alpha: number, beta: number): Generator<void, number, void> {
    if (++nodes > NODE_CAP) { aborted = true; return 0; }
    if (nodes % SLICE === 0) yield;
    if (depth === 0) return evaluate(g, me);
    let best = -Infinity, any = false;
    for (const c of ORDER) {
      const row = drop(g, c, me);
      if (row < 0) continue;
      any = true;
      const v = four(g, me) ? WIN + depth : -(yield* search(1 - me, depth - 1, -beta, -alpha));
      g[row * W + c] = 0;
      if (aborted) return 0;
      if (v > best) best = v;
      if (v > alpha) alpha = v;
      if (alpha >= beta) break;
    }
    return any ? best : 0; // full board: a draw
  };
  // read one disc deeper at a time, keeping the last answer that finished in time
  let pick = cols.includes(3) ? 3 : cols[0]!;
  for (let d = 1; d <= brain.depth; d++) {
    let top = -Infinity, choice = -1;
    const ties: number[] = [];
    for (const c of ORDER) {
      const row = drop(g, c, s);
      if (row < 0) continue;
      const v = -(yield* search(1 - s, d - 1, -Infinity, Infinity));
      g[row * W + c] = 0;
      if (aborted) break;
      if (v > top) { top = v; choice = c; ties.length = 0; ties.push(c); }
      else if (v === top) ties.push(c);
    }
    if (aborted) break;
    pick = ties.length > 1 && top < WIN / 2 && top > -WIN / 2 ? ties[Math.floor(r() * ties.length)]! : choice;
  }
  return pick;
}
