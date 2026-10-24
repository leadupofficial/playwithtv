import { lazy } from "react";
import type { GameComponent } from "./types";
import { TriviaGame } from "./trivia/TriviaGame";
import { BoxingGame } from "./boxing/BoxingGame";
import { MemoryGame } from "./memory/MemoryGame";
import { PenaltyGame } from "./penalty/PenaltyGame";

// 3D games load three.js only when started, so the lobby stays light on TVs.
const MazeGame = lazy(() => import("./maze/MazeGame").then((m) => ({ default: m.MazeGame })));
const RacerGame = lazy(() => import("./racer/RacerGame").then((m) => ({ default: m.RacerGame })));

/** TV-side implementations, keyed by catalogue id. Only games listed here can be started. */
export const GAMES: Record<string, GameComponent> = {
  "gravity-maze-3d": MazeGame,
  "sky-gyro-racer": RacerGame,
  "tamil-trivia-royale": TriviaGame,
  "ring-kings-boxing": BoxingGame,
  "global-penalty-cup": PenaltyGame,
  "memory-wave": MemoryGame,
};
