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
const DhamakaGame = lazy(() => import("./dhamaka/DhamakaGame").then((m) => ({ default: m.DhamakaGame })));
const BrawlGame = lazy(() => import("./brawl/BrawlGame").then((m) => ({ default: m.BrawlGame })));
const GhatRushGame = lazy(() => import("./ghat/GhatRushGame").then((m) => ({ default: m.GhatRushGame })));
const CityRivalsGame = lazy(() => import("./city/CityRivalsGame").then((m) => ({ default: m.CityRivalsGame })));
const GullyGame = lazy(() => import("./gully/GullyGame").then((m) => ({ default: m.GullyGame })));
const KalariGame = lazy(() => import("./kalari/KalariGame").then((m) => ({ default: m.KalariGame })));
const TiffinGame = lazy(() => import("./tiffin/TiffinGame").then((m) => ({ default: m.TiffinGame })));
const MonsoonCourierGame = lazy(() => import("./monsoon").then((m) => ({ default: m.MonsoonCourierGame })));
const LanternLaneGame = lazy(() => import("./lantern").then((m) => ({ default: m.LanternLaneGame })));
const CarryHomeGame = lazy(() => import("./carry-home").then((m) => ({ default: m.CarryHomeGame })));
const KitchenRushGame = lazy(() => import("./kitchen-rush").then((m) => ({ default: m.KitchenRushGame })));
const TandemRideGame = lazy(() => import("./tandem-ride").then((m) => ({ default: m.TandemRideGame })));
const KingsRowGame = lazy(() => import("./kings-row").then((m) => ({ default: m.KingsRowGame })));
const DropFourGame = lazy(() => import("./drop-four").then((m) => ({ default: m.DropFourGame })));
const GlowwormGame = lazy(() => import("./glowworm").then((m) => ({ default: m.GlowwormGame })));
const SkylineGame = lazy(() => import("./skyline").then((m) => ({ default: m.SkylineGame })));
const CometKittyGame = lazy(() => import("./comet-kitty").then((m) => ({ default: m.CometKittyGame })));
const BuzzFieldGame = lazy(() => import("./buzz-field").then((m) => ({ default: m.BuzzFieldGame })));
const GrooveGame = lazy(() => import("./groove/GrooveGame").then((m) => ({ default: m.GrooveGame })));
const BeatBladeGame = lazy(() => import("./beat-blade/BeatBladeGame").then((m) => ({ default: m.BeatBladeGame })));
const TwoPathsGame = lazy(() => import("./two-paths").then((m) => ({ default: m.TwoPathsGame })));
const MindMatchGame = lazy(() => import("./mind-match").then((m) => ({ default: m.MindMatchGame })));
const LanternTruthsGame = lazy(() => import("./lantern-truths").then((m) => ({ default: m.LanternTruthsGame })));
const StepwellSecretsGame = lazy(() => import("./stepwell").then((m) => ({ default: m.StepwellSecretsGame })));

/** TV-side implementations, keyed by catalogue id. Only games listed here can be started. */
/**
 * Games drawn with three.js, which needs WebGL 2. Older TV chips (Mali-450 and the like, common in 2018-19 sets)
 * only have WebGL 1: there these games are left out of the lobby rather than crash. Kept true by
 * webgl2.test.ts, which follows each game's imports to "three".
 */
export const NEEDS_WEBGL2: ReadonlySet<string> = new Set([
  "beat-blade", "city-rivals", "ghat-rush", "gravity-maze-3d", "gully-super-over", "kalari-clash", "lantern-lane",
  "monsoon-courier", "pillow-fort-brawl", "sky-gyro-racer", "squat-rocket", "stepwell-secrets", "tiffin-tornado",
]);

let webgl2: boolean | undefined;
/** Whether this screen can create a WebGL 2 context (checked once; the test canvas is released at once). */
export function hasWebgl2(): boolean {
  if (webgl2 === undefined) {
    try {
      const gl = document.createElement("canvas").getContext("webgl2");
      webgl2 = !!gl;
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
    } catch {
      webgl2 = false;
    }
  }
  return webgl2;
}

/** Can this screen run the game? */
export const runsHere = (id: string) => !NEEDS_WEBGL2.has(id) || hasWebgl2();

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
  "emoji-dhamaka": DhamakaGame,
  "pillow-fort-brawl": BrawlGame,
  "ghat-rush": GhatRushGame,
  "city-rivals": CityRivalsGame,
  "gully-super-over": GullyGame,
  "kalari-clash": KalariGame,
  "tiffin-tornado": TiffinGame,
  "monsoon-courier": MonsoonCourierGame,
  "lantern-lane": LanternLaneGame,
  "stepwell-secrets": StepwellSecretsGame,
  "glowworm-grove": GlowwormGame,
  "carry-home": CarryHomeGame,
  "kitchen-rush": KitchenRushGame,
  "tandem-ride": TandemRideGame,
  "kings-row": KingsRowGame,
  "drop-four": DropFourGame,
  "skyline-stacker": SkylineGame,
  "comet-kitty": CometKittyGame,
  "buzz-field": BuzzFieldGame,
  "beat-blade": BeatBladeGame,
  "groove-party": GrooveGame,
  "two-paths": TwoPathsGame,
  "mind-match": MindMatchGame,
  "lantern-truths": LanternTruthsGame,
};
