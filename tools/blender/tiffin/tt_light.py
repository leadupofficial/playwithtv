"""
Tiffin Tornado: one lighting look for everything the game pre-renders (kitchen backdrops, chefs, food), so
sprites sit in the backdrop as if lit together: a warm overhead key from the front-left (the carriage lamps), cool
daylight from behind (the windows) as a rim, a soft sky fill, AgX.

The game camera: orthographic, pitched PITCH degrees, looking north (Blender +Y) from the south (-Y).
"""
from __future__ import annotations

import math

import bpy
from mathutils import Vector

import pwtv_common as C

PITCH = 45.0


def camera(target=(0.0, 0.0, 0.0), ortho_scale=1.0, name="cam"):
    """The game's camera: orthographic, PITCH° down, looking north at `target`, framing `ortho_scale` metres wide."""
    data = bpy.data.cameras.new(name)
    data.type = "ORTHO"
    data.ortho_scale = ortho_scale
    data.clip_start, data.clip_end = 0.05, 200
    cam = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(cam)
    bpy.context.scene.camera = cam
    e = math.radians(PITCH)
    dist = 60.0
    t = Vector(target)
    cam.location = t + Vector((0, -math.cos(e) * dist, math.sin(e) * dist))
    C.look_at(cam, t)
    return cam


def sky_world(hdri: str | None, strength=0.6, rotation=2.2):
    C.world_hdri(hdri, strength, rotation, (1.0, 0.98, 0.95))


def area(name, power, color, size, loc, target, shadow=True, glossy=True):
    ob = C.area_light(name, power, color, size, loc, target, shadow)
    ob.visible_glossy = glossy
    return ob


def sprite_rig(hdri: str | None, size: float):
    """Lights for a sprite subject of `size` metres at the origin (chef, food), matching the kitchen."""
    sky_world(hdri, 0.28)
    k = size
    e = k * k
    area("key", 150 * e, (1.0, 0.84, 0.64), 1.2 * k, (-1.4 * k, -1.6 * k, 2.6 * k), (0, 0, 0.3 * k))
    area("fill", 30 * e, (0.8, 0.88, 1.0), 2.5 * k, (2.2 * k, -2.0 * k, 1.0 * k), (0, 0, 0.3 * k), shadow=False, glossy=False)
    area("rim", 240 * e, (0.72, 0.86, 1.0), 1.0 * k, (0.8 * k, 2.4 * k, 1.8 * k), (0, 0, 0.4 * k), shadow=False)


def set_look(look="AgX - Punchy"):
    s = bpy.context.scene
    s.view_settings.view_transform = "AgX"
    try:
        s.view_settings.look = look
    except TypeError:
        pass
