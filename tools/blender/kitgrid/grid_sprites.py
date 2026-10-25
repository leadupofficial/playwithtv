"""
kitgrid art: the sprites of the four single-player grid games (Glowworm Grove, Skyline Stacker, Comet Kitty,
Buzz Field), modelled from primitives and pre-rendered in Blender, then packed into one named-sprite atlas
("pwtv-plat" v1, the same format and helpers as kitplat) for apps/web/src/games/kitgrid.

    blender -b --factory-startup -P tools/blender/kitgrid/grid_sprites.py -- apps/web/public/assets/grid [preview.png]

Camera: orthographic, looking almost straight down (75 degrees), so the games can rotate heads and bodies on the
grid without the lighting looking wrong. 1 Blender metre = 1 grid cell; a cell renders at PPM pixels.
Everything here is original (no third-party models or textures): licence CC0, like the rest of the repo's art.
"""
from __future__ import annotations

import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "kitplat"))
import plat_common as P  # noqa: E402
from mathutils import Euler  # noqa: E402

PPM = 96
ELEV = 75


def group(objs):
    root = P.bpy.data.objects.new("root", None)
    P.bpy.context.scene.collection.objects.link(root)
    for o in objs:
        P.attach(o, root)
    return root


def view(cam, w, h):
    P.setup(max(8, round(w * PPM)), max(8, round(h * PPM)), samples=16)
    cam.data.ortho_scale = max(w, h)
    el = math.radians(ELEV)
    cam.location = (0, -40 * math.cos(el), 40 * math.sin(el))
    cam.rotation_euler = Euler((math.pi / 2 - el, 0, 0))
    return P.project(cam, (0, 0, 0))


# ---------------------------------------------------------------------------------------------------------------
# Glowworm Grove


def worm_head(skin):
    body, glow = skin
    m, g = P.mat(body, 0.45, sheen=0.4, coat=0.3), P.mat(glow, 0.3, emit=2.5)
    eye, pupil = P.mat("#ffffff", 0.2, coat=0.6), P.mat("#1b1430", 0.3)
    out = [P.sphere(m, (0, 0, 0.32), (1.05, 0.95, 0.85), r=0.4)]
    for s in (-1, 1):
        out.append(P.sphere(eye, (0.22, s * 0.17, 0.55), r=0.12))
        out.append(P.sphere(pupil, (0.31, s * 0.17, 0.58), r=0.06))
        out.append(P.capsule(m, (0.0, s * 0.12, 0.6), (-0.1, s * 0.22, 0.92), r=0.03))
        out.append(P.sphere(g, (-0.1, s * 0.22, 0.95), r=0.07))
    out.append(P.torus(P.mat("#ff7aa8", 0.4), (0.36, 0, 0.3), R=0.08, r=0.025, rot=(0, 90, 0)))
    return out


def worm_body(skin, tail=False):
    body, glow = skin
    m, g = P.mat(body, 0.45, sheen=0.4, coat=0.3), P.mat(glow, 0.3, emit=1.6 if tail else 0.9)
    r = 0.3 if tail else 0.36
    return [P.sphere(m, (0, 0, 0.28), (1.0, 1.0, 0.8), r=r), P.sphere(g, (0, 0, 0.5), (1, 1, 0.4), r=r * 0.55)]


def firefly(t):
    body, wing = P.mat("#3b2a1a", 0.5), P.mat("#d9f4ff", 0.2, alpha=0.55)
    glow = P.mat("#fff27a", 0.3, emit=3.0 + 2.5 * math.sin(2 * math.pi * t))
    out = [P.sphere(body, (0.08, 0, 0.45), (1, 0.8, 0.8), r=0.1), P.sphere(glow, (-0.1, 0, 0.42), (1.3, 1, 1), r=0.14)]
    flap = 25 * math.sin(2 * math.pi * t * 2)
    for s in (-1, 1):
        out.append(P.sphere(wing, (0.02, s * 0.14, 0.55), (1.2, 0.5, 0.12), rot=(s * flap, 0, s * 20), r=0.14))
    return out


def hedge():
    leaf = P.mat("#2f7a3e", 0.7, bump=0.5, vary=0.25)
    dark = P.mat("#1f5a2c", 0.8, bump=0.5, vary=0.2)
    out = [P.box(dark, (0, 0, 0.2), (0.96, 0.96, 0.4), bevel=0.12)]
    for (x, y, r) in ((-0.22, -0.2, 0.3), (0.22, -0.18, 0.28), (-0.18, 0.22, 0.27), (0.2, 0.22, 0.3), (0, 0, 0.33)):
        out.append(P.sphere(leaf, (x, y, 0.42), r=r))
    for (x, y) in ((-0.25, 0.05), (0.15, -0.28), (0.28, 0.2)):
        out.append(P.sphere(P.mat("#ff8fb8", 0.5), (x, y, 0.7), r=0.06))
    return out


def lantern(on):
    frame, glass = P.mat("#5a3b22", 0.6), P.mat("#ffd36b" if on else "#6b6f7a", 0.2, emit=4.0 if on else 0.0, alpha=0.9)
    out = [P.cyl(frame, (0, 0, 0.06), r=0.28, depth=0.12), P.cyl(glass, (0, 0, 0.36), r=0.22, depth=0.46),
           P.cyl(frame, (0, 0, 0.64), r=0.26, depth=0.1), P.torus(frame, (0, 0, 0.78), R=0.1, r=0.025, rot=(90, 0, 0))]
    return out


def burrow(t):
    rim, hole = P.mat("#7a5a3a", 0.8, bump=0.6), P.mat("#130d1f", 0.9)
    swirl = P.mat("#b78cff", 0.3, emit=2.5)
    out = [P.torus(rim, (0, 0, 0.06), R=0.34, r=0.1), P.cyl(hole, (0, 0, 0.02), r=0.32, depth=0.04)]
    for k in range(3):
        a = 2 * math.pi * (t + k / 3)
        out.append(P.sphere(swirl, (0.18 * math.cos(a), 0.18 * math.sin(a), 0.1), r=0.05))
    return out


# ---------------------------------------------------------------------------------------------------------------
# Skyline Stacker: one cell = one block of a building (window grid on top)

BLOCK_COLOURS = {
    "b-red": "#e8505b", "b-orange": "#f39c3d", "b-yellow": "#f5cd4b", "b-green": "#4fbf75",
    "b-teal": "#33b5b0", "b-blue": "#4a7fe0", "b-purple": "#9461e0", "b-pink": "#ec6fb2",
}


def block(col, rubble=False):
    if rubble:
        m = P.mat("#7d7a75", 0.9, bump=0.8, vary=0.3)
        out = [P.box(m, (0, 0, 0.25), (0.94, 0.94, 0.5), bevel=0.06)]
        for (x, y, s) in ((-0.2, -0.15, 0.22), (0.18, 0.2, 0.18), (0.22, -0.22, 0.14)):
            out.append(P.box(P.mat("#5d5a55", 0.95, bump=0.6), (x, y, 0.55), (s, s, s), rot=(20, 30, 10), bevel=0.03))
        return out
    m = P.mat(col, 0.35, coat=0.5)
    win, frame = P.mat("#fff6c8", 0.2, emit=1.4), P.mat("#2a2f45", 0.5)
    out = [P.box(m, (0, 0, 0.3), (0.94, 0.94, 0.6), bevel=0.07)]
    for x in (-0.22, 0.22):
        for y in (-0.22, 0.22):
            out.append(P.box(frame, (x, y, 0.605), (0.28, 0.28, 0.02), bevel=0.01))
            out.append(P.box(win, (x, y, 0.62), (0.22, 0.22, 0.02), bevel=0.01))
    return out


def crane():
    yel, steel = P.mat("#f5b928", 0.4, coat=0.4), P.mat("#5c6370", 0.4, metal=0.6)
    out = [P.box(yel, (0, 0, 0.2), (0.5, 0.5, 0.4), bevel=0.05), P.box(yel, (0.6, 0, 0.5), (1.6, 0.18, 0.12), bevel=0.03),
           P.cyl(steel, (1.2, 0, 0.3), r=0.02, depth=0.4), P.box(steel, (1.2, 0, 0.08), (0.2, 0.2, 0.08), bevel=0.02)]
    return out


# ---------------------------------------------------------------------------------------------------------------
# Comet Kitty


def kitty(t, skin):
    fur, belly = skin
    m, b = P.mat(fur, 0.6, sheen=0.8, bump=0.25), P.mat(belly, 0.6, sheen=0.6)
    helm = P.mat("#bfe8ff", 0.05, coat=1.0, alpha=0.12)
    out = [P.sphere(m, (-0.05, 0, 0.28), (1.2, 0.85, 0.75), r=0.3), P.sphere(m, (0.28, 0, 0.42), r=0.24),
           P.sphere(b, (0.4, 0, 0.38), (0.6, 0.9, 0.7), r=0.14), P.sphere(helm, (0.28, 0, 0.42), r=0.31)]
    for s in (-1, 1):
        out.append(P.cone(m, (0.24, s * 0.14, 0.64), r1=0.08, depth=0.16, rot=(s * -15, 0, 0)))
        out.append(P.sphere(P.mat("#7dff9e", 0.2, emit=1.5), (0.47, s * 0.09, 0.48), r=0.04))
        leg = 0.08 * math.sin(2 * math.pi * t + (0 if s > 0 else math.pi))
        out.append(P.sphere(m, (0.12 + leg, s * 0.2, 0.08), r=0.08))
        out.append(P.sphere(m, (-0.22 - leg, s * 0.2, 0.08), r=0.08))
    wag = 0.12 * math.sin(2 * math.pi * t)
    out.append(P.capsule(m, (-0.35, 0, 0.3), (-0.62, wag, 0.5), r=0.05))
    out.append(P.sphere(P.mat("#ffde59", 0.3, emit=2.0), (-0.62, wag, 0.5), r=0.06))
    return out


BOT_COLOURS = {"bot-red": "#ff4d6d", "bot-cyan": "#2ec4f0", "bot-pink": "#ff8bd1", "bot-amber": "#ffad33"}


def dustbot(col, t, scared=False):
    shell = P.mat("#2b3cff" if scared else col, 0.3, coat=0.7, metal=0.2)
    dark = P.mat("#20232e", 0.5)
    eye = P.mat("#ffffff" if scared else "#e8fbff", 0.2, emit=1.5 if scared else 2.5)
    out = [P.cyl(dark, (0, 0, 0.06), r=0.36, depth=0.08), P.sphere(shell, (0, 0, 0.18), (1, 1, 0.6), r=0.36),
           P.cyl(P.mat("#9aa3b5", 0.3, metal=0.8), (0, 0, 0.42), r=0.04, depth=0.16)]
    for s in (-1, 1):
        out.append(P.sphere(eye, (0.24, s * 0.12, 0.3), (0.6, 1, 1), r=0.07))
    a = 2 * math.pi * t
    for k in range(3):
        aa = a + k * 2 * math.pi / 3
        out.append(P.box(P.mat("#c9ced8", 0.5, metal=0.5), (0.3 * math.cos(aa), 0.3 * math.sin(aa), 0.03), (0.22, 0.04, 0.02), rot=(0, 0, math.degrees(aa))))
    out.append(P.sphere(P.mat("#ffe08a" if not scared else "#9fb0ff", 0.3, emit=3.0), (0, 0, 0.52), r=0.05))
    return out


def stardust(big=False):
    g = P.mat("#fff4b0", 0.2, emit=3.0)
    r = 0.2 if big else 0.08
    out = [P.sphere(g, (0, 0, 0.3), r=r)]
    if big:
        out.append(P.sphere(P.mat("#ff9de2", 0.3, emit=1.2, alpha=0.3), (0, 0, 0.3), r=0.32))
        for k in range(4):
            a = k * math.pi / 2
            out.append(P.cone(g, (0.2 * math.cos(a), 0.2 * math.sin(a), 0.3), r1=0.06, depth=0.18, rot=(0, 90, math.degrees(a))))
    return out


def comet(t):
    core = P.mat("#9df7ff", 0.2, emit=4.0)
    tail = P.mat("#ff7ad9", 0.3, emit=2.0, alpha=0.6)
    out = [P.sphere(core, (0.12, 0, 0.35), r=0.16)]
    for k in range(4):
        out.append(P.sphere(tail, (-0.05 - k * 0.1, 0.03 * math.sin(2 * math.pi * t + k), 0.35), r=0.13 - k * 0.025))
    return out


# ---------------------------------------------------------------------------------------------------------------
# Buzz Field


def turf(covered):
    if covered:
        m = P.mat("#5fb24a", 0.8, bump=0.7, bump_scale=30, vary=0.2)
        out = [P.box(m, (0, 0, 0.12), (0.96, 0.96, 0.24), bevel=0.08)]
        for (x, y) in ((-0.25, -0.2), (0.2, 0.25), (0.28, -0.25), (-0.2, 0.28)):
            out.append(P.cone(P.mat("#7fd05a", 0.7), (x, y, 0.3), r1=0.04, depth=0.14))
        return out
    m = P.mat("#d9b98a", 0.9, bump=0.4, bump_scale=24, vary=0.15)
    return [P.box(m, (0, 0, 0.04), (0.98, 0.98, 0.08), bevel=0.03)]


def hive(awake):
    m = P.mat("#f2b632", 0.5, bump=0.3)
    stripe = P.mat("#a86a12", 0.6)
    out = []
    for k, (r, z) in enumerate(((0.32, 0.12), (0.3, 0.3), (0.24, 0.46), (0.14, 0.58))):
        out.append(P.sphere(m if k % 2 == 0 else stripe, (0, 0, z), (1, 1, 0.55), r=r))
    out.append(P.cyl(P.mat("#3a2410", 0.8), (0.24, 0, 0.18), r=0.07, depth=0.04, rot=(0, 90, 0)))
    if awake:
        for k in range(3):
            a = k * 2.1
            out += bee_parts((0.38 * math.cos(a), 0.38 * math.sin(a), 0.6 + 0.08 * k), 0.6)
    return out


def bee_parts(loc, s=1.0):
    x, y, z = loc
    yel, blk = P.mat("#ffd23f", 0.4), P.mat("#1d1a14", 0.5)
    wing = P.mat("#e8f8ff", 0.1, alpha=0.5)
    return [P.sphere(yel, (x, y, z), (1.3, 1, 1), r=0.1 * s), P.sphere(blk, (x - 0.05 * s, y, z), (0.35, 1.02, 1.02), r=0.1 * s),
            P.sphere(wing, (x, y + 0.08 * s, z + 0.08 * s), (1, 0.5, 0.15), r=0.08 * s),
            P.sphere(wing, (x, y - 0.08 * s, z + 0.08 * s), (1, 0.5, 0.15), r=0.08 * s)]


def flower(col):
    stem, centre = P.mat("#3f8f3a", 0.7), P.mat("#ffcf3a", 0.4)
    pet = P.mat(col, 0.5, sheen=0.5)
    out = [P.cyl(stem, (0, 0, 0.15), r=0.025, depth=0.3), P.sphere(centre, (0, 0, 0.34), (1, 1, 0.5), r=0.08)]
    for k in range(6):
        a = k * math.pi / 3
        out.append(P.sphere(pet, (0.12 * math.cos(a), 0.12 * math.sin(a), 0.33), (1.2, 0.7, 0.25), rot=(0, 0, math.degrees(a)), r=0.09))
    return out


def marker():
    pole, cloth = P.mat("#7a5230", 0.6), P.mat("#ff5d5d", 0.5, sheen=0.5)
    return [P.cyl(pole, (0, 0, 0.45), r=0.04, depth=0.9), P.box(cloth, (0.24, 0, 0.72), (0.44, 0.3, 0.05), rot=(0, -12, 0), bevel=0.02),
            P.cyl(P.mat("#5a3b22", 0.8), (0, 0, 0.03), r=0.12, depth=0.06)]


def bea():
    """Beekeeper Bea for the story card: a round character in a veiled hat."""
    suit, skin = P.mat("#f4f1e8", 0.7, sheen=0.4), P.mat("#c98b5e", 0.6, sheen=0.3)
    hat, veil = P.mat("#e6d39a", 0.7), P.mat("#2a2a2a", 0.4, alpha=0.4)
    out = [P.sphere(suit, (0, 0, 0.35), (1, 0.9, 1.1), r=0.32), P.sphere(skin, (0, 0, 0.82), r=0.2),
           P.cyl(hat, (0, 0, 0.98), r=0.34, depth=0.04), P.cyl(hat, (0, 0, 1.06), r=0.16, depth=0.14),
           P.cyl(veil, (0, 0, 0.84), r=0.27, depth=0.26)]
    for s in (-1, 1):
        out.append(P.sphere(P.mat("#1b1430", 0.3), (0.17, s * 0.07, 0.86), r=0.03))
        out.append(P.capsule(suit, (0.05, s * 0.3, 0.5), (0.25, s * 0.38, 0.3), r=0.08))
    out.append(P.cyl(P.mat("#a8adb5", 0.3, metal=0.7), (0.32, 0.42, 0.3), r=0.08, depth=0.2))
    return out


# ---------------------------------------------------------------------------------------------------------------

WORM_SKINS = {"": ("#7ad65a", "#eaff6b"), "-ember": ("#e8703a", "#ffd36b"), "-frost": ("#7fc8f0", "#e9fbff"), "-royal": ("#a57ae8", "#ffb3f0")}
KITTY_SKINS = {"": ("#f2a65a", "#fff1dc"), "-midnight": ("#3a3f5c", "#c9cff0"), "-snow": ("#f4f4f4", "#ffd9e8"), "-tabby": ("#9b7b5a", "#efe0c8")}


def main():
    a = P.argv()
    out = a[0]
    preview = a[1] if len(a) > 1 and a[1] != "-" else None
    P.reset()
    P.light_rig("festival", rim_scale=0.6)
    cam = P.side_camera((0, 0, 0), 1.0, elevation=ELEV)
    sheet = P.Sheet("grid", PPM)

    def still(sid, build, w=1.0, h=1.0, fps=10):
        P.clear_scene_objects()
        group(build())
        pv = view(cam, w, h)
        sheet.add(sid, [P.render_rgba()], pv, fps)

    def anim(sid, build, n, w=1.0, h=1.0, fps=10):
        pv = view(cam, w, h)
        frames = []
        for k in range(n):
            P.clear_scene_objects()
            group(build(k / n))
            frames.append(P.render_rgba())
        sheet.add(sid, frames, pv, fps)

    for suffix, skin in WORM_SKINS.items():
        still("worm-head" + suffix, lambda s=skin: worm_head(s), 1.1, 1.1)
        still("worm-body" + suffix, lambda s=skin: worm_body(s))
        still("worm-tail" + suffix, lambda s=skin: worm_body(s, True))
    anim("firefly", firefly, 6, fps=12)
    still("hedge", hedge)
    still("lantern-off", lambda: lantern(False), 1.0, 1.2)
    still("lantern-on", lambda: lantern(True), 1.2, 1.2)
    anim("burrow", burrow, 6, fps=10)
    for sid, col in BLOCK_COLOURS.items():
        still(sid, lambda c=col: block(c))
    still("rubble", lambda: block("", True))
    still("crane", crane, 2.0, 1.0)
    for suffix, skin in KITTY_SKINS.items():
        anim("kitty" + suffix, lambda t, s=skin: kitty(t, s), 4, 1.2, 1.2, fps=10)
    for sid, col in BOT_COLOURS.items():
        anim(sid, lambda t, c=col: dustbot(c, t), 4, fps=12)
    anim("bot-scared", lambda t: dustbot("#2b3cff", t, True), 4, fps=12)
    still("dust", lambda: stardust(False), 0.5, 0.5)
    still("dust-big", lambda: stardust(True), 0.8, 0.8)
    anim("comet", comet, 4, 1.0, 1.0, fps=10)
    still("turf", lambda: turf(True))
    still("soil", lambda: turf(False))
    still("hive", lambda: hive(False))
    still("hive-awake", lambda: hive(True), 1.2, 1.2)
    still("marker", marker, 1.0, 1.0)
    for sid, col in (("flower-pink", "#ff8fc7"), ("flower-white", "#f7f7ff"), ("flower-blue", "#7ab8ff")):
        still(sid, lambda c=col: flower(c), 0.6, 0.6)
    still("bee", lambda: bee_parts((0, 0, 0.3), 2.2), 0.7, 0.7)
    still("bea", bea, 1.2, 1.4)
    sheet.save(out, max_w=1400, preview=preview)


main()
