"""
kitplat tiles: one atlas of pre-rendered, seamlessly repeating tiles per world, lit like the heroes.

  blender -b --factory-startup -P tools/blender/kitplat/plat_tiles.py -- <world> <out_dir> [preview.png]

Terrain is auto-tiled by the game: top-{l,m,r,s} (with a cap: parapet, grass, cornice) and fill-{l,m,r,s}, each
rendered at 4 horizontal phases (textures repeat every 4 tiles, so column c uses phase c % 4). Every other tile
(one-way, block, crate, spikes, water, ladder, crumble, timed spikes, gate, slopes, moving platform) and the
decorations the game scatters on top of the ground are in the same atlas. Each tile sprite has a `box`
[ox, oy, w, h] in tiles relative to its cell's bottom-left corner (caps overhang the cell).
"""
from __future__ import annotations

import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402

import plat_common as P  # noqa: E402
import plat_tex as T  # noqa: E402
from plat_world import WORLDS  # noqa: E402

PPM = 96


def render_cell(x0, z0, w, h):
    """Renders the rectangle [x0, x0+w] × [z0, z0+h] of the scene straight on (side view)."""
    cam = bpy.context.scene.camera
    cam.data.ortho_scale = max(w, h)
    cam.location = (x0 + w / 2, -30, z0 + h / 2)
    cam.rotation_euler = (math.pi / 2, 0, 0)
    s = bpy.context.scene
    s.render.resolution_x = max(4, round(w * PPM))
    s.render.resolution_y = max(4, round(h * PPM))
    return P.render_rgba()


def main():
    a = P.argv()
    world, out = a[0], a[1]
    preview = a[2] if len(a) > 2 and a[2] != "-" else None
    W = WORLDS[world]()
    P.reset()
    P.light_rig(W.look, rim_scale=0.6, key_scale=1.0)
    P.side_camera((0, 0, 0), 2, elevation=0)
    P.setup(96, 96, samples=16)
    sheet = P.Sheet(f"tiles-{world}", PPM)
    W.materials()

    def cell(sid, build, x0, z0, w, h, box=None):
        P.clear_scene_objects()
        build()
        img = render_cell(x0, z0, w, h)
        sheet.add(sid, [img], (0, 0), crop=False, box=box or [x0 - math.floor(x0 + 1e-6), z0, w, h])

    CAP = W.cap_h
    for k in range(4):
        for side in ("m", "l", "r"):
            L, R = side in ("l",), side in ("r",)
            xa = k - (W.end_pad if L else 0)
            wa = 1 + (W.end_pad if L or R else 0)
            cell(f"top-{side}-{k}", lambda L=L, R=R, k=k: W.terrain(k, L, R, top=True), xa, 0, wa, 1 + CAP,
                 [-(W.end_pad if L else 0), 0, wa, 1 + CAP])
            cell(f"fill-{side}-{k}", lambda L=L, R=R, k=k: W.terrain(k, L, R, top=False), xa, 0, wa, 1,
                 [-(W.end_pad if L else 0), 0, wa, 1])
    cell("top-s-0", lambda: W.terrain(0, True, True, top=True), -W.end_pad, 0, 1 + 2 * W.end_pad, 1 + CAP, [-W.end_pad, 0, 1 + 2 * W.end_pad, 1 + CAP])
    cell("fill-s-0", lambda: W.terrain(0, True, True, top=False), -W.end_pad, 0, 1 + 2 * W.end_pad, 1, [-W.end_pad, 0, 1 + 2 * W.end_pad, 1])
    cell("slope-up", lambda: W.slope(True), 0, 0, 1, 1 + CAP, [0, 0, 1, 1 + CAP])
    cell("slope-down", lambda: W.slope(False), 0, 0, 1, 1 + CAP, [0, 0, 1, 1 + CAP])
    for side in ("l", "m", "r", "s"):
        cell(f"oneway-{side}", lambda side=side: W.oneway(side), -0.1 if side in "ls" else 0, 0.35, 1.2 if side == "s" else (1.1 if side in "lr" else 1), 0.75,
             [-0.1 if side in "ls" else 0, 0.35, 1.2 if side == "s" else (1.1 if side in "lr" else 1), 0.75])
    cell("block", W.block, -0.04, -0.04, 1.08, 1.12, [-0.04, -0.04, 1.08, 1.12])
    cell("crate", W.crate, -0.04, -0.04, 1.08, 1.12, [-0.04, -0.04, 1.08, 1.12])
    cell("spikes", W.spikes, 0, 0, 1, 0.8, [0, 0, 1, 0.8])
    cell("tspikes-base", W.tspikes_base, 0, 0, 1, 0.3, [0, 0, 1, 0.3])
    cell("tspikes-out", W.spikes, 0, 0, 1, 0.8, [0, 0, 1, 0.8])
    for k in range(4):
        cell(f"water-top-{k}", lambda k=k: W.water(k, True), k, 0, 1, 1.0, [0, 0, 1, 1.0])
        cell(f"water-{k}", lambda k=k: W.water(k, False), k, 0, 1, 1, [0, 0, 1, 1])
    cell("ladder", W.ladder, 0, 0, 1, 1, [0, 0, 1, 1])
    cell("crumble", W.crumble, 0, 0, 1, 1.06, [0, 0, 1, 1.06])
    cell("gate", W.gate, 0, 0, 1, 1, [0, 0, 1, 1])
    cell("platform", W.platform, -1.6, 0.25, 3.2, 0.9, [-1.6, 0.25, 3.2, 0.9])
    # decorations (scattered on the ground by the game): cropped, pivot = ground point
    for i, (did, build, wdt, hgt) in enumerate(W.decos()):
        P.clear_scene_objects()
        build()
        img = render_cell(-wdt / 2, 0, wdt, hgt)
        sheet.add(did, [img], (wdt / 2 * PPM, hgt * PPM), crop=True)
    sheet.save(out, max_w=1500, preview=preview)


if __name__ == "__main__":
    random.seed(7)
    main()
