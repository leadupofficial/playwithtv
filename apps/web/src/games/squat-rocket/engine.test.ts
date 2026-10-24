import { describe, expect, it } from "vitest";
import { DT, MIN_GAP, NORMAL, QUICK, awards, funKcal, newMatch, phaseLeft, step, tankSize, type GameEvent, type Intensity, type Match, type PlayerIn } from "./engine";

const standing = (over: Partial<PlayerIn> = {}): PlayerIn => ({ ok: true, lean: 0, intensity: 1, seated: false, quality: 0.9, ...over });

/** Runs the match until `until(m)` or the end, calling `plan(m, id)` each step for each player's actions. */
function run(m: Match, opts: { input?: (id: string, m: Match) => PlayerIn; plan?: (m: Match, id: string) => string | null; until?: (m: Match) => boolean; max?: number } = {}) {
  const evs: GameEvent[] = [];
  const max = opts.max ?? 400 / DT;
  for (let i = 0; i < max && m.phase !== "done"; i++) {
    if (opts.until?.(m)) break;
    const actions: Array<{ id: string; action: string }> = [];
    for (const r of m.rockets) {
      const a = opts.plan?.(m, r.id);
      if (a) actions.push({ id: r.id, action: a });
    }
    evs.push(...step(m, DT, (id) => opts.input?.(id, m) ?? standing(), actions));
  }
  return evs;
}
/** A pump every `gap` seconds during the fuel phase. */
const pumpEvery = (gap: number) => {
  let last = -99;
  return (m: Match) => {
    if (m.phase !== "fuel" || m.time - last < gap) return null;
    last = m.time;
    return "pump";
  };
};
const toPhase = (m: Match, phase: string) => run(m, { until: (x) => x.phase === phase });

describe("match flow", () => {
  it("runs warm-up → fuel → launch → climb → storm → finale → done in about 40 s with ?quick=1", () => {
    const m = newMatch(["a", "b"], { timing: QUICK, seed: 3 });
    const phases = run(m).filter((e) => e.kind === "phase").map((e) => (e as { phase: string }).phase);
    expect(phases).toEqual(["fuel", "launch", "climb", "storm", "finale", "done"]);
    expect(m.time).toBeGreaterThan(38);
    expect(m.time).toBeLessThan(42);
    const total = Object.values(NORMAL).reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(160); // about 3 minutes with the get-ready screen
    expect(total).toBeLessThan(190);
  });

  it("warm-up moves are counted but not scored", () => {
    const m = newMatch(["a"], { timing: QUICK });
    const ev = run(m, { plan: (x) => (x.phase === "warmup" && Math.round(x.t * 60) % 60 === 30 ? "pump" : null), until: (x) => x.phase === "fuel" });
    expect(ev.filter((e) => e.kind === "warm").length).toBeGreaterThanOrEqual(4);
    expect(m.rockets[0]!.score).toBe(0);
    expect(phaseLeft(m)).toBeCloseTo(QUICK.fuel, 1);
  });
});

describe("fuel phase: squats pump fuel", () => {
  it("steady reps fill the tank, build a combo and score more with perfect form", () => {
    const m = newMatch(["a", "b"], { timing: NORMAL, seed: 5 });
    toPhase(m, "fuel");
    const ev = run(m, {
      input: (id) => standing({ quality: id === "a" ? 0.9 : 0.5 }),
      plan: pumpEvery(2.5),
      until: (x) => x.phase === "launch",
    });
    const [a, b] = m.rockets;
    expect(a!.reps).toBe(20);
    expect(a!.fuel).toBe(1);
    expect(a!.full).toBe(true);
    expect(ev.some((e) => e.kind === "tank-full" && e.id === "a")).toBe(true);
    expect(a!.bestCombo).toBe(20);
    expect(a!.perfect).toBe(20);
    expect(b!.perfect).toBe(0);
    expect(a!.score).toBeGreaterThan(b!.score);
  });

  it("reps faster than the cap don't count (rewards rhythm, not speed)", () => {
    const m = newMatch(["a"], { timing: NORMAL });
    toPhase(m, "fuel");
    const ev = run(m, { plan: pumpEvery(0.3), until: (x) => x.phase === "launch" });
    expect(ev.filter((e) => e.kind === "too-fast").length).toBeGreaterThan(50);
    expect(m.rockets[0]!.reps).toBeLessThanOrEqual(Math.ceil(NORMAL.fuel / MIN_GAP[1]) + 1);
  });

  it("a long pause breaks the combo", () => {
    const m = newMatch(["a"], { timing: NORMAL });
    toPhase(m, "fuel");
    let n = 0;
    run(m, { plan: (x) => (x.phase === "fuel" && [2, 4, 6, 20, 22].some((s) => Math.abs(x.t - s) < DT / 2) ? (n++, "pump") : null), until: (x) => x.phase === "launch" });
    expect(n).toBe(5);
    expect(m.rockets[0]!.bestCombo).toBe(3);
    expect(m.rockets[0]!.combo).toBe(2);
  });

  it("is fair across intensities: each at its own pace scores about the same", () => {
    const pace: Record<Intensity, number> = { 0: 4, 1: 3, 2: 2.2 };
    const m = newMatch(["g", "n", "s"], { timing: NORMAL });
    const intensity = (id: string): Intensity => (id === "g" ? 0 : id === "n" ? 1 : 2);
    toPhase(m, "fuel");
    const last: Record<string, number> = { g: -99, n: -99, s: -99 };
    run(m, {
      input: (id) => standing({ intensity: intensity(id) }),
      plan: (x, id) => {
        if (x.phase !== "fuel" || x.time - last[id]! < pace[intensity(id)]) return null;
        last[id] = x.time;
        return "pump";
      },
      until: (x) => x.phase === "launch",
    });
    const scores = m.rockets.map((r) => r.score);
    expect(Math.max(...scores) / Math.min(...scores)).toBeLessThan(1.3);
    expect(m.rockets.every((r) => r.fuel > 0.95)).toBe(true);
    expect([tankSize(NORMAL, 0), tankSize(NORMAL, 1), tankSize(NORMAL, 2), tankSize(QUICK, 1)]).toEqual([13, 17, 23, 3]);
  });
});

describe("climb: dodge meteors, lean for stars", () => {
  /** Dodges `offset` s relative to each incoming meteor's arrival. */
  const dodger = (offset: number | null) => (m: Match, id: string) => {
    if (m.phase !== "climb" || offset === null) return null;
    const d = m.debris.find((x) => x.target === id && x.kind === "meteor" && x.state === "incoming");
    return d && Math.abs(m.time - (d.at + offset)) < DT / 2 ? "dodge" : null;
  };

  it("a jump inside the window dodges (perfect near the arrival); a missed one is a harmless bonk", () => {
    const m = newMatch(["good", "late", "none"], { timing: NORMAL, seed: 9 });
    toPhase(m, "climb");
    const plans: Record<string, ReturnType<typeof dodger>> = { good: dodger(-0.15), late: dodger(0.3), none: dodger(null) };
    const ev = run(m, { plan: (x, id) => plans[id]!(x, id), until: (x) => x.phase === "storm" });
    const [good, late, none] = m.rockets;
    expect(good!.dodges).toBeGreaterThanOrEqual(10);
    expect(good!.perfectDodges).toBe(good!.dodges);
    expect(good!.hits).toBe(0);
    expect(late!.dodges).toBe(good!.dodges);    // 300 ms late still counts (camera latency forgiveness)
    expect(late!.perfectDodges).toBe(0);
    expect(none!.hits).toBe(good!.dodges);
    expect(none!.score).toBeGreaterThanOrEqual(0);
    expect(ev.filter((e) => e.kind === "warn").length).toBe(good!.dodges * 3);
    expect(good!.altitude).toBeGreaterThan(none!.altitude); // bonks slow you down
  });

  it("jumping all the time doesn't work: an early jump means a short cooldown", () => {
    const m = newMatch(["spam"], { timing: NORMAL, seed: 2 });
    toPhase(m, "climb");
    run(m, { plan: (x) => (x.phase === "climb" && Math.round(x.t * 60) % 6 === 0 ? "dodge" : null), until: (x) => x.phase === "storm" });
    const r = m.rockets[0]!;
    expect(r.hits).toBeGreaterThan(0);
  });

  it("leaning towards a star collects it", () => {
    const m = newMatch(["a", "b"], { timing: NORMAL, seed: 4 });
    toPhase(m, "climb");
    run(m, {
      input: (id, x) => {
        const star = x.debris.find((d) => d.target === id && d.kind === "star" && d.state === "incoming" && d.at - x.time < 1.5);
        return standing({ lean: id === "a" && star ? Math.sign(star.x) : 0 });
      },
      until: (x) => x.phase === "storm",
    });
    expect(m.rockets[0]!.stars).toBeGreaterThan(5);
    expect(m.rockets[1]!.stars).toBe(0);
  });

  it("a player the camera lost gets no meteors and no bonks until it sees them again", () => {
    const m = newMatch(["a"], { timing: NORMAL, seed: 1 });
    toPhase(m, "climb");
    run(m, { input: () => standing({ ok: false }), until: (x) => x.phase === "storm" });
    const r = m.rockets[0]!;
    expect(r.hits).toBe(0);
    expect(r.lost).toBeGreaterThan(50);
  });
});

describe("storm finale: jacks power the team shield", () => {
  const jacker = (gap: number) => {
    const last: Record<string, number> = {};
    return (m: Match, id: string) => {
      if (m.phase !== "storm" || m.time - (last[id] ?? -99) < gap) return null;
      last[id] = m.time;
      return "jack";
    };
  };
  it("a team doing steady jacks beats the storm", () => {
    const m = newMatch(["a", "b"], { timing: NORMAL });
    toPhase(m, "storm");
    const ev = run(m, { plan: jacker(1.2), until: (x) => x.phase === "finale" });
    expect(ev.find((e) => e.kind === "storm")).toEqual({ kind: "storm", beaten: true });
    expect(m.rockets.every((r) => r.jacks > 20)).toBe(true);
  });
  it("one player alone can keep it up at a gentle pace too", () => {
    const m = newMatch(["a"], { timing: NORMAL });
    toPhase(m, "storm");
    run(m, { input: () => standing({ intensity: 0 }), plan: jacker(1.3), until: (x) => x.phase === "finale" });
    expect(m.stormBeaten).toBe(true);
  });
  it("no jacks: the shield runs out (still a friendly ending)", () => {
    const m = newMatch(["a"], { timing: NORMAL });
    toPhase(m, "storm");
    run(m, { until: (x) => x.phase === "finale" });
    expect(m.stormBeaten).toBe(false);
    expect(m.shield).toBe(0);
  });
});

describe("results", () => {
  it("hands out awards with fun stats and a playful energy estimate", () => {
    const m = newMatch(["a", "b"], { timing: QUICK, seed: 7 });
    const lastPump: Record<string, number> = {};
    run(m, {
      plan: (x, id) => {
        if (x.phase === "fuel" && x.time - (lastPump[id] ?? -99) > (id === "a" ? 1.2 : 2.5)) { lastPump[id] = x.time; return "pump"; }
        if (x.phase === "storm" && Math.round(x.t * 60) % 60 === 0) return "jack";
        return null;
      },
    });
    expect(m.phase).toBe("done");
    const list = awards(m, (id) => (id === "a" ? "Ravi" : "Divya"));
    expect(list[0]).toMatchObject({ id: "a", title: "Squat Champion" });
    expect(list[0]!.line).toMatch(/Ravi lifted the rocket \d+ times!/);
    expect(new Set(list.slice(0, 2).map((x) => x.id)).size).toBe(2); // spread between players
    expect(funKcal(m.rockets[0]!)).toBeGreaterThanOrEqual(0);
  });

  it("is deterministic for a seed", () => {
    const play = () => {
      const m = newMatch(["a", "b"], { timing: QUICK, seed: 11 });
      run(m, { plan: (x) => (x.phase === "climb" && Math.round(x.t * 60) % 50 === 0 ? "dodge" : x.phase === "fuel" && Math.round(x.t * 60) % 90 === 0 ? "pump" : null) });
      return m.rockets.map((r) => [r.score, r.hits, r.dodges]);
    };
    expect(play()).toEqual(play());
  });
});
