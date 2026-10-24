import { lazy } from "react";
import type { GameComponent } from "./types";
import { TriviaGame } from "./trivia/TriviaGame";
import { BoxingGame } from "./boxing/BoxingGame";
import { MemoryGame } from "./memory/MemoryGame";
import { PenaltyGame } from "./penalty/PenaltyGame";

// 3D games load three.js only when started, so the lobby stays light on TVs.
const MazeGame = lazy(() => import("./maze/MazeGame").then((m) => ({ default: m.MazeGame })));
const RacerGame = lazy(() => import("./racer/RacerGame").then((m) => ({ default: m.RacerGame })));
const JumperGame = lazy(() => import("./jumper/JumperGame").then((m) => ({ default: m.JumperGame })));
const BladeGame = lazy(() => import("./blade/BladeGame").then((m) => ({ default: m.BladeGame })));
const BowlingGame = lazy(() => import("./bowling/BowlingGame").then((m) => ({ default: m.BowlingGame })));
const HockeyGame = lazy(() => import("./hockey/HockeyGame").then((m) => ({ default: m.HockeyGame })));
const KartGame = lazy(() => import("./kart/KartGame").then((m) => ({ default: m.KartGame })));
const SumoGame = lazy(() => import("./sumo/SumoGame").then((m) => ({ default: m.SumoGame })));
const SquatRocketGame = lazy(() => import("./squat-rocket/SquatRocketGame").then((m) => ({ default: m.SquatRocketGame })));

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
  "kart-knockout": KartGame,
  "motion-sumo": SumoGame,
  "global-penalty-cup": PenaltyGame,
  "memory-wave": MemoryGame,
  "squat-rocket": SquatRocketGame,
};
