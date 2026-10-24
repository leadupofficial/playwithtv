/**
 * Tiffin Tornado: the ONE action button. What it does depends on what the chef holds and faces; `contextOf`
 * names it (the phone shows it as the button's icon) and `perform` does it. Pure.
 */
import { type Component, type Item, type RecipeId, addToPlate, canPlate, credit, isComponent, item } from "./recipes";
import { COOK, CRATE, FLIP, type Kitchen, type Tile, WASH_STROKES, WORK, douse, flippable, isCounter, ready } from "./kitchen";

export type Verb = "pick" | "place" | "plate" | "scoop" | "chop" | "grind" | "wash" | "flip" | "serve" | "douse" | "trash" | "drop" | "none";

/** Icon per verb, shown on the phone's action button and over the chef. */
export const VERB_ICON: Record<Verb, string> = {
  pick: "✋", place: "⬇️", plate: "🍽️", scoop: "🥄", chop: "🔪", grind: "🌀", wash: "🧽", flip: "🍳", serve: "🛎️",
  douse: "💧", trash: "🗑️", drop: "⬇️", none: "✋",
};

export interface Holder { id: string; holding: Item | null }

/** What the action button would do now. `floorIndex` ≥ 0 when the chef stands over a dropped item instead. */
export function contextOf(k: Kitchen, chef: Holder, target: Tile | null, floorIndex: number, menu: readonly RecipeId[]): Verb {
  const h = chef.holding;
  if (target && target.fire > 0) return h?.kind === "water" ? "douse" : "none";
  if (!target) {
    if (!h && floorIndex >= 0) return "pick";
    return h ? "drop" : "none";
  }
  const t = target, it = t.item;
  if (flippable(t)) return "flip";
  if (!h) {
    if (CRATE[t.code]) return "pick";
    const work = WORK[t.code];
    if (work && it?.kind === work.input) return t.code === "x" ? "chop" : "grind";
    if (t.code === "s") return t.dirty > 0 ? "wash" : t.stock > 0 ? "pick" : "none";
    if ((t.code === "r" || t.code === "d") && t.stock > 0) return "pick";
    if (t.code === "p") return ready(t) && t.stock > 0 ? "pick" : "none";
    if (COOK[t.code]) return it && (ready(t) || it.kind === "burnt") ? "pick" : "none";
    if (work) return it && (ready(t) || it.kind === "burnt") ? "pick" : "none";
    return it ? "pick" : "none";
  }
  switch (t.code) {
    case "w": return h.kind === "coffee" || (h.kind === "plate" && (h.parts?.length ?? 0) > 0) ? "serve" : "none";
    case "z": return "trash";
    case "s": return h.kind === "dirty" ? "place" : "none";
    case "r": return h.kind === "plate" && !h.parts?.length ? "place" : "none";
    case "d": return h.kind === "dirty" ? "place" : "none";
  }
  if (CRATE[t.code]) return h.kind === CRATE[t.code] ? "place" : "none"; // put it back
  const cook = COOK[t.code], work = WORK[t.code];
  if (cook || work) {
    const input = (cook ?? work)!.input;
    if (!it) return h.kind === input ? "place" : "none";
    if (h.kind === "plate" && ready(t) && canPlate(h, (cook ?? work)!.output as Component, menu)) return "scoop";
    return "none";
  }
  if (isCounter(t)) {
    if (!it) return "place";
    if (it.kind === "plate" && isComponent(h.kind) && canPlate(it, h.kind, menu)) return "plate";
    if (h.kind === "plate" && isComponent(it.kind) && canPlate(h, it.kind, menu)) return "scoop";
    if (h.kind === "dirty" && it.kind === "dirty") return "place";
  }
  return "none";
}

export interface Done {
  verb: Verb;
  /** For "flip": landed in the golden window. */
  perfect?: boolean;
  /** For "drop"/"place" of a plate on the floor etc. */
  what?: Item["kind"];
}

/**
 * Does the verb `contextOf` returned. Serving is left to the caller (it needs the orders): this returns
 * { verb: "serve" } without changing anything. Work verbs add one stroke (`strokes` lets a swipe count more).
 */
export function perform(k: Kitchen, chef: Holder, target: Tile | null, floorIndex: number, menu: readonly RecipeId[], strokes = 1, at?: { x: number; z: number }): Done {
  const verb = contextOf(k, chef, target, floorIndex, menu);
  const h = chef.holding, t = target;
  switch (verb) {
    case "none":
    case "serve":
      return { verb };
    case "drop":
      if (h && at) k.floor.push({ item: h, x: at.x, z: at.z });
      chef.holding = null;
      return { verb, what: h?.kind };
    case "douse":
      douse(t!);
      chef.holding = null;
      return { verb };
    case "trash": {
      if (h!.kind === "plate" || h!.kind === "dirty") {
        chef.holding = h!.kind === "plate" ? item("plate", [], { parts: [] }) : h; // the food goes, the plate stays
        return { verb, what: h!.kind };
      }
      chef.holding = null;
      return { verb, what: h!.kind };
    }
    case "flip": {
      const p = t!.cook / COOK.t!.seconds;
      t!.side = 2;
      t!.cook = 0;
      const perfect = p >= FLIP.perfectFrom && p <= FLIP.perfectTo;
      t!.item!.perfect = perfect;
      credit(t!.item!, chef.id);
      return { verb, perfect };
    }
    case "chop":
    case "grind": {
      const work = WORK[t!.code]!;
      t!.work = Math.min(1, t!.work + strokes / work.strokes);
      if (t!.work >= 1 - 1e-6) {
        t!.item = { ...t!.item!, kind: work.output };
        credit(t!.item, chef.id);
        t!.work = 0;
        return { verb, what: work.output };
      }
      return { verb };
    }
    case "wash": {
      t!.work = Math.min(1, t!.work + strokes / WASH_STROKES);
      if (t!.work >= 1 - 1e-6) {
        t!.work = 0;
        t!.dirty--;
        t!.stock++;
        return { verb, what: "plate" };
      }
      return { verb };
    }
    case "pick":
      chef.holding = take(k, t, floorIndex, chef.id);
      return { verb, what: chef.holding?.kind };
    case "place": {
      if (t!.code === "s") t!.dirty += h!.count ?? 1;
      else if (t!.code === "r") t!.stock++;
      else if (t!.code === "d") t!.stock += h!.count ?? 1;
      else if (CRATE[t!.code]) { /* back in the tub */ }
      else if (t!.item?.kind === "dirty") t!.item.count = (t!.item.count ?? 1) + (h!.count ?? 1);
      else {
        t!.item = h;
        t!.cook = 0;
        t!.side = 1;
        t!.over = 0;
        t!.work = 0;
        t!.slide = 0;
        t!.slideV = 0;
        credit(h!, chef.id);
      }
      chef.holding = null;
      return { verb, what: h!.kind };
    }
    case "plate":
      addToPlate(t!.item!, h!, menu);
      credit(t!.item!, chef.id);
      chef.holding = null;
      return { verb, what: h!.kind };
    case "scoop": {
      const food = isCounter(t!) ? t!.item! : take(k, t, -1, chef.id)!;
      addToPlate(h!, food, menu);
      credit(h!, chef.id);
      if (isCounter(t!)) t!.item = null;
      return { verb, what: food.kind };
    }
  }
}

/** Takes what a tile (or a floor spot) gives to an empty hand. */
function take(k: Kitchen, t: Tile | null, floorIndex: number, by: string): Item | null {
  if (!t) {
    const f = k.floor.splice(floorIndex, 1)[0];
    if (f) credit(f.item, by);
    return f?.item ?? null;
  }
  const crate = CRATE[t.code];
  if (crate) return item(crate, [by]);
  if (t.code === "r" || (t.code === "s" && t.dirty === 0)) {
    t.stock--;
    return item("plate", [], { parts: [] });
  }
  if (t.code === "d") {
    const n = t.stock;
    t.stock = 0;
    return item("dirty", [], { count: n });
  }
  if (t.code === "p" && t.item?.kind === "sambar") {
    const it = item("sambar", t.item.by);
    credit(it, by);
    if (--t.stock <= 0) clear(t);
    return it;
  }
  const it = t.item;
  if (it) credit(it, by);
  clear(t);
  return it;
}

function clear(t: Tile) {
  t.item = null;
  t.cook = t.over = t.work = t.slide = t.slideV = 0;
  t.side = 1;
  t.smoke = 0;
}
