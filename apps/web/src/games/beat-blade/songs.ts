/**
 * Beat Blade: "The Signal". Every song, every district and every reward is plain data in this file.
 *
 * To add a song: copy one, give it a new id and name, change the tempo, key, chords and patterns (music.ts
 * explains them), and add it to a district. Its beat maps are generated from the music; to hand-make one,
 * add `maps: { normal: \`...\` }` in the text format described in beatmap.ts.
 */
import type { Reward } from "../kitgrid/types";
import type { Difficulty } from "./beatmap";
import type { Song } from "./music";

export interface Track extends Song {
  /** Hand-made maps (optional): beatmap.ts text, one per difficulty. */
  maps?: Partial<Record<Difficulty, string>>;
}

export interface District {
  id: string;
  name: string;
  emoji: string;
  /** The neon colours of the district: blocks of player 1 / 2 and the arena glow. */
  glow: string;
  story: string;
  tracks: Track[];
}

const FOUR = "x...x...x...x...";
const HALF = "x.x.x.x.x.x.x.x.";
const SN = "....x.......x...";

export const DISTRICTS: District[] = [
  {
    id: "harbour", name: "Harbour Lights", emoji: "⚓", glow: "#29d3ff",
    story: "The city went dark the night the music stopped. Only the old harbour beacon still hums. Pick up the blade: every block you cut on the beat sends a pulse down the wires. Light the harbour, and the boats will find their way home.",
    tracks: [
      { id: "first-pulse", name: "First Pulse", bpm: 100, root: 57, scale: "minor", chords: [0, 5, 2, 6], wave: "triangle",
        kick: FOUR, snare: SN, hat: "..x...x...x...x.", bass: "0...0...4...0...", lead: "4.2.0...2.4.....",
        sections: [{ bars: 4, energy: 0 }, { bars: 8, energy: 1 }, { bars: 8, energy: 2 }, { bars: 8, energy: 3 }, { bars: 4, energy: 1 }] },
      { id: "tide-lamps", name: "Tide Lamps", bpm: 108, root: 60, scale: "dorian", chords: [0, 3, 4, 3], wave: "square",
        kick: "x.....x.x.......", snare: SN, hat: HALF, bass: "0..0..0.4..4..2.", lead: "0.2.4.7.4.2.0...",
        sections: [{ bars: 4, energy: 0 }, { bars: 8, energy: 1 }, { bars: 8, energy: 3 }, { bars: 4, energy: 2 }, { bars: 8, energy: 3 }] },
      { id: "beacon", name: "Beacon", bpm: 116, root: 55, scale: "minor", chords: [0, 6, 5, 4], wave: "sawtooth",
        kick: FOUR, snare: SN, hat: "x.xxx.xxx.xxx.xx", bass: "0.0.7.0.0.0.4.2.", lead: "7.4.2.4.7...9.7.",
        sections: [{ bars: 4, energy: 1 }, { bars: 8, energy: 2 }, { bars: 12, energy: 3 }, { bars: 4, energy: 1 }] },
    ],
  },
  {
    id: "market", name: "Night Market", emoji: "🏮", glow: "#ff9f1c",
    story: "The harbour glows and the lantern sellers come back. Their market runs on a swing rhythm, and the stalls light one by one as you cut. Keep the beat and the whole street wakes up.",
    tracks: [
      { id: "lantern-row", name: "Lantern Row", bpm: 104, root: 62, scale: "major", chords: [0, 4, 5, 3], wave: "triangle",
        kick: "x.....x...x.....", snare: SN, hat: "x..x..x.x..x..x.", bass: "0..4..0.2..4..0.", lead: "4.4.2.0.2...4...",
        sections: [{ bars: 4, energy: 0 }, { bars: 8, energy: 1 }, { bars: 8, energy: 2 }, { bars: 8, energy: 3 }] },
      { id: "spice-step", name: "Spice Step", bpm: 112, root: 57, scale: "dorian", chords: [0, 3, 0, 4], wave: "square",
        kick: "x..x..x...x..x..", snare: SN, hat: HALF, bass: "0..0..2...4..2..", lead: "0.2.0.4...2.0...",
        sections: [{ bars: 4, energy: 1 }, { bars: 8, energy: 2 }, { bars: 8, energy: 3 }, { bars: 4, energy: 1 }, { bars: 8, energy: 3 }] },
      { id: "hawker-heat", name: "Hawker Heat", bpm: 120, root: 59, scale: "minor", chords: [0, 2, 5, 4], wave: "sawtooth",
        kick: FOUR, snare: "....x..x....x...", hat: "xxx.xxx.xxx.xxx.", bass: "0.0.0.4.5.5.4.2.", lead: "7.7.4.2.4.2.0...",
        sections: [{ bars: 4, energy: 1 }, { bars: 8, energy: 2 }, { bars: 12, energy: 3 }, { bars: 4, energy: 2 }] },
    ],
  },
  {
    id: "rail", name: "Skyline Rail", emoji: "🚝", glow: "#7cff6b",
    story: "Above the market, the sky trains are frozen between stations. Their engines need a faster pulse. Cut on the beat to spin up the rails, and the trains will carry the light across the city.",
    tracks: [
      { id: "platform-nine", name: "Platform Nine", bpm: 118, root: 64, scale: "minor", chords: [0, 5, 3, 4], wave: "square",
        kick: FOUR, snare: SN, hat: HALF, bass: "0.0.0.0.4.4.2.2.", lead: "0...4...7...4.2.",
        sections: [{ bars: 4, energy: 0 }, { bars: 8, energy: 2 }, { bars: 8, energy: 3 }, { bars: 8, energy: 3 }] },
      { id: "express", name: "Express", bpm: 126, root: 57, scale: "minor", chords: [0, 0, 5, 6], wave: "sawtooth",
        kick: "x...x...x...x.x.", snare: SN, hat: "x.xxx.xxx.xxx.xx", bass: "0.0.7.0.0.7.0.4.", lead: "4.4.4.2.0.2.4...",
        sections: [{ bars: 4, energy: 1 }, { bars: 8, energy: 2 }, { bars: 8, energy: 3 }, { bars: 4, energy: 2 }, { bars: 8, energy: 3 }] },
      { id: "overpass", name: "Overpass", bpm: 132, root: 62, scale: "dorian", chords: [0, 3, 4, 6], wave: "square",
        kick: FOUR, snare: "....x.......x..x", hat: HALF, bass: "0..0..4.0..0..2.", lead: "7.4.2.0.2.4.7.9.",
        sections: [{ bars: 4, energy: 1 }, { bars: 12, energy: 3 }, { bars: 4, energy: 2 }, { bars: 8, energy: 3 }] },
    ],
  },
  {
    id: "tower", name: "Radio Tower", emoji: "📡", glow: "#c77dff",
    story: "The trains reach the hill, where the old radio tower stands silent. If it sings again, every speaker in the city will hear the beat. The songs here are fast and the blocks come from every side. Stay sharp.",
    tracks: [
      { id: "carrier-wave", name: "Carrier Wave", bpm: 124, root: 60, scale: "minor", chords: [0, 6, 5, 6], wave: "sawtooth",
        kick: FOUR, snare: SN, hat: "x.xxx.xxx.xxx.xx", bass: "0.7.0.7.0.7.4.2.", lead: "4.2.0.2.4.4.4...",
        sections: [{ bars: 4, energy: 1 }, { bars: 8, energy: 2 }, { bars: 12, energy: 3 }, { bars: 4, energy: 2 }] },
      { id: "static-bloom", name: "Static Bloom", bpm: 134, root: 55, scale: "dorian", chords: [0, 4, 3, 4], wave: "square",
        kick: "x...x...x..xx...", snare: SN, hat: HALF, bass: "0.0.0.2.4.4.4.2.", lead: "0.4.7.4.9.7.4...",
        sections: [{ bars: 4, energy: 1 }, { bars: 8, energy: 3 }, { bars: 4, energy: 2 }, { bars: 12, energy: 3 }] },
      { id: "full-signal", name: "Full Signal", bpm: 140, root: 57, scale: "minor", chords: [0, 5, 6, 4], wave: "sawtooth",
        kick: FOUR, snare: "....x.......x.x.", hat: "xxxxxxxxxxxxxxxx", bass: "0.0.7.0.5.5.4.4.", lead: "7.9.7.4.2.4.0...",
        sections: [{ bars: 4, energy: 2 }, { bars: 12, energy: 3 }, { bars: 4, energy: 2 }, { bars: 8, energy: 3 }] },
    ],
  },
  {
    id: "core", name: "The Core", emoji: "⚡", glow: "#ff4fd8",
    story: "Under the city, the great power core waits for one last rhythm. Everything you lit is pouring its light down here. Three songs, all at full speed. Cut through them and the whole city comes back on at once.",
    tracks: [
      { id: "ignition", name: "Ignition", bpm: 136, root: 62, scale: "minor", chords: [0, 3, 5, 4], wave: "square",
        kick: FOUR, snare: SN, hat: HALF, bass: "0.0.0.7.0.0.4.2.", lead: "4.7.4.2.0.2.4.7.",
        sections: [{ bars: 4, energy: 1 }, { bars: 12, energy: 3 }, { bars: 4, energy: 2 }, { bars: 8, energy: 3 }] },
      { id: "overdrive", name: "Overdrive", bpm: 144, root: 59, scale: "minor", chords: [0, 6, 5, 6], wave: "sawtooth",
        kick: "x...x...x...xxx.", snare: SN, hat: "x.xxx.xxx.xxx.xx", bass: "0.7.0.7.5.7.4.7.", lead: "7.4.7.9.7.4.2...",
        sections: [{ bars: 4, energy: 2 }, { bars: 12, energy: 3 }, { bars: 4, energy: 2 }, { bars: 12, energy: 3 }] },
      { id: "city-wakes", name: "The City Wakes", bpm: 150, root: 57, scale: "major", chords: [0, 4, 5, 3], wave: "square",
        kick: FOUR, snare: "....x.......x..x", hat: "xxxxxxxxxxxxxxxx", bass: "0.0.4.4.5.5.4.2.", lead: "4.4.7.4.9.7.4.2.",
        sections: [{ bars: 4, energy: 1 }, { bars: 8, energy: 3 }, { bars: 4, energy: 2 }, { bars: 12, energy: 3 }, { bars: 4, energy: 1 }] },
    ],
  },
];

/** Every song in play order: the campaign's levels. */
export const TRACKS: Array<Track & { district: number }> = DISTRICTS.flatMap((d, district) => d.tracks.map((t) => ({ ...t, district })));

/** Saber colours (and later arenas), earned with stars. */
export const REWARDS: Reward[] = [
  { stars: 3, id: "saber-cyan", kind: "skin", name: "Cyan saber", emoji: "🔵" },
  { stars: 8, id: "saber-gold", kind: "skin", name: "Gold saber", emoji: "🟡" },
  { stars: 14, id: "arena-dusk", kind: "theme", name: "Dusk sky", emoji: "🌆" },
  { stars: 20, id: "saber-rainbow", kind: "skin", name: "Rainbow saber", emoji: "🌈" },
  { stars: 28, id: "arena-aurora", kind: "theme", name: "Aurora sky", emoji: "🌌" },
  { stars: 36, id: "saber-white", kind: "skin", name: "White-hot saber", emoji: "⚪" },
  { stars: 45, id: "crown", kind: "trophy", name: "Signal crown", emoji: "👑" },
];
