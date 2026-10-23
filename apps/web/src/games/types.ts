import type { ComponentType } from "react";
import type { ControllerType, GameResult, InputState, PlayerView } from "@playwithtv/protocol";

/** What a game running on the TV can do with the room. Games never touch the socket directly. */
export interface GameBridge {
  /** Latest full controller state per player (sequence-ordered by the hub). */
  onInput(cb: (playerId: string, state: InputState) => void): () => void;
  /** A player disconnected: drop any held buttons for them. */
  onClear(cb: (playerId: string) => void): () => void;
  layout(to: string, layout: ControllerType, data?: Record<string, unknown>): void;
  event(to: string, event: string, data?: Record<string, unknown>): void;
}

export interface GameProps {
  /** Everyone in the room, including players who are reconnecting (connected: false). */
  players: PlayerView[];
  bridge: GameBridge;
  paused: boolean;
  onFinish(results: GameResult[], durationMs: number): void;
  /** A booked sponsor whose name the game paints into its scene (never over the action), or null. */
  sponsor?: { name: string } | null;
}

export type GameComponent = ComponentType<GameProps>;
