/**
 * The gully: one lane between two rows of houses. Shared numbers for the simulation, the real-time scene and the
 * Blender scene (tools/blender/scenes/gully_lane.py repeats them; keep both in step).
 *
 * World axes (three.js): metres, y up. The batter's brick-stack stumps stand at the origin; the bowler runs in
 * from -z towards +z. A right-handed batter faces -z; the off side is +x (screen left from the bowler's end).
 */
export const LANE = {
  /** House fronts on both sides (x = ±halfWidth). */
  halfWidth: 5,
  /** Brick stack (the stumps) at the origin. */
  stumps: { halfWidth: 0.2, height: 0.72, z: 0 },
  /** Where bat meets ball (the batter stands at the crease, just in front of the stumps). */
  contactZ: -1.25,
  batter: { x: -0.42, z: -0.85 },
  /** Bowler's release point. */
  release: { x: 0.3, y: 2.0, z: -13.2 },
  bowlerCreaseZ: -13.6,
  nonStriker: { x: -1.0, z: -13.8 },
  /** Past this line (towards -z) the ball is over the boundary: on the full = SIX, along the ground = FOUR. */
  boundaryZ: -28,
  /** The compound wall behind the keeper. */
  backWallZ: 4.2,
  /** A house front hit on the full at or above this height = onto the balcony / roof = SIX. */
  balconyY: 3.5,
  /** Rooftops: a ball higher than this when it reaches the houses is out of the gully (SIX, lost ball). */
  roofY: 7.2,
  /** The neighbours' windows (a hit on the full = bonus runs and broken glass). x is the house side. */
  windows: [
    { side: 1 as const, z0: -12.6, z1: -10.8, y0: 3.7, y1: 5.1 },
    { side: -1 as const, z0: -19.4, z1: -17.6, y0: 3.7, y1: 5.1 },
  ],
  /** The sleeping dog on the boundary. */
  dog: { x: 1.6, z: -29.2 },
  /** The parked auto-rickshaw at the bowler's end (leg side). */
  auto: { x: -3.3, z: -16.2 },
} as const;

/** Fielding spots (keeper first). The bowler follows through and fields too. */
export const FIELD_SPOTS: ReadonlyArray<{ name: string; x: number; z: number }> = [
  { name: "keeper", x: 0, z: 2.3 },
  { name: "point", x: 3.3, z: -6.5 },
  { name: "midwicket", x: -3.2, z: -8.0 },
  { name: "long-on", x: -1.2, z: -21 },
];

export const G = 9.81;

/** Small seedable PRNG (mulberry32): the same seed always plays the same match. */
export function rng(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
/** A rough normal sample from a uniform source (sum of three). */
export const gauss = (r: () => number) => (r() + r() + r() - 1.5) * 1.15;
