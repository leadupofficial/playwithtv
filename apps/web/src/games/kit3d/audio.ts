/**
 * kit3d/audio: short sound samples with WebAudio: load once, play many overlapping copies with their own
 * volume and pitch (rising-pitch combos!). A name can map to several files; each play picks one at random,
 * so repeated hits never sound robotic.
 *
 *   const sfx = new SampleBank({ hit: ["/assets/x/hit1.ogg", "/assets/x/hit2.ogg"], go: "/assets/x/go.ogg" });
 *   await sfx.load();
 *   sfx.play("hit", { volume: 0.8, rate: 1 + combo * 0.1 });
 *
 * Browsers start audio suspended until a user gesture; the TV remote's OK press counts. play() resumes the
 * context when it can and otherwise stays silent (never throws).
 */

export interface PlayOpts { volume?: number; rate?: number; /** random ± pitch variation */ jitter?: number; delay?: number }

export class SampleBank {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private buffers = new Map<string, AudioBuffer[]>();
  private seed = 7;

  constructor(private files: Record<string, string | string[]>, public volume = 0.8) {
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.out = this.ctx.createGain();
      this.out.gain.value = volume;
      this.out.connect(this.ctx.destination);
    } catch {
      this.ctx = null;
    }
  }

  /** Fetches and decodes every sample (failures are skipped: a missing sound is not worth a broken game). */
  async load(onProgress?: (p: number) => void): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return;
    const entries = Object.entries(this.files).flatMap(([name, u]) => (Array.isArray(u) ? u : [u]).map((url) => [name, url] as const));
    let done = 0;
    await Promise.all(entries.map(async ([name, url]) => {
      try {
        const data = await (await fetch(url)).arrayBuffer();
        const buf = await ctx.decodeAudioData(data);
        const list = this.buffers.get(name) ?? [];
        list.push(buf);
        this.buffers.set(name, list);
      } catch { /* skipped */ }
      onProgress?.(++done / entries.length);
    }));
  }

  has(name: string) {
    return this.buffers.has(name);
  }

  play(name: string, o: PlayOpts = {}) {
    const ctx = this.ctx, list = this.buffers.get(name);
    if (!ctx || !this.out || !list?.length) return;
    if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
    this.seed = (this.seed * 16807) % 2147483647;
    const r = this.seed / 2147483647;
    const src = ctx.createBufferSource();
    src.buffer = list[Math.floor(r * list.length)]!;
    src.playbackRate.value = Math.max(0.25, (o.rate ?? 1) * (1 + (r - 0.5) * 2 * (o.jitter ?? 0)));
    const g = ctx.createGain();
    g.gain.value = o.volume ?? 1;
    src.connect(g).connect(this.out);
    src.start(ctx.currentTime + (o.delay ?? 0));
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.out) this.out.gain.value = v;
  }

  dispose() {
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
  }
}
