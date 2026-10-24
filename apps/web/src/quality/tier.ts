/**
 * quality/tier: pure rules that turn what we know about a device into a render tier, and each tier's profile.
 * No DOM here (see detect.ts for gathering the signals), so every threshold is unit-tested.
 *
 *   lite   the owner's 1 GB Android TV (Mali-G31, fill-rate bound): pre-rendered sprites, video backdrops,
 *          Lambert/Toon, no shadow maps, no post-processing, 1280×720
 *   high   a decent TV box, a laptop with integrated graphics: PBR, HDRI lighting, soft shadows, bloom + FXAA
 *   ultra  a laptop/PC with a strong GPU casting to the TV ("power-host mode"): bigger shadow maps, AO, SMAA, 1440p
 */

export type Tier = "lite" | "high" | "ultra";
export type QualitySetting = "auto" | Tier;
export const TIERS: readonly Tier[] = ["lite", "high", "ultra"];

/** What the device tells us. Unknown values are undefined (browsers hide some of them). */
export interface DeviceSignals {
  webgl: boolean;
  /** UNMASKED_RENDERER_WEBGL (or the plain RENDERER string), e.g. "ANGLE (Apple, ANGLE Metal Renderer: Apple M4, …)". */
  gpu?: string;
  /** navigator.deviceMemory in GB (Chrome rounds to 0.25…8). */
  memoryGb?: number;
  cores?: number;
  maxTextureSize?: number;
  /** The Play With TV Android app's WebView (user agent contains "PlayWithTV/1"). */
  tvApp?: boolean;
  /** GPU micro-benchmark: how many 720p screens of a lit, textured fragment shader fit in one 60 fps frame. */
  benchScore?: number;
}

/** GPUs that must stay on the lite path (fill-rate bound, or no real GPU at all). */
export const WEAK_GPU = /Mali-(?:[34]\d\d|T[678]\d\d|G31|G51|G52|G57)\b|PowerVR (?:SGX|Rogue GE|Rogue GX)|Adreno \(TM\) ?(?:[1-4]\d\d|50\d|51\d|52\d|53\d|60\d|61\d)\b|VideoCore|SwiftShader|llvmpipe|softpipe|Software Rasterizer|Microsoft Basic Render/i;
/** GPUs that can take the ultra path if the benchmark agrees. */
export const STRONG_GPU = /Apple M\d|Apple GPU|NVIDIA|GeForce|Quadro|RTX|Radeon (?:RX|Pro|\d{3,4}M)|Intel\(R\) Arc|Intel Arc|Adreno \(TM\) ?(?:7[3-9]\d|8\d\d)\b|Mali-G(?:7[1-9]|6[1-9]|[7-9]\d\d)/i;

/** Benchmark thresholds (screens of 720p per 60 fps frame). Calibrated so a Mali-G31 lands well under BENCH_HIGH. */
export const BENCH_HIGH = 8;
export const BENCH_ULTRA = 60;

const rank = (t: Tier) => TIERS.indexOf(t);
const minTier = (a: Tier, b: Tier): Tier => (rank(a) <= rank(b) ? a : b);

/** Why a tier was chosen: shown in the showroom and debug attributes, handy when a TV lands on the wrong path. */
export interface TierDecision {
  tier: Tier;
  cap: Tier;
  bench: Tier | null;
  reasons: string[];
}

/** The tier for these signals: the lower of the hardware cap and what the benchmark measured. */
export function classifyTier(s: DeviceSignals): TierDecision {
  const reasons: string[] = [];
  if (!s.webgl) return { tier: "lite", cap: "lite", bench: null, reasons: ["no WebGL"] };
  let cap: Tier = "ultra";
  const limit = (t: Tier, why: string) => {
    if (rank(t) < rank(cap)) {
      cap = t;
      reasons.push(why);
    }
  };
  const gpu = s.gpu ?? "";
  if (WEAK_GPU.test(gpu)) limit("lite", `weak or software GPU (${gpu.slice(0, 60)})`);
  if (s.memoryGb !== undefined) {
    if (s.memoryGb <= 1) limit("lite", `${s.memoryGb} GB memory`);
    else if (s.memoryGb <= 2) limit("high", `${s.memoryGb} GB memory`);
  }
  if (s.cores !== undefined) {
    if (s.cores <= 2) limit("lite", `${s.cores} CPU cores`);
    else if (s.cores <= 4) limit("high", `${s.cores} CPU cores`);
  }
  if (s.maxTextureSize !== undefined) {
    if (s.maxTextureSize < 4096) limit("lite", `max texture ${s.maxTextureSize}`);
    else if (s.maxTextureSize < 8192) limit("high", `max texture ${s.maxTextureSize}`);
  }
  if (s.tvApp) limit("high", "Play With TV app (a TV box)");

  let bench: Tier | null = null;
  if (s.benchScore !== undefined && Number.isFinite(s.benchScore)) {
    bench = s.benchScore < BENCH_HIGH ? "lite" : s.benchScore < BENCH_ULTRA ? "high" : "ultra";
    reasons.push(`benchmark ${s.benchScore.toFixed(1)} → ${bench}`);
  }
  // Without a benchmark, trust only a known strong GPU, and even then not with ultra.
  const measured: Tier = bench ?? (STRONG_GPU.test(gpu) ? "high" : "lite");
  if (bench === null) reasons.push(`no benchmark → ${measured}`);
  // ultra also needs a GPU we recognise as strong: a fast benchmark on an unknown chip gets high
  let tier = minTier(cap, measured);
  if (tier === "ultra" && !STRONG_GPU.test(gpu)) {
    tier = "high";
    reasons.push("ultra needs a known strong GPU");
  }
  return { tier, cap, bench, reasons };
}

/** `?quality=lite|high|ultra|auto` from a query string; anything else is ignored. */
export function parseOverride(search: string): QualitySetting | null {
  const v = new URLSearchParams(search).get("quality")?.toLowerCase();
  return v === "auto" || v === "lite" || v === "high" || v === "ultra" ? v : null;
}

/** The tier actually used: URL override, then the saved setting, then detection. */
export function effectiveTier(detected: Tier, setting: QualitySetting, override: QualitySetting | null): Tier {
  const chosen = override ?? setting;
  return chosen === "auto" ? detected : chosen;
}

/** The lobby chip cycles Auto → Lite → High → Ultra → Auto. */
export function nextSetting(s: QualitySetting): QualitySetting {
  const order: QualitySetting[] = ["auto", "lite", "high", "ultra"];
  return order[(order.indexOf(s) + 1) % order.length]!;
}

// ---- cache --------------------------------------------------------------------------------------------------

export const CACHE_VERSION = 1;
export interface CachedDetection {
  v: number;
  gpu: string;
  tier: Tier;
  score: number | null;
  at: number;
}

/** A cached detection is reused only for the same cache version and the same GPU string. */
export function cacheValid(c: unknown, gpu: string): c is CachedDetection {
  if (!c || typeof c !== "object") return false;
  const o = c as Partial<CachedDetection>;
  return o.v === CACHE_VERSION && o.gpu === gpu && typeof o.tier === "string" && (TIERS as readonly string[]).includes(o.tier);
}

// ---- profiles -----------------------------------------------------------------------------------------------

export type PostLevel = 0 | 1 | 2;

/** Everything a game reads to decide how expensive to be. Treat it as read-only. */
export interface QualityProfile {
  tier: Tier;
  /** Cap for renderer.setPixelRatio() when a canvas is sized in CSS pixels. */
  pixelRatioCap: number;
  /** Drawing-buffer size for a 16:9 full-stage canvas (the TV stage is 1920×1080 CSS px). */
  resolution: { w: number; h: number };
  /** WebGLRenderer `antialias` (MSAA on the default framebuffer; post-processing does its own AA). */
  msaa: boolean;
  /** Lambert/Toon (cheap), Standard (PBR) or Physical (PBR + clear coat, sheen, transmission). */
  materials: "lambert" | "standard" | "physical";
  /** Image-based lighting from an HDRI through PMREM. */
  envMap: boolean;
  shadows: { enabled: boolean; mapSize: number; soft: boolean };
  /** 0 none, 1 bloom + FXAA, 2 bloom + ambient occlusion + SMAA. */
  post: { level: PostLevel; bloom: boolean; ao: boolean; aa: "none" | "fxaa" | "smaa" };
  toneMapping: "none" | "agx" | "aces";
  /** Largest texture side to load (pick the asset variant at or below it). */
  maxTexture: number;
  /** How many particles (rain drops, sparks) a scene should keep alive at once. */
  particleBudget: number;
  /** File-name suffix of the asset variant for this tier: car-lite.webp, car-high.glb, car-ultra.glb. */
  assetSuffix: "-lite" | "-high" | "-ultra";
  /** Pre-rendered sprites and video backdrops (lite) instead of real-time models. */
  prerendered: boolean;
}

const PROFILES: Record<Tier, QualityProfile> = {
  lite: {
    tier: "lite", pixelRatioCap: 1, resolution: { w: 1280, h: 720 }, msaa: false, materials: "lambert", envMap: false,
    shadows: { enabled: false, mapSize: 0, soft: false }, post: { level: 0, bloom: false, ao: false, aa: "none" },
    toneMapping: "none", maxTexture: 1024, particleBudget: 150, assetSuffix: "-lite", prerendered: true,
  },
  high: {
    tier: "high", pixelRatioCap: 1.5, resolution: { w: 1920, h: 1080 }, msaa: false, materials: "standard", envMap: true,
    shadows: { enabled: true, mapSize: 1024, soft: true }, post: { level: 1, bloom: true, ao: false, aa: "fxaa" },
    toneMapping: "agx", maxTexture: 1024, particleBudget: 800, assetSuffix: "-high", prerendered: false,
  },
  ultra: {
    tier: "ultra", pixelRatioCap: 2, resolution: { w: 2560, h: 1440 }, msaa: false, materials: "physical", envMap: true,
    shadows: { enabled: true, mapSize: 2048, soft: true }, post: { level: 2, bloom: true, ao: true, aa: "smaa" },
    toneMapping: "agx", maxTexture: 2048, particleBudget: 3000, assetSuffix: "-ultra", prerendered: false,
  },
};

export function profileFor(tier: Tier): QualityProfile {
  return PROFILES[tier];
}
