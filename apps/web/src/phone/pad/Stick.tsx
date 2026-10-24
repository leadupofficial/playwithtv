import { useRef, useState, type PointerEvent } from "react";
import { capture } from "./capture";

/**
 * Movement in buttons mode. "joystick": drag the knob anywhere in the circle (x right, y up, both in [-1, 1]).
 * "arrows-h": big left/right buttons. "arrows": four arrows. Every pointer is tracked on its own, so the stick
 * and the action buttons can be pressed at the same time.
 */
export function Stick({ kind, onChange }: { kind: "joystick" | "arrows-h" | "arrows"; onChange(x: number, y: number): void }) {
  return kind === "joystick" ? <Joystick onChange={onChange} /> : <Arrows four={kind === "arrows"} onChange={onChange} />;
}

function Joystick({ onChange }: { onChange(x: number, y: number): void }) {
  const area = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const active = useRef<number | null>(null);
  const move = (e: PointerEvent) => {
    const r = area.current!.getBoundingClientRect();
    const radius = Math.min(r.width, r.height) / 2;
    let dx = (e.clientX - (r.left + r.width / 2)) / radius;
    let dy = -(e.clientY - (r.top + r.height / 2)) / radius;
    const d = Math.hypot(dx, dy);
    if (d > 1) { dx /= d; dy /= d; }
    // a small dead zone so a resting thumb does not drift
    const dz = 0.12;
    const shaped = (v: number) => (Math.abs(v) < dz ? 0 : v);
    setKnob({ x: dx, y: dy });
    onChange(shaped(dx), shaped(dy));
  };
  const end = () => {
    active.current = null;
    setKnob({ x: 0, y: 0 });
    onChange(0, 0);
  };
  return (
    <div
      ref={area}
      className="stick"
      onPointerDown={(e) => {
        capture(e);
        active.current = e.pointerId;
        move(e);
      }}
      onPointerMove={(e) => active.current === e.pointerId && move(e)}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <div className="stick-knob" style={{ transform: `translate(${knob.x * 42}%, ${-knob.y * 42}%)` }} />
    </div>
  );
}

function Arrows({ four, onChange }: { four: boolean; onChange(x: number, y: number): void }) {
  const held = useRef({ left: false, right: false, up: false, down: false });
  const [, redraw] = useState(0);
  const set = (k: keyof typeof held.current, v: boolean) => {
    held.current[k] = v;
    const h = held.current;
    onChange((h.right ? 1 : 0) - (h.left ? 1 : 0), (h.up ? 1 : 0) - (h.down ? 1 : 0));
    redraw((n) => n + 1);
  };
  const btn = (k: keyof typeof held.current, label: string) => (
    <button
      key={k}
      className={`arrow arrow-${k} ${held.current[k] ? "held" : ""}`}
      aria-label={k}
      onPointerDown={(e) => {
        capture(e);
        set(k, true);
      }}
      onPointerUp={() => set(k, false)}
      onPointerCancel={() => set(k, false)}
      onContextMenu={(e) => e.preventDefault()}
    >
      {label}
    </button>
  );
  return (
    <div className={`arrows ${four ? "four" : "two"}`}>
      {four && btn("up", "▲")}
      {btn("left", "◀")}
      {btn("right", "▶")}
      {four && btn("down", "▼")}
    </div>
  );
}
