/**
 * Tiffin Tornado asset paths and small loaders. Everything lives in /assets/tiffin/ (made by tools/blender/tiffin/,
 * see its README), plus shared CC0 packs already in the repo (KayKit animations, Kenney sounds, a Poly Haven HDRI).
 */
import * as THREE from "three";
import { loadSpriteSheet, type SpriteSheet } from "../../kit25d/spriteBatch";

export const BASE = "/assets/tiffin";
export const CHEF_SHEETS = 4;
export const PANO = { length: 18.04, height: 5.4 };
export const HDRI = "/assets/cinematic/showroom/kloofendal_overcast_puresky_1k.hdr";
export const ANIMATIONS = "/assets/kaykit-adventurers/animations.glb";

export interface KitchenInfo {
  level: number;
  pitchDeg: number;
  viewWidth: number;
  margin: number;
  /** Camera target in game coordinates (x, y, z). */
  target: [number, number, number];
  image: { w: number; h: number };
  cols: number;
  rows: number;
  backdrops: Partial<Record<"day" | "shut" | "dark", string>>;
}

export interface ChefClip { start: number; count: number; fps: number }
export type ChefSheet = SpriteSheet & { clips: Record<string, ChefClip> };

const json = (url: string) => fetch(url).then((r) => {
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
});

export function kitchenInfo(level: number): Promise<KitchenInfo> {
  return json(`${BASE}/kitchen-${level}.json`);
}

const textures = new Map<string, Promise<THREE.Texture>>();
/** An image texture through <img> (CSP-safe), sRGB, cached. */
export function texture(url: string, repeat = false): Promise<THREE.Texture> {
  const key = `${url}|${repeat}`;
  let p = textures.get(key);
  if (!p) {
    p = new THREE.TextureLoader().loadAsync(url).then((t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.generateMipmaps = false;
      t.minFilter = THREE.LinearFilter;
      if (repeat) t.wrapS = THREE.RepeatWrapping;
      return t;
    });
    p.catch(() => textures.delete(key));
    textures.set(key, p);
  }
  return p;
}

export async function chefSheet(i: number): Promise<ChefSheet> {
  const s = await loadSpriteSheet(`${BASE}/chef-${i}.json`);
  return Object.assign(s, { clips: (s.manifest as unknown as { clips: Record<string, ChefClip> }).clips });
}

export async function foodSheet(): Promise<{ sheet: SpriteSheet; index: Map<string, number> }> {
  const sheet = await loadSpriteSheet(`${BASE}/food.json`);
  const names = (sheet.manifest as unknown as { names: string[] }).names;
  return { sheet, index: new Map(names.map((n, i) => [n, i])) };
}

export const SCENERY = {
  far: `${BASE}/scenery-far.webp`,
  fields: `${BASE}/scenery-fields.webp`,
  platform: `${BASE}/scenery-platform.webp`,
  tunnel: `${BASE}/scenery-tunnel.webp`,
  track: `${BASE}/scenery-track.webp`,
};
