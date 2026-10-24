/**
 * Emoji Dhamaka sound: CC0 Kenney samples (see ASSETS.md) for stings and voice, plus a drumroll, a reveal
 * "thok" and the heartbeat under the timer synthesised with Web Audio. Everything plays on the TV only.
 */
const SAMPLES = {
  buzz: "/assets/kenney-interface/bong_001.ogg",
  right: "/assets/kenney-interface/confirmation_002.ogg",
  wrong: "/assets/kenney-interface/error_006.ogg",
  tick: "/assets/kenney-interface/tick_001.ogg",
  pop: "/assets/kenney-interface/pluck_001.ogg",
  steal: "/assets/kenney-interface/question_002.ogg",
  select: "/assets/kenney-interface/select_002.ogg",
  shuffle: "/assets/kenney-interface/drop_002.ogg",
  sparkle: "/assets/kenney-interface/glass_001.ogg",
  whoosh: "/assets/kenney-interface/maximize_008.ogg",
  jingleIntro: "/assets/kenney-jingles/jingles_SAX03.ogg",
  jingleBoard: "/assets/kenney-jingles/jingles_HIT00.ogg",
  jingleWin: "/assets/kenney-jingles/jingles_STEEL00.ogg",
  vReady: "/assets/kenney-voiceover/ready.ogg",
  vGo: "/assets/kenney-voiceover/go.ogg",
  vCorrect: "/assets/kenney-voiceover/correct.ogg",
  vWrong: "/assets/kenney-voiceover/wrong.ogg",
  vFinal: "/assets/kenney-voiceover/final_round.ogg",
  vHurry: "/assets/kenney-voiceover/hurry_up.ogg",
  vCongrats: "/assets/kenney-voiceover/congratulations.ogg",
  vTimeOver: "/assets/kenney-voiceover/time_over.ogg",
};
export type Sample = keyof typeof SAMPLES;

export class DhamakaSfx {
  private ctx: AudioContext | null = null;
  private buffers = new Map<Sample, AudioBuffer>();
  private noise: AudioBuffer | null = null;
  private loading = false;
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
    if (this.ctx.state === "suspended") void this.ctx.resume().catch(() => undefined);
    return this.ctx;
  }

  /** Fetches and decodes the samples once (small: about 250 KB in total). */
  load() {
    const c = this.ac();
    if (!c || this.loading) return;
    this.loading = true;
    for (const [k, url] of Object.entries(SAMPLES) as Array<[Sample, string]>) {
      fetch(url)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then((b) => c.decodeAudioData(b))
        .then((buf) => this.buffers.set(k, buf))
        .catch(() => undefined); // a missing sound never breaks the game
    }
  }

  play(name: Sample, gain = 0.7, at = 0) {
    const c = this.ac();
    const buf = this.buffers.get(name);
    if (!c || !buf) return;
    const src = c.createBufferSource();
    src.buffer = buf;
    const g = c.createGain();
    g.gain.value = gain;
    src.connect(g).connect(c.destination);
    src.start(c.currentTime + at);
  }

  private white(c: AudioContext): AudioBuffer {
    if (!this.noise) {
      this.noise = c.createBuffer(1, c.sampleRate, c.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return this.noise;
  }

  /** A snare roll rising for `ms`, ending in a tom hit (the next emoji's reveal). */
  drumroll(ms: number) {
    const c = this.ac();
    if (!c) return;
    const dur = Math.max(0.3, ms / 1000);
    const t0 = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = this.white(c);
    src.loop = true;
    const band = c.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 1800;
    band.Q.value = 0.8;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.12, t0 + dur * 0.9);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    // fast strokes: amplitude modulation at 22 Hz
    const lfo = c.createOscillator();
    lfo.frequency.value = 22;
    const depth = c.createGain();
    depth.gain.value = 0.5;
    const am = c.createGain();
    am.gain.value = 0.5;
    lfo.connect(depth).connect(am.gain);
    src.connect(band).connect(am).connect(g).connect(c.destination);
    src.start(t0);
    lfo.start(t0);
    src.stop(t0 + dur + 0.05);
    lfo.stop(t0 + dur + 0.05);
  }

  /** The emoji landing: a short tom. */
  thok() {
    this.tone(160, 0.22, 0.35, "sine", 0, 70);
    this.play("pop", 0.5);
  }

  /** One heartbeat (lub-dub). */
  heartbeat() {
    this.tone(58, 0.12, 0.5, "sine", 0, 40);
    this.tone(52, 0.14, 0.35, "sine", 0.16, 36);
  }

  private tone(freq: number, dur: number, gain: number, type: OscillatorType, at = 0, slideTo?: number) {
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

  close() {
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
  }
}
