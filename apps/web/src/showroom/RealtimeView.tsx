import { useEffect, useRef } from "react";
import * as THREE from "three";
import { cloneModel, loadGltf } from "../games/kit3d/assets";
import { blobShadow } from "../games/kit3d/blobShadow";
import { createCinematic, prepareModel } from "../games/kit3d/cinematic";
import type { QualityProfile } from "../quality/tier";
import { ASSETS, type ViewStats, type ViewControl } from "./common";

/**
 * The high and ultra tiers: the exported PBR model (clear coat, baked AO on a second UV set) under the HDRI sky,
 * a wet road, soft shadows from a key light, AgX tone mapping and the profile's post chain.
 */
export function RealtimeView({ profile, control, onStats }: { profile: QualityProfile; control: React.RefObject<ViewControl>; onStats: (s: ViewStats) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let alive = true, raf = 0;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 16 / 9, 0.1, 400);
    camera.position.set(6.4, 2.9, 8.6);
    camera.lookAt(0.6, 0.5, 0);
    const cine = createCinematic(canvas.current!, profile, { scene, camera });
    const turntable = new THREE.Group();
    scene.add(turntable);

    // wet asphalt: dark, glossy, reflecting the sky through the environment map
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(40, 64).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: "#1a1d20", roughness: 0.42, metalness: 0 }),
    );
    ground.receiveShadow = profile.shadows.enabled;
    scene.add(ground);
    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(2.6, 2.7, 0.08, 64),
      new THREE.MeshStandardMaterial({ color: "#4a525c", roughness: 0.3, metalness: 0.1 }),
    );
    disc.position.y = 0.04;
    disc.receiveShadow = profile.shadows.enabled;
    turntable.add(disc);
    scene.fog = new THREE.Fog("#5d676b", 22, 70);
    cine.sun(scene, { position: [-4, 10, 5], intensity: 2.6, extent: 4 });
    const rim = new THREE.DirectionalLight("#a8c8ff", 1.6);
    rim.position.set(4, 3, -6);
    scene.add(rim);

    Promise.all([
      cine.environment(scene, ASSETS.hdri, { background: true, blur: 0.04, intensity: 0.55 }),
      loadGltf(ASSETS.model(profile.assetSuffix)),
    ]).then(([, gltf]) => {
      if (!alive) return;
      const car = cloneModel(gltf.scene);
      const box = new THREE.Box3().setFromObject(car);
      const len = Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
      car.scale.setScalar(3.6 / len);           // ~3.6 m, the same visual size as the lite turntable
      car.position.y = 0.08;
      prepareModel(car, profile, { envIntensity: 1.4 });
      // contact shadow under the body: grounds the car where the sun's shadow map is too coarse to
      const blob = blobShadow(1, 0.75);
      blob.scale.set(1.15, 1, 2.1); // the car is long along z (glTF forward)
      blob.position.y = 0.085;
      turntable.add(blob, car);
      onStats({ loaded: true });
    }).catch((e) => onStats({ error: String(e) }));

    let last = performance.now(), frames = 0, fpsT = last;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const c = control.current!;
      if (c.spin) c.angle += dt * 0.6;
      turntable.rotation.y = c.angle;
      cine.render(scene, camera);
      frames++;
      if (now - fpsT > 1000) {
        const info = cine.renderer.info.render;
        onStats({ fps: Math.round((frames * 1000) / (now - fpsT)), calls: info.calls, tris: info.triangles });
        frames = 0;
        fpsT = now;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && m.parent !== turntable) m.geometry.dispose();
      });
      cine.dispose();
    };
  }, [profile, control, onStats]);

  return <canvas ref={canvas} className="showroom-canvas" width={profile.resolution.w} height={profile.resolution.h} />;
}
