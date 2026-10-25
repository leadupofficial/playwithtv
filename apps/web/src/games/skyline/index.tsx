/**
 * Skyline Stacker (single-player, falling-block puzzle): help Pip the crane operator build a seaside city
 * floor by floor. 10 levels in 3 worlds (Harbour Town, Storm Quarter with rubble to clear, Sky District with
 * fast blocks); stars for clearing, reaching the score target and using few blocks; rewards are city themes.
 */
import type { GameProps } from "../types";
import { GridShell } from "../kitgrid/Shell";
import { dirControls } from "../kitgrid/controls";
import type { GridTitle } from "../kitgrid/types";
import { LEVELS, StackSim, WORLDS } from "./sim";

const base = dirControls("Skyline Stacker", "move the block", [
  { id: "drop", label: "⤓ Drop", color: "#f39c3d", gestures: ["push"], swipes: ["tap"] },
]);
export const CONTROLS = {
  ...base,
  actions: base.actions.map((a) => (a.id === "up" ? { ...a, label: "⟳ Turn" } : a.id === "down" ? { ...a, label: "▼ Down" } : a)),
  hints: {
    buttons: "◀ ▶ move, ⟳ turn, ▼ down, ⤓ drop",
    touchpad: "Swipe left/right to move, up to turn, down to go down, tap to drop",
    motion: "Flick left/right to move, up to turn, down to go down, push to drop",
  },
};

export const SKYLINE: GridTitle = {
  id: "skyline-stacker",
  name: "Skyline Stacker",
  emoji: "🏗️",
  themes: {
    "": "linear-gradient(180deg, #3a7bd5 0%, #6fb1e8 55%, #f6d19b 100%)",
    "theme-sunset": "linear-gradient(180deg, #2b1e5a 0%, #c0457a 55%, #ffb26b 100%)",
    "theme-night": "linear-gradient(180deg, #050a1f 0%, #142456 60%, #31407a 100%)",
  },
  story: { heroSprite: "crane", heroName: "Pip", worlds: WORLDS },
  levels: LEVELS.map((l) => ({
    name: l.name,
    world: l.world,
    brief: `Build ${l.lines} floors${l.rubble ? ` through ${l.rubble} rows of rubble` : ""} · ★ ${l.target.toLocaleString("en")} points · ★ ${l.pieces} blocks or fewer`,
  })),
  rewards: [
    { stars: 5, id: "theme-sunset", name: "Sunset City", kind: "theme", emoji: "🌇" },
    { stars: 12, id: "trophy-hardhat", name: "Golden Hard Hat", kind: "trophy", emoji: "⛑️" },
    { stars: 18, id: "theme-night", name: "City Lights", kind: "theme", emoji: "🌃" },
    { stars: 30, id: "trophy-key", name: "Key to the City", kind: "trophy", emoji: "🗝️" },
  ],
  controls: CONTROLS,
  menu: { prev: "left", next: "right", ok: "up", back: "down", hint: "◀ ▶ pick a level, ⟳ play, ▼ finish" },
  practice: ["left", "right", "up", "drop"],
  create: (level, seed, o) => new StackSim(LEVELS[level]!, level, seed, o.quick),
};

export function SkylineGame(props: GameProps) {
  return <GridShell {...props} title={SKYLINE} />;
}
