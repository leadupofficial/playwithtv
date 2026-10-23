import type { GameCategory, GameManifest, GameMode } from "./index.js";

/**
 * The 50-game catalogue as data. Everything here is a concept until it is built: status "concept" means
 * idea only (hidden from TVs). Implemented games live in catalog.ts with full manifests and replace their row.
 * [no, id, title, category, minPlayers, maxPlayers, phase, modes, one-line pitch]
 */
type Row = [number, string, string, GameCategory, number, number, number, GameMode[], string];

const ROWS: Row[] = [
  [1, "gravity-maze-3d", "Gravity Maze 3D", "solo-arcade", 1, 4, 1, ["solo", "async-challenge"], "Tilt the maze to roll a ball past holes and moving barriers to the goal."],
  [2, "sky-gyro-racer", "Sky Gyro Racer", "solo-arcade", 1, 4, 1, ["solo", "couch-party"], "Fly a spacecraft through floating gates: roll to steer, tip to climb or dive, push to boost."],
  [3, "neon-drift-time-attack", "Neon Drift Time Attack", "solo-arcade", 1, 1, 2, ["solo", "async-challenge"], "Steer with roll, throttle with pitch, sway to drift; chase track records."],
  [4, "tilt-jumper-worlds", "Tilt Jumper Worlds", "solo-arcade", 1, 1, 2, ["solo"], "Tilt a bouncing hero across procedural platforms, enemies and power-ups."],
  [5, "motion-blade-trial", "Motion Blade Trial", "solo-arcade", 1, 4, 2, ["solo", "solo-challenge"], "Controlled flicks slice moving targets; avoid hazards and build combos."],
  [6, "bowling-master", "Bowling Master", "solo-arcade", 1, 4, 2, ["solo", "couch-party", "tournament"], "Aim with tilt, release with a gentle push; full pin physics and scoring."],
  [7, "bullseye-motion", "Bullseye Motion", "solo-arcade", 1, 4, 4, ["solo", "couch-party", "tournament"], "Tilt to aim, a controlled push throws; wind and accuracy rings."],
  [8, "rhythm-reactor", "Rhythm Reactor", "solo-arcade", 1, 8, 4, ["solo", "couch-party"], "Answer the TV's beat cues with short directional flicks."],
  [9, "deep-sea-fishing", "Deep Sea Fishing", "solo-arcade", 1, 4, 4, ["solo", "duo-coop", "couch-party"], "Aim, cast with a push, reel with a twisting wrist; rare catches and weather."],
  [10, "zero-g-explorer", "Zero-G Explorer", "solo-arcade", 1, 1, 4, ["solo"], "Pitch, roll and yaw a craft through a 3D maze of gravity fields and gates."],
  [11, "tandem-rocket", "Tandem Rocket", "duo", 2, 4, 3, ["duo-coop", "team-coop"], "Each phone controls part of one rocket: steer and thrust together through rings."],
  [12, "twin-marble-maze", "Twin Marble Maze", "duo", 2, 2, 4, ["duo-coop"], "Two marbles, one physics puzzle: hit switches that open routes for each other."],
  [13, "duo-escape-lab", "Duo Escape Lab", "duo", 2, 2, 2, ["duo-coop"], "Two characters with different abilities solve simultaneous switches and timed rooms."],
  [14, "couple-kart-rivalry", "Couple Kart Rivalry", "duo", 2, 2, 4, ["duo-versus", "duo-coop"], "Tilt racing with boosts, close finishes and best-of-three."],
  [15, "dance-sync-duel", "Dance Sync Duel", "duo", 1, 4, 4, ["duo-versus", "duo-coop", "solo"], "Match gestures to rhythm cues; points for timing and staying in sync."],
  [16, "air-hockey-motion", "Air Hockey Motion", "duo", 2, 4, 3, ["duo-versus", "tournament"], "Orientation moves the striker, a push shoots; rebounds and goals."],
  [17, "motion-tennis", "Motion Tennis", "duo", 1, 2, 3, ["duo-versus", "practice"], "Tilt to position, a short swing gesture hits; serves, rallies and match point."],
  [18, "kitchen-chaos-duo", "Kitchen Chaos Duo", "duo", 2, 4, 3, ["duo-coop", "team-coop"], "Stir, pour, flip and pass food with gestures to keep up with orders."],
  [19, "bridge-balance", "Bridge Balance", "duo", 2, 4, 4, ["duo-coop", "team-coop"], "Balance a shared load across a moving bridge as gravity shifts."],
  [20, "treasure-divers", "Treasure Divers", "duo", 2, 2, 4, ["duo-coop"], "Two divers steer through currents, retrieve treasure and escape in time."],
  [21, "kart-knockout", "Kart Knockout", "competitive", 2, 8, 4, ["couch-party", "tournament"], "Tilt kart racing with drift scoring, shortcuts and elimination rounds."],
  [22, "orb-race-arena", "Orb Race Arena", "competitive", 2, 8, 3, ["couch-party"], "Steer an orb through hazard arenas with bumpers and survival rounds."],
  [23, "motion-sumo", "Motion Sumo", "competitive", 2, 8, 3, ["couch-party", "tournament"], "Tilt to keep balance, a push to shove; ring-outs and stamina."],
  [24, "target-siege", "Target Siege", "competitive", 2, 8, 4, ["team-versus"], "Aim and release projectiles at targets and barriers in teams."],
  [25, "blade-clash", "Blade Clash", "competitive", 2, 4, 4, ["duo-versus", "couch-party"], "Low-movement gesture duels of direction, timing and defence."],
  [26, "bowling-league", "Bowling League", "competitive", 2, 8, 4, ["couch-party", "tournament", "team-versus"], "League play on Bowling Master: tournaments, personal bests, handicaps."],
  [27, "golf-showdown", "Golf Showdown", "competitive", 2, 4, 4, ["couch-party", "tournament"], "Align with tilt, swing with a calibrated gesture; wind and terrain."],
  [28, "global-penalty-cup", "Global Penalty Cup", "competitive", 2, 8, 4, ["couch-party", "team-versus", "tournament"], "Aim and kick penalties against a goalkeeper AI in fictional stadiums."],
  [29, "cricket-super-over", "Cricket Super Over", "competitive", 1, 4, 4, ["solo-challenge", "duo-versus"], "Bat and bowl super overs with orientation aim and gesture timing."],
  [30, "basketball-trick-shot", "Basketball Trick Shot", "competitive", 1, 4, 4, ["solo", "couch-party"], "Aim and release shots at moving hoops; streaks and sudden death."],
  [31, "motion-volleyball", "Motion Volleyball", "competitive", 2, 4, 4, ["team-versus"], "Tilt to position, gestures to serve, pass and spike."],
  [32, "space-dogfight", "Space Dogfight", "competitive", 2, 4, 4, ["couch-party", "team-versus"], "Tilt and turn spacecraft to evade and align shots in timed matches."],
  [33, "tower-panic", "Tower Panic", "competitive", 2, 8, 3, ["couch-party"], "Orient and place blocks on a wobbling tower; last builder standing."],
  [34, "reaction-royale", "Reaction Royale", "competitive", 2, 8, 4, ["couch-party", "tournament"], "Read the TV cue and do the right gesture in time; knockout rounds."],
  [35, "motion-trivia-royale", "Motion Trivia Royale", "competitive", 2, 8, 2, ["couch-party", "team-versus"], "Tilt to an answer, push to lock in; world question packs."],
  [36, "hidden-signal", "Hidden Signal", "competitive", 3, 8, 3, ["couch-party"], "Social deduction: secret choices made by gesture, revealed on the TV."],
  [37, "rocket-repair-crew", "Rocket Repair Crew", "coop-adventure", 2, 6, 4, ["team-coop"], "Each player runs one system to stabilise and launch a damaged rocket."],
  [38, "cargo-movers", "Cargo Movers", "coop-adventure", 2, 4, 4, ["team-coop"], "Carry cargo over ramps and bridges by tilting together."],
  [39, "jungle-rescue-expedition", "Jungle Rescue Expedition", "coop-adventure", 2, 4, 4, ["team-coop"], "Guide explorers through jungle hazards and rescue missions."],
  [40, "submarine-crew", "Submarine Crew", "coop-adventure", 2, 5, 4, ["team-coop"], "Each phone steers, trims or balances one part of a submarine."],
  [41, "boss-team-arena", "Boss Team Arena", "coop-adventure", 2, 4, 3, ["team-coop"], "Aim, attack and evade together to beat original bosses in phases."],
  [42, "sky-relay", "Sky Relay", "coop-adventure", 2, 8, 4, ["team-coop", "team-versus"], "Pass an object between players with timing and orientation."],
  [43, "forest-escape", "Forest Escape", "coop-adventure", 2, 4, 4, ["team-coop"], "Tilt and coordinate to solve traps and hidden paths against the clock."],
  [44, "power-plant-overload", "Power Plant Overload", "coop-adventure", 2, 6, 4, ["team-coop"], "Keep several stabilisers balanced through emergency phases."],
  [45, "alien-zoo-rescue", "Alien Zoo Rescue", "coop-adventure", 2, 4, 4, ["team-coop"], "Herd escaped fictional creatures back to safety with motion tools."],
  [46, "rhythm-orchestra", "Rhythm Orchestra", "coop-adventure", 2, 8, 3, ["team-coop", "practice"], "Each player plays an original instrument with gestures in time."],
  [47, "memory-wave", "Memory Wave", "family-social", 1, 8, 4, ["solo", "couch-party"], "Repeat growing sequences of tilts, twists and flicks."],
  [48, "motion-charades", "Motion Charades", "family-social", 2, 8, 4, ["team-versus"], "Act clues with a limited motion vocabulary; the team picks answers on the TV."],
  [49, "world-quest-challenge", "World Quest Challenge", "family-social", 1, 8, 4, ["solo", "couch-party"], "Geography and culture questions answered by tilting to a direction."],
  [50, "motion-mini-games-festival", "Motion Mini-Games Festival", "family-social", 1, 8, 4, ["couch-party", "team-versus", "tournament"], "Short balance, swing, rhythm and accuracy rounds in a championship."],
];

const COLORS: Record<GameCategory, [string, string]> = {
  "solo-arcade": ["#2f8cff", "#7c3aed"],
  duo: ["#ff6fb5", "#ff7a59"],
  competitive: ["#e2384d", "#ffb020"],
  "coop-adventure": ["#23a55a", "#1f7ae0"],
  "family-social": ["#ffd23f", "#ff7a59"],
};

export const CONCEPTS: GameManifest[] = ROWS.map(([no, id, title, category, min, max, phase, modes, pitch]) => ({
  id, title, description: pitch, categories: [category], tags: [], minPlayers: min, maxPlayers: max,
  version: "0.0.0", executionMode: "browser", controller: "motion", orientation: "landscape", estimatedAssetKb: 0,
  difficulty: "medium", sessionMinutes: 5, accessibility: [], colors: COLORS[category], emoji: "🎮", playable: false,
  catalogueNo: no, category, modes, completionStatus: "concept", phase, automatedTestStatus: "none",
}));
