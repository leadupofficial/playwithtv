# Single-player shelf: design notes

Four original titles in the spirit of the arcade classics. Names, characters, stories and art are new; only the
core mechanic (which can't be owned) is shared. All four run on **kitgrid** (`apps/web/src/games/kitgrid/`):
a shared shell with level map, story cards, stars, rewards and turn-passing, so a game is just `sim.ts` + `levels.ts`.

How a family plays: one phone steers per level, and the turn passes after every level, so everybody shares one
campaign. Points add up per player for the match result. Progress lives in the TV's `localStorage`
(`pwtv.grid.<id>`) and costs the server nothing.

Stars (3 per level × 10 levels = 30 per title) unlock rewards: skins for the hero, board themes and trophies.
A world unlocks when you clear the last level of the world before it.

| Classic | Our title | Hero | Inspired mechanic |
|---|---|---|---|
| Snake | **Glowworm Grove** | Glo the glowworm | grow by eating, don't hit walls or yourself |
| Falling blocks | **Skyline Stacker** | Pip the crane operator | rotate/drop pieces, clear full rows |
| Maze chase | **Comet Kitty** | Comet Kitty, astro-cat | eat every dot, power-up turns the chasers |
| Mine-finder | **Buzz Field** | Bea the beekeeper | numbered clues, flag hidden hazards |

---

## Glowworm Grove 🐛
**Story.** On the night of the Glow Festival every lantern in the Grove went dark. Glo, the smallest glowworm,
eats fireflies to grow longer and brighter and slithers over each dark lantern to light it again.

**Worlds & levels** (24 × 14 gardens drawn in text, see `glowworm/levels.ts`)
1. *The Meadow*: Mossy Meadow, Hedge Rows, Open Fields (first wrap-around garden)
2. *Mushroom Hollow*: First Burrow, Cap Circle, Spore Maze (paired burrows teleport Glo)
3. *Moonlit Pond*: Lily Pads, Reed Rings, Firefly Storm, Festival Night

Speed goes up a little with each firefly; every 5th firefly is a golden one that flies away after 7 s.

**Stars.** ★ eat the goal number of fireflies · ★ light every lantern · ★ beat par time with no bumps.
**Rewards.** 4★ Ember Glo · 10★ Starry Night theme · 16★ Frost Glo · 24★ Royal Glo · 30★ Festival Crown.

## Skyline Stacker 🏗️
**Story.** A new city is going up by the sea. Pip runs the biggest crane in town: every full row is a finished
floor. After a storm the streets are full of rubble, and the last towers reach above the clouds.

**Worlds & levels** (`skyline/sim.ts`)
1. *Harbour Town*: Ground Floor (5 rows), Corner Shop (8), Harbour Row (12)
2. *Storm Quarter*: Fallen Signs, Flooded Lane, Storm Drain. These start with 3–7 rows of rubble, each with one gap.
3. *Sky District*: Cloud Line, Glass Tower, Wind Shear, The Spire (25 rows, fastest drop)

Includes a ghost preview, a 3-piece next window, a 7-bag randomiser, wall kicks and a 0.5 s lock delay. Clearing
4 rows at once gives a Skyline bonus.

**Stars.** ★ build the floors · ★ reach the score target · ★ use no more than N blocks.
**Rewards.** 5★ Sunset City theme · 12★ Golden Hard Hat · 18★ City Lights theme · 30★ Key to the City.

## Comet Kitty 🐱
**Story.** Space Station Whisker runs on stardust, and Comet Kitty is its best collector. Tonight the cleaning
dustbots (Rusty, Rosie, Sparky and Buzz) got their wires crossed and chase anyone in sight. A nova star
overloads them so Kitty can bonk them back to their dock.

**Worlds & levels** (`comet-kitty/levels.ts`, 3 mazes of 19 × 21 with warp tunnels)
1. *Cargo Deck*: Loading Bay (1 bot), Crate Corners (2), Night Shift (3)
2. *Hydro Garden*: Pipe Garden, Sprinkler Run, Greenhouse (4 bots)
3. *Star Core*: Core Gate, Reactor Ring, Gravity Well, Star Heart (shortest nova time)

Each bot has its own personality: Rusty chases, Rosie cuts you off ahead, Sparky flanks using Rusty's position,
and Buzz is shy up close. Bots switch between patrol and chase phases. Comets appear twice per level for
bonus points.

**Stars.** ★ collect all stardust · ★ don't get caught · ★ bonk N overloaded dustbots.
**Rewards.** 4★ Tabby Suit · 10★ Midnight Suit · 15★ Nebula View theme · 22★ Snow Suit · 30★ Golden Comet.

## Buzz Field 🐝
**Story.** Beekeeper Bea is mowing paths for the Summer Fair, but wild bees have built hives under the turf.
Each mowed patch shows how many hives buzz next to it. Flag every hive so fair-goers stay clear, and find the
Queen's own meadow.

**Worlds & levels** (`buzz-field/sim.ts`)
1. *Clover Patch*: 8×6 → 10×8, 2 honey jars
2. *Sunflower Rows*: 11×8 → 13×9, 1 jar
3. *The Royal Meadow*: 14×10 → 16×12 (38 hives), no jars

The first mow is always safe and opens an area. A honey jar absorbs one wrong dig. Mowing a number whose hives
are all flagged mows the rest of its neighbours. The clock only starts at the first dig.

**Stars.** ★ mow every safe patch · ★ beat par time · ★ flag every hive exactly, with no stings.
**Rewards.** 4★ Blue Ribbon · 10★ Golden Hour theme · 18★ Honey Pot · 30★ Friend of the Queen.

---

### Art
All sprites are original Blender renders from `tools/blender/kitgrid/grid_sprites.py` (49 sprites, about 86 KB
WebP, CC0). Rebuild with:

```sh
blender -b --factory-startup -P tools/blender/kitgrid/grid_sprites.py -- apps/web/public/assets/grid
```

### Adding a level
Copy a garden/maze block in `levels.ts`, edit the text grid, and run `pnpm test`. `kitgrid.test.ts` checks that
every lantern or stardust can be reached and that mazes have no dead ends.
