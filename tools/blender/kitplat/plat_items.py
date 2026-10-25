"""
kitplat items: pick-ups, power-ups, springs, checkpoints, goals, levers, loops, projectiles and effect sprites for
one world, in one atlas (one draw call for everything small that is not a hero or a foe).

  blender -b --factory-startup -P tools/blender/kitplat/plat_items.py -- <world> <out_dir> [preview.png]
"""
from __future__ import annotations

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
from mathutils import Euler  # noqa: E402

import plat_common as P  # noqa: E402

PPM = 96

GEM = {"monsoon": ("#3fb6ff", "#9fe3ff"), "festival": ("#ffc21a", "#fff0a0"), "stepwell": ("#2fd6a0", "#aef5da")}


def group(objs):
    root = P.joint("grp")
    for o in objs:
        P.attach(o, root)
    return root


def spin_frames(root, n, axis=2, tilt=0.0):
    out = []
    for k in range(n):
        e = [math.radians(tilt), 0, 0]
        e[axis] = 2 * math.pi * k / n
        root.rotation_euler = Euler(e)
        out.append(P.render_rgba())
    return out


def gem(color, light, size=0.24):
    m = P.mat(color, 0.08, coat=1.0, emit=0.6)
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=size)
    g = bpy.context.active_object
    g.scale = (0.8, 0.8, 1.15)
    g.data.materials.append(m)
    hi = P.sphere(P.mat(light, 0.1, emit=3.0), (-size * 0.3, -size * 0.75, size * 0.35), (size * 0.12, size * 0.06, size * 0.12), r=1, seg=8)
    return [g, hi]


def coinish(color, size=0.26):
    """A thick embossed disc (used for the step-well's old gold coins)."""
    m = P.mat(color, 0.25, metal=0.9)
    c = P.cyl(m, (0, 0, 0), size, 0.07, rot=(90, 0, 0), verts=32, bevel=0.015)
    t = P.torus(P.mat(color, 0.3, metal=0.9), (0, -0.04, 0), size * 0.65, 0.02, rot=(90, 0, 0))
    return [c, t]


def main():
    a = P.argv()
    world, out = a[0], a[1]
    preview = a[2] if len(a) > 2 and a[2] != "-" else None
    P.reset()
    P.light_rig({"monsoon": "monsoon", "festival": "festival", "stepwell": "stepwell"}[world])
    cam = P.side_camera((0, 0, 0), 1.0, elevation=8)
    sheet = P.Sheet(f"items-{world}", PPM)

    def view(w, h, cx=0.0, cz=0.0):
        P.setup(max(8, round(w * PPM)), max(8, round(h * PPM)), samples=16)
        cam.data.ortho_scale = max(w, h)
        el = math.radians(8)
        cam.location = (cx, -40 * math.cos(el), cz + 40 * math.sin(el))
        return P.project(cam, (0, 0, 0))

    def add(sid, frames, pivot, fps=10, loop=True):
        sheet.add(sid, frames, pivot, fps, loop)

    col, light = GEM[world]
    # gems
    for sid, size in (("gem", 0.22), ("biggem", 0.4)):
        P.clear_scene_objects()
        root = group(coinish(col, size) if world == "stepwell" else gem(col, light, size))
        pv = view(size * 3, size * 3)
        add(sid, spin_frames(root, 8), pv, 12)
    # power-ups
    for pid, build in POWERS[world]:
        P.clear_scene_objects()
        root = group(build())
        pv = view(1.0, 1.0)
        frames = []
        for k in range(6):
            root.rotation_euler = Euler((0, 0, math.radians(-30 + 60 * math.sin(2 * math.pi * k / 6))))
            root.location = (0, 0, 0.04 * math.sin(2 * math.pi * k / 6))
            frames.append(P.render_rgba())
        add(pid, frames, pv, 8)
    for pid, build, w, h in OVERLAYS.get(world, []):
        P.clear_scene_objects()
        build()
        pv = view(w, h, 0, h / 2)
        add(pid, [P.render_rgba()], pv)
    # spring: compress then extend
    P.clear_scene_objects()
    spring = SPRING[world]
    frames = []
    pv = view(1.0, 1.4, 0, 0.6)
    for k, sq in enumerate((1.0, 0.55, 1.35, 1.1)):
        P.clear_scene_objects()
        spring(sq)
        frames.append(P.render_rgba())
    add("spring", frames, pv, 14, False)
    # checkpoint (off / waving), goal, lever, boost, loop
    for sid, build, w, h, n, fps in BIG[world]:
        frames = []
        pv = view(w, h, 0, h / 2)
        for k in range(n):
            P.clear_scene_objects()
            build(k / max(1, n))
            frames.append(P.render_rgba())
        add(sid, frames, pv, fps)
    # projectiles and effects
    for sid, build, w, n in FX[world]:
        frames = []
        pv = view(w, w)
        for k in range(n):
            P.clear_scene_objects()
            build(k / n)
            frames.append(P.render_rgba())
        add(sid, frames, pv, 14)
    sheet.save(out, max_w=1500, preview=preview)


# ---------------------------------------------------------------------------------------------------------------
# world content


def umbrella(open_=False):
    canopy = P.mat("#2a7fff", 0.4, coat=0.5)
    objs = [P.sphere(canopy, (0, 0, 0.25 if not open_ else 0.6), (0.38 if not open_ else 0.7, 0.38 if not open_ else 0.7, 0.18 if not open_ else 0.3), r=1, seg=20)]
    objs.append(P.cyl(P.mat("#4a3020", 0.6), (0, 0, 0.0 if not open_ else 0.3), 0.025, 0.6))
    objs.append(P.torus(P.mat("#4a3020", 0.6), (0.06, 0, -0.3 if not open_ else 0.0), 0.06, 0.02, rot=(90, 0, 0)))
    if open_:
        for i in range(8):
            a = i * math.pi / 4
            objs.append(P.sphere(P.mat("#ffd23f", 0.4), (math.cos(a) * 0.66, math.sin(a) * 0.66, 0.5), (0.05, 0.05, 0.05), r=1, seg=8))
    return objs


def chai():
    glass = P.mat("#ffffff", 0.05, coat=1.0, alpha=0.5)
    return [P.cyl(P.mat("#b8692e", 0.3, emit=0.4), (0, 0, -0.05), 0.16, 0.36, verts=24), P.cyl(glass, (0, 0, 0.0), 0.19, 0.5, verts=24),
            P.sphere(P.mat("#ffffff", 0.3, emit=1.5), (0.04, 0, 0.33), (0.08, 0.08, 0.06), r=1, seg=8)]


def tiffin():
    steel = P.mat("#d9dfe3", 0.15, metal=1.0)
    objs = [P.cyl(steel, (0, 0, -0.2 + i * 0.17), 0.22, 0.15, verts=28, bevel=0.01) for i in range(3)]
    objs.append(P.torus(P.mat("#c41e3a", 0.4), (0, 0, 0.32), 0.14, 0.03, rot=(90, 0, 0)))
    objs.append(P.box(P.mat("#c41e3a", 0.4), (0, -0.23, 0.0), (0.05, 0.02, 0.55), bevel=0))
    return objs


def kite(scale=1.0):
    from plat_world import prism
    k = scale
    sail = prism(P.mat("#e8336d", 0.5, sheen=0.4), [(0, 0.5 * k), (0.36 * k, 0.05 * k), (0, -0.55 * k), (-0.36 * k, 0.05 * k)], -0.02, 0.02, "kite")
    band = prism(P.mat("#ffd23f", 0.5, sheen=0.4), [(0, 0.5 * k), (0.12 * k, 0.05 * k), (0, -0.55 * k), (-0.12 * k, 0.05 * k)], -0.035, -0.02, "band")
    s1 = P.box(P.mat("#7a5232", 0.6), (0, -0.05, -0.02 * k), (0.03 * k, 0.02, 1.05 * k), bevel=0)
    s2 = P.box(P.mat("#7a5232", 0.6), (0, -0.05, 0.05 * k), (0.72 * k, 0.02, 0.03 * k), bevel=0)
    tail = [P.sphere(P.mat(["#2ec4b6", "#ffd23f", "#2ec4b6"][i % 3], 0.5), (0.06 * k * math.sin(i * 1.2), -0.02, (-0.62 - 0.13 * i) * k), (0.06 * k, 0.015, 0.035 * k), r=1, seg=8) for i in range(5)]
    return [sail, band, s1, s2, *tail]


def sparkler():
    out = [P.cyl(P.mat("#555b60", 0.4, metal=0.7), (0, 0, -0.12), 0.018, 0.62, rot=(0, 20, 0)),
           P.sphere(P.mat("#ffb84a", 0.2, emit=3.0), (0.1, 0, 0.2), (0.08, 0.08, 0.08), r=1, seg=12)]
    for i in range(10):
        a = i * 2 * math.pi / 10
        c = "#ffd23f" if i % 2 else "#ff7a1a"
        out.append(P.cyl(P.mat(c, 0.2, emit=3.0), (0.1 + math.cos(a) * 0.14, 0, 0.2 + math.sin(a) * 0.14), 0.012, 0.18 + 0.06 * (i % 3), rot=(0, -math.degrees(a) + 90, 0)))
    return out


def lantern(scale=1.0):
    return [P.sphere(P.mat("#ff5a36", 0.4, emit=2.5), (0, 0, 0), (0.24 * scale, 0.24 * scale, 0.3 * scale), r=1, seg=20),
            P.cyl(P.mat("#f2c230", 0.3, metal=0.8), (0, 0, 0.3 * scale), 0.1 * scale, 0.06 * scale),
            P.cyl(P.mat("#f2c230", 0.3, metal=0.8), (0, 0, -0.3 * scale), 0.1 * scale, 0.06 * scale),
            *[P.torus(P.mat("#c4122d", 0.5), (0, 0, z * scale), 0.24 * scale * math.cos(z * 2.5), 0.012 * scale) for z in (-0.15, 0, 0.15)]]


def feather():
    return [P.sphere(P.mat("#2ec4b6", 0.5, sheen=0.6), (0, 0, 0), (0.12, 0.03, 0.4), rot=(0, 25, 0), r=1, seg=16),
            P.cyl(P.mat("#f4efe2", 0.5), (0, -0.03, 0), 0.012, 0.85, rot=(0, 25, 0)),
            P.sphere(P.mat("#1d3f8f", 0.5), (0.1, -0.03, 0.2), (0.05, 0.02, 0.08), rot=(0, 25, 0), r=1, seg=10)]


def bell_item():
    brass = P.mat("#d6a23a", 0.25, metal=0.9)
    return [P.cone(brass, (0, 0, 0), 0.26, 0.1, 0.38, verts=24), P.sphere(brass, (0, 0, -0.22), (0.06, 0.06, 0.06), r=1, seg=10),
            P.torus(brass, (0, 0, 0.24), 0.06, 0.02, rot=(90, 0, 0))]


def lamp_item():
    return [P.sphere(P.mat("#a5532d", 0.7), (0, 0, -0.08), (0.24, 0.24, 0.09), r=1, seg=18),
            P.cone(P.mat("#ffcf5a", 0.2, emit=8.0), (0.06, 0, 0.1), 0.07, 0.0, 0.26, verts=10)]


POWERS = {
    "monsoon": [("umbrella", umbrella), ("chai", chai), ("tiffin", tiffin)],
    "festival": [("kite", kite), ("sparkler", sparkler), ("lantern", lantern)],
    "stepwell": [("feather", feather), ("bell", bell_item), ("lamp", lamp_item)],
}
OVERLAYS = {
    "monsoon": [("umbrella-open", lambda: umbrella(True), 1.6, 1.2)],
    "festival": [("kite-open", lambda: [setattr(o.location, "z", o.location.z + 0.95) for o in kite(1.3)], 1.2, 1.9)],
    "stepwell": [("feather-open", lambda: [P.sphere(P.mat("#2ec4b6", 0.5, sheen=0.6), (x, 0, 0.3), (0.35, 0.03, 0.1), rot=(0, a, 0), r=1, seg=14) for x, a in ((-0.4, 20), (0.4, -20))], 1.4, 0.8)],
}


def spring_generic(coil, pad):
    def build(sq):
        h = 0.45 * sq
        for i in range(6):
            P.torus(P.mat(coil, 0.25, metal=0.9), (0, 0, 0.08 + i * h / 6), 0.22, 0.03)
        P.cyl(P.mat("#3a3f43", 0.4, metal=0.6), (0, 0, 0.04), 0.32, 0.08, verts=24, bevel=0.01)
        P.cyl(P.mat(pad, 0.4, coat=0.4), (0, 0, 0.1 + h), 0.34, 0.09, verts=24, bevel=0.02)
    return build


SPRING = {"monsoon": spring_generic("#c9d1d6", "#ff7a1a"), "festival": spring_generic("#f2c230", "#e8336d"), "stepwell": spring_generic("#c08a55", "#2ec4b6")}


def flag_post(cloth, on, t, pole="#5e6b73"):
    P.cyl(P.mat(pole, 0.35, metal=0.7), (0, 0, 0.9), 0.04, 1.8)
    P.sphere(P.mat("#f2c230", 0.3, metal=0.9), (0, 0, 1.82), (0.07, 0.07, 0.07), r=1, seg=12)
    if on:
        for i in range(6):
            x = 0.06 + i * 0.1
            P.box(P.mat(cloth, 0.6, sheen=0.4), (x, 0.05 * math.sin(2 * math.pi * t + i * 0.9), 1.55 - i * 0.012), (0.1, 0.03, 0.42 - i * 0.03), bevel=0)
    else:
        P.box(P.mat("#777777", 0.6), (0.06, 0, 0.5), (0.08, 0.03, 0.4), bevel=0)


def goal_monsoon(t):
    P.box(P.mat("#e9e2d0", 0.6), (0, 0.2, 1.1), (1.6, 0.6, 2.2), bevel=0.04)
    P.box(P.mat("#2a7fff", 0.4), (0, -0.12, 0.9), (0.8, 0.05, 1.8), bevel=0.02)
    P.sphere(P.mat("#f2c230", 0.2, metal=0.9), (0.28, -0.16, 0.9), (0.05, 0.05, 0.05), r=1)
    P.box(P.mat("#d8433a", 0.5), (0, -0.2, 2.3), (1.9, 0.6, 0.2), bevel=0.03)
    P.sphere(P.mat("#ffe08a", 0.3, emit=3 + 2 * math.sin(2 * math.pi * t)), (0, -0.2, 2.6), (0.15, 0.15, 0.15), r=1)
    P.box(P.mat("#c99a5b", 0.7), (-0.55, -0.25, 0.25), (0.4, 0.3, 0.4), bevel=0.02)


def goal_festival(t):
    for x in (-0.8, 0.8):
        P.cyl(P.mat("#8a4f2b", 0.6), (x, 0, 1.2), 0.07, 2.4, verts=12)
    P.torus(P.mat("#ff9214", 0.8, bump=0.6, bump_scale=120), (0, 0, 2.2), 0.8, 0.07, rot=(90, 0, 0), scale=(1, 0.5, 1))
    for i, x in enumerate((-0.5, 0, 0.5)):
        P.joint("l")
        for o in lantern(0.9):
            o.location.x += x
            o.location.z += 1.75 + 0.05 * math.sin(2 * math.pi * t + i)


def goal_stepwell(t):
    stone = P.mat("#d7aa70", 0.7, bump=0.3, bump_scale=30)
    for x in (-0.85, 0.85):
        P.box(stone, (x, 0, 1.2), (0.3, 0.4, 2.4), bevel=0.03)
    P.box(stone, (0, 0, 2.5), (2.1, 0.45, 0.3), bevel=0.03)
    P.box(P.mat("#ffe7a0", 0.3, emit=2.5 + 1.5 * math.sin(2 * math.pi * t)), (0, 0.15, 1.2), (1.4, 0.05, 2.4), bevel=0)
    P.sphere(P.mat("#2fd6a0", 0.1, emit=3.0), (0, -0.1, 2.5), (0.12, 0.08, 0.12), r=1)


def lever(on, wood="#6a4428"):
    P.box(P.mat("#5a5048", 0.7), (0, 0, 0.08), (0.5, 0.3, 0.16), bevel=0.03)
    a = -40 if not on else 40
    P.cyl(P.mat(wood, 0.6), (math.sin(math.radians(a)) * 0.3, -0.05, 0.16 + math.cos(math.radians(a)) * 0.3), 0.035, 0.6, rot=(0, a, 0))
    P.sphere(P.mat("#e8336d" if not on else "#2ec4b6", 0.3, coat=0.6), (math.sin(math.radians(a)) * 0.6, -0.05, 0.16 + math.cos(math.radians(a)) * 0.6), (0.09, 0.09, 0.09), r=1)


def boost(t):
    P.box(P.mat("#2a2f33", 0.5), (0, 0, 0.04), (1.6, 0.6, 0.08), bevel=0.02)
    for i in range(3):
        g = 1.5 + 4 * max(0.0, math.sin(2 * math.pi * (t - i / 3)))
        P.box(P.mat("#ffd23f", 0.3, emit=g), (-0.45 + i * 0.35, -0.31, 0.06), (0.18, 0.02, 0.05), rot=(0, 0, 0), bevel=0)


def loop_ring(t):
    pipe = P.mat("#b9c2c6", 0.3, metal=0.8)
    P.torus(pipe, (0, 0.3, 2.6), 2.45, 0.22, rot=(90, 0, 0))
    P.torus(P.mat("#d8433a", 0.5), (0, 0.3, 2.6), 2.45, 0.235, rot=(90, 0, 0), scale=(1, 1, 1))
    for i in range(16):
        a = i * math.pi / 8
        P.box(P.mat("#ffd23f", 0.4, emit=0.5), (math.cos(a) * 2.45, 0.05, 2.6 + math.sin(a) * 2.45), (0.12, 0.05, 0.3), rot=(0, -math.degrees(a), 0), bevel=0)
    P.box(P.mat("#5e6b73", 0.4, metal=0.7), (0, 0.6, 0.06), (1.2, 0.3, 0.12), bevel=0.02)


BIG = {
    "monsoon": [
        ("checkpoint-off", lambda t: flag_post("#ffd23f", False, t), 0.9, 2.0, 1, 1),
        ("checkpoint-on", lambda t: flag_post("#ffd23f", True, t), 0.9, 2.0, 6, 10),
        ("goal", goal_monsoon, 2.2, 2.9, 4, 6),
        ("lever-off", lambda t: lever(False), 1.4, 0.9, 1, 1), ("lever-on", lambda t: lever(True), 1.4, 0.9, 1, 1),
        ("boost", boost, 1.8, 0.4, 6, 12), ("loop", loop_ring, 5.6, 5.6, 1, 1),
    ],
    "festival": [
        ("checkpoint-off", lambda t: flag_post("#e8336d", False, t, "#8a4f2b"), 0.9, 2.0, 1, 1),
        ("checkpoint-on", lambda t: flag_post("#e8336d", True, t, "#8a4f2b"), 0.9, 2.0, 6, 10),
        ("goal", goal_festival, 2.2, 2.7, 4, 6),
        ("lever-off", lambda t: lever(False), 1.4, 0.9, 1, 1), ("lever-on", lambda t: lever(True), 1.4, 0.9, 1, 1),
    ],
    "stepwell": [
        ("checkpoint-off", lambda t: flag_post("#2ec4b6", False, t, "#6a4428"), 0.9, 2.0, 1, 1),
        ("checkpoint-on", lambda t: flag_post("#2ec4b6", True, t, "#6a4428"), 0.9, 2.0, 6, 10),
        ("goal", goal_stepwell, 2.3, 2.8, 4, 6),
        ("lever-off", lambda t: lever(False), 1.4, 0.9, 1, 1), ("lever-on", lambda t: lever(True), 1.4, 0.9, 1, 1),
    ],
}


def fx_puff(t):
    for i in range(5):
        a = i * 1.3
        P.sphere(P.mat("#f4efe6", 0.9), (math.cos(a) * 0.12, 0, math.sin(a) * 0.08), (0.14, 0.14, 0.12), r=1, seg=12)


def fx_star(t):
    m = P.mat("#fff2b0", 0.2, emit=6.0)
    for i in range(4):
        P.cone(m, (0, 0, 0), 0.06, 0.0, 0.5, rot=(0, i * 45, 0), verts=4, scale=(1, 0.3, 1))
        P.cone(m, (0, 0, 0), 0.06, 0.0, 0.5, rot=(0, i * 45 + 180, 0), verts=4, scale=(1, 0.3, 1))


def fx_bubble(t):
    P.sphere(P.mat("#bfe9ff", 0.02, coat=1.0, alpha=0.25, emit=0.2), (0, 0, 0), (0.6, 0.6, 0.6), r=1, seg=28)
    P.sphere(P.mat("#ffffff", 0.05, emit=3.0), (-0.25, -0.5, 0.28), (0.1, 0.03, 0.06), r=1, seg=10)


def fx_shield(t):
    P.torus(P.mat("#9ff0ff", 0.1, emit=3.0, alpha=0.6), (0, 0, 0), 0.62, 0.035, rot=(90, 0, 0))


def shot_for(world):
    if world == "festival":
        return lambda t: fx_star(t)
    if world == "stepwell":
        return lambda t: P.cone(P.mat("#ffcf5a", 0.2, emit=8.0), (0, 0, 0), 0.12, 0.0, 0.3, rot=(0, 360 * t, 0), verts=8)
    return lambda t: P.sphere(P.mat("#7fd4ff", 0.1, emit=2.0), (0, 0, 0), (0.14, 0.14, 0.18), rot=(0, 360 * t, 0), r=1, seg=12)


def boss_shot(world):
    if world == "monsoon":   # a mango
        return lambda t: [P.sphere(P.mat("#ffb21a", 0.4, coat=0.3), (0, 0, 0), (0.2, 0.16, 0.16), rot=(0, 360 * t, 0), r=1, seg=16),
                          P.sphere(P.mat("#3f8f3a", 0.5), (0.18 * math.cos(2 * math.pi * t), 0, 0.12), (0.06, 0.02, 0.04), r=1, seg=8)]
    if world == "festival":  # a fizzing cracker spark ball
        return lambda t: [P.sphere(P.mat("#ff5a36", 0.3, emit=5.0), (0, 0, 0), (0.17, 0.17, 0.17), r=1, seg=14), fx_star(t)]
    return lambda t: P.sphere(P.mat("#5fd3ff", 0.05, coat=1.0, emit=1.0, alpha=0.8), (0, 0, 0), (0.18, 0.18, 0.24), rot=(0, 360 * t, 0), r=1, seg=14)


FX = {w: [("shot", shot_for(w), 0.5, 4), ("bossshot", boss_shot(w), 0.6, 4), ("puff", fx_puff, 0.6, 1), ("star", fx_star, 0.6, 1),
          ("bubble", fx_bubble, 1.4, 1), ("shield", fx_shield, 1.4, 1)] for w in ("monsoon", "festival", "stepwell")}

if __name__ == "__main__":
    main()
