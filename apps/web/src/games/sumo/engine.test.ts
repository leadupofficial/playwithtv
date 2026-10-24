import { describe, expect, it } from "vitest";
import { BODY_R, NO_INPUT, RING_R, RING_X, RING_Y, newBout, ringAt, scoreOf, step, type Bout, type SumoEvent, type SumoInput } from "./engine";
import { placings } from "../scoring";

const DT = 1 / 60;
type Ctl = (b: Bout, t: number) => Map<string, SumoInput>;

function run(b: Bout, secs: number, ctl: Ctl = () => new Map()) {
  const ev: SumoEvent[] = [];
  for (let t = 0; t < secs && b.phase !== "over"; t += DT) ev.push(...step(b, DT, ctl(b, t)));
  return ev;
}
/** Two humans facing each other in the middle of the ring, fight already on. */
function duel(gap = 120): Bout {
  const b = newBout([{ id: "a", cpu: false }, { id: "b", cpu: false }], { toWin: 2, seed: 4 });
  run(b, 2); // intro
  b.wrestlers[0]!.x = RING_X - gap / 2; b.wrestlers[0]!.y = RING_Y;
  b.wrestlers[1]!.x = RING_X + gap / 2; b.wrestlers[1]!.y = RING_Y;
  for (const w of b.wrestlers) { w.vx = w.vy = 0; w.cooldown = 0; }
  return b;
}
const once = (id: string, inp: Partial<SumoInput>): Ctl => (_b, t) => new Map([[id, { ...NO_INPUT, ...inp, shove: !!inp.shove && t < DT / 2 }]]);

describe("motion sumo engine", () => {
  it("starts with an intro, then the fight; everyone starts inside the ring", () => {
    const b = newBout([{ id: "a", cpu: false }, { id: "b", cpu: true }, { id: "c", cpu: true }]);
    expect(b.phase).toBe("intro");
    const ev = run(b, 2);
    expect(ev.some((e) => e.kind === "fight")).toBe(true);
    for (const w of b.wrestlers) expect(Math.hypot(w.x - RING_X, w.y - RING_Y)).toBeLessThan(RING_R - BODY_R);
  });

  it("the stick moves a wrestler (y up on the stick is up on screen)", () => {
    const b = duel();
    const a = b.wrestlers[0]!;
    const y0 = a.y;
    run(b, 0.5, () => new Map([["a", { ...NO_INPUT, y: 1 }]]));
    expect(a.y).toBeLessThan(y0 - 60);
  });

  it("a shove dashes forward, costs stamina, has a cooldown, and slams the other wrestler back", () => {
    const b = duel();
    const [a, c] = b.wrestlers;
    const ev = run(b, 0.5, once("a", { x: 1, shove: true }));
    expect(ev.find((e) => e.kind === "shove")).toMatchObject({ id: "a", weak: false });
    expect(ev.find((e) => e.kind === "slam")).toMatchObject({ by: "a", on: "b", braced: false });
    expect(c!.x).toBeGreaterThan(RING_X + 140);
    expect(a!.stamina).toBeLessThan(100);
    // spamming does nothing during the cooldown
    const b2 = duel();
    const spam = run(b2, 0.3, () => new Map([["a", { ...NO_INPUT, x: 1, shove: true }]]));
    expect(spam.filter((e) => e.kind === "shove")).toHaveLength(1);
  });

  it("bracing makes you heavy: a shove barely moves a braced wrestler", () => {
    const push = (brace: boolean) => {
      const b = duel();
      run(b, 0.5, (bb, t) => new Map([["a", { ...NO_INPUT, x: 1, shove: t < DT / 2 }], ["b", { ...NO_INPUT, brace }]]));
      return b.wrestlers[1]!.x - RING_X;
    };
    const free = push(false), braced = push(true);
    expect(braced).toBeLessThan(free * 0.6);
  });

  it("a brace tap (from a gesture) braces for a moment", () => {
    const b = duel();
    run(b, DT, () => new Map([["b", { ...NO_INPUT, braceTap: true }]]));
    expect(b.wrestlers[1]!.bracing).toBe(true);
    run(b, 1.5);
    expect(b.wrestlers[1]!.bracing).toBe(false);
  });

  it("an empty stamina bar makes a weak shove", () => {
    const b = duel();
    b.wrestlers[0]!.stamina = 5;
    const ev = run(b, DT, once("a", { x: 1, shove: true }));
    expect(ev.find((e) => e.kind === "shove")).toMatchObject({ weak: true });
  });

  it("pushing someone over the edge is a ring-out, credited to the pusher; last one inside wins the round", () => {
    const b = duel();
    const [a, c] = b.wrestlers;
    c!.x = RING_X + RING_R - 40; a!.x = c!.x - 70;
    const ev = run(b, 1.2, (bb, t) => new Map([["a", { ...NO_INPUT, x: t < 0.25 ? 1 : -1, shove: t < DT / 2 }]]));
    expect(ev.find((e) => e.kind === "ringout")).toMatchObject({ id: "b", by: "a", left: 1 });
    expect(ev.find((e) => e.kind === "round-end")).toMatchObject({ round: 1, winner: "a" });
    expect(a!.wins).toBe(1);
    expect(a!.ringouts).toBe(1);
    expect(b.phase).toBe("round-end");
    run(b, 3.2);
    expect(b.round).toBe(2);
    expect(b.wrestlers.every((w) => !w.out)).toBe(true);
  });

  it("walking out on your own is a ring-out with nobody credited", () => {
    const b = duel();
    const ev = run(b, 4, () => new Map([["a", { ...NO_INPUT, x: -1 }]]));
    expect(ev.find((e) => e.kind === "ringout")).toMatchObject({ id: "a", by: null });
    expect(b.wrestlers[1]!.wins).toBe(1);
  });

  it("the ring shrinks later in the round, down to nothing, so a round always ends", () => {
    const b = newBout([{ id: "a", cpu: false }, { id: "b", cpu: false }], { shrinkAt: 5, shrinkDur: 10 });
    expect(ringAt(b, 4)).toBe(RING_R);
    expect(ringAt(b, 10)).toBeLessThan(RING_R);
    expect(ringAt(b, 15)).toBeCloseTo(b.ringMin);
    expect(ringAt(b, 60)).toBe(BODY_R);
    const ev = run(b, 40); // nobody moves at all
    expect(ev.some((e) => e.kind === "shrink")).toBe(true);
    expect(ev.some((e) => e.kind === "round-end")).toBe(true);
  });

  it("if the last two fall together, the one nearer the middle keeps the round", () => {
    const b = duel();
    const [a, c] = b.wrestlers;
    b.time = 100; // far into sudden death: the ring is tiny
    a!.x = RING_X - 40; c!.x = RING_X + 60;
    const ev = run(b, DT);
    expect(ev.find((e) => e.kind === "round-end")).toMatchObject({ winner: "a" });
  });

  it("best of 3: the first to two round wins takes the match", () => {
    const b = newBout([{ id: "a", cpu: false }, { id: "b", cpu: false }], { toWin: 2 });
    const ev: SumoEvent[] = [];
    for (let r = 0; r < 3 && b.phase !== "over"; r++) {
      ev.push(...run(b, 2));             // intro
      ev.push(...run(b, 4, () => new Map([["b", { ...NO_INPUT, x: 1 }]]))); // b walks out
      ev.push(...run(b, 3));             // round break
    }
    expect(b.phase).toBe("over");
    expect(b.winner).toBe("a");
    expect(b.wrestlers[0]!.wins).toBe(2);
    expect(ev.filter((e) => e.kind === "round-end")).toHaveLength(2);
  });

  it("CPU wrestlers fight each other to a winner, and the same seed replays the same match", () => {
    const play = () => {
      const b = newBout(["c1", "c2", "c3", "c4"].map((id) => ({ id, cpu: true })), { toWin: 2, seed: 21 });
      const ev = run(b, 240);
      return { b, ev };
    };
    const { b, ev } = play();
    expect(b.phase).toBe("over");
    expect(ev.filter((e) => e.kind === "slam").length).toBeGreaterThan(3);
    expect(ev.filter((e) => e.kind === "ringout").some((e) => (e as { by: string | null }).by !== null)).toBe(true);
    const champ = b.wrestlers.find((w) => w.id === b.winner)!;
    expect(champ.wins).toBeGreaterThanOrEqual(2);
    const again = play().b;
    expect(again.winner).toBe(b.winner);
    expect(again.round).toBe(b.round);
    // ranking: the champion places first
    const ranked = placings(new Map(b.wrestlers.map((w) => [w.id, scoreOf(w)])));
    expect(ranked[0]!.playerId).toBe(b.winner);
  });

  it("a CPU pushes an idle human out of the ring", () => {
    const b = newBout([{ id: "me", cpu: false }, { id: "cpu", cpu: true }], { toWin: 1, seed: 2 });
    run(b, 60);
    expect(b.phase).toBe("over");
    expect(b.winner).toBe("cpu");
    expect(b.wrestlers[1]!.ringouts).toBe(1);
  });
});
