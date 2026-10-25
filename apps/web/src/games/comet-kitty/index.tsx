/**
 * Comet Kitty (single-player, maze chase): an astro-cat collects the stardust that powers Space Station
 * Whisker while four haywire dustbots give chase. 10 levels on 3 decks; stars for clearing, not getting
 * caught and bonking overloaded dustbots; rewards are new suits for Kitty.
 */
import type { GameProps } from "../types";
import { GridShell } from "../kitgrid/Shell";
import { dirControls } from "../kitgrid/controls";
import type { GridTitle } from "../kitgrid/types";
import { LEVELS, WORLDS } from "./levels";
import { KittySim } from "./sim";

export const CONTROLS = dirControls("Comet Kitty", "steer Kitty (she turns at the next gap)");

export const COMET_KITTY: GridTitle = {
  id: "comet-kitty",
  name: "Comet Kitty",
  emoji: "🐱",
  themes: {
    "": "radial-gradient(ellipse at 50% 40%, #1b1f5c 0%, #05061a 75%)",
    "theme-nebula": "radial-gradient(ellipse at 30% 30%, #5a1f6b 0%, #120626 60%, #05061a 100%)",
  },
  story: { heroSprite: "kitty", heroName: "Comet Kitty", worlds: WORLDS },
  levels: LEVELS.map((l) => ({
    name: l.name,
    world: l.world,
    brief: `Collect all the stardust · ${l.bots} dustbot${l.bots > 1 ? "s" : ""} on the prowl · ★ bonk ${l.bonks}`,
  })),
  rewards: [
    { stars: 4, id: "-tabby", name: "Tabby Suit", kind: "skin", sprite: "kitty-tabby" },
    { stars: 10, id: "-midnight", name: "Midnight Suit", kind: "skin", sprite: "kitty-midnight" },
    { stars: 15, id: "theme-nebula", name: "Nebula View", kind: "theme", emoji: "🌌" },
    { stars: 22, id: "-snow", name: "Snow Suit", kind: "skin", sprite: "kitty-snow" },
    { stars: 30, id: "trophy-comet", name: "Golden Comet", kind: "trophy", emoji: "☄️" },
  ],
  controls: CONTROLS,
  menu: { prev: "left", next: "right", ok: "up", back: "down", hint: "◀ ▶ pick a level, ▲ play, ▼ finish" },
  practice: ["up", "right", "down", "left"],
  create: (level, seed, o) => new KittySim(LEVELS[level]!, level, seed, o.skin, o.quick),
};

export function CometKittyGame(props: GameProps) {
  return <GridShell {...props} title={COMET_KITTY} />;
}
