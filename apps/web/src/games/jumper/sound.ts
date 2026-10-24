/** Synthesised sounds for Tilt Jumper Worlds (Web Audio): nothing to license or download. */
export class JumpSfx {
  private ctx: AudioContext | null = null;
  private noise: AudioBuffer | null = null;
  private lastBounce = 0;

  private ac(): AudioContext | null {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
        const len = Math.floor(this.ctx.sampleRate * 0.5);
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

  /** A tone that slides from `f0` to `f1` Hz. */
  private sweep(f0: number, f1: number, dur: number, gain: number, type: OscillatorType = "sine", at = 0) {
    const c = this.ac();
    if (!c) return;
    const o = c.createOscillator();
    const g = c.createGain();
    const t0 = c.currentTime + at;
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(c.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  private hiss(dur: number, freq: number, gain: number) {
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

  /** Each player bounces about once a second; with four players keep it from turning into noise. */
  bounce(pitch = 1) {
    const now = performance.now();
    if (now - this.lastBounce < 70) return;
    this.lastBounce = now;
    this.sweep(220 * pitch, 520 * pitch, 0.14, 0.18, "triangle");
  }
  spring() { this.sweep(180, 1200, 0.35, 0.22, "square"); }
  crumble() { this.hiss(0.3, 500, 0.4); }
  gem() { this.sweep(1320, 1320, 0.08, 0.12, "sine"); this.sweep(1760, 1760, 0.12, 0.12, "sine", 0.07); }
  pickup() { [660, 880, 1100].forEach((f, i) => this.sweep(f, f, 0.1, 0.12, "triangle", i * 0.06)); }
  rocket() { this.hiss(1.6, 900, 0.35); this.sweep(120, 420, 1.2, 0.12, "sawtooth"); }
  shield() { this.sweep(400, 1600, 0.4, 0.14, "sine"); }
  stomp() { this.sweep(300, 90, 0.18, 0.3, "square"); }
  smash() { this.hiss(0.2, 1500, 0.35); this.sweep(800, 200, 0.2, 0.15, "square"); }
  hit() { this.sweep(500, 140, 0.3, 0.25, "sawtooth"); }
  fall() { this.sweep(700, 90, 0.9, 0.2, "triangle"); }
  world() { [523, 659, 784, 1047].forEach((f, i) => this.sweep(f, f, 0.22, 0.14, "triangle", i * 0.11)); }
  tick() { this.sweep(880, 880, 0.08, 0.15, "square"); }
  end() { [784, 659, 523, 1047].forEach((f, i) => this.sweep(f, f, 0.3, 0.15, "triangle", i * 0.16)); }
}
