/**
 * "Move the phone into a target orientation and hold": picks the zone a value falls in, and reports a
 * selection only after it stayed in the same zone for `holdMs` (so sweeping past an answer never selects it).
 */
export function zoneOf(value: number, zones: number): number {
  const x = Math.max(-1, Math.min(0.9999, value));
  return Math.floor(((x + 1) / 2) * zones);
}

export class HoldTimer {
  private zone = -1;
  private since = 0;
  private fired = false;
  constructor(public holdMs = 900) {}

  /** Feed the current zone; returns the zone once when it has been held long enough. */
  update(zone: number, now: number): number | null {
    if (zone !== this.zone) {
      this.zone = zone;
      this.since = now;
      this.fired = false;
      return null;
    }
    if (!this.fired && zone >= 0 && now - this.since >= this.holdMs) {
      this.fired = true;
      return zone;
    }
    return null;
  }

  /** 0…1 progress of the current hold, for a filling ring on the TV. */
  progress(now: number): number {
    return this.fired || this.zone < 0 ? 0 : Math.min(1, (now - this.since) / this.holdMs);
  }

  reset() {
    this.zone = -1;
    this.fired = false;
  }
}
