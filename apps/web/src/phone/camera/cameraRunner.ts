/**
 * Runs the phone camera for camera mode: opens the front camera, feeds each new video frame to the pose
 * source (MediaPipe or the test hook) and the tracker, and reports what it saw. The video stays inside this
 * page: frames are never copied, drawn, recorded or sent anywhere; only the tracker's moves leave the phone.
 */
import { PoseTracker, type PoseOutput } from "./poseActions";
import { loadMediaPipe, type PoseSource } from "./poseSource";
import { FakePoseSource, fakePoseControl } from "./fakePose";

export type CamPhase = "off" | "asking" | "loading" | "running" | "stopped" | "error";

export interface CamStatus {
  phase: CamPhase;
  /** Why the camera could not start (shown to the player). */
  error?: string;
  /** Model download 0..1. */
  progress: number;
  /** Tracked frames per second and the inference time per frame (ms). */
  fps: number;
  inferMs: number;
  delegate: string;
  /** Too slow for camera play (under 8 fps after a few seconds): offer the buttons. */
  slow: boolean;
}

const MAX_FPS = 30;

export class CameraRunner {
  status: CamStatus = { phase: "off", progress: 0, fps: 0, inferMs: 0, delegate: "", slow: false };
  private stream: MediaStream | null = null;
  private source: PoseSource | null = null;
  private running = false;
  private lastRun = 0;
  private lastFrameAt = 0;
  private frames: number[] = [];
  private startedAt = 0;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private video: HTMLVideoElement,
    public tracker: PoseTracker,
    private onFrame: (o: PoseOutput) => void,
    private onStatus: (s: CamStatus) => void,
  ) {}

  private set(s: Partial<CamStatus>) {
    this.status = { ...this.status, ...s };
    this.onStatus(this.status);
  }

  /** Must start from a tap the first time (the browser asks for camera permission). */
  async start() {
    if (this.status.phase === "asking" || this.status.phase === "loading" || this.status.phase === "running") return;
    this.set({ phase: "asking", error: undefined, slow: false });
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
        audio: false,
      });
    } catch (e) {
      const name = (e as { name?: string }).name;
      this.set({
        phase: "error",
        error: name === "NotAllowedError" ? "Camera access was blocked. Allow the camera for this site in the browser settings, or play with buttons."
          : name === "NotFoundError" || name === "OverconstrainedError" ? "No front camera was found on this phone."
          : "The camera could not start. Close other apps that use it and try again.",
      });
      return;
    }
    const track = this.stream.getVideoTracks()[0];
    track?.addEventListener("ended", () => this.stopped());
    this.video.srcObject = this.stream;
    try {
      await this.video.play();
    } catch {
      /* autoplay of a muted inline video is allowed; play() can still reject if interrupted, the loop retries */
    }
    if (!this.source) {
      const fake = fakePoseControl();
      if (fake) this.source = new FakePoseSource(fake);
      else {
        this.set({ phase: "loading" });
        try {
          this.source = await loadMediaPipe((p) => this.set({ progress: p }));
        } catch {
          this.release();
          this.set({ phase: "error", error: "The body-tracking files could not be downloaded. Check the Wi-Fi and try again." });
          return;
        }
        if (!this.stream) return; // stopped while downloading
      }
    }
    this.set({ phase: "running", progress: 1, delegate: this.source.delegate });
    this.running = true;
    this.startedAt = performance.now();
    this.frames = [];
    this.schedule();
    // a hidden or paused video may stop presenting frames: fall back to a timer
    this.watchdog = setInterval(() => {
      if (!this.running) return;
      if (track && track.readyState === "ended") return this.stopped();
      if (performance.now() - this.lastFrameAt > 600) this.tick(performance.now());
    }, 300);
  }

  private schedule() {
    if (!this.running) return;
    const v = this.video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: (now: number) => void) => number };
    if (v.requestVideoFrameCallback) v.requestVideoFrameCallback((now) => { this.tick(now); this.schedule(); });
    else this.timer = setTimeout(() => { this.tick(performance.now()); this.schedule(); }, 1000 / MAX_FPS);
  }

  private tick(now: number) {
    if (!this.running || !this.source) return;
    if (now - this.lastRun < 1000 / MAX_FPS - 4) return; // at most 30 fps, whatever the camera delivers
    if (this.video.readyState < 2 || !this.video.videoWidth) return;
    this.lastRun = now;
    this.lastFrameAt = performance.now();
    const t0 = performance.now();
    let lm = null;
    try {
      lm = this.source.detect(this.video, now);
    } catch {
      lm = null;
    }
    const ms = performance.now() - t0;
    const out = this.tracker.step({ t: now, landmarks: lm, aspect: this.video.videoWidth / this.video.videoHeight });
    this.frames.push(now);
    while (this.frames.length && now - this.frames[0]! > 1000) this.frames.shift();
    const fps = this.frames.length;
    const inferMs = this.status.inferMs ? this.status.inferMs * 0.9 + ms * 0.1 : ms;
    const slow = this.source.kind === "mediapipe" && now - this.startedAt > 5000 && fps < 8;
    if (Math.abs(fps - this.status.fps) >= 1 || slow !== this.status.slow || Math.abs(inferMs - this.status.inferMs) > 2) this.set({ fps, inferMs, slow });
    else this.status.inferMs = inferMs;
    this.onFrame(out);
  }

  private release() {
    this.running = false;
    if (this.watchdog) clearInterval(this.watchdog);
    if (this.timer) clearTimeout(this.timer);
    this.watchdog = this.timer = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
  }

  private stopped() {
    if (this.status.phase === "stopped" || this.status.phase === "off") return;
    this.release();
    this.set({ phase: "stopped", fps: 0 });
  }

  /** The Stop camera button, leaving the game or switching mode: the camera light goes off at once. */
  stop() {
    this.release();
    if (this.status.phase !== "error") this.set({ phase: "stopped", fps: 0 });
  }

  /** The page came back to the front: a camera the system took away needs a tap to resume. */
  checkTrack() {
    const t = this.stream?.getVideoTracks()[0];
    if (this.running && (!t || t.readyState === "ended")) this.stopped();
  }

  dispose() {
    this.release();
    this.status.phase = "off";
  }
}
