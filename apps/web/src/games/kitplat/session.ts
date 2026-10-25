/**
 * kitplat/session: one play session on the TV: loads the world's atlases and backdrops, plays every level with a
 * fixed 60 Hz simulation (hit-stop and pauses freeze it), routes events to juice and the phones, and ends on a
 * podium with awards. Plain TypeScript (no React re-renders per frame); the component gets HUD snapshots.
 */
import * as THREE from "three";
import type { GameResult, PlayerView } from "@playwithtv/protocol";
import type { QualityProfile } from "../../quality/tier";
import type { ControlPlayers } from "../controlKit";
import { showAwards } from "../kit3d/podium";
import { placings } from "../scoring";
import { PlatAudio } from "./audio";
import { DT } from "./feel";
import { pickAwards, type PlatGameDef } from "./game";
import type { PlatControls } from "./input";
import { Juice } from "./juice";
import { NO_INPUT, type PadInput } from "./player";
import { loadAtlas, loadImage, releaseAtlases } from "./render/atlas";
import { CONFETTI } from "./render/particles";
import { PlatView } from "./render/view";
import type { Hero, Mode, World } from "./types";
import { createWorld, stepWorld } from "./world";
import { PODIUM_CAM, PODIUM_SPOTS, podiumLevel } from "./podium";

export interface HudHero { slot: number; name: string; color: string; hearts: number; maxHearts: number; gems: number; score: number; power: string | null; down: boolean; finished: boolean; place: number }
export interface HudState {
  level: number; levels: number; name: string; clock: number; mode: Mode; phase: string; heroes: HudHero[];
  boss: { name: string; hp: number; max: number } | null; card: { title: string; sub: string } | null;
}

export interface SessionOpts {
  def: PlatGameDef;
  canvas: HTMLCanvasElement;
  overlay: HTMLElement;
  profile: QualityProfile;
  tier: string;
  players: PlayerView[];
  kit: ControlPlayers;
  controls: PlatControls;
  bridge: { event(to: string, event: string, data?: Record<string, unknown>): void };
  mode: Mode;
  quick: boolean;
  paused: () => boolean;
  onProgress(p: number): void;
  onHud(h: HudState): void;
  onDebug(json: string): void;
  onFinish(results: GameResult[], ms: number): void;
}

const ORD = ["1st", "2nd", "3rd", "4th"];
const GLOW = { monsoon: "#7fd4ff", festival: "#ffd36a", stepwell: "#7ff0c8" } as const;

export class PlatSession {
  private view: PlatView | null = null;
  private audio = new PlatAudio();
  private raf = 0;
  private alive = true;
  private tags: HTMLDivElement[] = [];
  private inputs: PadInput[];
  private started = Date.now();
  private hudKey = "";
  private loadMs = 0;

  constructor(private o: SessionOpts) {
    this.inputs = o.players.map(() => ({ ...NO_INPUT }));
  }

  async start() {
    const { def, profile } = this.o;
    const lite = profile.prerendered;
    const base = `/assets/plat/${def.theme}/`;
    const t0 = performance.now();
    let done = 0;
    const tick = <T,>(p: Promise<T>) => p.then((v) => { this.o.onProgress(++done / 8); return v; });
    let bgBytes = 0;
    const bg = (file: string) => tick(loadImage(`${base}${file}`, { repeat: true }).then((r) => { bgBytes += r.bytes; return r.texture; }));
    const bounds = fetch(`${base}bg-${def.theme}.json`).then((r) => r.json() as Promise<{ far: { top: number }; mid: { top: number } }>)
      .then((b) => ({ far: b.far.top, mid: b.mid.top })).catch(() => ({ far: 1, mid: 1 }));
    const fgP = lite ? Promise.resolve(null) : loadImage(`${base}bg-${def.theme}-fg.webp`, { repeat: true }).then((r) => { bgBytes += r.bytes; return r.texture; }).catch(() => null);
    const [hero, tiles, items, foes, sky, far, mid, fg] = await Promise.all([
      tick(loadAtlas(`/assets/plat/${def.hero}/${def.hero}.json`, lite)), tick(loadAtlas(`${base}tiles-${def.theme}.json`, lite)),
      tick(loadAtlas(`${base}items-${def.theme}.json`, lite)), tick(loadAtlas(`${base}foes-${def.theme}.json`, lite)),
      // lite: sky and far pre-composited into one layer (one full-screen pass less), 1280×720 images
      bg(lite ? `bg-${def.theme}-back-lite.webp` : `bg-${def.theme}-sky.webp`), lite ? tick(Promise.resolve(null)) : bg(`bg-${def.theme}-far.webp`),
      bg(`bg-${def.theme}-mid${lite ? "-lite" : ""}.webp`), fgP,
    ]);
    await tick(this.audio.load().catch(() => undefined));
    if (!this.alive) return;
    this.loadMs = Math.round(performance.now() - t0);
    const { w, h } = profile.resolution;
    this.view = new PlatView(this.o.canvas, { hero, tiles, items, foes, sky, far, mid, fg, bgBytes, bounds: await bounds }, this.o.players.map((p) => ({ color: p.color, name: p.name })), {
      width: w, height: h, particles: Math.min(profile.particleBudget, lite ? 140 : 400), rain: def.rain ? (lite ? 36 : 110) : 0, keyHue: def.keyHue, overlays: def.overlays,
      extras: !lite, glow: GLOW[def.theme],
    });
    this.makeTags();
    void this.play();
  }

  private makeTags() {
    for (const p of this.o.players) {
      const d = document.createElement("div");
      d.className = "plat-tag";
      d.textContent = p.name;
      d.style.background = p.color;
      this.o.overlay.appendChild(d);
      this.tags.push(d);
    }
  }

  private async play() {
    const { def, quick } = this.o;
    const levels = quick ? def.spec.quick : def.spec.levels;
    let carry: Hero[] | undefined;
    // ?level=N starts at level N (for testing and reviewing a level, e.g. the boss)
    const first = Math.max(0, Math.min(levels.length - 1, Number(new URLSearchParams(location.search).get("level") ?? 1) - 1 || 0));
    for (let i = first; i < levels.length && this.alive; i++) {
      const w = createWorld(def.spec, levels[i]!, this.o.players.map((p) => p.id), this.o.mode, (Math.random() * 2 ** 31) >>> 0, carry);
      this.view!.setLevel(w, levels[i]!.grade);
      await this.runLevel(w, i, levels.length);
      carry = w.heroes;
    }
    if (this.alive && carry) await this.podium(carry);
  }

  private runLevel(w: World, idx: number, count: number): Promise<void> {
    const o = this.o, view = this.view!;
    const juice = new Juice(view.particles, this.audio, {
      vibrate: (slot, ms) => { const p = o.players[slot]; if (p) o.bridge.event(p.id, "vibrate", { ms }); },
      toast: (slot, text, tone) => { const p = o.players[slot]; if (p) o.kit.toast(p.id, text, tone); },
    }, o.def.theme, (id) => o.def.spec.powers.find((p) => p.id === id)?.toast ?? "Power-up!");
    o.controls.flush();
    return new Promise((resolve) => {
      let last = performance.now(), acc = 0, frames = 0, fps = 60, fpsT = last, lastHud = 0, lastDebug = 0, lastPhone = 0, time = 0;
      const frame = (now: number) => {
        if (!this.alive) return resolve();
        this.raf = requestAnimationFrame(frame);
        frames++;
        if (now - fpsT >= 1000) { fps = Math.round((frames * 1000) / (now - fpsT)); frames = 0; fpsT = now; }
        const real = Math.max(0, Math.min(0.1, (now - last) / 1000)); // rAF stamps can precede performance.now()
        last = now;
        time += real;
        if (!o.paused() && !juice.stop(real)) {
          acc += real;
          let n = 0;
          while (acc >= DT && n++ < 4) {
            acc -= DT;
            for (let s = 0; s < this.inputs.length; s++) o.controls.read(o.players[s]!.id, this.inputs[s]!, now);
            stepWorld(w, this.inputs, DT);
            for (const e of w.events) juice.handle(w, e);
          }
          if (acc > DT * 4) acc = 0;
        }
        const shake = juice.update(real, time);
        view.render(w, o.paused() ? 0 : real, shake.x, shake.y);
        this.placeTags(w);
        if (now - lastHud > 120) {
          lastHud = now;
          const hud = this.hud(w, idx, count);
          const key = JSON.stringify(hud);
          if (key !== this.hudKey) { this.hudKey = key; o.onHud(hud); }
        }
        if (now - lastDebug > 250) {
          lastDebug = now;
          const info = view.info();
          o.onDebug(JSON.stringify({
            game: o.def.spec.id, phase: w.phase, level: idx + 1, levels: count, levelId: w.level.meta.id, mode: w.mode, clock: Math.ceil(w.clock),
            time: +w.time.toFixed(1), fps, calls: info.calls, tris: info.tris, decodedMB: +(view.decodedBytes() / 1048576).toFixed(2), loadMs: this.loadMs,
            tier: o.tier, res: `${o.profile.resolution.w}x${o.profile.resolution.h}`, foes: w.foes.filter((f) => f.state !== "dead").length,
            boss: w.boss ? { hp: w.boss.hp, awake: w.boss.awake, dead: w.boss.dead, x: +w.boss.body.x.toFixed(1) } : null,
            goal: w.level.goal, cam: { x: +w.cam.x.toFixed(1), y: +w.cam.y.toFixed(1), zoom: +w.cam.zoom.toFixed(2) },
            heroes: w.heroes.map((h) => ({
              name: o.players[h.slot]!.name, x: +h.body.x.toFixed(2), y: +h.body.y.toFixed(2), vx: +h.body.vx.toFixed(1), state: h.state, grounded: h.body.grounded,
              down: h.down, finished: h.finished, place: h.place, score: h.score, gems: h.stats.gems, hearts: h.hearts, power: h.power?.id ?? null,
              jumps: h.stats.jumps, stomps: h.stats.stomps, falls: h.stats.falls, got: o.controls.received.get(o.players[h.slot]!.id) ?? null,
            })),
          }));
        }
        if (now - lastPhone > 350) {
          lastPhone = now;
          for (const h of w.heroes) this.phoneStatus(w, h, idx, count);
        }
        if (w.done) { cancelAnimationFrame(this.raf); resolve(); }
      };
      this.raf = requestAnimationFrame(frame);
    });
  }

  private phoneStatus(w: World, h: Hero, idx: number, count: number) {
    const p = this.o.players[h.slot]!;
    const text = h.down === "bubble" ? "🫧 In a bubble: press JUMP to pop out near a friend" : h.down ? "Back in a moment…" :
      h.finished ? (w.mode === "race" ? `🏁 Finished ${ORD[h.place - 1] ?? ""}!` : "🏁 Made it! Cheer the others on") :
      `Level ${idx + 1}/${count} · ${"♥".repeat(Math.max(0, h.hearts))} · 💎 ${h.stats.gems}${h.power ? ` · ${h.power.name}` : ""}`;
    this.o.kit.status(p.id, { text, bars: h.power && h.power.seconds > 0 ? [{ label: h.power.name, value: Math.max(0, h.powerT / h.power.seconds), color: "#ffd23f" }] : [] });
  }

  private hud(w: World, idx: number, count: number): HudState {
    const card = w.phase === "intro" ? { title: `${this.o.def.emoji} ${w.level.meta.name}`, sub: `Level ${idx + 1} of ${count} · ${this.o.def.modeNames[w.mode]}` }
      : w.phase === "clear" ? { title: w.boss?.dead ? "BOSS DEFEATED!" : "LEVEL CLEAR!", sub: w.heroes.map((h) => `${this.o.players[h.slot]!.name} +${h.levelScore}`).join("   ") }
        : w.phase === "timeup" ? { title: "TIME UP!", sub: "On to the next one…" } : null;
    return {
      level: idx + 1, levels: count, name: w.level.meta.name, clock: Math.ceil(w.clock), mode: w.mode, phase: w.phase, card,
      boss: w.boss && w.boss.awake && !w.boss.dead ? { name: w.boss.def.name, hp: w.boss.hp, max: w.boss.def.hp } : null,
      heroes: w.heroes.map((h) => ({
        slot: h.slot, name: this.o.players[h.slot]!.name, color: this.o.players[h.slot]!.color, hearts: h.hearts, maxHearts: w.spec.hearts, gems: h.stats.gems,
        score: h.score, power: h.power?.icon ?? null, down: !!h.down, finished: h.finished, place: h.place,
      })),
    };
  }

  private tagPos = { x: 0, y: 0 };
  private tagLast: number[] = [];
  private placeTags(w: World) {
    const v = this.view!;
    for (const h of w.heroes) {
      const d = this.tags[h.slot];
      if (!d) continue;
      v.headOnScreen(h, this.tagPos);
      const px = Math.round(this.tagPos.x * 1920), py = Math.round(this.tagPos.y * 1080), hidden = h.down === "wait" ? 1 : 0;
      const key = px * 4096 + py + hidden * 1e8;
      if (this.tagLast[h.slot] === key) continue; // the DOM is touched only when a tag moves
      this.tagLast[h.slot] = key;
      d.style.transform = `translate(${px}px, ${py}px) translate(-50%, -100%)`;
      d.style.opacity = hidden ? "0" : "1";
    }
  }

  private async podium(heroes: Hero[]) {
    const o = this.o, view = this.view!;
    const scores = new Map(heroes.map((h) => [o.players[h.slot]!.id, h.score]));
    const results = placings(scores);
    const order = results.map((r) => heroes.find((h) => o.players[h.slot]!.id === r.playerId)!);
    const w = createWorld(o.def.spec, podiumLevel(), o.players.map((p) => p.id), o.mode, 1);
    view.setLevel(w);
    order.forEach((h, i) => {
      const me = w.heroes[h.slot]!;
      [me.body.x, me.body.y] = PODIUM_SPOTS[i]!;
      me.finished = true;
      me.facing = i % 2 === 0 ? -1 : 1;
      me.body.grounded = true;
    });
    w.phase = "clear";
    w.cam.x = PODIUM_CAM.x;
    w.cam.y = PODIUM_CAM.y;
    w.cam.vw = PODIUM_CAM.vw;
    w.cam.vh = (PODIUM_CAM.vw * 9) / 16;
    for (const tag of this.tags) tag.style.display = "none";
    this.audio.play("congrats", 0.9);
    this.audio.fanfare();
    const cards = pickAwards(o.def, heroes).map((a) => ({ emoji: a.emoji, title: a.title, detail: a.detail, name: o.players[a.slot]!.name, color: o.players[a.slot]!.color }));
    showAwards(o.overlay, o.def.podiumTitle, cards);
    for (const r of results) {
      const p = o.players.find((x) => x.id === r.playerId)!;
      o.kit.outcome(p.id, r.place === 1 ? o.def.winText : `You came ${ORD[r.place - 1]}`, r.place === 1 ? "👑" : r.place === 2 ? "🥈" : r.place === 3 ? "🥉" : "🎉");
    }
    o.onHud({ level: 0, levels: 0, name: "", clock: 0, mode: o.mode, phase: "podium", heroes: [], boss: null, card: null });
    const until = performance.now() + (o.quick ? 9000 : 12000);
    let last = performance.now(), time = 0, conf = 0;
    await new Promise<void>((resolve) => {
      const frame = (now: number) => {
        if (!this.alive) return resolve();
        const dt = Math.max(0, Math.min(0.1, (now - last) / 1000)); // rAF stamps can precede performance.now()
        last = now;
        time += dt;
        conf -= dt;
        if (conf <= 0) { conf = 0.3; view.particles.burst(CONFETTI, 7 + Math.random() * 13, 9.5, 8, 4, 2.5, 0.3, [0xff5ab4, 0xffd23f, 0x2ec4b6, 0x3a86ff][Math.floor(Math.random() * 4)]!, 6, -2); }
        view.render(w, dt);
        o.onDebug(JSON.stringify({ game: o.def.spec.id, phase: "podium", results, calls: view.info().calls, tris: view.info().tris, decodedMB: +(view.decodedBytes() / 1048576).toFixed(2), tier: o.tier }));
        if (now > until) return resolve();
        this.raf = requestAnimationFrame(frame);
      };
      this.raf = requestAnimationFrame(frame);
    });
    if (this.alive) o.onFinish(results, Date.now() - this.started);
  }

  dispose() {
    this.alive = false;
    cancelAnimationFrame(this.raf);
    this.view?.dispose();
    this.audio.dispose();
    releaseAtlases();
    for (const t of this.tags) t.remove();
    void THREE;
  }
}
