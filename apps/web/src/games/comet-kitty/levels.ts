/**
 * Comet Kitty mazes. Draw a deck of the space station in text, 19 × 21:
 *   #  wall   .  stardust   o  nova star (overloads the dustbots for a while)   (space)  empty floor
 *   K  Kitty's start   D  dustbot dock   -  dock door (dustbots only)
 * A row open at both edges is a warp tunnel. levels.test.ts checks that every stardust can be reached and
 * that there are no dead ends (dustbots never turn back, so a dead end would trap them).
 */
export const COLS = 19;
export const ROWS = 21;

const DOCK = [
  "   #.#       #.#   ",
  "####.# ##-## #.####",
  "    .  #DDD#  .    ",
  "####.# ##### #.####",
  "   #.#       #.#   ",
];

export const MAZES: string[][] = [
  [
    "###################",
    "#........#........#",
    "#o##.###.#.###.##o#",
    "#.................#",
    "#.##.#.#####.#.##.#",
    "#....#...#...#....#",
    "####.### # ###.####",
    ...DOCK,
    "####.# ##### #.####",
    "#........#........#",
    "#.##.###.#.###.##.#",
    "#o.#.....K.....#.o#",
    "##.#.#.#####.#.#.##",
    "#....#...#...#....#",
    "#.######.#.######.#",
    "#.................#",
    "###################",
  ],
  [
    "###################",
    "#o..#.........#..o#",
    "#.#.#.###.###.#.#.#",
    "#.#.............#.#",
    "#.#.##.#####.##.#.#",
    "#......#...#......#",
    "####.#.# # #.#.####",
    ...DOCK,
    "####.# ##### #.####",
    "#....#...#...#....#",
    "#.##.#.#.#.#.#.##.#",
    "#o.#...#.K.#...#.o#",
    "##.#.###...###.#.##",
    "#.......#.#.......#",
    "#.#####.#.#.#####.#",
    "#.................#",
    "###################",
  ],
  [
    "###################",
    "#....#.......#....#",
    "#.##.#.#####.#.##.#",
    "#o...............o#",
    "#.##.#..###..#.##.#",
    "#....#...#...#....#",
    "####.### # ###.####",
    ...DOCK,
    "####.# ##### #.####",
    "#.................#",
    "#.###.#.....#.###.#",
    "#o..#.#.#K#.#.#..o#",
    "###.#...#.#...#.###",
    "#...###.#.#.###...#",
    "#.#.....#.#.....#.#",
    "#...#.......#.....#",
    "###################",
  ],
];

export interface KittyLevel {
  name: string;
  world: number;
  maze: number;
  /** Ms per cell for Kitty and for the dustbots. */
  kittyMs: number;
  botMs: number;
  bots: 1 | 2 | 3 | 4;
  /** How long a nova star overloads the dustbots. */
  powerMs: number;
  /** Third star: bonk this many overloaded dustbots. */
  bonks: number;
}

export const WORLDS = [
  {
    name: "World 1 · Cargo Deck",
    text: "Space Station Whisker runs on stardust, and Comet Kitty is its best collector. Tonight the cleaning dustbots got their wires crossed and are chasing anyone in sight! Collect every speck of stardust on the deck. Grab a big nova star and the bots overload: that's your chance to bonk them back to their dock.",
  },
  {
    name: "World 2 · Hydro Garden",
    text: "The garden deck is a twisty maze of pipes. More dustbots have joined the chase, and they're learning your tricks. Use the warp tunnels at the sides to slip away!",
  },
  {
    name: "World 3 · Star Core",
    text: "The core is where all the stardust ends up, and all four dustbots guard it. Clear it and the whole station lights up again. Fast paws, Kitty!",
  },
];

export const LEVELS: KittyLevel[] = [
  { name: "Loading Bay", world: 0, maze: 0, kittyMs: 150, botMs: 210, bots: 1, powerMs: 8000, bonks: 1 },
  { name: "Crate Corners", world: 0, maze: 0, kittyMs: 145, botMs: 190, bots: 2, powerMs: 7000, bonks: 2 },
  { name: "Night Shift", world: 0, maze: 0, kittyMs: 140, botMs: 175, bots: 3, powerMs: 6500, bonks: 3 },
  { name: "Pipe Garden", world: 1, maze: 1, kittyMs: 140, botMs: 170, bots: 3, powerMs: 6000, bonks: 3 },
  { name: "Sprinkler Run", world: 1, maze: 1, kittyMs: 135, botMs: 160, bots: 4, powerMs: 5500, bonks: 4 },
  { name: "Greenhouse", world: 1, maze: 1, kittyMs: 130, botMs: 150, bots: 4, powerMs: 5000, bonks: 4 },
  { name: "Core Gate", world: 2, maze: 2, kittyMs: 130, botMs: 145, bots: 4, powerMs: 4500, bonks: 4 },
  { name: "Reactor Ring", world: 2, maze: 2, kittyMs: 125, botMs: 138, bots: 4, powerMs: 4000, bonks: 5 },
  { name: "Gravity Well", world: 2, maze: 2, kittyMs: 120, botMs: 130, bots: 4, powerMs: 3500, bonks: 5 },
  { name: "Star Heart", world: 2, maze: 2, kittyMs: 115, botMs: 122, bots: 4, powerMs: 3000, bonks: 6 },
];
