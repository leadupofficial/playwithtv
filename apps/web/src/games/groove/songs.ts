/**
 * Groove Party: "World Tour". Every city, song, routine and reward is plain data in this file.
 *
 * To add a song: copy one, give it a new id and name, change the music (beat-blade/music.ts explains the
 * patterns) and write its routine (routine.ts explains the format: move names, "-" hold, "." rest, one bar
 * per "|"). A test checks every routine lasts exactly as long as its song and uses only real moves.
 * Then add it to a city. The music is composed as patterns and played by the in-browser synthesiser: no
 * recordings, so nothing here is anyone else's song.
 */
import type { Reward } from "../kitgrid/types";
import type { Song } from "../beat-blade/music";

export interface Dance extends Song {
  /** The routine, in routine.ts text. */
  routine: string;
  /** Coach outfit colours: top, trousers. */
  coach: [string, string];
}

export interface City {
  id: string;
  name: string;
  emoji: string;
  /** Stage lights. */
  glow: string;
  /** Backdrop gradient, top → bottom. */
  sky: [string, string];
  story: string;
  dances: Dance[];
}

const FOUR = "x...x...x...x...";
const SN = "....x.......x...";
const HALF = "x.x.x.x.x.x.x.x.";

export const CITIES: City[] = [
  {
    id: "disco", name: "Disco Downtown", emoji: "🪩", glow: "#ffd23f", sky: ["#2a0b3d", "#08040f"],
    story: "The World Tour starts tonight in a basement club where the mirror ball still spins. The crowd is shy and the coach is waiting. Hold your phone in your right hand, copy every move, and get this city on its feet.",
    dances: [
      {
        id: "mirror-ball", name: "Mirror Ball", bpm: 100, root: 57, scale: "minor", chords: [0, 5, 3, 4], wave: "square", coach: ["#ffd23f", "#3b2a6b"],
        kick: FOUR, snare: SN, hat: "..x...x...x...x.", bass: "0.0.4.0.0.0.4.2.", lead: "4.2.0...2.4.7...",
        sections: [{ bars: 4, energy: 0 }, { bars: 8, energy: 1 }, { bars: 8, energy: 2 }, { bars: 8, energy: 3 }, { bars: 4, energy: 1 }],
        routine: `
          intro: . . . . | . . . . | up - - - | down - - -
          A:     right - left - | right - left - | up - down - | punch - - -
          B:     punch - pull - | punch - pull - | shimmy - - - | up - - -
          C:     twist-l - twist-r - | twist-l - twist-r - | right - left - | up - down -
          outro: shimmy - - - | . . . . | up - - - | . . . .
          song:  intro A A B C A B outro`,
      },
      {
        id: "roller-rink", name: "Roller Rink", bpm: 108, root: 60, scale: "major", chords: [0, 4, 5, 3], wave: "triangle", coach: ["#ff6b6b", "#1d3557"],
        kick: "x.....x.x.......", snare: SN, hat: HALF, bass: "0..0..4.0..0..2.", lead: "0.2.4.7.4.2.0...",
        sections: [{ bars: 4, energy: 0 }, { bars: 8, energy: 2 }, { bars: 8, energy: 3 }, { bars: 4, energy: 1 }, { bars: 8, energy: 3 }],
        routine: `
          intro: . . . . | . . . . | left - - - | right - - -
          A:     up - - - | down - - - | left - right - | punch - - -
          B:     right - right - | left - left - | pull - punch - | shimmy - - -
          C:     up - punch - | up - punch - | twist-r - twist-l - | down - - -
          outro: up - - - | shimmy - - - | punch - - - | . . . .
          song:  intro A B A C B C outro`,
      },
    ],
  },
  {
    id: "seoul", name: "Spotlight Seoul", emoji: "🎤", glow: "#ff4fd8", sky: ["#0b1340", "#03030c"],
    story: "Word travels fast: a talent show on a neon rooftop wants the dancer from downtown. Sharp, quick moves and perfect sync. Bring a friend, hit the same moves together, and the whole rooftop sings along.",
    dances: [
      {
        id: "neon-rooftop", name: "Neon Rooftop", bpm: 112, root: 62, scale: "dorian", chords: [0, 3, 4, 3], wave: "sawtooth", coach: ["#ff4fd8", "#141414"],
        kick: "x...x...x...x.x.", snare: SN, hat: "x.xxx.xxx.xxx.xx", bass: "0.0.7.0.0.7.0.4.", lead: "7.4.2.4.7...9.7.",
        sections: [{ bars: 4, energy: 1 }, { bars: 8, energy: 2 }, { bars: 12, energy: 3 }, { bars: 4, energy: 2 }, { bars: 4, energy: 1 }],
        routine: `
          intro: . . . . | . . . . | right - left - | up - - -
          A:     punch - punch - | pull - - - | left - right - | up - - -
          B:     right left right - | up - down - | twist-l - twist-r - | shimmy - - -
          Q:     punch . punch . | up down up -
          outro: up - - - | shimmy - - - | punch - - - | . . . .
          song:  intro A B Q A B Q B outro`,
      },
    ],
  },
  {
    id: "carnival", name: "Carnival Nights", emoji: "🎉", glow: "#3ddc97", sky: ["#3d0b0b", "#0c0303"],
    story: "The tour ends at the biggest street party of the year. Drums on every corner, feathers everywhere, and the parade waits for one last dancer. Shake it, twist it, and lead the carnival home.",
    dances: [
      {
        id: "street-parade", name: "Street Parade", bpm: 120, root: 59, scale: "major", chords: [0, 3, 4, 4], wave: "square", coach: ["#3ddc97", "#ff9f1c"],
        kick: "x..x..x...x..x..", snare: "....x..x....x...", hat: "xxx.xxx.xxx.xxx.", bass: "0..0..2...4..2..", lead: "4.4.2.0.2...4...",
        sections: [{ bars: 4, energy: 1 }, { bars: 8, energy: 2 }, { bars: 12, energy: 3 }, { bars: 8, energy: 3 }],
        routine: `
          intro: . . . . | . . . . | shimmy - - - | shimmy - - -
          A:     twist-l - twist-r - | twist-l - twist-r - | up - - - | shimmy - - -
          B:     right - left - | punch - punch - | down - up - | shimmy - - -
          C:     up - shimmy - | pull - punch - | left - right - | up - - -
          song:  intro A B C A B C B`,
      },
    ],
  },
];

export const DANCES: Array<Dance & { city: number }> = CITIES.flatMap((c, city) => c.dances.map((d) => ({ ...d, city })));

/** Coach outfits and stages, earned with stars. */
export const REWARDS: Reward[] = [
  { stars: 2, id: "outfit-sparkle", kind: "skin", name: "Sparkle jacket", emoji: "✨" },
  { stars: 5, id: "stage-sunset", kind: "theme", name: "Sunset stage", emoji: "🌇" },
  { stars: 8, id: "outfit-gold", kind: "skin", name: "Gold suit", emoji: "🥇" },
  { stars: 11, id: "stage-galaxy", kind: "theme", name: "Galaxy stage", emoji: "🌌" },
  { stars: 12, id: "crown", kind: "trophy", name: "Tour crown", emoji: "👑" },
];
