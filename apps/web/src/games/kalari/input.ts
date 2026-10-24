/**
 * Phones → KalariInput. Every mode gives the same verbs:
 *   buttons   joystick · STRIKE (tap-tap-tap chains) · HEAVY · GUARD (hold; press just before a hit to parry) ·
 *             ROLL · SPECIAL (when the meter is full)
 *   touchpad  drag to move · tap = strike · swipe up = special · swipe left/right/down = roll · GUARD and HEAVY buttons
 *   motion    tilt to move · push = strike · strong push = heavy · flick = roll · shake = special · pull = guard (½ s)
 * GUARD is read from the raw controller state too, so a press shorter than a frame still counts.
 */
import type { ControlSpec } from "@playwithtv/protocol";
import type { ControlPlayers } from "../controlKit";
import type { GameBridge } from "../types";
import { IDLE, type KalariInput } from "./rules";

export const CONTROLS: ControlSpec = {
  title: "Kalari Clash",
  modes: ["buttons", "touchpad", "motion"],
  stick: "joystick",
  tilt: "tray",
  actions: [
    { id: "strike", label: "👊 STRIKE", color: "#ff5d5d", gestures: ["push"], swipes: ["tap"], buttonIn: ["buttons"] },
    { id: "heavy", label: "🦶 HEAVY", color: "#ff9f1c", strongOf: "strike", buttonIn: ["buttons", "touchpad"] },
    { id: "guard", label: "🛡 GUARD", color: "#3a86ff", hold: true, buttonIn: ["buttons", "touchpad"] },
    { id: "block", label: "🛡 GUARD", gestures: ["pull"], buttonIn: [] }, // motion: pull back = guard for half a second
    { id: "roll", label: "💨 ROLL", color: "#2ec4b6", gestures: ["flick-left", "flick-right", "flick-down"], swipes: ["swipe-left", "swipe-right", "swipe-down"], buttonIn: ["buttons"] },
    { id: "special", label: "🔥 SPECIAL", color: "#ffd23f", gestures: ["shake"], swipes: ["swipe-up"], buttonIn: ["buttons"] },
  ],
  hints: {
    buttons: "Stick to move · STRIKE (tap-tap-tap) · HEAVY breaks guards · hold GUARD (tap it just before a hit to PARRY) · ROLL · SPECIAL when the meter is full",
    touchpad: "Drag to move · tap to strike · swipe sideways to roll · swipe up for SPECIAL · GUARD and HEAVY buttons",
    motion: "Tilt to move · push to strike (hard push = HEAVY) · flick to roll · shake for SPECIAL · pull back to GUARD",
  },
};

interface Held { down: boolean; pressed: boolean; until: number }

export class KalariControls {
  private held = new Map<string, Held>();
  private pending = new Map<string, Set<string>>();
  private offs: Array<() => void> = [];
  /** Actions received per player, for the debug state and tests. */
  readonly received = new Map<string, Record<"strike" | "heavy" | "guard" | "roll" | "special", number>>();

  constructor(private kit: ControlPlayers, private bridge: GameBridge, ids: string[]) {
    for (const id of ids) {
      this.held.set(id, { down: false, pressed: false, until: 0 });
      this.pending.set(id, new Set());
      this.received.set(id, { strike: 0, heavy: 0, guard: 0, roll: 0, special: 0 });
    }
  }

  start() {
    if (this.offs.length) return;
    this.offs.push(this.bridge.onInput((id, state) => {
      const h = this.held.get(id);
      if (!h) return;
      const down = !!state.buttons?.guard;
      if (down && !h.down) {
        h.pressed = true;
        this.received.get(id)!.guard++;
      }
      h.down = down;
    }));
    this.offs.push(this.bridge.onClear((id) => {
      const h = this.held.get(id);
      if (h) Object.assign(h, { down: false, pressed: false });
    }));
    this.offs.push(this.kit.onAction((id, action) => {
      const r = this.received.get(id);
      if (action === "block") {
        const h = this.held.get(id);
        if (h) { h.until = performance.now() + 500; h.pressed = true; }
        if (r) r.guard++;
        return;
      }
      if (!r || !(action in r) || action === "guard") return;
      r[action as keyof typeof r]++;
      this.pending.get(id)!.add(action);
    }));
  }

  /** Marks a held GUARD as practised (hold actions send no taps). */
  practise() {
    for (const [id, h] of this.held) if (h.down || h.pressed) this.kit.seen.get(id)?.add("guard");
  }

  /** Taps waiting for a player (e.g. on the character-select screen), consumed. */
  take(id: string): Set<string> {
    const p = this.pending.get(id) ?? new Set<string>();
    const out = new Set(p);
    p.clear();
    const h = this.held.get(id);
    if (h?.pressed) { out.add("guard"); h.pressed = false; }
    return out;
  }

  /** This step's input for a fighter (consumes taps and press edges). */
  read(id: string): KalariInput {
    const m = this.kit.get(id);
    const p = this.pending.get(id);
    const h = this.held.get(id);
    if (!m.ok || !p || !h) return IDLE;
    const inp: KalariInput = {
      x: m.x, z: -m.y, strike: p.has("strike"), heavy: p.has("heavy"), guard: h.down || h.pressed || performance.now() < h.until,
      roll: p.has("roll"), special: p.has("special"),
    };
    p.clear();
    h.pressed = false;
    return inp;
  }

  flush() {
    for (const p of this.pending.values()) p.clear();
  }

  dispose() {
    this.offs.forEach((off) => off());
    this.offs = [];
  }
}
