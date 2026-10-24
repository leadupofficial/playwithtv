# Third-party assets

Everything here is CC0 1.0 (public domain dedication): free to use, modify and redistribute, no attribution
required. We credit the authors anyway. Each pack's own licence file is copied next to its files under
`apps/web/public/assets/<pack>/`. Games list the packs they use in their manifest's `licenceInventory`
(`packages/protocol/src/catalog.ts`).

Rules for adding assets: CC0 or similarly permissive only (no CC-BY-SA, GPL, NC, or Mixamo raw files);
glTF/GLB without Draco, meshopt or KTX2 (our CSP allows no WebAssembly); ship only the files a game uses.

| Pack | Author | Licence | Source | Used by | Files |
|---|---|---|---|---|---|
| KayKit Character Pack: Adventurers 1.0 | Kay Lousberg | CC0 1.0 | https://kaylousberg.itch.io/kaykit-adventurers (also github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0) | Pillow Fort Brawl | `assets/kaykit-adventurers/` |
| KayKit Furniture Bits 1.0 | Kay Lousberg | CC0 1.0 | https://kaylousberg.itch.io/kaykit-furniture-bits (also github.com/KayKit-Game-Assets/KayKit-Furniture-Bits-1.0) | Pillow Fort Brawl | `assets/kaykit-furniture/` |
| Impact Sounds | Kenney | CC0 1.0 | https://kenney.nl/assets/impact-sounds | Pillow Fort Brawl | `assets/kenney-audio/impact*.ogg` |
| Interface Sounds | Kenney | CC0 1.0 | https://kenney.nl/assets/interface-sounds | Pillow Fort Brawl | `assets/kenney-audio/` (pluck, tick, drop, glass, scratch, bong, confirmation, maximize, minimize) |
| RPG Audio | Kenney | CC0 1.0 | https://kenney.nl/assets/rpg-audio | Pillow Fort Brawl | `assets/kenney-audio/cloth*.ogg` |
| Voiceover Pack (female voice) | Kenney | CC0 1.0 | https://kenney.nl/assets/voiceover-pack | Pillow Fort Brawl | `assets/kenney-audio/vo_*.ogg` |

## How the KayKit files were trimmed

The original character GLBs are ~3.6 MB each because every one embeds all 76 animations. We ship:

- `knight.glb`, `barbarian.glb`, `mage.glb`, `rogue.glb`: mesh + skin only, weapons removed (capes and hats
  kept), texture atlas downsampled to 128×128 (~240 KB each);
- `animations.glb`: the shared rig plus the 15 clips the game uses, resampled (~450 KB); clips bind to any of
  the four characters by bone name;
- `bedroom.glb`: the Furniture Bits pieces used for the room, merged into one file with one 256×256 atlas.

The processing used `@gltf-transform/core` + `functions` (prune, dedup, resample, textureCompress with
sharp) from a scratch directory; nothing of it is a project dependency.
