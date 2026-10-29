import { beforeAll, describe, expect, it } from "vitest";

// A bare stand-in for an old engine's style object: plain top/right/bottom/left, no `inset`.
class OldStyle { top = ""; right = ""; bottom = ""; left = ""; }

beforeAll(async () => {
  const g = globalThis as unknown as Record<string, unknown>;
  g.CSSStyleDeclaration = OldStyle;
  g.document ??= { documentElement: { style: new OldStyle() } };
  await import("./polyfills");
});

describe("polyfills for old TV browsers", () => {
  it("inline `inset` reaches top/right/bottom/left (the shorthand's 1-4 value rules)", () => {
    const s = new OldStyle() as OldStyle & { inset: string };
    const sides = () => [s.top, s.right, s.bottom, s.left];
    s.inset = "0px";
    expect(sides()).toEqual(["0px", "0px", "0px", "0px"]);
    s.inset = "1px 2px";
    expect(sides()).toEqual(["1px", "2px", "1px", "2px"]);
    s.inset = "1px 2px 3px";
    expect(sides()).toEqual(["1px", "2px", "3px", "2px"]);
    s.inset = "calc(10% - 2px) 0";
    expect(sides()).toEqual(["calc(10% - 2px)", "0", "calc(10% - 2px)", "0"]);
    s.inset = "";
    expect(sides()).toEqual(["", "", "", ""]);
  });

  it("leaves modern built-ins alone and fills the newer ones", () => {
    expect([1, 2, 3].at(-1)).toBe(3);
    expect("a-b-c".replaceAll("-", "+")).toBe("a+b+c");
    expect(Object.fromEntries([["k", 1]])).toEqual({ k: 1 });
    expect([[1], [2, [3]]].flat(2)).toEqual([1, 2, 3]);
  });
});
