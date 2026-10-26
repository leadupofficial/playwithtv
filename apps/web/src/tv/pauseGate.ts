import type { InputState } from "@playwithtv/protocol";

/**
 * Stands between controller input and the running game while it is paused (the TV lost its hub connection,
 * or the hub paused the game). Nothing reaches the game during a pause, and taps pressed during the pause
 * never reach it afterwards either: tap counters are cumulative, so a game would otherwise see every press
 * made in the pause as one burst on its first frame back. On resume each player's latest state is re-sent
 * once (so a hold released during the pause is released in the game) with its counters rebased.
 */
export class PauseGate {
  private paused = false;
  /** Taps pressed while paused, per player and action: subtracted from everything that player sends later. */
  private offset = new Map<string, Record<string, number>>();
  /** The last raw tap counters seen per player (to measure presses made while paused). */
  private lastRaw = new Map<string, Record<string, number>>();
  /** The latest raw state of each player who sent input while paused. */
  private held = new Map<string, InputState>();

  /** Input for the game, or null while paused. */
  filter(id: string, state: InputState): InputState | null {
    const raw = state.taps ?? {};
    const before = this.lastRaw.get(id) ?? {};
    const off = this.offset.get(id) ?? {};
    for (const k of Object.keys(raw)) {
      const n = raw[k]!;
      if (n < (before[k] ?? 0)) off[k] = 0; // the phone started counting again (reload): nothing to subtract
      else if (this.paused) off[k] = (off[k] ?? 0) + n - (before[k] ?? 0);
    }
    this.offset.set(id, off);
    this.lastRaw.set(id, { ...raw });
    if (this.paused) {
      this.held.set(id, state);
      return null;
    }
    return this.rebase(id, state);
  }

  /** Pauses or resumes; on resume, returns the states to re-send to the game (latest per player, rebased). */
  setPaused(paused: boolean): Array<[string, InputState]> {
    if (paused === this.paused) return [];
    this.paused = paused;
    if (paused) return [];
    const out = [...this.held].map(([id, s]) => [id, this.rebase(id, s)] as [string, InputState]);
    this.held.clear();
    return out;
  }

  /** A player's input numbering restarted (controller.clear): forget their counters. */
  reset(id: string) {
    this.offset.delete(id);
    this.lastRaw.delete(id);
    this.held.delete(id);
  }

  private rebase(id: string, state: InputState): InputState {
    const off = this.offset.get(id);
    if (!state.taps || !off) return state;
    const taps: Record<string, number> = {};
    for (const [k, n] of Object.entries(state.taps)) taps[k] = Math.max(0, n - (off[k] ?? 0));
    return { ...state, taps };
  }
}
