import { describe, expect, it } from "vitest";
import { NEEDS_WEBGL2 } from "./registry";
import { threeGames } from "./threeScan";

describe("games that need WebGL 2", () => {
  it("are exactly the games whose code reaches three.js (so old TVs never open one)", () => {
    expect([...NEEDS_WEBGL2].sort()).toEqual(threeGames());
  });
});
