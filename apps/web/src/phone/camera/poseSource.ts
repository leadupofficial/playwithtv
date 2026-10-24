/**
 * Where landmarks come from: MediaPipe Pose Landmarker (lite) running on this phone, or, in browser tests, a
 * synthetic body (fakePose.ts). Everything is self-hosted under /vendor (no CDN), and MediaPipe is only
 * imported when a camera game starts, so other games never download it.
 */
import type { PoseLandmarker } from "@mediapipe/tasks-vision";
import type { Landmark } from "./poseActions";

export const MP_BASE = "/vendor/mediapipe-0.10.35";
const MODEL = `${MP_BASE}/pose_landmarker_lite.task`;

export interface PoseSource {
  readonly kind: "mediapipe" | "fake";
  /** "GPU" or "CPU" for MediaPipe. */
  readonly delegate: string;
  /** Landmarks for the current video frame (null = nobody), timestamps strictly increasing. */
  detect(video: HTMLVideoElement, t: number): Landmark[] | null;
}

/** Downloads a file with progress (bytes). The service worker caches /vendor files, so this is once per phone. */
async function fetchBytes(url: string, onBytes: (n: number) => void): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`download failed (${res.status})`);
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    n += value.length;
    onBytes(value.length);
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

let shared: Promise<MediaPipeSource> | null = null;

/** Loads MediaPipe once per page (kept for rematches). `onProgress` gets 0..1 over the ~17 MB download. */
export function loadMediaPipe(onProgress: (p: number) => void): Promise<MediaPipeSource> {
  if (!shared) {
    shared = MediaPipeSource.create(onProgress);
    shared.catch(() => (shared = null)); // a failed download can be retried
  } else void shared.then(() => onProgress(1)).catch(() => undefined);
  return shared;
}

export class MediaPipeSource implements PoseSource {
  readonly kind = "mediapipe";
  private lastTs = 0;
  private constructor(private lm: PoseLandmarker, readonly delegate: string) {}

  static async create(onProgress: (p: number) => void): Promise<MediaPipeSource> {
    const vision = await import("@mediapipe/tasks-vision");
    const simd = await vision.FilesetResolver.isSimdSupported();
    const wasm = `${MP_BASE}/wasm/${simd ? "vision_wasm_internal" : "vision_wasm_nosimd_internal"}.wasm`;
    const TOTAL = (simd ? 11_153_617 : 10_481_398) + 5_777_746;
    let got = 0;
    const tick = (n: number) => onProgress(Math.min(0.99, (got += n) / TOTAL));
    // warm the cache with progress; MediaPipe then loads the wasm from the same URL
    const [model] = await Promise.all([fetchBytes(MODEL, tick), fetchBytes(wasm, tick)]);
    const files = await vision.FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`);
    const make = (delegate: "GPU" | "CPU") => vision.PoseLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetBuffer: model, delegate },
      runningMode: "VIDEO",
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
      outputSegmentationMasks: false,
    });
    let src: MediaPipeSource;
    try {
      src = new MediaPipeSource(await make("GPU"), "GPU");
    } catch {
      src = new MediaPipeSource(await make("CPU"), "CPU"); // no usable WebGL: the CPU path is slower but works
    }
    onProgress(1);
    return src;
  }

  detect(video: HTMLVideoElement, t: number): Landmark[] | null {
    const ts = Math.max(this.lastTs + 1, Math.round(t));
    this.lastTs = ts;
    let out: Landmark[] | null = null;
    // the callback form hands us the result without copying any buffers
    this.lm.detectForVideo(video, ts, (r) => {
      const p = r.landmarks[0];
      out = p ? p.map((l) => ({ x: l.x, y: l.y, z: l.z, visibility: l.visibility })) : null;
    });
    return out;
  }
}
