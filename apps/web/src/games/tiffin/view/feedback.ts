/**
 * Juice shared by both views: what each game event looks like (sparkles on a serve, a "PERFECT!" flip, a splash of
 * water on a fire, a puff where a plate hits the floor) plus the floating text.
 */
import type * as THREE from "three";
import type { Ev, Match } from "../engine";
import { cellCentre } from "../kitchen";
import type { Emitters } from "./particles";
import type { Overlay } from "./overlay";
import { SURFACE } from "./model";

export function react(m: Match, events: Ev[], fx: Emitters, overlay: Overlay, camera: THREE.Camera, onShake: (a: number) => void) {
  const k = m.kitchen;
  const at = (c: number, r: number) => {
    const p = cellCentre(k, c, r);
    const t = k.tiles[r * k.w + c];
    return { x: p.x, y: (t ? SURFACE[t.code] ?? 0.5 : 0.5) + 0.1, z: p.z };
  };
  for (const e of events) {
    if (e.kind === "serve") {
      const w = k.tiles.find((t) => t.code === "w");
      const p = w ? at(w.c, w.r) : { x: 0, y: 1, z: 0 };
      fx.burst("sparkle", p.x, p.y + 0.3, p.z, 22);
      overlay.pop(`+${e.points + e.tip + e.bonus}`, "#ffd23f", p.x - 0.6, p.y + 0.9, p.z, camera, 52);
      if (e.tip >= 6) overlay.pop("⚡ SPEEDY TIP!", "#7cf29c", p.x - 0.8, p.y + 1.5, p.z, camera, 30);
      onShake(0.15);
    } else if (e.kind === "act" && e.c !== undefined && e.r !== undefined) {
      const p = at(e.c, e.r);
      if (e.verb === "flip") {
        fx.burst("flip", p.x, p.y, p.z, 12);
        overlay.pop(e.perfect ? "PERFECT FLIP!" : "flip!", e.perfect ? "#ffd23f" : "#ffffff", p.x, p.y + 0.6, p.z, camera, e.perfect ? 40 : 30);
      } else if (e.verb === "douse") {
        fx.burst("splash", p.x, p.y + 0.2, p.z, 26);
        overlay.pop("💧 PSSHHH", "#9fd8ff", p.x, p.y + 0.8, p.z, camera, 32);
      } else if ((e.verb === "chop" || e.verb === "grind") && e.what) {
        fx.burst("poof", p.x, p.y + 0.1, p.z, 8);
        overlay.pop(e.what === "chutney" ? "chutney ready!" : "chopped!", "#ffffff", p.x, p.y + 0.6, p.z, camera, 26);
      } else if (e.verb === "place" || e.verb === "plate" || e.verb === "scoop") fx.burst("poof", p.x, p.y, p.z, 4);
    } else if (e.kind === "station") {
      const p = at(e.c, e.r);
      if (e.what === "done") fx.burst("sparkle", p.x, p.y + 0.2, p.z, 8);
      if (e.what === "fire" || e.what === "spread") {
        overlay.pop("🔥 FIRE!", "#ff7a1a", p.x, p.y + 0.9, p.z, camera, 44);
        onShake(0.35);
      }
      if (e.what === "burnt") overlay.pop("burnt! 💨", "#d8d0c8", p.x, p.y + 0.7, p.z, camera, 28);
    } else if (e.kind === "fall") {
      fx.burst("poof", e.x, 0.1, e.z, 12);
      overlay.pop(e.item === "plate" || e.item === "dirty" ? "CRASH!" : "oops!", "#ff5d73", e.x, 0.8, e.z, camera, 34);
      onShake(0.25);
    } else if (e.kind === "reject") {
      const c = m.chefs.find((x) => x.id === e.id);
      if (c) overlay.pop("❌ no ticket for that", "#ff8a8a", c.x, 1.6, c.z, camera, 24);
    }
  }
}
