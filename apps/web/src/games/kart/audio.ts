/** Kart Knockout sounds, synthesised with Web Audio (nothing to license or download). */
export class KartSfx {
  private ctx: AudioContext | null = null;
  private noise: AudioBuffer | null = null;
  private engine: { osc: OscillatorNode; gain: GainNode } | null = null;

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

  private tone(freq: number, dur: number, gain: number, type: OscillatorType = "sine", at = 0, slide = 1) {
    const c = this.ac();
    if (!c) return;
    const o = c.createOscillator();
    o.type = type;
    const t0 = c.currentTime + at;
    o.frequency.setValueAtTime(freq, t0);
    if (slide !== 1) o.frequency.exponentialRampToValueAtTime(freq * slide, t0 + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(c.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  private hiss(dur: number, freq: number, gain: number, type: BiquadFilterType = "bandpass") {
    const c = this.ac();
    if (!c || !this.noise) return;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
    src.connect(f).connect(g).connect(c.destination);
    src.start();
    src.stop(c.currentTime + dur);
  }

  /** A soft shared engine drone whose pitch follows the human karts' average speed (0..1). */
  hum(speed: number) {
    const c = this.ac();
    if (!c) return;
    if (!this.engine) {
      const osc = c.createOscillator();
      osc.type = "sawtooth";
      const lp = c.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 500;
      const gain = c.createGain();
      gain.gain.value = 0;
      osc.connect(lp).connect(gain).connect(c.destination);
      osc.start();
      this.engine = { osc, gain };
    }
    this.engine.osc.frequency.setTargetAtTime(55 + speed * 85, c.currentTime, 0.1);
    this.engine.gain.gain.setTargetAtTime(speed > 0.02 ? 0.035 + speed * 0.03 : 0, c.currentTime, 0.2);
  }

  beep(high: boolean) { this.tone(high ? 880 : 440, high ? 0.5 : 0.25, 0.25, "square"); }
  pickup() { [660, 880, 1100].forEach((f, i) => this.tone(f, 0.12, 0.14, "triangle", i * 0.06)); }
  boost() { this.hiss(0.5, 1800, 0.35); this.tone(300, 0.4, 0.12, "sawtooth", 0, 2.2); }
  spark(tier: number) { this.tone(tier === 2 ? 1400 : 1000, 0.15, 0.12, "triangle"); this.boost(); }
  hop() { this.tone(500, 0.08, 0.08, "sine", 0, 1.6); }
  spin() { this.tone(900, 0.7, 0.18, "triangle", 0, 0.25); }
  bump(hard: boolean) { this.hiss(0.12, hard ? 250 : 400, hard ? 0.7 : 0.35, "lowpass"); this.tone(hard ? 90 : 130, 0.12, 0.3); }
  wall() { this.hiss(0.1, 200, 0.4, "lowpass"); }
  use() { this.tone(520, 0.1, 0.12, "square", 0, 0.7); }
  shield() { this.tone(440, 0.3, 0.14, "sine", 0, 2); }
  lap(final: boolean) {
    this.tone(1046, 0.25, 0.2, "triangle");
    if (final) this.tone(1318, 0.4, 0.2, "triangle", 0.15);
  }
  fanfare() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.35, 0.18, "triangle", i * 0.13)); }

  dispose() {
    try {
      this.engine?.osc.stop();
      void this.ctx?.close();
    } catch {
      /* already closed */
    }
    this.engine = null;
    this.ctx = null;
  }
}
