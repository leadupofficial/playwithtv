/**
 * Carry Me Home levels. Draw a level in text, 24 × 14:
 *   #  wall          .  floor           A / B  the two ends of the sofa (player 1 holds A, player 2 holds B)
 *   D  the new home (bring the middle of the sofa onto it)   h  a heart to collect (carry the sofa over it)
 *   ~  puddle (slow)  =  road: cars drive along it            g  garden gate: opens and closes on a beat
 * Every map is checked by carry.test.ts: size, walls, one A and one B, a home, and a route the sofa fits along.
 */
export interface CarryLevel {
  name: string;
  world: number;
  map: string[];
  /** Seconds for the third star. */
  par: number;
  /** Most wall scrapes allowed for the second star. */
  scrapes: number;
  /** Car speed in cells per second (roads only). */
  cars?: number;
}

export const COLS = 24;
export const ROWS = 14;

export const WORLDS = [
  {
    name: "World 1 · Moving Day",
    text: "Sam and Alex just got the keys to their first home together, and the van driver left their big blue sofa at the far end of the block. Each of you holds one end. Walk together, turn together, and squeeze it through every hallway without scraping the walls!",
  },
  {
    name: "World 2 · City Streets",
    text: "The way home crosses the busiest streets in town. Cars won't wait for a sofa, so watch the gaps, call it out to each other, and cross together. Three bumps and the sofa goes back to the van!",
  },
  {
    name: "World 3 · Home at Last",
    text: "Market day! Gates swing, puddles splash and the streets are full. One last trip and the sofa is home, where the two of you can finally sit down together.",
  },
];

export const LEVELS: CarryLevel[] = [
  {
    name: "Moving Day", world: 0, par: 70, scrapes: 6,
    map: [
      "########################",
      "#......................#",
      "#..A..B.......h........#",
      "#......................#",
      "#.........######.......#",
      "#.........#....#.......#",
      "#....h....#....#...h...#",
      "#.........#....#.......#",
      "#.........##..##.......#",
      "#......................#",
      "#.................DDD..#",
      "#.................DDD..#",
      "#......................#",
      "########################",
    ],
  },
  {
    name: "Narrow Hall", world: 0, par: 75, scrapes: 6,
    map: [
      "########################",
      "#A..B.....#............#",
      "#.........#....h.......#",
      "#.........#............#",
      "#######...#............#",
      "#######...#....#########",
      "#######...#....#.......#",
      "#######...######...DDD.#",
      "#######..h.........DDD.#",
      "#######................#",
      "#######................#",
      "###########......#######",
      "###########..h...#######",
      "########################",
    ],
  },
  {
    name: "Rainy Yard", world: 0, par: 80, scrapes: 5,
    map: [
      "########################",
      "#......................#",
      "#.A..B....~~~~.........#",
      "#.........~~~~....h....#",
      "#.........~~~~.........#",
      "#....####.~~~~.####....#",
      "#....#..........#......#",
      "#....#..h.......#..~~~.#",
      "#....#..........#..~~~.#",
      "#....######~~####......#",
      "#..........~~..........#",
      "#.~~~......~~.....DDD..#",
      "#.~~~...h.........DDD..#",
      "########################",
    ],
  },
  {
    name: "Garden Gates", world: 1, par: 90, scrapes: 5,
    map: [
      "########################",
      "#..........#...........#",
      "#.A..B.....#.....h.....#",
      "#..........g...........#",
      "#..........g...........#",
      "#..h.......#.....#######",
      "#######gg###.....#.....#",
      "#..........#.....g.DDD.#",
      "#..........#.....g.DDD.#",
      "#...~~~....#.....#.....#",
      "#...~~~..h.#.....#..h..#",
      "#..........ggg...#.....#",
      "#..........#...........#",
      "########################",
    ],
  },
  {
    name: "Busy Street", world: 1, par: 70, scrapes: 5, cars: 2.6,
    map: [
      "########################",
      "#.A..B......h..........#",
      "#......................#",
      "#======================#",
      "#======================#",
      "#......................#",
      "#....h.....##..........#",
      "#..........##.....h....#",
      "#======================#",
      "#======================#",
      "#......................#",
      "#.................DDD..#",
      "#.......h.........DDD..#",
      "########################",
    ],
  },
  {
    name: "Rush Hour", world: 1, par: 85, scrapes: 4, cars: 3.4,
    map: [
      "########################",
      "#.A..B.....#...........#",
      "#..........#....h......#",
      "#======================#",
      "#======================#",
      "#..h...###.....###.....#",
      "#......#.........#.....#",
      "#======================#",
      "#======================#",
      "#.....####...h..####...#",
      "#.....g..........g.....#",
      "#======================#",
      "#.......h.........DDD..#",
      "########################",
    ],
  },
  {
    name: "Market Lane", world: 2, par: 95, scrapes: 4, cars: 3.0,
    map: [
      "########################",
      "#A..B.......#......h...#",
      "#...........g..........#",
      "#...........g..........#",
      "#####..######..#######.#",
      "#..~~..#....#..#.......#",
      "#======================#",
      "#======================#",
      "#..h...#.........#..h..#",
      "#####gg#.........#gg####",
      "#..........~~~.........#",
      "#..........~~~.....DDD.#",
      "#.....h............DDD.#",
      "########################",
    ],
  },
  {
    name: "Home at Last", world: 2, par: 110, scrapes: 4, cars: 3.8,
    map: [
      "########################",
      "#A..B...#....h....#....#",
      "#.......g.........g....#",
      "#.......g..~~~~...g..h.#",
      "#####...#..~~~~...######",
      "#======================#",
      "#======================#",
      "#...##.....h.....##....#",
      "#...##..#######..##....#",
      "#======================#",
      "#======================#",
      "#..h....g.......g...DDD#",
      "#.......g...~~..g...DDD#",
      "########################",
    ],
  },
];
