/**
 * Game-agnostic performance probe for the TV page. It needs nothing from the game: it wraps WebGL (draw calls,
 * triangles, live texture memory), requestAnimationFrame (frame times and the JS time each frame costs) and reads
 * resource timing (bytes downloaded). Any new game is measured the moment it is in the catalogue.
 */
import type { Page } from "@playwright/test";

export interface PerfSample {
  frames: number;
  /** frames per second over the sample window (software GL on CI: compare runs on the same machine only) */
  fps: number;
  /** median and 95th-percentile draw calls / triangles per frame */
  calls: number;
  callsP95: number;
  tris: number;
  trisP95: number;
  /** JS time spent in animation-frame callbacks, ms per frame (median, 95th percentile) */
  scriptMs: number;
  scriptMsP95: number;
  /** live GPU texture memory (estimate), MB: now and the peak since the game started */
  texMB: number;
  texPeakMB: number;
  /** bytes the game downloaded after Start was pressed, KB */
  downloadKB: number;
  heapMB: number;
}

/** Install before the TV page loads (context.addInitScript). Exposes window.__perf. */
export function perfProbe() {
  type Gl = WebGLRenderingContext | WebGL2RenderingContext;
  const P = {
    calls: 0, tris: 0, work: 0, texBytes: 0, texPeak: 0,
    frames: [] as Array<{ t: number; calls: number; tris: number; work: number }>,
    resetAt: 0, resIndex: 0,
  };
  (window as unknown as { __perf: typeof P }).__perf = P;

  const tri = (mode: number, count: number, inst = 1) =>
    mode === 4 ? Math.floor(count / 3) * inst : mode === 5 || mode === 6 ? Math.max(0, count - 2) * inst : 0;
  const state = new WeakMap<Gl, { unit: number; bound: Map<string, WebGLTexture | null> }>();
  const st = (gl: Gl) => {
    let s = state.get(gl);
    if (!s) state.set(gl, (s = { unit: 0x84c0, bound: new Map() }));
    return s;
  };
  const sizes = new WeakMap<WebGLTexture, Map<string, number>>();
  const bpp = (type: number) => (type === 0x1406 ? 16 : type === 0x140b || type === 0x8d61 ? 8 : 4);
  const setBytes = (gl: Gl, target: number, key: string, bytes: number) => {
    const bindTarget = target >= 0x8515 && target <= 0x851a ? 0x8513 : target; // cube faces → the cube map
    const s = st(gl);
    const tex = s.bound.get(`${s.unit}:${bindTarget}`);
    if (!tex) return;
    let m = sizes.get(tex);
    if (!m) sizes.set(tex, (m = new Map()));
    P.texBytes += bytes - (m.get(key) ?? 0);
    m.set(key, bytes);
    P.texPeak = Math.max(P.texPeak, P.texBytes);
  };
  const dims = (src: unknown): [number, number] => {
    const o = src as { videoWidth?: number; videoHeight?: number; naturalWidth?: number; naturalHeight?: number; width?: number; height?: number } | null;
    if (!o) return [0, 0];
    return [o.videoWidth || o.naturalWidth || o.width || 0, o.videoHeight || o.naturalHeight || o.height || 0];
  };

  for (const C of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
    if (!C) continue;
    const p = C.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
    const wrap = (name: string, before: (gl: Gl, a: unknown[]) => void) => {
      const orig = p[name];
      if (!orig) return;
      p[name] = function (this: Gl, ...a: unknown[]) {
        before(this, a);
        return orig.apply(this, a);
      };
    };
    const n = (v: unknown) => Number(v) || 0;
    wrap("drawArrays", (_, a) => { P.calls++; P.tris += tri(n(a[0]), n(a[2])); });
    wrap("drawElements", (_, a) => { P.calls++; P.tris += tri(n(a[0]), n(a[1])); });
    wrap("drawArraysInstanced", (_, a) => { P.calls++; P.tris += tri(n(a[0]), n(a[2]), n(a[3])); });
    wrap("drawElementsInstanced", (_, a) => { P.calls++; P.tris += tri(n(a[0]), n(a[1]), n(a[4])); });
    wrap("drawRangeElements", (_, a) => { P.calls++; P.tris += tri(n(a[0]), n(a[3])); });
    wrap("activeTexture", (gl, a) => { st(gl).unit = n(a[0]); });
    wrap("bindTexture", (gl, a) => { const s = st(gl); s.bound.set(`${s.unit}:${n(a[0])}`, a[1] as WebGLTexture | null); });
    wrap("texImage2D", (gl, a) => {
      const [w, h, type] = a.length >= 8 ? [n(a[3]), n(a[4]), n(a[7])] : [...dims(a[5]), n(a[4])];
      setBytes(gl, n(a[0]), `${n(a[0])}:${n(a[1])}`, w * h * bpp(type));
    });
    wrap("compressedTexImage2D", (gl, a) => {
      const data = a[6] as ArrayBufferView | undefined;
      setBytes(gl, n(a[0]), `${n(a[0])}:${n(a[1])}`, data?.byteLength ?? n(a[3]) * n(a[4]));
    });
    wrap("texStorage2D", (gl, a) => setBytes(gl, n(a[0]), "storage", n(a[3]) * n(a[4]) * 4 * (n(a[1]) > 1 ? 4 / 3 : 1)));
    wrap("texImage3D", (gl, a) => setBytes(gl, n(a[0]), `${n(a[0])}:${n(a[1])}`, n(a[3]) * n(a[4]) * n(a[5]) * bpp(n(a[8]))));
    wrap("texStorage3D", (gl, a) => setBytes(gl, n(a[0]), "storage", n(a[3]) * n(a[4]) * n(a[5]) * 4 * (n(a[1]) > 1 ? 4 / 3 : 1)));
    wrap("generateMipmap", (gl, a) => {
      const s = st(gl);
      const tex = s.bound.get(`${s.unit}:${n(a[0])}`);
      const base = tex ? sizes.get(tex)?.get(`${n(a[0])}:0`) ?? 0 : 0;
      setBytes(gl, n(a[0]), `${n(a[0])}:mips`, base / 3);
    });
    wrap("deleteTexture", (_, a) => {
      const m = a[0] ? sizes.get(a[0] as WebGLTexture) : undefined;
      if (!m) return;
      for (const v of m.values()) P.texBytes -= v;
      sizes.delete(a[0] as WebGLTexture);
    });
  }

  // frame boundaries: our own callback closes a frame each time it runs; game callbacks are timed
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => raf((ts) => {
    const t0 = performance.now();
    try { cb(ts); } finally { P.work += performance.now() - t0; }
  });
  const tick = (t: number) => {
    P.frames.push({ t, calls: P.calls, tris: P.tris, work: P.work });
    if (P.frames.length > 2000) P.frames.splice(0, 1000);
    P.calls = 0; P.tris = 0; P.work = 0;
    raf(tick);
  };
  raf(tick);
}

/** Forget everything measured so far (frames; download bytes count from here on). */
export async function perfReset(tv: Page) {
  await tv.evaluate(() => {
    const P = (window as unknown as { __perf: { frames: unknown[]; texPeak: number; texBytes: number; resIndex: number } }).__perf;
    P.frames = [];
    P.texPeak = P.texBytes;
    P.resIndex = performance.getEntriesByType("resource").length;
  });
}

/** Marks the start of the game's downloads (call right before pressing Start). */
export async function perfMarkDownloads(tv: Page) {
  await tv.evaluate(() => {
    (window as unknown as { __perf: { resIndex: number } }).__perf.resIndex = performance.getEntriesByType("resource").length;
  });
}

export async function perfDownloadKB(tv: Page): Promise<number> {
  return tv.evaluate(() => {
    const P = (window as unknown as { __perf: { resIndex: number } }).__perf;
    const list = performance.getEntriesByType("resource").slice(P.resIndex) as PerformanceResourceTiming[];
    return Math.round(list.reduce((s, r) => s + (r.encodedBodySize || r.transferSize || 0), 0) / 1024);
  });
}

export async function perfSample(tv: Page, ms: number, downloadKB: number): Promise<PerfSample> {
  await tv.evaluate(() => {
    const P = (window as unknown as { __perf: { frames: unknown[] } }).__perf;
    P.frames = [];
  });
  await tv.waitForTimeout(ms);
  return tv.evaluate((downloadKB) => {
    const P = (window as unknown as { __perf: { frames: Array<{ t: number; calls: number; tris: number; work: number }>; texBytes: number; texPeak: number } }).__perf;
    const f = P.frames.slice(1);
    const q = (xs: number[], p: number) => {
      const s = [...xs].sort((a, b) => a - b);
      return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))]! : 0;
    };
    const span = f.length > 1 ? (f[f.length - 1]!.t - f[0]!.t) / 1000 : 0;
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    const r1 = (x: number) => Math.round(x * 10) / 10;
    return {
      frames: f.length,
      fps: span > 0 ? r1((f.length - 1) / span) : 0,
      calls: q(f.map((x) => x.calls), 0.5), callsP95: q(f.map((x) => x.calls), 0.95),
      tris: q(f.map((x) => x.tris), 0.5), trisP95: q(f.map((x) => x.tris), 0.95),
      scriptMs: r1(q(f.map((x) => x.work), 0.5)), scriptMsP95: r1(q(f.map((x) => x.work), 0.95)),
      texMB: r1(P.texBytes / 2 ** 20), texPeakMB: r1(P.texPeak / 2 ** 20),
      downloadKB,
      heapMB: mem ? r1(mem.usedJSHeapSize / 2 ** 20) : 0,
    };
  }, downloadKB);
}
