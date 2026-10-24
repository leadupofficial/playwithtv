import { lazy } from "react";
import type { GameComponent } from "./types";
import { TriviaGame } from "./trivia/TriviaGame";
import { BoxingGame } from "./boxing/BoxingGame";

// 3D games load three.js only when started, so the lobby stays light on TVs.
const MazeGame = lazy(() => import("./maze/MazeGame").then((m) => ({ default: m.MazeGame })));
const RacerGame = lazy(() => import("./racer/RacerGame").then((m) => ({ default: m.RacerGame })));
const KartGame = lazy(() => import("./kart/KartGame").then((m) => ({ default: m.KartGame })));
const SumoGame = lazy(() => import("./sumo/SumoGame").then((m) => ({ default: m.SumoGame })));

/** TV-side implementations, keyed by catalogue id. Only games listed here can be started. */
export const GAMES: Record<string, GameComponent> = {
  "gravity-maze-3d": MazeGame,
  "sky-gyro-racer": RacerGame,
  "tamil-trivia-royale": TriviaGame,
  "ring-kings-boxing": BoxingGame,
  "kart-knockout": KartGame,
  "motion-sumo": SumoGame,
};
