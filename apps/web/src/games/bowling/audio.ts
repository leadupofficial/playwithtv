/** Synthesised bowling sounds (Web Audio): the ball's rumble, pin clatter, and little fanfares. Nothing to license. */
export class BowlSfx {
  private ctx: AudioContext | null = null;
  private noise: AudioBuffer | null = null;
  private rumble: { gain: GainNode; filter: BiquadFilterNode } | null = null;
  private lastClack = 0;

  private ac(): AudioContext | null {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
        const len = this.ctx.sampleRate * 2;
        this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noise.getChannelData(0);
        let b = 0;
        for (let i = 0; i < len; i++) { b = b * 0.97 + (Math.random() * 2 - 1) * 0.3; d[i] = b; } // brown-ish noise
      } catch {
        return null;
      }
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  private burst(dur: number, freq: number, q: number, gain: number, type: BiquadFilterType = "bandpass", at = 0) {
    const c = this.ac();
    if (!c || !this.noise) return;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    const t0 = c.currentTime + at;
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(f).connect(g).connect(c.destination);
    src.start(t0, Math.random());
    src.stop(t0 + dur);
  }

  private tone(freq: number, dur: number, gain: number, type: OscillatorType = "triangle", at = 0) {
    const c = this.ac();
    if (!c) return;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = c.createGain();
    const t0 = c.currentTime + at;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(c.destination);
    o.start(t0);
    o.stop(t0 + dur);
  }

  /** The ball rolling: 0 = silent, 1 = a fast ball on the boards. */
  roll(level: number) {
    const c = this.ac();
    if (!c || !this.noise) return;
    if (!this.rumble) {
      const src = c.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const filter = c.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 180;
      const gain = c.createGain();
      gain.gain.value = 0;
      src.connect(filter).connect(gain).connect(c.destination);
      src.start();
      this.rumble = { gain, filter };
    }
    this.rumble.gain.gain.setTargetAtTime(Math.max(0, Math.min(1, level)) * 0.9, c.currentTime, 0.08);
    this.rumble.filter.frequency.setTargetAtTime(140 + level * 120, c.currentTime, 0.1);
  }

  /** Pins hitting: a hollow wooden clack, rate-limited so a big crash stays a crash and not a buzz. */
  pin(speed: number, byBall: boolean) {
    const c = this.ac();
    if (!c) return;
    const now = c.currentTime;
    if (now - this.lastClack < 0.025) return;
    this.lastClack = now;
    const v = Math.min(1, speed / 4);
    this.burst(0.09 + v * 0.1, 1400 + Math.random() * 900, 4, 0.25 + v * 0.6);
    this.tone(byBall ? 210 : 320 + Math.random() * 200, 0.08, 0.15 + v * 0.25, "square");
  }

  gutter() {
    this.burst(0.5, 220, 1, 0.5, "lowpass");
  }

  release() {
    this.burst(0.18, 160, 1, 0.7, "lowpass");
  }

  strike() {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.35, 0.28, "triangle", i * 0.09));
    this.burst(1.4, 1800, 0.5, 0.25, "bandpass", 0.1); // the crowd
  }

  spare() {
    [659, 880].forEach((f, i) => this.tone(f, 0.3, 0.25, "triangle", i * 0.1));
  }

  tick() {
    this.tone(880, 0.05, 0.12, "square");
  }

  dispose() {
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.rumble = null;
  }
}
