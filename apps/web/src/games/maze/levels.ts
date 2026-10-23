/**
 * Original maze levels. One character per 1×1 cell:
 *   #  wall          .  floor        S  start        G  goal
 *   O  hole (fall back to the last checkpoint)       C  checkpoint
 *   *  coin          M  wall sliding left/right      V  wall sliding up/down
 * Every level is checked for a path from S to G by the tests.
 */
export interface LevelDef { name: string; rows: string[]; timeLimit: number }

export const LEVELS: LevelDef[] = [
  {
    name: "Warm-up Lane",
    timeLimit: 45,
    rows: [
      "###############",
      "#.............#",
      "#.S.....*...G.#",
      "#.............#",
      "###############",
    ],
  },
  {
    name: "Hole in One",
    timeLimit: 75,
    rows: [
      "###############",
      "#S..#....O....#",
      "#...#.##...*..#",
      "#.O.#..#.###..#",
      "#...*..#...#..#",
      "###.####.O.#..#",
      "#......C...#..#",
      "#.#######.##O.#",
      "#....O......#G#",
      "###############",
    ],
  },
  {
    name: "Sliding Doors",
    timeLimit: 90,
    rows: [
      "###############",
      "#S.....#......#",
      "#.####.#.####.#",
      "#.#..*.M.#..*.#",
      "#.#.####.#.##.#",
      "#...#..C.#..#.#",
      "###.#.####..#.#",
      "#*..O....V..#G#",
      "###############",
    ],
  },
];
