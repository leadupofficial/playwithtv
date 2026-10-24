/**
 * Tiffin Tornado: a simple path-finding helper chef (pure). Used by the tests to play whole services, and handy
 * for an attract mode. `steer` walks a chef to stand next to a tile, facing it.
 */
import { type Kitchen, type Tile, cellCentre, cellOf, walkable } from "./kitchen";
import type { Chef } from "./chefs";
import { targetOf } from "./chefs";
import type { TiffinInput } from "./engine";

const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

/** Floor cells from which `t` can be reached, by BFS from the chef's cell: the path (cells) to the nearest. */
export function pathTo(k: Kitchen, from: { c: number; r: number }, t: { c: number; r: number }): Array<{ c: number; r: number }> | null {
  const key = (c: number, r: number) => r * k.w + c;
  const goal = new Set(N4.map(([dc, dr]) => key(t.c + dc, t.r + dr)).filter((_, i) => walkable(k, t.c + N4[i]![0], t.r + N4[i]![1])));
  const prev = new Map<number, number>();
  const q = [key(from.c, from.r)];
  prev.set(q[0]!, -1);
  while (q.length) {
    const cur = q.shift()!;
    if (goal.has(cur)) {
      const path: Array<{ c: number; r: number }> = [];
      for (let n = cur; n !== -1; n = prev.get(n)!) path.unshift({ c: n % k.w, r: Math.floor(n / k.w) });
      return path;
    }
    const c = cur % k.w, r = Math.floor(cur / k.w);
    for (const [dc, dr] of N4) {
      const nk = key(c + dc, r + dr);
      if (!prev.has(nk) && walkable(k, c + dc, r + dr)) {
        prev.set(nk, cur);
        q.push(nk);
      }
    }
  }
  return null;
}

/** Input that walks `chef` towards tile `t`; `there` is true once the chef faces it within reach. */
export function steer(k: Kitchen, chef: Chef, t: Tile): { input: TiffinInput; there: boolean } {
  if (targetOf(k, chef) === t) return { input: { x: 0, z: 0, act: false, work: 0, dash: false }, there: true };
  const at = cellOf(k, chef.x, chef.z);
  const path = pathTo(k, at, t);
  if (!path) return { input: { x: 0, z: 0, act: false, work: 0, dash: false }, there: false };
  const next = path.length > 1 ? path[1]! : path[0]!;
  const p = path.length > 1 ? cellCentre(k, next.c, next.r) : cellCentre(k, t.c, t.r);
  let dx = p.x - chef.x, dz = p.z - chef.z;
  const d = Math.hypot(dx, dz) || 1;
  dx /= d;
  dz /= d;
  // in the last cell: creep towards the target so the chef turns to face it
  const s = path.length > 1 ? 1 : 0.45;
  return { input: { x: dx * s, z: dz * s, act: false, work: 0, dash: false }, there: false };
}

export function find(k: Kitchen, code: string, pred: (t: Tile) => boolean = () => true): Tile | null {
  return k.tiles.find((t) => t.code === code && pred(t)) ?? null;
}
