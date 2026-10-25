import type * as THREE from "three";
import type { Ev, Match } from "../engine";

export interface ViewLook { name: string; color: string }

/** What the game asks of a renderer (lite sprites or real-time cinematic): both draw the same kitchen. */
export interface KitchenView {
  readonly camera: THREE.Camera;
  readonly renderer: THREE.WebGLRenderer;
  /** Loads everything a level needs (call before the first frame of a level). */
  level(m: Match): Promise<void>;
  /** Draws a frame; `dt` real seconds; `events` from this frame's simulation steps. */
  frame(m: Match, dt: number, events: Ev[]): void;
  info(): { calls: number; tris: number };
  dispose(): void;
}
