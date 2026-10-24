/**
 * The static world: sky dome (painted monsoon panorama), fog, terrain + props chunks, the road, the river, a
 * waterfall, the start gantry, ghat-road signs and the chai stall. Lite: unlit vertex-colour materials with the
 * lighting baked in. High/ultra: PBR (wet glossy road with a roughness map, image-based light from the HDRI).
 */
import * as THREE from "three";
import type { QualityProfile } from "../../quality/tier";
import { HAIRPIN_GHAT } from "./course";
import { frameAt, toWorld, type Track } from "./track";
import { HIGH_TERRAIN, LITE_TERRAIN, WATER_Y, buildTerrain, type Ground } from "./terrain";
import { buildRoad } from "./road";
import { SKY_LAT, bannerTexture, detailTexture, roadTexture, signTexture, skyPanorama } from "./textures";
import type { PropKit } from "./props";

export const FOG = "#aebbb7";

export interface World {
  group: THREE.Group;
  sky: THREE.Mesh;
  ground: Ground;
  /** Animated bits (waterfall). */
  update(t: number): void;
  dispose(): void;
}

/** Start of a named course segment (m). */
export function segmentStart(name: string): number {
  let s = 0;
  for (const sg of HAIRPIN_GHAT.segments) {
    if (sg.name === name) return s;
    s += sg.len;
  }
  return 0;
}

function skyDome(): THREE.Mesh {
  // a band of the sphere from SKY_LAT[0] to SKY_LAT[1], plus a cap in the top colour
  const lat0 = THREE.MathUtils.degToRad(SKY_LAT[0]), lat1 = THREE.MathUtils.degToRad(SKY_LAT[1]);
  const g = new THREE.SphereGeometry(900, 48, 12, 0, Math.PI * 2, Math.PI / 2 - lat1, lat1 - lat0);
  const tex = skyPanorama();
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false }));
  const cap = new THREE.Mesh(new THREE.SphereGeometry(900, 24, 4, 0, Math.PI * 2, 0, Math.PI / 2 - lat1 + 0.01),
    new THREE.MeshBasicMaterial({ color: "#4f5f66", side: THREE.BackSide, fog: false, depthWrite: false }));
  m.add(cap);
  m.renderOrder = -10;
  cap.renderOrder = -10;
  m.frustumCulled = false;
  cap.frustumCulled = false;
  return m;
}

function waterfallTexture() {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = "#cfdcdc";
  g.fillRect(0, 0, 64, 256);
  for (let i = 0; i < 220; i++) {
    g.fillStyle = `rgba(255,255,255,${0.2 + Math.random() * 0.6})`;
    g.fillRect(Math.random() * 64, Math.random() * 256, 1 + Math.random() * 3, 10 + Math.random() * 40);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildWorld(track: Track, kit: PropKit, q: QualityProfile): World {
  const lite = q.prerendered;
  const group = new THREE.Group();
  const disposables: Array<{ dispose(): void }> = [];

  // terrain + props
  const { chunks, ground } = buildTerrain(track, kit, lite ? LITE_TERRAIN : HIGH_TERRAIN);
  const detail = detailTexture();
  const terrainMat = lite
    ? new THREE.MeshBasicMaterial({ vertexColors: true, map: detail })
    : new THREE.MeshStandardMaterial({ vertexColors: true, map: detail, bumpMap: detail, bumpScale: 3, roughness: 0.85, metalness: 0, envMapIntensity: 0.8 });
  disposables.push(terrainMat, detail);
  for (const ch of chunks) {
    const m = new THREE.Mesh(ch.geometry, terrainMat);
    m.receiveShadow = q.shadows.enabled;
    m.castShadow = false;
    group.add(m);
    disposables.push(ch.geometry);
  }

  // road
  const roadTex = roadTexture();
  roadTex.anisotropy = lite ? 2 : 8;
  disposables.push(roadTex);
  let roadMat: THREE.Material;
  if (lite) roadMat = new THREE.MeshBasicMaterial({ map: roadTex, vertexColors: true, side: THREE.DoubleSide });
  else {
    const rough = roadTexture(true);
    disposables.push(rough);
    roadMat = new THREE.MeshStandardMaterial({ map: roadTex, roughnessMap: rough, roughness: 1, metalness: 0.05, vertexColors: true, side: THREE.DoubleSide, envMapIntensity: 1.25 });
  }
  disposables.push(roadMat);
  const bridgeSeg = HAIRPIN_GHAT.segments.findIndex((s) => s.name === "River Bridge");
  for (const ch of buildRoad(track, { bakeLight: lite, bridgeSeg })) {
    const m = new THREE.Mesh(ch.geometry, roadMat);
    m.receiveShadow = q.shadows.enabled;
    group.add(m);
    disposables.push(ch.geometry);
  }

  // the river / reservoir in the valley
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(2400, 2400).rotateX(-Math.PI / 2),
    lite ? new THREE.MeshBasicMaterial({ color: "#56706c" }) : new THREE.MeshStandardMaterial({ color: "#2e4a48", roughness: 0.08, metalness: 0.1, envMapIntensity: 1.2 }),
  );
  water.position.y = WATER_Y;
  water.receiveShadow = q.shadows.enabled;
  group.add(water);
  disposables.push(water.geometry, water.material as THREE.Material);

  // waterfall on the cliff at Waterfall Bend (left side), with a white pool
  const wfTex = waterfallTexture();
  disposables.push(wfTex);
  const wfS = segmentStart("Waterfall Bend") + 30;
  const f = frameAt(track, wfS);
  const wfMat = lite
    ? new THREE.MeshBasicMaterial({ map: wfTex, transparent: true, opacity: 0.9, depthWrite: false })
    : new THREE.MeshStandardMaterial({ map: wfTex, transparent: true, opacity: 0.92, roughness: 0.2, emissive: new THREE.Color("#4b5856"), emissiveMap: wfTex, depthWrite: false });
  disposables.push(wfMat);
  const wf = new THREE.Mesh(new THREE.PlaneGeometry(7, 38), wfMat);
  const side = -1; // left of travel
  const wpos = toWorld(track, wfS, side * (f.hw + 15));
  wf.position.set(wpos.x, ground.heightAt(wpos.x, wpos.z) + 16, wpos.z);
  wf.rotation.y = f.heading + Math.PI / 2 * side; // face the road
  group.add(wf);
  disposables.push(wf.geometry);

  // start gantry: two posts and the banner
  const gantry = new THREE.Group();
  const s0 = frameAt(track, 0);
  const postMat = lite ? new THREE.MeshBasicMaterial({ color: "#3a3f45" }) : new THREE.MeshStandardMaterial({ color: "#3a3f45", roughness: 0.4, metalness: 0.7 });
  const bannerTex = bannerTexture();
  const bannerMat = lite ? new THREE.MeshBasicMaterial({ map: bannerTex, side: THREE.DoubleSide }) : new THREE.MeshStandardMaterial({ map: bannerTex, side: THREE.DoubleSide, roughness: 0.6, emissive: new THREE.Color("#3b1a10"), emissiveMap: bannerTex });
  disposables.push(postMat, bannerMat, bannerTex);
  for (const sd of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.6, 8, 0.6), postMat);
    post.position.set(sd * (s0.hw + 1.4), 4, 0);
    post.castShadow = q.shadows.enabled;
    gantry.add(post);
    disposables.push(post.geometry);
  }
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(s0.hw * 2 + 3.4, 2.4), bannerMat);
  banner.position.y = 7;
  banner.rotation.y = Math.PI; // readable by racers driving towards it
  gantry.add(banner);
  disposables.push(banner.geometry);
  gantry.position.set(s0.x, s0.y, s0.z);
  gantry.rotation.y = s0.heading;
  group.add(gantry);

  // ghat signs: hairpin warnings, goats, sound horn
  const signs: Array<[string[], number, number, string?]> = [
    [["HAIRPIN", "BEND 1"], segmentStart("Hairpin 1") - 60, -1],
    [["HAIRPIN", "BEND 2"], segmentStart("Hairpin 2") - 60, 1],
    [["SOUND", "HORN"], segmentStart("Hairpin 1") - 25, 1, "#ffffff"],
    [["GOATS", "CROSSING"], segmentStart("Tea Estate Jumps") - 40, -1],
    [["GOATS", "CROSSING"], 0.05 * track.length, 1],
    [["DRIVE", "SLOW!"], segmentStart("Tea Estate Jumps") + 10, 1, "#ffffff"],
  ];
  for (const [lines, s, sd, bg] of signs) {
    const tex = signTexture(lines, bg);
    const mat = lite ? new THREE.MeshBasicMaterial({ map: tex }) : new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, emissive: new THREE.Color("#222"), emissiveMap: tex });
    const board = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.3), mat);
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.6, 0.12), postMat);
    const fr = frameAt(track, s);
    const p = toWorld(track, s, sd * (fr.hw + 2.2));
    board.position.set(p.x, p.y + 2.6, p.z);
    board.rotation.y = fr.heading + Math.PI; // facing oncoming racers
    pole.position.set(p.x, p.y + 1.3, p.z);
    group.add(board, pole);
    disposables.push(tex, mat, board.geometry, pole.geometry);
  }

  // the chai stall in the village: a hut with a striped awning and a bench
  const stall = new THREE.Group();
  const M = (c: string) => {
    const m = lite ? new THREE.MeshBasicMaterial({ color: c }) : new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 });
    disposables.push(m);
    return m;
  };
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, ry = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    m.castShadow = m.receiveShadow = q.shadows.enabled;
    stall.add(m);
    disposables.push(geo);
    return m;
  };
  add(new THREE.BoxGeometry(5, 2.6, 3.4), M("#c9a46b"), 0, 1.3, 0);
  add(new THREE.BoxGeometry(5.8, 0.25, 4.4), M("#2f6d8f"), 0, 2.85, -0.4).rotation.x = 0.12;
  add(new THREE.BoxGeometry(4.8, 0.9, 0.9), M("#7b4a2a"), 0, 0.45, -2.3);
  add(new THREE.BoxGeometry(3.2, 0.12, 0.6), M("#5a3a22"), 0, 0.5, -3.6);
  const kettle = add(new THREE.CylinderGeometry(0.28, 0.34, 0.5, 12), M("#b8bcc0"), 1.2, 1.15, -2.3);
  kettle.castShadow = false;
  const sp = segmentStart("Chai Stall Straight") + 60;
  const sf = frameAt(track, sp);
  const spos = toWorld(track, sp, -(sf.hw + 8));
  stall.position.set(spos.x, ground.heightAt(spos.x, spos.z), spos.z);
  stall.rotation.y = sf.heading - Math.PI / 2;
  group.add(stall);

  const sky = skyDome();
  group.add(sky);
  disposables.push(sky.geometry, sky.material as THREE.Material, (sky.material as THREE.MeshBasicMaterial).map!);

  return {
    group, sky, ground,
    update(t) {
      wfTex.offset.y = (t * 0.9) % 1;
    },
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
