/**
 * The GHAT RUSH course: "Hairpin Ghat", a monsoon mountain loop. From the tea-stall village at the top, down the
 * waterfall cliff, two hairpins, across the river bridge, then a fast climb with crests through the tea estates
 * back to the village. Turns are in degrees (+ = left), lengths and heights in metres.
 */
import type { CourseDef } from "./track";

export const HAIRPIN_GHAT: CourseDef = {
  id: "hairpin-ghat",
  name: "Hairpin Ghat",
  hw: 7.5,
  segments: [
    { len: 110, dy: -2, left: "village", right: "village", name: "Chai Stall Straight" },
    { len: 60, turn: -50, dy: -3, left: "cliff", right: "drop" },
    { len: 60, dy: -5, left: "cliff", right: "drop", name: "Waterfall Bend" },
    { len: 80, turn: 180, dy: -6, hw: 9.5, left: "drop", right: "cliff", name: "Hairpin 1" },
    { len: 120, dy: -12, left: "drop", right: "cliff" },
    { len: 80, turn: -180, dy: -6, hw: 9.5, left: "cliff", right: "drop", name: "Hairpin 2" },
    { len: 90, dy: -8, crests: 1, crestAmp: 1.8, crestLen: 28, left: "cliff", right: "drop" },
    { len: 90, turn: 95, dy: -2, left: "drop", right: "cliff" },
    { len: 80, left: "drop", right: "drop", name: "River Bridge" },
    { len: 90, turn: 90, dy: 4, left: "estate", right: "estate" },
    { len: 150, dy: 22, crests: 2, crestAmp: 2.0, crestLen: 28, left: "estate", right: "estate", name: "Tea Estate Jumps" },
  ],
};
