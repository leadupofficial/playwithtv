import type { Game, GameEvent } from "../sim/game";
import type { LaneMeta } from "./director";

export const ASSET = "/assets/gully";
export const LANE_META_URL = `${ASSET}/gully-lane.json`;

/** Looks per person: name, team colour, own lobby colour, and which KayKit kid model they are. */
export interface Look { name: string; team: 0 | 1; color: string; teamColor: string; model: number; cpu: boolean }

/** What both render paths (real-time and lite) do for the game component. */
export interface GullyView {
  /** Per frame: the game state, real seconds since the last frame, and the events of this frame. */
  frame(g: Game, dt: number, events: GameEvent[]): void;
  /** Draw calls and triangles of the last frame (for the debug attribute). */
  stats(): { calls: number; tris: number; camera: string };
  dispose(): void;
}

export async function loadLaneMeta(): Promise<LaneMeta> {
  const res = await fetch(LANE_META_URL);
  if (!res.ok) throw new Error(`lane meta: HTTP ${res.status}`);
  return (await res.json()) as LaneMeta;
}
