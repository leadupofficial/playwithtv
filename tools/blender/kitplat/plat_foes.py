"""
kitplat foes: the four enemy kinds and the boss of one world, original creatures built from primitives and
animated procedurally, in one atlas (one draw call for every foe on screen). They face right; the game mirrors.

  blender -b --factory-startup -P tools/blender/kitplat/plat_foes.py -- <world> <out_dir> [preview.png]

Sprites: walker-walk, walker-squash, hopper-idle, hopper-jump, flyer-fly, curler-walk, curler-ball,
         boss-idle, boss-move, boss-attack, boss-hurt, boss-dizzy.
"""
from __future__ import annotations

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import plat_common as P  # noqa: E402
import plat_creatures as K  # noqa: E402

PPM = 96


def main():
    a = P.argv()
    world, out = a[0], a[1]
    preview = a[2] if len(a) > 2 and a[2] != "-" else None
    P.reset()
    P.light_rig(world)
    cam = P.side_camera((0, 0, 0), 1.0, elevation=8)
    sheet = P.Sheet(f"foes-{world}", PPM)

    def frame(w, h, cz):
        P.setup(round(w * PPM), round(h * PPM), samples=16)
        cam.data.ortho_scale = max(w, h)
        el = math.radians(8)
        cam.location = (0, -40 * math.cos(el), cz + 40 * math.sin(el))
        return P.project(cam, (0, 0, 0))

    spec = K.WORLD_FOES[world]
    for kind in ("walker", "hopper", "flyer", "curler"):
        P.clear_scene_objects()
        creature = spec[kind]()
        for clip, n, fps, loop in creature.clips:
            pv = frame(creature.w, creature.h, creature.h / 2 - 0.1)
            frames = []
            for k in range(n):
                creature.pose(clip, k / n if loop else k / max(1, n - 1))
                frames.append(P.render_rgba())
            sheet.add(f"{kind}-{clip}", frames, pv, fps, loop)
    # the boss: bigger, on the biped rig or its own body
    P.clear_scene_objects()
    boss = spec["boss"]()
    for clip, n, fps, loop in boss.clips:
        pv = frame(boss.w, boss.h, boss.h / 2 - 0.2)
        frames = []
        for k in range(n):
            boss.pose(clip, k / n if loop else k / max(1, n - 1))
            frames.append(P.render_rgba())
        sheet.add(f"boss-{clip}", frames, pv, fps, loop)
    sheet.save(out, max_w=1500, preview=preview)


if __name__ == "__main__":
    main()
