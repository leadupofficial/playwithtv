/**
 * How a game wants to be controlled. The TV sends a ControlSpec to the phones; each player picks one of the
 * offered modes on their own phone, and the phone draws the matching pad:
 *
 *   buttons   on-screen gamepad: a stick (joystick, arrows or none) plus action buttons
 *   motion    tilt + gestures (push, flicks, shake…), eyes on the TV, no touching during play
 *   hybrid    tilt for movement plus on-screen action buttons (e.g. steer by tilting, tap Boost)
 *   touchpad  the screen is a trackpad: drag to move or aim, swipe for actions
 *   camera    the phone, propped up 2-3 m away, watches the player's body (on the phone only: video never
 *             leaves it) and sends moves such as squats and jumps as actions, leaning as axes.x
 *
 * Whatever the mode, games receive the same signals, so they never need to know which one a player chose:
 *   axes.x, axes.y   movement in [-1, 1]: x right, y up/forward (stick, tilt or touchpad)
 *   taps[action]     a counter per action (button press, mapped gesture or swipe)
 *   buttons[action]  held state for `hold` actions
 *   axes.m           the mode in use, sent as code / MODE_DIVISOR (0 buttons, 1 motion, 2 hybrid, 3 touchpad,
 *                    4 camera), for games that tune by it
 */
export type ControlMode = "buttons" | "motion" | "hybrid" | "touchpad" | "camera";
export const CONTROL_MODES: ControlMode[] = ["buttons", "motion", "hybrid", "touchpad", "camera"];
export const MODE_CODE: Record<ControlMode, number> = { buttons: 0, motion: 1, hybrid: 2, touchpad: 3, camera: 4 };
/** Axes are clamped to [-1, 1], so the mode travels as code / MODE_DIVISOR (the motion package's ControlReader uses the same). */
export const MODE_DIVISOR = 4;

/**
 * Body moves the phone camera recognises (camera mode). "Seated" players use upper-body moves only, so an
 * action lists both: e.g. a fuel pump is a squat standing and an arm raise seated.
 */
export type PoseMove = "squat" | "jump" | "jack" | "raise" | "punch" | "hands-on-head";

/** Gesture names from the motion SDK (@playwithtv/motion), repeated here so the protocol has no dependency. */
export type GestureName =
  | "push" | "pull" | "flick-up" | "flick-down" | "flick-left" | "flick-right" | "twist-left" | "twist-right" | "shake";

/** Touchpad swipes (a quick drag in one direction). */
export type SwipeName = "swipe-up" | "swipe-down" | "swipe-left" | "swipe-right";

export interface ControlAction {
  /** Short id, also the tap/button key on the wire (max 16 chars). */
  id: string;
  label: string;
  /** Held while pressed (block, accelerate) instead of a one-shot tap. */
  hold?: boolean;
  color?: string;
  /** Modes that show this action as an on-screen button (default: buttons and hybrid). */
  buttonIn?: ControlMode[];
  /** In motion mode, these gestures trigger the action. */
  gestures?: GestureName[];
  /** In motion mode, a strong version of this other action's gesture triggers this one instead (power moves). */
  strongOf?: string;
  /** In touchpad mode, these swipes trigger the action; "tap" = a quick tap on the pad. */
  swipes?: Array<SwipeName | "tap">;
  /** In camera mode, these body moves trigger the action (standing players). */
  poses?: PoseMove[];
  /** In camera mode, for seated players (upper body only). Defaults to `poses`. */
  seatedPoses?: PoseMove[];
}

export interface ControlSpec {
  title: string;
  /** Offered modes, best first (the default for players who have not chosen). */
  modes: ControlMode[];
  /** Movement in buttons mode: a full joystick, left/right arrows, 4 arrows, or nothing. */
  stick: "joystick" | "arrows-h" | "arrows" | "none";
  /** What tilting means in motion/hybrid (only used for the on-screen hint). */
  tilt?: "steer" | "tray" | "aim" | "none";
  actions: ControlAction[];
  /** One line per mode telling the player what to do. */
  hints?: Partial<Record<ControlMode, string>>;
  /** false = keep the current calibration (the next round of the same game). */
  calibrate?: boolean;
}

/** Which actions a mode shows as buttons. */
export function buttonsFor(spec: ControlSpec, mode: ControlMode): ControlAction[] {
  if (mode === "motion" || mode === "camera") return [];
  return spec.actions.filter((a) => (a.buttonIn ?? ["buttons", "hybrid"]).includes(mode));
}
