import { describe, expect, it } from "vitest";
import {
  BENCH_HIGH, BENCH_ULTRA, CACHE_VERSION, type DeviceSignals, cacheValid, classifyTier, effectiveTier, nextSetting, parseOverride, profileFor,
} from "./tier";

// Real renderer strings (Chrome reports them through WEBGL_debug_renderer_info / RENDERER).
const MALI_G31 = "Mali-G31";
const MALI_G52 = "ANGLE (ARM, Mali-G52 MC2, OpenGL ES 3.2)";
const SWIFTSHADER = "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)";
const APPLE_M4 = "ANGLE (Apple, ANGLE Metal Renderer: Apple M4, Unspecified Version)";
const INTEL_UHD = "ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)";
const RTX = "ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Laptop GPU Direct3D11 vs_5_0 ps_5_0, D3D11)";
const TV_UA_FLAG = { tvApp: true };

const desk = (gpu: string, benchScore?: number, extra: Partial<DeviceSignals> = {}): DeviceSignals =>
  ({ webgl: true, gpu, memoryGb: 8, cores: 10, maxTextureSize: 16384, benchScore, ...extra });

describe("classifyTier", () => {
  it("the owner's TV (Mali-G31, 1 GB, the TV app) is lite whatever the benchmark says", () => {
    const d = classifyTier({ webgl: true, gpu: MALI_G31, memoryGb: 1, cores: 4, maxTextureSize: 8192, benchScore: 999, ...TV_UA_FLAG });
    expect(d.tier).toBe("lite");
    expect(d.reasons.join(" ")).toMatch(/weak or software GPU/);
  });

  it("no WebGL at all is lite", () => {
    expect(classifyTier({ webgl: false }).tier).toBe("lite");
  });

  it("software rendering (SwiftShader, headless CI) is lite", () => {
    expect(classifyTier(desk(SWIFTSHADER, 500)).tier).toBe("lite");
  });

  it("an Apple M-series laptop with a strong benchmark is ultra", () => {
    expect(classifyTier(desk(APPLE_M4, 370)).tier).toBe("ultra");
  });

  it("integrated Intel graphics is high when the benchmark lands between the thresholds", () => {
    expect(classifyTier(desk(INTEL_UHD, 25)).tier).toBe("high");
  });

  it("a fast benchmark on a GPU we do not recognise as strong stops at high", () => {
    const d = classifyTier(desk("Some New GPU 9000", 400));
    expect(d.tier).toBe("high");
    expect(d.reasons.join(" ")).toMatch(/known strong GPU/);
  });

  it("the benchmark thresholds decide between lite, high and ultra", () => {
    expect(classifyTier(desk(RTX, BENCH_HIGH - 0.1)).tier).toBe("lite");
    expect(classifyTier(desk(RTX, BENCH_HIGH)).tier).toBe("high");
    expect(classifyTier(desk(RTX, BENCH_ULTRA - 0.1)).tier).toBe("high");
    expect(classifyTier(desk(RTX, BENCH_ULTRA)).tier).toBe("ultra");
  });

  it("hardware caps: memory, cores, texture size and the TV app limit the tier", () => {
    expect(classifyTier(desk(RTX, 400, { memoryGb: 1 })).tier).toBe("lite");
    expect(classifyTier(desk(RTX, 400, { memoryGb: 2 })).tier).toBe("high");
    expect(classifyTier(desk(RTX, 400, { cores: 2 })).tier).toBe("lite");
    expect(classifyTier(desk(RTX, 400, { cores: 4 })).tier).toBe("high");
    expect(classifyTier(desk(RTX, 400, { maxTextureSize: 2048 })).tier).toBe("lite");
    expect(classifyTier(desk(RTX, 400, { maxTextureSize: 4096 })).tier).toBe("high");
    expect(classifyTier(desk(RTX, 400, TV_UA_FLAG)).tier).toBe("high");
  });

  it("a mid TV box (Mali-G52) stays lite", () => {
    expect(classifyTier(desk(MALI_G52, 30, { memoryGb: 2, cores: 4 })).tier).toBe("lite");
  });

  it("without a benchmark only a known strong GPU gets past lite, and never to ultra", () => {
    expect(classifyTier(desk(APPLE_M4)).tier).toBe("high");
    expect(classifyTier(desk(INTEL_UHD)).tier).toBe("lite");
  });

  it("unknown memory or cores do not cap anything", () => {
    expect(classifyTier({ webgl: true, gpu: APPLE_M4, benchScore: 300 }).tier).toBe("ultra");
  });
});

describe("overrides and settings", () => {
  it("parses ?quality= and ignores junk", () => {
    expect(parseOverride("?quality=ultra")).toBe("ultra");
    expect(parseOverride("?x=1&quality=LITE")).toBe("lite");
    expect(parseOverride("?quality=auto")).toBe("auto");
    expect(parseOverride("?quality=max")).toBeNull();
    expect(parseOverride("")).toBeNull();
  });

  it("URL override beats the saved setting, which beats detection", () => {
    expect(effectiveTier("lite", "auto", null)).toBe("lite");
    expect(effectiveTier("lite", "high", null)).toBe("high");
    expect(effectiveTier("lite", "high", "ultra")).toBe("ultra");
    expect(effectiveTier("high", "lite", "auto")).toBe("high");
  });

  it("the lobby chip cycles Auto → Lite → High → Ultra → Auto", () => {
    expect([nextSetting("auto"), nextSetting("lite"), nextSetting("high"), nextSetting("ultra")]).toEqual(["lite", "high", "ultra", "auto"]);
  });
});

describe("detection cache", () => {
  const good = { v: CACHE_VERSION, gpu: APPLE_M4, tier: "ultra", score: 370, at: 1 };
  it("is reused for the same version and GPU only", () => {
    expect(cacheValid(good, APPLE_M4)).toBe(true);
    expect(cacheValid(good, INTEL_UHD)).toBe(false);                 // a new GPU (laptop docked, new TV) re-runs
    expect(cacheValid({ ...good, v: CACHE_VERSION + 1 }, APPLE_M4)).toBe(false);
    expect(cacheValid({ ...good, tier: "insane" }, APPLE_M4)).toBe(false);
    expect(cacheValid(null, APPLE_M4)).toBe(false);
    expect(cacheValid("x", APPLE_M4)).toBe(false);
  });
});

describe("profiles", () => {
  it("lite stays inside the kit3d budget: 720p, no shadow maps, no post, no PBR", () => {
    const p = profileFor("lite");
    expect(p.resolution).toEqual({ w: 1280, h: 720 });
    expect(p.shadows.enabled).toBe(false);
    expect(p.post.level).toBe(0);
    expect(p.materials).toBe("lambert");
    expect(p.prerendered).toBe(true);
    expect(p.pixelRatioCap).toBe(1);
  });

  it("each tier is at least as expensive as the one below", () => {
    const [l, h, u] = (["lite", "high", "ultra"] as const).map(profileFor);
    for (const [a, b] of [[l!, h!], [h!, u!]] as const) {
      expect(b.resolution.w).toBeGreaterThanOrEqual(a.resolution.w);
      expect(b.shadows.mapSize).toBeGreaterThanOrEqual(a.shadows.mapSize);
      expect(b.post.level).toBeGreaterThanOrEqual(a.post.level);
      expect(b.particleBudget).toBeGreaterThan(a.particleBudget);
      expect(b.maxTexture).toBeGreaterThanOrEqual(a.maxTexture);
    }
    expect(u!.post.ao).toBe(true);
    expect(u!.post.aa).toBe("smaa");
    expect(h!.post.aa).toBe("fxaa");
  });

  it("asset suffixes name the variant files", () => {
    expect(["lite", "high", "ultra"].map((t) => profileFor(t as "lite").assetSuffix)).toEqual(["-lite", "-high", "-ultra"]);
  });
});
