/**
 * What both render tiers share: the look of each entrant, the view interface the game drives, asset URLs, and
 * small three.js helpers (player rings, a soft radial glow texture, weather and impact particles).
 */
import * as THREE from "three";
import type { FighterId, Match, KalariEvent } from "../rules";
import type { Director } from "../director";
import type { Effects } from "./effects";

export const A = "/assets/kalari-clash/";
export const HDRI_URL: Record<string, string> = {
  dusk: `${A}qwantani_dusk_2_puresky_512.hdr`,
  overcast: "/assets/cinematic/showroom/kloofendal_overcast_puresky_1k.hdr",
  golden: `${A}kloppenheim_06_puresky_512.hdr`,
};
/** Lite camera: must match tools/blender/kalari/arenas.py (VIEW_W, PITCH, LOOK). */
export const LITE = { viewW: 24, pitchDeg: 30, look: new THREE.Vector3(0, 1.5, -3.5) };

export interface Look { id: string; name: string; color: string; char: FighterId; cpu: boolean; /** a clay golem (Guardians) */ foe?: boolean }

/** Terracotta for the clay golems. */
export const CLAY = "#b8643a";

export interface StageView {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.Camera;
  readonly scene: THREE.Scene;
  readonly director: Director;
  readonly fx: Effects;
  /** Visual reactions to engine events (particles, flashes); sounds and text are in fx.ts. */
  react(events: KalariEvent[], m: Match): void;
  /** Draws a frame. `cheer` = fighters celebrating (round winner, podium). */
  render(m: Match, realDt: number, simDt: number, cheer: ReadonlySet<string>, shake: THREE.Vector3): void;
  /** Screen anchor above a fighter's head (for name tags), in world space. */
  head(id: string, out: THREE.Vector3): THREE.Vector3;
  /** Place fighters on the podium (1st, 2nd, 3rd …). */
  podium(order: string[]): void;
  dispose(): void;
}

let glowTex: THREE.Texture | null = null;
/** A soft radial glow (lamp halos, impact flashes), drawn once into a canvas. */
export function glowTexture(): THREE.Texture {
  if (glowTex) return glowTex;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, "rgba(255,255,255,1)");
  r.addColorStop(0.25, "rgba(255,255,255,0.55)");
  r.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}

/** The player's colour as a glowing ring on the floor (who is who, at a glance from the sofa). */
export function playerRing(color: string): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.RingGeometry(0.55, 0.72, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false }),
  );
  m.renderOrder = 1;
  return m;
}

/** A thin streak for rain (unit length along y). */
export function streakGeometry(): THREE.BufferGeometry {
  return new THREE.PlaneGeometry(0.03, 1).translate(0, -0.5, 0);
}
