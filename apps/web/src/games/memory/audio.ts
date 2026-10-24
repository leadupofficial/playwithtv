import type { Dir } from "./engine";

/** A soft pentatonic chord: each direction has its own note (Web Audio, nothing to download or license). */
export const NOTE: Record<Dir, number> = { down: 392, left: 523.25, up: 659.25, right: 783.99 };

export class MemorySfx {
  private ctx: AudioContext | null = null;

  private ac(): AudioContext | null {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
      } catch {
        return null;
      }
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  private tone(freq: number, dur: number, gain: number, type: OscillatorType = "sine", at = 0, slideTo?: number) {
    const c = this.ac();
    if (!c) return;
    const o = c.createOscillator();
    o.type = type;
    const t0 = c.currentTime + at;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(c.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  /** The TV showing one step: the note with a gentle octave shimmer. */
  step(d: Dir, ms: number) {
    const dur = Math.max(0.2, ms / 1000);
    this.tone(NOTE[d], dur, 0.32, "triangle");
    this.tone(NOTE[d] * 2, dur * 0.7, 0.06, "sine");
  }
  /** A player's correct step (quiet, so eight players at once stay pleasant). */
  tick(d: Dir) {
    this.tone(NOTE[d], 0.12, 0.08, "sine");
  }
  /** Someone completed the wave. */
  done() {
    this.tone(784, 0.14, 0.12, "triangle");
    this.tone(1046.5, 0.22, 0.12, "triangle", 0.08);
  }
  wrong() {
    this.tone(180, 0.35, 0.18, "sawtooth", 0, 110);
  }
  out() {
    this.tone(330, 0.25, 0.16, "triangle", 0, 300);
    this.tone(262, 0.25, 0.16, "triangle", 0.2, 240);
    this.tone(196, 0.5, 0.16, "triangle", 0.4, 150);
  }
  /** "Your turn": a rising whoosh. */
  go() {
    this.tone(400, 0.25, 0.1, "sine", 0, 900);
  }
  fanfare() {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone(f, 0.4, 0.14, "triangle", i * 0.12));
    this.tone(1318.5, 0.8, 0.1, "sine", 0.5);
  }
}
