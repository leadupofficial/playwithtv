/**
 * kitplat/input: phones → PadInput. Every mode gives the same verbs:
 *   buttons   ◀ ▶ (▲ ▼) arrows · JUMP (hold for a higher jump) · RUN (hold) · ACTION (throw, pull a lever)
 *   motion    tilt to run (tilt far to sprint) · flick up to jump · push towards the TV for ACTION
 *   touchpad  drag to run (drag far to sprint) · tap or swipe up to jump (or hold JUMP) · ACTION button
 * JUMP and RUN are read from the raw controller state the moment it arrives (not once a frame), so a press is
 * never missed and jump latency is the link's ~8 ms plus at most one 16 ms simulation step.
 */
import type { ControlSpec } from "@playwithtv/protocol";
import type { ControlPlayers } from "../controlKit";
import type { GameBridge } from "../types";
import type { PadInput } from "./player";

export function platControls(title: string, o: { stick: ControlSpec["stick"]; act: string; actColor?: string; hints?: ControlSpec["hints"] }): ControlSpec {
  return {
    title,
    modes: ["buttons", "motion", "touchpad"],
    stick: o.stick,
    tilt: "steer",
    actions: [
      { id: "jump", label: "⤒ JUMP", color: "#2ec4b6", hold: true, buttonIn: ["buttons", "hybrid", "touchpad"] },
      { id: "hop", label: "⤒ JUMP", gestures: ["flick-up"], swipes: ["swipe-up", "tap"], buttonIn: [] },
      { id: "run", label: "💨 RUN", color: "#ff9f1c", hold: true, buttonIn: ["buttons"] },
      { id: "act", label: o.act, color: o.actColor ?? "#b5179e", gestures: ["push"], swipes: ["swipe-down"], buttonIn: ["buttons", "touchpad"] },
    ],
    hints: o.hints ?? {
      buttons: "◀ ▶ to move · hold JUMP to jump higher · hold RUN to sprint",
      motion: "Turn the phone like a wheel to run (further = faster) · flick up to jump · push towards the TV for ACTION",
      touchpad: "Drag to run · tap or swipe up to jump (or hold JUMP) · swipe down for ACTION",
    },
  };
}

interface PadState { jump: boolean; run: boolean; pressed: number; hopUntil: number; act: number }

export class PlatControls {
  private st = new Map<string, PadState>();
  private offs: Array<() => void> = [];
  /** Inputs received per player, for the debug attribute and tests. */
  readonly received = new Map<string, { jump: number; hop: number; act: number; run: number }>();

  constructor(private kit: ControlPlayers, private bridge: GameBridge, ids: string[]) {
    for (const id of ids) {
      this.st.set(id, { jump: false, run: false, pressed: 0, hopUntil: 0, act: 0 });
      this.received.set(id, { jump: 0, hop: 0, act: 0, run: 0 });
    }
  }

  start() {
    if (this.offs.length) return;
    this.offs.push(this.bridge.onInput((id, state) => {
      const s = this.st.get(id);
      if (!s) return;
      const jump = !!state.buttons?.jump;
      const run = !!state.buttons?.run;
      if (jump && !s.jump) {
        s.pressed = 1;
        this.received.get(id)!.jump++;
        this.kit.seen.get(id)?.add("jump");
      }
      if (run && !s.run) this.received.get(id)!.run++;
      s.jump = jump;
      s.run = run;
    }));
    this.offs.push(this.bridge.onClear((id) => {
      const s = this.st.get(id);
      if (s) Object.assign(s, { jump: false, run: false });
    }));
    this.offs.push(this.kit.onAction((id, action) => {
      const s = this.st.get(id);
      const r = this.received.get(id);
      if (!s || !r) return;
      if (action === "hop") {
        s.pressed = 1;
        s.hopUntil = performance.now() + 300; // a flick or a tap is a near-full jump
        r.hop++;
        this.kit.seen.get(id)?.add("jump");
      } else if (action === "act") {
        s.act = 1;
        r.act++;
      }
    }));
  }

  /** Fills `out` with this step's input for a player, consuming presses. */
  read(id: string, out: PadInput, now = performance.now()): PadInput {
    const s = this.st.get(id);
    const m = this.kit.get(id);
    if (!s || !m.ok) {
      out.x = out.y = 0;
      out.jump = out.jumpPressed = out.run = out.action = false;
      if (s) { s.pressed = 0; s.act = 0; }
      return out;
    }
    const mode = this.kit.mode(id);
    out.x = Math.abs(m.x) < 0.12 ? 0 : m.x;
    out.y = m.y;
    out.jumpPressed = s.pressed > 0;
    if (s.pressed > 0) s.pressed--;
    out.jump = s.jump || now < s.hopUntil;
    out.run = s.run || (mode !== "buttons" && Math.abs(m.x) > 0.8);
    out.action = s.act > 0;
    if (s.act > 0) s.act--;
    return out;
  }

  flush() {
    for (const s of this.st.values()) { s.pressed = 0; s.act = 0; }
  }

  dispose() {
    this.offs.forEach((off) => off());
    this.offs = [];
  }
}
