/**
 * kitplat/powerups: data-driven power-ups. A game lists its own (original) power-ups as PowerDefs; the engine
 * only knows the effects. Picking one up replaces the current one; most last `seconds`, some until a hit.
 */
import { type MoveMods, NO_MODS } from "./player";

export interface PowerDef {
  id: string;
  name: string;
  /** Sprite id in the game's items atlas (the pickup) and a short phone toast. */
  icon: string;
  toast: string;
  /** Seconds it lasts (0 = until you are hit). */
  seconds: number;
  /** Movement multipliers and extras (default: none). */
  speed?: number;
  jump?: number;
  airJumps?: number;
  /** Max fall speed while JUMP is held (tiles/s): gliding. */
  glide?: number;
  /** Pulls gems within this radius (tiles). */
  magnet?: number;
  /** Absorbs this many hits. */
  shield?: number;
  /** ACTION throws a projectile that defeats foes (and dents bosses). */
  projectile?: { speed: number; cooldown: number; sprite: string; life: number };
  /** Touching foes defeats them. */
  invincible?: boolean;
  /** Colour of the glow / aura the view draws around the hero. */
  aura?: string;
  /** Sprite drawn over the hero while active (e.g. a kite or an umbrella above them). */
  overlay?: string;
}

/** Movement modifiers of a power (or none). */
export function powerMods(p: PowerDef | null | undefined, out: MoveMods = { ...NO_MODS }): MoveMods {
  out.speed = p?.speed ?? 1;
  out.jump = p?.jump ?? 1;
  out.airJumps = p?.airJumps ?? 0;
  out.glide = p?.glide ?? 0;
  return out;
}
