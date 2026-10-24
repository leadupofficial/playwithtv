/**
 * Lite tier (1 GB Mali-G31 TVs): the lane is a Blender-rendered still from each broadcast camera (Cycles, golden
 * hour) behind a transparent canvas; the kids are pre-rendered KayKit sprite sheets (one draw call per sheet);
 * the ball, its shadow, the brick stumps and the particles are cheap real-time 3D drawn with the exact camera the
 * still was rendered from. Camera "moves" are cuts between the stills, like a TV director's.
 */
import * as THREE from "three";
import { blobShadow, fadeBlob } from "../../kit3d/blobShadow";
import { Labels, nameTag } from "../../kit3d/labels";
import { SpriteBatch, loadSpriteSheet, type SpriteSheet } from "../../kit25d/spriteBatch";
import type { QualityProfile } from "../../../quality/tier";
import { ballPosition, type Game } from "../sim/game";
import { at } from "../sim/delivery";
import { Bricks } from "./bricks";
import { choreograph, crowdCheers, type Actor, type Clip } from "./choreo";
import { liteCamera, replayView, type CamName, type LaneMeta } from "./director";
import { Fx } from "./fx";
import { ASSET, type GullyView, type Look } from "./types";

/** Sprite sheets per team: bat-* for the batters, the rest for bowlers and fielders. */
export const SHEETS = ["idle", "run", "bowl", "cheer", "bat-stance", "bat-swing", "bat-run"] as const;
type Sheet = (typeof SHEETS)[number];
const SCALE = 0.62;
const CAPACITY: Record<Sheet, number> = { idle: 7, run: 7, bowl: 1, cheer: 8, "bat-stance": 2, "bat-swing": 1, "bat-run": 2 };

function sheetFor(a: Actor): Sheet {
  const map: Record<Clip, Sheet> = a.bat
    ? { idle: "bat-stance", stance: "bat-stance", defend: "bat-stance", swing: "bat-swing", run: "bat-run", walk: "bat-run", cheer: "cheer", hit: "bat-stance", bowl: "bat-stance", dive: "bat-run", catch: "cheer", pickup: "bat-stance", sit: "bat-stance" }
    : { idle: "idle", stance: "idle", defend: "idle", swing: "idle", run: "run", walk: "run", cheer: "cheer", hit: "idle", bowl: "bowl", dive: "run", catch: "cheer", pickup: "idle", sit: "idle" };
  return map[a.clip];
}

export async function createLite(canvas: HTMLCanvasElement, overlay: HTMLElement, backdrop: HTMLImageElement, profile: QualityProfile,
  lane: LaneMeta, looks: Map<string, Look>, onProgress: (p: number) => void): Promise<GullyView> {
  const { w, h } = profile.resolution;
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, premultipliedAlpha: true });
  renderer.setPixelRatio(1);
  renderer.setSize(w, h, false);
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(21, 16 / 9, 0.1, 300);
  scene.add(new THREE.HemisphereLight("#ffe9d2", "#7a6a5a", 1.6));
  const sun = new THREE.DirectionalLight("#ffd2a1", 2.2);
  sun.position.set(-lane.sun[0], -lane.sun[1], -lane.sun[2]).multiplyScalar(30);
  scene.add(sun);

  // preload the three stills so a cut never shows an empty frame
  const stills = (["broadcast", "shot", "side"] as CamName[]).map((n) => {
    const img = new Image();
    img.src = `${ASSET}/gully-${n}.webp`;
    return img.decode().catch(() => undefined);
  });
  let loaded = 0;
  const total = SHEETS.length * 2 + 1 + stills.length;
  const tick = <T,>(p: Promise<T>) => p.then((v) => { onProgress(++loaded / total); return v; });
  const sheets = await Promise.all([0, 1].map((t) => Promise.all(SHEETS.map((s) => tick(loadSpriteSheet(`${ASSET}/sprites/t${t}-${s}.json`))))));
  const kidSheet: SpriteSheet = await tick(loadSpriteSheet(`${ASSET}/sprites/kids-cheer.json`));
  await Promise.all(stills.map(tick));

  const batches = sheets.map((list) => new Map(SHEETS.map((s, i) => [s, new SpriteBatch(list[i]!, CAPACITY[s])])));
  for (const team of batches) for (const b of team.values()) scene.add(b.mesh);
  const kids = new SpriteBatch(kidSheet, Math.min(10, lane.spectators.length));
  scene.add(kids.mesh);
  const bricks = new Bricks("lambert");
  bricks.mesh.castShadow = bricks.mesh.receiveShadow = false;
  scene.add(bricks.mesh);
  const fx = new Fx(profile.particleBudget);
  scene.add(fx.group);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.065, 12, 8), new THREE.MeshBasicMaterial({ color: "#ff4b2b" }));
  const ballShadow = blobShadow(0.12, 0.6);
  scene.add(ball, ballShadow);
  // sprites draw after opaque 3D (they don't write depth)
  for (const team of batches) for (const b of team.values()) b.mesh.renderOrder = 2;
  kids.mesh.renderOrder = 2;

  const labels = new Labels(overlay);
  const tags = new Map<string, HTMLElement>();
  const clipStart = new Map<string, { clip: Clip; at: number }>();
  let camName: CamName | "" = "", time = 0, calls = 0, tris = 0;
  const v3 = (p: { x: number; y: number; z: number }) => new THREE.Vector3(p.x, p.y, p.z);

  const setCamera = (name: CamName) => {
    if (name === camName) return;
    camName = name;
    const c = lane.cameras[name];
    camera.position.set(...c.position);
    camera.fov = c.fovDeg;
    camera.updateProjectionMatrix();
    camera.lookAt(...c.target);
    backdrop.src = `${ASSET}/gully-${name}.webp`;
  };

  return {
    frame(g: Game, dt: number, events) {
      time += dt;
      for (const e of events) {
        if (e.kind === "phase" && (e.phase === "aim" || e.phase === "replay")) bricks.reset();
        if (e.kind === "phase" && e.phase === "aim") fx.clear();
        if (e.kind === "stumps") bricks.scatter(new THREE.Vector3(0, 0, 1));
        if (e.kind === "hit") fx.spark(v3(e.shot.p0), e.shot.timing === "perfect");
        if (e.kind === "play" && e.ev.kind === "window") fx.glass(v3(e.ev.at));
        if (e.kind === "play" && e.ev.kind === "catch") fx.confetti(v3(e.ev.at));
        if (e.kind === "result" && ["six", "roof", "window"].includes(e.moment)) fx.fireworks(3);
        if (e.kind === "over") fx.fireworks(6, -12);
      }
      const replay = g.phase === "replay";
      const view = replay ? replayView(g) : g;
      const slow = replay ? 0.5 : 1;
      setCamera(liteCamera(g));

      // people: each actor goes into its team's sheet for its clip
      for (const team of batches) for (const b of team.values()) for (let i = 0; i < b.capacity; i++) b.set(i, null);
      const used = new Map<SpriteBatch, number>();
      const seen = new Set<string>();
      for (const a of choreograph(view)) {
        const sheet = sheetFor(a);
        const batch = batches[a.team]!.get(sheet)!;
        const i = used.get(batch) ?? 0;
        if (i >= batch.capacity) continue;
        used.set(batch, i + 1);
        const key = a.id ?? a.key;
        seen.add(key);
        const cs = clipStart.get(key);
        if (!cs || cs.clip !== a.clip) clipStart.set(key, { clip: a.clip, at: time });
        const t = (time - clipStart.get(key)!.at) * slow;
        const once = sheet === "bowl" || sheet === "bat-swing";
        const m = batch.sheet.manifest;
        const dur = m.framesPerDirection / m.fps;
        batch.set(i, { x: a.x, y: 0, z: a.z, heading: a.heading, scale: SCALE, time: once ? Math.min(t * 1.4, dur - 0.5 / m.fps) : t });
        const look = a.id ? looks.get(a.id) : undefined;
        if (look && !look.cpu && (a.role === "batter" || a.role === "bowler")) {
          let tag = tags.get(a.id!);
          if (!tag) {
            tag = nameTag(look.name, look.color).el;
            labels.add(tag);
            tags.set(a.id!, tag);
          }
          labels.place(tag, new THREE.Vector3(a.x, 1.45, a.z), camera, 0, camName === "broadcast");
        }
      }
      for (const [id, tag] of tags) if (!seen.has(id) || camName !== "broadcast") tag.style.display = "none";
      for (const team of batches) for (const b of team.values()) b.update(camera, time);

      const cheer = crowdCheers(g);
      lane.spectators.slice(0, kids.capacity).forEach((s, i) => {
        kids.set(i, { x: s.x, y: s.y, z: s.z, heading: s.side === 0 ? Math.PI : s.side > 0 ? -Math.PI / 2 : Math.PI / 2, scale: 0.5, time: cheer ? time + i * 0.21 : 0 });
      });
      kids.update(camera, time);

      let bp = ballPosition(view);
      if (replay && view.ball?.play && view.phase === "play") bp = at(view.ball.play.path, view.ball.t, 60);
      const show = !!bp && g.phase !== "aim" && g.phase !== "runup";
      ball.visible = ballShadow.visible = show;
      if (bp && show) {
        ball.position.set(bp.x, bp.y, bp.z);
        ballShadow.position.set(bp.x, 0.015, bp.z);
        fadeBlob(ballShadow, bp.y);
      }
      bricks.update(dt * slow);
      fx.update(dt * slow);
      renderer.render(scene, camera);
      calls = renderer.info.render.calls;
      tris = renderer.info.render.triangles;
    },
    stats() {
      return { calls, tris, camera: camName };
    },
    dispose() {
      labels.clear();
      for (const team of batches) for (const b of team.values()) b.dispose();
      kids.dispose();
      renderer.dispose();
    },
  };
}
