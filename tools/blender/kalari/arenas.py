"""
KALARI CLASH arenas, built procedurally so every tier shows the same place:

  blender -b --factory-startup -P tools/blender/kalari/arenas.py -- --acg <ambientCG dir> --hdri-dir <Poly Haven dir> \
      --out apps/web/public/assets/kalari-clash --work <scratch> [--only courtyard] [--samples 96] [--no-glb]

Per arena:
  <id>.glb          the scenery for high/ultra (PBR, image textures, no lights or camera; the game adds lamps)
  <id>-lite.webp    the lite backdrop: rendered in Cycles through the lite game camera (orthographic, 30° pitch,
                    VIEW_W metres wide, centred on LOOK) so sprites drawn by the same camera sit exactly on it
  <id>-card.webp    a perspective hero shot for menus (960×540)

Blender (x, y, z) = three.js (x, -z, y): the camera looks along +y here, along -z in the game. The fight floor top
is z = 0 and spans hx × hz from apps/web/src/games/kalari/arenas.ts.
"""
from __future__ import annotations

import argparse
import math
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, ".."))

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

import arena_kit as K  # noqa: E402
import pwtv_atlas as atlas  # noqa: E402
import pwtv_common as C  # noqa: E402

VIEW_W = 24.0           # metres across the lite backdrop (the game camera zooms within it)
LITE_SIZE = (2560, 1440)
PITCH = 30.0
LOOK = (0.0, 3.5, 1.5)  # blender coords; three.js (0, 1.5, -3.5): the lite camera looks here

HDRI = {"courtyard": "qwantani_dusk_2_puresky", "docks": "kloofendal_overcast_puresky", "rooftop": "kloppenheim_06_puresky"}
SUN = {  # (strength, colour, elevation°, azimuth°) of the key light matching the HDRI's sun
    "courtyard": (2.2, (1.0, 0.55, 0.32), 9, -60), "docks": (0.9, (0.75, 0.82, 0.9), 40, 30), "rooftop": (3.6, (1.0, 0.78, 0.5), 22, -35),
}


def args():
    p = argparse.ArgumentParser()
    p.add_argument("--acg", required=True)
    p.add_argument("--hdri-dir", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--work", required=True)
    p.add_argument("--only", default="")
    p.add_argument("--samples", type=int, default=96)
    p.add_argument("--no-glb", action="store_true")
    p.add_argument("--no-render", action="store_true")
    return C.parse(p)


def acg(a, set_dir: str, stem: str):
    base = os.path.join(a.acg, set_dir, stem)
    return f"{base}_Color.jpg", f"{base}_NormalGL.jpg"


def mats(a):
    w = os.path.join(a.work, "tex")
    return {
        "laterite": K.textured("laterite", *acg(a, "pave70", "PavingStones070_1K-JPG"), w, tint=(1.25, 0.72, 0.5), rough=0.75),
        "granite": K.textured("granite", *acg(a, "pave138", "PavingStones138_1K-JPG"), w, tint=(0.8, 0.78, 0.74), rough=0.7),
        "roof": K.textured("rooftiles", *acg(a, "roof12a", "RoofingTiles012A_1K-JPG"), w, tint=(1.05, 0.9, 0.85), rough=0.6),
        "planks": K.textured("planks", *acg(a, "planks37", "Planks037A_1K-JPG"), w, tint=(1.15, 1.0, 0.9), rough=0.55),
        "teak": K.flat("teak", "#5a3018", rough=0.45),
        "whitewash": K.flat("whitewash", "#efe6d6", rough=0.85),
        "redoxide": K.flat("redoxide", "#8c2f22", rough=0.35),
        "glow": K.flat("doorglow", "#ffb060", emit=6, emit_hex="#ff9a40"),
    }


def world(a, arena: str):
    sun_strength, colour, el, az = SUN[arena]
    C.world_hdri(os.path.join(a.hdri_dir, f"{HDRI[arena]}_2k.hdr"), 1.0 if arena != "courtyard" else 0.8, math.radians(az + 90))
    light = bpy.data.lights.new("sun", "SUN")
    light.energy = sun_strength
    light.color = colour
    light.angle = math.radians(1.5)
    ob = bpy.data.objects.new("sun", light)
    bpy.context.scene.collection.objects.link(ob)
    ob.rotation_euler = (math.radians(90 - el), 0, math.radians(az))


# ---------------------------------------------------------------------------------------------------------------


def courtyard(a, M, hx, hz):
    col = K.collection("scenery")
    K.box("pond", (-30, -20, -0.95), (30, 9, -0.9), K.water("water", "#10303a"), col=col)
    K.box("floor", (-hx, -hz, -0.9), (hx, hz, 0), M["laterite"], bevel=0.04, uv=3.2, col=col)
    K.box("floor_rim", (-hx - 0.18, -hz - 0.18, -0.95), (hx + 0.18, hz + 0.18, -0.12), M["granite"], bevel=0.05, uv=1.2, col=col)
    for i, x in enumerate((-1.6, 0, 1.6)):  # steps down into the pond at the front
        K.box(f"step{i}", (x - 0.7, -hz - 0.9, -0.55), (x + 0.7, -hz - 0.2, -0.3), M["granite"], bevel=0.03, uv=1.0, col=col)
    # the temple behind: plinth, teak pillars, a parapet wall, two tiers of tiled roof, glowing doors
    K.box("terrace", (-15, hz, -0.9), (15, 14, 0), M["granite"], uv=1.4, col=col)
    K.box("parapet", (-hx - 0.4, hz, 0), (hx + 0.4, hz + 0.35, 0.55), M["granite"], bevel=0.04, uv=0.8, col=col)
    K.box("plinth", (-9, 6.0, 0), (9, 12, 0.7), M["granite"], bevel=0.05, uv=1.0, col=col)
    K.box("hall", (-7.5, 7.2, 0.7), (7.5, 11.5, 4.2), M["whitewash"], col=col)
    K.box("hall_band", (-7.55, 7.15, 0.7), (7.55, 11.55, 1.2), M["redoxide"], col=col)
    for i, x in enumerate((-6, -2.2, 2.2, 6)):
        K.box(f"door{i}", (x - 0.7, 7.1, 0.7), (x + 0.7, 7.15, 3.0), M["glow"], col=col)
        K.box(f"doorframe{i}", (x - 0.85, 7.05, 0.7), (x + 0.85, 7.12, 3.2), M["teak"], col=col)
    for i in range(9):
        x = -8 + i * 2
        K.cyl(f"pillar{i}", (x, 6.4, 0.7), 0.22, 3.2, M["teak"], 10, col=col)
        K.box(f"capital{i}", (x - 0.35, 6.05, 3.85), (x + 0.35, 6.75, 4.1), M["teak"], col=col)
    K.roof("roof1", -9, 9, 6.0, 12, 4.1, 2.2, M["roof"], overhang=1.1, col=col)
    K.roof("roof2", -5, 5, 7.8, 10.2, 6.2, 1.8, M["roof"], overhang=0.9, col=col)
    K.box("ridge_gold", (-3.6, 8.9, 7.95), (3.6, 9.1, 8.1), K.flat("gold", "#d9a441", 0.3, 1.0), col=col)
    for side in (-1, 1):
        K.cyl(f"kalasam{side}", (side * 3.6, 9, 8.0), 0.12, 0.5, K.flat("gold", "#d9a441", 0.3, 1.0), 10, col=col, r2=0.02)
    # lamps (positions match arenas.ts: three (x, y, z) = blender (x, -z, y))
    for i, x in enumerate((-6.9, -2.3, 2.3, 6.9)):
        K.lamp(f"lamp{i}", x, 4.3, 1.35, col=col)
    for i, x in enumerate((-7.4, 7.4)):
        K.box(f"post{i}", (x - 0.35, -4.55, -0.95), (x + 0.35, -3.85, 0.65), M["granite"], bevel=0.04, uv=0.8, col=col)
        K.lamp(f"postlamp{i}", x, -4.2, 0.95, col=col, stand=False)
    # lotus pond and palms framing the sides
    for i, (x, y, r, fl) in enumerate([(-8.6, -2.2, 0.5, True), (-9.6, 0.8, 0.4, False), (-8.2, -6, 0.55, False), (8.8, -1.4, 0.5, False),
                                       (9.4, 1.8, 0.45, True), (8.4, -5.5, 0.5, True), (-3.5, -6.5, 0.45, False), (4.2, -7, 0.5, True)]):
        K.lotus(f"lotus{i}", x, y, -0.88, r, fl, col=col)
    for i, (x, y, h, lx, ly) in enumerate([(-12, 5, 9, 0.12, 0.05), (-14, 9, 11, -0.1, 0.0), (12.5, 4, 9.5, -0.12, 0.03),
                                           (14, 10, 12, 0.08, 0.0), (-11, 14, 10, 0.0, 0.0), (11, 15, 11, 0.0, 0.0)]):
        K.palm(f"palm{i}", (x, y, -0.9), h, (lx, ly), col=col, scale=1.15)


def docks(a, M, hx, hz):
    col = K.collection("scenery")
    K.box("sea", (-40, -30, -1.65), (40, 40, -1.6), K.water("sea", "#1e3a44"), col=col)
    K.box("deck", (-hx, -hz, -0.3), (hx, hz, 0), M["planks"], bevel=0.02, uv=2.0, col=col)
    K.box("deck_beam_f", (-hx - 0.1, -hz - 0.12, -0.55), (hx + 0.1, -hz + 0.05, -0.15), M["teak"], col=col)
    K.box("deck_beam_b", (-hx - 0.1, hz - 0.05, -0.55), (hx + 0.1, hz + 0.12, -0.15), M["teak"], col=col)
    for i, x in enumerate([-hx + 0.2 + k * (2 * hx - 0.4) / 6 for k in range(7)]):
        for j, y in enumerate((-hz + 0.1, hz - 0.1)):
            K.cyl(f"pile{i}_{j}", (x, y, -2.2), 0.17, 2.3, M["teak"], 8, col=col)
    for i, (x, y) in enumerate([(-hx + 0.4, -hz + 0.35), (hx - 0.4, -hz + 0.35)]):
        K.cyl(f"bollard{i}", (x, y, 0), 0.14, 0.35, K.flat("iron", "#2a2c30", 0.45, 0.8), 12, col=col)
    # lamp posts at the back corners
    for i, x in enumerate((-6.6, 6.6)):
        K.cyl(f"lamppost{i}", (x, 3.9, -1.6), 0.08, 3.85, K.flat("iron", "#2a2c30", 0.45, 0.8), 8, col=col)
        K.box(f"lantern{i}", (x - 0.18, 3.72, 2.2), (x + 0.18, 4.08, 2.62), K.flat("lantern_glass", "#ffd08a", 0.2, emit=3, emit_hex="#ffb060"), col=col)
        K.lamp(f"lamp{i}", x, 3.9, 2.4, col=col, stand=False)
    # wharf and godown behind
    K.box("wharf", (-16, 5.5, -1.6), (16, 14, 0.4), M["granite"], uv=1.4, col=col)
    K.box("godown", (-9, 8, 0.4), (3, 13, 4.2), M["whitewash"], col=col)
    K.box("godown_door", (-5, 7.95, 0.4), (-2, 8.0, 3.0), M["teak"], col=col)
    K.roof("godown_roof", -9, 3, 8, 13, 4.2, 2.0, M["roof"], overhang=0.7, col=col)
    crate = K.flat("crate", "#8a6a44", 0.7)
    for i, (x, y, z, s) in enumerate([(5, 7, 0.4, 1.0), (6.2, 7.2, 0.4, 0.9), (5.5, 7.1, 1.4, 0.8), (8, 8.5, 0.4, 1.1), (-11, 7, 0.4, 1.0)]):
        K.box(f"crate{i}", (x - s / 2, y - s / 2, z), (x + s / 2, y + s / 2, z + s), crate, bevel=0.03, col=col)
    K.boat("boat0", -11, -2, -1.55, 7, 0.25, col=col, hexc="#2b4a66")
    K.boat("boat1", 11.5, 1, -1.55, 6, -0.4, col=col, hexc="#7a2a22")
    K.boat("boat2", 2, 12.5, -1.55, 5, 0.1, col=col, hexc="#1f5a3a")
    for i, (x, y, h) in enumerate([(-14, 12, 10), (13, 13, 11), (20, 9, 9), (-20, 10, 11)]):
        K.palm(f"palm{i}", (x, y, 0.4), h, (0.08 * (1 if x < 0 else -1), 0), col=col, scale=1.1)


def rooftop(a, M, hx, hz):
    col = K.collection("scenery")
    K.box("terrace_rim", (-hx - 0.15, -hz - 0.15, -0.4), (hx + 0.15, hz + 0.15, -0.04), M["laterite"], bevel=0.03, uv=1.0, col=col)
    K.box("terrace", (-hx, -hz, -0.35), (hx, hz, 0), K.flat("redoxide_floor", "#9a3524", rough=0.22), bevel=0.02, col=col)
    K.box("house", (-hx + 0.1, -hz + 0.1, -9), (hx - 0.1, hz - 0.1, -0.35), M["whitewash"], col=col)
    K.box("house_band", (-hx, -hz, -0.75), (hx, hz, -0.35), M["redoxide"], col=col)
    for i, x in enumerate((-3.5, 0, 3.5)):
        K.box(f"window{i}", (x - 0.6, -hz - 0.02, -3.2), (x + 0.6, -hz + 0.05, -1.6), M["teak"], col=col)
    # the stair room on the left (a wall in the game) with its own little tiled roof and lanterns
    K.box("stairroom", (-hx - 3.2, -hz - 0.2, -0.35), (-hx, hz + 0.2, 2.8), M["whitewash"], col=col)
    K.roof("stairroof", -hx - 3.2, -hx, -hz - 0.2, hz + 0.2, 2.8, 1.2, M["roof"], overhang=0.5, col=col)
    for i, y in enumerate((-3.9, 3.9)):
        K.lamp(f"lamp{i}", -6.4, y, 1.1, col=col, stand=False)
    # neighbouring houses below, roofs catching the low sun
    for i, (x, y, w, d, top) in enumerate([(12, 4, 6, 6, -2.5), (13, -6, 5, 5, -4), (3, 13, 8, 6, -3), (-12, 12, 6, 5, -2), (-4, 22, 9, 6, -1.5), (16, 16, 6, 6, -1)]):
        K.box(f"nb{i}", (x - w / 2, y - d / 2, -12), (x + w / 2, y + d / 2, top), M["whitewash"], col=col)
        K.roof(f"nbroof{i}", x - w / 2, x + w / 2, y - d / 2, y + d / 2, top, 1.6, M["roof"], overhang=0.6, col=col)
    K.box("backwater", (-60, -40, -12.05), (60, 60, -12), K.water("backwater", "#2a4a40"), col=col)
    for i, (x, y, w, d) in enumerate([(-16, 14, 10, 8), (17, 18, 12, 9), (0, 30, 20, 8), (-30, 4, 12, 30), (30, 2, 12, 30)]):
        K.box(f"island{i}", (x - w / 2, y - d / 2, -12.4), (x + w / 2, y + d / 2, -11.7), K.flat("grass", "#4b6a2c", 0.9), bevel=0.3, col=col)
    # the coconut grove: palms rising past the roof at the sides and behind, never in front of the floor
    spots = [(-9.5, -1, 15), (10.0, -3.0, 14), (10.5, 3, 16.5), (-10.5, 5, 15.5), (7, 8, 17), (-6, 9, 16), (1, 10.5, 15),
             (15, 9, 17), (-15, 7, 16), (18, -3, 15), (-18, -2, 16), (4, 18, 18), (-8, 19, 17)]
    for i, (x, y, h) in enumerate(spots):
        lean = (0.06 * math.sin(i * 1.7), 0.05 * math.cos(i * 1.3))
        K.palm(f"palm{i}", (x, y, -12), h, lean, col=col, scale=1.25)


BUILD = {"courtyard": courtyard, "docks": docks, "rooftop": rooftop}
# floor half-sizes: keep in step with apps/web/src/games/kalari/arenas.ts
spec = {"courtyard": {"hx": 6.5, "hz": 3.6}, "docks": {"hx": 6.8, "hz": 3.4}, "rooftop": {"hx": 6.0, "hz": 3.5}}


def lite_camera():
    cam = bpy.data.objects.new("lite_cam", bpy.data.cameras.new("lite_cam"))
    bpy.context.scene.collection.objects.link(cam)
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = VIEW_W
    e = math.radians(PITCH)
    d = 60
    cam.location = (0, -math.cos(e) * d, math.sin(e) * d)
    cam.location += Vector(LOOK)
    C.look_at(cam, Vector(LOOK))
    cam.data.clip_start, cam.data.clip_end = 1, 200
    return cam


def hero_camera(hz):
    cam = bpy.data.objects.new("hero_cam", bpy.data.cameras.new("hero_cam"))
    bpy.context.scene.collection.objects.link(cam)
    cam.data.lens = 30
    cam.location = (7.5, -hz - 10, 4.2)
    C.look_at(cam, Vector((-0.5, 2, 1.2)))
    return cam


def main():
    a = args()
    for aid in (a.only.split(",") if a.only else BUILD):
        t0 = time.time()
        C.empty_scene()
        hx, hz = spec[aid]["hx"], spec[aid]["hz"]
        BUILD[aid](a, mats(a), hx, hz)
        world(a, aid)
        os.makedirs(a.out, exist_ok=True)
        if not a.no_glb:
            bpy.ops.object.select_all(action="DESELECT")
            for o in bpy.context.scene.objects:
                o.select_set(o.type == "MESH")
            bpy.ops.export_scene.gltf(filepath=os.path.join(a.out, f"{aid}.glb"), export_format="GLB", use_selection=True,
                                      export_lights=False, export_cameras=False, export_draco_mesh_compression_enable=False,
                                      export_image_format="AUTO", export_yup=True, export_apply=True)
        if not a.no_render:
            s = bpy.context.scene
            C.setup_render("cycles", a.samples, *LITE_SIZE, transparent=False, look="AgX - Punchy")
            s.camera = lite_camera()
            png = os.path.join(a.work, f"{aid}-lite.png")
            C.render_to(png)
            atlas.save_rgba(atlas.load_rgba(png), os.path.join(a.out, f"{aid}-lite.webp"), "WEBP", 82)
            s.render.resolution_x, s.render.resolution_y = 960, 540
            s.camera = hero_camera(hz)
            png = os.path.join(a.work, f"{aid}-card.png")
            C.render_to(png)
            atlas.save_rgba(atlas.load_rgba(png), os.path.join(a.out, f"{aid}-card.webp"), "WEBP", 80)
        C.log(f"{aid}: {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
