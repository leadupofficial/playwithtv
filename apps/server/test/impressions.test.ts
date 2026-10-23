import { describe, expect, it } from "vitest";
import { capImpressions, takeImpressions } from "../src/impressions.js";

const id = "00000000-0000-4000-8000-000000000001";
const id2 = "00000000-0000-4000-8000-000000000002";

describe("impression caps (what a TV may claim)", () => {
  it("counts nothing from a room nobody ever joined", () => {
    expect(capImpressions([{ id, placement: "lobby-rail", n: 4 }], 0, 60_000, 0)).toEqual([]);
  });

  it("limits each banner slot to one sponsor per 15 s since the last report, shared across sponsors", () => {
    const out = capImpressions([{ id, placement: "lobby-rail", n: 10 }, { id: id2, placement: "lobby-rail", n: 10 }], 1, 60_000, 0);
    expect(out).toEqual([{ id, placement: "lobby-rail", n: 4 }]); // 60 s / 15 s = 4 in total
  });

  it("limits presented-by and in-game sponsors to the games the server actually started", () => {
    const items = [{ id, placement: "presented-by", n: 5 }, { id, placement: "in-game", n: 5 }] as const;
    expect(capImpressions([...items], 2, 30_000, 0)).toEqual([]);
    expect(capImpressions([...items], 2, 30_000, 1)).toEqual([{ id, placement: "presented-by", n: 1 }, { id, placement: "in-game", n: 1 }]);
  });

  it("accepts one report per 20 s per room and starts a new window each time", () => {
    const room = { players: { size: 1 }, lastImpressionsAt: 0, gamesSinceReport: 1 };
    expect(takeImpressions(room, [{ id, placement: "in-game", n: 1 }], 10_000)).toBeNull(); // too soon after the room began
    expect(takeImpressions(room, [{ id, placement: "in-game", n: 1 }], 25_000)).toEqual([{ id, placement: "in-game", n: 1 }]);
    expect(room.gamesSinceReport).toBe(0);
    expect(takeImpressions(room, [{ id, placement: "in-game", n: 1 }], 50_000)).toEqual([]); // no new game since
  });
});
