/**
 * High / ultra: the real-time lane. The Blender-built GLB under the golden-hour HDRI with a warm low sun, soft
 * shadows, AgX, bloom on the festival bulbs (and GTAO + SMAA on ultra), KayKit kids, a taped tennis ball with a
 * comet trail, the brick stumps, fireworks, and a free broadcast camera with slow-motion replays.
 */
import * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { loadAll } from "../../kit3d/assets";
import { createCinematic, prepareModel, type Cinematic } from "../../kit3d/cinematic";
import { blobShadow, fadeBlob } from "../../kit3d/blobShadow";
import { Shake } from "../../kit3d/juice";
import { Labels } from "../../kit3d/labels";
import type { QualityProfile } from "../../../quality/tier";
import { ballPosition, type Game, type GameEvent } from "../sim/game";
import { at } from "../sim/delivery";
import { Actors3D, ANIMS_URL, KID_MODELS } from "./actors3d";
import { Bricks } from "./bricks";
import { choreograph, crowdCheers } from "./choreo";
import { freeCamera, replayView, type LaneMeta } from "./director";
import { Fx } from "./fx";
import { ASSET, type GullyView, type Look } from "./types";

const TRAIL = 14;

export async function createScene3D(canvas: HTMLCanvasElement, overlay: HTMLElement, profile: QualityProfile, lane: LaneMeta,
  looks: Map<string, Look>, onProgress: (p: number) => void): Promise<GullyView> {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(21, 16 / 9, 0.1, 400);
  const cine: Cinematic = createCinematic(canvas, profile, { scene, camera });
  // a punchier, warmer film look than plain AgX (like the Blender renders' "Medium High Contrast")
  cine.renderer.toneMapping = THREE.ACESFilmicToneMapping;
  cine.renderer.toneMappingExposure = 1.0;
  const [laneGltf, anims, ...models] = (await loadAll([`${ASSET}/lane.glb`, ANIMS_URL, ...KID_MODELS], (p) => onProgress(p * 0.9))) as [GLTF, GLTF, ...GLTF[]];
  await cine.environment(scene, `${ASSET}/sky_1k.hdr`, { background: true, blur: 0.02, intensity: 0.5 });
  scene.backgroundIntensity = 0.45; // the sky behind the lane, not a blown-out sun
  scene.backgroundRotation.set(0, 2.2, 0);
  scene.environmentRotation.set(0, 2.2, 0);
  scene.fog = new THREE.Fog("#d9a27a", 70, 180);
  onProgress(1);

  // the sun: low, warm, from behind the bowler's end (the same direction the lite backdrops were lit with)
  const sunDir = new THREE.Vector3(...lane.sun).normalize();
  const sun = cine.sun(scene, { color: "#ffcf9a", intensity: 2.8, extent: 16 });
  sun.target.position.set(0, 0, -9);
  sun.position.copy(sun.target.position).addScaledVector(sunDir, -40);
  if (profile.shadows.enabled) {
    Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 20, bottom: -20, near: 1, far: 90 });
    sun.shadow.camera.updateProjectionMatrix();
  }
  scene.add(new THREE.HemisphereLight("#cfe0ff", "#6b4a35", 0.45));

  const laneRoot = laneGltf.scene;
  prepareModel(laneRoot, profile, { envIntensity: 0.9 });
  laneRoot.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mat = m.material as THREE.MeshStandardMaterial;
    if (mat.emissiveIntensity > 0 && mat.emissive?.getHex()) mat.emissiveIntensity = 3.5; // bulbs glow under bloom
    if (/flag|cloth|frond|kolam/i.test(mat.name)) mat.side = THREE.DoubleSide;
  });
  scene.add(laneRoot);
  const dog = laneRoot.getObjectByName("dog");
  const dogHome = dog?.position.clone() ?? new THREE.Vector3();

  const labels = new Labels(overlay);
  const actors = new Actors3D(models, anims.animations, looks, labels, true);
  scene.add(actors.group);
  const bricks = new Bricks("standard");
  scene.add(bricks.mesh);
  const fx = new Fx(profile.particleBudget);
  scene.add(fx.group);

  // the ball: a red-taped tennis ball, its shadow and a short comet trail
  const ballMat = new THREE.MeshStandardMaterial({ color: "#ff4b2b", roughness: 0.45, emissive: "#ff3b1a", emissiveIntensity: 0.35 });
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 12), ballMat);
  ball.castShadow = true;
  const ballShadow = blobShadow(0.12, 0.6);
  const trail = new THREE.InstancedMesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ color: "#fff1c8", transparent: true, opacity: 0.35, depthWrite: false }), TRAIL);
  trail.frustumCulled = false;
  scene.add(ball, ballShadow, trail);
  const hist: THREE.Vector3[] = Array.from({ length: TRAIL }, () => new THREE.Vector3());
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();

  const shake = new Shake(0.25, 2.2);
  const camPos = new THREE.Vector3(), camTarget = new THREE.Vector3(), lookNow = new THREE.Vector3();
  let fov = 21, lastCut = "", bloom = 0.12, dogJump = 0, time = 0;

  const v3 = (p: { x: number; y: number; z: number }) => new THREE.Vector3(p.x, p.y, p.z);

  function onEvents(events: GameEvent[]) {
    for (const e of events) {
      if (e.kind === "phase" && (e.phase === "aim" || e.phase === "replay")) {
        bricks.reset();
        if (e.phase === "aim") fx.clear();
      }
      if (e.kind === "hit") {
        fx.spark(v3(e.shot.p0), e.shot.timing === "perfect");
        if (e.shot.timing === "perfect") bloom = 0.9;
        shake.add(e.shot.timing === "perfect" ? 0.25 : 0.1);
      }
      if (e.kind === "pitch") fx.dust(v3(e.ball.delivery!.bounce), 0.8);
      if (e.kind === "stumps") {
        bricks.scatter(new THREE.Vector3(0, 0, 1), 1);
        shake.add(0.4);
      }
      if (e.kind === "play") {
        if (e.ev.kind === "bounce") fx.dust(v3(e.ev.at), 0.6);
        if (e.ev.kind === "window") {
          fx.glass(v3(e.ev.at));
          bloom = 1.0;
          shake.add(0.35);
        }
        if (e.ev.kind === "catch") fx.confetti(v3(e.ev.at));
      }
      if (e.kind === "result") {
        const mo = e.moment;
        if (mo === "six" || mo === "roof" || mo === "window") {
          fx.fireworks(5);
          bloom = 1.1;
          dogJump = 1;
        }
        if (mo === "four") dogJump = 1;
        if (mo === "bowlout-hit") bricks.scattered || bricks.scatter(new THREE.Vector3(0, 0, 1));
      }
      if (e.kind === "over") fx.fireworks(10, -12);
    }
  }

  return {
    frame(g, dt, events) {
      time += dt;
      onEvents(events);
      const replay = g.phase === "replay";
      const view = replay ? replayView(g) : g;
      const slow = replay ? 0.5 : 1;
      // the people
      actors.update(choreograph(view), dt, camera, slow);
      actors.spectators(lane.spectators, crowdCheers(g), dt);
      // the ball
      let bp = ballPosition(view);
      if (replay && view.ball?.play && view.phase === "play") bp = at(view.ball.play.path, view.ball.t, 60);
      const show = !!bp && g.phase !== "aim" && g.phase !== "runup";
      ball.visible = ballShadow.visible = show;
      if (bp && show) {
        ball.position.set(bp.x, bp.y, bp.z);
        ball.rotation.x += dt * 20;
        ballShadow.position.set(bp.x, 0.015, bp.z);
        fadeBlob(ballShadow, bp.y);
        hist.unshift(hist.pop()!.set(bp.x, bp.y, bp.z));
      } else for (const h of hist) h.set(0, -10, 0);
      for (let i = 0; i < TRAIL; i++) {
        sc.setScalar(Math.max(0.05, 1 - i / TRAIL));
        m4.compose(hist[i]!, q, sc);
        trail.setMatrixAt(i, m4);
      }
      trail.instanceMatrix.needsUpdate = true;
      trail.visible = show && (g.phase === "play" || replay || g.phase === "delivery");
      bricks.update(dt * slow);
      fx.update(dt * slow);
      // the dog wakes up for boundaries
      if (dog) {
        dogJump = Math.max(0, dogJump - dt * 0.8);
        const j = dogJump > 0 ? Math.abs(Math.sin(time * 9)) * 0.25 * dogJump : 0;
        dog.position.set(dogHome.x, dogHome.y + j, dogHome.z);
      }
      // the camera
      const rig = freeCamera(g, lane, bp);
      const cut = rig.cut !== lastCut && !(lastCut.startsWith("track") && rig.cut.startsWith("track"));
      lastCut = rig.cut;
      const k = cut ? 1 : Math.min(1, dt * (rig.cut.startsWith("track") || rig.cut.startsWith("replay") ? 4 : 2.5));
      camPos.lerp(new THREE.Vector3(...rig.position), k);
      camTarget.lerp(new THREE.Vector3(...rig.target), k);
      fov += (rig.fovDeg - fov) * k;
      lookNow.copy(camTarget);
      camera.position.copy(camPos).add(shake.update(dt));
      camera.fov = fov;
      camera.updateProjectionMatrix();
      camera.lookAt(lookNow);
      bloom += (0.12 - bloom) * Math.min(1, dt * 1.5);
      cine.setBloom(bloom);
      cine.render(scene, camera);
    },
    stats() {
      const i = cine.renderer.info.render;
      return { calls: i.calls, tris: i.triangles, camera: lastCut };
    },
    dispose() {
      actors.dispose();
      labels.clear();
      cine.dispose();
    },
  };
}
