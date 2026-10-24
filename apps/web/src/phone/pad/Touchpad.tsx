import { useRef, type PointerEvent } from "react";
import { capture } from "./capture";
import type { SwipeName } from "@playwithtv/protocol";

const SWIPE_MIN = 0.28;      // fraction of the pad's size
const SWIPE_MS = 280;
const TAP_MS = 220;
const TAP_MOVE = 0.04;

/**
 * The phone screen as a trackpad. While a finger is down, its position is the movement (centre = 0, edges = ±1,
 * y up). A quick drag is a swipe in its main direction; a quick touch without moving is a "tap".
 */
export function Touchpad({ onMove, onSwipe }: { onMove(x: number, y: number): void; onSwipe(s: SwipeName | "tap"): void }) {
  const area = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number; t: number; id: number } | null>(null);
  const pos = (e: PointerEvent) => {
    const r = area.current!.getBoundingClientRect();
    const x = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1));
    const y = Math.max(-1, Math.min(1, -(((e.clientY - r.top) / r.height) * 2 - 1)));
    return { x, y };
  };
  return (
    <div
      ref={area}
      className="touchpad"
      onPointerDown={(e) => {
        capture(e);
        const p = pos(e);
        start.current = { ...p, t: performance.now(), id: e.pointerId };
        onMove(p.x, p.y);
      }}
      onPointerMove={(e) => {
        if (start.current?.id !== e.pointerId) return;
        const p = pos(e);
        onMove(p.x, p.y);
      }}
      onPointerUp={(e) => {
        const s = start.current;
        start.current = null;
        onMove(0, 0);
        if (!s || s.id !== e.pointerId) return;
        const p = pos(e);
        const dx = (p.x - s.x) / 2, dy = (p.y - s.y) / 2, dt = performance.now() - s.t;
        if (dt < TAP_MS && Math.hypot(dx, dy) < TAP_MOVE) return onSwipe("tap");
        if (dt > SWIPE_MS || Math.hypot(dx, dy) < SWIPE_MIN) return;
        onSwipe(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "swipe-right" : "swipe-left") : dy > 0 ? "swipe-up" : "swipe-down");
      }}
      onPointerCancel={() => {
        start.current = null;
        onMove(0, 0);
      }}
    >
      <span className="touchpad-hint">drag · swipe · tap</span>
    </div>
  );
}
