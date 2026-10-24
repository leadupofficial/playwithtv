/**
 * quality/detect: gathers device signals in the browser and runs a short GPU micro-benchmark (≤ 1.5 s, once per
 * device: the result is cached in localStorage under a version key and re-run when the GPU string changes).
 *
 * The benchmark draws full-screen layers of a lit, textured fragment shader into a 1280×720 canvas, doubling the
 * layer count until a batch takes ≥ 30 ms, and reports how many 720p screens fit in one 60 fps frame. A Mali-G31
 * manages a handful; an Apple M-series GPU hundreds. Raw WebGL, no three.js, so the lobby stays light.
 */
import { CACHE_VERSION, type CachedDetection, type DeviceSignals, type TierDecision, cacheValid, classifyTier } from "./tier";

const CACHE_KEY = "pwtv.quality.detect";

type GL = WebGLRenderingContext | WebGL2RenderingContext;

function context(canvas: HTMLCanvasElement): GL | null {
  const opts: WebGLContextAttributes = { antialias: false, depth: false, stencil: false, alpha: false, preserveDrawingBuffer: false, powerPreference: "high-performance", failIfMajorPerformanceCaveat: false };
  return (canvas.getContext("webgl2", opts) as GL | null) ?? (canvas.getContext("webgl", opts) as GL | null);
}

function release(gl: GL | null) {
  gl?.getExtension("WEBGL_lose_context")?.loseContext(); // give the memory back at once (1 GB TVs)
}

/** Static signals: GPU string, memory, cores, texture limit, the TV app's user-agent marker. */
export function readSignals(gl: GL | null): DeviceSignals {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const s: DeviceSignals = {
    webgl: !!gl,
    memoryGb: typeof nav.deviceMemory === "number" ? nav.deviceMemory : undefined,
    cores: typeof nav.hardwareConcurrency === "number" ? nav.hardwareConcurrency : undefined,
    tvApp: /PlayWithTV\//.test(nav.userAgent),
  };
  if (gl) {
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    s.gpu = String((dbg && gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) || gl.getParameter(gl.RENDERER) || "");
    s.maxTextureSize = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || undefined;
  }
  return s;
}

const VS = "attribute vec2 p; varying vec2 uv; void main(){ uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }";
// roughly what a lit, textured PBR-ish surface costs: two texture reads, a normal, a few lights, some pow()
const FS = `precision mediump float; varying vec2 uv; uniform sampler2D t; uniform float k;
void main(){
  vec3 c = texture2D(t, uv * 3.0 + k).rgb;
  vec3 n = normalize(vec3(texture2D(t, uv * 7.0 - k).rg * 2.0 - 1.0, 1.0));
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    vec3 l = normalize(vec3(sin(k + float(i)), cos(k * 0.7 + float(i)), 0.8));
    float d = max(dot(n, l), 0.0);
    float s = pow(max(dot(reflect(-l, n), vec3(0.0, 0.0, 1.0)), 0.0), 24.0);
    acc += c * d + s;
  }
  gl_FragColor = vec4(acc * 0.2, 0.08);
}`;

function program(gl: GL): WebGLProgram | null {
  const sh = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
  };
  const v = sh(gl.VERTEX_SHADER, VS), f = sh(gl.FRAGMENT_SHADER, FS);
  if (!v || !f) return null;
  const p = gl.createProgram()!;
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  gl.bindAttribLocation(p, 0, "p");
  gl.linkProgram(p);
  return gl.getProgramParameter(p, gl.LINK_STATUS) ? p : null;
}

/** Screens of 720p per 60 fps frame, or undefined if the benchmark could not run. */
export function benchmark(gl: GL, budgetMs = 1200): number | undefined {
  const prog = program(gl);
  if (!prog) return undefined;
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const size = 64, px = new Uint8Array(size * size * 4);
  for (let i = 0; i < px.length; i++) px[i] = (i * 2654435761) >>> 24; // deterministic noise
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); // every layer really costs fill (no early-z skipping)
  gl.viewport(0, 0, 1280, 720);
  const k = gl.getUniformLocation(prog, "k");
  const sink = new Uint8Array(4);
  const run = (layers: number) => {
    const t0 = performance.now();
    for (let i = 0; i < layers; i++) {
      gl.uniform1f(k, i * 0.013);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, sink); // waits for the GPU
    return performance.now() - t0;
  };
  const start = performance.now();
  run(1); // compile and warm up
  let layers = 2, best = 0;
  while (performance.now() - start < budgetMs) {
    const ms = run(layers);
    if (ms >= 30) {
      best = Math.max(best, (layers / ms) * (1000 / 60));
      if (performance.now() - start + ms > budgetMs) break;
      continue; // measure the same batch again: take the better of the two
    }
    if (layers >= 1024) {
      best = Math.max(best, (layers / Math.max(ms, 0.5)) * (1000 / 60));
      break;
    }
    layers *= 2;
  }
  if (gl.getError() !== gl.NO_ERROR && best === 0) return undefined;
  return best || undefined;
}

function readCache(): unknown {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null");
  } catch {
    return null;
  }
}
function writeCache(c: CachedDetection) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(c));
  } catch { /* private mode or full: detection simply runs again next time */ }
}

export interface Detection extends TierDecision {
  signals: DeviceSignals;
  cached: boolean;
}

/** Detects the tier (cached per GPU string; pass force to re-run the benchmark). */
export async function detectTier(opts: { force?: boolean; budgetMs?: number } = {}): Promise<Detection> {
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 720;
  const gl = context(canvas);
  try {
    const signals = readSignals(gl);
    const cached = readCache();
    if (!opts.force && cacheValid(cached, signals.gpu ?? "")) {
      const d = classifyTier({ ...signals, benchScore: cached.score ?? undefined });
      return { ...d, tier: cached.tier, signals: { ...signals, benchScore: cached.score ?? undefined }, cached: true };
    }
    await new Promise((r) => setTimeout(r, 0)); // let the page paint first
    if (gl) signals.benchScore = benchmark(gl, opts.budgetMs ?? 1200);
    const d = classifyTier(signals);
    writeCache({ v: CACHE_VERSION, gpu: signals.gpu ?? "", tier: d.tier, score: signals.benchScore ?? null, at: Date.now() });
    return { ...d, signals, cached: false };
  } finally {
    release(gl);
  }
}
