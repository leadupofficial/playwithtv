import type { GameManifest } from "./index.js";
import { CONCEPTS } from "./concepts.js";

const CODE_ART = { asset: "all visuals and sounds (drawn and synthesised in code)", licence: "original", source: "this repository" };
const THREE = { asset: "three.js renderer", licence: "MIT", source: "https://threejs.org" };

/**
 * Implemented games with complete manifests. "playable" = complete loop with automated tests;
 * "released" is only set after the real-device controller acceptance test (docs/real-device-test.md).
 */
const IMPLEMENTED: GameManifest[] = [
  {
    id: "gravity-maze-3d",
    title: "Gravity Maze 3D",
    description: "Hold your phone flat like a tray and tilt it to roll the ball past holes and moving walls into the goal. Take turns: fastest total time wins.",
    categories: ["arcade", "puzzle"],
    tags: ["tilt", "physics", "3d", "turns"],
    minPlayers: 1, maxPlayers: 4, version: "1.0.0", executionMode: "browser", controller: "game", orientation: "landscape",
    estimatedAssetKb: 150, difficulty: "easy", sessionMinutes: 4,
    accessibility: ["adjustable-sensitivity", "no-time-pressure-practice", "checkpoints"],
    colors: ["#2f8cff", "#7c3aed"], emoji: "🌀", playable: true,
    catalogueNo: 1, category: "solo-arcade", modes: ["solo", "couch-party", "practice"], completionStatus: "playable", phase: 1,
    sensorRequirements: { accelerometer: true, gyroscope: "unused" },
    motionMappings: [{ motion: "roll", action: "tilt the maze left/right" }, { motion: "pitch", action: "tilt the maze forward/back" }],
    calibrationProfile: "flat", difficultyLevels: ["easy", "normal"],
    licenceInventory: [CODE_ART, THREE], controlModes: ["motion", "buttons", "touchpad"], automatedTestStatus: "unit+e2e",
  },
  {
    id: "sky-gyro-racer",
    title: "Sky Gyro Racer",
    description: "Fly through floating gates in space. Turn your phone like a steering wheel to steer, tip it to climb or dive, push it towards the TV to boost.",
    categories: ["racing", "arcade"],
    tags: ["tilt", "3d", "race", "boost"],
    minPlayers: 1, maxPlayers: 4, version: "1.0.0", executionMode: "browser", controller: "game", orientation: "landscape",
    estimatedAssetKb: 150, difficulty: "medium", sessionMinutes: 3,
    accessibility: ["adjustable-sensitivity", "catch-up-for-trailing-players", "no-crash-out"],
    colors: ["#00c2ff", "#ff2bd6"], emoji: "🚀", playable: true,
    catalogueNo: 2, category: "solo-arcade", modes: ["solo", "couch-party"], completionStatus: "playable", phase: 1,
    sensorRequirements: { accelerometer: true, gyroscope: "optional" },
    motionMappings: [
      { motion: "roll", action: "steer left/right" }, { motion: "pitch", action: "climb / dive" }, { motion: "push", action: "boost (uses energy)" },
    ],
    calibrationProfile: "upright", difficultyLevels: ["normal"],
    licenceInventory: [CODE_ART, THREE], controlModes: ["hybrid", "motion", "buttons"], automatedTestStatus: "unit+e2e",
  },
  {
    id: "tamil-trivia-royale",
    title: "Tamil Trivia Royale",
    description: "Quiz rounds in Tamil and English. Tap your answer's colour on your phone, or turn the phone to aim and push to lock in.",
    categories: ["party", "quiz"],
    tags: ["tamil", "english", "family", "multiplayer"],
    minPlayers: 1, maxPlayers: 8, version: "2.0.0", executionMode: "browser", controller: "game", orientation: "landscape",
    estimatedAssetKb: 40, difficulty: "easy", sessionMinutes: 5,
    accessibility: ["large-text", "colour-and-shape-answers", "adjustable-sensitivity"],
    colors: ["#ff7a59", "#7c3aed"], emoji: "🧠", playable: true,
    catalogueNo: 35, category: "competitive", modes: ["solo", "couch-party"], completionStatus: "playable", phase: 2,
    sensorRequirements: { accelerometer: true, gyroscope: "unused" },
    motionMappings: [{ motion: "roll", action: "move your marker across the four answers" }, { motion: "push", action: "lock in the answer" }],
    calibrationProfile: "upright", difficultyLevels: ["mixed"],
    licenceInventory: [CODE_ART, { asset: "questions", licence: "original", source: "this repository" }], controlModes: ["buttons", "motion"], automatedTestStatus: "unit+e2e",
  },
  {
    id: "ring-kings-boxing",
    title: "Ring Kings Boxing",
    description: "Box a CPU champion or a friend: punch, block and dodge on your phone's buttons, or box with motion (push to jab, flick to hook). Land the SUPER punch, beat the 10-count!",
    categories: ["fighting", "sports", "versus"],
    tags: ["boxing", "1v1", "vs-cpu", "rounds"],
    minPlayers: 1, maxPlayers: 2, version: "2.0.0", executionMode: "browser", controller: "game", orientation: "landscape",
    estimatedAssetKb: 60, difficulty: "medium", sessionMinutes: 4,
    accessibility: ["cpu-opponent", "adjustable-sensitivity", "gentle-gestures"],
    colors: ["#e2384d", "#1d4ed8"], emoji: "🥊", playable: true,
    category: "competitive", modes: ["solo-challenge", "duo-versus"], completionStatus: "playable", phase: 2,
    sensorRequirements: { accelerometer: true, gyroscope: "unused" },
    motionMappings: [
      { motion: "push", action: "jab (a strong push: power punch)" }, { motion: "flick-left", action: "hook" }, { motion: "flick-right", action: "hook" },
      { motion: "flick-up", action: "uppercut" }, { motion: "pitch", action: "tip forward to step in, slightly back to step out, far back to guard" },
      { motion: "roll", action: "lean to slip a punch" }, { motion: "shake", action: "get up after a knockdown" },
    ],
    calibrationProfile: "upright", difficultyLevels: ["cpu"],
    licenceInventory: [CODE_ART], controlModes: ["buttons", "hybrid", "motion"], automatedTestStatus: "unit+e2e",
  },
  {
    id: "bowling-master",
    title: "Bowling Master",
    description: "Ten-pin bowling for up to four: turn your phone to aim, push it towards the TV to roll (harder = faster), twist for hook. Or hold ROLL on the buttons for a power meter, or swipe up on the touchpad. Real strike and spare scoring.",
    categories: ["sports", "party"],
    tags: ["bowling", "turns", "physics", "aim"],
    minPlayers: 1, maxPlayers: 4, version: "1.0.0", executionMode: "browser", controller: "game", orientation: "landscape",
    estimatedAssetKb: 45, difficulty: "easy", sessionMinutes: 8,
    accessibility: ["adjustable-sensitivity", "turn-based", "shot-clock-auto-roll", "gentle-gestures"],
    colors: ["#2f8cff", "#ffd23f"], emoji: "🎳", playable: true,
    catalogueNo: 6, category: "solo-arcade", modes: ["solo", "couch-party", "tournament"], completionStatus: "playable", phase: 2,
    sensorRequirements: { accelerometer: true, gyroscope: "optional" },
    motionMappings: [
      { motion: "roll", action: "swing the aim arrow" }, { motion: "flick-left", action: "step left" }, { motion: "flick-right", action: "step right" },
      { motion: "twist-left", action: "hook left" }, { motion: "twist-right", action: "hook right" },
      { motion: "push", action: "roll the ball (a strong push: power roll)" },
    ],
    calibrationProfile: "upright", difficultyLevels: ["normal"],
    licenceInventory: [CODE_ART], controlModes: ["motion", "buttons", "touchpad"], automatedTestStatus: "unit+e2e",
  },
  {
    id: "air-hockey-motion",
    title: "Air Hockey Motion",
    description: "Glide your striker and smash the puck into the goal: drag on the touchpad, steer with the joystick, or tilt your phone. Play a friend or the CPU. First to 7 wins.",
    categories: ["sports", "versus", "arcade"],
    tags: ["air-hockey", "1v1", "vs-cpu", "physics"],
    minPlayers: 1, maxPlayers: 2, version: "1.0.0", executionMode: "browser", controller: "game", orientation: "landscape",
    estimatedAssetKb: 35, difficulty: "medium", sessionMinutes: 4,
    accessibility: ["cpu-opponent", "adjustable-sensitivity", "absolute-touch-mapping"],
    colors: ["#00c2ff", "#ff2bd6"], emoji: "🏒", playable: true,
    catalogueNo: 16, category: "duo", modes: ["duo-versus", "solo-challenge", "tournament"], completionStatus: "playable", phase: 3,
    sensorRequirements: { accelerometer: true, gyroscope: "unused" },
    motionMappings: [
      { motion: "roll", action: "move the striker left/right on your half" }, { motion: "pitch", action: "move the striker up/down" },
      { motion: "push", action: "smash (a quick lunge at the puck)" },
    ],
    calibrationProfile: "any", difficultyLevels: ["cpu"],
    licenceInventory: [CODE_ART], controlModes: ["touchpad", "buttons", "motion"], automatedTestStatus: "unit+e2e",
  },
];

/** Implemented games first, then the remaining catalogue concepts (hidden from TVs until built). */
export const CATALOG: GameManifest[] = [
  ...IMPLEMENTED,
  ...CONCEPTS.filter((c) => !IMPLEMENTED.some((g) => g.catalogueNo === c.catalogueNo)),
];

export function findGame(id: string): GameManifest | undefined {
  return CATALOG.find((g) => g.id === id);
}
