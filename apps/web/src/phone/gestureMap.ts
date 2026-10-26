import { STRONG } from "@playwithtv/motion";
import type { ControlAction, ControlSpec, GestureName, SwipeName } from "@playwithtv/protocol";

/** Which action a gesture or swipe means for this game (a strong gesture may mean a power move). */
export function resolver(spec: ControlSpec) {
  const byGesture = new Map<string, ControlAction>();
  const bySwipe = new Map<string, ControlAction>();
  const strong = new Map<string, ControlAction>();
  for (const a of spec.actions) {
    for (const g of a.gestures ?? []) if (!byGesture.has(g)) byGesture.set(g, a);
    for (const s of a.swipes ?? []) if (!bySwipe.has(s)) bySwipe.set(s, a);
    if (a.strongOf) strong.set(a.strongOf, a);
  }
  // Push and pull are one axis, and on real phones its direction is unreliable: players wind up and stop hard, and
  // the detector reads whichever spike crosses the line first (on a vivo I2304 most pushes came out as pulls). Where a
  // game maps only one of them, a sharp move either way means that action. Games mapping both still tell them apart.
  for (const [k, other] of [["push", "pull"], ["pull", "push"]] as const) {
    const a = byGesture.get(k);
    if (a && !byGesture.has(other)) byGesture.set(other, a);
  }
  return {
    gesture(kind: GestureName, strength: number) {
      const a = byGesture.get(kind);
      if (!a) return null;
      return strength >= STRONG ? (strong.get(a.id) ?? a) : a;
    },
    swipe(s: SwipeName | "tap") {
      return bySwipe.get(s) ?? null;
    },
  };
}
