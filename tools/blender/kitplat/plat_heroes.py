"""
kitplat heroes: three original characters built from primitives on the kitplat biped rig, rendered side-on into
one atlas each (11 clips, mirrored in the game for facing left). Garments the game recolours per player are painted
magenta (#e0218a, hue ~330°): the game's keyed tint swaps exactly those texels for the player's colour.

  blender -b --factory-startup -P tools/blender/kitplat/plat_heroes.py -- <hero> <out_dir> [preview.png] [clips]

Heroes: keeri (a mongoose courier, Monsoon Courier), diya (a festival kid, Lantern Lane), asha (a step-well
explorer, Stepwell Secrets).
"""
from __future__ import annotations

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mathutils import Vector  # noqa: E402

import plat_common as P  # noqa: E402
import plat_rig as R  # noqa: E402

PAINT = "#e0218a"
PPM = 96  # atlas pixels per metre (= per tile) at full size; the lite copy is half


def eye(rig, centre, r, direction, size=0.07, iris="#2a1a12"):
    d = Vector(direction).normalized()
    c = Vector(centre)
    white = P.sphere(P.mat("#f7f3ea", 0.25, coat=0.6), tuple(c + d * (r - size * 0.35)), (size * 0.62, size, size * 1.25), r=1)
    white.rotation_euler = d.to_track_quat("X", "Z").to_euler()
    pupil = P.sphere(P.mat(iris, 0.2, coat=1.0), tuple(c + d * (r + size * 0.12)), (size * 0.45, size * 0.62, size * 0.8), r=1)
    pupil.rotation_euler = white.rotation_euler
    hi = P.sphere(P.mat("#ffffff", 0.1, emit=2.0), tuple(c + d * (r + size * 0.45) + Vector((0, 0, size * 0.35))), (0.014, 0.014, 0.014), r=1)
    for o in (white, pupil, hi):
        P.attach(o, rig.head)


def limbs(rig, thigh, shin, foot, arm, hand, sleeve=None, leg_r=0.062, arm_r=0.048, boot=None):
    for s, y in (("L", 0.085), ("R", -0.085)):
        y = y if s == "L" else y
        P.attach(P.capsule(thigh, (0, y, 0.46), (0, y, 0.25), leg_r, leg_r * 0.92), rig.th[s])
        P.attach(P.capsule(shin, (0, y, 0.25), (0, y, 0.07), leg_r * 0.9, leg_r * 0.78), rig.kn[s])
        P.attach(P.sphere(foot, (0.045, y, 0.05), (0.12, 0.072, 0.055), r=1), rig.kn[s])
        if boot:
            P.attach(P.cyl(boot, (0.0, y, 0.12), leg_r * 1.05, 0.12), rig.kn[s])
        ys = 0.17 if s == "L" else -0.17
        P.attach(P.capsule(sleeve or arm, (0, ys, 0.76), (0, ys, 0.61), arm_r * 1.15, arm_r), rig.sh[s])
        P.attach(P.capsule(arm, (0, ys, 0.61), (0, ys, 0.48), arm_r, arm_r * 0.9), rig.el[s])
        P.attach(P.sphere(hand, (0.01, ys, 0.45), (0.058, 0.05, 0.06), r=1), rig.el[s])


# ---------------------------------------------------------------------------------------------------------------


def keeri(rig):
    """A mongoose courier: grizzled tawny fur, cream chin, long tapering tail, magenta rain jacket, yellow satchel, teal sneakers."""
    fur = P.mat("#ab8c62", 0.85, sheen=0.6, bump=0.3, bump_scale=70, vary=0.16)
    dark = P.mat("#5d4632", 0.85, sheen=0.5, bump=0.25, bump_scale=70)
    cream = P.mat("#ead7ad", 0.85, sheen=0.5, bump=0.2, bump_scale=60)
    jacket = P.mat(PAINT, 0.45, coat=0.5)
    shoe = P.mat("#18a39a", 0.4, coat=0.3)
    sole = P.mat("#f2efe6", 0.6)
    limbs(rig, dark, dark, shoe, fur, dark, sleeve=jacket, leg_r=0.058)
    for s, y in (("L", 0.085), ("R", -0.085)):
        P.attach(P.sphere(sole, (0.05, y, 0.018), (0.125, 0.075, 0.02), r=1), rig.kn[s])
    P.attach(P.sphere(jacket, (0, 0, 0.62), (0.18, 0.165, 0.2), r=1), rig.chest)
    P.attach(P.sphere(cream, (0.07, -0.01, 0.6), (0.14, 0.14, 0.16), r=1), rig.chest)
    P.attach(P.sphere(fur, (0, 0, 0.5), (0.17, 0.16, 0.12), r=1), rig.hips)
    P.attach(P.torus(P.mat("#c9156e", 0.5), (0, 0, 0.8), 0.13, 0.04, scale=(1, 1, 0.8)), rig.chest)  # hood roll
    # satchel: strap over the shoulder, bag at the back hip
    P.attach(P.torus(P.mat("#5a3b22", 0.6), (0, 0, 0.64), 0.2, 0.018, rot=(0, -38, 0), scale=(1, 1.02, 1.1)), rig.chest)
    bag = P.box(P.mat("#f2b62b", 0.5, coat=0.4), (-0.15, -0.16, 0.5), (0.18, 0.08, 0.15), bevel=0.03)
    flap = P.box(P.mat("#d9971a", 0.5), (-0.15, -0.205, 0.55), (0.185, 0.02, 0.07), bevel=0.01)
    for o in (bag, flap):
        P.attach(o, rig.hips)
    # head: a slim, pointed mongoose face: tapering snout, tiny round ears, dark nose, big bright eyes
    hc = (0.0, 0, 1.0)
    P.attach(P.sphere(fur, hc, (0.24, 0.2, 0.21), r=1), rig.head)
    snout = P.cone(fur, (0.25, 0, 0.955), 0.15, 0.045, 0.3, rot=(0, 90, 0), scale=(0.8, 1, 1))
    P.attach(snout, rig.head)
    P.attach(P.sphere(cream, (0.2, 0, 0.9), (0.15, 0.1, 0.06), r=1), rig.head)       # pale chin
    P.attach(P.sphere(P.mat("#24170f", 0.25, coat=0.9), (0.405, 0, 0.958), (0.04, 0.038, 0.034), r=1), rig.head)
    P.attach(P.sphere(P.mat("#5b4330", 0.8, sheen=0.5), (0.1, 0, 1.06), (0.16, 0.17, 0.05), r=1), rig.head)  # brow fur
    for y in (0.13, -0.13):
        P.attach(P.sphere(dark, (-0.1, y, 1.16), (0.045, 0.025, 0.045), r=1), rig.head)
        P.attach(P.sphere(P.mat("#c98a7c", 0.7), (-0.095, y - 0.01 * (1 if y > 0 else -1), 1.16), (0.03, 0.01, 0.03), r=1), rig.head)
    eye(rig, hc, 0.21, (0.55, -0.78, 0.3), 0.072)
    eye(rig, hc, 0.21, (0.78, 0.5, 0.3), 0.066)
    # long tail: thick at the base, tapering to a dark tip, carried in a curve
    rig.tail = rig.chain("tail", rig.hips, (-0.13, 0, 0.03), 5, 0.13)
    P.bpy.context.view_layer.update()
    grizzle = P.mat("#98805e", 0.9, sheen=0.7, bump=0.3, bump_scale=70, vary=0.15)
    for k, j in enumerate(rig.tail):
        w = j.matrix_world.translation
        r = (0.105, 0.1, 0.088, 0.072, 0.055)[k]
        m = P.mat("#33241a", 0.9, sheen=0.6, bump=0.3, bump_scale=70) if k == 4 else grizzle
        P.attach(P.sphere(m, (w.x - 0.07, w.y, w.z), (0.15, r, r), r=1), j)


def diya(rig):
    """A festival kid: magenta kurta with gold trim, white pyjamas, marigold garland, hair in a top bun."""
    skin = P.mat("#c98c5d", 0.5, sheen=0.2)
    kurta = P.mat(PAINT, 0.55, sheen=0.4, bump=0.08, bump_scale=120)
    pants = P.mat("#f4efe2", 0.7, sheen=0.3)
    sandal = P.mat("#7a4a26", 0.6)
    gold = P.mat("#f0b429", 0.25, metal=0.85)
    hair = P.mat("#2a1c16", 0.55, sheen=0.4, bump=0.25, bump_scale=160)
    limbs(rig, pants, skin, sandal, skin, skin, sleeve=kurta, leg_r=0.06)
    P.attach(P.cone(kurta, (0, 0, 0.52), 0.24, 0.15, 0.34, scale=(1, 0.95, 1)), rig.hips)  # kurta skirt
    P.attach(P.torus(gold, (0, 0, 0.36), 0.235, 0.02, scale=(1, 0.95, 1)), rig.hips)
    P.attach(P.sphere(kurta, (0, 0, 0.66), (0.17, 0.16, 0.17), r=1), rig.chest)
    garland = P.torus(P.mat("#ff8a12", 0.8, bump=0.6, bump_scale=90), (0.02, 0, 0.76), 0.14, 0.035, rot=(0, -20, 0))
    P.attach(garland, rig.chest)
    P.attach(P.cyl(skin, (0, 0, 0.8), 0.06, 0.08), rig.chest)
    hc = (0.0, 0, 1.02)
    P.attach(P.sphere(skin, hc, (0.25, 0.24, 0.25), r=1), rig.head)
    P.attach(P.sphere(hair, (-0.03, 0, 1.08), (0.25, 0.25, 0.22), r=1), rig.head)       # hair cap
    P.attach(P.sphere(hair, (-0.06, 0, 1.3), (0.1, 0.1, 0.1), r=1), rig.head)           # top bun
    P.attach(P.torus(gold, (-0.06, 0, 1.25), 0.075, 0.015), rig.head)
    P.attach(P.sphere(skin, (0.235, -0.02, 0.98), (0.04, 0.035, 0.04), r=1), rig.head)  # nose
    P.attach(P.sphere(P.mat("#e05a7a", 0.5), (0.2, -0.1, 0.9), (0.03, 0.02, 0.012), r=1), rig.head)
    P.attach(P.sphere(P.mat("#ff3b30", 0.3, emit=0.5), (0.24, 0.0, 1.13), (0.016, 0.016, 0.016), r=1), rig.head)  # bindi
    eye(rig, hc, 0.245, (0.68, -0.66, 0.08), 0.07)
    eye(rig, hc, 0.245, (0.86, 0.42, 0.08), 0.065)
    for y in (0.23, -0.23):
        P.attach(P.sphere(skin, (-0.0, y, 1.0), (0.04, 0.03, 0.055), r=1), rig.head)    # ears
        P.attach(P.sphere(gold, (0.0, y * 1.03, 0.95), (0.018, 0.018, 0.018), r=1), rig.head)


def asha(rig):
    """A step-well explorer: long magenta scarf, khaki vest over a cream shirt, brown trousers, boots, a braid."""
    skin = P.mat("#b77a4c", 0.5, sheen=0.2)
    shirt = P.mat("#efe4cc", 0.7, sheen=0.3)
    vest = P.mat("#8e7d4e", 0.75, bump=0.15, bump_scale=90)
    trousers = P.mat("#5c4532", 0.8, bump=0.1, bump_scale=120)
    boot = P.mat("#3a271b", 0.45, coat=0.3)
    scarf = P.mat(PAINT, 0.6, sheen=0.5, bump=0.08, bump_scale=140)
    hair = P.mat("#2b1d14", 0.55, sheen=0.4, bump=0.25, bump_scale=160)
    brass = P.mat("#d6a23a", 0.3, metal=0.8)
    limbs(rig, trousers, trousers, boot, skin, skin, sleeve=shirt, leg_r=0.062, boot=boot)
    P.attach(P.sphere(shirt, (0, 0, 0.63), (0.18, 0.17, 0.2), r=1), rig.chest)
    P.attach(P.sphere(vest, (-0.005, 0, 0.62), (0.185, 0.175, 0.17), r=1), rig.chest)
    P.attach(P.sphere(trousers, (0, 0, 0.5), (0.17, 0.16, 0.11), r=1), rig.hips)
    P.attach(P.torus(P.mat("#4a301d", 0.5), (0, 0, 0.5), 0.165, 0.025, scale=(1, 0.97, 1)), rig.hips)  # belt
    P.attach(P.box(brass, (0.16, -0.03, 0.5), (0.025, 0.05, 0.04), bevel=0.008), rig.hips)
    P.attach(P.box(P.mat("#7b5233", 0.6), (-0.06, -0.17, 0.47), (0.12, 0.06, 0.1), bevel=0.02), rig.hips)  # pouch
    P.attach(P.torus(scarf, (0.0, 0, 0.8), 0.12, 0.05, scale=(1, 1, 0.7)), rig.chest)
    hc = (0.0, 0, 1.02)
    P.attach(P.sphere(skin, hc, (0.25, 0.24, 0.25), r=1), rig.head)
    P.attach(P.sphere(hair, (-0.035, 0, 1.08), (0.255, 0.252, 0.225), r=1), rig.head)
    P.attach(P.sphere(skin, (0.235, -0.02, 0.98), (0.04, 0.035, 0.04), r=1), rig.head)
    P.attach(P.sphere(P.mat("#a8483e", 0.5), (0.2, -0.1, 0.9), (0.03, 0.02, 0.012), r=1), rig.head)
    eye(rig, hc, 0.245, (0.68, -0.66, 0.08), 0.068)
    eye(rig, hc, 0.245, (0.86, 0.42, 0.08), 0.064)
    for y in (0.23, -0.23):
        P.attach(P.sphere(skin, (-0.0, y, 1.0), (0.04, 0.03, 0.055), r=1), rig.head)
    P.attach(P.torus(brass, (-0.2, 0, 1.06), 0.04, 0.012, rot=(0, 90, 0)), rig.head)  # braid clasp
    # braid hangs from the head as a short chain; the scarf tail streams from the neck
    braid = rig.chain("braid", rig.head, (-0.22, 0, 1.0 - R.HIP_Z - R.HEAD_Z), 3, 0.09, (-0.4, 0, -1))
    rig.scarf = rig.chain("scarf", rig.chest, (-0.1, -0.02, 0.8 - R.HIP_Z), 4, 0.11)
    P.bpy.context.view_layer.update()
    for j in braid:
        w = j.matrix_world.translation
        P.attach(P.sphere(hair, (w.x - 0.02, w.y, w.z - 0.045), (0.065, 0.06, 0.075), r=1), j)
    for k, j in enumerate(rig.scarf):
        w = j.matrix_world.translation
        P.attach(P.sphere(scarf, (w.x - 0.06, w.y, w.z), (0.1, 0.035, 0.075 - 0.006 * k), r=1), j)


HEROES = {"keeri": (keeri, "monsoon"), "diya": (diya, "festival"), "asha": (asha, "stepwell")}


def main():
    a = P.argv()
    hero, out = a[0], a[1]
    preview = a[2] if len(a) > 2 and a[2] != "-" else None
    only = a[3].split(",") if len(a) > 3 else None
    build, look = HEROES[hero]
    P.reset()
    rig = R.Rig()
    build(rig)
    P.light_rig(look)
    ortho = 2.4
    size = int(ortho * PPM)
    cam = P.side_camera((0, 0, 0.85), ortho, elevation=6)
    P.setup(size, size, samples=16)
    sheet = P.Sheet(f"{hero}", PPM)
    pivot = P.project(cam, (0, 0, 0))
    for clip, (n, fps, loop) in R.CLIPS.items():
        if only and clip not in only:
            continue
        frames = []
        for k, t in enumerate(R.frame_times(n, loop)):
            rig.apply(R.clip_pose(clip, t, k, n))
            frames.append(P.render_rgba())
        sheet.add(clip, frames, pivot, fps, loop)
    sheet.save(out, max_w=1536, preview=preview)


if __name__ == "__main__":
    main()
