/**
 * Phones → TiffinInput. One big verb plus a dash, in every mode:
 *   buttons   joystick · ACTION (its icon shows what it will do: ✋ pick, 🔪 chop, 🍳 flip, 🛎️ serve…) · DASH
 *   touchpad  drag to move · tap = ACTION · swipe = DASH (at a board, grinder or sink every swipe is a stroke:
 *             circle your finger to grind)
 *   motion    tilt to move · push or flick up = ACTION (flick up to flip a dosa) · shake = chop/grind/wash ·
 *             flick sideways = DASH
 */
import type { ControlSpec } from "@playwithtv/protocol";
import type { ControlPlayers } from "../controlKit";
import { IDLE, type TiffinInput } from "./engine";
import type { Verb } from "./interact";

export const CONTROLS: ControlSpec = {
  title: "Tiffin Tornado",
  modes: ["buttons", "touchpad", "motion"],
  stick: "joystick",
  tilt: "tray",
  actions: [
    { id: "act", label: "✋ ACTION", color: "#ff8a1f", gestures: ["push", "flick-up"], swipes: ["tap"], buttonIn: ["buttons"] },
    { id: "dash", label: "💨 DASH", color: "#2fa8ff", gestures: ["flick-left", "flick-right", "flick-down"], swipes: ["swipe-left", "swipe-right", "swipe-up", "swipe-down"], buttonIn: ["buttons"] },
    { id: "work", label: "🌀 WORK", gestures: ["shake"], buttonIn: [] },
  ],
  hints: {
    buttons: "Stick to move · ACTION does what its icon shows (pick, chop, flip, serve…) · DASH to zoom",
    touchpad: "Drag to move · tap = ACTION · swipe = DASH · at the grinder, swipe round and round to grind",
    motion: "Tilt to move · push = ACTION · flick up to flip dosas · shake to chop · flick sideways to dash",
  },
};

const WORK_VERBS: ReadonlySet<Verb> = new Set(["chop", "grind", "wash"]);

/** Collects each player's presses between simulation steps. */
export class TiffinControls {
  private act = new Map<string, number>();
  private dash = new Map<string, number>();
  private work = new Map<string, number>();
  private off: (() => void) | null = null;
  /** Per player: actions received (for the debug state and the e2e test). */
  readonly got = new Map<string, { act: number; dash: number; work: number }>();

  constructor(private kit: ControlPlayers, ids: string[]) {
    for (const id of ids) this.got.set(id, { act: 0, dash: 0, work: 0 });
  }

  start() {
    this.off ??= this.kit.onAction((id, a) => {
      const g = this.got.get(id);
      if (!g) return;
      if (a === "act") { g.act++; this.act.set(id, (this.act.get(id) ?? 0) + 1); }
      if (a === "dash") { g.dash++; this.dash.set(id, (this.dash.get(id) ?? 0) + 1); }
      if (a === "work") { g.work++; this.work.set(id, (this.work.get(id) ?? 0) + 1); }
    });
  }

  /**
   * This step's input. `verb` is what the player's ACTION would do right now: next to a board, grinder or sink a
   * touchpad swipe (dash) counts as a work stroke instead (1.5 strokes: circling is quicker than tapping).
   */
  read(id: string, verb: Verb): TiffinInput {
    const r = this.kit.get(id);
    if (!r.ok) return IDLE;
    const act = (this.act.get(id) ?? 0) > 0;
    if (act) this.act.set(id, this.act.get(id)! - 1);
    let dash = (this.dash.get(id) ?? 0) > 0;
    let work = this.work.get(id) ?? 0;
    this.work.set(id, 0);
    if (dash) this.dash.set(id, this.dash.get(id)! - 1);
    if (dash && WORK_VERBS.has(verb) && this.kit.mode(id) === "touchpad") {
      dash = false;
      work += 1.5;
    }
    if (work > 0 && WORK_VERBS.has(verb) && this.kit.mode(id) === "motion") work *= 1.5;
    return { x: r.x, z: -r.y, act, work, dash };
  }

  flush() {
    this.act.clear();
    this.dash.clear();
    this.work.clear();
  }

  dispose() {
    this.off?.();
    this.off = null;
  }
}
