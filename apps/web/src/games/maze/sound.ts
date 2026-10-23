/** Small synthesised sounds (original, generated in code): chimes, a fall, a bump and a win jingle. */
export class Chimes {
  private ctx: AudioContext | null = null;
  private ac() {
    try {
      this.ctx ??= new AudioContext();
      return this.ctx;
    } catch {
      return null;
    }
  }
  private tone(freq: number, dur: number, type: OscillatorType = "sine", vol = 0.15, at = 0) {
    const ac = this.ac();
    if (!ac) return;
    const o = ac.createOscillator();
    const g = ac.createGain();
    const t = ac.currentTime + at;
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(ac.destination);
    o.start(t);
    o.stop(t + dur);
  }
  chime(freq: number) {
    this.tone(freq, 0.25, "triangle");
  }
  fall() {
    const ac = this.ac();
    if (!ac) return;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.frequency.setValueAtTime(500, ac.currentTime);
    o.frequency.exponentialRampToValueAtTime(60, ac.currentTime + 0.6);
    g.gain.setValueAtTime(0.18, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.6);
    o.connect(g).connect(ac.destination);
    o.start();
    o.stop(ac.currentTime + 0.6);
  }
  bump(speed: number) {
    this.tone(90 + speed * 10, 0.08, "square", Math.min(0.12, speed / 60));
  }
  win() {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.3, "triangle", 0.15, i * 0.12));
  }
}
