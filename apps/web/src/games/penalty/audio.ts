/** Synthesised stadium sounds (Web Audio): whistle, kick, net, woodwork, crowd. Nothing to download or license. */
export class PenaltySfx {
  private ctx: AudioContext | null = null;
  private noise: AudioBuffer | null = null;

  private ac(): AudioContext | null {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
        const len = this.ctx.sampleRate * 2;
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

  private noiseBurst(dur: number, freq: number, q: number, gain: number, type: BiquadFilterType = "bandpass", attack = 0.01) {
    const c = this.ac();
    if (!c || !this.noise) return;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    const t0 = c.currentTime;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(c.destination);
    src.start();
    src.stop(t0 + dur + 0.05);
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
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(c.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  /** The referee's whistle: a bright warbling tone. */
  whistle(long = false) {
    const c = this.ac();
    if (!c) return;
    const o = c.createOscillator();
    o.frequency.value = 2900;
    const lfo = c.createOscillator();
    lfo.frequency.value = 28;
    const depth = c.createGain();
    depth.gain.value = 120;
    lfo.connect(depth).connect(o.frequency);
    const g = c.createGain();
    const t0 = c.currentTime, dur = long ? 0.9 : 0.35;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.12, t0 + 0.02);
    g.gain.setValueAtTime(0.12, t0 + dur - 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(c.destination);
    o.start(t0);
    lfo.start(t0);
    o.stop(t0 + dur + 0.02);
    lfo.stop(t0 + dur + 0.02);
  }
  kick(power: number) {
    this.tone(95 + power * 40, 0.16, 0.5 + power * 0.3, "sine", 0, 45);
    this.noiseBurst(0.08, 1800, 0.8, 0.4, "lowpass");
  }
  net() {
    this.noiseBurst(0.45, 3200, 0.6, 0.25, "highpass", 0.03);
  }
  woodwork() {
    [880, 1327, 2210].forEach((f, i) => this.tone(f, 0.6 - i * 0.12, 0.16, "triangle"));
  }
  save() {
    this.tone(140, 0.12, 0.45, "sine", 0, 70);
    this.noiseBurst(0.1, 900, 1, 0.3, "lowpass");
  }
  /** The crowd: a roar for a goal, an "ooh" for a near miss or save, a murmur for build-up. */
  crowd(kind: "roar" | "ooh" | "murmur" | "cheer") {
    if (kind === "roar") {
      this.noiseBurst(2.6, 900, 0.35, 0.5, "bandpass", 0.15);
      this.noiseBurst(2.2, 2200, 0.5, 0.18, "bandpass", 0.2);
    } else if (kind === "ooh") {
      this.noiseBurst(1.3, 500, 0.8, 0.35, "bandpass", 0.12);
      this.tone(260, 1, 0.05, "sine", 0.05, 200);
    } else if (kind === "cheer") {
      this.noiseBurst(0.7, 1300, 0.6, 0.18, "bandpass", 0.05);
    } else {
      this.noiseBurst(1.4, 600, 0.5, 0.08, "bandpass", 0.3);
    }
  }
}
