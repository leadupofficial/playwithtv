/** Motion Sumo sounds, synthesised with Web Audio: drum hits, thumps, whooshes and a crowd. Nothing to license. */
export class SumoSfx {
  private ctx: AudioContext | null = null;
  private noise: AudioBuffer | null = null;

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
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(c.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  private hiss(dur: number, freq: number, gain: number, type: BiquadFilterType = "bandpass", at = 0) {
    const c = this.ac();
    if (!c || !this.noise) return;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = c.createGain();
    const t0 = c.currentTime + at;
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(f).connect(g).connect(c.destination);
    src.start(t0);
    src.stop(t0 + dur);
  }

  /** A big drum: one hit, or a roll before a round. */
  drum(hits = 1) {
    for (let i = 0; i < hits; i++) {
      this.tone(80, 0.35, 0.6, "sine", i * 0.18, 0.5);
      this.hiss(0.08, 400, 0.3, "lowpass", i * 0.18);
    }
  }
  whoosh(weak: boolean) { this.hiss(0.22, weak ? 900 : 1500, weak ? 0.15 : 0.3); }
  slam(braced: boolean) {
    this.tone(braced ? 140 : 95, 0.25, 0.7, "sine", 0, 0.6);
    this.hiss(0.15, braced ? 600 : 350, 0.6, "lowpass");
  }
  bump() { this.tone(160, 0.1, 0.25, "sine", 0, 0.7); }
  out() {
    this.tone(600, 0.6, 0.18, "triangle", 0, 0.3);
    this.hiss(1.4, 1100, 0.3, "bandpass", 0.1); // the crowd
  }
  shrink() { this.tone(110, 0.8, 0.2, "sawtooth", 0, 0.8); }
  gong() {
    this.tone(196, 2.5, 0.35, "sine");
    this.tone(294, 2, 0.15, "sine");
    this.hiss(2, 1200, 0.3, "bandpass", 0.2);
  }

  dispose() {
    try { void this.ctx?.close(); } catch { /* already closed */ }
    this.ctx = null;
  }
}
