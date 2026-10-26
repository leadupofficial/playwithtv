/**
 * CITY RIVALS CPU drivers: a street graph of the district (every crossing, the alleys and the maidan's diagonal),
 * shortest routes to the next gate, and a driver that aims a little ahead along the route, eases off for sharp
 * corners and drifts the long ones. Pure.
 */
import { GRID, at, type District } from "./district";
import { forwardSpeed, wrap, type Car, type CarInput } from "./car";

export interface Node { x: number; z: number; links: Array<{ to: number; len: number }> }
export interface Graph { nodes: Node[]; crossing(i: number, j: number): number }

export function buildGraph(d: District): Graph {
  const nodes: Node[] = [];
  const key = new Map<string, number>();
  const id = (x: number, z: number) => {
    const k = `${Math.round(x * 10)},${Math.round(z * 10)}`;
    let n = key.get(k);
    if (n === undefined) {
      n = nodes.length;
      nodes.push({ x, z, links: [] });
      key.set(k, n);
    }
    return n;
  };
  const link = (a: number, b: number) => {
    const len = Math.hypot(nodes[a]!.x - nodes[b]!.x, nodes[a]!.z - nodes[b]!.z);
    nodes[a]!.links.push({ to: b, len });
    nodes[b]!.links.push({ to: a, len });
  };
  // street segments, split where an alley meets them
  const splits = new Map<string, number[]>(); // "h,i,j" (segment from crossing (i,j) east) / "v,i,j" (south)
  const addSplit = (k: string, v: number) => splits.set(k, [...(splits.get(k) ?? []), v]);
  for (const b of d.blocks) {
    if (b.kind === "alley-z") {
      const mx = (b.x0 + b.x1) / 2;
      addSplit(`h,${b.i},${b.j}`, mx);
      addSplit(`h,${b.i},${b.j + 1}`, mx);
    } else if (b.kind === "alley-x") {
      const mz = (b.z0 + b.z1) / 2;
      addSplit(`v,${b.i},${b.j}`, mz);
      addSplit(`v,${b.i + 1},${b.j}`, mz);
    }
  }
  for (let i = 0; i < GRID; i++) {
    for (let j = 0; j < GRID; j++) {
      if (i < GRID - 1) {
        const pts = [at(i), ...(splits.get(`h,${i},${j}`) ?? []).sort((a, b) => a - b), at(i + 1)];
        for (let k = 0; k < pts.length - 1; k++) link(id(pts[k]!, at(j)), id(pts[k + 1]!, at(j)));
      }
      if (j < GRID - 1) {
        const pts = [at(j), ...(splits.get(`v,${i},${j}`) ?? []).sort((a, b) => a - b), at(j + 1)];
        for (let k = 0; k < pts.length - 1; k++) link(id(at(i), pts[k]!), id(at(i), pts[k + 1]!));
      }
    }
  }
  for (const b of d.blocks) {
    if (b.kind === "alley-z") {
      const mx = (b.x0 + b.x1) / 2;
      link(id(mx, at(b.j)), id(mx, at(b.j + 1)));
    } else if (b.kind === "alley-x") {
      const mz = (b.z0 + b.z1) / 2;
      link(id(at(b.i), mz), id(at(b.i + 1), mz));
    } else if (b.kind === "park") {
      // across the maidan, corner to corner (over its stunt ramp)
      link(id(at(b.i), at(b.j)), id(at(b.i + 1), at(b.j + 1)));
    }
  }
  return { nodes, crossing: (i, j) => id(at(i), at(j)) };
}

/** Shortest route (node ids, start excluded) from node `from` to node `to` (Dijkstra; the graph is tiny).
 * `then`: the node after the goal. Of the equally short ways in, prefer one that does not arrive heading away from
 * it (no hairpin U-turn at the gate). */
export function route(g: Graph, from: number, to: number, then = -1): number[] {
  if (then < 0 || from === to) return shortest(g, from, to);
  const goal = g.nodes[to]!, nxt = g.nodes[then]!;
  const ox = nxt.x - goal.x, oz = nxt.z - goal.z, ol = Math.hypot(ox, oz) || 1;
  let best: number[] = [], bestCost = Infinity;
  for (const l of goal.links) {
    const n = g.nodes[l.to]!;
    const head = shortest(g, from, l.to);
    if (l.to !== from && !head.length) continue;
    if (head.includes(to)) continue; // would pass through the gate first anyway
    const ix = goal.x - n.x, iz = goal.z - n.z, il = Math.hypot(ix, iz) || 1;
    const away = (ix * ox + iz * oz) / (il * ol) < -0.5 ? 60 : 0;
    const cost = pathLen(g, from, head) + l.len + away;
    if (cost < bestCost) {
      bestCost = cost;
      best = [...head, to];
    }
  }
  return best.length ? best : shortest(g, from, to);
}

function pathLen(g: Graph, from: number, path: number[]): number {
  let len = 0, u = from;
  for (const v of path) {
    len += Math.hypot(g.nodes[u]!.x - g.nodes[v]!.x, g.nodes[u]!.z - g.nodes[v]!.z);
    u = v;
  }
  return len;
}

function shortest(g: Graph, from: number, to: number): number[] {
  const n = g.nodes.length;
  const dist = new Array<number>(n).fill(Infinity), prev = new Array<number>(n).fill(-1), done = new Array<boolean>(n).fill(false);
  dist[from] = 0;
  for (;;) {
    let u = -1;
    for (let k = 0; k < n; k++) if (!done[k] && dist[k]! < Infinity && (u < 0 || dist[k]! < dist[u]!)) u = k;
    if (u < 0 || u === to) break;
    done[u] = true;
    for (const l of g.nodes[u]!.links) {
      const nd = dist[u]! + l.len;
      if (nd < dist[l.to]!) {
        dist[l.to] = nd;
        prev[l.to] = u;
      }
    }
  }
  const out: number[] = [];
  for (let u = to; u !== from && u >= 0; u = prev[u]!) out.unshift(u);
  return out;
}

/** The node nearest a point that is reachable in a straight line along a street (simply: the nearest node). */
export function nearestNode(g: Graph, x: number, z: number): number {
  let best = 0, bd = Infinity;
  g.nodes.forEach((n, k) => {
    const dd = (n.x - x) ** 2 + (n.z - z) ** 2;
    if (dd < bd) {
      bd = dd;
      best = k;
    }
  });
  return best;
}

export interface CpuBrain { path: number[]; goal: number; skill: number; wobble: number }

export function newBrain(skill: number): CpuBrain {
  return { path: [], goal: -1, skill, wobble: 0 };
}

/** One CPU decision. `goal`: the node of the next gate, `then` the one after it. */
export function cpuDrive(g: Graph, b: CpuBrain, c: Car, goal: number, then: number, time: number): CarInput {
  if (b.goal !== goal || !b.path.length) {
    b.goal = goal;
    b.path = route(g, nearestNode(g, c.x, c.z), goal, then);
    if (!b.path.length) b.path = [goal];
  }
  // advance along the path once close to the next node
  let next = g.nodes[b.path[0]!]!;
  while (b.path.length > 1 && Math.hypot(next.x - c.x, next.z - c.z) < 7) {
    b.path.shift();
    next = g.nodes[b.path[0]!]!;
  }
  const after = b.path[1] !== undefined ? g.nodes[b.path[1]]! : null;
  const dNext = Math.hypot(next.x - c.x, next.z - c.z);
  // aim: the next node, blending towards the one after it as we arrive (cuts the corner a little)
  const blend = after ? Math.max(0, Math.min(0.6, 1 - dNext / 14)) : 0;
  const ax = next.x + (after ? (after.x - next.x) * blend : 0), az = next.z + (after ? (after.z - next.z) * blend : 0);
  const want = Math.atan2(ax - c.x, az - c.z);
  const err = wrap(want - c.yaw);
  b.wobble = Math.sin(time * 0.7 + b.skill * 9) * 0.06 * (1 - b.skill);
  // yaw grows to the left: a positive error means turn left (negative steer)
  const steer = Math.max(-1, Math.min(1, -err * 2.4 + b.wobble));
  // the corner ahead: how sharp is the turn at the next node?
  let turn = 0;
  if (after) {
    const h1 = Math.atan2(next.x - c.x, next.z - c.z), h2 = Math.atan2(after.x - next.x, after.z - next.z);
    turn = Math.abs(wrap(h2 - h1));
  }
  const v = forwardSpeed(c);
  const brake = (Math.abs(err) > 0.9 && v > 10) || (turn > 1.2 && dNext < 9 + v * 0.35 && v > 17 - b.skill * 3);
  const drift = turn > 1.2 && dNext < 10 && v > 15 && b.skill > 0.5;
  return { steer, drift, boost: c.meter > 0.34 && Math.abs(err) < 0.15 && dNext > 30, brake };
}
