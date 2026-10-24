/**
 * KALARI CLASH arenas: gameplay shape (pure) plus what the views need to dress them. The 3D scenery and the lite
 * backdrops are made from the same Blender scenes (tools/blender/kalari/arenas.py), so the floor size here must
 * match the floor there.
 */
import type { Arena } from "./rules";

export interface ArenaDef {
  id: string;
  name: string;
  tagline: string;
  rules: Arena;
  /** What falling off looks like: "water" (splash), "drop" (a long fall). */
  edge: "water" | "drop";
  weather: "embers" | "rain" | "leaves";
  /** HDRI for image-based light on high/ultra (Poly Haven, CC0). */
  hdri: string;
  /** Lamp flames (x, y, z) for real-time glow and lite flicker sprites. */
  lamps: Array<[number, number, number]>;
  fog: string;
}

export const ARENAS: ArenaDef[] = [
  {
    id: "courtyard", name: "Temple Courtyard", tagline: "Dusk, oil lamps, and the lotus pond waiting below",
    rules: { id: "courtyard", hx: 6.5, hz: 3.6, walls: { left: false, right: false, back: true, front: false } },
    edge: "water", weather: "embers", hdri: "dusk", fog: "#3a2440",
    lamps: [[-6.9, 1.35, -4.3], [-2.3, 1.35, -4.3], [2.3, 1.35, -4.3], [6.9, 1.35, -4.3], [-7.4, 0.95, 4.2], [7.4, 0.95, 4.2]],
  },
  {
    id: "docks", name: "Harbour Docks", tagline: "Monsoon rain on the pier: one slip and you're swimming",
    rules: { id: "docks", hx: 6.8, hz: 3.4, walls: { left: false, right: false, back: false, front: false } },
    edge: "water", weather: "rain", hdri: "overcast", fog: "#4c5a63",
    lamps: [[-6.6, 2.4, -3.9], [6.6, 2.4, -3.9]],
  },
  {
    id: "rooftop", name: "Coconut Grove Rooftop", tagline: "Golden hour on the tiles, palms all around",
    rules: { id: "rooftop", hx: 6.0, hz: 3.5, walls: { left: true, right: false, back: false, front: false } },
    edge: "drop", weather: "leaves", hdri: "golden", fog: "#c98e5a",
    lamps: [[-6.4, 1.1, -3.9], [-6.4, 1.1, 3.9]],
  },
];

export const arenaDef = (id: string) => ARENAS.find((a) => a.id === id) ?? ARENAS[0]!;
