/** Synthesised sound effects for the grid titles (Web Audio: nothing to download or license). */
export type SfxName =
  | "move" | "turn" | "eat" | "bonus" | "light" | "hit" | "lose" | "win" | "star" | "clear" | "clear4" | "lock"
  | "rotate" | "drop" | "dig" | "flag" | "unflag" | "power" | "warp" | "select" | "back";

export class GridSfx {
  private ctx: AudioContext | null = null;
  muted = false;

  private ac(): AudioContext | null {
    if (this.muted) return null;
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
      } catch {
        return null;
      }
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
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
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(c.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  private noise(dur: number, gain: number, at = 0, hp = 800) {
    const c = this.ac();
    if (!c) return;
    const n = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, n, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = c.createBufferSource();
    s.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = hp;
    const g = c.createGain();
    g.gain.value = gain;
    s.connect(f).connect(g).connect(c.destination);
    s.start(c.currentTime + at);
  }

  play(name: SfxName) {
    switch (name) {
      case "move": return this.tone(520, 0.05, 0.05, "triangle");
      case "turn": return this.tone(660, 0.04, 0.04, "triangle");
      case "select": return this.tone(740, 0.07, 0.08, "triangle");
      case "back": return this.tone(440, 0.09, 0.07, "triangle", 0, 330);
      case "eat": this.tone(880, 0.07, 0.1, "square", 0, 1320); return;
      case "bonus": [988, 1319, 1568].forEach((f, i) => this.tone(f, 0.1, 0.09, "square", i * 0.06)); return;
      case "light": this.tone(587, 0.25, 0.1, "sine"); this.tone(880, 0.35, 0.07, "sine", 0.05); return;
      case "power": this.tone(220, 0.5, 0.12, "sawtooth", 0, 880); return;
      case "warp": this.tone(1200, 0.25, 0.08, "sine", 0, 300); return;
      case "rotate": return this.tone(600, 0.04, 0.06, "square");
      case "lock": return this.noise(0.06, 0.12, 0, 1500);
      case "drop": this.noise(0.12, 0.2, 0, 400); this.tone(110, 0.12, 0.15, "sine"); return;
      case "clear": [523, 659, 784].forEach((f, i) => this.tone(f, 0.12, 0.1, "square", i * 0.05)); return;
      case "clear4": [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.16, 0.11, "square", i * 0.06)); return;
      case "dig": return this.noise(0.08, 0.15, 0, 600);
      case "flag": return this.tone(900, 0.08, 0.09, "triangle", 0, 1200);
      case "unflag": return this.tone(900, 0.08, 0.07, "triangle", 0, 600);
      case "hit": this.noise(0.25, 0.25, 0, 200); this.tone(160, 0.3, 0.2, "sawtooth", 0, 60); return;
      case "lose": [392, 330, 262, 196].forEach((f, i) => this.tone(f, 0.25, 0.12, "triangle", i * 0.18)); return;
      case "win": [523, 659, 784, 1047, 784, 1047].forEach((f, i) => this.tone(f, 0.2, 0.11, "square", i * 0.11)); return;
      case "star": this.tone(1568, 0.3, 0.1, "sine"); this.tone(2093, 0.4, 0.06, "sine", 0.08); return;
    }
  }

  dispose() {
    void this.ctx?.close();
    this.ctx = null;
  }
}
