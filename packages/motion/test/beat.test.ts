import { describe, expect, it } from "vitest";
import { ClockSync, HIT_WINDOWS, LatencyCalibrator, STAMP_PERIOD, encodeStamp, judgeHit, unwrapStamp } from "../src/beat.js";

/** A tiny deterministic random source (tests must not flake). */
const rng = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

describe("stamps", () => {
  it("round-trip through the axis within a millisecond, across period edges", () => {
    for (const t of [0, 1, 4095.5, STAMP_PERIOD - 0.25, STAMP_PERIOD, 123_456.75, 9_999_999.1]) {
      const pk = encodeStamp(t);
      expect(pk).toBeGreaterThanOrEqual(-1);
      expect(pk).toBeLessThan(1);
      for (const delay of [0, 15, 150, 900]) expect(unwrapStamp(pk, t + delay)).toBeCloseTo(t, 3);
    }
  });
  it("never puts a swing far in the future (it always happened before it arrived)", () => {
    const now = 50_000;
    for (let t = now - 3000; t <= now + 500; t += 37) expect(unwrapStamp(encodeStamp(t), now)).toBeCloseTo(t, 3);
  });
});

describe("ClockSync", () => {
  it("is unsynced until it has a few round trips", () => {
    const c = new ClockSync();
    expect(c.tvTime(10)).toBeNull();
    c.add(0, 1000, 20);
    c.add(100, 1100, 120);
    expect(c.synced).toBe(false);
    c.add(200, 1200, 220);
    expect(c.synced).toBe(true);
  });
  it("finds the offset within a few ms under jittery, asymmetric Wi-Fi delays", () => {
    const r = rng(7);
    const TRUE_OFFSET = 51_234.5; // tv = phone + this
    const c = new ClockSync();
    let phone = 1000;
    for (let i = 0; i < 16; i++) {
      const up = 4 + r() * 80; // phone → TV
      const down = 4 + r() * 120; // TV → phone (often slower: asymmetric)
      const tvAt = phone + up + TRUE_OFFSET;
      c.add(phone, tvAt, phone + up + down);
      phone += 500;
    }
    expect(Math.abs(c.offset - TRUE_OFFSET)).toBeLessThanOrEqual(c.uncertainty);
    expect(Math.abs(c.offset - TRUE_OFFSET)).toBeLessThan(20);
  });
  it("ignores nonsense samples", () => {
    const c = new ClockSync(16, 1);
    c.add(100, 5, 50); // negative round trip
    c.add(100, NaN, 120);
    expect(c.synced).toBe(false);
  });
});

describe("stamped swings vs arrival time (why the stamp exists)", () => {
  it("stamped judging is perfect where arrival-time judging misses beats", () => {
    const r = rng(11);
    const OFFSET = 20_000;
    const c = new ClockSync();
    let p = 0;
    for (let i = 0; i < 12; i++) {
      const up = 5 + r() * 40, down = 5 + r() * 40;
      c.add(p, p + up + OFFSET, p + up + down);
      p += 300;
    }
    let stamped = 0, arrival = 0;
    for (let beat = 1; beat <= 50; beat++) {
      const beatTv = 100_000 + beat * 500;
      const swingPhone = beatTv - OFFSET + (r() - 0.5) * 30; // a good player: ±15 ms
      const delay = 10 + r() * 140; // a jittery network
      const arrivedTv = swingPhone + OFFSET + delay;
      const swingTv = unwrapStamp(encodeStamp(c.tvTime(swingPhone)!), arrivedTv);
      if (judgeHit(swingTv, beatTv) === "perfect") stamped++;
      if (judgeHit(arrivedTv - 80, beatTv) === "perfect") arrival++; // even with a perfect average correction
    }
    expect(stamped).toBeGreaterThanOrEqual(45);
    expect(arrival).toBeLessThanOrEqual(stamped - 10); // ~a third of the beats lost to jitter alone
  });
});

describe("judgeHit", () => {
  it("grades by distance from the beat, symmetric", () => {
    expect(judgeHit(1000, 1000)).toBe("perfect");
    expect(judgeHit(1000 - HIT_WINDOWS.perfect, 1000)).toBe("perfect");
    expect(judgeHit(1060, 1000)).toBe("great");
    expect(judgeHit(880, 1000)).toBe("good");
    expect(judgeHit(1200, 1000)).toBe("miss");
  });
});

describe("LatencyCalibrator", () => {
  it("learns a player's lag from swings to a metronome, ignoring the odd stray", () => {
    const r = rng(3);
    const cal = new LatencyCalibrator();
    for (let i = 0; i < 8; i++) cal.add(70 + (r() - 0.5) * 40);
    cal.add(-900); // missed a beat entirely
    cal.add(400); // swung late once
    expect(cal.ready).toBe(true);
    expect(cal.offset).toBeGreaterThan(55);
    expect(cal.offset).toBeLessThan(95);
  });
  it("is not ready while the swings are all over the place", () => {
    const r = rng(5);
    const cal = new LatencyCalibrator();
    for (let i = 0; i < 10; i++) cal.add((r() - 0.5) * 600);
    expect(cal.ready).toBe(false);
  });
});

describe("stamps on the wire", () => {
  it("survive the phone's six-decimal rounding to well under a millisecond", () => {
    for (const t of [0, 1234.5, 8191.9, 99_999.3]) {
      const sent = Math.round(encodeStamp(t) * 1e6) / 1e6;
      expect(Math.abs(unwrapStamp(sent, t + 40) - t)).toBeLessThan(0.05);
    }
  });
  it("would NOT survive two-decimal rounding (why pk is exempt from it)", () => {
    const sent = Math.round(encodeStamp(1234.5) * 100) / 100;
    expect(Math.abs(unwrapStamp(sent, 1274.5) - 1234.5)).toBeGreaterThan(5);
  });
});
