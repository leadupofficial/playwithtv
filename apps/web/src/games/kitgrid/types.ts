/**
 * kitgrid: the shared engine behind the grid-based single-player titles (Glowworm Grove, Skyline Stacker,
 * Comet Kitty, Buzz Field). A title is plain data plus a pure simulation; the shell (Shell.tsx) gives every
 * title the same story card, level map, turn-taking between phones, stars and rewards, so a new grid game is
 * one folder with a `sim.ts` and a `levels.ts`.
 *
 * Co-op titles (`coop: true`, the couples shelf) are played by every phone at once instead of in turns:
 * each player's stick/tilt reaches the sim every frame (Sim.steer) and taps say who tapped (Sim.act's
 * `player`); stars and points are shared.
 */
import type { ControlSpec } from "@playwithtv/protocol";
import type { Draw } from "./draw";
import type { SfxName } from "./sfx";

/** Something the simulation wants the shell to show, play or send to the phone. */
export interface SimEvent {
  sfx?: SfxName;
  /** A short line toasted on the pilot's phone. */
  toast?: string;
  tone?: "good" | "bad" | "info";
  /** Screen shake strength in cells (0.1–0.5). */
  shake?: number;
  /** Phone buzz in ms. */
  buzz?: number;
  /** Co-op: the player the toast/buzz is for (default: everyone). */
  player?: number;
}

export interface Outcome {
  won: boolean;
  /** 0 when lost; 1–3 when won. */
  stars: 0 | 1 | 2 | 3;
  score: number;
  /** One line per star rule, true when earned (shown on the results card). */
  checks: Array<{ text: string; ok: boolean }>;
}

export interface Hud {
  score: number;
  /** "Fireflies 3 / 8" */
  goal: string;
  /** 0..1 toward the level goal. */
  progress: number;
  lives?: number;
  /** Seconds since the level started (pauses excluded). */
  seconds: number;
}

/** One level being played. Pure: no DOM, no timers; the shell calls step() every frame. */
export interface Sim {
  readonly cols: number;
  readonly rows: number;
  /** Advances the world by `ms` (at most ~50 ms per call). */
  step(ms: number): SimEvent[];
  /** The pilot (co-op: player `player`) tapped a phone action. */
  act(action: string, player?: number): SimEvent[];
  /** Co-op only: player `player`'s stick/tilt this frame, x right and y up, each -1..1 (0, 0 when idle). */
  steer?(player: number, x: number, y: number): void;
  draw(d: Draw): void;
  hud(): Hud;
  /** Set once the level is over. */
  outcome(): Outcome | null;
  /** State for tests (data attribute on the TV). */
  debug(): Record<string, unknown>;
}

export interface LevelInfo {
  name: string;
  /** One line under the name on the level map: the goal and any twist. */
  brief: string;
  /** World index into GridTitle.story.worlds. */
  world: number;
}

export interface Reward {
  /** Total stars (across all levels) that unlock it. */
  stars: number;
  id: string;
  name: string;
  kind: "skin" | "theme" | "trophy";
  /** Atlas sprite shown on the reward strip, or an emoji. */
  sprite?: string;
  emoji?: string;
}

export interface GridTitle {
  id: string;
  name: string;
  emoji: string;
  /** CSS background of the screen around the board, per theme id ("" = default). */
  themes: Record<string, string>;
  story: {
    /** Atlas sprite of the main character for the story card. */
    heroSprite: string;
    heroName: string;
    /** Shown once before level 1 of a world. */
    worlds: Array<{ name: string; text: string }>;
  };
  levels: LevelInfo[];
  rewards: Reward[];
  controls: ControlSpec;
  /** Phone action ids the level map listens to. */
  menu: { prev: string; next: string; ok: string; back: string; hint: string };
  practice: string[];
  /** Everyone plays at once (see the top of this file). */
  coop?: boolean;
  /** Builds a level. `skin` and `theme` are the reward ids the household picked (or ""); co-op titles also
   * get the players' colours (one per phone, in join order). */
  create(level: number, seed: number, opts: { skin: string; theme: string; quick: boolean; colors: string[] }): Sim;
}
