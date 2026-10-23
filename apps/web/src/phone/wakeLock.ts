/**
 * Keeps the phone screen on while it is a controller. Motion play means nobody touches the screen, so without
 * this the phone dims and sleeps after its timeout, and a sleeping phone stops sending sensor data.
 *
 * Two mechanisms, because phones differ:
 *  1. the Screen Wake Lock API (Chrome 84+, Safari 16.4+), re-requested whenever the page becomes visible;
 *  2. a muted looping background video. Chrome keeps the screen awake while a video plays if it is at least
 *     20 % of the viewport and 75 % visible (blink video_wake_lock.cc), so it fills the controller area as a
 *     subtle moving background. Muted, so it never interrupts the player's music.
 */
export type WakeState = "on" | "off" | "unsupported";

type Sentinel = { released: boolean; release(): Promise<void>; addEventListener(t: "release", cb: () => void): void };
type WakeLockApi = { request(type: "screen"): Promise<Sentinel> };

export class ScreenWake {
  state: WakeState = "off";
  private sentinel: Sentinel | null = null;
  private video: HTMLVideoElement | null = null;
  private wanted = false;
  private listeners = new Set<(s: WakeState) => void>();

  private get api(): WakeLockApi | undefined {
    return (navigator as unknown as { wakeLock?: WakeLockApi }).wakeLock;
  }

  /** The background video element (rendered by the controller). */
  attach(video: HTMLVideoElement | null) {
    this.video = video;
    if (video && this.wanted) this.playVideo();
  }

  /** Call from a tap (the controller's start button); keeps the screen on until stop(). */
  async start() {
    this.wanted = true;
    document.addEventListener("visibilitychange", this.onVisible);
    this.playVideo();
    await this.acquire();
  }

  stop() {
    this.wanted = false;
    document.removeEventListener("visibilitychange", this.onVisible);
    this.video?.pause();
    void this.sentinel?.release().catch(() => undefined);
    this.sentinel = null;
    this.set("off");
  }

  onChange(cb: (s: WakeState) => void) {
    this.listeners.add(cb);
    return () => void this.listeners.delete(cb);
  }

  private onVisible = () => {
    if (!this.wanted || document.visibilityState !== "visible") return;
    this.playVideo();
    void this.acquire();
  };

  private playVideo() {
    const v = this.video;
    if (!v) return;
    v.muted = true;
    void v.play().catch(() => undefined);
  }

  private async acquire() {
    if (!this.api) return this.set("unsupported");
    if (this.sentinel && !this.sentinel.released) return;
    try {
      this.sentinel = await this.api.request("screen");
      this.set("on");
      this.sentinel.addEventListener("release", () => this.set("off"));
    } catch {
      this.set("off"); // e.g. battery saver on some phones; the hint tells the player what to do
    }
  }

  private set(s: WakeState) {
    this.state = s;
    this.listeners.forEach((cb) => cb(s));
  }
}
