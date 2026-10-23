import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I/L

/** Unguessable opaque token (192 bits). */
export function token(): string {
  return randomBytes(24).toString("base64url");
}

/** Short human-typable join code; uniqueness among live rooms is the caller's job. */
export function joinCode(): string {
  let s = "";
  for (let i = 0; i < 4; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return s;
}

export function sameToken(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Token bucket: `rate` tokens per second, bursting up to `burst`. */
export class Bucket {
  private tokens: number;
  private last = Date.now();
  constructor(private rate: number, private burst: number) {
    this.tokens = burst;
  }
  take(now = Date.now()): boolean {
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.rate);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

/** Per-key buckets (for example per IP) that forget idle keys. */
export class KeyedLimiter {
  private buckets = new Map<string, { b: Bucket; seen: number }>();
  constructor(private rate: number, private burst: number) {}
  take(key: string): boolean {
    const now = Date.now();
    let e = this.buckets.get(key);
    if (!e) {
      e = { b: new Bucket(this.rate, this.burst), seen: now };
      this.buckets.set(key, e);
    }
    e.seen = now;
    if (this.buckets.size > 10_000) {
      for (const [k, v] of this.buckets) if (now - v.seen > 60_000) this.buckets.delete(k);
    }
    return e.b.take(now);
  }
}

/**
 * Brute-force lock for secrets typed by people (the admin token): after `max` failures from one key
 * (an IP address) within `windowMs`, that key is refused outright until the window has passed.
 */
export class FailureLock {
  private fails = new Map<string, { count: number; first: number }>();
  constructor(private max = 5, private windowMs = 15 * 60_000) {}

  locked(key: string, now = Date.now()): boolean {
    const f = this.fails.get(key);
    if (!f) return false;
    if (now - f.first > this.windowMs) {
      this.fails.delete(key);
      return false;
    }
    return f.count >= this.max;
  }

  fail(key: string, now = Date.now()) {
    const f = this.fails.get(key);
    if (!f || now - f.first > this.windowMs) this.fails.set(key, { count: 1, first: now });
    else f.count++;
    if (this.fails.size > 10_000) for (const [k, v] of this.fails) if (now - v.first > this.windowMs) this.fails.delete(k);
  }

  succeed(key: string) {
    this.fails.delete(key);
  }
}
