/**
 * The lite tier (1 GB TV, Mali-G31): the arena is ONE pre-rendered Cycles still on a camera-facing quad, the fighters
 * are pre-lit 8-direction sprite sheets (one draw call per fighter design), and everything moves through an
 * orthographic camera pitched exactly like the Blender cameras that rendered them, so zooming and panning over the
 * backdrop keeps sprites standing on its floor. No lights, no shadow maps, no post-processing.
 */
import * as THREE from "three";
import { SpriteBatch, loadSpriteSheet, type SpriteSheet } from "../../kit25d/spriteBatch";
import type { QualityProfile } from "../../../quality/tier";
import { pickAnim, sheetFrame, type SheetClip } from "../anim";
import type { ArenaDef } from "../arenas";
import { Director } from "../director";
import type { FighterId, KalariEvent, Match } from "../rules";
import { A, CLAY, LITE, glowTexture, playerRing, type Look, type StageView } from "./common";
import { Effects } from "./effects";

/** Two sheets per fighter: a (standing moves, tightly framed) and b (rolls, specials, cheers, KOs). */
export interface LiteAssets { backdrop: THREE.Texture; sheets: Map<FighterId, SpriteSheet[]> }

export async function loadLite(arena: ArenaDef, chars: FighterId[], onProgress?: (p: number) => void): Promise<LiteAssets> {
  let done = 0;
  const uniq = [...new Set(chars)];
  const tick = () => onProgress?.(++done / (uniq.length * 2 + 1));
  const backdrop = new THREE.TextureLoader().loadAsync(`${A}${arena.id}-lite.webp`).then((t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    t.generateMipmaps = false;
    t.minFilter = THREE.LinearFilter;
    tick();
    return t;
  });
  const sheet = (url: string) => loadSpriteSheet(url).then((s) => { tick(); return s; });
  const sheets = await Promise.all(uniq.map(async (c) => [c, await Promise.all([sheet(`${A}${c}-sprites.json`), sheet(`${A}${c}-sprites-b.json`)])] as const));
  return { backdrop: await backdrop, sheets: new Map(sheets) };
}

const PITCH = THREE.MathUtils.degToRad(LITE.pitchDeg);
const UP = new THREE.Vector3(0, Math.cos(PITCH), -Math.sin(PITCH));
const FWD = new THREE.Vector3(0, -Math.sin(PITCH), -Math.cos(PITCH));
const LOOK_V = LITE.look.dot(UP);

export class LiteView implements StageView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-8, 8, 4.5, -4.5, 1, 200);
  readonly director = new Director();
  readonly fx: Effects;
  private batches = new Map<FighterId, SpriteBatch[]>();
  private slot = new Map<string, { sets: SpriteBatch[]; i: number; ring: THREE.Mesh; look: Look }>();
  private shadows: THREE.InstancedMesh;
  private m4 = new THREE.Matrix4();
  private glows: THREE.Points;
  private glowBase: Float32Array;
  private time = 0;
  private podiumOrder: string[] | null = null;
  private flash = new Map<string, number>();

  constructor(canvas: HTMLCanvasElement, profile: QualityProfile, private arena: ArenaDef, assets: LiteAssets, private looks: Look[]) {
    const { w, h } = profile.resolution;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance", stencil: false });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(w, h, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.camera.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(), FWD, UP));
    // the backdrop: a camera-facing quad exactly as big as the Blender camera's view, at its look point
    const bw = LITE.viewW, bh = (LITE.viewW * 9) / 16;
    const back = new THREE.Mesh(new THREE.PlaneGeometry(bw, bh), new THREE.MeshBasicMaterial({ map: assets.backdrop, depthTest: false, depthWrite: false }));
    back.position.copy(LITE.look);
    back.quaternion.copy(this.camera.quaternion);
    back.renderOrder = -10;
    this.scene.add(back);
    // lamp halos: one Points draw call, flickering
    this.glowBase = new Float32Array(arena.lamps.flat());
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.glowBase.slice(), 3));
    this.glows = new THREE.Points(g, new THREE.PointsMaterial({ color: "#ffb35a", size: 1.6, map: glowTexture(), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
    this.glows.renderOrder = -5;
    this.scene.add(this.glows);
    // soft contact shadows under every fighter (the EEVEE-rendered sheets carry none): one draw call
    this.shadows = new THREE.InstancedMesh(new THREE.CircleGeometry(0.62, 20).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: "#000000", alphaMap: glowTexture(), transparent: true, opacity: 0.55, depthWrite: false, depthTest: false }), looks.length);
    this.shadows.renderOrder = 1;
    this.shadows.frustumCulled = false;
    this.scene.add(this.shadows);
    for (const [c, sheets] of assets.sheets) {
      const list = sheets.map((sheet) => {
        const b = new SpriteBatch(sheet, 8);
        b.mesh.renderOrder = 2;
        this.scene.add(b.mesh);
        return b;
      });
      this.batches.set(c, list);
    }
    const used = new Map<FighterId, number>();
    for (const l of looks) {
      const sets = this.batches.get(l.char)!;
      const i = used.get(l.char) ?? 0;
      used.set(l.char, i + 1);
      const ring = playerRing(l.color);
      (ring.material as THREE.Material).depthTest = false;
      this.scene.add(ring);
      this.slot.set(l.id, { sets, i, ring, look: l });
    }
    this.fx = new Effects(this.scene, arena.weather, profile.particleBudget, arena.rules);
    for (const m of [this.fx.sparks.mesh, this.fx.dust.mesh]) m.renderOrder = 3;
  }

  react(events: KalariEvent[], m: Match) {
    for (const e of events) {
      if (e.kind === "hit") this.flash.set(e.on, 0.12);
      if (e.kind === "ringout") {
        const f = m.fighters.find((x) => x.id === e.id)!;
        setTimeout(() => (this.arena.edge === "water" ? this.fx.splash(f.x, -0.9, f.z) : this.fx.puff(f.x, f.z, 12)), 450);
      }
    }
  }

  head(id: string, out: THREE.Vector3) {
    return out.copy(this.pos(id)).setY(this.pos(id).y + 2.0);
  }

  private posMap = new Map<string, THREE.Vector3>();
  private pos(id: string) {
    let v = this.posMap.get(id);
    if (!v) this.posMap.set(id, (v = new THREE.Vector3()));
    return v;
  }

  podium(order: string[]) {
    this.podiumOrder = order;
    this.director.cut();
  }

  render(m: Match, realDt: number, simDt: number, cheer: ReadonlySet<string>, shake: THREE.Vector3) {
    this.time += realDt;
    const pts: Array<{ x: number; z: number }> = [];
    for (const f of m.fighters) if (f.alive || f.state === "fall") pts.push({ x: f.x, z: f.z });
    const intro = m.phase === "intro" ? Math.min(1, m.t / m.introSeconds) : null;
    const shot = this.podiumOrder ? { cx: 0, cz: -0.5, width: 11, yaw: 0, lift: 0 } : this.director.update(pts, realDt, intro, m.arena);
    // orthographic framing, clamped to the backdrop
    const hw = shot.width / 2, hh = (shot.width * 9) / 32;
    const u = Math.max(-LITE.viewW / 2 + hw, Math.min(LITE.viewW / 2 - hw, shot.cx));
    const v0 = 0.9 * UP.y + shot.cz * UP.z;
    const bh = (LITE.viewW * 9) / 32;
    const v = Math.max(LOOK_V - bh + hh, Math.min(LOOK_V + bh - hh, v0));
    Object.assign(this.camera, { left: -hw, right: hw, top: hh, bottom: -hh });
    this.camera.updateProjectionMatrix();
    this.camera.position.set(u, 0, 0).addScaledVector(UP, v).addScaledVector(FWD, -80).add(shake);

    // fighters
    const order = this.podiumOrder;
    m.fighters.forEach((f) => {
      const s = this.slot.get(f.id)!;
      const p = this.pos(f.id);
      let x = f.x, y = Math.max(0, f.y), z = f.z, face = f.face, visible = f.state !== "out";
      let pick = pickAnim(f, m, cheer.has(f.id));
      if (order) {
        const place = order.indexOf(f.id);
        if (place < 0) visible = false; // golems leave the stage for the ceremony
        x = [0, -2.2, 2.2, 4.4][place] ?? 0;
        z = [-1.2, -0.6, -0.6, 0.6][place] ?? 0;
        y = 0;
        face = 0;
        visible = place >= 0;
        pick = place === 0 || place === 1 ? { clip: "cheer", progress: null } : place === 2 ? { clip: "idle", progress: null } : { clip: "ko", progress: 1 };
      }
      if (f.state === "fall") y = f.y;
      p.set(x, y, z);
      const fl = Math.max(0, (this.flash.get(f.id) ?? 0) - realDt);
      this.flash.set(f.id, fl);
      // the clip lives in one of the fighter's two sheets: draw it there, hide it in the other
      for (const b of s.sets) {
        const clips = (b.sheet.manifest as unknown as { clips: Record<string, SheetClip> }).clips;
        if (!clips[pick.clip]) { b.set(s.i, null); continue; }
        const frame = sheetFrame(pick, clips, this.time + f.slot * 0.37);
        b.set(s.i, {
          x, y, z, heading: face, scale: 0.85, time: (frame + 0.5) / b.sheet.manifest.fps, visible,
          tint: fl > 0 ? "#ffffff" : s.look.foe ? CLAY : null, tintStrength: fl > 0 ? 0.6 : s.look.foe ? 1 : 0,
          opacity: f.state === "fall" ? Math.max(0, 1 - f.t / 1.2) : 1,
        });
      }
      const k = visible && f.state !== "fall" ? Math.max(0.4, 1 - y * 0.25) : 0;
      this.shadows.setMatrixAt(f.slot, this.m4.makeScale(k, 1, k).setPosition(x, 0.02, z));
      s.ring.visible = visible && (f.alive || !!order) && f.y < 2;
      s.ring.position.set(x, 0.03, z);
    });
    this.shadows.instanceMatrix.needsUpdate = true;
    for (const list of this.batches.values()) for (const b of list) b.update(this.camera, this.time);
    // flickering lamp halos
    const gp = this.glows.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < gp.count; i++) gp.setY(i, this.glowBase[i * 3 + 1]! + Math.sin(this.time * 9 + i * 1.7) * 0.03);
    gp.needsUpdate = true;
    (this.glows.material as THREE.PointsMaterial).opacity = 0.45 + 0.12 * Math.sin(this.time * 13) * Math.sin(this.time * 7.3);
    this.fx.update(simDt || realDt * 0.2);
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.fx.dispose();
    for (const list of this.batches.values()) for (const b of list) b.dispose();
    this.renderer.dispose();
  }
}
