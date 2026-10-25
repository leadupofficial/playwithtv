/**
 * Tandem Ride tracks. Each track is one line of text read left to right, one character per metre:
 *   .  flat road     /  uphill        \\  downhill
 *   r  a rock (any hop clears it)     L  a log (only a big jump, both of you pressing Jump together, clears it)
 *   ~  a puddle (splash: slows you)   f  a flower on the road   *  a flower up high (jump for it)
 *   F  the picnic spot (finish)
 * `par` is how many seconds Grandpa Joe takes on his old bike: beat him for the second star.
 * tandem.test.ts checks every track and rides each one with a pair of steady test riders.
 */
export interface TandemLevel {
  name: string;
  world: number;
  track: string;
  par: number;
}

export const WORLDS = [
  {
    name: "World 1 · The Coast",
    text: "It's Sam and Riya's anniversary, and they've hired an old tandem bike for the weekend. There's a picnic waiting at the end of every ride! One of you sits at the front, one at the back, and the bike only flies when you pedal together. Rock your phones side to side to pedal and press Jump at the same moment to leap the logs. Grandpa Joe, who rents out the bikes, says he'll beat you there on his rusty old one.",
  },
  {
    name: "World 2 · The Countryside",
    text: "Up through the village and past the windmills. The hills are steep: pedal in step and you'll fly up them, pedal out of step and you'll wobble. Grandpa Joe has oiled his chain.",
  },
  {
    name: "World 3 · Into the Sunset",
    text: "The forest trail is full of fallen logs, and the last ride ends on the cliff top at sunset. Jump together, pedal together, and get to the picnic before the sun goes down.",
  },
];

export const LEVELS: TandemLevel[] = [
  { name: "Seaside Path", world: 0, par: 23, track: "........f..f..f.........r.......f.f.f.....~~.......*.*........r...f..f.........L.........*..*.......ff.....~~~.....r.....*........L......f.f.f.......F" },
  { name: "Lighthouse Hill", world: 0, par: 22, track: "......f.f......///..f..///////....\\\\\\\\\\\\....*.*......r.....////////.....f.f....\\\\\\\\\\\\\\\\......L.....~~.......*..*.....///.....\\\\\\......ff...L.....F" },
  { name: "Village Fair", world: 1, par: 25, track: ".....f.f.f.....r....r.....L........*.*.*......///////....L....\\\\\\\\\\\\\\.....~~~..f.f..r....r....r.........*........L........*.........////.....\\\\\\\\.....fff......L........L.........F" },
  { name: "Windmill Climb", world: 1, par: 26, track: ".......f.f......//////////....*...*....\\\\\\\\\\......L.....////////////.....r....r.....\\\\\\\\\\\\\\\\\\\\\\\\......~~~~.....*.*.*........L......//////....f.f.f....\\\\\\\\\\\\.....L........L......F" },
  { name: "Forest Trail", world: 2, par: 30, track: "......f.....r....r.....L........*.*...~~~...L......//////...L...\\\\\\\\\\\\......*...*........r....L........r.......~~~~~......////////.....*.*.*.....\\\\\\\\\\\\\\\\......L........L....fff.....L........*........L.......F" },
  { name: "Sunset Picnic", world: 2, par: 30, track: ".....f.f.f......///////.....L.....\\\\\\\\\\\\\\.....*.*.*........r....r....r....r......L........L.....~~~~~.......////////////....*....\\\\\\\\\\\\\\\\\\\\\\\\.....L........L........L......fff....*.*.*.......////..L..\\\\\\\\.......F" },
];
