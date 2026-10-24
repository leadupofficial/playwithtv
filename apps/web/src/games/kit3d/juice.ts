/**
 * kit3d/juice: the small things that make hits feel real.
 *
 *   clock.hitStop(0.1)         freeze the game for 100 ms on a big impact (sim dt = 0, the camera still shakes)
 *   clock.slowMo(0.3, 1.2)     30% speed for 1.2 s (a final knockout), easing back to normal
 *   const dt = clock.tick(realDt)
 *   shake.add(0.5)             trauma 0..1; offset() is capped and decays smoothly
 *   squash.kick(0.3)           squash-and-stretch spring; apply(obj) scales it (volume-preserving)
 *   announcer.say("KNOCKOUT!") big pop-in text over the game
 */
import * as THREE from "three";

export class GameClock {
  private stop = 0;
  private slow = 0;
  private slowDur = 1;
  private slowScale = 1;
  scale = 1;

  /** Freezes simulated time for `seconds` (the longest request wins). */
  hitStop(seconds: number) {
    this.stop = Math.max(this.stop, seconds);
  }

  slowMo(scale: number, seconds: number) {
    this.slowScale = scale;
    this.slow = this.slowDur = seconds;
  }

  get frozen() {
    return this.stop > 0;
  }

  /** Real seconds in, game seconds out. */
  tick(real: number): number {
    if (this.stop > 0) {
      this.stop = Math.max(0, this.stop - real);
      this.scale = 0;
      return 0;
    }
    if (this.slow > 0) {
      this.slow = Math.max(0, this.slow - real);
      const p = 1 - this.slow / this.slowDur; // ease back to full speed over the last 30%
      this.scale = p < 0.7 ? this.slowScale : this.slowScale + (1 - this.slowScale) * ((p - 0.7) / 0.3);
    } else this.scale = 1;
    return real * this.scale;
  }
}

/** Trauma-based screen shake: offset = trauma² × max, smooth pseudo-noise, never more than `max` units. */
export class Shake {
  private trauma = 0;
  private t = 0;
  readonly offset = new THREE.Vector3();
  constructor(public max = 0.35, public decay = 1.8) {}

  add(amount: number) {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  update(dt: number): THREE.Vector3 {
    this.t += dt;
    this.trauma = Math.max(0, this.trauma - this.decay * dt);
    const s = this.trauma * this.trauma * this.max;
    const t = this.t * 31;
    this.offset.set(Math.sin(t * 1.1) * Math.cos(t * 0.37), Math.sin(t * 1.7 + 2) * 0.6, Math.cos(t * 1.3 + 1)).multiplyScalar(s);
    return this.offset;
  }
}

/**
 * Squash-and-stretch spring. kick(+a) squashes (wider, shorter), kick(-a) stretches (taller, thinner);
 * it overshoots and settles like jelly.
 */
export class Squash {
  value = 0;
  private vel = 0;
  constructor(public stiffness = 260, public damping = 13) {}

  kick(amount: number) {
    this.vel += amount * 14;
  }

  /** Sets a held amount (e.g. crouching while charging); the spring keeps settling around it. */
  update(dt: number, rest = 0) {
    const a = -this.stiffness * (this.value - rest) - this.damping * this.vel;
    this.vel += a * dt;
    this.value += this.vel * dt;
    this.value = Math.max(-0.45, Math.min(0.45, this.value));
  }

  apply(obj: THREE.Object3D, base = 1) {
    const y = 1 - this.value;
    const xz = 1 / Math.sqrt(Math.max(0.3, y)); // keep the volume
    obj.scale.set(base * xz, base * y, base * xz);
  }
}

export interface SayOptions { color?: string; sub?: string; size?: number; ms?: number }

/** Big announcer text ("3", "PILLOWS!", "KNOCKOUT!") that pops in, wobbles and fades, over the game. */
export class Announcer {
  private current: HTMLElement | null = null;
  constructor(private container: HTMLElement) {}

  say(text: string, o: SayOptions = {}) {
    this.current?.remove();
    const el = document.createElement("div");
    el.style.cssText = "position:absolute;left:0;right:0;top:34%;text-align:center;pointer-events:none;font-weight:900;" +
      `font-size:${o.size ?? 150}px;line-height:1;letter-spacing:2px;` +
      "text-shadow:0 8px 0 rgba(0,0,0,.45),0 0 30px rgba(0,0,0,.5);-webkit-text-stroke:5px #1b1033;paint-order:stroke fill";
    el.style.color = o.color ?? "#fff";
    el.textContent = text;
    if (o.sub) {
      const s = document.createElement("div");
      s.textContent = o.sub;
      s.style.cssText = "font-size:0.32em;margin-top:18px;-webkit-text-stroke:3px #1b1033;color:#fff";
      el.appendChild(s);
    }
    this.container.appendChild(el);
    this.current = el;
    const ms = o.ms ?? 1200;
    el.animate?.([
      { transform: "scale(0.2) rotate(-8deg)", opacity: 0 },
      { transform: "scale(1.18) rotate(3deg)", opacity: 1, offset: 0.12 },
      { transform: "scale(0.96) rotate(-1deg)", opacity: 1, offset: 0.22 },
      { transform: "scale(1) rotate(0deg)", opacity: 1, offset: 0.8 },
      { transform: "scale(1.08)", opacity: 0 },
    ], { duration: ms, easing: "ease-out", fill: "forwards" });
    setTimeout(() => el.remove(), ms + 50);
  }

  clear() {
    this.current?.remove();
    this.current = null;
  }
}
