import { lazy } from "react";
import type { GameComponent } from "./types";
import { TriviaGame } from "./trivia/TriviaGame";
import { BoxingGame } from "./boxing/BoxingGame";

// 3D games load three.js only when started, so the lobby stays light on TVs.
const MazeGame = lazy(() => import("./maze/MazeGame").then((m) => ({ default: m.MazeGame })));
const RacerGame = lazy(() => import("./racer/RacerGame").then((m) => ({ default: m.RacerGame })));
const JumperGame = lazy(() => import("./jumper/JumperGame").then((m) => ({ default: m.JumperGame })));
const BladeGame = lazy(() => import("./blade/BladeGame").then((m) => ({ default: m.BladeGame })));
const BowlingGame = lazy(() => import("./bowling/BowlingGame").then((m) => ({ default: m.BowlingGame })));
const HockeyGame = lazy(() => import("./hockey/HockeyGame").then((m) => ({ default: m.HockeyGame })));

/** TV-side implementations, keyed by catalogue id. Only games listed here can be started. */
export const GAMES: Record<string, GameComponent> = {
  "gravity-maze-3d": MazeGame,
  "sky-gyro-racer": RacerGame,
  "tamil-trivia-royale": TriviaGame,
  "ring-kings-boxing": BoxingGame,
  "tilt-jumper-worlds": JumperGame,
  "motion-blade-trial": BladeGame,
  "bowling-master": BowlingGame,
  "air-hockey-motion": HockeyGame,
};
