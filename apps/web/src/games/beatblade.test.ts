import { describe, expect, it } from "vitest";
import { DIFFICULTIES, MapError, formatMap, generate, parseMap, type Note } from "./beat-blade/beatmap";
import { BeatRun, WINDOWS, laneOf } from "./beat-blade/engine";
import { expand, songBars, songBeats, songMs } from "./beat-blade/music";
import { DISTRICTS, REWARDS, TRACKS } from "./beat-blade/songs";

const BPM = 120; // half a beat = 250 ms

describe("beat map text", () => {
  it("reads blocks, rows, directions, bombs and walls, one line per half beat", () => {
    const notes = parseMap(`
      # a comment
      m^ .  .  lv
      .  B  .  .
      W4 W4 .  h<
      step 1
      .  .  mo .
    `, BPM);
    expect(notes).toEqual([
      { t: 0, kind: "block", lane: 0, row: 1, dir: "u" },
      { t: 0, kind: "block", lane: 3, row: 0, dir: "d" },
      { t: 250, kind: "bomb", lane: 1, row: 1, dir: "o" },
      { t: 500, kind: "wall", lane: 0, row: 1, dir: "o", width: 2, len: 1000 },
      { t: 500, kind: "block", lane: 3, row: 2, dir: "l" },
      { t: 750, kind: "block", lane: 2, row: 1, dir: "o" },
    ]);
  });
  it("says which line and lane is wrong", () => {
    expect(() => parseMap("m^ . .", BPM)).toThrow(/line 1: needs 4 cells/);
    expect(() => parseMap(". . zz .", BPM)).toThrow(MapError);
    expect(() => parseMap(". . zz .", BPM)).toThrow(/lane 3/);
  });
  it("round-trips through formatMap", () => {
    const text = "m^ . . lv\n. B . .\n. . h< .";
    expect(formatMap(parseMap(text, BPM), BPM).split("\n").slice(0, 3).join("\n")).toBe(text.replace("B", "Bm"));
  });
});

describe("generated maps (every song, every difficulty)", () => {
  for (const tr of TRACKS) {
    for (const d of DIFFICULTIES) {
      it(`${tr.name} / ${d} is playable`, () => {
        const notes = generate(tr, d);
        const blocks = notes.filter((n) => n.kind === "block");
        const minutes = songMs(tr) / 60_000;
        const nps = blocks.length / (minutes * 60);
        // density: easy is relaxed, hard is busy, nothing is impossible for one saber
        const [lo, hi] = d === "easy" ? [0.3, 1.4] : d === "normal" ? [0.8, 2.8] : [1.2, 4.2];
        expect(nps).toBeGreaterThan(lo);
        expect(nps).toBeLessThan(hi);
        if (d === "easy") expect(notes.every((n) => n.kind === "block" && n.row === 1)).toBe(true);
        // one saber: at most one block per moment, at least a quarter beat apart
        for (let i = 1; i < blocks.length; i++) expect(blocks[i]!.t - blocks[i - 1]!.t).toBeGreaterThanOrEqual(60_000 / tr.bpm / 2 - 1);
        // quick consecutive cuts flow (down → up, left → right): never the same direction twice in a row on half beats
        for (let i = 1; i < blocks.length; i++) {
          const a = blocks[i - 1]!, b = blocks[i]!;
          if (b.t - a.t < 60_000 / tr.bpm * 0.75 && a.dir !== "o" && b.dir !== "o") expect(b.dir).not.toBe(a.dir);
        }
        // no block hides inside a wall
        for (const w of notes.filter((n) => n.kind === "wall")) {
          const lanes = [w.lane, w.lane + (w.width ?? 1) - 1];
          for (const b of blocks) if (b.t >= w.t && b.t <= w.t + w.len!) expect(b.lane < lanes[0]! || b.lane > lanes[1]!).toBe(true);
        }
        // bombs never sit on a block's beat in its lane
        for (const bo of notes.filter((n) => n.kind === "bomb")) {
          expect(blocks.some((b) => b.lane === bo.lane && Math.abs(b.t - bo.t) < WINDOWS[d].good)).toBe(false);
        }
        expect(generate(tr, d)).toEqual(notes); // the same on every TV
      });
    }
  }
  it("harder is busier", () => {
    for (const tr of TRACKS) {
      const n = DIFFICULTIES.map((d) => generate(tr, d).filter((x) => x.kind === "block").length);
      expect(n[0]).toBeLessThan(n[1]!);
      expect(n[1]).toBeLessThanOrEqual(n[2]!);
    }
  });
});

describe("music", () => {
  it("every song is 45 s – 3 minutes, original data, and every bar has a beat", () => {
    expect(DISTRICTS).toHaveLength(5);
    expect(TRACKS).toHaveLength(15);
    expect(new Set(TRACKS.map((t) => t.id)).size).toBe(15);
    for (const t of TRACKS) {
      expect(songMs(t)).toBeGreaterThan(45_000); // short enough for arms holding a phone up
      expect(songMs(t)).toBeLessThan(180_000);
      for (const p of [t.kick, t.snare, t.hat, t.bass, t.lead]) expect(p).toHaveLength(16);
      const ev = expand(t);
      expect(ev.length).toBeGreaterThan(100);
      expect(ev.every((e, i) => i === 0 || e.t >= ev[i - 1]!.t)).toBe(true);
      expect(ev.every((e) => Number.isFinite(e.midi) && e.midi >= 0 && e.midi < 110)).toBe(true);
    }
  });
  it("a shortened song keeps the busy middle (quick mode)", () => {
    const t = TRACKS[0]!;
    const b = songBeats(t, 8);
    expect(b).toHaveLength(32);
    expect(b.some((x) => x.energy >= 2)).toBe(true);
    expect(songBars(t)).toBeGreaterThan(8);
  });
  it("rewards fit the 45 stars on offer", () => {
    expect(Math.max(...REWARDS.map((r) => r.stars))).toBeLessThanOrEqual(TRACKS.length * 3);
  });
});

const block = (t: number, lane: number, dir: Note["dir"] = "d"): Note => ({ t, kind: "block", lane, row: 1, dir });

describe("BeatRun", () => {
  it("grades cuts by timing, builds the multiplier, scores ×mult", () => {
    const notes = [0, 1, 2, 3, 4, 5, 6].map((i) => block(1000 + i * 500, 1, i % 2 ? "u" : "d"));
    const run = new BeatRun(notes, 1, "normal");
    const ev = notes.map((n, i) => run.cut(0, n.dir as "u" | "d", n.t + (i === 0 ? 70 : 10), 1));
    expect(ev[0]![0]).toMatchObject({ kind: "hit", judgement: "great", mult: 1 });
    expect(ev[1]).toContainEqual({ kind: "mult", p: 0, mult: 2 });
    expect(run.mult(0)).toBe(4);
    expect(run.runners[0]!.combo).toBe(7);
    expect(run.fullCombo(0)).toBe(true);
    expect(run.stars(0)).toBe(3);
  });
  it("wrong direction is a bad cut; a swing at nothing is free; a block left alone is a miss", () => {
    const run = new BeatRun([block(1000, 0, "u"), block(2000, 3, "l")], 1, "normal");
    expect(run.cut(0, "r", 500, 0)).toEqual([]);
    expect(run.cut(0, "d", 1010, 0)).toEqual(expect.arrayContaining([{ kind: "miss", p: 0, note: 0, bad: true }]));
    expect(run.update(2300, [0])).toEqual(expect.arrayContaining([{ kind: "miss", p: 0, note: 1, bad: false }]));
    expect(run.runners[0]!.misses).toBe(2);
    expect(run.stars(0)).toBe(1);
  });
  it("the blade reaches one lane either side, but not across the track", () => {
    const run = new BeatRun([block(1000, 1), block(2000, 0)], 1, "normal");
    expect(run.cut(0, "d", 1000, 2)[0]).toMatchObject({ kind: "hit" });
    expect(run.cut(0, "d", 2000, 3)).toEqual([]);
  });
  it("bombs hurt only when cut in their lane; walls drain whoever stands in them", () => {
    const notes: Note[] = [{ t: 1000, kind: "bomb", lane: 2, row: 1, dir: "o" }, { t: 3000, kind: "wall", lane: 0, row: 1, dir: "o", width: 2, len: 1000 }];
    const run = new BeatRun(notes, 2, "normal");
    expect(run.cut(0, "d", 1000, 1)).toEqual([]);
    expect(run.cut(1, "d", 1000, 2)[0]).toEqual({ kind: "bomb", p: 1, note: 0 });
    const h0 = run.runners[0]!.health;
    let walls = 0;
    for (let t = 2900; t < 4200; t += 16) walls += run.update(t, [-0.9, 0.9]).filter((e) => e.kind === "wall").length;
    expect(walls).toBe(1);
    expect(run.runners[0]!.health).toBeLessThan(h0 - 0.2);
    expect(run.runners[1]!.inWall).toBe(false);
  });
  it("players are judged separately on the same blocks", () => {
    const run = new BeatRun([block(1000, 1)], 2, "normal");
    expect(run.cut(0, "d", 1000, 1)[0]).toMatchObject({ kind: "hit", p: 0 });
    expect(run.cut(1, "d", 1020, 1)[0]).toMatchObject({ kind: "hit", p: 1 });
  });
  it("normal can be failed, easy cannot", () => {
    const many = Array.from({ length: 12 }, (_, i) => block(500 + i * 300, 1));
    const n = new BeatRun(many, 1, "normal");
    const e = new BeatRun(many, 1, "easy");
    n.update(10_000, [0]);
    e.update(10_000, [0]);
    expect(n.runners[0]!.failed).toBe(true);
    expect(n.over(5000)).toBe(true);
    expect(e.runners[0]!.failed).toBe(false);
    expect(e.stars(0)).toBe(1);
  });
  it("aim maps to lanes", () => {
    expect([-1, -0.6, -0.1, 0.1, 0.6, 1].map(laneOf)).toEqual([0, 0, 1, 2, 3, 3]);
  });
});
