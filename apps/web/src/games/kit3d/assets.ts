/**
 * kit3d/assets: cached glTF loading and cheap materials for low-end TVs.
 *
 *   const gltf = await loadGltf("/assets/kaykit-adventurers/knight.glb");   // cached per URL
 *   const copy = cloneModel(gltf.scene);                                    // skinned meshes keep their bones
 *   cheapMaterials(copy, "toon");                                           // PBR → Toon/Lambert, same textures
 *
 * Only plain glTF/GLB: no Draco, meshopt or KTX2 (they need WebAssembly, which our CSP does not allow).
 * KHR_mesh_quantization is fine (three decodes it natively).
 *
 * CSP note: three's GLTFLoader normally decodes embedded (GLB) textures with ImageBitmapLoader, which fetch()es
 * a blob: URL; our CSP's connect-src blocks that, so textures silently fail in production. The loader here
 * registers a plugin that decodes them through an <img> element instead (img-src allows blob:).
 */
import * as THREE from "three";
import { GLTFLoader, type GLTF, type GLTFParser } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as skeletonClone } from "three/examples/jsm/utils/SkeletonUtils.js";

const cache = new Map<string, Promise<GLTF>>();

/** GLTFLoader plugin: load every texture image through an <img> (TextureLoader) rather than fetch + ImageBitmap. */
function imageElementTextures(parser: GLTFParser) {
  const textureLoader = new THREE.TextureLoader(parser.options.manager);
  return {
    name: "pwtv_image_element_textures",
    loadTexture(textureIndex: number) {
      const def = (parser.json as { textures: Array<{ source?: number }> }).textures[textureIndex];
      if (def?.source === undefined) return null; // other plugins (e.g. extension-only sources) handle it
      return parser.loadTextureImage(textureIndex, def.source, textureLoader);
    },
  };
}
let loader: GLTFLoader | null = null;

/** Loads a glTF/GLB once; later calls with the same URL share the result (clone before adding to a scene). */
export function loadGltf(url: string): Promise<GLTF> {
  let p = cache.get(url);
  if (!p) {
    loader ??= new GLTFLoader().register(imageElementTextures);
    p = loader.loadAsync(url);
    p.catch(() => cache.delete(url)); // a failed load can be retried
    cache.set(url, p);
  }
  return p;
}

/** Loads several files in parallel, reporting progress 0..1. */
export async function loadAll(urls: string[], onProgress?: (p: number) => void): Promise<GLTF[]> {
  let done = 0;
  return Promise.all(urls.map((u) => loadGltf(u).then((g) => {
    onProgress?.(++done / urls.length);
    return g;
  })));
}

/** A copy of a loaded model. Skinned meshes get their own skeleton (SkeletonUtils), so each copy animates alone. */
export function cloneModel<T extends THREE.Object3D>(src: T): T {
  return skeletonClone(src) as T;
}

let toonRamp: THREE.DataTexture | null = null;
/** A 3-step light ramp for MeshToonMaterial (shadow, mid, lit): a clean cartoon look at Lambert cost. */
export function toonGradient(): THREE.DataTexture {
  if (toonRamp) return toonRamp;
  const data = new Uint8Array([90, 90, 90, 255, 175, 175, 175, 255, 255, 255, 255, 255]);
  toonRamp = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  toonRamp.minFilter = toonRamp.magFilter = THREE.NearestFilter;
  toonRamp.needsUpdate = true;
  return toonRamp;
}

/**
 * Replaces every material under `root` with a cheap one (Lambert or 3-step Toon) that keeps the colour map
 * and vertex colours. Each mesh gets its own material instance (so it can be tinted or flashed alone).
 */
export function cheapMaterials(root: THREE.Object3D, kind: "lambert" | "toon" = "lambert") {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const swap = (m: THREE.Material) => {
      const src = m as THREE.MeshStandardMaterial;
      const opts = {
        map: src.map ?? null, color: src.color?.clone() ?? new THREE.Color("#fff"), vertexColors: src.vertexColors,
        transparent: src.transparent, opacity: src.opacity, side: src.side, alphaTest: src.alphaTest,
      };
      if (opts.map) opts.map.anisotropy = 1;
      const out = kind === "toon" ? new THREE.MeshToonMaterial({ ...opts, gradientMap: toonGradient() }) : new THREE.MeshLambertMaterial(opts);
      out.name = m.name;
      m.dispose();
      return out;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
  });
}

/** Finds a node by exact name (bones included). */
export function findNode(root: THREE.Object3D, name: string): THREE.Object3D | null {
  return root.getObjectByName(name) ?? null;
}

/** Frees GPU memory for everything under `root` (geometries, materials, textures). */
export function disposeTree(root: THREE.Object3D) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      for (const v of Object.values(m)) if (v instanceof THREE.Texture) v.dispose();
      m.dispose();
    }
  });
}
