/**
 * Browser adapter for the shared motion SDK (@scp/motion): reads DeviceMotion events, converts them to
 * screen axes for the current orientation and feeds the MotionEngine. Requirements: a secure context (HTTPS)
 * and, on iPhone, a permission prompt triggered by a tap. Only motion sensors are read: never the camera,
 * microphone or location.
 */
import { DEFAULT_SETTINGS, MotionEngine, type Gesture, type MotionFrame, type MotionTrace, type RawSample, toScreen, v } from "@scp/motion";

const SENS_KEY = "scp.motion.sensitivity";
const IOS = typeof navigator !== "undefined" && /iPad|iPhone|iPod/.test(navigator.userAgent);

export function motionSupported(): boolean {
  return typeof window !== "undefined" && "DeviceMotionEvent" in window && window.isSecureContext;
}

/** iOS needs a permission prompt triggered by a tap; Android grants motion silently on HTTPS. */
export async function requestMotionPermission(): Promise<boolean> {
  const DM = (window as unknown as { DeviceMotionEvent?: { requestPermission?: () => Promise<string> } }).DeviceMotionEvent;
  if (DM?.requestPermission) {
    try {
      return (await DM.requestPermission()) === "granted";
    } catch {
      return false;
    }
  }
  return motionSupported();
}

function screenAngle(): number {
  return (screen.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation ?? 0) as number;
}

export function savedSensitivity(): number {
  const n = Number(localStorage.getItem(SENS_KEY));
  return n >= 0.5 && n <= 2 ? n : DEFAULT_SETTINGS.sensitivity;
}

export class PhoneMotion {
  readonly engine = new MotionEngine({ sensitivity: savedSensitivity() });
  private cbs = new Set<(g: Gesture) => void>();
  private recording: RawSample[] | null = null;
  active = false;

  start() {
    if (this.active) return;
    this.active = true;
    window.addEventListener("devicemotion", this.onMotion);
  }

  stop() {
    this.active = false;
    window.removeEventListener("devicemotion", this.onMotion);
  }

  calibrate() {
    this.engine.calibrate();
  }

  setSensitivity(s: number) {
    this.engine.settings.sensitivity = s;
    localStorage.setItem(SENS_KEY, String(s));
  }

  frame(): MotionFrame {
    return this.engine.frame(performance.now());
  }

  onGesture(cb: (g: Gesture) => void) {
    this.cbs.add(cb);
    return () => void this.cbs.delete(cb);
  }

  /** Sensor lab: capture raw samples to export as a test fixture. */
  startRecording() {
    this.recording = [];
  }
  stopRecording(note: string): MotionTrace {
    const samples = this.recording ?? [];
    this.recording = null;
    return { version: 1, note, samples };
  }

  private onMotion = (e: DeviceMotionEvent) => {
    const ig = e.accelerationIncludingGravity;
    if (!ig || ig.x === null) return;
    const angle = screenAngle();
    const sign = IOS ? -1 : 1; // iOS reports acceleration with the opposite sign to Android/Chrome
    const gravity = toScreen(v(sign * (ig.x ?? 0), sign * (ig.y ?? 0), sign * (ig.z ?? 0)), angle);
    const a = e.acceleration;
    const linear = a && a.x !== null ? toScreen(v(sign * (a.x ?? 0), sign * (a.y ?? 0), sign * (a.z ?? 0)), angle) : null;
    const rr = e.rotationRate;
    // rotationRate: beta around x, gamma around y, alpha around z (deg/s)
    const rotation = rr && rr.alpha !== null ? toScreen(v(rr.beta ?? 0, rr.gamma ?? 0, rr.alpha ?? 0), angle) : null;
    const sample: RawSample = { t: performance.now(), gravity, linear, rotation };
    this.recording?.push(sample);
    for (const g of this.engine.push(sample)) this.cbs.forEach((cb) => cb(g));
  };
}

/** Full screen + landscape lock where the browser allows it (Android Chrome); silently ignored elsewhere. */
export async function goLandscape() {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.({ navigationUI: "hide" });
    await (screen.orientation as unknown as { lock?: (o: string) => Promise<void> })?.lock?.("landscape");
  } catch {
    /* iPhone Safari and some browsers do not allow it; the rotate prompt covers them */
  }
}
