/**
 * kit3d/multiview: split-screen rendering, with or without the cinematic post chain.
 *
 *   const views: View[] = [{ camera: a, x: 0, y: 360, w: 1280, h: 360 }, { camera: b, x: 0, y: 0, w: 1280, h: 360 }];
 *   renderViews(renderer, scene, views);                 // plain renderer (lite tier): scissored views
 *   const mv = useMultiView(cine, scene);                // cinematic: swaps the RenderPass for a MultiViewPass
 *   mv.views = views; cine.composer!.render();           // bloom / FXAA run once over the whole split screen
 *
 * Rects are drawing-buffer pixels with a bottom-left origin (WebGL's). `before()` runs right before a view draws
 * (point sprites at that camera, move the shadow-casting sun to that player, ...). Ambient occlusion (GTAO) needs
 * one camera, so useMultiView drops it when there is more than one view.
 */
import * as THREE from "three";
import { Pass } from "three/examples/jsm/postprocessing/Pass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import type { Cinematic } from "./cinematic";

export interface View {
  camera: THREE.Camera;
  x: number; y: number; w: number; h: number;
  before?: () => void;
}

const clear = new THREE.Color();

function drawViews(renderer: THREE.WebGLRenderer, scene: THREE.Scene, views: View[], target: THREE.WebGLRenderTarget | null) {
  const autoClear = renderer.autoClear;
  renderer.autoClear = false;
  renderer.setRenderTarget(target);
  renderer.getClearColor(clear);
  renderer.clear();
  for (const v of views) {
    v.before?.();
    if (target) {
      target.viewport.set(v.x, v.y, v.w, v.h);
      target.scissor.set(v.x, v.y, v.w, v.h);
      target.scissorTest = true;
      renderer.setRenderTarget(target); // re-applies the target's viewport and scissor
    } else {
      renderer.setViewport(v.x, v.y, v.w, v.h);
      renderer.setScissor(v.x, v.y, v.w, v.h);
      renderer.setScissorTest(true);
    }
    renderer.clearDepth();
    renderer.render(scene, v.camera);
  }
  if (target) {
    target.viewport.set(0, 0, target.width, target.height);
    target.scissor.set(0, 0, target.width, target.height);
    target.scissorTest = false;
    renderer.setRenderTarget(target);
  } else {
    const s = renderer.getDrawingBufferSize(new THREE.Vector2());
    renderer.setViewport(0, 0, s.x / renderer.getPixelRatio(), s.y / renderer.getPixelRatio());
    renderer.setScissorTest(false);
  }
  renderer.autoClear = autoClear;
}

/** Renders every view straight to the canvas (no post-processing). */
export function renderViews(renderer: THREE.WebGLRenderer, scene: THREE.Scene, views: View[]) {
  renderer.info.autoReset = false;
  renderer.info.reset();
  drawViews(renderer, scene, views, null);
}

/** A composer pass that draws several cameras into one image (replaces RenderPass). */
export class MultiViewPass extends Pass {
  views: View[] = [];
  constructor(public scene: THREE.Scene) {
    super();
    this.needsSwap = false;
  }
  override render(renderer: THREE.WebGLRenderer, _write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget) {
    drawViews(renderer, this.scene, this.views, this.renderToScreen ? null : read);
  }
}

/** Puts a MultiViewPass in place of the cinematic composer's RenderPass (and drops GTAO for split screens). */
export function useMultiView(cine: Cinematic, scene: THREE.Scene, views: number): MultiViewPass {
  const composer = cine.composer!;
  const pass = new MultiViewPass(scene);
  const first = composer.passes.findIndex((p) => p instanceof RenderPass);
  if (first >= 0) {
    composer.removePass(composer.passes[first]!);
    composer.insertPass(pass, first);
  } else composer.insertPass(pass, 0);
  if (views > 1) for (const p of [...composer.passes]) if (p instanceof GTAOPass) composer.removePass(p);
  return pass;
}
