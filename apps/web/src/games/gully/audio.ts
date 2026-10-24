/**
 * Gully sounds: Kenney CC0 samples already in the repo (bat thock, bounces, bricks, glass, whooshes, jingles,
 * the announcer) plus a synthesised crowd roar (filtered noise swell) for the balconies.
 */
import { SampleBank } from "../kit3d/audio";
import type { GameEvent } from "./sim/game";

const A = "/assets/kenney-audio";
const FILES: Record<string, string | string[]> = {
  bat: `${A}/impactWood_heavy_000.ogg`,
  bounce: [`${A}/impactSoft_medium_000.ogg`, `${A}/impactSoft_medium_001.ogg`, `${A}/impactSoft_medium_002.ogg`],
  thud: [`${A}/impactSoft_heavy_000.ogg`, `${A}/impactSoft_heavy_001.ogg`],
  bricks: [`${A}/impactPunch_heavy_000.ogg`, `${A}/impactPunch_heavy_001.ogg`, `${A}/impactPunch_heavy_002.ogg`],
  glass: `${A}/glass_002.ogg`,
  swish: [`${A}/cloth1.ogg`, `${A}/cloth2.ogg`, `${A}/cloth3.ogg`, `${A}/cloth4.ogg`],
  tick: `${A}/tick_002.ogg`,
  pluck: [`${A}/pluck_001.ogg`, `${A}/pluck_002.ogg`],
  six: "/assets/kenney-jingles/jingles_HIT00.ogg",
  win: "/assets/kenney-jingles/jingles_SAX03.ogg",
  go: `${A}/vo_go.ogg`,
  final: `${A}/vo_final_round.ogg`,
  congrats: `${A}/vo_congratulations.ogg`,
};

export class GullySound {
  readonly bank = new SampleBank(FILES, 0.8);
  private noise: AudioBuffer | null = null;

  load() {
    return this.bank.load();
  }

  /** A crowd roar from the houses: band-passed noise swelling and fading (strength 0..1). */
  roar(strength = 1) {
    const ctx = (this.bank as unknown as { ctx: AudioContext | null }).ctx;
    if (!ctx) return;
    try {
      if (!this.noise) {
        this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 900;
      bp.Q.value = 0.6;
      const g = ctx.createGain();
      const t = ctx.currentTime;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.22 * strength, t + 0.25);
      g.gain.exponentialRampToValueAtTime(0.001, t + 1.9);
      src.connect(bp).connect(g).connect(ctx.destination);
      src.start(t);
      src.stop(t + 2);
    } catch { /* audio is a bonus */ }
  }

  handle(events: GameEvent[]) {
    const s = this.bank;
    for (const e of events) {
      if (e.kind === "release") s.play("swish", { volume: 0.4, rate: 1.2 });
      if (e.kind === "pitch") s.play("bounce", { volume: 0.5 });
      if (e.kind === "swing" && !e.contact) s.play("swish", { volume: 0.7 });
      if (e.kind === "hit") s.play("bat", { volume: e.shot.defended ? 0.4 : 1, rate: e.shot.timing === "perfect" ? 1 : 1.15, jitter: 0.05 });
      if (e.kind === "stumps") s.play("bricks", { volume: 1 });
      if (e.kind === "play") {
        if (e.ev.kind === "bounce") s.play("bounce", { volume: 0.35, jitter: 0.1 });
        if (e.ev.kind === "wall") s.play("thud", { volume: 0.5 });
        if (e.ev.kind === "window") s.play("glass", { volume: 1 });
        if (e.ev.kind === "catch") s.play("pluck", { volume: 0.8 });
      }
      if (e.kind === "result") {
        const big = ["six", "roof", "window"].includes(e.moment);
        if (big) {
          s.play("six", { volume: 0.7 });
          this.roar(1);
        } else if (["four", "bowled", "caught", "one-bounce", "caught-behind", "runout", "bowlout-hit"].includes(e.moment)) this.roar(0.7);
      }
      if (e.kind === "innings") s.play("go", { volume: 0.8, delay: 0.6 });
      if (e.kind === "over") {
        s.play("win", { volume: 0.8 });
        s.play("congrats", { volume: 0.9, delay: 1.5 });
        this.roar(1);
      }
    }
  }

  dispose() {
    this.bank.dispose();
  }
}
