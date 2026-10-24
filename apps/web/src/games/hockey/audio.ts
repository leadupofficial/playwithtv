/** Synthesised air hockey sounds (Web Audio): plastic clacks, rail taps, a goal horn. Nothing to license. */
export class HockeySfx {
  private ctx: AudioContext | null = null;
  private noise: AudioBuffer | null = null;
  private last = 0;

  private ac(): AudioContext | null {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
        const len = Math.floor(this.ctx.sampleRate / 2);
        this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      } catch {
        return null;
      }
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  private tone(freq: number, dur: number, gain: number, type: OscillatorType, at = 0, slide = 0) {
    const c = this.ac();
    if (!c) return;
    const o = c.createOscillator();
    o.type = type;
    const t0 = c.currentTime + at;
    o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t0 + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(c.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  private burst(dur: number, freq: number, gain: number) {
    const c = this.ac();
    if (!c || !this.noise) return;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
    src.connect(f).connect(g).connect(c.destination);
    src.start();
    src.stop(c.currentTime + dur);
  }

  private limited() {
    const c = this.ac();
    if (!c || c.currentTime - this.last < 0.03) return true;
    this.last = c.currentTime;
    return false;
  }

  hit(speed: number) {
    if (this.limited()) return;
    const v = Math.min(1, speed / 3);
    this.burst(0.06, 2600, 0.3 + v * 0.5);
    this.tone(700 + v * 500, 0.06, 0.15 + v * 0.2, "square");
  }

  rail(speed: number) {
    if (this.limited()) return;
    this.tone(420, 0.05, Math.min(0.3, 0.08 + speed * 0.08), "triangle");
  }

  smash() {
    this.burst(0.2, 900, 0.35);
  }

  goal() {
    this.tone(220, 0.7, 0.35, "sawtooth", 0, 0.98);
    this.tone(277, 0.7, 0.25, "sawtooth", 0, 0.98);
    this.burst(1.2, 1500, 0.25);
  }

  win() {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.4, 0.28, "triangle", i * 0.12));
  }

  dispose() {
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
  }
}
