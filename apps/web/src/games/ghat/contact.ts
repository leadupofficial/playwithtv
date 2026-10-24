/**
 * Contacts: racer-to-racer shunts (side barges and rear rams), racers against traffic and goats, near misses and
 * drafting. A shunt marks the victim as "last hit by" the attacker; if the victim then smacks a rail or a vehicle
 * within TAKEDOWN_WINDOW seconds, the attacker scores a TAKEDOWN. Pure.
 */
import { KINDS, spinOut, wreck, type Racer } from "./racer";
import { gapTo, TRAFFIC_SIZE, type Goat, type Traffic } from "./traffic";
import type { Track } from "./track";

export const TAKEDOWN_WINDOW = 1.6;
export const NEAR_MISS_GAP = 1.4;

export type ContactEvent =
  | { kind: "bump"; a: string; b: string; impact: number; side: boolean }
  | { kind: "takedown"; by: string; victim: string; impact: number; how: "rail" | "traffic" | "ram" }
  | { kind: "crash"; id: string; impact: number }
  | { kind: "nearMiss"; id: string; oncoming: boolean; traffic: number }
  | { kind: "goat"; id: string; goat: number }
  | { kind: "goatDodge"; id: string; goat: number };

/** Racer pairs: separate overlapping vehicles and trade shoves. */
export function racerContacts(list: Racer[], time: number, out: ContactEvent[]) {
  for (let i = 0; i < list.length; i++) {
    const a = list[i]!;
    if (a.wreckT > 0) continue;
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j]!;
      if (b.wreckT > 0 || a.air !== b.air) continue;
      const ka = KINDS[a.kind], kb = KINDS[b.kind];
      const ds = b.s - a.s, dd = b.d - a.d;
      const ox = (ka.len + kb.len) / 2 - Math.abs(ds);
      const oy = (ka.wid + kb.wid) / 2 - Math.abs(dd);
      if (ox <= 0 || oy <= 0) continue;
      const ma = ka.mass * (a.boostT > 0 || a.turboT > 0 ? 1.5 : 1), mb = kb.mass * (b.boostT > 0 || b.turboT > 0 ? 1.5 : 1);
      if (oy < ox * 0.9) {
        // side by side: push apart sideways, the one moving into the other wins the shove
        const sgn = Math.sign(dd) || 1; // b is to the right of a when > 0
        const la = a.v * Math.sin(a.a) + a.push, lb = b.v * Math.sin(b.a) + b.push;
        const closing = (la - lb) * sgn; // > 0 when they move together
        const wa = mb / (ma + mb), wb = ma / (ma + mb);
        a.d -= sgn * oy * wa;
        b.d += sgn * oy * wb;
        const j0 = Math.max(2.5, closing * 1.4);
        a.push -= sgn * j0 * wa * 1.2;
        b.push += sgn * j0 * wb * 1.2;
        // who barged whom: the one moving sideways into the other (a tie goes to the heavier / boosting one)
        const towardA = la * sgn, towardB = -lb * sgn;
        const attIsA = towardA > towardB + 0.2 || (Math.abs(towardA - towardB) <= 0.2 && ma >= mb);
        const [att, vic] = attIsA ? [a, b] : [b, a];
        if (vic.shieldT <= 0) {
          vic.lastHitBy = att.id;
          vic.lastHitAt = time;
        }
        out.push({ kind: "bump", a: a.id, b: b.id, impact: Math.max(0, closing), side: true });
      } else {
        // nose to tail: the one behind rams the one in front
        const [rear, front] = ds > 0 ? [a, b] : [b, a];
        const sgn = ds > 0 ? 1 : -1;
        const rel = rear.v - front.v;
        a.s -= sgn * ox * 0.5;
        b.s += sgn * ox * 0.5;
        if (rel > 0) {
          const kr = KINDS[rear.kind].mass, kf = KINDS[front.kind].mass;
          front.v += rel * 0.6 * (kr / (kr + kf)) * 1.4;
          rear.v -= rel * 0.6 * (kf / (kr + kf));
          if (front.shieldT <= 0) {
            front.lastHitBy = rear.id;
            front.lastHitAt = time;
            front.push += (front.d >= rear.d ? 1 : -1) * Math.min(6, rel * 0.5);
          }
          const rammed = rel > 11 && (rear.boostT > 0 || rear.turboT > 0) && front.shieldT <= 0;
          if (rammed && wreck(front)) {
            out.push({ kind: "takedown", by: rear.id, victim: front.id, impact: rel, how: "ram" });
            continue;
          }
        }
        out.push({ kind: "bump", a: a.id, b: b.id, impact: Math.max(0, rel), side: false });
      }
    }
  }
}

/** Was this racer shoved by someone recently (so a crash now is that someone's takedown)? */
export function takedownBy(r: Racer, time: number): string | null {
  return r.lastHitBy && time - r.lastHitAt <= TAKEDOWN_WINDOW ? r.lastHitBy : null;
}

/** Racers against traffic: crashes (or takedowns), and near misses that fill the meter. */
export function trafficContacts(t: Track, racers: Racer[], traffic: Traffic[], time: number, missed: Map<string, Set<number>>, out: ContactEvent[]) {
  for (const r of racers) {
    if (r.wreckT > 0 || r.finishedAt !== null) continue;
    const k = KINDS[r.kind];
    const seen = missed.get(r.id) ?? new Set<number>();
    missed.set(r.id, seen);
    for (const c of traffic) {
      const sz = TRAFFIC_SIZE[c.kind];
      const g = gapTo(t, r.s, c.s);
      const ox = (sz.len + k.len) / 2 - Math.abs(g);
      const lat = Math.abs(c.d - r.d) - (sz.wid + k.wid) / 2;
      if (ox > 0 && lat < 0 && !r.air) {
        const impact = c.dir === 1 ? Math.abs(r.v - c.v) : r.v + c.v;
        if (r.shieldT > 0) {
          r.push += Math.sign(r.d - c.d || 1) * 6;
          continue;
        }
        const by = takedownBy(r, time);
        if (wreck(r)) {
          r.v *= c.dir === 1 ? 0.5 : 0.1;
          if (by) out.push({ kind: "takedown", by, victim: r.id, impact, how: "traffic" });
          else out.push({ kind: "crash", id: r.id, impact });
        }
        continue;
      }
      // near miss: alongside it with a small gap, at speed, once per pass
      if (ox > -1 && lat >= 0 && lat < NEAR_MISS_GAP && r.v > 15 && !seen.has(c.id)) {
        seen.add(c.id);
        out.push({ kind: "nearMiss", id: r.id, oncoming: c.dir === -1, traffic: c.id });
      }
      if (Math.abs(g) > 30) seen.delete(c.id);
    }
  }
}

/** Racers against goats: a hit spins you (the goat tumbles off unharmed); a close pass is a goat dodge. */
export function goatContacts(t: Track, racers: Racer[], goats: Goat[], rnd: () => number, out: ContactEvent[]) {
  for (const g of goats) {
    if (g.bumped) continue;
    for (const r of racers) {
      if (r.wreckT > 0 || r.air) continue;
      const k = KINDS[r.kind];
      const gap = gapTo(t, r.s, g.s);
      const lat = Math.abs(g.d - r.d);
      // a goat sees you coming and may hop aside at the last moment
      if (gap > 0 && gap < 7 && lat < k.wid / 2 + 0.6 && !g.hop && rnd() < 0.02) {
        g.hop = 0.5;
        g.d += (g.d >= r.d ? 1 : -1) * 1.6;
      }
      if (Math.abs(gap) < k.len / 2 + 0.5 && lat < k.wid / 2 + 0.35) {
        if (spinOut(r, 0.7)) {
          g.bumped = 0.001;
          g.vd = g.d >= r.d ? 1 : -1;
          r.stats.goatHits++;
          out.push({ kind: "goat", id: r.id, goat: g.id });
        }
      } else if (Math.abs(gap) < 1.5 && lat < k.wid / 2 + 1.4 && r.v > 12 && !g.dodged.has(r.id)) {
        g.dodged.add(r.id);
        r.stats.goatDodges++;
        out.push({ kind: "goatDodge", id: r.id, goat: g.id });
      }
    }
  }
}
