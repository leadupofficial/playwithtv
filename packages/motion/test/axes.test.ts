import { describe, expect, it } from "vitest";
import recorded from "./fixtures/chrome-android-turns.json";
import { MotionEngine, RateOrderDetector, rotationOf, toScreen, v, type Gesture, type RateOrder, type Vec3 } from "../src/index";

// Recorded on a real phone (vivo I2304, Android 16, Chrome): steering left and right, then flicks and twists.
const fx = recorded as { angle: number; rows: number[][] };
const rates = (r: number[]) => ({ alpha: r[7]!, beta: r[8]!, gamma: r[9]! });

function settle(fallback: RateOrder, rows: number[][], toRates = rates) {
  const d = new RateOrderDetector(fallback);
  for (const r of rows) d.push(v(r[1]!, r[2]!, r[3]!), v(r[4]!, r[5]!, r[6]!), toRates(r), r[0]!);
  return d;
}

/** A phone turning steadily about `axis` (device frame), reporting rotationRate in `order`. */
function turning(axis: Vec3, order: RateOrder, degPerS = 120, ms = 3000) {
  const rows: number[][] = [];
  let g = v(0, 6.9, 7.1); // held tipped back, like a player does
  const w = v(axis.x * degPerS, axis.y * degPerS, axis.z * degPerS);
  for (let t = 0; t < ms; t += 16) {
    const s = Math.sign(Math.sin(t / 400)) || 1; // back and forth, so gravity stays in range
    const ws = v(w.x * s, w.y * s, w.z * s);
    const k = (Math.PI / 180) * 0.016;
    g = v(g.x - (ws.y * g.z - ws.z * g.y) * k, g.y - (ws.z * g.x - ws.x * g.z) * k, g.z - (ws.x * g.y - ws.y * g.x) * k);
    const rr = order === "xyz" ? { alpha: ws.x, beta: ws.y, gamma: ws.z } : { alpha: ws.z, beta: ws.x, gamma: ws.y };
    rows.push([t, g.x, g.y, g.z, 0, 0, 0, rr.alpha, rr.beta, rr.gamma]);
  }
  return rows;
}

describe("rotationRate axis order", () => {
  it("works out from a real Chrome phone that alpha, beta, gamma are x, y, z, whatever it guessed first", () => {
    expect(settle("spec", fx.rows).order).toBe("xyz");
    expect(settle("xyz", fx.rows).order).toBe("xyz");
    expect(settle("spec", fx.rows).settled).toBe(true);
  });

  it("keeps the spec order for a browser that follows it", () => {
    const rows = [...turning(v(0.6, 0, 0.8), "spec"), ...turning(v(0, 1, 0), "spec").map((r) => [r[0]! + 3000, ...r.slice(1)])];
    expect(settle("xyz", rows).order).toBe("spec");
  });

  it("does not decide from a phone at rest or turning only around gravity", () => {
    const still = Array.from({ length: 300 }, (_, i) => [i * 16, 0, 9.8, 0, 0, 0, 0, 0.3, -0.2, 0.1]);
    expect(settle("spec", still).settled).toBe(false);
    // y is up: spinning about it (150 deg/s, beta in one order, gamma in the other) moves gravity nowhere
    const aroundGravity = Array.from({ length: 300 }, (_, i) => [i * 16, 0, 9.8, 0, 0, 0, 0, 0, 150, 0]);
    expect(settle("spec", aroundGravity).settled).toBe(false);
  });

  it("with the measured order, the real twists come out as twists the right way round, and saber cuts left and right", () => {
    const run = (order: RateOrder, saber = false) => {
      const e = new MotionEngine({ saber });
      const out: Gesture[] = [];
      let cal = false;
      for (const r of fx.rows) {
        const s = { t: r[0]!, gravity: toScreen(v(r[1]!, r[2]!, r[3]!), fx.angle), linear: toScreen(v(r[4]!, r[5]!, r[6]!), fx.angle),
          rotation: toScreen(rotationOf(rates(r), order), fx.angle) };
        if (!cal && e.frame(s.t).still) { e.calibrate(); cal = true; }
        out.push(...e.push(s));
      }
      return out.map((g) => g.kind);
    };
    const xyz = run("xyz");
    expect(xyz).toContain("twist-left");
    expect(xyz).toContain("twist-right");
    expect(run("spec").filter((k) => k.startsWith("twist"))).toEqual([]); // the old reading: no twist ever fired
    const cuts = run("xyz", true);
    expect(cuts).toContain("flick-left");
    expect(cuts).toContain("flick-right");
    expect(run("spec", true).filter((k) => k === "flick-left" || k === "flick-right")).toEqual([]);
  });
});
