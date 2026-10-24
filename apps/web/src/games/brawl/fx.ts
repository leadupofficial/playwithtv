/**
 * Game feel for Pillow Fort Brawl: turns engine events into hit-stop, screen shake, squash, feather bursts,
 * pop words, announcer lines, sounds and phone vibration, all at the same moment.
 */
import * as THREE from "three";
import { SampleBank } from "../kit3d/audio";
import { Particles, featherGeometry, sparkleGeometry } from "../kit3d/particles";
import type { Announcer, GameClock, Shake } from "../kit3d/juice";
import type { FollowCamera } from "../kit3d/followCamera";
import type { Labels } from "../kit3d/labels";
import type { FighterView } from "./fighters";
import type { BrawlEvent, Match } from "./rules";

const A = "/assets/kenney-audio/";
const n = (base: string, count: number) => Array.from({ length: count }, (_, i) => `${A}${base}_00${i}.ogg`);
export const SOUND_FILES: Record<string, string | string[]> = {
  whoosh: [1, 2, 3, 4].map((i) => `${A}cloth${i}.ogg`),
  thump: n("impactSoft_heavy", 5),
  soft: n("impactSoft_medium", 3),
  smash: n("impactPunch_heavy", 3),
  wood: `${A}impactWood_heavy_000.ogg`,
  combo: [`${A}pluck_001.ogg`, `${A}pluck_002.ogg`],
  full: `${A}tick_002.ogg`,
  fall: `${A}minimize_006.ogg`,
  rise: `${A}maximize_006.ogg`,
  ghost: `${A}glass_002.ogg`,
  drop: `${A}drop_002.ogg`,
  slip: `${A}scratch_002.ogg`,
  chaos: `${A}bong_001.ogg`,
  win: `${A}confirmation_001.ogg`,
  vo3: `${A}vo_3.ogg`, vo2: `${A}vo_2.ogg`, vo1: `${A}vo_1.ogg`, vogo: `${A}vo_go.ogg`, voround: `${A}vo_round.ogg`,
  vofinal: `${A}vo_final_round.ogg`, vogameover: `${A}vo_game_over.ogg`, vowin: `${A}vo_you_win.ogg`,
  votime: `${A}vo_time_over.ogg`, vocongrats: `${A}vo_congratulations.ogg`,
};

const POPS = ["FLUMP!", "WHUMP!", "POF!", "FWUMP!", "BOOF!"];

export interface FxDeps {
  scene: THREE.Scene;
  overlay: HTMLElement;
  labels: Labels;
  announcer: Announcer;
  clock: GameClock;
  shake: Shake;
  cam: FollowCamera;
  views: Map<string, FighterView>;
  names: Map<string, { name: string; color: string }>;
  bedTop: number;
  vibrate(id: string, ms: number): void;
  toast(id: string, text: string, tone: "good" | "bad" | "info"): void;
}

export class BrawlFx {
  readonly sfx = new SampleBank(SOUND_FILES, 0.75);
  readonly feathers: Particles;
  readonly sparks: Particles;
  private falling = new Set<string>();
  private popSeed = 0;
  private v = new THREE.Vector3();

  constructor(private d: FxDeps) {
    this.feathers = new Particles(featherGeometry(), new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }), 260);
    this.sparks = new Particles(sparkleGeometry(), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), 80);
    d.scene.add(this.feathers.mesh, this.sparks.mesh);
    void this.sfx.load(); // sounds fill in as they decode; play() skips any not loaded yet
  }

  private name(id: string) {
    return this.d.names.get(id)?.name ?? "?";
  }

  private at(x: number, z: number, y = 1.1) {
    return this.v.set(x, this.d.bedTop + y, z);
  }

  /** A pop word that floats up from a point and fades. */
  pop(world: THREE.Vector3, text: string, color = "#fff", size = 56) {
    const el = document.createElement("div");
    el.textContent = text;
    el.style.cssText = `font-size:${size}px;font-weight:900;-webkit-text-stroke:4px #1b1033;paint-order:stroke fill;white-space:nowrap`;
    el.style.color = color;
    this.d.labels.add(el);
    this.d.labels.place(el, world, this.d.cam.camera, 0.6);
    // the independent `translate`/`scale` properties compose with the label's positioning transform
    el.animate?.([
      { translate: "0 0", scale: "0.4", opacity: 0 },
      { translate: "0 -30px", scale: "1.15", opacity: 1, offset: 0.2 },
      { translate: "0 -90px", scale: "1", opacity: 0 },
    ], { duration: 800, easing: "ease-out", fill: "forwards" });
    setTimeout(() => el.remove(), 850);
  }

  handle(events: BrawlEvent[], m: Match) {
    const { announcer, clock, shake, cam, views, sfx } = { ...this.d, sfx: this.sfx };
    for (const e of events) {
      switch (e.kind) {
        case "phase":
          if (e.phase === "countdown") {
            const final = m.round === m.maxRounds || m.fighters.some((f) => f.stats.roundWins === m.roundsToWin - 1);
            announcer.say(final && m.round > 1 ? "FINAL ROUND" : `ROUND ${m.round}`, { color: "#ffd23f", size: 120, ms: 900 });
            sfx.play(final && m.round > 1 ? "vofinal" : "voround", { volume: 0.9 });
          }
          break;
        case "countdown":
          if (e.n > 0 && m.t > 0.05) {
            announcer.say(String(e.n), { size: 220, ms: 800 });
            sfx.play(`vo${e.n}`, { volume: 0.9 });
          } else if (e.n === 0) {
            announcer.say("PILLOWS!", { color: "#ff5d73", size: 190, ms: 1000, sub: "Knock them off the bed!" });
            sfx.play("vogo", { volume: 1 });
            shake.add(0.3);
          }
          break;
        case "swing":
          sfx.play("whoosh", { volume: 0.4 + 0.4 * e.power, rate: 1.45 - 0.5 * e.power, jitter: 0.08 });
          views.get(e.id)?.swung(e.power);
          break;
        case "hit": {
          const p = this.at(e.x, e.z).clone();
          clock.hitStop(0.08 + 0.04 * e.power);
          shake.add(0.18 + 0.5 * e.power);
          views.get(e.on)?.hurt(e.power);
          sfx.play("thump", { volume: 0.6 + 0.4 * e.power, rate: 1.15 - 0.3 * e.power, jitter: 0.06 });
          if (e.smash) sfx.play("smash", { volume: 0.7 });
          if (e.combo >= 2) sfx.play("combo", { volume: 0.55, rate: 1 + 0.16 * (e.combo - 1) });
          const color = this.d.names.get(e.on)?.color ?? "#fff";
          this.feathers.burst(p, { count: 6 + Math.round(16 * e.power), color: "#ffffff", colorJitter: 0.08, speed: 4 + 5 * e.power, up: 2.5, gravity: 2.2, drag: 2.4, life: 2.6, size: 0.32, spin: 7, sway: 0.9, floor: this.d.bedTop + 0.06 });
          this.feathers.burst(p, { count: 3, color, speed: 3, up: 2, gravity: 2.2, drag: 2.4, life: 2, size: 0.3, sway: 0.8, floor: this.d.bedTop + 0.06 });
          this.sparks.burst(p, { count: 5 + Math.round(5 * e.power), color: "#fff2a8", speed: 7, up: 1, gravity: 0, drag: 6, life: 0.3, size: 0.45, spin: 0 });
          this.pop(p, e.combo >= 3 ? `COMBO ×${e.combo}!` : e.smash ? "SMASH!" : POPS[this.popSeed++ % POPS.length]!, e.smash ? "#ffd23f" : "#fff", e.smash ? 72 : 52);
          this.d.vibrate(e.on, Math.round(60 + 180 * e.power));
          this.d.vibrate(e.by, 25);
          break;
        }
        case "charge-full":
          sfx.play("full", { volume: 0.5 });
          break;
        case "dodge": {
          sfx.play("whoosh", { volume: 0.45, rate: 1.8 });
          const f = m.fighters.find((x) => x.id === e.id);
          if (f) this.feathers.burst(this.at(f.x, f.z, 0.2), { count: 4, color: "#e8e2ff", speed: 2, up: 0.5, gravity: 1, drag: 4, life: 0.6, size: 0.22 });
          break;
        }
        case "fall": {
          const f = m.fighters.find((x) => x.id === e.id)!;
          this.falling.add(e.id);
          sfx.play("fall", { volume: 0.7 });
          this.d.vibrate(e.id, 400);
          this.d.toast(e.id, "Into the lava! You're a ghost now: drop socks & feathers on them", "bad");
          if (e.by) this.d.toast(e.by, `🎯 You knocked off ${this.name(e.id)}!`, "good");
          if (e.last) {
            clock.slowMo(0.25, 1.4);
            cam.punch(this.at(f.x, f.z, 0).clone(), 0.42, 1.4);
            announcer.say("KNOCKOUT!", { color: "#ffd23f", size: 170, ms: 1500 });
            shake.add(0.5);
          } else {
            announcer.say(e.first ? "FIRST ONE OUT!" : "OUT!", { color: "#ff9f1c", size: e.first ? 110 : 130, ms: 1000, sub: `${this.name(e.id)} fell in the lava` });
          }
          break;
        }
        case "ghost": {
          sfx.play("ghost", { volume: 0.6 });
          const f = m.fighters.find((x) => x.id === e.id)!;
          this.sparks.burst(this.at(f.x, f.z, 2.3), { count: 10, color: "#d9d2ff", speed: 4, up: 0, gravity: 0, drag: 4, life: 0.5, size: 0.4 });
          break;
        }
        case "hazard":
          sfx.play(e.hazard === "sock" ? "drop" : "soft", { volume: 0.6 });
          if (e.hazard === "feathers") this.feathers.burst(this.at(e.x, e.z, 1.5), { count: 14, color: "#fff", speed: 2, up: 0.5, gravity: 2.5, drag: 2, life: 3, size: 0.3, sway: 1, floor: this.d.bedTop + 0.06 });
          break;
        case "slip":
          sfx.play("slip", { volume: 0.8 });
          shake.add(0.2);
          this.pop(this.at(e.x, e.z).clone(), "SLIP!", "#7fe3ff", 64);
          this.d.vibrate(e.id, 200);
          this.d.toast(e.by, `🧦 ${this.name(e.id)} slipped on your sock!`, "good");
          break;
        case "chaos": {
          const text = { bounce: "BED BOUNCE!", nightlight: "LIGHTS OUT!", avalanche: "PILLOW AVALANCHE!" }[e.chaos];
          announcer.say(text, { color: "#7fe3ff", size: 120, ms: 1400 });
          sfx.play("chaos", { volume: 0.7 });
          break;
        }
        case "bounce":
          sfx.play("wood", { volume: 0.8, rate: 0.6 });
          shake.add(0.4);
          for (const v of views.values()) v.landed(true);
          break;
        case "drop-land": {
          sfx.play("thump", { volume: 0.7, rate: 0.8 });
          shake.add(0.22);
          this.feathers.burst(this.at(e.x, e.z, 0.4).clone(), { count: 10, color: "#fff", speed: 4, up: 2, gravity: 2.2, drag: 2.4, life: 2, size: 0.3, sway: 0.8, floor: this.d.bedTop + 0.06 });
          for (const id of e.hits) {
            views.get(id)?.hurt(0.6);
            this.d.vibrate(id, 150);
          }
          break;
        }
        case "land":
          views.get(e.id)?.landed(e.hard);
          if (e.hard) sfx.play("soft", { volume: 0.4 });
          break;
        case "time-warning":
          announcer.say("10 SECONDS!", { color: "#ff5d73", size: 100, ms: 1000 });
          sfx.play("full", { volume: 0.7 });
          break;
        case "round-end":
          if (e.winner) {
            const w = m.fighters.find((f) => f.id === e.winner)!;
            announcer.say(`${this.name(e.winner).toUpperCase()} WINS!`, { color: this.d.names.get(e.winner)?.color ?? "#fff", size: 120, ms: 2600, sub: e.reason === "time" ? "Time! Least wobbly wins the round" : "Last one on the bed" });
            sfx.play("win", { volume: 0.8 });
            this.sparks.burst(this.at(w.x, w.z, 2), { count: 24, color: "#ffd23f", speed: 6, up: 4, gravity: 6, drag: 1.5, life: 1.4, size: 0.4 });
          } else announcer.say("DRAW!", { size: 140, ms: 2200, sub: "Nobody wins this round" });
          if (e.reason === "time") sfx.play("votime", { volume: 0.9 });
          break;
        case "match-end":
          sfx.play("vogameover", { volume: 0.9 });
          sfx.play("vocongrats", { volume: 0.9, delay: 1.6 });
          break;
      }
    }
  }

  /** Particles and the lava splash when a faller reaches the floor. */
  update(dt: number, m: Match) {
    this.feathers.update(dt);
    this.sparks.update(dt);
    for (const id of this.falling) {
      const f = m.fighters.find((x) => x.id === id);
      if (!f || f.state !== "fall") { this.falling.delete(id); continue; }
      if (this.d.bedTop + f.y > 0.3) continue;
      this.falling.delete(id);
      const p = this.v.set(f.x, 0.3, f.z);
      this.sparks.burst(p, { count: 18, color: "#ffb020", speed: 6, up: 6, gravity: 14, drag: 1, life: 0.8, size: 0.5 });
      this.sfx.play("thump", { volume: 0.6, rate: 0.6 });
      this.d.shake.add(0.2);
    }
  }

  dispose() {
    this.sfx.dispose();
  }
}
