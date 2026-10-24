import { describe, expect, it } from "vitest";
import { TRACKS, buildTrack, minSeparation, pointAt } from "./track";
import { DRIFT_T2, IDLE, KART_R, newRace, placeOf, standings, step, type KartInput, type Race, type RaceEvent } from "./engine";
import { rollItem } from "./items";
import { drive } from "./cpu";

const DT = 1 / 60;
const grove = buildTrack(TRACKS.grove!);

function run(r: Race, secs: number, inputs: (r: Race) => Map<string, KartInput> = () => new Map()) {
  const ev: RaceEvent[] = [];
  for (let t = 0; t < secs && r.phase !== "done"; t += DT) ev.push(...step(r, DT, inputs(r)));
  return ev;
}
const solo = (laps = 3) => {
  const r = newRace(grove, [{ id: "p", cpu: false }], { laps, countdown: 0 });
  step(r, DT, new Map()); // countdown over
  return r;
};
/** Moves the kart along the road in small steps (as if driving), `ds` px per step. */
function slide(r: Race, from: number, to: number, ds = 4) {
  const k = r.karts[0]!;
  const ev: RaceEvent[] = [];
  for (let s = from; ds > 0 ? s <= to : s >= to; s += ds) {
    const p = pointAt(r.track, s);
    k.x = p.x; k.y = p.y; k.vx = 0; k.vy = 0; k.a = p.a;
    ev.push(...step(r, DT, new Map()));
  }
  return ev;
}

describe("kart tracks", () => {
  it.each(Object.keys(TRACKS))("%s is a closed loop that fits the stage, with walls between every pair of road sections", (id) => {
    const t = buildTrack(TRACKS[id]!);
    expect(t.len).toBeGreaterThan(1500);
    for (let i = 0; i < t.n; i++) {
      expect(t.xs[i]! - t.wall).toBeGreaterThan(0);
      expect(t.xs[i]! + t.wall).toBeLessThan(1050);  // the standings panel is on the right
      expect(t.ys[i]! - t.wall).toBeGreaterThan(0);
      expect(t.ys[i]! + t.wall).toBeLessThan(720);
    }
    // two different parts of the road never share a grass verge: no driving across the infield
    expect(minSeparation(t, 400)).toBeGreaterThan(2 * t.wall);
    expect(t.boxes.length).toBe(TRACKS[id]!.boxes.length * 3);
  });
});

describe("laps and checkpoints", () => {
  it("driving the loop in order counts each lap and finishes after the last one", () => {
    const r = solo(2);
    const L = r.track.len;
    const ev = slide(r, 0, 2 * L + 20);
    expect(ev.filter((e) => e.kind === "lap")).toHaveLength(2);
    expect(ev.find((e) => e.kind === "finish")).toMatchObject({ id: "p", place: 1 });
    expect(r.karts[0]!.lap).toBe(2);
  });

  it("the start grid is behind the line: crossing it the first time is not a lap", () => {
    const r = solo();
    expect(r.karts[0]!.dist).toBeLessThan(0);
    const ev = slide(r, -60, 100);
    expect(ev.some((e) => e.kind === "lap")).toBe(false);
    expect(r.karts[0]!.dist).toBeGreaterThan(90);
  });

  it("reversing over the line and back never counts a lap", () => {
    const r = solo();
    const L = r.track.len;
    // a whole lap backwards (passing every checkpoint the wrong way) …
    const back = slide(r, 50, -L - 60, -4);
    expect(back.some((e) => e.kind === "lap")).toBe(false);
    // … then forwards over the line again
    const ev = [...slide(r, -300, -L - 300, -4), ...slide(r, -300, 100)];
    expect(ev.some((e) => e.kind === "lap")).toBe(false);
    expect(r.karts[0]!.lap).toBe(0);
    expect(r.karts[0]!.cp).toBe(0);
  });

  it("a shortcut that skips checkpoints earns nothing until the kart goes back", () => {
    const r = solo();
    const L = r.track.len;
    slide(r, 0, 0.05 * L);
    const before = r.karts[0]!.dist;
    const ev = slide(r, 0.55 * L, L + 40); // teleported past half the lap, then on over the line
    expect(ev.some((e) => e.kind === "missed")).toBe(true);
    expect(ev.some((e) => e.kind === "lap")).toBe(false);
    expect(r.karts[0]!.dist).toBeLessThan(before + L / r.track.def.cps);
    slide(r, 0.05 * L, L + 40); // drives the skipped part properly: the lap counts
    expect(r.karts[0]!.lap).toBe(1);
  });

  it("positions follow race distance, and finishers rank by finishing time", () => {
    const r = newRace(grove, [{ id: "a", cpu: false }, { id: "b", cpu: false }], { laps: 1, countdown: 0 });
    step(r, DT, new Map());
    const [a, b] = r.karts;
    const put = (k: typeof a, s: number) => { const p = pointAt(grove, s); k!.x = p.x; k!.y = p.y; k!.vx = k!.vy = 0; };
    for (let s = 0; s < grove.len * 0.5; s += 4) { put(a, s + 60); put(b, s); step(r, DT, new Map()); }
    expect(placeOf(r, "a")).toBe(1);
    for (let s = grove.len * 0.5; s < grove.len + 30; s += 4) { put(b, s + 60); put(a, s); step(r, DT, new Map()); }
    expect(r.finishOrder).toEqual(["b", "a"]);
    expect(standings(r).map((x) => [x.id, x.place])).toEqual([["b", 1], ["a", 2]]);
  });
});

describe("driving", () => {
  it("gas accelerates up to top speed and steering turns the kart", () => {
    const r = solo();
    const a0 = r.karts[0]!.a;
    run(r, 0.8, () => new Map([["p", { ...IDLE, gas: true, steer: 0.6 }]]));
    const k = r.karts[0]!;
    expect(Math.hypot(k.vx, k.vy)).toBeGreaterThan(150);
    expect(k.a).toBeGreaterThan(a0 + 0.5);
  });

  it("a long drift releases a big spark boost; a short one gives nothing", () => {
    // a wide open test circuit, so the drift is never cut short by a wall
    const open = buildTrack({ ...TRACKS.oval!, hw: 400, points: TRACKS.oval!.points.map(([x, y]) => [x * 4, y * 4] as [number, number]) });
    const go = (secs: number) => {
      const r = newRace(open, [{ id: "p", cpu: false }], { countdown: 0 });
      step(r, DT, new Map());
      const k = r.karts[0]!;
      k.vx = Math.cos(k.a) * 220; k.vy = Math.sin(k.a) * 220;
      const ev = run(r, secs, () => new Map([["p", { steer: 1, gas: true, drift: true, item: false }]]));
      ev.push(...step(r, DT, new Map([["p", { ...IDLE, gas: true }]])));
      return { ev, k };
    };
    const long = go(DRIFT_T2 + 0.4);
    expect(long.ev.some((e) => e.kind === "hop")).toBe(true);
    expect(long.ev.find((e) => e.kind === "drift-boost")).toMatchObject({ tier: 2 });
    expect(long.k.boostT).toBeGreaterThan(0.9);
    const short = go(0.2);
    expect(short.ev.some((e) => e.kind === "drift-boost")).toBe(false);
    expect(short.k.boostT).toBe(0);
  });

  it("walls keep karts on the circuit, and grass slows them down", () => {
    const r = solo();
    const k = r.karts[0]!;
    run(r, 4, () => new Map([["p", { ...IDLE, gas: true, steer: -0.15 }]]));
    const p = { x: r.track.xs[k.idx]!, y: r.track.ys[k.idx]! };
    expect(Math.hypot(k.x - p.x, k.y - p.y)).toBeLessThanOrEqual(r.track.wall - KART_R + 0.5);
    const g = solo();
    const gk = g.karts[0]!;
    const side = pointAt(grove, 600, grove.hw + 15);
    gk.x = side.x; gk.y = side.y; gk.a = side.a;
    run(g, 2, () => new Map([["p", { ...IDLE, gas: true }]]));
    expect(gk.offroad || Math.hypot(gk.vx, gk.vy) < 200).toBe(true);
  });

  it("karts that drive into each other bump apart", () => {
    const r = newRace(grove, [{ id: "a", cpu: false }, { id: "b", cpu: false }], { countdown: 0 });
    step(r, DT, new Map());
    const [a, b] = r.karts as [typeof r.karts[0], typeof r.karts[0]];
    const p = pointAt(grove, 300);
    a!.x = p.x - 20; a!.y = p.y; a!.vx = 150; a!.vy = 0;
    b!.x = p.x + 20; b!.y = p.y; b!.vx = -150; b!.vy = 0;
    const ev = run(r, 0.3);
    expect(ev.some((e) => e.kind === "bump")).toBe(true);
    expect(Math.hypot(a!.x - b!.x, a!.y - b!.y)).toBeGreaterThanOrEqual(2 * KART_R - 0.5);
    expect(a!.vx).toBeLessThan(150);
  });
});

describe("items", () => {
  it("a gift box gives an item after a short roulette; a Soap Slick dropped behind spins out the next kart", () => {
    const r = newRace(grove, [{ id: "a", cpu: false }, { id: "b", cpu: false }], { countdown: 0, seed: 5 });
    step(r, DT, new Map());
    const [a, b] = r.karts;
    const box = r.boxes[1]!;
    a!.x = box.x; a!.y = box.y;
    const ev = run(r, DT * 2);
    expect(ev.find((e) => e.kind === "pickup")).toMatchObject({ id: "a" });
    expect(box.t).toBeGreaterThan(0);
    a!.item = "puddle"; a!.itemN = 1;
    expect(a!.rollT).toBeGreaterThan(0);
    run(r, 1);
    const use = run(r, DT * 2, () => new Map([["a", { ...IDLE, item: true }]]));
    expect(use.find((e) => e.kind === "use")).toMatchObject({ id: "a", item: "puddle" });
    expect(a!.item).toBeNull();
    const slick = r.puddles.find((p) => p.on)!;
    b!.x = slick.x - 30; b!.y = slick.y; b!.vx = 200; b!.vy = 0;
    const hit = run(r, 0.4);
    expect(hit.find((e) => e.kind === "spin")).toMatchObject({ id: "b", by: "a", cause: "puddle" });
    expect(b!.spinT).toBeGreaterThan(0);
    expect(a!.stats.hits).toBe(1);
  });

  it("a coconut rolls forward and spins out the kart ahead; a Boing Bumper blocks it", () => {
    const go = (shield: boolean) => {
      const r = newRace(grove, [{ id: "a", cpu: false }, { id: "b", cpu: false }], { countdown: 0 });
      step(r, DT, new Map());
      const [a, b] = r.karts;
      const p = pointAt(grove, 40);
      Object.assign(a!, { x: p.x, y: p.y, a: p.a, vx: 0, vy: 0, item: "coconut", itemN: 1 });
      Object.assign(b!, { x: p.x + Math.cos(p.a) * 110, y: p.y + Math.sin(p.a) * 110, a: p.a, vx: 0, vy: 0, shieldT: shield ? 5 : 0 });
      return run(r, 0.6, (rr) => new Map([["a", { ...IDLE, item: rr.time < 0.05 }]]));
    };
    expect(go(false).find((e) => e.kind === "spin")).toMatchObject({ id: "b", cause: "coconut" });
    const blocked = go(true);
    expect(blocked.some((e) => e.kind === "spin")).toBe(false);
    expect(blocked.some((e) => e.kind === "blocked")).toBe(true);
  });

  it("ITEM pressed during the roulette is used as soon as the roulette stops", () => {
    const r = newRace(grove, [{ id: "a", cpu: false }], { countdown: 0 });
    step(r, DT, new Map());
    const a = r.karts[0]!;
    Object.assign(a, { item: "bumper", itemN: 1, rollT: 0.5 });
    const early = run(r, DT * 2, () => new Map([["a", { ...IDLE, item: true }]]));
    expect(early.some((e) => e.kind === "use")).toBe(false);
    const later = run(r, 0.6);
    expect(later.find((e) => e.kind === "use")).toMatchObject({ id: "a", item: "bumper" });
    expect(a.shieldT).toBeGreaterThan(4);
  });

  it("zoom boosts, and a shielded kart knocks others spinning", () => {
    const r = newRace(grove, [{ id: "a", cpu: false }, { id: "b", cpu: false }], { countdown: 0 });
    step(r, DT, new Map());
    const [a, b] = r.karts;
    Object.assign(a!, { item: "zoom", itemN: 1 });
    run(r, DT * 2, () => new Map([["a", { ...IDLE, item: true }]]));
    expect(a!.boostT).toBeGreaterThan(0.9);
    a!.shieldT = 3;
    const p = pointAt(grove, 300);
    Object.assign(a!, { x: p.x - 20, y: p.y, vx: 120, vy: 0 });
    Object.assign(b!, { x: p.x + 8, y: p.y, vx: 0, vy: 0 });
    const ev = run(r, 0.2);
    expect(ev.find((e) => e.kind === "spin")).toMatchObject({ id: "b", by: "a", cause: "bumper" });
  });

  it("catch-up: the back of the pack gets better items and a little extra speed", () => {
    const r = newRace(grove, [{ id: "a", cpu: false }], { seed: 9 });
    const front = new Set<string>(), back = new Set<string>();
    for (let i = 0; i < 400; i++) { front.add(rollItem(r, 0)); back.add(rollItem(r, 1)); }
    expect(front.has("triple")).toBe(false);
    expect(back.has("puddle")).toBe(false);
    expect(back.has("triple")).toBe(true);
    const race = newRace(grove, [{ id: "lead", cpu: false }, { id: "last", cpu: false }], { countdown: 0 });
    step(race, DT, new Map());
    const p = pointAt(grove, 700);
    Object.assign(race.karts[0]!, { x: p.x, y: p.y });
    run(race, DT * 3);
    expect(race.karts[1]!.catchUp).toBeGreaterThan(1.05);
    expect(race.karts[0]!.catchUp).toBe(1);
  });
});

describe("whole races", () => {
  it.each(Object.keys(TRACKS))("four CPU karts race 3 laps of %s, finish in order and the race ends", (id) => {
    const t = buildTrack(TRACKS[id]!);
    const r = newRace(t, ["a", "b", "c", "d"].map((x) => ({ id: x, cpu: true })), { laps: 3, seed: 3 });
    const ev = run(r, 200);
    expect(r.phase).toBe("done");
    expect(r.finishOrder.length).toBeGreaterThanOrEqual(3);
    expect(ev.filter((e) => e.kind === "finish").map((e) => (e as { place: number }).place)).toEqual(r.finishOrder.map((_, i) => i + 1));
    expect(r.time).toBeLessThan(120);
    expect(ev.some((e) => e.kind === "pickup")).toBe(true);
    expect(ev.some((e) => e.kind === "use")).toBe(true);
    expect(standings(r).map((s) => s.place)).toEqual([1, 2, 3, 4]);
  });

  it("the race ends shortly after every human has finished; the same seed replays the same race", () => {
    const play = () => {
      const r = newRace(grove, [{ id: "me", cpu: false }, { id: "c1", cpu: true }, { id: "c2", cpu: true }], { laps: 1, seed: 11 });
      run(r, 100, (rr) => new Map([["me", { ...drive(rr, rr.karts[0]!) }]]));
      return r;
    };
    const r = play();
    expect(r.phase).toBe("done");
    expect(r.karts[0]!.finishedAt).not.toBeNull();
    expect(r.time - r.karts[0]!.finishedAt!).toBeLessThan(r.grace + 0.1);
    const again = play();
    expect(again.finishOrder).toEqual(r.finishOrder);
    expect(again.time).toBe(r.time);
  });
});
