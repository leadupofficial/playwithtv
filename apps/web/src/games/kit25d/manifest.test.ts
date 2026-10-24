import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  type SpriteManifest, cellIndex, cellUv, directionHeading, directionIndex, frameAt, parseManifest, screenHeading, worldSize, wrapAngle,
} from "./manifest";

const PI = Math.PI;

/** A 16-direction × 4-frame sheet of 100×50 cells in an 8-column grid (800×400). */
function sheet(over: Partial<SpriteManifest> = {}): SpriteManifest {
  const directions = 16, framesPerDirection = 4, cols = 8, cw = 100, ch = 50;
  const frames = Array.from({ length: directions * framesPerDirection }, (_, i) => ({ x: (i % cols) * cw, y: Math.floor(i / cols) * ch, w: cw, h: ch }));
  return {
    format: "pwtv-sprites", version: 1, name: "t", image: "t.webp", fallback: null, normals: null,
    size: { w: cols * cw, h: Math.ceil(frames.length / cols) * ch }, cell: { w: cw, h: ch }, grid: { cols, rows: 8 },
    directions, framesPerDirection, fps: 10, angle0: 0, pivot: { x: 0.5, y: 0.8 }, pixelsPerMetre: 50,
    camera: { type: "ortho", elevationDeg: 30, fovDeg: null }, shadow: true, frames, ...over,
  };
}

describe("directions", () => {
  const m = sheet();
  it("maps headings to the nearest of 16 cells, wrapping around", () => {
    expect(directionIndex(0, m)).toBe(0);
    expect(directionIndex(PI / 2, m)).toBe(4);           // facing away (up the screen)
    expect(directionIndex(-PI / 2, m)).toBe(12);         // facing the viewer
    expect(directionIndex(PI, m)).toBe(8);
    expect(directionIndex(2 * PI - 0.01, m)).toBe(0);    // just short of a full turn rounds back to 0
    expect(directionIndex((PI / 8) * 0.49, m)).toBe(0);  // less than half a step
    expect(directionIndex((PI / 8) * 0.51, m)).toBe(1);
    expect(directionIndex(-7 * PI, m)).toBe(8);
  });

  it("honours angle0 and round-trips with directionHeading", () => {
    const m2 = sheet({ angle0: -PI / 2 });
    expect(directionIndex(-PI / 2, m2)).toBe(0);
    for (let d = 0; d < 16; d++) expect(directionIndex(directionHeading(d, m2), m2)).toBe(d);
  });

  it("works for 8 and 32 directions", () => {
    expect(directionIndex(PI / 4, sheet({ directions: 8 }))).toBe(1);
    expect(directionIndex(PI / 16, sheet({ directions: 32 }))).toBe(1);
  });

  it("wrapAngle keeps angles in [0, 2π)", () => {
    expect(wrapAngle(-0.5)).toBeCloseTo(2 * PI - 0.5);
    expect(wrapAngle(4 * PI + 1)).toBeCloseTo(1);
  });
});

describe("frames and cells", () => {
  const m = sheet();
  it("loops animation frames at the sheet's fps", () => {
    expect(frameAt(0, m)).toBe(0);
    expect(frameAt(0.09, m)).toBe(0);
    expect(frameAt(0.1, m)).toBe(1);
    expect(frameAt(0.45, m)).toBe(0);  // frame 4 wraps to 0
    expect(frameAt(0.25, m, 20)).toBe(1);
    expect(frameAt(5, sheet({ framesPerDirection: 1 }))).toBe(0);
  });

  it("indexes direction-major and wraps both axes", () => {
    expect(cellIndex(0, 0, m)).toBe(0);
    expect(cellIndex(3, 2, m)).toBe(14);
    expect(cellIndex(16, 5, m)).toBe(1);
    expect(cellIndex(-1, -1, m)).toBe(63);
  });

  it("gives flipY texture UVs (bottom-up v) for a cell", () => {
    const [u, v, w, h] = cellUv(0, m);           // top-left cell of an 800×400 atlas
    expect([u, v, w, h]).toEqual([0, 1 - 50 / 400, 100 / 800, 50 / 400]);
    const last = cellUv(63, m);                  // bottom-right cell
    expect(last[0]).toBeCloseTo(700 / 800);
    expect(last[1]).toBeCloseTo(0);
  });

  it("sizes cells in metres from pixels-per-metre", () => {
    expect(worldSize(m)).toEqual({ w: 2, h: 1 });
    expect(worldSize(m, 2)).toEqual({ w: 4, h: 2 });
    expect(worldSize(sheet({ pixelsPerMetre: null }), 1, 0.02)).toEqual({ w: 2, h: 1 });
  });
});

describe("screenHeading", () => {
  it("is relative to the camera: three.js default camera looks down -Z", () => {
    expect(screenHeading(1, 0, 0, -1)).toBeCloseTo(0);          // +X is screen-right
    expect(screenHeading(0, -1, 0, -1)).toBeCloseTo(PI / 2);    // away from the camera
    expect(screenHeading(0, 1, 0, -1)).toBeCloseTo(-PI / 2);    // towards the viewer
  });
  it("turns with the camera's yaw", () => {
    // camera looking along +X: forward +X is "away"; right = forward × up = +Z is screen-right
    expect(screenHeading(1, 0, 1, 0)).toBeCloseTo(PI / 2);
    expect(screenHeading(0, 1, 1, 0)).toBeCloseTo(0);
    expect(Math.abs(screenHeading(0, -1, 1, 0))).toBeCloseTo(PI);
  });
});

describe("parseManifest", () => {
  it("accepts a good manifest and the committed showroom sheet", () => {
    expect(parseManifest(sheet()).directions).toBe(16);
    const path = fileURLToPath(new URL("../../../public/assets/cinematic/showroom/hatchback.json", import.meta.url));
    const real = parseManifest(JSON.parse(readFileSync(path, "utf8")));
    expect(real.directions).toBe(16);
    expect(real.frames).toHaveLength(16);
    expect(real.pivot.y).toBeGreaterThan(0.5);   // the ground point sits in the lower half of the cell
  });
  it("rejects broken ones with a reason", () => {
    expect(() => parseManifest(null)).toThrow(/not an object/);
    expect(() => parseManifest({ ...sheet(), format: "x" })).toThrow(/format/);
    expect(() => parseManifest({ ...sheet(), frames: [] })).toThrow(/frames must list/);
    expect(() => parseManifest({ ...sheet(), image: "" })).toThrow(/image/);
    const bad = sheet();
    bad.frames[3] = { x: 790, y: 0, w: 100, h: 50 };
    expect(() => parseManifest(bad)).toThrow(/outside the atlas/);
  });
});
