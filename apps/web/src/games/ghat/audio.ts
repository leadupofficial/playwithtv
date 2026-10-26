/**
 * GHAT RUSH sound: Kenney CC0 samples (impacts, countdown voice, UI blips) plus sounds synthesised live with
 * WebAudio: one engine note per player (pitch follows speed, a growl on boost), steady monsoon rain, thunder,
 * and the goat-horn's "BAAA". Silent (never throws) where audio is unavailable.
 */
import { SampleBank } from "../kit3d/audio";

const A = "/assets/kenney-audio";

export class GhatAudio {
  readonly sfx = new SampleBank({
    crash: [`${A}/impactPunch_heavy_000.ogg`, `${A}/impactPunch_heavy_001.ogg`, `${A}/impactPunch_heavy_002.ogg`],
    bump: [`${A}/impactSoft_heavy_000.ogg`, `${A}/impactSoft_heavy_001.ogg`, `${A}/impactSoft_heavy_002.ogg`],
    scrape: [`${A}/scratch_002.ogg`],
    pickup: [`${A}/confirmation_001.ogg`],
    item: [`${A}/drop_002.ogg`],
    tick: [`${A}/tick_002.ogg`],
    boost: [`${A}/maximize_006.ogg`],
    splash: [`${A}/cloth1.ogg`, `${A}/cloth2.ogg`],
    v1: `${A}/vo_1.ogg`, v2: `${A}/vo_2.ogg`, v3: `${A}/vo_3.ogg`, go: `${A}/vo_go.ogg`, win: `${A}/vo_congratulations.ogg`,
  }, 0.75);
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private engines: Array<{ osc: OscillatorNode; sub: OscillatorNode; gain: GainNode; filter: BiquadFilterNode }> = [];
  private rainGain: GainNode | null = null;

  constructor(players: number, opts: { rain?: boolean } = {}) {
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      const ctx = (this.ctx = new AC());
      this.master = ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(ctx.destination);
      for (let i = 0; i < Math.min(4, players); i++) {
        const osc = ctx.createOscillator(), sub = ctx.createOscillator(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
        osc.type = "sawtooth";
        sub.type = "square";
        filter.type = "lowpass";
        filter.frequency.value = 700;
        gain.gain.value = 0;
        osc.connect(filter);
        sub.connect(filter);
        filter.connect(gain);
        gain.connect(this.master);
        osc.start();
        sub.start();
        this.engines.push({ osc, sub, gain, filter });
      }
      // rain: looping filtered noise
      const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 2400;
      bp.Q.value = 0.5;
      this.rainGain = ctx.createGain();
      this.rainGain.gain.value = opts.rain === false ? 0 : 0.06;
      src.connect(bp);
      bp.connect(this.rainGain);
      this.rainGain.connect(this.master);
      src.start();
    } catch {
      this.ctx = null;
    }
  }

  async load() {
    await this.sfx.load().catch(() => undefined);
  }

  private resume() {
    if (this.ctx?.state === "suspended") void this.ctx.resume().catch(() => undefined);
  }

  /** Engine note per player: speed 0..1, boosting adds growl; split screens share the mix. */
  engine(i: number, speed: number, boosting: boolean, on: boolean) {
    const e = this.engines[i];
    if (!e || !this.ctx) return;
    this.resume();
    const t = this.ctx.currentTime;
    const f = 50 + speed * 230 + (boosting ? 45 : 0);
    e.osc.frequency.setTargetAtTime(f, t, 0.05);
    e.sub.frequency.setTargetAtTime(f / 2, t, 0.05);
    e.filter.frequency.setTargetAtTime(500 + speed * 1400 + (boosting ? 900 : 0), t, 0.08);
    e.gain.gain.setTargetAtTime(on ? (0.07 + speed * 0.1) / Math.max(1, this.engines.length * 0.7) : 0, t, 0.1);
  }

  thunder() {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    this.resume();
    const len = ctx.sampleRate * 2.5, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.5 * Math.pow(1 - i / len, 2);
    }
    const src = ctx.createBufferSource(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = buf;
    lp.type = "lowpass";
    lp.frequency.value = 300;
    g.gain.value = 0.9;
    src.connect(lp);
    lp.connect(g);
    g.connect(this.master);
    src.start(ctx.currentTime + 0.25);
  }

  /** The goat-horn: a bleating two-tone honk. */
  horn() {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    this.resume();
    const t = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.25, t + 0.04);
    g.gain.setValueAtTime(0.25, t + 0.7);
    g.gain.linearRampToValueAtTime(0, t + 0.9);
    g.connect(this.master);
    for (const [f, type] of [[392, "sawtooth"], [466, "square"]] as const) {
      const o = ctx.createOscillator(), lfo = ctx.createOscillator(), lg = ctx.createGain();
      o.type = type;
      o.frequency.value = f;
      lfo.frequency.value = 9; // the bleat
      lg.gain.value = 18;
      lfo.connect(lg);
      lg.connect(o.frequency);
      o.connect(g);
      o.start(t);
      lfo.start(t);
      o.stop(t + 0.95);
      lfo.stop(t + 0.95);
    }
  }

  play(name: string, volume = 1, rate = 1) {
    this.resume();
    this.sfx.play(name, { volume, rate, jitter: 0.06 });
  }

  dispose() {
    void this.ctx?.close().catch(() => undefined);
  }
}
