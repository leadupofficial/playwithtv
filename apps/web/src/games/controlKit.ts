import { ControlReader } from "@playwithtv/motion";
import type { ControlMode, ControlSpec } from "@playwithtv/protocol";
import type { GameBridge } from "./types";

export const MODE_NAMES: ControlMode[] = ["buttons", "motion", "hybrid", "touchpad"];
export const MODE_ICON: Record<ControlMode, string> = { buttons: "🎮", motion: "🎯", hybrid: "⚡", touchpad: "👆" };

/**
 * TV side of the controls for one game: sends the game's ControlSpec to the phones and keeps a ControlReader
 * per player. Games read movement from `get(id).x / .y` (and `.held(action)`) every frame and react to
 * `onAction`. They never need to know whether a player uses buttons, tilt or the touchpad.
 */
export class ControlPlayers {
  private readers = new Map<string, ControlReader>();
  private cbs = new Set<(playerId: string, action: string) => void>();
  private offs: Array<() => void> = [];
  /** Actions seen per player (for the practice checklist). */
  seen = new Map<string, Set<string>>();

  constructor(private bridge: GameBridge, ids: string[], readonly spec: ControlSpec) {
    for (const id of ids) {
      this.readers.set(id, new ControlReader());
      this.seen.set(id, new Set());
    }
  }

  /** Subscribes to the controllers and shows this game's controls on every phone (idempotent). */
  start() {
    if (this.offs.length) return;
    this.offs = [
      this.bridge.onInput((id, state) => {
        const r = this.readers.get(id);
        if (!r) return;
        for (const a of r.update(state)) {
          this.seen.get(id)!.add(a);
          this.cbs.forEach((cb) => cb(id, a));
        }
      }),
      this.bridge.onClear((id) => this.readers.get(id)?.clear()),
    ];
    this.bridge.layout("all", "game", this.spec as unknown as Record<string, unknown>);
  }

  get(id: string): ControlReader {
    return this.readers.get(id) ?? new ControlReader();
  }

  /** The mode a player is using right now. */
  mode(id: string): ControlMode {
    return MODE_NAMES[this.get(id).mode] ?? "buttons";
  }

  onAction(cb: (playerId: string, action: string) => void) {
    this.cbs.add(cb);
    return () => void this.cbs.delete(cb);
  }

  /** Ready to play: controller live, calibrated if it uses tilt, and every practice action done once. */
  ready(id: string, practice: string[]): boolean {
    const r = this.get(id);
    const tilt = r.mode === 1 || r.mode === 2;
    return r.ok && (!tilt || r.calibrations > 0) && practice.every((a) => this.seen.get(id)?.has(a));
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
