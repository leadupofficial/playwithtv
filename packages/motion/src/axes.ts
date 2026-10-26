import { add, cross, dot, len, sub, v, type Vec3 } from "./vec.js";

/**
 * Browsers disagree on which rotationRate field is which axis. The spec says alpha is around z, beta around x and
 * gamma around y, but Chrome on Android reports alpha around x, beta around y and gamma around z (measured on a real
 * phone: a steering turn, which is a turn around the screen's axis, came through gamma). Read the wrong way, twists
 * never fire and saber cuts point the wrong way.
 *
 * Rather than trusting a browser list, the order is checked against gravity: while the phone turns at rate w (in its
 * own frame), the gravity vector it reports turns the other way, dg/dt = -w x g. The order whose rates best explain
 * how gravity actually moved wins.
 */
export type RateOrder = "spec" | "xyz";

export interface Rates {
  alpha: number | null;
  beta: number | null;
  gamma: number | null;
}

/** Device-frame rotation (deg/s) from rotationRate under an axis order. */
export function rotationOf(rr: Rates, order: RateOrder): Vec3 {
  const a = rr.alpha ?? 0, b = rr.beta ?? 0, g = rr.gamma ?? 0;
  return order === "xyz" ? v(a, b, g) : v(b, g, a);
}

const ORDERS: RateOrder[] = ["spec", "xyz"];
const MIN_RATE = 40; // deg/s: slower turns move gravity too little to tell the orders apart through sensor noise
const NEEDED = 8; // turning windows before deciding
const WINDOW_MS = 100;
const MARGIN = 0.4; // the winner's error must be at most this fraction of the loser's

const RAD = Math.PI / 180;

export class RateOrderDetector {
  private err: Record<RateOrder, number> = { spec: 0, xyz: 0 };
  private n = 0;
  private prev: { g: Vec3; rr: Rates; t: number } | null = null;
  // a short window: gravity at its start, and how far each order predicts it has moved since
  private win: { g0: Vec3; pred: Record<RateOrder, Vec3>; turned: number; t0: number } | null = null;
  private decided: RateOrder | null = null;

  /** `fallback` is used until there is enough evidence (what this browser is believed to do). */
  constructor(private fallback: RateOrder) {}

  get order(): RateOrder {
    return this.decided ?? this.fallback;
  }

  get settled() {
    return this.decided !== null;
  }

  /**
   * Feeds raw device-frame acceleration including gravity, the linear part when the browser gives it (so the hand's
   * own acceleration is taken out), and the raw rotationRate. Any sign convention. Returns the current order.
   */
  push(withGravity: Vec3, linear: Vec3 | null, rr: Rates | null, t: number): RateOrder {
    if (this.decided || !rr || rr.alpha === null) return this.order;
    const gravity = linear ? sub(withGravity, linear) : withGravity;
    const p = this.prev;
    this.prev = { g: gravity, rr, t };
    if (!p) return this.order;
    const dt = (t - p.t) / 1000;
    if (dt <= 0 || dt > 0.1 || len(rotationOf(p.rr, "spec")) < MIN_RATE) {
      this.win = null; // only steady turning counts (the length is the same in every order)
      return this.order;
    }
    const w0 = (this.win ??= { g0: p.g, pred: { spec: v(0, 0, 0), xyz: v(0, 0, 0) }, turned: 0, t0: p.t });
    for (const o of ORDERS) {
      const w = rotationOf(p.rr, o);
      w0.pred[o] = add(w0.pred[o], cross(v(-w.x * RAD * dt, -w.y * RAD * dt, -w.z * RAD * dt), p.g)); // -w x g dt
    }
    w0.turned += len(rotationOf(p.rr, "spec")) * dt;
    if (t - w0.t0 < WINDOW_MS) return this.order;
    this.win = null;
    const dg = sub(gravity, w0.g0);
    if (w0.turned < 4 || len(dg) < 0.3) return this.order; // turning around gravity itself moves nothing: no evidence
    for (const o of ORDERS) {
      // how far the predicted direction is off: 0 = same way, 2 = opposite (sizes vary too much with noise)
      this.err[o] += 1 - dot(dg, w0.pred[o]) / (len(dg) * len(w0.pred[o]) || 1);
    }
    if (++this.n < NEEDED) return this.order;
    const [best, other] = this.err.spec <= this.err.xyz ? (["spec", "xyz"] as const) : (["xyz", "spec"] as const);
    if (this.err[best] <= this.err[other] * MARGIN) this.decided = best;
    return this.order;
  }
}
