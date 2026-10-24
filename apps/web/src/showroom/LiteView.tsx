import { useEffect, useRef } from "react";
import * as THREE from "three";
import { VideoBackdrop } from "../games/kit25d/VideoBackdrop";
import { SpriteBatch, loadSpriteSheet } from "../games/kit25d/spriteBatch";
import type { QualityProfile } from "../quality/tier";
import { ASSETS, type ViewStats, type ViewControl } from "./common";

const TINTS = ["#ff4f8b", "#3fa9ff", "#ffc23d", "#7be05a"];

/**
 * The lite tier: a hardware-decoded video loop behind a transparent canvas, and pre-lit sprites (one draw call
 * for all five cars). Lambert-free: the light is baked into the sheet; a lightning flash relights it through
 * the normal-map sheet.
 */
export function LiteView({ profile, control, onStats }: { profile: QualityProfile; control: React.RefObject<ViewControl>; onStats: (s: ViewStats) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let alive = true, raf = 0;
    const { w, h } = profile.resolution;
    const renderer = new THREE.WebGLRenderer({ canvas: canvas.current!, alpha: true, antialias: false, premultipliedAlpha: true });
    renderer.setPixelRatio(1);
    renderer.setSize(w, h, false);
    renderer.setClearColor(0x000000, 0);
    const scene = new THREE.Scene();
    // orthographic, pitched 30° like the sprite camera: the sheet's perspective matches exactly
    const camera = new THREE.OrthographicCamera(-8, 8, 4.5, -4.5, 0.1, 100);
    const pitch = THREE.MathUtils.degToRad(30);
    camera.position.set(0, Math.sin(pitch) * 20, Math.cos(pitch) * 20);
    camera.lookAt(0, 0, 0);
    let batch: SpriteBatch | null = null;
    let last = performance.now(), frames = 0, fpsT = last, fps = 0, flash = 0, nextFlash = 3;
    const t0 = performance.now();

    loadSpriteSheet(ASSETS.sheet, { normals: true }).then((sheet) => {
      if (!alive) return;
      batch = new SpriteBatch(sheet, 5);
      scene.add(batch.mesh);
      onStats({ loaded: true });
    }).catch((e) => onStats({ error: String(e) }));

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = (now - t0) / 1000;
      const c = control.current!;
      if (c.spin) c.angle += dt * 0.6;
      if (batch) {
        // the hero car on the "garage" turntable (right third of the screen), big
        batch.set(0, { x: 5.2, y: 0, z: 0.2, heading: c.angle, scale: 1.05 });
        // four player-tinted cars circling below: different directions every frame
        TINTS.forEach((tint, i) => {
          const a = t * 0.5 + (i * Math.PI) / 2;
          // driving anticlockwise (seen from above) around the turntable: heading follows the ellipse's tangent
          batch!.set(i + 1, { x: 5.2 + Math.cos(a) * 2.5, y: 0, z: 0.2 + Math.sin(a) * 2.2, heading: Math.atan2(-Math.sin(a) * 2.5, Math.cos(a) * 2.2), tint, scale: 0.55 });
        });
        // monsoon lightning: a short flash from the upper left, through the normal sheet
        if (t > nextFlash) {
          flash = 1;
          nextFlash = t + 5 + Math.random() * 4;
        }
        flash = Math.max(0, flash - dt * 3.5);
        batch.setLight([-0.5, 0.8, 0.4], "#cfe0ff", flash * 1.4);
        batch.update(camera, t);
      }
      renderer.render(scene, camera);
      frames++;
      if (now - fpsT > 1000) {
        fps = Math.round((frames * 1000) / (now - fpsT));
        frames = 0;
        fpsT = now;
        onStats({ fps, calls: renderer.info.render.calls, flash: flash > 0 });
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      batch?.dispose();
      renderer.dispose();
    };
  }, [profile, control, onStats]);

  return (
    <>
      <VideoBackdrop src={ASSETS.video} poster={ASSETS.poster} onReady={() => onStats({ video: true })} />
      <div className="showroom-garage" />
      <canvas ref={canvas} className="showroom-canvas" width={profile.resolution.w} height={profile.resolution.h} />
    </>
  );
}
