/**
 * Kitchen Rush levels. Draw a kitchen in text, 24 × 12 (the TV adds the ticket rail above it):
 *   #  wall        .  floor          =  counter (holds one thing: put it down, pick it up, pass it over)
 *   L  lettuce     T  tomato         U  buns          M  meat        (crates: grab as many as you like)
 *   C  chopping board (chop lettuce and tomatoes here)  S  stove (meat cooks, then burns!)
 *   P  plates      W  serving window (hand dishes in here)   X  bin      1 / 2  where the chefs start
 * kitchen.test.ts checks every kitchen: size, both chefs, and that every dish can be made and served.
 */
export type Recipe = "salad" | "burger" | "deluxe";

export interface KitchenLevel {
  name: string;
  world: number;
  map: string[];
  /** Dishes that can be ordered. */
  recipes: Recipe[];
  /** Seconds between new orders. */
  every: number;
  /** Length of the shift in seconds. */
  round: number;
  /** Points for one, two and three stars. */
  stars: [number, number, number];
  /** Milliseconds for meat to cook, and then to burn. */
  cook?: number;
  burn?: number;
}

export const COLS = 24;
/** Kitchen rows (the TV board is two rows taller: the ticket rail). */
export const KROWS = 12;

export const WORLDS = [
  {
    name: "World 1 · The Food Truck",
    text: "Mia and Leo spent every penny they had on a tiny food truck. Today is opening day and the queue is already round the block! One of you chops, the other plates up. Shout to each other, hand dishes through the window before the tickets run out, and keep those customers smiling.",
  },
  {
    name: "World 2 · The Diner",
    text: "The truck was such a hit that you have a real diner now, with a counter down the middle. Only one of you can reach the crates and only one of you can reach the stoves, so pass things over the counter. Fast hands, loud voices!",
  },
  {
    name: "World 3 · Night Market",
    text: "The famous Night Market invited you to cook under the lanterns. The stoves here are fierce, so meat burns twice as fast, and the orders never stop. Cook your best shift together and earn your golden ladle!",
  },
];

export const LEVELS: KitchenLevel[] = [
  {
    name: "Opening Day", world: 0, recipes: ["salad"], every: 22, round: 150, stars: [200, 450, 700],
    map: [
      "#=L=T===C===C====P=W=W=#",
      "#1.....................#",
      "#......................#",
      "#...=====......=====...#",
      "#......................#",
      "#......................#",
      "#......................#",
      "#...=====......=====...#",
      "#......................#",
      "#.....................2#",
      "#......................#",
      "#X=====================#",
    ],
  },
  {
    name: "Burger Bar", world: 0, recipes: ["salad", "burger"], every: 20, round: 160, stars: [250, 550, 850],
    map: [
      "#=L=T=U=C==C===P==W=W==#",
      "#1.....................#",
      "#......................#",
      "#......======..........#",
      "#......................#",
      "=......................S",
      "=......................S",
      "=......................=",
      "M......======..........S",
      "#......................#",
      "#.....................2#",
      "#X=====================#",
    ],
  },
  {
    name: "Split Shift", world: 1, recipes: ["salad", "burger"], every: 19, round: 160, stars: [250, 550, 850],
    map: [
      "#L=T==C=C===#=P==W=W===#",
      "#1..........=..........#",
      "#...........=..........#",
      "#...........=..........S",
      "U...........=..........S",
      "=...........=..........=",
      "M...........=..........S",
      "#...........=..........#",
      "#...........=..........#",
      "#...........=.........2#",
      "#...........=..........#",
      "#X==========#=========X#",
    ],
  },
  {
    name: "Lunch Rush", world: 1, recipes: ["salad", "burger", "deluxe"], every: 17, round: 170, stars: [220, 600, 950],
    map: [
      "#=L=T=UC==C=====P=W=W==#",
      "#1.....................#",
      "#......................#",
      "#......................#",
      "#=====.========.=======#",
      "#......................#",
      "#......................#",
      "=......................S",
      "=......................S",
      "M.....................2S",
      "#......................#",
      "#X=====================#",
    ],
  },
  {
    name: "Night Market", world: 2, recipes: ["burger", "deluxe"], every: 16, round: 170, stars: [300, 700, 1100], cook: 5000, burn: 5000,
    map: [
      "#=L==C==C==#==P==W=W===#",
      "#1.........=...........#",
      "#..........=...........S",
      "#..........=...........S",
      "U..........=...........=",
      "=..........=...........S",
      "M..........=...........S",
      "#..........=...........#",
      "#..........=...........#",
      "#..........=..........2#",
      "T..........=...........#",
      "#X=========#==========X#",
    ],
  },
  {
    name: "Grand Opening", world: 2, recipes: ["salad", "burger", "deluxe"], every: 14, round: 180, stars: [300, 750, 1200], cook: 5000, burn: 4500,
    map: [
      "#L=T=C=C=#==P=W=W=#=U=M#",
      "#1.......=........=....#",
      "#........=........=....S",
      "#........=........=....S",
      "#.....................2=",
      "#........=........=....S",
      "#........=........=....#",
      "#........=........=....#",
      "#=======.=========.====#",
      "#......................#",
      "#......................#",
      "#X=====================#",
    ],
  },
];
