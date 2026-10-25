/**
 * Kitchen Rush: two chefs, one kitchen, a rail of orders running out. Each phone walks one chef (tilt,
 * stick or finger) and has two buttons: ✋ Grab (pick up, put down, plate up, serve) and 🔪 Chop.
 * Lettuce and tomatoes are chopped on a board, meat cooks on a stove and burns if nobody takes it off,
 * buns go straight on a plate. Serve quickly for tips, serve one dish after another for a combo, and pass
 * things to your partner over a counter for a teamwork bonus.
 */
import type { Draw } from "../kitgrid/draw";
import { rng } from "../kitgrid/rng";
import type { Hud, Outcome, Sim, SimEvent } from "../kitgrid/types";
import { COLS, KROWS, type KitchenLevel, type Recipe } from "./levels";

export const ROWS = KROWS + 2;
/** Kitchen row 0 is board row 2: the ticket rail sits on top. */
const OY = 2;
const SPEED = 4.6;
const DEAD = 0.15;
const R = 0.32;
const CHOPS = 5;
const COOK = 6000;
const BURN = 8000;
const MAX_ORDERS = 4;
const COMBO_GAP = 18; // seconds between serves that keeps a combo alive
const PASS_WINDOW = 10_000;

export type Ing = "lettuce" | "tomato" | "bun" | "meat";
export interface Item {
  kind: Ing | "plate";
  state: "raw" | "chopped" | "cooked" | "burnt";
  chop: number; // 0..1 on the board
  cook: number; // ms on a stove
  on: Ing[]; // plate contents
  by: number; // who put it down (-1 = nobody)
  at: number; // when (sim ms)
}
export const RECIPES: Record<Recipe, { name: string; emoji: string; needs: Ing[]; points: number; patience: number }> = {
  salad: { name: "Salad", emoji: "🥗", needs: ["lettuce", "tomato"], points: 60, patience: 50 },
  burger: { name: "Burger", emoji: "🍔", needs: ["bun", "meat"], points: 80, patience: 60 },
  deluxe: { name: "Deluxe", emoji: "🍔", needs: ["bun", "meat", "lettuce"], points: 120, patience: 75 },
};
const ICON: Record<Ing, string> = { lettuce: "🥬", tomato: "🍅", bun: "🍞", meat: "🥩" };
const CRATE: Record<string, Ing> = { L: "lettuce", T: "tomato", U: "bun", M: "meat" };
/** Cells that hold one item. */
const HOLDS = new Set(["=", "C", "S"]);
const STATIONS = new Set(["=", "C", "S", "L", "T", "U", "M", "P", "W", "X"]);

interface Order { recipe: Recipe; left: number; max: number; id: number }
interface Chef { x: number; y: number; fx: number; fy: number; hand: Item | null; walk: number; chopAnim: number }
interface Bit { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number; text?: string }

export const walkable = (ch: string | undefined) => ch === "." || ch === "1" || ch === "2";
/** The ingredient key an item adds to a plate, or null when it isn't ready to plate. */
export function ready(it: Item): Ing | null {
  if (it.kind === "lettuce" || it.kind === "tomato") return it.state === "chopped" ? it.kind : null;
  if (it.kind === "bun") return "bun";
  if (it.kind === "meat") return it.state === "cooked" ? "meat" : null;
  return null;
}
const item = (kind: Item["kind"], ms: number, by = -1): Item => ({ kind, state: "raw", chop: 0, cook: 0, on: [], by, at: ms });

export class KitchenSim implements Sim {
  readonly cols = COLS;
  readonly rows = ROWS;
  private cells: string[];
  private slots = new Map<number, Item | null>();
  private chefs: Chef[] = [];
  private input: Array<{ x: number; y: number }> = [];
  private orders: Order[] = [];
  private nextOrder = 1500;
  private orderId = 0;
  private ms = 0;
  private score = 0;
  private served = 0;
  private missed = 0;
  private burnt = 0;
  private passes = 0;
  private combo = 0;
  private bestCombo = 0;
  private lastServe = -1e9;
  private result: Outcome | null = null;
  private r: () => number;
  private bits: Bit[] = [];
  private round: number;
  private cookMs: number;
  private burnMs: number;
  private colors: string[];
  private ticks = 0;

  private hat: string;

  constructor(private level: KitchenLevel, seed: number, colors: string[], quick = false, skin = "") {
    this.hat = skin === "hat-gold" ? "#ffd23f" : skin === "hat-red" ? "#ff5a5a" : "#ffffff";
    this.cells = level.map;
    this.r = rng(seed);
    this.round = (quick ? 40 : level.round) * 1000;
    this.cookMs = level.cook ?? COOK;
    this.burnMs = level.burn ?? BURN;
    const n = Math.max(1, Math.min(2, colors.length));
    this.colors = [colors[0] ?? "#ff8a8a", colors[1] ?? "#8ab4ff"];
    this.cells.forEach((row, y) => [...row].forEach((ch, x) => {
      if (HOLDS.has(ch)) this.slots.set(this.key(x, y), null);
      const p = ch === "1" ? 0 : ch === "2" ? 1 : -1;
      if (p >= 0 && p < n) this.chefs[p] = { x: x + 0.5, y: y + 0.5, fx: 0, fy: -1, hand: null, walk: 0, chopAnim: 0 };
    }));
    this.input = this.chefs.map(() => ({ x: 0, y: 0 }));
  }

  private key(x: number, y: number) {
    return y * COLS + x;
  }
  private cell(x: number, y: number) {
    return x < 0 || y < 0 || x >= COLS || y >= KROWS ? "#" : this.cells[y]![x]!;
  }

  steer(player: number, x: number, y: number) {
    if (!this.chefs[player]) return;
    const m = Math.hypot(x, y);
    this.input[player] = m < DEAD ? { x: 0, y: 0 } : { x: x / Math.max(1, m), y: -y / Math.max(1, m) };
  }

  /** The station a chef would use: the cell they face, else the nearest station next to them. */
  target(p: number): { x: number; y: number } | null {
    const c = this.chefs[p];
    if (!c) return null;
    const fx = Math.floor(c.x + c.fx * 0.85), fy = Math.floor(c.y + c.fy * 0.85);
    if (STATIONS.has(this.cell(fx, fy))) return { x: fx, y: fy };
    const cx = Math.floor(c.x), cy = Math.floor(c.y);
    let best: { x: number; y: number } | null = null, score = -9;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      if (!STATIONS.has(this.cell(cx + dx, cy + dy))) continue;
      const near = 1 - Math.hypot(cx + dx + 0.5 - c.x, cy + dy + 0.5 - c.y);
      const s = (dx * c.fx + dy * c.fy) * 2 + near;
      if (s > score) { score = s; best = { x: cx + dx, y: cy + dy }; }
    }
    return best;
  }

  act(action: string, player = 0): SimEvent[] {
    if (this.result) return [];
    const c = this.chefs[player];
    const t = this.target(player);
    if (!c || !t) return [];
    if (action === "grab") return this.grab(player, c, t.x, t.y);
    if (action === "chop") return this.chop(player, c, t.x, t.y);
    return [];
  }

  private grab(p: number, c: Chef, x: number, y: number): SimEvent[] {
    const ch = this.cell(x, y);
    const h = c.hand;
    const fx = x + 0.5, fy = y + 0.5;
    const ev = (sfx: SimEvent["sfx"]): SimEvent[] => [{ sfx }];
    if (CRATE[ch]) {
      const ing = CRATE[ch]!;
      if (!h) { c.hand = item(ing, this.ms); return ev("select"); }
      if (h.kind === "plate" && ing === "bun" && this.addTo(h, "bun")) return ev("eat");
      return this.nope(p, "Hands full!");
    }
    if (ch === "P") {
      if (!h) { c.hand = item("plate", this.ms); return ev("select"); }
      const k = ready(h);
      if (k) { const pl = item("plate", this.ms); pl.on = [k]; c.hand = pl; return ev("eat"); } // grab a plate under it
      return this.nope(p, "Hands full!");
    }
    if (ch === "X") {
      if (!h) return [];
      if (h.kind === "plate" && h.on.length) h.on = []; // scrape the plate; bin it again to throw the plate away
      else c.hand = null;
      this.burstAt(fx, fy, 8, ["#9a9a9a", "#666"], 2.5, 0.07);
      return ev("back");
    }
    if (ch === "W") {
      if (!h || h.kind !== "plate" || !h.on.length) return this.nope(p, "Bring a plated dish to the window");
      return this.serve(p, c, fx, fy);
    }
    if (!HOLDS.has(ch)) return [];
    const k = this.key(x, y);
    const s = this.slots.get(k) ?? null;
    if (ch === "S") {
      if (!h && s) { c.hand = s; this.slots.set(k, null); return ev("select"); }
      if (h && !s) {
        if (h.kind !== "meat") return this.nope(p, "Only meat goes on the stove");
        if (h.state === "burnt") return this.nope(p, "That's burnt! Bin it");
        this.slots.set(k, h); c.hand = null; return ev("drop");
      }
      if (h?.kind === "plate" && s && ready(s) === "meat" && this.addTo(h, "meat")) { this.slots.set(k, null); return ev("eat"); }
      if (h?.kind === "plate" && s) return this.nope(p, s.state === "burnt" ? "That's burnt! Bin it" : s.state === "raw" ? "Still cooking…" : "There's meat on it already");
      return this.nope(p, h ? "Stove's busy" : "");
    }
    // counter or board
    if (!h && s) {
      c.hand = s; this.slots.set(k, null);
      return this.passed(p, s, fx, fy) ?? ev("select");
    }
    if (h && !s) { h.by = p; h.at = this.ms; this.slots.set(k, h); c.hand = null; return ev("drop"); }
    if (h && s) {
      if (h.kind === "plate" && s.kind !== "plate") { const kk = ready(s); if (kk && this.addTo(h, kk)) { this.slots.set(k, null); return this.passed(p, s, fx, fy) ?? ev("eat"); } }
      if (s.kind === "plate" && h.kind !== "plate") { const kk = ready(h); if (kk && this.addTo(s, kk)) { c.hand = null; s.by = p; s.at = this.ms; return ev("eat"); } }
      return this.nope(p, "No room there");
    }
    return [];
  }

  /** Taking something your partner just put down on a counter is a pass: a little teamwork bonus. */
  private passed(p: number, it: Item, x: number, y: number): SimEvent[] | null {
    if (it.by < 0 || it.by === p || this.ms - it.at >= PASS_WINDOW) return null;
    it.by = -1;
    this.passes++;
    this.score += 10;
    this.pop(x, y - 0.6, "Nice pass! +10", "#7cf2c2");
    return [{ sfx: "bonus" }];
  }

  private addTo(plate: Item, k: Ing): boolean {
    if (plate.on.includes(k) || plate.on.length >= 3) return false;
    plate.on.push(k);
    return true;
  }

  private nope(p: number, text: string): SimEvent[] {
    return text ? [{ sfx: "hit", toast: text, tone: "bad", player: p, buzz: 30 }] : [];
  }

  private chop(p: number, c: Chef, x: number, y: number): SimEvent[] {
    if (this.cell(x, y) !== "C") return this.nope(p, "Chop at a chopping board");
    const s = this.slots.get(this.key(x, y));
    if (!s || (s.kind !== "lettuce" && s.kind !== "tomato")) return this.nope(p, "Put lettuce or a tomato on the board");
    if (s.state === "chopped") return this.nope(p, "Already chopped: grab it!");
    s.chop = Math.min(1, s.chop + 1 / CHOPS);
    c.chopAnim = 1;
    this.burstAt(x + 0.5, y + 0.5, 5, s.kind === "lettuce" ? ["#7ad957", "#b6f08f"] : ["#ff5a4a", "#ffb0a0"], 2.5, 0.07);
    if (s.chop >= 1) {
      s.state = "chopped";
      this.pop(x + 0.5, y - 0.2, "Chopped!", "#ffffff");
      return [{ sfx: "clear", buzz: 40, player: p }];
    }
    return [{ sfx: "dig", buzz: 15, player: p }];
  }

  private serve(p: number, c: Chef, x: number, y: number): SimEvent[] {
    const dish = [...c.hand!.on].sort().join("+");
    const match = this.orders
      .filter((o) => [...RECIPES[o.recipe].needs].sort().join("+") === dish)
      .sort((a, b) => a.left - b.left)[0];
    if (!match) return this.nope(p, "Nobody ordered that! Check the tickets");
    this.orders = this.orders.filter((o) => o !== match);
    c.hand = null;
    const rec = RECIPES[match.recipe];
    this.combo = this.ms - this.lastServe < COMBO_GAP * 1000 ? Math.min(4, this.combo + 1) : 1;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    this.lastServe = this.ms;
    const tip = Math.round((match.left / match.max) * 40);
    const pts = Math.round((rec.points + tip) * (1 + (this.combo - 1) * 0.25));
    this.score += pts;
    this.served++;
    this.burstAt(x, y, 18, ["#ffd23f", "#fff3a0", "#ffffff", "#3ee08f"], 5, 0.1);
    this.pop(x, y - 0.8, `${rec.emoji} +${pts}`, "#ffe27a");
    const ev: SimEvent[] = [{ sfx: "bonus", buzz: 60 }];
    if (this.combo >= 2) {
      this.pop(x, y - 1.6, `Combo ×${this.combo}!`, "#ff8ad1");
      ev.push({ sfx: "power", toast: `Combo ×${this.combo}! Keep the dishes coming`, tone: "good" });
    }
    if (this.orders.length === 0) this.nextOrder = Math.min(this.nextOrder, this.ms + 1500);
    return ev;
  }

  step(ms: number): SimEvent[] {
    if (this.result) return [];
    const ev: SimEvent[] = [];
    for (let left = ms; left > 0 && !this.result; left -= 16) ev.push(...this.tick(Math.min(16, left)));
    return ev;
  }

  private tick(ms: number): SimEvent[] {
    const ev: SimEvent[] = [];
    const dt = ms / 1000;
    this.ms += ms;

    // chefs walk
    this.chefs.forEach((c, i) => {
      const v = this.input[i]!;
      const m = Math.hypot(v.x, v.y);
      if (m > 0.3) { c.fx = v.x / m; c.fy = v.y / m; }
      c.walk = c.walk * 0.8 + Math.min(1, m) * 0.2;
      c.chopAnim = Math.max(0, c.chopAnim - dt * 5);
      const nx = c.x + v.x * SPEED * dt, ny = c.y + v.y * SPEED * dt;
      if (this.free(nx, c.y, i)) c.x = nx;
      if (this.free(c.x, ny, i)) c.y = ny;
    });

    // stoves
    for (const [k, s] of this.slots) {
      if (!s || s.kind !== "meat" || this.cell(k % COLS, Math.floor(k / COLS)) !== "S" || s.state === "burnt") continue;
      const x = (k % COLS) + 0.5, y = Math.floor(k / COLS) + 0.5;
      s.cook += ms;
      if (s.state === "raw" && s.cook >= this.cookMs) {
        s.state = "cooked";
        this.pop(x, y - 0.6, "Done! Take it off", "#ffd23f");
        ev.push({ sfx: "light", toast: "🥩 Meat's cooked: plate it before it burns!", tone: "info" });
      } else if (s.state === "cooked" && s.cook >= this.cookMs + this.burnMs) {
        s.state = "burnt";
        this.burnt++;
        this.burstAt(x, y, 14, ["#444", "#777", "#ff7a2a"], 3, 0.12);
        this.pop(x, y - 0.6, "BURNT!", "#ff6b6b");
        ev.push({ sfx: "lose", shake: 0.25, toast: "🔥 Burnt! Bin it and start again", tone: "bad" });
      }
      if (s.state === "cooked" && s.cook > this.cookMs + this.burnMs * 0.5 && this.r() < 0.25) {
        this.bits.push({ x: x + (this.r() - 0.5) * 0.5, y: y + OY, vx: (this.r() - 0.5) * 0.3, vy: -0.9, life: 0.9, max: 0.9, color: "rgba(90, 90, 90, 0.5)", size: 0.22 });
      }
    }

    // orders
    if (this.ms >= this.nextOrder && this.ms < this.round - 8000) {
      if (this.orders.length < MAX_ORDERS) {
        const recipe = this.level.recipes[Math.floor(this.r() * this.level.recipes.length)]!;
        const max = RECIPES[recipe].patience * 1000;
        this.orders.push({ recipe, left: max, max, id: ++this.orderId });
        ev.push({ sfx: "turn" });
      }
      this.nextOrder = this.ms + this.level.every * 1000;
    }
    for (const o of this.orders) o.left -= ms;
    const late = this.orders.filter((o) => o.left <= 0);
    if (late.length) {
      this.orders = this.orders.filter((o) => o.left > 0);
      for (const o of late) {
        this.missed++;
        this.combo = 0;
        this.score = Math.max(0, this.score - 15);
        this.pop(3 + this.orders.length * 5, 1, `${RECIPES[o.recipe].emoji} missed -15`, "#ff6b6b", true);
      }
      ev.push({ sfx: "lose", shake: 0.15, toast: "A customer gave up waiting!", tone: "bad", buzz: 120 });
      if (!this.orders.length) this.nextOrder = Math.min(this.nextOrder, this.ms + 1500);
    }

    // the clock
    const left = this.round - this.ms;
    if (left <= 10_000 && Math.ceil(left / 1000) !== this.ticks) {
      this.ticks = Math.ceil(left / 1000);
      if (this.ticks > 0) ev.push({ sfx: "move" });
      if (this.ticks === 10) ev.push({ toast: "10 seconds left!", tone: "info" });
    }
    if (left <= 0) {
      this.finish();
      ev.push({ sfx: "clear" });
    }
    this.stepBits(dt);
    return ev;
  }

  private free(x: number, y: number, me: number) {
    for (const [dx, dy] of [[-R, -R], [R, -R], [-R, R], [R, R]] as const) if (!walkable(this.cell(Math.floor(x + dx), Math.floor(y + dy)))) return false;
    return this.chefs.every((o, j) => j === me || Math.hypot(o.x - x, o.y - y) > 0.62 || Math.hypot(o.x - x, o.y - y) > Math.hypot(o.x - this.chefs[me]!.x, o.y - this.chefs[me]!.y));
  }

  private finish() {
    const [s1, s2, s3] = this.level.stars;
    const stars = (this.score >= s3 ? 3 : this.score >= s2 ? 2 : this.score >= s1 ? 1 : 0) as Outcome["stars"];
    this.result = {
      won: stars > 0,
      stars,
      score: this.score,
      checks: [
        { text: `${s1} points (${this.served} dishes served${this.bestCombo >= 2 ? `, best combo ×${this.bestCombo}` : ""})`, ok: stars >= 1 },
        { text: `${s2} points${this.passes ? ` · ${this.passes} passes` : ""}`, ok: stars >= 2 },
        { text: `${s3} points${this.missed ? ` · ${this.missed} missed` : " · nobody left hungry"}`, ok: stars >= 3 },
      ],
    };
  }

  outcome() {
    return this.result;
  }

  hud(): Hud {
    const left = Math.max(0, Math.ceil((this.round - this.ms) / 1000));
    const [s1, s2, s3] = this.level.stars;
    const next = this.score < s1 ? s1 : this.score < s2 ? s2 : s3;
    return {
      score: this.score,
      goal: `⏱ ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")} · 🍽 ${this.served} · next ★ at ${next}`,
      progress: Math.min(1, this.score / s3),
      seconds: this.ms / 1000,
    };
  }

  debug() {
    const r = (v: number) => Math.round(v * 100) / 100;
    const show = (it: Item | null) => (it ? (it.kind === "plate" ? `plate:${it.on.join("+")}` : `${it.kind}:${it.state}`) : null);
    return {
      chefs: this.chefs.map((c) => ({ x: r(c.x), y: r(c.y), hand: show(c.hand) })),
      orders: this.orders.map((o) => o.recipe),
      score: this.score, served: this.served, missed: this.missed, burnt: this.burnt, passes: this.passes, combo: this.combo,
      slots: Object.fromEntries([...this.slots].filter(([, v]) => v).map(([k, v]) => [`${k % COLS},${Math.floor(k / COLS)}`, show(v)])),
    };
  }

  // ---- effects ----
  private burstAt(x: number, y: number, n: number, colors: string[], speed: number, size: number) {
    for (let i = 0; i < n && this.bits.length < 180; i++) {
      const a = this.r() * Math.PI * 2, v = speed * (0.4 + this.r() * 0.6);
      this.bits.push({ x, y: y + OY, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.6, max: 0.6, color: colors[i % colors.length]!, size: size * (0.6 + this.r() * 0.8) });
    }
  }
  /** A floating label; `rail` puts it on the ticket rail instead of in the kitchen. */
  private pop(x: number, y: number, text: string, color: string, rail = false) {
    this.bits.push({ x, y: rail ? y : y + OY, vx: 0, vy: -1.1, life: 1.2, max: 1.2, color, size: 0.5, text });
  }
  private stepBits(dt: number) {
    for (const b of this.bits) {
      b.x += b.vx * dt; b.y += b.vy * dt; b.vx *= 0.9; b.vy *= b.text ? 0.95 : 0.9; b.life -= dt;
    }
    if (this.bits.some((b) => b.life <= 0)) this.bits = this.bits.filter((b) => b.life > 0);
  }

  // ---- drawing ----
  private drawItem(d: Draw, it: Item, x: number, y: number, s = 1) {
    if (it.kind === "plate") {
      d.circle(x, y, 0.36 * s, "#d8dde6");
      d.circle(x, y, 0.3 * s, "#ffffff");
      it.on.forEach((k, i) => {
        const a = (i / Math.max(1, it.on.length)) * Math.PI * 2 - Math.PI / 2;
        const rr = it.on.length > 1 ? 0.13 * s : 0;
        d.text(k === "meat" ? "🟤" : ICON[k], x + Math.cos(a) * rr, y + Math.sin(a) * rr, 0.3 * s, "#000");
      });
      return;
    }
    if (it.kind === "meat") {
      if (it.state === "raw") d.text("🥩", x, y, 0.5 * s, "#000");
      else { d.circle(x, y, 0.24 * s, it.state === "burnt" ? "#1d1a18" : "#8a4a22"); d.circle(x - 0.06 * s, y - 0.06 * s, 0.08 * s, it.state === "burnt" ? "#333" : "#b0683a"); }
      return;
    }
    if (it.state === "chopped") {
      for (let i = 0; i < 3; i++) d.text(ICON[it.kind as Ing], x + (i - 1) * 0.16 * s, y + (i % 2) * 0.08 * s, 0.28 * s, "#000");
    } else d.text(ICON[it.kind as Ing], x, y, 0.5 * s, "#000");
  }

  draw(d: Draw) {
    const cells = this.cells;
    d.layer(`kitchen-${this.level.name}`, COLS, ROWS, (L) => {
      L.rect(0, 0, COLS, OY, "#2b1d14"); // ticket rail
      L.rect(0, OY - 0.15, COLS, 0.15, "#8a8f99");
      for (let i = 0; i < COLS; i += 2) L.rect(i, 0, 1, 0.12, i % 4 ? "#ff6b6b" : "#ffffff"); // the truck's awning
      L.text("🚚 Mia & Leo's", COLS - 2.6, 1.05, 0.5, "#ffd23f");
      cells.forEach((row, y) => [...row].forEach((ch, x) => {
        const Y = y + OY;
        if (walkable(ch)) { L.rect(x, Y, 1, 1, (x + y) % 2 ? "#f1ece2" : "#ddd5c6"); return; }
        if (ch === "#") { L.rect(x, Y, 1, 1, "#4a3a52"); L.rect(x, Y, 1, 0.16, "#5f4d69"); return; }
        if (ch === "=" && (x * 7 + y * 13) % 5 === 0) {
          // a bit of kitchen clutter on some counters (drawn small and muted: it's scenery, not food)
          const k = (x + y) % 3;
          L.rect(x, Y, 1, 1, "#9a6a3e");
          L.rect(x + 0.04, Y + 0.04, 0.92, 0.92, "#b98352", 0.08);
          if (k === 0) { L.rect(x + 0.14, Y + 0.3, 0.2, 0.36, "#d9cbb0", 0.05); L.rect(x + 0.4, Y + 0.24, 0.2, 0.42, "#c9a27a", 0.05); L.rect(x + 0.14, Y + 0.24, 0.2, 0.08, "#8a5a3a"); L.rect(x + 0.4, Y + 0.18, 0.2, 0.08, "#8a5a3a"); }
          else if (k === 1) { L.circle(x + 0.72, Y + 0.6, 0.18, "#6f7680"); L.circle(x + 0.72, Y + 0.6, 0.12, "#8a929c"); L.rect(x + 0.18, Y + 0.6, 0.3, 0.06, "#6f7680"); }
          else { L.circle(x + 0.5, Y + 0.55, 0.2, "#5b8f4a"); L.circle(x + 0.42, Y + 0.46, 0.12, "#79b062"); L.rect(x + 0.38, Y + 0.68, 0.24, 0.18, "#a0613a", 0.04); }
          return;
        }
        L.rect(x, Y, 1, 1, "#9a6a3e"); // counter top
        L.rect(x + 0.04, Y + 0.04, 0.92, 0.92, "#b98352", 0.08);
        if (CRATE[ch]) { L.rect(x + 0.1, Y + 0.12, 0.8, 0.76, "#7a4f2a", 0.08); L.text(ICON[CRATE[ch]!], x + 0.5, Y + 0.5, 0.55, "#000"); }
        else if (ch === "C") { L.rect(x + 0.12, Y + 0.14, 0.76, 0.72, "#e8d2a6", 0.1); L.text("🔪", x + 0.78, Y + 0.24, 0.3, "#000"); }
        else if (ch === "S") { L.rect(x + 0.06, Y + 0.06, 0.88, 0.88, "#2f3238", 0.1); L.stroke(x + 0.2, Y + 0.2, 0.6, 0.6, "#555a63", 0.07, 0.3); }
        else if (ch === "P") { for (let i = 0; i < 3; i++) { L.circle(x + 0.5, Y + 0.6 - i * 0.1, 0.32, "#cfd5de"); L.circle(x + 0.5, Y + 0.6 - i * 0.1, 0.27, "#ffffff"); } }
        else if (ch === "W") { L.rect(x + 0.05, Y + 0.05, 0.9, 0.9, "#ffd23f", 0.1); L.text("🛎️", x + 0.5, Y + 0.5, 0.5, "#000"); }
        else if (ch === "X") { L.rect(x + 0.18, Y + 0.12, 0.64, 0.78, "#5b6370", 0.12); L.text("🗑️", x + 0.5, Y + 0.52, 0.45, "#000"); }
      }));
    });
    const ctx = d.ctx;

    // the ticket rail
    this.orders.forEach((o, i) => {
      const rec = RECIPES[o.recipe];
      const x = 0.4 + i * 5.2, f = Math.max(0, o.left / o.max);
      const urgent = f < 0.25 && Math.floor(d.t * 6) % 2 === 0;
      d.rect(x, 0.15, 5, 1.55, urgent ? "#ffdddd" : "#fffaf0", 0.15);
      d.text(rec.emoji, x + 0.55, 0.8, 0.75, "#000");
      d.text(rec.name, x + 1.95, 0.5, 0.36, "#3a2a20");
      d.text(f > 0.6 ? "😀" : f > 0.3 ? "😐" : f > 0.12 ? "😟" : "😡", x + 4.45, 0.78, 0.6, "#000");
      rec.needs.forEach((k, j) => d.text(ICON[k], x + 1.35 + j * 0.62, 1.05, 0.38, "#000"));
      d.rect(x + 0.15, 1.45, 4.7, 0.16, "#e2d9c8", 0.06);
      d.rect(x + 0.15, 1.45, 4.7 * f, 0.16, f > 0.5 ? "#3ec46d" : f > 0.25 ? "#f2b33b" : "#e94f4f", 0.06);
    });
    if (this.combo >= 2) d.text(`Combo ×${this.combo}`, COLS - 6.6, 1, 0.55 + Math.sin(d.t * 8) * 0.04, "#ff8ad1", 900);

    // things on counters, boards and stoves
    for (const [k, s] of this.slots) {
      if (!s) continue;
      const x = (k % COLS) + 0.5, y = Math.floor(k / COLS) + 0.5 + OY;
      const ch = this.cell(k % COLS, Math.floor(k / COLS));
      if (ch === "S") {
        const hot = s.state === "cooked" && s.cook > this.cookMs + this.burnMs * 0.5;
        d.circle(x, y, 0.36, s.state === "burnt" ? "#3a2a22" : hot && Math.floor(d.t * 8) % 2 ? "#ff5a2a" : "#ff8a3a");
        d.circle(x, y, 0.3, "#2a2a2a"); // the pan
      }
      this.drawItem(d, s, x, y);
      const bar = (f: number, col: string) => { d.rect(x - 0.4, y - 0.62, 0.8, 0.13, "rgba(0,0,0,0.45)", 0.05); d.rect(x - 0.4, y - 0.62, 0.8 * f, 0.13, col, 0.05); };
      if (ch === "C" && s.chop > 0 && s.state !== "chopped") bar(s.chop, "#7ad957");
      if (ch === "S" && s.state === "raw") bar(s.cook / this.cookMs, "#ffb13b");
      if (ch === "S" && s.state === "cooked") bar(1 - (s.cook - this.cookMs) / this.burnMs, "#e94f4f");
      if (ch === "S" && s.state === "cooked") d.text("✅", x + 0.36, y - 0.36, 0.3, "#000");
    }

    // what each chef would use
    this.chefs.forEach((_, i) => {
      const t = this.target(i);
      if (t) d.stroke(t.x + 0.04, t.y + OY + 0.04, 0.92, 0.92, this.colors[i]!, 0.09, 0.12);
    });

    // the chefs (what they carry is held out in front: behind them when they face away from us)
    this.chefs.forEach((c, i) => {
      const bob = Math.abs(Math.sin(d.t * 12 + i * 2)) * 0.07 * c.walk;
      const x = c.x, y = c.y + OY - bob;
      const held = () => c.hand && this.drawItem(d, c.hand, x + c.fx * 0.5, y + c.fy * 0.42 + 0.1, 1);
      if (c.fy < -0.5) held();
      d.circle(x, c.y + OY + 0.38, 0.32, "rgba(0,0,0,0.18)");
      d.circle(x, y + 0.08, 0.4, "#ffffff");
      d.circle(x, y + 0.08, 0.35, this.colors[i]!); // apron-coloured body
      d.circle(x, y - 0.3, 0.25, "#ffd9b8");
      d.rect(x - 0.22, y - 0.62, 0.44, 0.2, this.hat, 0.05); // chef's hat
      d.circle(x - 0.12, y - 0.66, 0.13, this.hat);
      d.circle(x + 0.12, y - 0.66, 0.13, this.hat);
      d.circle(x, y - 0.72, 0.14, this.hat);
      d.circle(x - 0.08 + c.fx * 0.05, y - 0.3, 0.035, "#2a1c33");
      d.circle(x + 0.08 + c.fx * 0.05, y - 0.3, 0.035, "#2a1c33");
      d.text(String(i + 1), x, y + 0.14, 0.3, "#ffffff");
      if (c.chopAnim > 0) d.text("🔪", x + c.fx * 0.45, y + c.fy * 0.45 - c.chopAnim * 0.25, 0.38, "#000");
      if (c.fy >= -0.5) held();
    });

    // effects
    for (const b of this.bits) {
      ctx.globalAlpha = Math.max(0, b.life / b.max);
      if (b.text) d.text(b.text, b.x, b.y, b.size, b.color, 900);
      else d.circle(b.x, b.y, b.size, b.color);
    }
    ctx.globalAlpha = 1;
  }
}
