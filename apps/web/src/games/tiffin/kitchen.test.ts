import { describe, expect, it } from "vitest";
import { addToPlate, canPlate, dishOf, fitsMenu, item } from "./recipes";
import { COOK, FLIP, SMOKE_TO_FIRE, cellCentre, parseKitchen, tickStations, tileAt, walkable, type Kitchen } from "./kitchen";
import { contextOf, perform } from "./interact";
import { EXPIRE_PENALTY, newBook, serve, shares, tickOrders } from "./orders";
import { slideItems } from "./sway";
import { LEVELS, curveAhead, darkness, doorsShut, sceneryAt, starThresholds, starsFor, swayAt, trainSpeed } from "./levels";
import { collide, newChef, targetOf } from "./chefs";

const MENU = LEVELS[2]!.menu;
const noRand = () => 0;
const chef = (holding: ReturnType<typeof item> | null = null) => ({ id: "p1", holding });
const run = (k: Kitchen, seconds: number) => {
  const out = [];
  for (let t = 0; t < seconds; t += 0.05) out.push(...tickStations(k, 0.05, noRand));
  return out;
};

describe("recipes", () => {
  it("only lets a plate take components towards a dish on the menu, one of each", () => {
    const p = item("plate");
    expect(canPlate(p, "dosa", ["dosa"])).toBe(true);
    expect(canPlate(p, "sambar", ["dosa"])).toBe(false);
    expect(addToPlate(p, item("dosa", ["a"]), ["dosa"])).toBe(true);
    expect(canPlate(p, "dosa", ["dosa"])).toBe(false);
    expect(addToPlate(p, item("chutney", ["b"]), ["dosa"])).toBe(true);
    expect(p.by.sort()).toEqual(["a", "b"]);
    expect(dishOf(p)).toBe("dosa");
    expect(fitsMenu(["idli", "vada", "sambar"], MENU)).toBe(true);
    expect(fitsMenu(["dosa", "idli"], MENU)).toBe(false);
  });

  it("knows coffee, partial plates and full meals", () => {
    expect(dishOf(item("coffee"))).toBe("coffee");
    expect(dishOf(item("plate", [], { parts: ["dosa"] }))).toBeNull();
    expect(dishOf(item("plate", [], { parts: ["sambar", "chutney", "dosa"] }))).toBe("dosa-sambar");
  });
});

describe("stations", () => {
  const k1 = () => parseKitchen(["#t#ik#", "......"], 4);

  it("parses the grid and its plate rack", () => {
    const k = parseKitchen(LEVELS[0]!.layout, 5);
    expect(k.w).toBe(12);
    expect(k.h).toBe(7);
    expect(k.tiles.find((t) => t.code === "r")!.stock).toBe(5);
    for (const l of LEVELS) expect(new Set(l.layout.map((r) => r.length)).size).toBe(1);
  });

  it("cooks a dosa only when flipped: a flip in the golden window makes it perfect", () => {
    const k = k1();
    const tava = tileAt(k, 1, 0)!;
    tava.item = item("batter", ["a"]);
    expect(contextOf(k, chef(), tava, -1, MENU)).toBe("none"); // too early to flip
    run(k, COOK.t!.seconds * (FLIP.perfectFrom + 0.05));
    expect(contextOf(k, chef(), tava, -1, MENU)).toBe("flip");
    const done = perform(k, chef(), tava, -1, MENU);
    expect(done).toEqual({ verb: "flip", perfect: true });
    const ev = run(k, COOK.t!.seconds + 0.1);
    expect(ev.some((e) => e.kind === "done" && e.what === "dosa")).toBe(true);
    expect(tava.item!.kind).toBe("dosa");
    expect(tava.item!.perfect).toBe(true);
  });

  it("burns a forgotten dosa, smokes, catches fire, spreads, and a tumbler of water puts it out", () => {
    const k = k1();
    const tava = tileAt(k, 1, 0)!;
    tava.item = item("batter", ["a"]);
    let ev = run(k, COOK.t!.seconds * FLIP.burnAt + 0.1);
    expect(ev.some((e) => e.kind === "burnt")).toBe(true);
    expect(tava.item!.kind).toBe("burnt");
    ev = run(k, SMOKE_TO_FIRE + 0.1);
    expect(ev.some((e) => e.kind === "fire")).toBe(true);
    expect(contextOf(k, chef(), tava, -1, MENU)).toBe("none");
    expect(contextOf(k, chef(item("water")), tava, -1, MENU)).toBe("douse");
    ev = run(k, 7.2);
    expect(ev.some((e) => e.kind === "spread")).toBe(true);
    const water = chef(item("water"));
    perform(k, water, tava, -1, MENU);
    expect(tava.fire).toBe(0);
    expect(water.holding).toBeNull();
    expect(contextOf(k, chef(), tava, -1, MENU)).toBe("pick"); // the burnt mess, for the bin
  });

  it("steams idli without burning, fries vada that burns if left", () => {
    const k = k1();
    const idli = tileAt(k, 3, 0)!, kadai = tileAt(k, 4, 0)!;
    idli.item = item("batter");
    kadai.item = item("dough");
    run(k, 7.1);
    expect(idli.item!.kind).toBe("idli");
    expect(kadai.item!.kind).toBe("vada");
    run(k, 12);
    expect(idli.item!.kind).toBe("idli");
    expect(kadai.item!.kind).toBe("burnt");
  });
});

describe("the action button", () => {
  it("picks from crates, chops by tapping, plates and scoops", () => {
    const k = parseKitchen(["vx#g#rp", "......."], 2);
    const [crate, board, counter, grinder, , rack, pot] = [0, 1, 2, 3, 4, 5, 6].map((c) => tileAt(k, c, 0)!);
    const a = chef();
    expect(perform(k, a, crate!, -1, MENU).verb).toBe("pick");
    expect(a.holding!.kind).toBe("veg");
    expect(perform(k, a, board!, -1, MENU).verb).toBe("place");
    for (let i = 0; i < 5; i++) expect(perform(k, a, board!, -1, MENU).verb).toBe("chop");
    expect(board!.item!.kind).toBe("veg");
    expect(perform(k, a, board!, -1, MENU)).toEqual({ verb: "chop", what: "cutveg" });
    expect(perform(k, a, board!, -1, MENU).verb).toBe("pick");
    perform(k, a, pot!, -1, MENU);
    expect(pot!.item!.kind).toBe("cutveg");
    run(k, 8.1);
    expect(pot!.item!.kind).toBe("sambar");
    expect(pot!.stock).toBe(3);
    // chutney: coconut on the grinder, 8 strokes (a swipe counts 2)
    grinder!.item = item("coconut");
    for (let i = 0; i < 4; i++) perform(k, a, grinder!, -1, MENU, 2);
    expect(grinder!.item!.kind).toBe("chutney");
    // a plate from the rack, onto the counter, chutney onto it, then scoop sambar onto it
    expect(perform(k, a, rack!, -1, MENU).verb).toBe("pick");
    expect(rack!.stock).toBe(1);
    expect(perform(k, a, counter!, -1, MENU).verb).toBe("place");
    perform(k, a, grinder!, -1, MENU);
    expect(a.holding!.kind).toBe("chutney");
    expect(contextOf(k, a, counter!, -1, ["coffee"])).toBe("none"); // no dish on that menu takes chutney
    expect(perform(k, a, counter!, -1, MENU).verb).toBe("plate");
    expect(counter!.item!.parts).toEqual(["chutney"]);
    perform(k, a, counter!, -1, MENU); // pick the plate back up
    expect(perform(k, a, pot!, -1, MENU).verb).toBe("scoop");
    expect(a.holding!.parts).toEqual(["chutney", "sambar"]);
    expect(pot!.stock).toBe(2);
  });

  it("serves only finished dishes, bins food but keeps the plate, drops on the floor", () => {
    const k = parseKitchen(["wz", ".."], 1);
    const [win, bin] = [tileAt(k, 0, 0)!, tileAt(k, 1, 0)!];
    expect(contextOf(k, chef(item("plate")), win, -1, MENU)).toBe("none");
    expect(contextOf(k, chef(item("coffee")), win, -1, MENU)).toBe("serve");
    const a = chef(item("plate", [], { parts: ["dosa"] }));
    expect(perform(k, a, bin, -1, MENU).verb).toBe("trash");
    expect(a.holding).toMatchObject({ kind: "plate", parts: [] });
    expect(perform(k, a, null, -1, MENU, 1, { x: 0, z: 0 }).verb).toBe("drop");
    expect(k.floor.length).toBe(1);
    expect(contextOf(k, chef(), null, 0, MENU)).toBe("pick");
  });

  it("washes dirty plates at the sink, one at a time", () => {
    const k = parseKitchen(["ds", ".."], 1);
    const [ret, sink] = [tileAt(k, 0, 0)!, tileAt(k, 1, 0)!];
    ret.stock = 2;
    const a = chef();
    perform(k, a, ret, -1, MENU);
    expect(a.holding).toMatchObject({ kind: "dirty", count: 2 });
    perform(k, a, sink, -1, MENU);
    expect(sink.dirty).toBe(2);
    for (let i = 0; i < 4; i++) expect(perform(k, a, sink, -1, MENU).verb).toBe("wash");
    expect(sink.stock).toBe(1);
    expect(contextOf(k, a, sink, -1, MENU)).toBe("wash");
    for (let i = 0; i < 4; i++) perform(k, a, sink, -1, MENU);
    expect(contextOf(k, a, sink, -1, MENU)).toBe("pick");
    perform(k, a, sink, -1, MENU);
    expect(a.holding!.kind).toBe("plate");
  });
});

describe("orders", () => {
  const rules = { menu: ["coffee", "dosa"] as const, opening: ["coffee"] as const, every: [5, 5] as [number, number], timeScale: 1, maxOpen: 3 };

  it("opens with the level's first ticket, tips for speed and expires late ones", () => {
    const b = newBook(1);
    expect(tickOrders(b, rules, 1.01, noRand)[0]!.order.recipe).toBe("coffee");
    const quick = serve(b, item("coffee"));
    expect(quick!.tip).toBe(8);
    expect(serve(b, item("coffee"))).toBeNull();
    tickOrders(b, rules, 2.6, noRand); // empty rail: next ticket within 2.5 s
    expect(b.orders.length).toBe(1);
    const ev = tickOrders(b, rules, 100, noRand);
    expect(ev.some((e) => e.kind === "expire")).toBe(true);
    expect(EXPIRE_PENALTY).toBeGreaterThan(0);
  });

  it("splits points between the cooks, the server keeps the remainder", () => {
    const s = shares(25, ["a", "b"], "c");
    expect([...s.values()].reduce((x, y) => x + y)).toBe(25);
    expect(s.get("c")).toBe(9);
  });
});

describe("sway, tunnels and the platform", () => {
  it("slides a plate off an island in a curve, but not in a straight", () => {
    const k = parseKitchen(["...", ".#.", "..."], 1);
    const island = tileAt(k, 1, 1)!;
    island.item = item("plate", ["a"]);
    for (let i = 0; i < 60; i++) slideItems(k, 0.2, 1 / 60);
    expect(island.item).not.toBeNull();
    const ev = [];
    for (let i = 0; i < 240 && island.item; i++) ev.push(...slideItems(k, 1, 1 / 60));
    expect(island.item).toBeNull();
    expect(ev[0]).toMatchObject({ kind: "fall" });
    expect(k.floor[0]!.z).toBeGreaterThan(0); // fell towards the camera
  });

  it("the level timeline: curves warn first, tunnels go dark, the platform shuts the doors for 2+ chefs", () => {
    const [, l2, l3] = LEVELS;
    expect(swayAt(l2!, 0.145)).toBeGreaterThan(0.9);
    expect(swayAt(l2!, 0.25)).toBe(0);
    expect(curveAhead(l2!, 0.11, 240)).toBe(true);
    expect(darkness(l3!, 0.22)).toBe(1);
    expect(sceneryAt(l3!, 0.22)).toBe("tunnel");
    expect(doorsShut(l3!, 0.5, 2)).toBe(true);
    expect(doorsShut(l3!, 0.5, 1)).toBe(false);
    expect(trainSpeed(l3!, 0.5)).toBe(0);
    expect(trainSpeed(LEVELS[0]!, 0)).toBe(0);
    const th = starThresholds(240, 2);
    expect(starsFor(th[1], th)).toBe(2);
    expect(starThresholds(20, 1)[0]).toBeGreaterThanOrEqual(3);
  });
});

describe("chefs", () => {
  it("never walk into counters and face what they act on", () => {
    const k = parseKitchen(["###", "#.#", "###"], 1);
    const c = newChef("a", 0, 0, 0);
    c.x = 0.45;
    collide(k, c);
    expect(c.x).toBeLessThanOrEqual(0.2 + 1e-9);
    c.x = 0; c.fx = 1; c.fz = 0;
    expect(targetOf(k, c)).toBe(tileAt(k, 2, 1));
    c.fx = 0; c.fz = -1;
    expect(targetOf(k, c)).toBe(tileAt(k, 1, 0));
    expect(walkable(k, 1, 1)).toBe(true);
    expect(cellCentre(k, 1, 1)).toEqual({ x: 0, z: 0 });
  });
});
