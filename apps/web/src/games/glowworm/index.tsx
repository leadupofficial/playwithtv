/**
 * Glowworm Grove (single-player, Snake-style): guide Glo the glowworm around night gardens, eating fireflies
 * to grow and slithering over dark lanterns to light them for the Glow Festival.
 * 10 levels in 3 worlds; stars for clearing, lighting every lantern, and a fast clean run; rewards are new
 * glow colours for Glo and a starry-night theme.
 */
import type { GameProps } from "../types";
import { GridShell } from "../kitgrid/Shell";
import { dirControls } from "../kitgrid/controls";
import type { GridTitle } from "../kitgrid/types";
import { LEVELS, WORLDS } from "./levels";
import { WormSim } from "./sim";

export const CONTROLS = dirControls("Glowworm Grove", "turn Glo");

export const GLOWWORM: GridTitle = {
  id: "glowworm-grove",
  name: "Glowworm Grove",
  emoji: "🐛",
  themes: {
    "": "radial-gradient(ellipse at 50% 30%, #1d4a3a 0%, #0c1f1c 70%)",
    "theme-starry": "radial-gradient(ellipse at 50% 20%, #2b2a6b 0%, #0b0b25 70%)",
  },
  story: { heroSprite: "worm-head", heroName: "Glo", worlds: WORLDS },
  levels: LEVELS.map((l) => ({
    name: l.name,
    world: l.world,
    brief: `Eat ${l.goal} fireflies · light the lanterns · ${l.map[0]!.includes("#") ? "mind the hedges" : "the edges wrap around"}`,
  })),
  rewards: [
    { stars: 4, id: "-ember", name: "Ember Glo", kind: "skin", sprite: "worm-head-ember" },
    { stars: 10, id: "theme-starry", name: "Starry Night", kind: "theme", emoji: "🌌" },
    { stars: 16, id: "-frost", name: "Frost Glo", kind: "skin", sprite: "worm-head-frost" },
    { stars: 24, id: "-royal", name: "Royal Glo", kind: "skin", sprite: "worm-head-royal" },
    { stars: 30, id: "trophy-festival", name: "Festival Crown", kind: "trophy", emoji: "👑" },
  ],
  controls: CONTROLS,
  menu: { prev: "left", next: "right", ok: "up", back: "down", hint: "◀ ▶ pick a level, ▲ play, ▼ finish" },
  practice: ["up", "right", "down", "left"],
  create: (level, seed, o) => new WormSim(LEVELS[level]!, level, seed, o.skin, o.quick),
};

export function GlowwormGame(props: GameProps) {
  return <GridShell {...props} title={GLOWWORM} />;
}
