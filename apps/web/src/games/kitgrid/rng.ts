/** Small seeded random numbers (mulberry32): the same seed always plays the same level, which tests rely on. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(r: () => number, xs: readonly T[]): T {
  return xs[Math.floor(r() * xs.length)]!;
}

export function shuffle<T>(r: () => number, xs: T[]): T[] {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [xs[i], xs[j]] = [xs[j]!, xs[i]!];
  }
  return xs;
}

export type Dir = "up" | "down" | "left" | "right";
export const DIRS: Dir[] = ["up", "right", "down", "left"];
export const DELTA: Record<Dir, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
export const OPPOSITE: Record<Dir, Dir> = { up: "down", down: "up", left: "right", right: "left" };
/** Sprite rotation (radians) for a sprite drawn facing right. */
export const ANGLE: Record<Dir, number> = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 };
