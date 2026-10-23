import { JOIN_CODE_LENGTH } from "@playwithtv/protocol";
import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { isIPv4, isIPv6 } from "node:net";

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I/L

/** Unguessable opaque token (192 bits). */
export function token(): string {
  return randomBytes(24).toString("base64url");
}

/** Short human-typable join code; uniqueness among live rooms is the caller's job. */
export function joinCode(): string {
  let s = "";
  for (let i = 0; i < JOIN_CODE_LENGTH; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
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
  /** Tokens available now (refilled for elapsed time), without using one. */
  peek(now = Date.now()): number {
    return Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.rate);
  }
}

/** Per-key buckets (for example per IP) that forget idle keys. */
export class KeyedLimiter {
  private buckets = new Map<string, { b: Bucket; seen: number }>();
  constructor(private rate: number, private burst: number) {}
  /** Whether a token is available, without using it. */
  canTake(key: string): boolean {
    const e = this.buckets.get(key);
    return !e || e.b.peek() >= 1;
  }
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

/**
 * The network block an address belongs to (IPv4 /24, IPv6 /48), for limits that hopping between addresses
 * can't dodge. Addresses are validated and fully expanded first, so different spellings of the same address
 * ("2001:db8::1", "2001:0db8:0:0::1", IPv4-mapped "::ffff:1.2.3.4") always land in the same block.
 */
export function networkOf(ip: string): string {
  const mapped = ip.toLowerCase().startsWith("::ffff:") ? ip.slice(7) : ip;
  if (isIPv4(mapped)) return mapped.split(".").slice(0, 3).join(".") + ".0/24";
  const bare = ip.split("%")[0]!; // drop a zone id (fe80::1%eth0)
  if (!isIPv6(bare)) return `invalid:${ip}`;
  return expandIPv6(bare).slice(0, 3).map((g) => parseInt(g, 16).toString(16)).join(":") + "::/48";
}

/** Eight 16-bit groups of a valid IPv6 address (handles "::" and a trailing dotted IPv4 part). */
function expandIPv6(addr: string): string[] {
  let a = addr;
  const v4 = a.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [w, x, y, z] = v4.slice(1).map(Number) as [number, number, number, number];
    a = a.slice(0, -v4[0].length) + ((w << 8) | x).toString(16) + ":" + ((y << 8) | z).toString(16);
  }
  const [head, tail] = a.split("::") as [string, string | undefined];
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const fill = a.includes("::") ? 8 - h.length - t.length : 0;
  return [...h, ...Array<string>(fill).fill("0"), ...t];
}
