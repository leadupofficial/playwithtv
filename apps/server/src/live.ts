/**
 * Live usage for the admin console: a rolling hour of "who is online" samples and today's peak.
 * Each sample is the highest count seen in its bucket (so short spikes are not lost between polls). The day's
 * peak is saved through `save` whenever it rises, so it survives restarts and fills the daily history.
 */
export interface LiveCounts {
  tvs: number;     // TVs with an open connection
  phones: number;  // phones with an open connection
  rooms: number;   // rooms alive on this hub
  playing: number; // rooms in a game (playing or paused)
}
export interface LiveSample extends LiveCounts { t: number }
export interface DayPeak { day: string; tvs: number; phones: number; rooms: number }

/** Calendar day in India time, matching the daily history and the sponsor counts. */
export function istDay(now = Date.now()): string {
  return new Date(now + 5.5 * 3600_000).toISOString().slice(0, 10);
}

export class LiveTracker {
  private history: LiveSample[] = [];
  private bucket: LiveSample | null = null;
  private today: DayPeak;

  constructor(
    private read: () => LiveCounts,
    private save: (p: DayPeak) => Promise<void>,
    private opts: { bucketMs: number; keepMs: number } = { bucketMs: 30_000, keepMs: 60 * 60_000 },
    now = Date.now(),
  ) {
    this.today = { day: istDay(now), tvs: 0, phones: 0, rooms: 0 };
  }

  /** Merges a peak loaded from storage at startup (only if it is for the current day). */
  seed(p: DayPeak | null) {
    if (!p || p.day !== this.today.day) return;
    this.today = { day: p.day, tvs: Math.max(p.tvs, this.today.tvs), phones: Math.max(p.phones, this.today.phones), rooms: Math.max(p.rooms, this.today.rooms) };
  }

  /** Takes one reading. Call often (every couple of seconds); cheap. */
  observe(now = Date.now()): LiveCounts {
    const c = this.read();
    const start = now - (now % this.opts.bucketMs);
    if (!this.bucket || this.bucket.t !== start) {
      if (this.bucket) this.history.push(this.bucket);
      this.bucket = { t: start, ...c };
      const oldest = now - this.opts.keepMs;
      while (this.history.length && this.history[0]!.t < oldest) this.history.shift();
    } else {
      for (const k of ["tvs", "phones", "rooms", "playing"] as const) this.bucket[k] = Math.max(this.bucket[k], c[k]);
    }
    const day = istDay(now);
    if (day !== this.today.day) this.today = { day, tvs: 0, phones: 0, rooms: 0 };
    if (c.tvs > this.today.tvs || c.phones > this.today.phones || c.rooms > this.today.rooms) {
      this.today = { day, tvs: Math.max(c.tvs, this.today.tvs), phones: Math.max(c.phones, this.today.phones), rooms: Math.max(c.rooms, this.today.rooms) };
      void this.save({ ...this.today }).catch(() => undefined);
    }
    return c;
  }

  snapshot(now = Date.now()) {
    const current = this.observe(now);
    return { current, history: [...this.history, ...(this.bucket ? [this.bucket] : [])], peakToday: { ...this.today } };
  }
}
