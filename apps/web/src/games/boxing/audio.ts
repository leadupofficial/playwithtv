/** Synthesised sound effects (Web Audio): nothing to license, nothing to download. */
export class Sfx {
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

  private burst(dur: number, freq: number, q: number, gain: number, type: BiquadFilterType = "lowpass") {
    const c = this.ac();
    if (!c || !this.noise) return;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
    src.connect(f).connect(g).connect(c.destination);
    src.start();
    src.stop(c.currentTime + dur);
  }

  private tone(freq: number, dur: number, gain: number, type: OscillatorType = "sine", at = 0) {
    const c = this.ac();
    if (!c) return;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = c.createGain();
    const t0 = c.currentTime + at;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(c.destination);
    o.start(t0);
    o.stop(t0 + dur);
  }

  punch(heavy: boolean) {
    this.burst(heavy ? 0.28 : 0.14, heavy ? 420 : 900, 1.2, heavy ? 1.2 : 0.7);
    this.tone(heavy ? 70 : 110, heavy ? 0.25 : 0.12, heavy ? 0.6 : 0.35, "sine");
  }
  block() {
    this.burst(0.1, 300, 2, 0.5);
  }
  whiff() {
    this.burst(0.18, 2500, 0.8, 0.25, "bandpass");
  }
  bell(times = 1) {
    for (let i = 0; i < times; i++) {
      this.tone(1180, 0.9, 0.3, "sine", i * 0.35);
      this.tone(2360, 0.5, 0.12, "sine", i * 0.35);
    }
  }
  tick() {
    this.tone(660, 0.12, 0.25, "square");
  }
  crowd(dur = 1.6) {
    this.burst(dur, 1200, 0.4, 0.35, "bandpass");
  }
}
