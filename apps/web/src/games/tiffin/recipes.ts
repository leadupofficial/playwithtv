/**
 * Tiffin Tornado: what can be cooked and served. Pure data and rules (no DOM, no three.js).
 *
 *   raw → prepared            veg ─(chop on the board)→ cut veg ─(sambar pot)→ sambar
 *                             coconut ─(grind)→ chutney
 *   batter → tava → (FLIP!) → dosa      batter → idli steamer → idli      dough → kadai → vada
 *   empty tumbler → coffee filter → filter coffee
 *
 * Components go on a clean plate (one of each); a plate (or a coffee) is served at the window for an order.
 */

export type Component = "dosa" | "idli" | "vada" | "chutney" | "sambar";
export const COMPONENTS: readonly Component[] = ["dosa", "idli", "vada", "chutney", "sambar"];

/** Everything a chef can carry or that can sit on a counter. */
export type ItemKind =
  | Component
  | "batter" | "dough" | "coconut" | "veg" | "cutveg"
  | "cup" | "coffee" | "water" | "burnt"
  | "plate" | "dirty";

export interface Item {
  kind: ItemKind;
  /** Plate contents (kind "plate" only), in the order they were added. */
  parts?: Component[];
  /** Dirty plate stack size (kind "dirty"). */
  count?: number;
  /** A dosa flipped in the golden window (worth a tip bonus). */
  perfect?: boolean;
  /** Player ids who made or carried this (they share the points when it is served). */
  by: string[];
}

export type RecipeId = "coffee" | "dosa" | "idli" | "vada" | "idli-sambar" | "dosa-sambar" | "combo";

export interface Recipe {
  id: RecipeId;
  name: string;
  /** Plate components; empty for a coffee (served in its tumbler). */
  parts: Component[];
  /** Points for serving it (before tips). */
  points: number;
  /** Seconds before the ticket runs out (full-length levels). */
  seconds: number;
  /** Short icon line for the ticket. */
  icon: string;
}

export const RECIPES: Record<RecipeId, Recipe> = {
  coffee: { id: "coffee", name: "Filter Coffee", parts: [], points: 10, seconds: 50, icon: "☕" },
  dosa: { id: "dosa", name: "Plain Dosa", parts: ["dosa", "chutney"], points: 20, seconds: 75, icon: "🫓🥥" },
  idli: { id: "idli", name: "Idli Chutney", parts: ["idli", "chutney"], points: 20, seconds: 75, icon: "⚪🥥" },
  vada: { id: "vada", name: "Medu Vada", parts: ["vada", "chutney"], points: 20, seconds: 75, icon: "🍩🥥" },
  "idli-sambar": { id: "idli-sambar", name: "Idli Sambar", parts: ["idli", "sambar"], points: 22, seconds: 85, icon: "⚪🍲" },
  "dosa-sambar": { id: "dosa-sambar", name: "Dosa Full Meals", parts: ["dosa", "chutney", "sambar"], points: 32, seconds: 100, icon: "🫓🥥🍲" },
  combo: { id: "combo", name: "Idli Vada Combo", parts: ["idli", "vada", "sambar"], points: 32, seconds: 100, icon: "⚪🍩🍲" },
};

export const ITEM_NAME: Record<ItemKind, string> = {
  dosa: "Dosa", idli: "Idli", vada: "Vada", chutney: "Chutney", sambar: "Sambar",
  batter: "Batter", dough: "Vada dough", coconut: "Coconut", veg: "Veggies", cutveg: "Cut veggies",
  cup: "Tumbler", coffee: "Filter coffee", water: "Water", burnt: "Burnt mess", plate: "Plate", dirty: "Dirty plates",
};

export function isComponent(k: ItemKind): k is Component {
  return (COMPONENTS as readonly string[]).includes(k);
}

export function item(kind: ItemKind, by: string[] = [], extra: Partial<Item> = {}): Item {
  return { kind, by: [...by], ...(kind === "plate" ? { parts: [] } : {}), ...extra };
}

/** True when `parts` (in any order) is a subset of some recipe on the menu. */
export function fitsMenu(parts: readonly Component[], menu: readonly RecipeId[]): boolean {
  if (new Set(parts).size !== parts.length) return false;
  return menu.some((id) => parts.every((p) => RECIPES[id].parts.includes(p)));
}

/** Can this component go on this plate (one of each, and only towards a dish on the menu)? */
export function canPlate(plate: Item, c: Component, menu: readonly RecipeId[]): boolean {
  if (plate.kind !== "plate") return false;
  const parts = plate.parts ?? [];
  return !parts.includes(c) && fitsMenu([...parts, c], menu);
}

/** Puts a component item onto a plate (mutates the plate). Returns false if it doesn't fit. */
export function addToPlate(plate: Item, food: Item, menu: readonly RecipeId[]): boolean {
  if (!isComponent(food.kind) || !canPlate(plate, food.kind, menu)) return false;
  plate.parts = [...(plate.parts ?? []), food.kind];
  if (food.perfect) plate.perfect = true;
  for (const p of food.by) if (!plate.by.includes(p)) plate.by.push(p);
  return true;
}

/** The recipe a served item makes, or null (a plate must match exactly; a coffee is a coffee). */
export function dishOf(it: Item): RecipeId | null {
  if (it.kind === "coffee") return "coffee";
  if (it.kind !== "plate" || !it.parts?.length) return null;
  const have = [...it.parts].sort().join(",");
  for (const r of Object.values(RECIPES)) {
    if (r.parts.length && [...r.parts].sort().join(",") === have) return r.id;
  }
  return null;
}

/** Credits a player on an item (the cook, the carrier). */
export function credit(it: Item, playerId: string) {
  if (!it.by.includes(playerId)) it.by.push(playerId);
}
