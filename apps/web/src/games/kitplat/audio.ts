/**
 * kitplat/audio: the platformer's sounds. Kenney CC0 samples (stomps, hits, voice, jingles) through kit3d's
 * SampleBank, plus small synthesised blips (jump, gem, spring boing, power-up arpeggio, fanfares) so every
 * game sounds lively without shipping more files. Silent (never throws) when audio is unavailable.
 */
import { SampleBank } from "../kit3d/audio";

const A = "/assets/kenney-audio/";
const J = "/assets/kenney-jingles/";

export class PlatAudio {
  readonly bank = new SampleBank({
    stomp: [`${A}impactSoft_heavy_000.ogg`, `${A}impactSoft_heavy_001.ogg`, `${A}impactSoft_heavy_002.ogg`],
    hurt: [`${A}impactPunch_heavy_000.ogg`, `${A}impactPunch_heavy_001.ogg`],
    land: [`${A}impactSoft_medium_000.ogg`, `${A}impactSoft_medium_001.ogg`],
    crate: [`${A}impactWood_heavy_000.ogg`],
    cloth: [`${A}cloth1.ogg`, `${A}cloth2.ogg`, `${A}cloth3.ogg`],
    bong: `${A}bong_001.ogg`, pluck: [`${A}pluck_001.ogg`, `${A}pluck_002.ogg`], glass: `${A}glass_002.ogg`, drop: `${A}drop_002.ogg`,
    confirm: `${A}confirmation_001.ogg`, max: `${A}maximize_006.ogg`, min: `${A}minimize_006.ogg`, tick: `${A}tick_002.ogg`,
    go: `${A}vo_go.ogg`, v3: `${A}vo_3.ogg`, v2: `${A}vo_2.ogg`, v1: `${A}vo_1.ogg`, win: `${A}vo_you_win.ogg`, congrats: `${A}vo_congratulations.ogg`,
    timeover: `${A}vo_time_over.ogg`, clear: `${J}jingles_SAX03.ogg`, goal: `${J}jingles_HIT00.ogg`, boss: `${J}jingles_STEEL00.ogg`,
  }, 0.8);
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;

  constructor() {
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AC) {
        this.ctx = new AC();
        this.out = this.ctx.createGain();
        this.out.gain.value = 0.22;
        this.out.connect(this.ctx.destination);
      }
    } catch { this.ctx = null; }
  }

  load() {
    return this.bank.load();
  }

  play(name: string, volume = 0.8, rate = 1) {
    this.bank.play(name, { volume, rate, jitter: 0.05 });
  }

  /** A short synthesised tone sweep: type, start/end frequency, duration, volume, delay. */
  tone(type: OscillatorType, f0: number, f1: number, dur: number, vol = 1, delay = 0) {
    const ctx = this.ctx, out = this.out;
    if (!ctx || !out) return;
    if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  jump() { this.tone("square", 260, 620, 0.12, 0.35); }
  airJump() { this.tone("square", 420, 900, 0.12, 0.3); }
  gem(n = 0) { const f = 980 * Math.pow(1.06, n % 8); this.tone("triangle", f, f, 0.07, 0.5); this.tone("triangle", f * 1.5, f * 1.5, 0.12, 0.4, 0.06); }
  bigGem() { [0, 4, 7, 12].forEach((s, i) => this.tone("triangle", 660 * Math.pow(2, s / 12), 660 * Math.pow(2, s / 12), 0.12, 0.45, i * 0.05)); }
  spring() { this.tone("sine", 180, 900, 0.35, 0.8); }
  boost() { this.tone("sawtooth", 200, 1200, 0.3, 0.25); }
  power() { [0, 4, 7, 12, 16].forEach((s, i) => this.tone("square", 523 * Math.pow(2, s / 12), 523 * Math.pow(2, s / 12), 0.1, 0.3, i * 0.06)); }
  powerLost() { this.tone("square", 700, 200, 0.3, 0.25); }
  bubble() { this.tone("sine", 600, 300, 0.25, 0.5); }
  pop() { this.tone("sine", 300, 1200, 0.12, 0.6); }
  checkpoint() { [0, 7, 12].forEach((s, i) => this.tone("triangle", 587 * Math.pow(2, s / 12), 587 * Math.pow(2, s / 12), 0.16, 0.5, i * 0.09)); }
  fanfare() { [0, 4, 7, 12, 7, 12, 16].forEach((s, i) => this.tone("square", 392 * Math.pow(2, s / 12), 392 * Math.pow(2, s / 12), 0.16, 0.28, i * 0.11)); }
  lever() { this.tone("square", 140, 90, 0.2, 0.5); this.play("tick", 0.6); }
  throw_() { this.tone("triangle", 500, 1500, 0.1, 0.35); }

  dispose() {
    void this.ctx?.close().catch(() => undefined);
  }
}
