/**
 * kitplat/juice: turns world events into feel: dust puffs, sparkles, confetti, screen shake (trauma), hit-stop,
 * sounds and phone buzzes. The game loop asks `stop()` how long to freeze the simulation after a stomp.
 */
import type { PlatAudio } from "./audio";
import { CONFETTI, PUFF, STAR, type Particles } from "./render/particles";
import type { GameEvent, World } from "./types";

export interface Notify {
  vibrate(slot: number, ms: number): void;
  toast(slot: number, text: string, tone: "good" | "bad" | "info"): void;
}

const GEM_COLOR = { monsoon: 0x9fe3ff, festival: 0xffe08a, stepwell: 0xaef5da } as const;

export class Juice {
  trauma = 0;
  private freeze = 0;
  private gemChain = 0;
  private gemT = 0;
  private off = { x: 0, y: 0 };

  constructor(private fx: Particles, private audio: PlatAudio, private notify: Notify, private theme: keyof typeof GEM_COLOR, private powerToast: (id: string) => string) {}

  /** Seconds of hit-stop still to apply (consumed). */
  stop(dt: number): boolean {
    if (this.freeze <= 0) return false;
    this.freeze -= dt;
    return true;
  }

  handle(w: World, e: GameEvent) {
    const fx = this.fx, a = this.audio;
    const gemCol = GEM_COLOR[this.theme];
    switch (e.kind) {
      case "jump": a.jump(); fx.dust(e.x, e.y, 3); break;
      case "airjump": a.airJump(); fx.burst(PUFF, e.x, e.y, 5, 2.5, 0.4, 0.35, 0xffffff); break;
      case "land": a.play("land", Math.min(0.9, e.v / 25)); fx.dust(e.x, e.y, Math.min(8, 2 + Math.floor(e.v / 4))); if (e.v > 17) this.trauma = Math.min(1, this.trauma + 0.15); break;
      case "gem": {
        this.gemChain = this.gemT > 0 ? this.gemChain + 1 : 0;
        this.gemT = 0.5;
        a.gem(this.gemChain);
        fx.burst(STAR, e.x, e.y, 4, 3, 0.35, 0.45, gemCol);
        break;
      }
      case "biggem": a.bigGem(); fx.burst(STAR, e.x, e.y, 12, 5, 0.6, 0.6, gemCol); this.notify.vibrate(e.slot, 30); break;
      case "stomp":
        a.play("stomp", 0.9, 1 + Math.min(6, e.v) * 0.08);
        fx.burst(STAR, e.x, e.y, 6, 4, 0.4, 0.5, 0xfff2b0);
        fx.burst(PUFF, e.x, e.y, 5, 2, 0.4, 0.45);
        this.trauma = Math.min(1, this.trauma + 0.28);
        this.freeze = Math.max(this.freeze, 0.06);
        this.notify.vibrate(e.slot, 25);
        if (e.v >= 3) this.notify.toast(e.slot, `${e.v}× combo!`, "good");
        break;
      case "kick": a.play("crate", 0.7); fx.burst(PUFF, e.x, e.y, 4, 2, 0.3, 0.4); break;
      case "hurt":
        a.play("hurt", 0.9);
        fx.burst(STAR, e.x, e.y, 8, 4, 0.4, 0.5, 0xff6a6a);
        this.trauma = Math.min(1, this.trauma + 0.45);
        this.freeze = Math.max(this.freeze, 0.08);
        this.notify.vibrate(e.slot, 120);
        this.notify.toast(e.slot, e.v > 0 ? `Ouch! ${"♥".repeat(e.v)} left` : "Down!", "bad");
        break;
      case "shield": a.play("glass", 0.8); fx.burst(STAR, e.x, e.y, 10, 5, 0.4, 0.5, 0x9ff0ff); this.notify.toast(e.slot, "Shield saved you!", "info"); break;
      case "down": a.bubble(); fx.burst(PUFF, e.x, e.y, 8, 3, 0.5, 0.5); this.notify.vibrate(e.slot, 200); break;
      case "bubble": a.bubble(); this.notify.toast(e.slot, "Bubble! Float back to your team", "info"); break;
      case "revive": a.pop(); fx.burst(STAR, e.x, e.y, 10, 4, 0.5, 0.5, 0xbfe9ff); break;
      case "wipe": a.play("min", 0.8); break;
      case "spring": a.spring(); fx.burst(STAR, e.x, e.y, 5, 3, 0.3, 0.4, 0xffd23f); break;
      case "boost": a.boost(); fx.dust(e.x, e.y, 6, -1); break;
      case "loop": a.boost(); break;
      case "checkpoint": a.checkpoint(); fx.burst(CONFETTI, e.x, e.y, 18, 6, 1.2, 0.3, 0xffd23f, 9, 3); break;
      case "power": a.power(); fx.burst(STAR, e.x, e.y, 14, 5, 0.6, 0.6, 0xffffff); this.notify.toast(e.slot, this.powerToast(w.heroes[e.slot]?.power?.id ?? ""), "good"); this.notify.vibrate(e.slot, 60); break;
      case "powerlost": a.powerLost(); break;
      case "crate": a.play("crate", 0.9); fx.burst(PUFF, e.x, e.y, 6, 3, 0.5, 0.5, 0xd9b88a); fx.burst(STAR, e.x, e.y + 0.3, 6, 4, 0.5, 0.5, gemCol); this.trauma = Math.min(1, this.trauma + 0.12); break;
      case "bump": if (e.v) a.play("land", 0.5, 1.4); else a.play("tick", 0.5); break;
      case "bonk": a.play("cloth", 0.7, 1.3); fx.burst(STAR, e.x, e.y, 4, 2, 0.3, 0.35); break;
      case "finish": a.play("goal", 0.9); fx.burst(CONFETTI, e.x, e.y + 1, 40, 8, 1.6, 0.32, 0xff5ab4, 9, 4); this.notify.vibrate(e.slot, 150); break;
      case "throw": a.throw_(); break;
      case "lever": a.lever(); this.trauma = Math.min(1, this.trauma + 0.1); break;
      case "crumble": a.play("crate", 0.5, 0.8); fx.burst(PUFF, e.x, e.y, 5, 2, 0.5, 0.45, 0xc9a070, 6); break;
      case "splash": a.play("drop", 0.9, 0.7); fx.burst(STAR, e.x, e.y, 10, 5, 0.6, 0.4, 0x7fd4ff, 12, 3); break;
      case "slam": a.play("stomp", 1, 0.6); this.trauma = Math.min(1, this.trauma + 0.5); fx.dust(e.x - 1, e.y, 6, -1); fx.dust(e.x + 1, e.y, 6, 1); break;
      case "shoot": a.play("cloth", 0.7, 0.8); break;
      case "bosswake": a.play("boss", 0.9); this.trauma = 0.4; break;
      case "bosshit": a.play("hurt", 1, 0.7); fx.burst(STAR, e.x, e.y, 14, 6, 0.6, 0.7, 0xffe36b); this.trauma = Math.min(1, this.trauma + 0.55); this.freeze = 0.12; break;
      case "bossdown": a.play("hurt", 1, 0.5); a.fanfare(); fx.burst(CONFETTI, e.x, e.y, 60, 10, 2, 0.35, 0xffd23f, 9, 5); this.trauma = 1; this.freeze = 0.25; break;
      case "clear": a.play("clear", 0.9); a.fanfare(); break;
      case "timeup": a.play("timeover", 0.9); break;
      case "go": a.play("go", 0.9); break;
      default: break;
    }
  }

  /** Advances shake; returns the camera offset in tiles. */
  update(dt: number, time: number): { x: number; y: number } {
    this.gemT = Math.max(0, this.gemT - dt);
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    const k = this.trauma * this.trauma * 0.45;
    this.off.x = k * Math.sin(time * 61.3) * 0.9;
    this.off.y = k * Math.sin(time * 47.9 + 1.7);
    return this.off;
  }
}
