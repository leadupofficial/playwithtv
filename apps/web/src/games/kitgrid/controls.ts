import type { ControlAction, ControlSpec } from "@playwithtv/protocol";

const ARROW = { up: "▲ Up", down: "▼ Down", left: "◀ Left", right: "▶ Right" } as const;

/** Grid moves are taps (one tap = one turn, counted so a lost packet can't swallow it). */
export function dirControls(title: string, hint: string, extra: ControlAction[] = []): ControlSpec {
  return {
    title,
    modes: ["buttons", "touchpad", "motion"],
    stick: "none",
    tilt: "none",
    actions: (["left", "up", "right", "down"] as const).map((d) => ({
      id: d, label: ARROW[d], gestures: [`flick-${d}` as const], swipes: [`swipe-${d}` as const],
    } as ControlAction)).concat(extra),
    hints: {
      buttons: `Tap the arrows to ${hint}`,
      touchpad: `Swipe up, down, left or right to ${hint}`,
      motion: `Flick the phone up, down, left or right to ${hint}`,
    },
  };
}

