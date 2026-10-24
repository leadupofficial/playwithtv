import { describe, expect, it } from "vitest";
import { DT, IDLE, golemHealth, newMatch, standings, step, waveSize, type KalariEvent, type KalariInput, type Match } from "./engine";
import { cpuInput, newBrain } from "./cpu";

const guardians = (o = {}) => newMatch([
  { id: "a", cpu: true, char: "simha" }, { id: "b", cpu: true, char: "mayil" },
  ...[0, 1, 2, 3].map((i) => ({ id: `g${i}`, cpu: true, char: "puli" as const, foe: true })),
], { mode: "guardians", waves: 2, introSeconds: 0.1, countdownSeconds: 0.3, ...o });

function toFight(m: Match) {
  while (m.phase !== "fight") step(m, DT, new Map());
}
function run(m: Match, secs: number, inputs: (t: number) => Map<string, KalariInput> = () => new Map()) {
  const ev: KalariEvent[] = [];
  for (let t = 0; t < secs; t += DT) ev.push(...step(m, DT, inputs(t)));
  return ev;
}
const fighter = (m: Match, id: string) => m.fighters.find((f) => f.id === id)!;
const strikeOnce = (id: string) => (t: number) => new Map([[id, { ...IDLE, strike: t < DT }]]);

describe("Guardians (co-op waves)", () => {
  it("needs both guardians and golems", () => {
    expect(() => newMatch([{ id: "a", cpu: true, char: "simha" }, { id: "b", cpu: true, char: "puli" }], { mode: "guardians" })).toThrow();
  });

  it("wave 1 raises two golems on the right, the rest wait; nobody hits their own side", () => {
    const m = guardians();
    toFight(m);
    const alive = m.fighters.filter((f) => f.foe && f.alive);
    expect(alive.length).toBe(waveSize(1, 4));
    expect(alive.every((f) => f.x > 0 && f.maxHealth === golemHealth(1))).toBe(true);
    const a = fighter(m, "a"), b = fighter(m, "b");
    for (const g of m.fighters.filter((f) => f.foe)) Object.assign(g, { x: 5, z: 3 });
    Object.assign(a, { x: 0, z: 0, face: Math.PI / 2 });
    Object.assign(b, { x: 1, z: 0 });
    const ev = run(m, 0.5, strikeOnce("a"));
    expect(ev.some((e) => e.kind === "hit" && e.on === "b")).toBe(false);
  });

  it("clearing every golem clears the wave (with style points); the last wave ends on the podium", () => {
    const m = guardians();
    toFight(m);
    const a = fighter(m, "a");
    for (const g of m.fighters.filter((f) => f.foe && f.alive)) {
      for (const o of m.fighters.filter((f) => f.foe && f !== g)) Object.assign(o, { x: 6, z: 3 });
      Object.assign(g, { x: 1, z: 0, vx: 0, vz: 0, health: 2, state: "ok" });
      Object.assign(a, { x: 0, z: 0, face: Math.PI / 2, state: "ok", vx: 0, vz: 0 });
      run(m, 0.6, strikeOnce("a"));
    }
    const ev = run(m, 2);
    expect(ev.some((e) => e.kind === "wave-clear" && e.n === 1)).toBe(true);
    expect(a.stats.style).toBeGreaterThan(0);
    run(m, 5);
    expect(m.wave).toBe(2);
    expect(m.fighters.filter((f) => f.foe && f.alive).length).toBe(waveSize(2, 4));
    for (const g of m.fighters) if (g.foe) Object.assign(g, { alive: false, state: "out" });
    const end = run(m, 6);
    expect(end.some((e) => e.kind === "wave-clear" && e.last)).toBe(true);
    expect(m.phase).toBe("podium");
    expect(standings(m).every((f) => !f.foe)).toBe(true);
  });

  it("CPU guardians and golems play a whole game to the podium (cleared or wiped out)", () => {
    const m = guardians({ waves: 3, seed: 9 });
    const brains = new Map(m.fighters.map((f, i) => [f.id, newBrain(5 + i * 13, f.foe ? "easy" : "normal")]));
    const all: KalariEvent[] = [];
    for (let t = 0; t < 400 && m.phase !== "podium"; t += DT) {
      all.push(...step(m, DT, new Map(m.fighters.map((f) => [f.id, cpuInput(m, f, brains.get(f.id)!, DT)]))));
    }
    expect(m.phase).toBe("podium");
    expect(all.some((e) => e.kind === "wave-clear" || e.kind === "wiped")).toBe(true);
    expect(all.filter((e) => e.kind === "hit").length).toBeGreaterThan(10);
  });
});
