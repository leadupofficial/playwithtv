/**
 * Phones → RacerInput. One big verb (DRIFT) plus two taps; the gas is always on.
 *   hybrid   tilt the phone like a wheel to steer (smooth, analogue) · HOLD the big DRIFT button · tap BOOST / ITEM
 *   buttons  ◀ ▶ to steer · HOLD DRIFT · tap BOOST / ITEM
 *   motion   tilt to steer · flick sideways to start a drift (straighten up to fire the turbo) · push = BOOST · pull = ITEM
 */
import type { ControlSpec } from "@playwithtv/protocol";
import type { ControlPlayers } from "../controlKit";
import type { GameBridge } from "../types";
import { IDLE, type RacerInput } from "./racer";

export const CONTROLS: ControlSpec = {
  title: "GHAT RUSH",
  modes: ["hybrid", "buttons", "motion"],
  stick: "arrows-h",
  tilt: "steer",
  actions: [
    { id: "drift", label: "🌀 HOLD DRIFT", color: "#7c3aed", hold: true, gestures: ["flick-left", "flick-right"] },
    { id: "boost", label: "🔥 BOOST", color: "#ff6a00", gestures: ["push"] },
    { id: "item", label: "🎁 ITEM", color: "#16a34a", gestures: ["pull"] },
  ],
  hints: {
    hybrid: "Turn the phone like a wheel · HOLD DRIFT in corners, let go for a turbo · tap BOOST and ITEM",
    buttons: "◀ ▶ to steer · HOLD DRIFT in corners, let go for a turbo · tap BOOST and ITEM",
    motion: "Turn to steer (gas is automatic) · flick sideways to drift, straighten to fire · push = boost · pull = item",
  },
};

interface Pad { boost: boolean; item: boolean; flickDrift: number; straightT: number; held: boolean; got: { boost: number; item: number; drift: number } }

export class GhatControls {
  private pads = new Map<string, Pad>();
  private offs: Array<() => void> = [];

  constructor(private kit: ControlPlayers, private bridge: GameBridge, ids: string[]) {
    for (const id of ids) this.pads.set(id, { boost: false, item: false, flickDrift: 0, straightT: 0, held: false, got: { boost: 0, item: 0, drift: 0 } });
  }

  start() {
    if (this.offs.length) return;
    this.offs.push(this.kit.onAction((id, action) => {
      const p = this.pads.get(id);
      if (!p) return;
      if (action === "boost") { p.boost = true; p.got.boost++; }
      if (action === "item") { p.item = true; p.got.item++; }
      if (action === "drift" && this.kit.mode(id) === "motion") {
        p.got.drift++;
        // a flick (motion) or a tap: drift towards the current steering for a moment
        p.flickDrift = 1.6;
        p.straightT = 0;
      }
    }));
    // hold presses straight from the raw state, so even a very short squeeze counts
    this.offs.push(this.bridge.onInput((id, state) => {
      const p = this.pads.get(id);
      if (!p) return;
      const down = !!state.buttons?.drift;
      if (down && !p.held) {
        p.got.drift++;
        this.kit.seen.get(id)?.add("drift");
      }
      p.held = down;
    }));
    this.offs.push(this.bridge.onClear((id) => {
      const p = this.pads.get(id);
      if (p) p.held = false;
    }));
  }

  /** Action counts per player (debug state). */
  received(id: string) {
    return this.pads.get(id)?.got ?? null;
  }

  /** This step's input (consumes taps). Motion flick-drifts end when you straighten the wheel. */
  read(id: string, dt: number): RacerInput {
    const m = this.kit.get(id);
    const p = this.pads.get(id);
    if (!p || !m.ok) return IDLE;
    const steer = Math.max(-1, Math.min(1, m.x));
    let drift = p.held || m.held("drift");
    if (p.flickDrift > 0) {
      p.flickDrift -= dt;
      if (Math.abs(steer) < 0.15) p.straightT += dt;
      else p.straightT = 0;
      if (p.straightT > 0.12) p.flickDrift = 0;
      drift = drift || p.flickDrift > 0;
    }
    const out = { steer, drift, boost: p.boost, item: p.item };
    p.boost = p.item = false;
    return out;
  }

  /** Forget pending taps (before GO). */
  flush() {
    for (const p of this.pads.values()) p.boost = p.item = false;
  }

  dispose() {
    this.offs.forEach((o) => o());
    this.offs = [];
  }
}
