/**
 * Beat Blade music: every song is original, written here as patterns and played by a small WebAudio synth,
 * so there are no audio files to download and nothing to license (CC0, like the rest of the game).
 *
 * A song is a tempo, a key, a chord loop and 16-step patterns per instrument ("x" = hit, "." = rest; for the
 * bass and lead, digits are scale steps: 0 = the chord's root, 2 = its third, 4 = its fifth, 7 = an octave up).
 * Sections set the energy: 0 intro (pad + hats), 1 groove (+ kick, bass), 2 build (+ snare, lead), 3 drop (all).
 * The beat map generator reads the same energy, so busier music means more blocks.
 */

export interface Song {
  id: string;
  name: string;
  bpm: number;
  /** MIDI note of the key's root (57 = A3). */
  root: number;
  scale: "minor" | "major" | "dorian";
  /** Chord roots as scale degrees, one per bar, looping. */
  chords: number[];
  kick: string;
  snare: string;
  hat: string;
  bass: string;
  lead: string;
  sections: Array<{ bars: number; energy: 0 | 1 | 2 | 3 }>;
  /** Lead voice. */
  wave: OscillatorType;
}

const SCALES: Record<Song["scale"], number[]> = {
  minor: [0, 2, 3, 5, 7, 8, 10],
  major: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
};

export type Inst = "kick" | "snare" | "hat" | "bass" | "lead" | "pad";
export interface MusicEvent { t: number; inst: Inst; midi: number; dur: number; vel: number }
export interface Beat { index: number; bar: number; beatInBar: number; energy: number }

export const songBars = (s: Song) => s.sections.reduce((a, x) => a + x.bars, 0);
export const songMs = (s: Song, bars = songBars(s)) => (bars * 4 * 60_000) / s.bpm;

function energyAt(s: Song, bar: number): number {
  let b = bar;
  for (const sec of s.sections) {
    if (b < sec.bars) return sec.energy;
    b -= sec.bars;
  }
  return s.sections[s.sections.length - 1]?.energy ?? 1;
}

/** Every beat of the song (4 per bar) with its energy. `bars` shortens it (quick mode plays the busy middle). */
export function songBeats(s: Song, bars = songBars(s)): Beat[] {
  const skip = bars < songBars(s) ? Math.max(0, Math.floor(songBars(s) / 2) - Math.floor(bars / 2)) : 0;
  const out: Beat[] = [];
  for (let bar = 0; bar < bars; bar++) {
    for (let k = 0; k < 4; k++) out.push({ index: bar * 4 + k, bar, beatInBar: k, energy: energyAt(s, bar + skip) });
  }
  return out;
}

/** scale step (may be > 6 or negative) above a chord degree → MIDI note. */
function note(s: Song, degree: number, step: number, octave = 0): number {
  const sc = SCALES[s.scale];
  const i = degree + step;
  const o = Math.floor(i / 7);
  return s.root + sc[((i % 7) + 7) % 7]! + 12 * (o + octave);
}

/** The whole song as timed events (ms), sorted. Pure: the synth plays it, the tests check it. */
export function expand(s: Song, bars = songBars(s)): MusicEvent[] {
  const step = 60_000 / s.bpm / 4;
  const skip = bars < songBars(s) ? Math.max(0, Math.floor(songBars(s) / 2) - Math.floor(bars / 2)) : 0;
  const ev: MusicEvent[] = [];
  for (let bar = 0; bar < bars; bar++) {
    const e = energyAt(s, bar + skip);
    const deg = s.chords[(bar + skip) % s.chords.length]!;
    const t0 = bar * 16 * step;
    ev.push({ t: t0, inst: "pad", midi: note(s, deg, 0, 0), dur: 16 * step, vel: e === 0 ? 0.9 : 0.55 });
    for (let k = 0; k < 16; k++) {
      const t = t0 + k * step;
      if (s.hat[k] === "x") ev.push({ t, inst: "hat", midi: 0, dur: step, vel: e >= 3 && k % 4 === 2 ? 1 : 0.6 });
      if (e >= 1 && s.kick[k] === "x") ev.push({ t, inst: "kick", midi: 0, dur: step * 2, vel: 1 });
      if (e >= 2 && s.snare[k] === "x") ev.push({ t, inst: "snare", midi: 0, dur: step * 2, vel: 0.9 });
      const b = s.bass[k];
      if (e >= 1 && b && b !== ".") ev.push({ t, inst: "bass", midi: note(s, deg, Number(b), -1), dur: step * 1.6, vel: 0.85 });
      const l = s.lead[k];
      if (e >= 2 && l && l !== "." && (e >= 3 || k < 8)) ev.push({ t, inst: "lead", midi: note(s, deg, Number(l), 1), dur: step * 1.4, vel: e >= 3 ? 0.7 : 0.5 });
    }
  }
  return ev.sort((a, b) => a.t - b.t);
}

const hz = (m: number) => 440 * 2 ** ((m - 69) / 12);

/**
 * Plays a song in time with the game's clock: song time `t` sounds at AudioContext time `anchor + t / 1000`.
 * Events are scheduled a little ahead (`tick()` every frame), and earlier by the speakers' output latency so
 * what you hear lines up with what you see. Pausing suspends the context; resuming re-anchors it.
 */
export class Synth {
  readonly ctx: AudioContext | null;
  private out: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private events: MusicEvent[] = [];
  private next = 0;
  private anchor = 0;
  private song: Song | null = null;

  constructor() {
    let ctx: AudioContext | null = null;
    try {
      ctx = new AudioContext({ latencyHint: "interactive" });
    } catch {
      ctx = null; // no audio: the game still plays, silently
    }
    this.ctx = ctx;
    if (!ctx) return;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    comp.connect(ctx.destination);
    this.out = ctx.createGain();
    this.out.gain.value = 0.55;
    this.out.connect(comp);
    const n = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const d = n.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noise = n;
  }

  /** Seconds the speakers lag behind the context clock. */
  private get latency() {
    const c = this.ctx as (AudioContext & { outputLatency?: number }) | null;
    return (c?.outputLatency || 0) + (c?.baseLatency || 0);
  }

  /** Starts `song` so its time 0 sounds `delayMs` from now. */
  play(song: Song, bars: number, delayMs: number) {
    this.song = song;
    this.events = expand(song, bars);
    this.next = 0;
    this.resumeAt(-delayMs);
  }

  /** Song time `songMs` is now (re-anchor after a pause). */
  resumeAt(songMs: number) {
    if (!this.ctx) return;
    void this.ctx.resume().catch(() => undefined);
    this.anchor = this.ctx.currentTime - songMs / 1000 - this.latency;
  }

  pause() {
    void this.ctx?.suspend().catch(() => undefined);
  }

  stop() {
    this.events = [];
    this.song = null;
  }

  /** Schedules everything due in the next 150 ms of song time. */
  tick(songMs: number) {
    if (!this.ctx || !this.song || this.ctx.state !== "running") return;
    while (this.next < this.events.length && this.events[this.next]!.t < songMs + 150) {
      const e = this.events[this.next++]!;
      const at = this.anchor + e.t / 1000;
      if (at >= this.ctx.currentTime - 0.02) this.voice(e, Math.max(at, this.ctx.currentTime));
    }
  }

  private env(at: number, peak: number, attack: number, release: number) {
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + attack + release);
    g.connect(this.out!);
    return g;
  }

  private osc(type: OscillatorType, f: number, at: number, dur: number, to: AudioNode) {
    const o = this.ctx!.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, at);
    o.connect(to);
    o.start(at);
    o.stop(at + dur + 0.05);
    return o;
  }

  private noiseHit(at: number, dur: number, to: AudioNode, hp: number) {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx!.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = hp;
    src.connect(f).connect(to);
    src.start(at);
    src.stop(at + dur);
  }

  private voice(e: MusicEvent, at: number) {
    const s = e.dur / 1000;
    switch (e.inst) {
      case "kick": {
        const g = this.env(at, 0.9 * e.vel, 0.002, 0.28);
        const o = this.osc("sine", 140, at, 0.3, g);
        o.frequency.exponentialRampToValueAtTime(42, at + 0.12);
        break;
      }
      case "snare":
        this.noiseHit(at, 0.18, this.env(at, 0.45 * e.vel, 0.002, 0.16), 1400);
        this.osc("triangle", 190, at, 0.1, this.env(at, 0.25 * e.vel, 0.002, 0.08));
        break;
      case "hat":
        this.noiseHit(at, 0.06, this.env(at, 0.16 * e.vel, 0.001, 0.045), 7000);
        break;
      case "bass": {
        const f = this.ctx!.createBiquadFilter();
        f.type = "lowpass";
        f.frequency.value = 700;
        f.connect(this.env(at, 0.42 * e.vel, 0.005, s));
        this.osc("sawtooth", hz(e.midi), at, s, f);
        break;
      }
      case "lead":
        this.osc(this.song?.wave ?? "square", hz(e.midi), at, s, this.env(at, 0.16 * e.vel, 0.005, s));
        break;
      case "pad": {
        const f = this.ctx!.createBiquadFilter();
        f.type = "lowpass";
        f.frequency.value = 1100;
        const g = this.ctx!.createGain();
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(0.07 * e.vel, at + s * 0.3);
        g.gain.exponentialRampToValueAtTime(0.0001, at + s);
        g.connect(this.out!);
        f.connect(g);
        for (const [m, det] of [[e.midi, -7], [e.midi + 7, 6], [e.midi + 12, 0]] as const) {
          this.osc("sawtooth", hz(m), at, s, f).detune.value = det;
        }
        break;
      }
    }
  }

  /** A metronome click that SOUNDS `inMs` from now (scheduled ahead, corrected for the speakers' lag). */
  clickAt(inMs: number, accent: boolean) {
    if (!this.ctx || this.ctx.state !== "running") return;
    const at = Math.max(this.ctx.currentTime, this.ctx.currentTime + inMs / 1000 - this.latency);
    this.osc("square", accent ? 1760 : 1320, at, 0.05, this.env(at, 0.18, 0.001, 0.045));
    this.osc("sine", 110, at, 0.08, this.env(at, 0.35, 0.001, 0.07));
  }

  /** Game sounds (cuts, misses, bombs, metronome), right now. */
  sfx(kind: "perfect" | "great" | "good" | "miss" | "bomb" | "wall" | "tick" | "tock" | "move" | "select" | "star") {
    if (!this.ctx || this.ctx.state !== "running") return;
    const at = this.ctx.currentTime;
    if (kind === "perfect" || kind === "great" || kind === "good") {
      this.noiseHit(at, 0.09, this.env(at, kind === "perfect" ? 0.32 : 0.24, 0.002, 0.08), kind === "perfect" ? 3200 : 2200);
      this.osc("sine", kind === "perfect" ? 1320 : 990, at, 0.08, this.env(at, 0.1, 0.002, 0.07));
    } else if (kind === "miss") this.osc("triangle", 110, at, 0.15, this.env(at, 0.2, 0.004, 0.14));
    else if (kind === "bomb" || kind === "wall") {
      this.noiseHit(at, 0.4, this.env(at, 0.5, 0.004, 0.35), 200);
      this.osc("sine", 70, at, 0.35, this.env(at, 0.4, 0.004, 0.3));
    } else if (kind === "tick" || kind === "tock") this.osc("square", kind === "tick" ? 1760 : 880, at, 0.05, this.env(at, 0.15, 0.001, 0.04));
    else if (kind === "move") this.osc("triangle", 660, at, 0.05, this.env(at, 0.1, 0.002, 0.04));
    else if (kind === "select") [660, 990].forEach((f, i) => this.osc("triangle", f, at + i * 0.06, 0.08, this.env(at + i * 0.06, 0.14, 0.002, 0.07)));
    else if (kind === "star") [880, 1320, 1760].forEach((f, i) => this.osc("sine", f, at + i * 0.07, 0.1, this.env(at + i * 0.07, 0.14, 0.002, 0.09)));
  }

  dispose() {
    this.stop();
    void this.ctx?.close().catch(() => undefined);
  }
}
