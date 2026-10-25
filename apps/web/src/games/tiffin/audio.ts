/**
 * Tiffin Tornado sound: Kenney CC0 samples for the clicks, clatters and dings, plus sounds synthesised in code
 * (original): the sizzle of the tava and kadai, the rails' clickety-clack and rumble, the train's two-tone horn and
 * a brass serving bell.
 */
import { SampleBank } from "../kit3d/audio";

const K = "/assets/kenney-audio";

export class TiffinAudio {
  readonly samples = new SampleBank({
    pick: `${K}/pluck_001.ogg`, place: `${K}/drop_002.ogg`, chop: `${K}/impactWood_heavy_000.ogg`, grind: `${K}/scratch_002.ogg`,
    crash: [`${K}/impactPunch_heavy_000.ogg`, `${K}/impactPunch_heavy_001.ogg`], dash: [`${K}/cloth1.ogg`, `${K}/cloth2.ogg`],
    tick: `${K}/tick_002.ogg`, glass: `${K}/glass_002.ogg`, wrong: `${K}/bong_001.ogg`, ticket: `${K}/maximize_006.ogg`,
    go: `${K}/vo_go.ogg`, n1: `${K}/vo_1.ogg`, n2: `${K}/vo_2.ogg`, n3: `${K}/vo_3.ogg`, timeover: `${K}/vo_time_over.ogg`,
    congrats: `${K}/vo_congratulations.ogg`, final: `${K}/vo_final_round.ogg`, soft: [`${K}/impactSoft_medium_000.ogg`, `${K}/impactSoft_medium_001.ogg`],
  }, 0.7);
  private ctx: AudioContext | null;
  private out: GainNode | null = null;
  private sizzle: GainNode | null = null;
  private rumble: GainNode | null = null;
  private clack = 0;

  constructor() {
    this.ctx = (this.samples as unknown as { ctx: AudioContext | null }).ctx;
    const ctx = this.ctx;
    if (!ctx) return;
    this.out = ctx.createGain();
    this.out.gain.value = 0.55;
    this.out.connect(ctx.destination);
    const noise = (seconds: number, brown = false) => {
      const b = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
      const d = b.getChannelData(0);
      let last = 0;
      for (let i = 0; i < d.length; i++) {
        const w = Math.random() * 2 - 1;
        last = brown ? (last + 0.02 * w) / 1.02 : w;
        d[i] = brown ? last * 3.5 : w;
      }
      const s = ctx.createBufferSource();
      s.buffer = b;
      s.loop = true;
      return s;
    };
    // sizzle: crackly band-passed noise, amplitude-modulated
    const sz = noise(2);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 5200;
    bp.Q.value = 0.7;
    this.sizzle = ctx.createGain();
    this.sizzle.gain.value = 0;
    sz.connect(bp).connect(this.sizzle).connect(this.out);
    sz.start();
    // rail rumble: brown noise, low-passed
    const rb = noise(3, true);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 160;
    this.rumble = ctx.createGain();
    this.rumble.gain.value = 0;
    rb.connect(lp).connect(this.rumble).connect(this.out);
    rb.start();
  }

  load() {
    return this.samples.load();
  }

  play(name: string, volume = 1, rate = 1) {
    this.samples.play(name, { volume, rate, jitter: 0.06 });
  }

  /** Every frame: how many things sizzle, how fast the train runs. */
  update(dt: number, sizzling: number, speed: number) {
    const ctx = this.ctx;
    if (!ctx || !this.sizzle || !this.rumble) return;
    if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
    const t = ctx.currentTime;
    this.sizzle.gain.setTargetAtTime(Math.min(0.22, sizzling * 0.08), t, 0.15);
    this.rumble.gain.setTargetAtTime(0.25 * speed, t, 0.3);
    // clickety-clack: two quick knocks per rail joint
    if (speed > 0.05) {
      this.clack -= dt * (0.6 + speed * 1.8);
      if (this.clack <= 0) {
        this.clack = 1;
        this.knock(t, 0.18 * speed);
        this.knock(t + 0.11, 0.14 * speed);
      }
    }
  }

  private knock(at: number, vol: number) {
    const ctx = this.ctx!, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "triangle";
    o.frequency.setValueAtTime(120, at);
    o.frequency.exponentialRampToValueAtTime(55, at + 0.08);
    g.gain.setValueAtTime(vol, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + 0.1);
    o.connect(g).connect(this.out!);
    o.start(at);
    o.stop(at + 0.12);
  }

  /** The train's two-tone horn. */
  horn(seconds = 1.1) {
    const ctx = this.ctx;
    if (!ctx || !this.out) return;
    const t = ctx.currentTime;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 1400;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.16, t + 0.08);
    g.gain.setValueAtTime(0.16, t + seconds - 0.2);
    g.gain.linearRampToValueAtTime(0, t + seconds);
    lp.connect(g).connect(this.out);
    for (const f of [311, 392, 466]) {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = f;
      o.connect(lp);
      o.start(t);
      o.stop(t + seconds);
    }
  }

  /** A brass serving bell: ding! */
  bell() {
    const ctx = this.ctx;
    if (!ctx || !this.out) return;
    const t = ctx.currentTime;
    for (const [f, v] of [[1568, 0.18], [3136, 0.06], [2350, 0.05]] as const) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(v, t);
      g.gain.exponentialRampToValueAtTime(0.0005, t + 1.4);
      o.connect(g).connect(this.out);
      o.start(t);
      o.stop(t + 1.5);
    }
  }

  dispose() {
    this.samples.dispose();
  }
}
