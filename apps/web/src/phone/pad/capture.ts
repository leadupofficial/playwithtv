import type { PointerEvent } from "react";

/**
 * Keeps receiving a finger's events even if it slides off the control. Capturing can fail (the pointer was
 * already cancelled, or a synthetic event); the control must still work then, so failures are ignored.
 */
export function capture(e: PointerEvent<Element>) {
  try {
    e.currentTarget.setPointerCapture(e.pointerId);
  } catch {
    /* no active pointer: the press still counts */
  }
}
