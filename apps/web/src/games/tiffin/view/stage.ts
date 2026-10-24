/**
 * Tiffin Tornado stage direction shared by both views: how far the train has run (window scenery), which scenery
 * shows (fields, a platform, a tunnel), the dark, the gangway doors, and the camera's gentle moves: the intro shot
 * (pulled back while the train rolls into Tiffin Junction and brakes), a slight push-in during service that
 * drifts towards where the chefs are, and the carriage rocking on the rails (more in curves).
 */
import type { Match } from "../engine";

export interface StageState {
  /** Metres of scenery that have scrolled by. */
  run: number;
  speed: number;
  platform: number;
  tunnel: number;
  dark: number;
  doors: number;
  zoom: number;
  panX: number;
  panZ: number;
  /** Camera roll (radians) and a small vertical bob. */
  roll: number;
  bob: number;
}

const ease = (v: number, to: number, k: number) => v + (to - v) * Math.min(1, k);

export class Stage {
  readonly s: StageState = { run: 0, speed: 0, platform: 1, tunnel: 0, dark: 0, doors: 0, zoom: 0.8, panX: 0, panZ: 0, roll: 0, bob: 0 };
  private t = 0;
  private wobble = 0;

  /** Call every frame with real seconds. */
  update(m: Match, dt: number): StageState {
    const s = this.s;
    this.t += dt;
    const introLen = m.quick ? 2 : 6;
    let speed = m.speed;
    let zoomTo = 1.05;
    let scenery = m.scenery;
    if (m.phase === "intro" && m.levelIndex === 0) {
      // the train arrives: fast, then braking to a stop at the platform; the camera pushes in
      const p = Math.min(1, m.phaseT / introLen);
      speed = 1.6 * (1 - p) ** 2;
      zoomTo = 0.78 + 0.27 * p * p;
      scenery = "platform";
    } else if (m.phase === "intro" || m.phase === "countdown") {
      zoomTo = m.phase === "intro" ? 0.92 : 1.02;
      if (m.levelIndex === 0) scenery = "platform";
    } else if (m.phase === "levelEnd" || m.phase === "results") zoomTo = 0.96;
    if (m.levelIndex === 0 && (m.phase === "intro" || m.phase === "countdown")) speed = m.phase === "countdown" ? 0 : speed;
    if (m.phase === "service" && m.levelIndex === 0 && scenery === "station") scenery = "platform";
    s.speed = ease(s.speed, speed, dt * 3);
    s.run += s.speed * dt * 14;
    s.platform = ease(s.platform, scenery === "platform" || scenery === "station" ? 1 : 0, dt * 1.5);
    s.tunnel = ease(s.tunnel, scenery === "tunnel" ? 1 : 0, dt * 2.5);
    s.dark = ease(s.dark, m.phase === "service" ? m.dark : 0, dt * 3);
    s.doors = ease(s.doors, m.kitchen.doorsShut ? 1 : 0, dt * 3);
    s.zoom = ease(s.zoom, zoomTo, dt * (m.phase === "intro" ? 6 : 1.2));
    // drift towards the chefs (a little), so the busy end of the kitchen gets a touch more room
    let cx = 0, cz = 0;
    for (const c of m.chefs) { cx += c.x; cz += c.z; }
    const n = Math.max(1, m.chefs.length);
    s.panX = ease(s.panX, m.phase === "service" ? (cx / n) * 0.09 : 0, dt * 0.8);
    s.panZ = ease(s.panZ, m.phase === "service" ? (cz / n) * 0.07 : 0, dt * 0.8);
    // rocking: a gentle sway at speed, leaning into curves
    this.wobble += dt * (1.3 + s.speed);
    const rock = (Math.sin(this.wobble * 1.7) * 0.0025 + Math.sin(this.wobble * 3.1) * 0.0012) * s.speed;
    s.roll = ease(s.roll, -m.sway * 0.022 + rock, dt * 4);
    s.bob = Math.sin(this.wobble * 9.3) * 0.006 * s.speed;
    return s;
  }
}
