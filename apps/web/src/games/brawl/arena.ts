/**
 * The three.js side of Pillow Fort Brawl: renderer (1280×720, no MSAA, pixel ratio 1), the bedroom, fighters,
 * hazards, the shared camera (intro flyover, frame-all, knockout punch-in), juice and the podium. The game
 * component feeds it the match each frame; it never changes the match.
 */
import * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { cloneModel, loadAll } from "../kit3d/assets";
import { FollowCamera } from "../kit3d/followCamera";
import { Announcer, GameClock, Shake } from "../kit3d/juice";
import { Labels } from "../kit3d/labels";
import { Podium, showAwards } from "../kit3d/podium";
import { ANIMATIONS_URL, CHARACTER_URLS, FighterView, type Look } from "./fighters";
import { BrawlFx } from "./fx";
import { HazardViews } from "./hazards";
import { FURNITURE_URL, RENDER_H, RENDER_W, animateRoom, buildRoom, type Room } from "./scene";
import { awards } from "./awards";
import { standings } from "./engine";
import { HX, HZ, type BrawlEvent, type Match } from "./rules";

export interface ArenaAssets { furniture: GLTF; characters: GLTF[]; anims: GLTF }

export async function loadArenaAssets(onProgress?: (p: number) => void): Promise<ArenaAssets> {
  const [furniture, anims, ...characters] = await loadAll([FURNITURE_URL, ANIMATIONS_URL, ...CHARACTER_URLS], onProgress);
  return { furniture: furniture!, anims: anims!, characters };
}

export interface ArenaHooks {
  vibrate(id: string, ms: number): void;
  toast(id: string, text: string, tone: "good" | "bad" | "info"): void;
}

const pts: THREE.Vector3[] = [];
const pool = Array.from({ length: 12 }, () => new THREE.Vector3());

export class Arena {
  readonly renderer: THREE.WebGLRenderer;
  readonly room: Room;
  readonly camera = new THREE.PerspectiveCamera(40, RENDER_W / RENDER_H, 0.5, 120);
  readonly cam: FollowCamera;
  readonly labels: Labels;
  readonly announcer: Announcer;
  readonly clock = new GameClock();
  readonly shake = new Shake(0.45);
  readonly views = new Map<string, FighterView>();
  readonly fx: BrawlFx;
  private hazards: HazardViews;
  private podium: Podium | null = null;
  private dark = 0;
  time = 0;

  constructor(canvas: HTMLCanvasElement, private overlay: HTMLElement, assets: ArenaAssets, fighters: Array<{ id: string; slot: number; look: Look }>, hooks: ArenaHooks) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance", stencil: false });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(RENDER_W, RENDER_H, false);
    this.room = buildRoom(assets.furniture.scene);
    this.cam = new FollowCamera(this.camera, { pitch: 44, minDist: 19, maxDist: 30, margin: 2.4, lookHeight: this.room.bedTop + 0.6 });
    const tags = document.createElement("div");
    tags.style.cssText = "position:absolute;inset:0;overflow:hidden;pointer-events:none";
    const shout = document.createElement("div");
    shout.style.cssText = "position:absolute;inset:0;pointer-events:none";
    overlay.append(tags, shout);
    this.labels = new Labels(tags);
    this.announcer = new Announcer(shout);
    for (const f of fighters) {
      const src = assets.characters[f.slot % assets.characters.length]!;
      this.views.set(f.id, new FighterView(f.id, f.look, cloneModel(src.scene), assets.anims.animations, this.room.pillow, this.room.scene, this.labels));
    }
    this.hazards = new HazardViews(this.room.scene, this.room.pillow, this.room.bedTop);
    this.fx = new BrawlFx({
      scene: this.room.scene, overlay, labels: this.labels, announcer: this.announcer, clock: this.clock, shake: this.shake,
      cam: this.cam, views: this.views, names: new Map(fighters.map((f) => [f.id, f.look])), bedTop: this.room.bedTop,
      vibrate: hooks.vibrate, toast: hooks.toast,
    });
  }

  /** Engine events of the last steps (juice, sounds, the podium when the match ends). */
  handle(events: BrawlEvent[], m: Match) {
    this.fx.handle(events, m);
    for (const e of events) {
      if (e.kind === "phase" && e.phase === "podium") this.showPodium(m);
      if (e.kind === "phase" && e.phase === "countdown") for (const v of this.views.values()) v.pose = "none";
      if (e.kind === "round-end") for (const f of m.fighters) this.views.get(f.id)!.pose = f.id === e.winner ? "cheer" : "none";
    }
  }

  private showPodium(m: Match) {
    this.podium = new Podium(2.4);
    this.podium.group.position.set(0, this.room.bedTop, -0.5);
    this.room.scene.add(this.podium.group);
    const order = standings(m);
    order.forEach((f, i) => {
      const v = this.views.get(f.id)!;
      this.podium!.place(v.char.root, i + 1);
      v.pose = i === 0 ? "cheer" : i === 1 ? "cheer" : "sulk";
      if (i >= 2) v.char.root.rotation.y = i === 2 ? -0.5 : 0.5;
    });
    const names = new Map([...this.views].map(([id, v]) => [id, v.look]));
    const cards = awards(m).map((a) => ({ emoji: a.emoji, title: a.title, detail: a.detail, name: names.get(a.playerId)?.name ?? "?", color: names.get(a.playerId)?.color ?? "#fff" }));
    showAwards(this.overlay, "🏆 PILLOW FORT CHAMPIONS 🏆", cards);
    this.cam.cut();
  }

  /** Advances visuals by `simDt` (game time, already slowed / frozen by the clock) and draws a frame. */
  render(m: Match, realDt: number, simDt: number) {
    this.time += realDt;
    const bedTop = this.room.bedTop;
    // camera: intro flyover, then frame everyone still on the bed (ghosts don't pull the camera)
    pts.length = 0;
    let i = 0;
    if (m.phase === "podium" && this.podium) {
      for (const x of [-3.5, 3.5]) pts.push(pool[i++]!.set(x, bedTop + 2.4, -0.5));
      this.cam.orbit(Math.sin(this.time * 0.25) * 0.12, 0.55, -0.32);
    } else {
      for (const f of m.fighters) {
        const p = this.views.get(f.id)!.focus(pool[i]!, f, bedTop);
        if (p) { pts.push(p); i++; }
      }
      if (pts.length < 2) pts.push(pool[i++]!.set(0, bedTop, 0));
      if (m.phase === "intro") {
        const p = Math.min(1, m.t / m.introSeconds);
        const e = 1 - (1 - p) * (1 - p) * (1 - p);
        this.cam.orbit((1 - e) * 1.9, 1 + (1 - e) * 0.7, (1 - e) * 0.35);
        pts.push(pool[i++]!.set(-HX, bedTop, -HZ), pool[i++]!.set(HX, bedTop, HZ));
      } else this.cam.orbit(0, 1, 0);
    }
    this.cam.update(pts, realDt, this.shake.update(realDt));

    // lights out
    const wantDark = m.chaos?.kind === "nightlight" ? (m.chaos.t < 0.3 ? Math.round(m.chaos.t * 20) % 2 : 1) : 0; // flicker, then dark
    this.dark += (wantDark - this.dark) * Math.min(1, realDt * (wantDark ? 12 : 3));
    animateRoom(this.room, this.dark, this.time);

    for (const f of m.fighters) {
      const v = this.views.get(f.id)!;
      if (m.phase === "podium") {
        v.char.root.visible = true;
        v.ghost.visible = v.ring.visible = v.shadow.visible = false;
        v.tag.sub.textContent = "";
        this.labels.place(v.tag.el, v.char.head(), this.camera, 1.1);
        v.updatePodium(realDt);
      } else v.update(f, m, simDt, bedTop, this.camera, this.time);
    }
    this.hazards.update(m, this.time);
    this.fx.update(simDt, m);
    this.renderer.render(this.room.scene, this.camera);
  }

  dispose() {
    this.fx.dispose();
    for (const v of this.views.values()) v.dispose();
    this.renderer.dispose();
    this.overlay.replaceChildren();
  }
}
