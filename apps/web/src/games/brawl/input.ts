/**
 * Phones → BrawlInput. Every mode gives the same three verbs:
 *   buttons   joystick to move · HOLD the big SWING button to charge, let go to swing · DODGE
 *   touchpad  drag to move · tap to swing (hold the SWING button for a charged one) · swipe to dodge
 *   motion    tilt to move · push to swing (a strong push = full smash) · flick to dodge
 * Hold presses are tracked from the raw controller states as well, so a press shorter than one frame still
 * swings (the TV would otherwise only ever see "not held").
 */
import type { ControlSpec } from "@playwithtv/protocol";
import type { ControlPlayers } from "../controlKit";
import type { GameBridge } from "../types";
import { IDLE, type BrawlInput } from "./rules";

export const CONTROLS: ControlSpec = {
  title: "Pillow Fort Brawl",
  modes: ["buttons", "touchpad", "motion"],
  stick: "joystick",
  tilt: "tray",
  actions: [
    { id: "swing", label: "🪶 HOLD to SWING", color: "#ff5d73", hold: true, gestures: ["push"], swipes: ["tap"], buttonIn: ["buttons", "touchpad"] },
    { id: "smash", label: "SMASH", color: "#ff5d73", strongOf: "swing", buttonIn: [] },
    { id: "dodge", label: "💨 DODGE", color: "#3a86ff", gestures: ["flick-left", "flick-right", "flick-up", "flick-down"], swipes: ["swipe-left", "swipe-right", "swipe-up", "swipe-down"], buttonIn: ["buttons"] },
  ],
  hints: {
    buttons: "Stick to move · HOLD 🪶 SWING to charge, let go to whack · DODGE to dash",
    touchpad: "Drag to move · tap to swing (hold SWING to charge) · swipe to dodge",
    motion: "Tilt to move · push to swing (push hard = SMASH) · flick to dodge",
  },
};

/** A quick swing (tap, push gesture, touchpad tap). */
export const TAP_POWER = 0.3;

interface Held { down: boolean; pressed: boolean; released: boolean }

export class BrawlControls {
  private held = new Map<string, Held>();
  private swing = new Map<string, number>();
  private dodge = new Set<string>();
  private offs: Array<() => void> = [];
  /** Actions received per player (swing taps, smashes, dodges, SWING presses), for the debug state. */
  readonly received = new Map<string, { swing: number; smash: number; dodge: number; hold: number }>();

  constructor(private kit: ControlPlayers, private bridge: GameBridge, ids: string[]) {
    for (const id of ids) {
      this.held.set(id, { down: false, pressed: false, released: false });
      this.received.set(id, { swing: 0, smash: 0, dodge: 0, hold: 0 });
    }
  }

  /** Subscribes to the phones (idempotent, like ControlPlayers.start). */
  start() {
    if (this.offs.length) return;
    const { bridge, kit } = this;
    this.offs.push(bridge.onInput((id, state) => {
      const h = this.held.get(id);
      if (!h) return;
      const down = !!state.buttons?.swing;
      if (down && !h.down) {
        h.pressed = true;
        this.received.get(id)!.hold++;
      }
      if (!down && h.down) h.released = true;
      h.down = down;
    }));
    this.offs.push(bridge.onClear((id) => {
      const h = this.held.get(id);
      if (h) Object.assign(h, { down: false, pressed: false, released: false });
    }));
    this.offs.push(kit.onAction((id, action) => {
      const r = this.received.get(id);
      if (r && (action === "swing" || action === "smash" || action === "dodge")) r[action]++;
      if (action === "swing") this.swing.set(id, Math.max(this.swing.get(id) ?? 0, TAP_POWER));
      if (action === "smash") this.swing.set(id, 1);
      if (action === "dodge") this.dodge.add(id);
    }));
  }

  /** Marks a held SWING as practised (hold actions send no taps, but the practice checklist wants one). */
  practise() {
    for (const [id, h] of this.held) if (h.down || h.pressed) this.kit.seen.get(id)?.add("swing");
  }

  /** This step's input for a player (consumes taps and press edges). */
  read(id: string): BrawlInput {
    const m = this.kit.get(id);
    if (!m.ok) return IDLE;
    const h = this.held.get(id);
    // a press and release within one step still counts as a (tiny) charge for that step
    const charge = !!h && (h.down || (h.pressed && h.released));
    if (h) h.pressed = h.released = false;
    const swing = this.swing.get(id) ?? 0;
    this.swing.delete(id);
    const dodge = this.dodge.delete(id);
    return { x: m.x, z: -m.y, charge, swing, dodge };
  }

  /** Forgets pending taps (between rounds, so a stray press does not swing on "GO"). */
  flush() {
    this.swing.clear();
    this.dodge.clear();
  }

  dispose() {
    this.offs.forEach((off) => off());
    this.offs = [];
  }
}
