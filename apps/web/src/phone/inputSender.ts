import type { InputState } from "@playwithtv/protocol";
import type { HubSocket } from "../net";

/**
 * Sends the full controller state with an increasing sequence number: immediately for button presses,
 * at most every 50 ms for analog axes (tilt), and as a 4 Hz heartbeat. The hub drops stale frames, so the
 * TV always acts on the latest complete state and nothing can stay "held" after a lost packet.
 */
export class InputSender {
  private seq = 0;
  private state: InputState = {};
  private dirty = false;
  private heartbeat: ReturnType<typeof setInterval>;
  private axesTimer: ReturnType<typeof setInterval>;

  /** `direct` sends a frame over the phone→TV link and returns false when that link is not open. */
  constructor(private socket: HubSocket, private direct?: (seq: number, state: InputState) => boolean) {
    this.heartbeat = setInterval(() => this.flush(), 250);
    this.axesTimer = setInterval(() => this.dirty && this.flush(), 50);
  }
  private update(fn: (s: InputState) => InputState) {
    this.state = fn(this.state);
    this.flush();
  }
  hold(key: string, down: boolean) {
    if (!!this.state.buttons?.[key] === down) return;
    this.update((s) => ({ ...s, buttons: { ...s.buttons, [key]: down } }));
  }
  tap(key: string) {
    this.tapMany([key]);
  }
  /** Several counters in one frame (a gesture and its "strong" counter must arrive together). */
  tapMany(keys: string[]) {
    this.update((s) => {
      const taps = { ...s.taps };
      for (const k of keys) taps[k] = (taps[k] ?? 0) + 1;
      return { ...s, taps };
    });
  }
  /** Analog values in [-1, 1]; throttled. */
  axes(values: Record<string, number>) {
    const clamped: Record<string, number> = {};
    for (const [k, v] of Object.entries(values)) clamped[k] = Math.round(Math.max(-1, Math.min(1, v)) * 100) / 100;
    this.state = { ...this.state, axes: { ...this.state.axes, ...clamped } };
    this.dirty = true;
  }
  /** Release every held button and centre the axes (screen hidden, motion turned off, game changed). */
  release() {
    this.update((s) => ({ ...s, buttons: {}, axes: {} }));
  }
  private flush() {
    this.dirty = false;
    const seq = this.seq++;
    if (!this.direct?.(seq, this.state)) this.socket.send({ type: "controller.input", seq, state: this.state });
  }
  stop() {
    clearInterval(this.heartbeat);
    clearInterval(this.axesTimer);
  }
}
