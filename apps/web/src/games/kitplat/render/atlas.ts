/**
 * kitplat/render/atlas: loads the named-sprite atlases written by tools/blender/kitplat ("pwtv-plat" v1). On the
 * lite tier it loads the half-size "-lite" copy (UVs are fractions, so the manifest is unchanged) and never an
 * atlas larger than 1536 px. Every load is counted in decodedBytes() (width × height × 4), which the game
 * exposes in its debug attribute so tests can hold a level to the TV's memory budget.
 */
import * as THREE from "three";

export interface Rect { x: number; y: number; w: number; h: number }
export interface SpriteDef { frames: Rect[]; pivot: { x: number; y: number }; fps: number; loop: boolean; box?: [number, number, number, number] }
export interface AtlasManifest {
  format: "pwtv-plat";
  version: 1;
  name: string;
  image: string;
  /** Half-size copy, present only when the atlas is larger than the lite cap. */
  lite: string | null;
  size: { w: number; h: number };
  /** Atlas pixels per tile at full size. */
  ppm: number;
  sprites: Record<string, SpriteDef>;
}

export interface Atlas { manifest: AtlasManifest; texture: THREE.Texture; url: string; bytes: number }

export const LITE_MAX_ATLAS = 1536;

let decoded = 0;
const loaded = new Map<string, Promise<Atlas>>();

/** Bytes of decoded image memory held by atlases and backdrops loaded so far (w × h × 4 each). */
export function decodedBytes(): number {
  return decoded;
}

export function parseAtlas(json: unknown): AtlasManifest {
  const m = json as Partial<AtlasManifest> | null;
  if (!m || m.format !== "pwtv-plat" || m.version !== 1) throw new Error("kitplat atlas: unknown format");
  if (!m.sprites || typeof m.sprites !== "object") throw new Error("kitplat atlas: no sprites");
  for (const [id, s] of Object.entries(m.sprites)) {
    if (!Array.isArray(s.frames) || !s.frames.length) throw new Error(`kitplat atlas: sprite ${id} has no frames`);
    for (const r of s.frames) if (r.x < 0 || r.y < 0 || r.x + r.w > m.size!.w || r.y + r.h > m.size!.h) throw new Error(`kitplat atlas: ${id} frame outside the atlas`);
  }
  return m as AtlasManifest;
}

/** Loads an image as a texture through an <img> (allowed by the CSP), counting its decoded size. */
export function loadImage(url: string, opts: { repeat?: boolean } = {}): Promise<{ texture: THREE.Texture; bytes: number }> {
  return new THREE.TextureLoader().loadAsync(url).then((t) => {
    const img = t.image as HTMLImageElement;
    const bytes = (img.naturalWidth || img.width) * (img.naturalHeight || img.height) * 4;
    decoded += bytes;
    t.colorSpace = THREE.SRGBColorSpace;
    t.generateMipmaps = false;
    t.minFilter = THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    if (opts.repeat) t.wrapS = THREE.RepeatWrapping;
    return { texture: t, bytes };
  });
}

/** Loads an atlas (cached per URL and tier). On `lite`, atlases over 1536 px load their half-size copy. */
export function loadAtlas(manifestUrl: string, lite: boolean): Promise<Atlas> {
  const key = `${manifestUrl}|${lite ? 1 : 0}`;
  let p = loaded.get(key);
  if (!p) {
    p = (async () => {
      const res = await fetch(manifestUrl);
      if (!res.ok) throw new Error(`atlas ${manifestUrl}: HTTP ${res.status}`);
      const manifest = parseAtlas(await res.json());
      const base = manifestUrl.slice(0, manifestUrl.lastIndexOf("/") + 1);
      // the TV takes the full-size sheet when it already fits the lite cap (sharper), else the half-size copy
      const file = lite && manifest.lite && Math.max(manifest.size.w, manifest.size.h) > LITE_MAX_ATLAS ? manifest.lite : manifest.image;
      const { texture, bytes } = await loadImage(base + file);
      return { manifest, texture, url: manifestUrl, bytes };
    })();
    p.catch(() => loaded.delete(key));
    loaded.set(key, p);
  }
  return p;
}

/** Releases every cached atlas texture (when a game ends) and resets the memory counter. */
export function releaseAtlases() {
  for (const p of loaded.values()) void p.then((a) => a.texture.dispose()).catch(() => undefined);
  loaded.clear();
  decoded = 0;
}

/** Frame index of a sprite at `t` seconds (looping or holding the last frame). */
export function frameOf(s: Pick<SpriteDef, "frames" | "fps" | "loop">, t: number): number {
  const n = s.frames.length;
  if (n <= 1) return 0;
  const f = Math.floor(Math.max(0, t) * s.fps);
  return s.loop ? f % n : Math.min(n - 1, f);
}
