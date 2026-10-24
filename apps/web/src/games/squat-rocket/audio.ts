/** Sound effects from Kenney's CC0 Sci-Fi and Interface sound packs, played with Web Audio (silent if unavailable). */
const SOUNDS = {
  pump: "/assets/kenney-interface-sounds/pluck_001.ogg",
  perfect: "/assets/kenney-interface-sounds/confirmation_002.ogg",
  combo: "/assets/kenney-interface-sounds/maximize_006.ogg",
  tick: "/assets/kenney-interface-sounds/tick_002.ogg",
  win: "/assets/kenney-interface-sounds/confirmation_004.ogg",
  slow: "/assets/kenney-interface-sounds/error_004.ogg",
  launch: "/assets/kenney-sci-fi-sounds/spaceEngineLow_001.ogg",
  hit: "/assets/kenney-sci-fi-sounds/explosionCrunch_000.ogg",
  shield: "/assets/kenney-sci-fi-sounds/forceField_000.ogg",
  dodge: "/assets/kenney-sci-fi-sounds/laserSmall_001.ogg",
  storm: "/assets/kenney-sci-fi-sounds/lowFrequency_explosion_000.ogg",
} as const;
export type Sound = keyof typeof SOUNDS;

export class RocketSfx {
  private ctx: AudioContext | null = null;
  private buffers = new Map<Sound, AudioBuffer>();
  private last = new Map<Sound, number>();

  constructor() {
    try {
      this.ctx = new AudioContext();
    } catch {
      return;
    }
    for (const [name, url] of Object.entries(SOUNDS) as Array<[Sound, string]>) {
      fetch(url)
        .then((r) => r.arrayBuffer())
        .then((b) => this.ctx!.decodeAudioData(b))
        .then((buf) => this.buffers.set(name, buf))
        .catch(() => undefined);
    }
  }

  /** Plays a sound (at most every `gap` ms, so four players squatting together don't clip). */
  play(name: Sound, volume = 0.6, rate = 1, gap = 60) {
    const ctx = this.ctx, buf = this.buffers.get(name);
    if (!ctx || !buf) return;
    const now = performance.now();
    if (now - (this.last.get(name) ?? 0) < gap) return;
    this.last.set(name, now);
    if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = volume;
    src.connect(g).connect(ctx.destination);
    src.start();
  }

  dispose() {
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
  }
}
