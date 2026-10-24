/**
 * Game feel shared by both tiers: engine events become hit-stop, slow motion, screen shake, camera punches and
 * cinematic cuts, impact sparks, pop words, announcer lines, sounds and phone vibration, all on the same frame.
 */
import * as THREE from "three";
import { SampleBank } from "../../kit3d/audio";
import { Announcer, GameClock, Shake } from "../../kit3d/juice";
import { Labels, nameTag } from "../../kit3d/labels";
import { character, type KalariEvent, type Match } from "../rules";
import type { Look, StageView } from "./common";
import type { Effects } from "./effects";

const K = "/assets/kenney-audio/";
const SOUNDS: Record<string, string | string[]> = {
  whoosh: [1, 2, 3, 4].map((i) => `${K}cloth${i}.ogg`),
  punch: [0, 1, 2].map((i) => `${K}impactPunch_heavy_00${i}.ogg`),
  thud: [0, 1, 2, 3, 4].map((i) => `${K}impactSoft_heavy_00${i}.ogg`),
  soft: [0, 1, 2].map((i) => `${K}impactSoft_medium_00${i}.ogg`),
  wood: `${K}impactWood_heavy_000.ogg`,
  block: `${K}tick_002.ogg`, parry: `${K}glass_002.ogg`, combo: [`${K}pluck_001.ogg`, `${K}pluck_002.ogg`],
  ready: `${K}maximize_006.ogg`, fall: `${K}minimize_006.ogg`, splash: `${K}drop_002.ogg`, gong: `${K}bong_001.ogg`,
  win: `${K}confirmation_001.ogg`,
  vo3: `${K}vo_3.ogg`, vo2: `${K}vo_2.ogg`, vo1: `${K}vo_1.ogg`, vogo: `${K}vo_go.ogg`, voround: `${K}vo_round.ogg`,
  vofinal: `${K}vo_final_round.ogg`, vogameover: `${K}vo_game_over.ogg`, votime: `${K}vo_time_over.ogg`, vocongrats: `${K}vo_congratulations.ogg`,
};
const POPS = ["THWACK!", "WHAP!", "POW!", "SMACK!", "THUD!"];
const MOVE_POP: Record<string, string> = { kick: "KICK!", heavy: "CRUSH!" };

export interface JuiceHooks {
  vibrate(id: string, ms: number): void;
  toast(id: string, text: string, tone: "good" | "bad" | "info"): void;
}

export class Juice {
  readonly clock = new GameClock();
  readonly shake = new Shake(0.5);
  readonly announcer: Announcer;
  readonly labels: Labels;
  readonly sfx = new SampleBank(SOUNDS, 0.8);
  private tags = new Map<string, { el: HTMLElement; sub: HTMLElement }>();
  private v = new THREE.Vector3();
  private pops = 0;

  constructor(overlay: HTMLElement, private looks: Map<string, Look>, private hooks: JuiceHooks) {
    const tags = document.createElement("div");
    tags.style.cssText = "position:absolute;inset:0;overflow:hidden;pointer-events:none";
    const shout = document.createElement("div");
    shout.style.cssText = "position:absolute;inset:0;pointer-events:none";
    overlay.append(tags, shout);
    this.labels = new Labels(tags);
    this.announcer = new Announcer(shout);
    for (const l of looks.values()) {
      const t = nameTag(l.name, l.color);
      this.labels.add(t.el);
      this.tags.set(l.id, t);
    }
    void this.sfx.load();
  }

  private name(id: string) {
    return this.looks.get(id)?.name ?? "?";
  }

  pop(world: THREE.Vector3, camera: THREE.Camera, text: string, color = "#fff", size = 58) {
    const el = document.createElement("div");
    el.textContent = text;
    el.style.cssText = `font-size:${size}px;font-weight:900;-webkit-text-stroke:5px #1b1033;paint-order:stroke fill;white-space:nowrap;font-style:italic`;
    el.style.color = color;
    this.labels.add(el);
    this.labels.place(el, world, camera, 0.4);
    el.animate?.([
      { translate: "0 0", scale: "0.3", opacity: 0, rotate: "-12deg" },
      { translate: "0 -30px", scale: "1.2", opacity: 1, rotate: "4deg", offset: 0.18 },
      { translate: "0 -95px", scale: "1", opacity: 0, rotate: "0deg" },
    ], { duration: 750, easing: "ease-out", fill: "forwards" });
    setTimeout(() => el.remove(), 800);
  }

  handle(events: KalariEvent[], m: Match, view: StageView, fx: Effects) {
    const { announcer, clock, shake, sfx } = this;
    const at = (x: number, y: number, z: number) => this.v.set(x, y, z);
    for (const e of events) {
      switch (e.kind) {
        case "phase":
          if (e.phase === "countdown") {
            const final = m.round > 1 && (m.round === m.maxRounds || m.fighters.some((f) => f.stats.roundWins === m.roundsToWin - 1));
            announcer.say(final ? "FINAL ROUND" : `ROUND ${m.round}`, { color: "#ffd23f", size: 130, ms: 1000 });
            sfx.play(final ? "vofinal" : "voround", { volume: 0.9 });
          }
          break;
        case "countdown":
          if (e.n > 0 && m.t > 0.05) {
            announcer.say(String(e.n), { size: 230, ms: 800 });
            sfx.play(`vo${e.n}`, { volume: 0.9 });
          } else if (e.n === 0) {
            announcer.say("FIGHT!", { color: "#ff4d3d", size: 210, ms: 1000 });
            sfx.play("vogo", { volume: 1 });
            sfx.play("gong", { volume: 0.6 });
            shake.add(0.35);
          }
          break;
        case "attack":
          sfx.play("whoosh", { volume: e.move === "heavy" ? 0.8 : 0.45, rate: e.move === "heavy" ? 0.8 : 1.3, jitter: 0.08 });
          break;
        case "hit": {
          const power = Math.min(1, e.kb / 12);
          const p = at(e.x, e.y + 1.1, e.z).clone();
          clock.hitStop(e.move === "special" ? 0.14 : 0.05 + 0.07 * power);
          shake.add(0.15 + 0.45 * power);
          const by = m.fighters.find((f) => f.id === e.by)!;
          fx.impact(p, power, e.counter ? "#ff6a3d" : e.move === "special" ? character(by.char).color : "#fff2a8", new THREE.Vector3(e.x - by.x, 0, e.z - by.z).normalize());
          sfx.play(power > 0.5 ? "punch" : "thud", { volume: 0.6 + 0.4 * power, rate: 1.15 - 0.3 * power, jitter: 0.07 });
          if (e.combo >= 2) sfx.play("combo", { volume: 0.5, rate: 1 + 0.15 * (e.combo - 1) });
          const text = e.counter ? "COUNTER!" : e.combo >= 3 ? `${e.combo} HITS!` : MOVE_POP[e.move] ?? POPS[this.pops++ % POPS.length]!;
          this.pop(p, view.camera, text, e.counter ? "#ff6a3d" : e.combo >= 3 ? "#ffd23f" : "#fff", e.combo >= 3 || e.counter ? 70 : 54);
          this.hooks.vibrate(e.on, Math.round(50 + 200 * power));
          this.hooks.vibrate(e.by, 25);
          if (e.launch) fx.puff(e.x, e.z, 8);
          break;
        }
        case "block":
          sfx.play("block", { volume: 0.7, rate: 0.8 });
          fx.impact(at(e.x, 1.1, e.z).clone(), 0.2, "#9cc8ff");
          this.hooks.vibrate(e.on, 30);
          break;
        case "parry":
          clock.hitStop(0.12);
          clock.slowMo(0.4, 0.5);
          shake.add(0.3);
          sfx.play("parry", { volume: 0.9 });
          fx.impact(at(e.x, 1.2, e.z).clone(), 0.8, "#7fe3ff");
          this.pop(at(e.x, 1.4, e.z).clone(), view.camera, "PARRY!", "#7fe3ff", 80);
          this.hooks.vibrate(e.by, 120);
          this.hooks.toast(e.by, "🛡 Perfect parry!", "good");
          break;
        case "guard-break":
          shake.add(0.4);
          sfx.play("wood", { volume: 0.9 });
          this.pop(at(e.x, 1.4, e.z).clone(), view.camera, "GUARD BREAK!", "#ff9f1c", 66);
          this.hooks.vibrate(e.on, 200);
          break;
        case "roll": {
          sfx.play("whoosh", { volume: 0.4, rate: 1.7 });
          const f = m.fighters.find((x) => x.id === e.id);
          if (f) fx.puff(f.x, f.z, 5);
          break;
        }
        case "special-ready":
          sfx.play("ready", { volume: 0.6 });
          this.hooks.toast(e.id, "🔥 SPECIAL ready!", "good");
          this.hooks.vibrate(e.id, 80);
          break;
        case "special-start": {
          const f = m.fighters.find((x) => x.id === e.id)!;
          view.director.closeUp(f.x, f.z, f.face, 1.35);
          clock.slowMo(0.35, 1.0);
          sfx.play("gong", { volume: 0.9, rate: 0.8 });
          announcer.say(e.name, { color: character(f.char).color, size: 120, ms: 1300, sub: this.name(e.id) });
          fx.confetti(at(f.x, 1.2, f.z).clone(), character(f.char).color, 30);
          this.hooks.vibrate(e.id, 150);
          break;
        }
        case "second-wind":
          this.hooks.toast(e.id, "💪 Second wind: special meter boosted!", "good");
          break;
        case "wall":
          shake.add(0.35);
          sfx.play("wood", { volume: 0.8 });
          this.pop(at(e.x, 1.3, e.z).clone(), view.camera, "WALL SPLAT!", "#ffb3c1", 62);
          break;
        case "land":
          if (e.hard) {
            const f = m.fighters.find((x) => x.id === e.id);
            if (f) fx.puff(f.x, f.z, 10);
            sfx.play("soft", { volume: 0.5 });
          }
          break;
        case "ringout":
        case "ko": {
          const f = m.fighters.find((x) => x.id === e.id)!;
          const ring = e.kind === "ringout";
          sfx.play(ring ? "fall" : "thud", { volume: 0.8, rate: ring ? 1 : 0.7 });
          if (ring) setTimeout(() => sfx.play("splash", { volume: 0.7 }), 450);
          this.hooks.vibrate(e.id, 400);
          this.hooks.toast(e.id, ring ? "🌊 Ring out! Back next round" : "💫 Knocked out! Back next round", "bad");
          if (e.by) this.hooks.toast(e.by, `🎯 You took out ${this.name(e.id)}!`, "good");
          if (e.last) {
            clock.slowMo(0.22, 1.6);
            view.director.punch(f.x, f.z, 0.45, 1.6);
            announcer.say(ring ? "RING OUT!" : "K.O.!", { color: "#ffd23f", size: 190, ms: 1700 });
            shake.add(0.6);
          } else announcer.say(ring ? "RING OUT!" : "DOWN!", { color: "#ff9f1c", size: 120, ms: 1000, sub: this.name(e.id) });
          break;
        }
        case "time-warning":
          announcer.say("10 SECONDS!", { color: "#ff5d73", size: 100, ms: 1000 });
          sfx.play("block", { volume: 0.8 });
          break;
        case "round-end":
          if (e.winner) {
            const w = m.fighters.find((f) => f.id === e.winner)!;
            announcer.say(`${this.name(e.winner).toUpperCase()} WINS!`, { color: this.looks.get(e.winner)?.color ?? "#fff", size: 120, ms: 2800, sub: e.reason === "time" ? "Time! Most health takes the round" : "Last one standing" });
            sfx.play("win", { volume: 0.8 });
            fx.confetti(at(w.x, 2, w.z).clone());
          } else announcer.say("DRAW!", { size: 150, ms: 2400, sub: "Nobody takes this round" });
          if (e.reason === "time") sfx.play("votime", { volume: 0.9 });
          break;
        case "match-end":
          sfx.play("vogameover", { volume: 0.9 });
          sfx.play("vocongrats", { volume: 0.9, delay: 1.6 });
          break;
      }
    }
  }

  /** Name tags above heads, with a little health line under each. */
  updateTags(m: Match, view: StageView, show: boolean) {
    for (const f of m.fighters) {
      const t = this.tags.get(f.id)!;
      const vis = show && f.alive && m.phase !== "podium";
      this.labels.place(t.el, view.head(f.id, this.v), view.camera, 0.15, vis);
      const ready = f.meter >= 100 ? "1" : "0";
      if (t.sub.dataset.ready !== ready) {
        t.sub.dataset.ready = ready;
        t.sub.textContent = ready === "1" ? "🔥 SPECIAL" : "";
      }
    }
  }

  dispose() {
    this.sfx.dispose();
  }
}
