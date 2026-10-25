/**
 * Tiffin Tornado: order tickets (pure). New tickets arrive on a rhythm, each with its own timer; serving the
 * right plate at the window scores its points plus a tip for speed (and for a perfect dosa); a ticket that runs
 * out costs a few points.
 */
import { type Item, RECIPES, type RecipeId, dishOf } from "./recipes";

export interface Order {
  id: number;
  recipe: RecipeId;
  /** Seconds left, and the ticket's full time. */
  left: number;
  limit: number;
}

export interface OrderBook {
  orders: Order[];
  nextId: number;
  /** Seconds until the next ticket arrives. */
  nextIn: number;
  /** Tickets handed out from the level's opening list. */
  opened: number;
  /** Consecutive serves without a ticket running out (bonus). */
  streak: number;
}

export interface OrderRules {
  menu: readonly RecipeId[];
  opening: readonly RecipeId[];
  every: [number, number];
  /** Ticket time multiplier (shorter in quick mode). */
  timeScale: number;
  maxOpen: number;
}

export const EXPIRE_PENALTY = 6;

export function newBook(firstIn = 1.2): OrderBook {
  return { orders: [], nextId: 1, nextIn: firstIn, opened: 0, streak: 0 };
}

export interface OrderEvent { kind: "order" | "expire"; order: Order }

/** Ticks ticket timers and hands out new tickets. `rand` is seedable. */
export function tickOrders(b: OrderBook, rules: OrderRules, dt: number, rand: () => number): OrderEvent[] {
  const out: OrderEvent[] = [];
  for (const o of b.orders) o.left -= dt;
  for (const o of b.orders.filter((x) => x.left <= 0)) {
    out.push({ kind: "expire", order: o });
    b.streak = 0;
  }
  b.orders = b.orders.filter((x) => x.left > 0);
  // never leave the rail empty for long: a quick ticket when everything was served
  if (b.orders.length === 0 && b.nextIn > 2.5) b.nextIn = 2.5;
  b.nextIn -= dt;
  if (b.nextIn <= 0 && b.orders.length < rules.maxOpen) {
    const recipe = b.opened < rules.opening.length ? rules.opening[b.opened]! : pick(rules.menu, rand);
    b.opened++;
    const limit = Math.round(RECIPES[recipe].seconds * rules.timeScale);
    const o: Order = { id: b.nextId++, recipe, left: limit, limit };
    b.orders.push(o);
    out.push({ kind: "order", order: o });
    const [lo, hi] = rules.every;
    b.nextIn = lo + rand() * (hi - lo);
  } else if (b.nextIn <= 0) b.nextIn = 1; // rail full: try again soon
  return out;
}

function pick(menu: readonly RecipeId[], rand: () => number): RecipeId {
  return menu[Math.floor(rand() * menu.length) % menu.length]!;
}

export interface Served { order: Order; points: number; tip: number; bonus: number }

/**
 * Serves an item at the window: matches the oldest ticket for that dish. Returns null (and changes nothing)
 * when no ticket wants it.
 */
export function serve(b: OrderBook, it: Item): Served | null {
  const dish = dishOf(it);
  if (!dish) return null;
  const i = b.orders.findIndex((o) => o.recipe === dish);
  if (i < 0) return null;
  const o = b.orders[i]!;
  b.orders.splice(i, 1);
  const r = RECIPES[dish];
  const speed = Math.max(0, o.left / o.limit);
  const tip = Math.round(speed * 8) + (it.perfect ? 4 : 0);
  b.streak++;
  const bonus = b.streak >= 3 ? Math.min(10, (b.streak - 2) * 2) : 0;
  return { order: o, points: r.points, tip, bonus };
}

/** Splits points between the players who made a dish (the server always gets a share). */
export function shares(total: number, by: readonly string[], server: string): Map<string, number> {
  const who = [...new Set([...by, server])];
  const out = new Map<string, number>();
  const each = Math.floor(total / who.length);
  let rest = total - each * who.length;
  for (const id of who) {
    out.set(id, each + (id === server && rest > 0 ? rest : 0));
    if (id === server) rest = 0;
  }
  return out;
}
