/** Synthesised race sounds (original, generated in code). */
export class Engines {
  private ctx: AudioContext | null = null;
  private ac() {
    try {
      this.ctx ??= new AudioContext();
      return this.ctx;
    } catch {
      return null;
    }
  }
  private sweep(from: number, to: number, dur: number, type: OscillatorType, vol: number) {
    const ac = this.ac();
    if (!ac) return;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(from, ac.currentTime);
    o.frequency.exponentialRampToValueAtTime(to, ac.currentTime + dur);
    g.gain.setValueAtTime(vol, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
    o.connect(g).connect(ac.destination);
    o.start();
    o.stop(ac.currentTime + dur);
  }
  ding() {
    this.sweep(880, 1320, 0.18, "triangle", 0.12);
  }
  whoosh() {
    this.sweep(120, 900, 0.5, "sawtooth", 0.08);
  }
  bump() {
    this.sweep(200, 50, 0.3, "square", 0.12);
  }
}
