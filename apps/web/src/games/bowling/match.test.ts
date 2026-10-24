import { describe, expect, it } from "vitest";
import { bowler, newMatch, over, recordBall, scores, upNext } from "./match";
import { placings } from "../scoring";

describe("bowling turns", () => {
  it("players bowl a frame each in order", () => {
    const m = newMatch(["a", "b"], 10);
    expect(bowler(m)).toBe("a");
    expect(recordBall(m, 4)).toMatchObject({ turnOver: false, freshRack: false });
    expect(upNext(m)).toMatchObject({ frame: 0, ball: 1, standing: 6 });
    expect(recordBall(m, 3)).toMatchObject({ turnOver: true, freshRack: true });
    expect(bowler(m)).toBe("b");
    expect(recordBall(m, 10)).toMatchObject({ turnOver: true, freshRack: true }); // a strike ends the frame
    expect(bowler(m)).toBe("a");
  });

  it("a knocked count cannot exceed the pins standing", () => {
    const m = newMatch(["a"], 2);
    recordBall(m, 7);
    recordBall(m, 9);
    expect(m.rolls.get("a")).toEqual([7, 3]);
  });

  it("the last frame keeps the bowler for bonus balls, then the game ends", () => {
    const m = newMatch(["a", "b"], 2);
    for (const p of [3, 4]) recordBall(m, p);       // a frame 1
    for (const p of [5, 1]) recordBall(m, p);       // b frame 1
    expect(recordBall(m, 10)).toMatchObject({ turnOver: false, freshRack: true }); // a: strike in the final frame
    expect(bowler(m)).toBe("a");
    expect(recordBall(m, 6)).toMatchObject({ turnOver: false, freshRack: false });
    expect(recordBall(m, 2)).toMatchObject({ turnOver: true, gameOver: false });
    expect(bowler(m)).toBe("b");
    recordBall(m, 2);
    expect(recordBall(m, 3)).toMatchObject({ turnOver: true, gameOver: true });
    expect(over(m)).toBe(true);
    expect(scores(m)).toEqual(new Map([["a", 25], ["b", 11]]));
    expect(placings(scores(m)).map((r) => [r.playerId, r.place])).toEqual([["a", 1], ["b", 2]]);
  });

  it("a solo player bowls straight through", () => {
    const m = newMatch(["solo"], 10);
    for (let i = 0; i < 12; i++) recordBall(m, 10);
    expect(over(m)).toBe(true);
    expect(scores(m).get("solo")).toBe(300);
  });
});
