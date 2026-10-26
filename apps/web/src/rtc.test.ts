import { describe, expect, it } from "vitest";
import { InputMerger } from "./rtc";

describe("input merging (direct link + hub relay)", () => {
  it("uses each frame once, whichever path delivers it first, and never goes back in time", () => {
    const m = new InputMerger();
    expect(m.accept("a", 1)).toBe(true);   // via direct link
    expect(m.accept("a", 1)).toBe(false);  // same frame via the hub
    expect(m.accept("a", 3)).toBe(true);
    expect(m.accept("a", 2)).toBe(false);  // late frame: the newer state already arrived
    expect(m.accept("b", 0)).toBe(true);   // players are independent
  });

  it("starts over when a phone disconnects (a reloaded phone counts from 0)", () => {
    const m = new InputMerger();
    m.accept("a", 500);
    m.reset("a");
    expect(m.accept("a", 0)).toBe(true);
  });
});

import { TvInputs } from "./rtc";

describe("only current room members' input reaches games", () => {
  it("drops input from a player who is no longer in the room (removed), by any path", () => {
    const handlers: Array<(m: unknown) => void> = [];
    const socket = { on: (h: (m: unknown) => void) => { handlers.push(h); return () => undefined; }, send: () => undefined };
    const inputs = new TvInputs(socket as never);
    const got: string[] = [];
    inputs.onInput((id) => got.push(id));
    const relay = (playerId: string, seq: number) => handlers.forEach((h) => h({ type: "controller.input", playerId, seq, state: {} }));
    relay("a", 1);
    inputs.setMembers(["a", "b"]);
    relay("a", 2);
    relay("b", 1);
    inputs.setMembers(["b"]); // "a" was removed
    relay("a", 3);
    relay("b", 2);
    expect(got).toEqual(["a", "a", "b", "b"]);
  });
});

describe("while the game is paused, phone input waits and pause-time taps never land", () => {
  const setup = () => {
    const handlers: Array<(m: unknown) => void> = [];
    const socket = { on: (h: (m: unknown) => void) => { handlers.push(h); return () => undefined; }, send: () => undefined };
    const inputs = new TvInputs(socket as never);
    const got: Array<[string, { taps?: Record<string, number>; hold?: Record<string, boolean> }]> = [];
    inputs.onInput((id, st) => got.push([id, st as never]));
    let seq = 0;
    const relay = (playerId: string, state: object) => handlers.forEach((h) => h({ type: "controller.input", playerId, seq: seq++, state }));
    const clear = (playerId: string) => handlers.forEach((h) => h({ type: "controller.clear", playerId }));
    return { inputs, got, relay, clear, reseq: () => { seq = 0; } };
  };

  it("holds input during a pause, then resumes with the latest state and no burst of pause-time presses", () => {
    const { inputs, got, relay } = setup();
    relay("a", { taps: { jump: 2 }, hold: { run: true } });
    inputs.setPaused(true); // the TV lost the hub: game paused
    relay("a", { taps: { jump: 5 }, hold: { run: true } });  // three jumps mashed during the pause
    relay("a", { taps: { jump: 6 }, hold: { run: false } }); // and let go of RUN
    expect(got).toHaveLength(1);
    inputs.setPaused(false);
    // re-sent once on resume: RUN released, jump count as before the pause (no 4 queued jumps)
    expect(got[1]).toEqual(["a", { taps: { jump: 2 }, hold: { run: false } }]);
    relay("a", { taps: { jump: 7 }, hold: { run: false } });
    expect(got[2]![1].taps).toEqual({ jump: 3 }); // exactly one new jump after the pause
    expect(got).toHaveLength(3);
  });

  it("a phone that reloads (counters restart, controller.clear) is not short-changed by an old offset", () => {
    const { inputs, got, relay, clear, reseq } = setup();
    relay("a", { taps: { jump: 4 } });
    inputs.setPaused(true);
    relay("a", { taps: { jump: 9 } });
    inputs.setPaused(false);
    clear("a");
    reseq();
    relay("a", { taps: { jump: 1 } });
    expect(got.at(-1)![1].taps).toEqual({ jump: 1 });
  });
});
