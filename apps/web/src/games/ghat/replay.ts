/**
 * The finish-line replay: a rolling recording of the last few seconds (racers, traffic, goats at 30 Hz, no
 * allocation per frame) and, for the race's biggest takedown, a saved clip from 2.5 s before the hit to 2 s
 * after. The TV plays it back in slow motion before the podium. Pure.
 */

export const RATE = 30;
const BEFORE = 2.5, AFTER = 2.0;
const KEEP = Math.ceil((BEFORE + AFTER + 1) * RATE);
export const RACER_F = 8; // s, d, a, slip, y, wreckT, spinT, boosting
export const TRAFFIC_F = 2; // s, d
export const GOAT_F = 3; // s, d, bumped
export const MAX_GOATS = 8;

export interface Snapshot {
  racers: Array<{ s: number; d: number; a: number; slip: number; y: number; wreckT: number; spinT: number; boostT: number; turboT: number }>;
  traffic: Array<{ s: number; d: number }>;
  goats: Array<{ s: number; d: number; bumped: number }>;
}

export interface Clip {
  victim: string;
  by: string;
  impact: number;
  /** Index (into frames) of the moment of impact. */
  hit: number;
  frames: Float32Array[];
}

export class Recorder {
  private ring: Float32Array[] = [];
  private head = 0;
  private count = 0;
  private acc = 0;
  private pending: { victim: string; by: string; impact: number; startCount: number; hitCount: number } | null = null;
  best: Clip | null = null;
  readonly frameSize: number;

  constructor(readonly racers: number, readonly traffic: number) {
    this.frameSize = racers * RACER_F + traffic * TRAFFIC_F + MAX_GOATS * GOAT_F;
    for (let i = 0; i < KEEP; i++) this.ring.push(new Float32Array(this.frameSize));
  }

  /** Call every simulation step; records at RATE. */
  record(snap: Snapshot, dt: number) {
    this.acc += dt;
    if (this.acc < 1 / RATE) return;
    this.acc -= 1 / RATE;
    const f = this.ring[this.head]!;
    let o = 0;
    for (const r of snap.racers) {
      f[o++] = r.s; f[o++] = r.d; f[o++] = r.a; f[o++] = r.slip; f[o++] = r.y; f[o++] = r.wreckT; f[o++] = r.spinT;
      f[o++] = r.boostT > 0 || r.turboT > 0 ? 1 : 0;
    }
    for (const c of snap.traffic) {
      f[o++] = c.s; f[o++] = c.d;
    }
    for (let i = 0; i < MAX_GOATS; i++) {
      const g = snap.goats[i];
      f[o++] = g ? g.s : NaN; f[o++] = g ? g.d : NaN; f[o++] = g ? g.bumped : 0;
    }
    this.head = (this.head + 1) % KEEP;
    this.count++;
    const p = this.pending;
    if (p && this.count - p.hitCount >= AFTER * RATE) {
      const n = this.count - p.startCount;
      const frames: Float32Array[] = [];
      for (let k = n; k > 0; k--) frames.push(Float32Array.from(this.ring[(this.head - k + KEEP * 2) % KEEP]!));
      this.best = { victim: p.victim, by: p.by, impact: p.impact, hit: p.hitCount - p.startCount, frames };
      this.pending = null;
    }
  }

  /** A takedown happened now: keep it if it is the biggest so far (and none is being captured). */
  takedown(victim: string, by: string, impact: number) {
    if (this.pending) return;
    if (this.best && this.best.impact >= impact) return;
    const back = Math.min(this.count, Math.floor(BEFORE * RATE));
    this.pending = { victim, by, impact, startCount: this.count - back, hitCount: this.count };
  }

  /** True while a clip is still being captured (the race waits for it before the replay). */
  get capturing() {
    return this.pending !== null;
  }
}

/** Reads racer i of a recorded frame. */
export function racerAt(f: Float32Array, i: number) {
  const o = i * RACER_F;
  return { s: f[o]!, d: f[o + 1]!, a: f[o + 2]!, slip: f[o + 3]!, y: f[o + 4]!, wreckT: f[o + 5]!, spinT: f[o + 6]!, boosting: f[o + 7]! > 0 };
}

export function trafficAt(f: Float32Array, racers: number, i: number) {
  const o = racers * RACER_F + i * TRAFFIC_F;
  return { s: f[o]!, d: f[o + 1]! };
}

export function goatAt(f: Float32Array, racers: number, traffic: number, i: number) {
  const o = racers * RACER_F + traffic * TRAFFIC_F + i * GOAT_F;
  return Number.isNaN(f[o]!) ? null : { s: f[o]!, d: f[o + 1]!, bumped: f[o + 2]! };
}
