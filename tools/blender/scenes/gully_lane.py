"""
Gully Super Over: the lane between the houses, built from code (Blender 5.x, headless), so the real-time GLB
(high/ultra) and the pre-rendered backdrops (lite) are the same place.

  blender -b --factory-startup -P tools/blender/scenes/gully_lane.py -- \
      --work /tmp/gully --hdri qwantani_sunset_puresky_2k.hdr \
      --glb apps/web/public/assets/gully/lane.glb \
      --render apps/web/public/assets/gully --samples 96

Outputs: lane.glb (statics merged per material; the brick stumps are left out: the game builds and scatters
them), backdrops gully-<camera>.webp (1920×1080) for the lite tier, gully-lane.json (the camera rigs and
spectator spots, so three.js cameras match the renders exactly), and the .blend in --work for inspection.
Numbers match apps/web/src/games/gully/sim/lane.ts (LANE): the houses stand at x = ±5, the boundary at z = -28.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import random
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, ".."))

import bpy  # noqa: E402

import pwtv_common as C  # noqa: E402
import gully_textures as T  # noqa: E402
from gully_kit import P, box, cyl, image, mat, merge_by_material, quad, sag, tube  # noqa: E402
import gully_props as props  # noqa: E402

HALF = 5.0
FLOOR = 3.1
PAINTS = ["#e86f8e", "#38b2ac", "#f2c14e", "#9ccc65", "#9575cd", "#ff8a50", "#4fc3f7", "#f48fb1", "#7ed6b9", "#ffb74d"]
SPECIAL_WINDOWS = [(1, -12.6, -10.8), (-1, -19.4, -17.6)]  # LANE.windows: side, z0, z1 (y 3.7..5.1)

CAMERAS = {
    # name: position, target, vertical fov (degrees) — game coordinates
    "broadcast": ((0.7, 3.4, -25.5), (0.0, 1.0, -1.2), 21.0),
    "shot": ((0.0, 5.6, 5.6), (0.0, 1.3, -17.0), 44.0),
    "side": ((-3.7, 2.5, -3.6), (0.2, 0.95, -0.9), 40.0),
}
# warm low sun from behind the bowler's end, a little from the leg side (light travels along this vector)
SUN_DIR = (0.22, -0.55, 0.8)


def args():
    p = argparse.ArgumentParser()
    p.add_argument("--work", required=True, help="scratch folder for textures and the .blend")
    p.add_argument("--hdri", required=True)
    p.add_argument("--glb", help="write the lane GLB here")
    p.add_argument("--render", help="render the lite backdrops into this folder")
    p.add_argument("--cameras", default="broadcast,shot,side")
    p.add_argument("--samples", type=int, default=96)
    p.add_argument("--size", default="1920x1080")
    p.add_argument("--quality", type=int, default=84)
    p.add_argument("--seed", type=int, default=7)
    p.add_argument("--bake-ao", type=int, default=0, help="bake ambient occlusion for the GLB into one atlas of this size")
    return p.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])


def lane_floor():
    out = [box("lane", (2 * HALF, 0.1, 50), (0, -0.05, -15.5), mat("concrete", "#d8d2c8", 0.9, tex="concrete"), uv_tile=3.0)]
    gutter = mat("gutter", "#3a3d3f", 0.35)
    for s in (-1, 1):
        out.append(box("gutter", (0.32, 0.02, 50), (s * (HALF - 0.2), 0.0, -15.5), gutter))
        out.append(box("kerb", (0.08, 0.12, 50), (s * (HALF - 0.4), 0.05, -15.5), mat("kerb", "#bdb6aa", 0.85)))
    out.append(box("pitch", (2.3, 0.01, 15.4), (0, 0.002, -7.0), mat("pitch_dust", "#efe0c2", 0.95, tex="concrete"), uv_tile=2.0))
    chalk = mat("chalk", "#fbfaf5", 0.95)
    out += [box("crease", (2.6, 0.012, 0.06), (0, 0.006, -1.2), chalk), box("crease_b", (2.6, 0.012, 0.06), (0, 0.006, -13.6), chalk)]
    for k in range(13):  # a chalk boundary line drawn by hand: wobbly dashes
        x = -HALF + 0.4 + k * 0.72
        out.append(box("boundary", (0.55, 0.012, 0.08), (x, 0.006, -28 + math.sin(k * 1.7) * 0.06), chalk, yaw=math.sin(k) * 0.05))
    return out


class Facade:
    """A house front: outward normal (nx, nz) into the lane, the wall plane through (ox, oz).
    pt(d, y, u): d = out from the wall, u = along it (game z on the side rows, game x at the ends)."""

    def __init__(self, nx: float, nz: float, ox: float = 0.0, oz: float = 0.0):
        self.nx, self.nz, self.ox, self.oz = nx, nz, ox, oz
        self.yaw = 0.0 if nx else math.pi / 2

    def pt(self, d: float, y: float, u: float):
        return (self.ox + self.nx * d, y, u) if self.nx else (u, y, self.oz + self.nz * d)


def side(s: int) -> Facade:
    return Facade(-s, 0, s * HALF, 0)


def window(F: Facade, u: float, y: float, w: float, h: float, rnd: random.Random, special: bool = False, grill: bool = False):
    trim = mat("trim", "#f6f1e7", 0.6)
    shutter = mat(*rnd.choice([("shutter_blue", "#2a86d8"), ("shutter_green", "#2e9e5b"), ("shutter_brown", "#8a5a33")]), 0.5)
    glass = mat("glass_special" if special else "glass", "#a9d8ff" if special else "#24323d", 0.05, metal=0.0 if special else 0.3, coat=0.8)
    yaw = F.yaw
    out = [box("glass", (0.04, h, w), F.pt(0.01, y + h / 2, u), glass, yaw=yaw)]
    for du in (-w / 2, w / 2):
        out.append(box("frame_v", (0.12, h + 0.12, 0.09), F.pt(0.04, y + h / 2, u + du), trim, yaw=yaw))
    for dy in (0, h):
        out.append(box("frame_h", (0.14, 0.09, w + 0.12), F.pt(0.05, y + dy, u), trim, yaw=yaw))
    out.append(box("sill", (0.28, 0.06, w + 0.3), F.pt(0.1, y - 0.04, u), trim, yaw=yaw))
    out.append(box("chajja", (0.5, 0.07, w + 0.45), F.pt(0.25, y + h + 0.28, u), trim, yaw=yaw, bevel=0.02))
    if special:
        out += props.pot(*F.pt(0.18, 0, u - w * 0.3)[::2], y=y)
        out.append(box("special_frame", (0.16, 0.06, w + 0.2), F.pt(0.07, y + h + 0.08, u), mat("special_trim", "#ff4d6d", 0.4), yaw=yaw))
    else:
        for du in (-1, 1):  # shutters swung open, flat-ish against the wall
            out.append(box("shutter", (0.05, h - 0.12, 0.36), F.pt(0.07, y + h / 2, u + du * (w / 2 + 0.24)), shutter, yaw=yaw + du * 0.12))
    if grill:
        bars = mat("grill", "#2a2c30", 0.4, metal=0.6)
        for k in range(1, 6):
            out.append(box("grill", (0.03, h, 0.025), F.pt(0.09, y + h / 2, u - w / 2 + k * w / 6), bars, yaw=yaw))
    return out


def house(s: int, z0: float, z1: float, rnd: random.Random, spectators: list):
    """One house front between z0 > z1 on side s, 2–3 floors, painted, with windows, a door and maybe a balcony."""
    w = z0 - z1
    zc = (z0 + z1) / 2
    floors = rnd.choice([2, 2, 3])
    H = floors * FLOOR + 0.9
    paint = rnd.choice(PAINTS)
    wall = mat(f"wall_{paint}", paint, 0.85, tex="plaster")
    out = [box("house", (8.0, H, w - 0.04), (s * (HALF + 4.0), H / 2, zc), wall, uv_tile=2.5)]
    trim = mat("trim", "#f6f1e7", 0.6)
    for f in range(1, floors + 1):
        out.append(box("band", (0.14, 0.14, w), (s * (HALF - 0.05), f * FLOOR, zc), trim))
    out.append(box("parapet", (0.3, 0.16, w), (s * (HALF - 0.05), H, zc), trim))
    special = [sw for sw in SPECIAL_WINDOWS if sw[0] == s and sw[1] >= z1 - 0.01 and sw[2] <= z0 + 0.01]
    # ground floor: a door with a step and a kolam, and a grilled window
    door_z = zc + rnd.uniform(-w / 4, w / 4)
    door = mat(rnd.choice(["door_wood", "door_blue"]), rnd.choice(["#7a4a2a", "#2a6fb5"]), 0.55)
    out.append(box("door", (0.08, 2.1, 1.0), (s * (HALF - 0.01), 1.05, door_z), door, bevel=0.01))
    out.append(box("door_frame", (0.14, 2.25, 1.2), (s * (HALF + 0.02), 1.1, door_z), trim))
    out.append(box("step", (0.5, 0.18, 1.4), (s * (HALF - 0.25), 0.09, door_z), mat("step", "#9e9890", 0.9), bevel=0.02))
    out.append(quad("kolam", [(s * (HALF - 1.6), 0.004, door_z - 0.55), (s * (HALF - 0.5), 0.004, door_z - 0.55),
                              (s * (HALF - 0.5), 0.004, door_z + 0.55), (s * (HALF - 1.6), 0.004, door_z + 0.55)],
                    mat("kolam", "#ffffff", 0.95, tex="kolam", alpha_tex=True)))
    win_z = door_z + (1.6 if door_z < zc else -1.6)
    if abs(win_z - zc) < w / 2 - 0.8:
        out += window(side(s), win_z, 0.9, 1.1, 1.2, rnd, grill=True)
    # upper floors
    balcony = not special and floors >= 2 and rnd.random() < 0.65 and w > 4
    for f in range(1, floors):
        y = f * FLOOR + 0.6
        n = 2 if w > 5 else 1
        for k in range(n):
            wz = zc + (k - (n - 1) / 2) * (w / n)
            if f == 1 and special:
                continue
            if f == 1 and balcony and abs(wz - zc) < 1.6:
                continue
            out += window(side(s), wz, y, 1.0, 1.3, rnd)
    for sw in special:
        out += window(side(s), (sw[1] + sw[2]) / 2, 3.7, sw[2] - sw[1] - 0.2, 1.4, rnd, special=True)
    if balcony:
        out += balcony_at(s, zc, min(3.2, w - 1.2), rnd, spectators)
    if rnd.random() < 0.6:
        out += props.water_tank(s * (HALF + rnd.uniform(1.5, 4)), H, zc + rnd.uniform(-w / 4, w / 4), rnd.uniform(0.45, 0.6))
    if rnd.random() < 0.35:
        out.append(box("ac", (0.3, 0.55, 0.8), (s * (HALF - 0.15), FLOOR + 2.0, zc + w / 2 - 0.7), mat("ac_white", "#eceff1", 0.4), bevel=0.03))
    return out


def balcony_at(s: int, zc: float, w: float, rnd: random.Random, spectators: list):
    x0 = s * HALF
    rail = mat(rnd.choice(["rail_teal", "rail_white"]), rnd.choice(["#2bb3a3", "#f4f4f4"]), 0.45, metal=0.3)
    slab = mat("trim", "#f6f1e7", 0.6)
    y = FLOOR
    out = [box("balcony", (0.95, 0.16, w), (x0 - s * 0.45, y, zc), slab, bevel=0.03)]
    out.append(box("rail_top", (0.06, 0.06, w), (x0 - s * 0.88, y + 0.95, zc), rail))
    n = int(w / 0.28)
    for k in range(n + 1):
        out.append(box("rail_post", (0.035, 0.9, 0.035), (x0 - s * 0.88, y + 0.5, zc - w / 2 + k * w / n), rail))
    for k in range(2):
        out.append(box("rail_side", (0.88, 0.06, 0.04), (x0 - s * 0.44, y + 0.95, zc + (k - 0.5) * w), rail))
    # where cheering kids stand (the game draws them there)
    for k in range(2):
        spectators.append({"x": round(x0 - s * 0.45, 3), "y": round(y + 0.08, 3), "z": round(zc + (k - 0.5) * w * 0.5, 3), "side": s})
    if rnd.random() < 0.5:  # washing on a line
        line = sag((x0 - s * 0.85, y + 1.9, zc - w / 2), (x0 - s * 0.85, y + 1.9, zc + w / 2), 6, 0.1)
        out.append(tube("cloth_line", line, 0.005, mat("string", "#f4efe6", 0.9), sides=4))
        for k in range(3):
            c = rnd.choice(["#e53935", "#fdd835", "#8e24aa", "#1e88e5", "#ffffff"])
            out.append(box("cloth", (0.02, 0.55, 0.45), (x0 - s * 0.85, y + 1.6, zc - w / 3 + k * w / 3), mat(f"cloth_{c}", c, 0.95)))
    return out


def far_end(rnd: random.Random):
    out = []
    wall = mat("wall_#ffb74d", "#ffb74d", 0.85, tex="plaster")
    out.append(box("far_building", (24, 9.5, 6), (0, 4.75, -40.5), wall, uv_tile=2.5))
    out.append(quad("mural", [(-4.5, 0.4, -37.45), (4.5, 0.4, -37.45), (4.5, 4.9, -37.45), (-4.5, 4.9, -37.45)],
                    mat("mural", "#ffffff", 0.8, tex="mural")))
    trim = mat("trim", "#f6f1e7", 0.6)
    out.append(box("far_band", (24, 0.16, 0.2), (0, 6.2, -37.45), trim))
    for k in range(4):
        x = -7.5 + k * 5
        out.append(box("far_win", (1.2, 1.3, 0.05), (x, 7.2, -37.45), mat("glass", "#24323d", 0.05, metal=0.3)))
    # a tea stall with a blue tarp on the off side, before the far wall
    tarp = mat("tarp", "#2f6fd6", 0.6)
    out.append(box("stall_counter", (1.8, 1.0, 0.8), (3.6, 0.5, -34.0), mat("stall_wood", "#8b5a2b", 0.7), bevel=0.03))
    out.append(box("stall_tarp", (2.4, 0.05, 2.0), (3.6, 2.5, -34.2), tarp, roll=-0.12))
    for x in (2.6, 4.6):
        out.append(cyl("stall_pole", 0.04, 2.5, (x, 1.25, -33.4), mat("chrome", "#d9dde2", 0.2, metal=1.0)))
    out.append(cyl("kettle", 0.13, 0.25, (3.3, 1.12, -34.0), mat("brass", "#d4a017", 0.25, metal=1.0)))
    out += props.chair(2.2, -32.2, 0.4, "#2b7de9") + props.chair(-3.6, -31.5, -0.3)
    out += props.bicycle(-3.9, -24.0, 0.15)
    out += props.palm(-6.0, -38.0, 11.0, rnd) + props.palm(7.0, -30.0, 10.0, rnd)
    return out


def back_end():
    """Behind the keeper: the white compound wall with a blue band and a green gate."""
    white = mat("compound", "#f2efe8", 0.85, tex="plaster")
    blue = mat("compound_band", "#2f7fd8", 0.6)
    gate = mat("gate", "#2e8b57", 0.4, metal=0.5)
    out = [box("compound_l", (3.6, 1.7, 0.25), (-3.2, 0.85, 4.35), white, uv_tile=2.0),
           box("compound_r", (3.6, 1.7, 0.25), (3.2, 0.85, 4.35), white, uv_tile=2.0)]
    for x in (-3.2, 3.2):
        out.append(box("compound_band", (3.62, 0.18, 0.27), (x, 1.45, 4.35), blue))
    for x in (-1.35, 1.35):
        out.append(box("pillar", (0.4, 2.1, 0.4), (x, 1.05, 4.35), white, bevel=0.03))
    for k in range(9):
        out.append(box("gate_bar", (0.04, 1.6, 0.04), (-1.05 + k * 0.26, 0.85, 4.4), gate))
    out.append(box("gate_rail", (2.3, 0.06, 0.05), (0, 1.55, 4.4), gate))
    return out


def end_house(zf: float, rnd: random.Random, spectators: list):
    """The house across the lane behind the keeper (facing the bowler's end): two floors, a balcony of kids."""
    F = Facade(0, -1, 0, zf)
    wall = mat("wall_#9575cd", "#9575cd", 0.85, tex="plaster")
    trim = mat("trim", "#f6f1e7", 0.6)
    H = 2 * FLOOR + 0.9
    out = [box("end_house", (2 * HALF + 0.6, H, 6), (0, H / 2, zf + 3), wall, uv_tile=2.5)]
    out.append(box("end_band", (2 * HALF + 0.6, 0.14, 0.14), (0, FLOOR, zf - 0.05), trim))
    out.append(box("end_parapet", (2 * HALF + 0.6, 0.16, 0.3), (0, H, zf - 0.05), trim))
    for u in (-3.4, 3.4):
        out += window(F, u, FLOOR + 0.6, 1.0, 1.3, rnd)
    rail = mat("rail_teal", "#2bb3a3", 0.45, metal=0.3)
    w = 3.4
    out.append(box("end_balcony", (w, 0.16, 0.95), (0, FLOOR, zf - 0.45), trim, bevel=0.03))
    out.append(box("end_rail", (w, 0.06, 0.06), (0, FLOOR + 0.95, zf - 0.88), rail))
    for k in range(13):
        out.append(box("end_post", (0.035, 0.9, 0.035), (-w / 2 + k * w / 12, FLOOR + 0.5, zf - 0.88), rail))
    out.append(box("end_door", (1.0, 2.1, 0.08), (0, FLOOR + 1.05, zf - 0.01), mat("door_blue", "#2a6fb5", 0.55), bevel=0.01))
    for u in (-0.9, 0.9):
        spectators.append({"x": u, "y": FLOOR + 0.08, "z": round(zf - 0.45, 3), "side": 0})
    out += props.water_tank(-3.0, H, zf + 2.0, 0.55)
    out += props.palm(4.2, zf + 4.0, 10.5, rnd)
    return out


def overhead(rnd: random.Random):
    out = []
    pole = mat("pole", "#8d8f93", 0.7)
    for (s, z) in ((-1, -9.0), (1, -21.0), (-1, -31.0)):
        out.append(cyl("pole", 0.11, 8.5, (s * (HALF - 0.35), 4.25, z), pole, verts=10))
        out.append(box("crossbar", (1.4, 0.08, 0.08), (s * (HALF - 0.35), 8.0, z), pole))
    wire = mat("wire", "#202020", 0.6)
    out.append(tube("wire_a", sag((-HALF + 0.35, 7.9, -9.0), (HALF - 0.35, 7.9, -21.0), 14, 0.9), 0.012, wire, sides=4))
    out.append(tube("wire_b", sag((HALF - 0.35, 7.7, -21.0), (-HALF + 0.35, 7.7, -31.0), 14, 0.8), 0.012, wire, sides=4))
    out.append(tube("wire_c", sag((-HALF + 0.35, 7.6, -9.0), (-HALF + 0.35, 7.6, -31.0), 18, 0.5), 0.012, wire, sides=4))
    for z in (5.9, -5.5, -15.0, -24.5):
        out += props.bunting((-HALF, 5.6 + rnd.uniform(-0.2, 0.2), z), (HALF, 5.8, z - 1.0), 18, 0.5)
    for z in (-1.5, -10.5, -19.5):
        out += props.string_lights((-HALF, 5.0, z), (HALF, 5.2, z + 0.6), 24, 0.7)
    return out


def build(a) -> tuple[list, list, list, list]:
    rnd = random.Random(a.seed)
    paths = T.write_all(a.work)
    for k, p in paths.items():
        image(k, p)
    spectators: list = []
    static = []
    static += lane_floor()
    for s in (-1, 1):
        z = 6.5
        while z > -37.5:
            w = rnd.uniform(4.6, 6.8)
            z1 = max(-37.5, z - w)
            for sw in SPECIAL_WINDOWS:  # never split the neighbours' window between two houses
                if sw[0] == s and z1 < sw[2] + 0.4 and z1 > sw[1] - 0.4:
                    z1 = sw[1] - 0.6
            static += house(s, z, z1, rnd, spectators)
            z = z1
    static += far_end(rnd) + back_end() + end_house(6.4, rnd, spectators) + overhead(rnd)
    static += props.auto_rickshaw(-3.55, -12.4, 0.1)
    static += props.pot(3.9, -3.0) + props.pot(-4.0, -9.8) + props.pot(4.1, -26.0, plant=False)
    static += props.chair(-4.0, 1.6, 0.6)
    dog = props.dog(1.6, -29.2)
    dynamic = props.bricks(0.0, 0.0, rnd)
    return static, dog, dynamic, spectators


def lights(hdri: str):
    C.world_hdri(hdri, 0.75, 2.9, (1.0, 0.95, 0.9))
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 5.0
    sun.data.color = (1.0, 0.82, 0.62)
    sun.data.angle = math.radians(1.2)
    bpy.context.scene.collection.objects.link(sun)
    d = P(*SUN_DIR)
    sun.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


def camera(name: str, pos, target, fov: float) -> bpy.types.Object:
    cam = bpy.data.objects.new(name, bpy.data.cameras.new(name))
    bpy.context.scene.collection.objects.link(cam)
    cam.location = P(*pos)
    C.look_at(cam, P(*target))
    cam.data.sensor_fit = "VERTICAL"
    cam.data.angle_y = math.radians(fov)
    cam.data.clip_start, cam.data.clip_end = 0.1, 300
    return cam


def main():
    a = args()
    t0 = time.time()
    os.makedirs(a.work, exist_ok=True)
    C.empty_scene()
    static, dog, dynamic, spectators = build(a)
    lights(a.hdri)
    cams = {n: camera(n, *CAMERAS[n]) for n in CAMERAS}
    merged = merge_by_material(static, "lane")
    bpy.ops.object.select_all(action="DESELECT")
    for o in dog:
        o.select_set(True)
    bpy.context.view_layer.objects.active = dog[0]
    bpy.ops.object.join()
    dog_ob = dog[0]
    dog_ob.name = "dog"
    for o in dynamic:
        o.hide_render = True  # the game draws the bricks itself (they scatter when bowled)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(a.work, "gully_lane.blend"))
    C.log(f"built {len(merged)} merged lane objects in {time.time() - t0:.1f}s")

    if a.glb:
        if a.bake_ao:
            # one shared AO atlas through a second UV set (export_glb.bake_ao): contact shadows in corners, under
            # balconies and sills, which real-time light alone would miss on the high tier
            import export_glb
            C.setup_render("cycles", 32, 64, 64, transparent=False)
            export_glb.bake_ao(merged + [dog_ob], a.bake_ao, 64)
            C.log(f"AO baked at {a.bake_ao}px in {time.time() - t0:.0f}s")
        bpy.ops.object.select_all(action="DESELECT")
        for o in merged + [dog_ob]:
            o.select_set(True)
        bpy.ops.export_scene.gltf(filepath=os.path.abspath(a.glb), export_format="GLB", use_selection=True,
                                  export_yup=True, export_apply=True, export_cameras=False, export_lights=False,
                                  export_animations=False, export_image_format="AUTO")
        C.log("glb:", a.glb, os.path.getsize(a.glb) // 1024, "KB")

    meta = {"format": "gully-lane", "version": 1, "sun": SUN_DIR,
            "cameras": {n: {"position": p, "target": t, "fovDeg": f} for n, (p, t, f) in CAMERAS.items()},
            "spectators": spectators}
    if a.render:
        os.makedirs(a.render, exist_ok=True)
        w, h = (int(v) for v in a.size.split("x"))
        C.setup_render("cycles", a.samples, w, h, transparent=False, look="AgX - Medium High Contrast")
        for name in a.cameras.split(","):
            bpy.context.scene.camera = cams[name]
            png = os.path.join(a.work, f"gully-{name}.png")
            C.render_to(png)
            img = bpy.data.images.load(png)
            img.file_format = "WEBP"
            img.save(filepath=os.path.join(a.render, f"gully-{name}.webp"), quality=a.quality)
            C.log("rendered", name, f"{time.time() - t0:.0f}s")
        with open(os.path.join(a.render, "gully-lane.json"), "w") as fh:
            json.dump(meta, fh, indent=1)
    elif a.glb:
        with open(os.path.join(os.path.dirname(a.glb), "gully-lane.json"), "w") as fh:
            json.dump(meta, fh, indent=1)
    C.log(f"done in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
