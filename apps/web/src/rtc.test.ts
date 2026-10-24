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
