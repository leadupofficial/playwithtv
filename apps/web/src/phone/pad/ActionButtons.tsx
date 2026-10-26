import { useState } from "react";
import { capture } from "./capture";
import type { ControlAction } from "@playwithtv/protocol";
import { buzz } from "../haptics";

/** A game's action buttons. Tap actions fire on touch-down (no click delay); hold actions report press and release. */
export function ActionButtons({ actions, onTap, onHold }: {
  actions: ControlAction[];
  onTap(id: string): void;
  onHold(id: string, down: boolean): void;
}) {
  const [held, setHeld] = useState<Record<string, boolean>>({});
  const cols = actions.length <= 2 ? actions.length : actions.length <= 4 ? 2 : 3;
  return (
    <div className="action-grid" style={{ gridTemplateColumns: `repeat(${Math.max(1, cols)}, 1fr)` }}>
      {actions.map((a) => (
        <button
          key={a.id}
          className={`action ${held[a.id] ? "held" : ""}`}
          style={{ background: a.color ?? undefined }}
          onPointerDown={(e) => {
            e.preventDefault();
            if (a.hold) {
              capture(e);
              setHeld((h) => ({ ...h, [a.id]: true }));
              onHold(a.id, true);
            } else {
              onTap(a.id);
              buzz(12);
            }
          }}
          onPointerUp={() => {
            if (!a.hold) return;
            setHeld((h) => ({ ...h, [a.id]: false }));
            onHold(a.id, false);
          }}
          onPointerCancel={() => {
            if (!a.hold) return;
            setHeld((h) => ({ ...h, [a.id]: false }));
            onHold(a.id, false);
          }}
          onContextMenu={(e) => e.preventDefault()}
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}
