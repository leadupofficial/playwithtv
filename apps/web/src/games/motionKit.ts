import { MotionReader, type Gesture, type GestureKind } from "@scp/motion";
import type { GameBridge } from "./types";
import { t } from "../i18n";

export type MotionControl = { motion: GestureKind | "roll" | "pitch" | "yaw"; label: string };

/**
 * TV side of the motion SDK for one game: a MotionReader per player, fed from the bridge,
 * with gesture callbacks. Games read tilt from `get(id)` every frame and react to gestures.
 */
export class MotionPlayers {
  private readers = new Map<string, MotionReader>();
  private cbs = new Set<(playerId: string, g: Gesture) => void>();
  private offs: Array<() => void> = [];
  /** Gestures seen per player (for the practice checklist). */
  seen = new Map<string, Set<GestureKind>>();

  constructor(private bridge: GameBridge, ids: string[]) {
    for (const id of ids) {
      this.readers.set(id, new MotionReader());
      this.seen.set(id, new Set());
    }
  }

  /** Subscribes to the controllers (idempotent; call from an effect, undo with dispose()). */
  start() {
    if (this.offs.length) return;
    const bridge = this.bridge;
    this.offs = [
      bridge.onInput((id, state) => {
        const r = this.readers.get(id);
        if (!r) return;
        for (const g of r.update(state)) {
          this.seen.get(id)!.add(g.kind);
          this.cbs.forEach((cb) => cb(id, g));
        }
      }),
      bridge.onClear((id) => this.readers.get(id)?.clear()),
    ];
  }

  get(id: string): MotionReader {
    return this.readers.get(id) ?? new MotionReader();
  }

  onGesture(cb: (playerId: string, g: Gesture) => void) {
    this.cbs.add(cb);
    return () => void this.cbs.delete(cb);
  }

  /** Puts the given players' phones into the motion controller, showing these moves as a reminder. */
  controls(to: string, title: string, controls: MotionControl[], calibrate = true) {
    this.bridge.layout(to, "motion", { title, controls, calibrate });
  }

  status(to: string, data: { text?: string; bars?: Array<{ label: string; value: number; color?: string }> }) {
    this.bridge.event(to, "status", data);
  }

  toast(to: string, text: string, tone: "good" | "bad" | "info" = "info") {
    this.bridge.event(to, "toast", { text, tone });
  }

  /** The phone's final screen for this match. */
  outcome(to: string, text: string, emoji: string) {
    this.bridge.event(to, "outcome", { text, emoji });
  }

  dispose() {
    this.offs.forEach((off) => off());
    this.offs = [];
  }
}

export const motionLabel = (m: string) => t(`motion.${m}` as Parameters<typeof t>[0]);
