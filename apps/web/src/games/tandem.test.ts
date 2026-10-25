import { describe, expect, it } from "vitest";
import { LEVELS } from "./tandem-ride/levels";
import { heights, TandemSim } from "./tandem-ride/sim";

const TWO = ["#f00", "#00f"];

/** Two riders rocking their phones `hz` strokes a second each; `lag` seconds between them. Jumps ahead of
 * every rock and log (together for logs, unless `solo`); hops up for the high flowers. */
function ride(sim: TandemSim, track: string, o: { hz?: number; lag?: number; together?: boolean; maxMs?: number } = {}) {
  const hz = o.hz ?? 3, lag = o.lag ?? 0.02, together = o.together ?? true;
  const sides = [1, 1];
  let t = 0, next = [0, lag];
  const jumped = new Set<number>();
  while (!sim.outcome() && t < (o.maxMs ?? 240_000)) {
    for (const p of [0, 1]) if (t / 1000 >= next[p]!) { sides[p] = -sides[p]!; sim.steer(p, sides[p]!, 0); next[p]! += 1 / hz; }
    const { x, v, air } = sim.debug() as { x: number; v: number; air: number };
    // jump so the bike peaks over the next obstacle (a hop peaks after ~0.23 s, a big jump after ~0.38 s)
    for (let i = Math.floor(x + 0.9); i < x + 5; i++) {
      const ch = track[i];
      if ((ch !== "L" && ch !== "r" && ch !== "*") || jumped.has(i)) continue;
      const big = ch !== "r" && (together || sim.debug().solo);
      if (air <= 0 && i + 0.5 - (x + 0.9) <= Math.max(0.3, v) * (big ? 0.38 : 0.23)) {
        jumped.add(i);
        sim.act("jump", 0);
        if (ch !== "r" && together) { sim.step(50); sim.act("jump", 1); }
      }
      break;
    }
    sim.step(16);
    t += 16;
  }
  return sim;
}

describe("Tandem Ride", () => {
  it("every track uses known characters, ends at a picnic and comes back down to sea level", () => {
    for (const l of LEVELS) {
      expect(l.track, l.name).toMatch(/^[./\\rL~f*]+F$/);
      expect(l.track.length).toBeGreaterThan(120);
      const h = heights(l.track);
      expect(Math.min(...h), l.name).toBeGreaterThanOrEqual(-0.001);
      // a jump never lands you on the next obstacle: 5 m after a rock, 9 m after a log or high flower
      let prev = "", last = -99;
      [...l.track].forEach((c, i) => {
        if (c !== "r" && c !== "L" && c !== "*") return;
        if (prev && !(c === "*" && prev !== "L" && prev !== "r")) expect(i - last, `${l.name} @${i}`).toBeGreaterThanOrEqual(prev === "r" ? 5 : 9);
        if (!(c === "*" && prev === "*" && i - last < 4)) last = i;
        prev = c;
      });
    }
  });

  it("rocking side to side pedals; standing still doesn't", () => {
    const a = new TandemSim(LEVELS[0]!, 1, "", TWO);
    a.step(1000);
    expect(a.debug().x).toBeCloseTo(2, 1);
    for (let i = 0; i < 6; i++) { a.steer(0, i % 2 ? 1 : -1, 0); a.steer(1, i % 2 ? 1 : -1, 0); a.step(150); }
    expect(a.debug().x).toBeGreaterThan(3);
    expect(a.debug().strokes).toEqual([6, 6]);
  });

  it("pedalling in step goes faster than pedalling out of step", () => {
    const go = (lag: number) => { const s = new TandemSim(LEVELS[0]!, 1, "", TWO); ride(s, LEVELS[0]!.track, { lag, maxMs: 6000 }); return s.debug().x as number; };
    expect(go(0.02)).toBeGreaterThan(go(0.16) + 4);
  });

  it("two Jump presses in the same frame make a big jump; one press is a hop", () => {
    const go = (both: boolean) => {
      const s = new TandemSim(LEVELS[0]!, 1, "", TWO);
      s.act("jump", 0);
      if (both) s.act("jump", 1);
      let top = 0;
      for (let i = 0; i < 60; i++) { s.step(16); top = Math.max(top, s.debug().air as number); }
      return top;
    };
    expect(go(false)).toBeLessThan(0.7);
    expect(go(true)).toBeGreaterThan(1.2);
  });

  it("a log stops you unless you both jump at once; a lone hop clears rocks", () => {
    const track = "....................L.......r.........F";
    const lvl = { name: "t", world: 0, par: 20, track };
    const alone = new TandemSim(lvl, 1, "", TWO);
    ride(alone, track, { together: false, maxMs: 8000 });
    expect(alone.debug().crashes).toBe(1);
    const both = new TandemSim(lvl, 1, "", TWO);
    ride(both, track);
    expect(both.outcome()?.won).toBe(true);
    expect(both.debug().crashes).toBe(0);
  });

  it("steady riders finish every track, beat Grandpa Joe, and three stars are reachable", () => {
    for (const l of LEVELS) {
      const s = ride(new TandemSim(l, 3, "", TWO), l.track);
      const o = s.outcome()!;
      expect(o, l.name).not.toBeNull();
      expect(s.debug().crashes, l.name).toBe(0);
      expect(o.stars, `${l.name}: ${o.checks.map((c) => c.text).join(" | ")}`).toBe(3);
    }
  });

  it("lazy riders (slow and out of step) still finish but lose to Grandpa Joe", () => {
    for (const l of LEVELS) {
      const s = ride(new TandemSim(l, 3, "", TWO), l.track, { hz: 1.6, lag: 0.3 });
      const o = s.outcome()!;
      expect(o?.won, l.name).toBe(true);
      expect(o.stars, l.name).toBe(1);
    }
  });

  it("from world 2 on, riders who pedal fast but completely out of step lose to Grandpa Joe", () => {
    for (const l of LEVELS.filter((x) => x.world > 0)) {
      const s = ride(new TandemSim(l, 3, "", TWO), l.track, { hz: 3, lag: 1 / 6 });
      expect(s.outcome()!.checks[1]!.ok, l.name).toBe(false);
    }
  });

  it("one player alone can still finish a ride (every jump is a big one)", () => {
    const l = LEVELS[0]!;
    const s = new TandemSim(l, 3, "", ["#f00"]);
    ride(s, l.track, { together: false });
    expect(s.outcome()?.won).toBe(true);
  });

  it("a quick game is a short ride", () => {
    const l = LEVELS[5]!;
    const s = ride(new TandemSim(l, 3, "", TWO, true), l.track.slice(0, 60) + "....F");
    expect(s.outcome()?.won).toBe(true);
    expect(s.debug().len).toBeLessThan(70);
  });
});
