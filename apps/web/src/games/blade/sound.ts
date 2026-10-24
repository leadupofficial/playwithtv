/** Synthesised sounds for Motion Blade Trial (Web Audio): nothing to license or download. */
export class BladeSfx {
  private ctx: AudioContext | null = null;
  private noise: AudioBuffer | null = null;
  private lastSwish = 0;

  private ac(): AudioContext | null {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
        const len = this.ctx.sampleRate;
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

  private hiss(dur: number, f0: number, f1: number, gain: number, type: BiquadFilterType = "bandpass") {
    const c = this.ac();
    if (!c || !this.noise) return;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = type;
    f.Q.value = 1.2;
    f.frequency.setValueAtTime(f0, c.currentTime);
    f.frequency.exponentialRampToValueAtTime(f1, c.currentTime + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(gain, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
    src.connect(f).connect(g).connect(c.destination);
    src.start(0, Math.random() * 0.5);
    src.stop(c.currentTime + dur);
  }

  private tone(f0: number, f1: number, dur: number, gain: number, type: OscillatorType = "sine", at = 0) {
    const c = this.ac();
    if (!c) return;
    const o = c.createOscillator();
    const g = c.createGain();
    const t0 = c.currentTime + at;
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(c.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  swish() {
    const now = performance.now();
    if (now - this.lastSwish < 120) return;
    this.lastSwish = now;
    this.hiss(0.18, 3500, 900, 0.22);
  }
  slice(n = 0) {
    this.hiss(0.09, 5000, 2000, 0.3, "highpass");
    this.tone(500 + n * 90, 260 + n * 40, 0.12, 0.18, "triangle");
  }
  golden() { [784, 988, 1175, 1568].forEach((f, i) => this.tone(f, f, 0.25, 0.14, "sine", i * 0.07)); }
  bomb() {
    this.hiss(0.8, 600, 60, 0.9, "lowpass");
    this.tone(120, 35, 0.7, 0.45, "sine");
  }
  combo(n: number) { for (let i = 0; i < Math.min(n, 6); i++) this.tone(523 * 2 ** (i / 4), 523 * 2 ** (i / 4), 0.14, 0.12, "square", i * 0.06); }
  tick() { this.tone(1000, 1000, 0.07, 0.15, "square"); }
  gong() {
    this.tone(196, 180, 2.2, 0.35, "sine");
    this.tone(392, 380, 1.6, 0.12, "sine");
  }
}
