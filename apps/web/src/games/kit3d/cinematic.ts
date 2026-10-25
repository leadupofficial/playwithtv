/**
 * kit3d/cinematic: the high/ultra renderer, driven by the quality profile (apps/web/src/quality/).
 *
 *   const q = getQuality().profile;                       // or useQuality().profile in React
 *   const cine = createCinematic(canvas, q);
 *   await cine.environment(scene, "/assets/…/sky_1k.hdr", { background: true });
 *   cine.sun(scene, { position: [6, 10, 4] });            // shadow-casting key light sized by the profile
 *   prepareModel(model, q);                               // shadows on, env intensity, PBR kept
 *   loop: cine.render(scene, camera);                     // through bloom / AO / FXAA / SMAA as the tier allows
 *
 * PBR materials, PMREM image-based light from an HDRI (.hdr via HDRLoader, .exr via EXRLoader: both fetch the
 * same-origin file and decode in JavaScript, so they work under our CSP), soft shadows, AgX tone mapping, and an
 * EffectComposer chain gated by profile.post. Never use this on the lite tier: there, draw sprites (kit25d).
 */
import * as THREE from "three";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";
import { EXRLoader } from "three/examples/jsm/loaders/EXRLoader.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { FXAAPass } from "three/examples/jsm/postprocessing/FXAAPass.js";
import { SMAAPass } from "three/examples/jsm/postprocessing/SMAAPass.js";
import type { QualityProfile } from "../../quality/tier";
import { FrameGovernor, LEVELS, type GovernorLevel } from "./governor";

export interface Cinematic {
  renderer: THREE.WebGLRenderer;
  composer: EffectComposer | null;
  profile: QualityProfile;
  /** Loads an equirectangular HDRI as scene.environment (and optionally the background). */
  environment(scene: THREE.Scene, url: string, opts?: { background?: boolean; blur?: number; intensity?: number }): Promise<THREE.Texture>;
  /** A directional key light with a shadow camera fitted to `extent` metres around the origin. */
  sun(scene: THREE.Scene, opts?: { position?: [number, number, number]; color?: THREE.ColorRepresentation; intensity?: number; extent?: number }): THREE.DirectionalLight;
  /** Renders a frame (through the composer when the profile has post-processing). */
  render(scene: THREE.Scene, camera: THREE.Camera): void;
  /** Bloom strength, e.g. a punch on a hit (no-op without bloom). */
  setBloom(strength: number): void;
  /**
   * The adaptive-quality state: the frame governor sheds AO, render scale and bloom when the frame rate sags
   * and restores them when there is headroom. Show it in your debug attribute.
   */
  adaptive(): { level: number; fps: number } & GovernorLevel;
  dispose(): void;
}

const hdrCache = new Map<string, Promise<THREE.DataTexture>>();

function loadEquirect(url: string): Promise<THREE.DataTexture> {
  let p = hdrCache.get(url);
  if (!p) {
    const loader = /\.exr$/i.test(url) ? new EXRLoader() : new HDRLoader();
    loader.setDataType(THREE.HalfFloatType);
    p = loader.loadAsync(url).then((t) => {
      t.mapping = THREE.EquirectangularReflectionMapping;
      return t;
    });
    p.catch(() => hdrCache.delete(url));
    hdrCache.set(url, p);
  }
  return p;
}

/** Creates the renderer and post chain for a canvas, sized to profile.resolution (the canvas is CSS-stretched). */
export function createCinematic(canvas: HTMLCanvasElement, profile: QualityProfile, opts: { camera?: THREE.Camera; scene?: THREE.Scene; adaptive?: boolean } = {}): Cinematic {
  const { w, h } = profile.resolution;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: profile.msaa, powerPreference: "high-performance", stencil: false });
  renderer.setPixelRatio(1);
  renderer.setSize(w, h, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = profile.toneMapping === "agx" ? THREE.AgXToneMapping : profile.toneMapping === "aces" ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
  renderer.toneMappingExposure = 0.9;
  renderer.shadowMap.enabled = profile.shadows.enabled;
  renderer.shadowMap.type = THREE.PCFShadowMap; // r186 PCF is soft via shadow.radius (PCFSoft was folded in)

  let composer: EffectComposer | null = null;
  let bloom: UnrealBloomPass | null = null;
  let renderPass: RenderPass | null = null;
  let ao: GTAOPass | null = null;
  if (profile.post.level > 0) {
    const target = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType });
    composer = new EffectComposer(renderer, target);
    composer.setPixelRatio(1);
    composer.setSize(w, h);
    renderPass = new RenderPass(opts.scene ?? new THREE.Scene(), opts.camera ?? new THREE.PerspectiveCamera());
    composer.addPass(renderPass);
    if (profile.post.ao) {
      ao = new GTAOPass(opts.scene ?? new THREE.Scene(), opts.camera ?? new THREE.PerspectiveCamera(), w, h);
      ao.output = GTAOPass.OUTPUT.Default;
      composer.addPass(ao);
    }
    if (profile.post.bloom) {
      bloom = new UnrealBloomPass(new THREE.Vector2(w / 2, h / 2), 0.22, 0.5, 1.0); // only true highlights glow
      composer.addPass(bloom);
    }
    composer.addPass(new OutputPass()); // tone mapping + sRGB happen here
    if (profile.post.aa === "fxaa") composer.addPass(new FXAAPass());
    else if (profile.post.aa === "smaa") composer.addPass(new SMAAPass());
  }

  let pmrem: THREE.PMREMGenerator | null = null;
  const envTargets: THREE.WebGLRenderTarget[] = [];

  // Adaptive quality: timed between frames, applied before the next one. On by default; games that call
  // composer.render() themselves are covered too (the composer's render is wrapped).
  const governor = opts.adaptive === false ? null : new FrameGovernor(LEVELS.length);
  let level = 0, last = 0;
  const apply = (l: GovernorLevel) => {
    renderer.setPixelRatio(l.scale);           // drawing buffer = resolution × scale; viewports stay in CSS px
    if (composer) {
      composer.setPixelRatio(l.scale);         // resizes every pass's targets
      for (const p of composer.passes) {
        if (p instanceof GTAOPass) p.enabled = l.ao && profile.post.ao;
        if (p instanceof UnrealBloomPass) p.enabled = l.bloom && profile.post.bloom;
      }
    }
  };
  const govern = () => {
    if (!governor) return;
    const now = performance.now();
    const next = last ? governor.sample(now - last) : null;
    last = now;
    if (next !== null) {
      level = next;
      apply(LEVELS[level]!);
    }
  };
  if (composer) {
    const inner = composer.render.bind(composer);
    composer.render = (delta?: number) => {
      govern();
      inner(delta);
    };
  }

  return {
    renderer, composer, profile,
    async environment(scene, url, o = {}) {
      const eq = await loadEquirect(url);
      pmrem ??= new THREE.PMREMGenerator(renderer);
      const rt = pmrem.fromEquirectangular(eq);
      envTargets.push(rt);
      scene.environment = rt.texture;
      scene.environmentIntensity = o.intensity ?? 1;
      if (o.background) {
        scene.background = eq;
        scene.backgroundBlurriness = o.blur ?? 0;
        scene.backgroundIntensity = o.intensity ?? 1;
      }
      return rt.texture;
    },
    sun(scene, o = {}) {
      const l = new THREE.DirectionalLight(o.color ?? "#fff4e6", o.intensity ?? 2.2);
      l.position.set(...(o.position ?? [6, 10, 5]));
      if (profile.shadows.enabled) {
        l.castShadow = true;
        const e = o.extent ?? 6;
        const s = l.shadow;
        s.mapSize.set(profile.shadows.mapSize, profile.shadows.mapSize);
        Object.assign(s.camera, { left: -e, right: e, top: e, bottom: -e, near: 0.5, far: 60 });
        s.camera.updateProjectionMatrix();
        s.bias = -0.0004;
        s.normalBias = 0.02;
        s.radius = profile.shadows.soft ? (profile.tier === "ultra" ? 5 : 3) : 1;
      }
      scene.add(l, l.target);
      return l;
    },
    render(scene, camera) {
      if (!composer) {
        govern();
        renderer.render(scene, camera);
        return;
      }
      renderPass!.scene = scene;
      renderPass!.camera = camera;
      if (ao) {
        ao.scene = scene;
        ao.camera = camera;
      }
      renderer.info.autoReset = false; // count every pass of the frame, not just the last one
      renderer.info.reset();
      composer.render();
    },
    adaptive() {
      return { level, fps: Math.round(governor?.fps ?? 0), ...LEVELS[level]! };
    },
    setBloom(strength) {
      if (bloom) bloom.strength = strength;
    },
    dispose() {
      for (const rt of envTargets) rt.dispose();
      pmrem?.dispose();
      composer?.dispose();
      renderer.dispose();
    },
  };
}

/**
 * Readies a loaded glTF for the cinematic renderer: shadows on every mesh, environment light strength, and on
 * the high tier MeshPhysicalMaterial (clear coat …) is kept only when cheap enough (ultra keeps everything).
 */
export function prepareModel(root: THREE.Object3D, profile: QualityProfile, opts: { envIntensity?: number } = {}) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = mesh.receiveShadow = profile.shadows.enabled;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      const s = m as THREE.MeshStandardMaterial;
      if (!s.isMeshStandardMaterial) continue;
      s.envMapIntensity = opts.envIntensity ?? 1;
      for (const t of [s.map, s.aoMap, s.normalMap, s.roughnessMap]) if (t) t.anisotropy = profile.tier === "ultra" ? 8 : 4;
    }
  });
}
