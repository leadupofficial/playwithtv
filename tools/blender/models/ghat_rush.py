"""
GHAT RUSH vehicles and critters, modelled from primitives (original designs, CC0 like the rest of the repo):
an auto-rickshaw, a scooter with its rider, a tiny hatchback, a ghat bus and a goat. Stylised and chunky
(bevelled boxes, fat tyres, big heads), sized in metres, forward = -Y (glTF +Z after export), ground at z = 0.

  blender -b --factory-startup -P tools/blender/models/ghat_rush.py -- --out .run/models [--only auto,goat]
  blender -b --factory-startup -P tools/blender/models/ghat_rush.py -- --out .run/models --props <dir> name.glb …

--props merges the listed GLBs from <dir> (Kenney Nature Kit trees, rocks, bushes) into <out>/props.glb: one
joined mesh per file, named after it, standing on its ground point.

Each model becomes <out>/<name>.glb. Paint that a player colour replaces is one material named "paint" in a
saturated magenta (hue 300°), so the lite sprites can be recoloured by hue (kit25d SpriteBatch `keyHue`) and the
real-time models by material name. Then feed the GLBs to render_sprites.py and export_glb.py.
"""
from __future__ import annotations

import argparse
import math
import os
import sys

import bpy
import bmesh
from mathutils import Vector

PAINT = (0.62, 0.02, 0.62)


def args():
    p = argparse.ArgumentParser()
    p.add_argument("--out", required=True)
    p.add_argument("--only", default="")
    p.add_argument("--props", help="folder of GLBs to merge into props.glb (names follow)")
    p.add_argument("files", nargs="*")
    return p.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


_mats: dict[str, bpy.types.Material] = {}


def mat(name, color, rough=0.5, metal=0.0, coat=0.0, emit=0.0, alpha=1.0):
    if name in _mats:
        return _mats[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    b.inputs["Coat Weight"].default_value = coat
    b.inputs["Coat Roughness"].default_value = 0.08
    if emit:
        b.inputs["Emission Color"].default_value = (*color, 1)
        b.inputs["Emission Strength"].default_value = emit
    _mats[name] = m
    return m


def materials():
    _mats.clear()
    return dict(
        paint=mat("paint", PAINT, 0.32, 0.0, 0.8),
        black=mat("trim", (0.025, 0.025, 0.03), 0.55),
        vinyl=mat("vinyl", (0.03, 0.035, 0.03), 0.7),
        tyre=mat("tyre", (0.02, 0.02, 0.022), 0.85),
        chrome=mat("chrome", (0.8, 0.8, 0.82), 0.18, 1.0),
        glass=mat("glass", (0.02, 0.03, 0.04), 0.04, 0.0, 1.0),
        lamp=mat("lamp", (1.0, 0.95, 0.8), 0.2, 0.0, 0.0, 6.0),
        tail=mat("tail", (0.9, 0.05, 0.03), 0.3, 0.0, 0.0, 3.0),
        amber=mat("amber", (1.0, 0.45, 0.02), 0.3, 0.0, 0.0, 2.0),
        skin=mat("skin", (0.36, 0.2, 0.12), 0.6),
        hair=mat("hair", (0.02, 0.015, 0.012), 0.7),
        khaki=mat("khaki", (0.42, 0.38, 0.26), 0.8),
        shirt=mat("shirt", (0.75, 0.75, 0.72), 0.8),
        jacket=mat("jacket", (0.08, 0.12, 0.2), 0.6),
        seat=mat("seat", (0.06, 0.04, 0.035), 0.5),
        floor=mat("floor", (0.12, 0.12, 0.13), 0.7),
        hub=mat("hub", (0.55, 0.56, 0.58), 0.3, 0.8),
    )


def finish(ob, m, bevel=0.0, seg=3, smooth=True, sub=0):
    ob.data.materials.append(m)
    if bevel > 0:
        b = ob.modifiers.new("bevel", "BEVEL")
        b.width = bevel
        b.segments = seg
        b.limit_method = "ANGLE"
    if sub:
        s = ob.modifiers.new("sub", "SUBSURF")
        s.levels = s.render_levels = sub
    if smooth:
        for p in ob.data.polygons:
            p.use_smooth = True
        ob.modifiers.new("wn", "WEIGHTED_NORMAL").keep_sharp = True
    return ob


def box(name, size, loc, m, bevel=0.04, seg=3, rot=(0, 0, 0), taper=None):
    """A bevelled box. taper=(top_x, top_y, shift_y): scales the top face and slides it along y."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = size
    bpy.ops.object.transform_apply(scale=True)
    if taper:
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        for v in bm.verts:
            if v.co.z > 0:
                v.co.x *= taper[0]
                v.co.y = v.co.y * taper[1] + taper[2]
        bm.to_mesh(ob.data)
        bm.free()
    return finish(ob, m, bevel, seg)


def cyl(name, r, depth, loc, m, axis="x", verts=28, bevel=0.0, r2=None):
    rot = {"x": (0, math.pi / 2, 0), "y": (math.pi / 2, 0, 0), "z": (0, 0, 0)}[axis]
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=depth, vertices=verts, location=loc, rotation=rot)
    else:
        bpy.ops.mesh.primitive_cone_add(radius1=r, radius2=r2, depth=depth, vertices=verts, location=loc, rotation=rot)
    ob = bpy.context.active_object
    ob.name = name
    return finish(ob, m, bevel, 2)


def ball(name, r, loc, m, scale=(1, 1, 1), seg=24):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, segments=seg, ring_count=seg // 2, location=loc)
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = scale
    bpy.ops.object.transform_apply(scale=True)
    return finish(ob, m, 0)


def limb(name, a, b, r, m):
    """A capsule-ish cylinder from point a to point b."""
    a, b = Vector(a), Vector(b)
    d = b - a
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=d.length, vertices=14, location=(a + b) / 2)
    ob = bpy.context.active_object
    ob.name = name
    ob.rotation_euler = d.to_track_quat("Z", "Y").to_euler()
    finish(ob, m, 0)
    ball(name + "_j", r, b, m, seg=12)
    return ob


def wheel(name, r, w, loc, M, hub_r=None):
    tyre = cyl(name, r, w, loc, M["tyre"], "x", 32, bevel=min(r, w) * 0.35)
    hub = cyl(name + "_hub", hub_r or r * 0.55, w * 1.04, loc, M["hub"], "x", 24, bevel=0.01)
    return [tyre, hub]


def driver(M, at, lean=0.0, helmet=False):
    """A chunky seated figure; `at` = hip point. Big head, broad shoulders (stylised)."""
    x, y, z = at
    parts = []
    torso_m = M["jacket"] if helmet else M["khaki"]
    parts.append(box("torso", (0.42, 0.26, 0.5), (x, y - lean * 0.15, z + 0.28), torso_m, 0.1, 4, rot=(-lean, 0, 0)))
    hz = z + 0.68
    hy = y - lean * 0.35
    parts.append(ball("head", 0.15, (x, hy, hz), M["skin"], (1, 1, 1.08)))
    if helmet:
        parts.append(ball("helmet", 0.185, (x, hy + 0.01, hz + 0.04), M["paint"], (1, 1.08, 1)))
        parts.append(box("visor", (0.26, 0.05, 0.1), (x, hy - 0.17, hz + 0.02), M["glass"], 0.02, 2))
    else:
        parts.append(ball("hair", 0.152, (x, hy + 0.025, hz + 0.05), M["hair"], (1.02, 1, 0.75)))
        parts.append(box("moustache", (0.16, 0.04, 0.035), (x, hy - 0.145, hz - 0.04), M["hair"], 0.015, 2))
        parts.append(ball("nose", 0.03, (x, hy - 0.15, hz + 0.0), M["skin"]))
    # thighs forward, shins down
    for s in (-1, 1):
        parts.append(limb(f"thigh{s}", (x + s * 0.12, y, z + 0.05), (x + s * 0.13, y - 0.38, z + 0.05), 0.085, M["khaki"] if not helmet else M["jacket"]))
        parts.append(limb(f"shin{s}", (x + s * 0.13, y - 0.38, z + 0.05), (x + s * 0.14, y - 0.42, z - 0.32), 0.07, M["khaki"] if not helmet else M["jacket"]))
    return parts, (x, hy, z + 0.48)


def arms(M, shoulder, hands, m):
    x, y, z = shoulder
    out = []
    for s in (-1, 1):
        sh = (x + s * 0.24, y, z)
        hd = (hands[0] * s, hands[1], hands[2])
        el = ((sh[0] + hd[0]) / 2 + s * 0.06, (sh[1] + hd[1]) / 2 + 0.05, (sh[2] + hd[2]) / 2 - 0.08)
        out.append(limb(f"upper{s}", sh, el, 0.065, m))
        out.append(limb(f"fore{s}", el, hd, 0.055, m))
        out.append(ball(f"hand{s}", 0.06, hd, M["skin"]))
    return out


# ------------------------------------------------------------------------------------------------------------------


def auto(M):
    P = []
    P += wheel("wf", 0.24, 0.13, (0, -1.0, 0.24), M)
    for s in (-1, 1):
        P += wheel(f"wr{s}", 0.24, 0.14, (s * 0.6, 0.62, 0.24), M)
        P.append(box(f"mud{s}", (0.2, 0.5, 0.06), (s * 0.6, 0.62, 0.52), M["black"], 0.03))
    P.append(box("chassis", (1.0, 1.4, 0.1), (0, 0.35, 0.36), M["floor"], 0.03))
    P.append(box("footwell", (0.9, 0.62, 0.06), (0, -0.42, 0.44), M["floor"], 0.03))
    # rear passenger tub, slightly wider at the top, and the front nose rising from the front wheel to the dash
    P.append(box("tub", (1.34, 1.05, 0.62), (0, 0.6, 0.72), M["paint"], 0.14, 4, taper=(1.03, 1.0, 0.0)))
    P.append(box("cowl", (0.82, 0.55, 0.78), (0, -0.86, 0.8), M["paint"], 0.2, 5, taper=(0.82, 0.7, 0.06)))
    P.append(box("dash", (1.02, 0.28, 0.14), (0, -0.64, 1.16), M["paint"], 0.06, 3))
    P.append(box("driver_seat", (0.55, 0.38, 0.12), (0, -0.04, 0.92), M["seat"], 0.05, 3))
    # two-tone waist band (a darker paint stripe reads as a second colour under the tint)
    P.append(box("band", (1.37, 1.08, 0.08), (0, 0.6, 0.98), M["black"], 0.03))
    P.append(box("seat", (1.1, 0.45, 0.16), (0, 0.6, 1.07), M["seat"], 0.06, 3))
    P.append(box("back", (1.12, 0.12, 0.48), (0, 0.85, 1.32), M["seat"], 0.05, 3))
    # windscreen, pillars, canopy
    P.append(box("screen", (0.82, 0.04, 0.6), (0, -0.66, 1.62), M["glass"], 0.02, 2, rot=(math.radians(-12), 0, 0)))
    P.append(box("screen_frame", (0.86, 0.06, 0.05), (0, -0.6, 1.92), M["black"], 0.02))
    for x in (-0.6, 0.6):
        for y, h in ((-0.62, 0.85), (0.92, 0.95)):
            P.append(cyl(f"pillar{x}{y}", 0.03, h, (x * (0.75 if y < 0 else 1), y, 1.45 if y < 0 else 1.5), M["black"], "z", 10))
    P.append(box("roof", (1.42, 1.9, 0.14), (0, 0.12, 1.98), M["vinyl"], 0.07, 4, taper=(0.96, 0.98, 0.0)))
    # the back of the canopy (what everyone behind sees): paint below, a framed rear window and stripes above
    yellow = mat("stripe", (0.95, 0.62, 0.02), 0.35, 0.0, 0.5)
    P.append(box("roof_back_low", (1.38, 0.12, 0.42), (0, 1.02, 1.26), M["paint"], 0.05, 3))
    P.append(box("roof_back", (1.38, 0.1, 0.5), (0, 1.02, 1.7), M["vinyl"], 0.05, 3))
    P.append(box("rear_window_frame", (0.8, 0.06, 0.32), (0, 1.07, 1.7), M["chrome"], 0.03, 2))
    P.append(box("rear_window", (0.7, 0.06, 0.24), (0, 1.09, 1.7), M["glass"], 0.02, 2))
    for k, z in enumerate((1.12, 1.4)):
        P.append(box(f"stripe{k}", (1.4, 0.13, 0.05), (0, 1.03, z), yellow, 0.02, 2))
    P.append(box("roof_rim", (1.46, 1.94, 0.04), (0, 0.12, 1.9), M["paint"], 0.02, 2))
    # lamps: one big round headlight on the nose, indicators, tail lights
    P.append(cyl("headlamp_ring", 0.13, 0.08, (0, -1.08, 0.98), M["chrome"], "y", 24, 0.01))
    P.append(cyl("headlamp", 0.105, 0.04, (0, -1.125, 0.98), M["lamp"], "y", 24))
    for s in (-1, 1):
        P.append(ball(f"ind{s}", 0.045, (s * 0.42, -0.78, 1.18), M["amber"]))
        P.append(box(f"tail{s}", (0.2, 0.05, 0.12), (s * 0.48, 1.13, 0.86), M["tail"], 0.02))
        P.append(box(f"reflector{s}", (0.08, 0.04, 0.2), (s * 0.62, 1.13, 0.62), M["amber"], 0.015))
    P.append(box("bumper", (1.2, 0.08, 0.08), (0, 1.17, 0.48), M["chrome"], 0.03))
    P.append(box("plate_blank", (0.3, 0.02, 0.12), (0, 1.17, 0.66), M["shirt"], 0.01))
    # the driver up front, hands on the handlebar
    parts, shoulder = driver(M, (0, -0.08, 1.0), lean=0.08)
    P += parts
    P.append(cyl("bar", 0.025, 0.7, (0, -0.72, 1.32), M["black"], "x", 10))
    P += arms(M, shoulder, (0.33, -0.72, 1.32), M["khaki"])
    return P


def scooter(M):
    P = []
    P += wheel("wf", 0.22, 0.12, (0, -0.66, 0.22), M)
    P += wheel("wr", 0.22, 0.13, (0, 0.6, 0.22), M)
    P.append(box("rear", (0.46, 0.78, 0.4), (0, 0.46, 0.52), M["paint"], 0.17, 5, taper=(0.9, 0.95, 0.0)))
    P.append(box("floorboard", (0.38, 0.6, 0.07), (0, -0.07, 0.33), M["floor"], 0.03))
    P.append(box("apron", (0.5, 0.18, 0.78), (0, -0.46, 0.72), M["paint"], 0.08, 3, rot=(math.radians(14), 0, 0), taper=(0.75, 1.0, 0.0)))
    P.append(box("fender", (0.2, 0.42, 0.1), (0, -0.66, 0.5), M["paint"], 0.05, 3))
    P.append(box("seat", (0.32, 0.62, 0.11), (0, 0.38, 0.78), M["seat"], 0.05, 3))
    P.append(cyl("stem", 0.035, 0.55, (0, -0.55, 1.02), M["black"], "z", 10))
    P.append(box("headset", (0.3, 0.16, 0.14), (0, -0.56, 1.3), M["paint"], 0.05, 3))
    P.append(cyl("bar", 0.022, 0.62, (0, -0.52, 1.33), M["black"], "x", 10))
    P.append(cyl("headlamp", 0.07, 0.04, (0, -0.65, 1.3), M["lamp"], "y", 20))
    P.append(box("tail", (0.16, 0.04, 0.06), (0, 0.86, 0.62), M["tail"], 0.015))
    for s in (-1, 1):
        P.append(ball(f"ind{s}", 0.03, (s * 0.12, -0.64, 1.25), M["amber"]))
        P.append(box(f"mirror{s}", (0.08, 0.02, 0.06), (s * 0.3, -0.5, 1.48), M["chrome"], 0.01))
        P.append(cyl(f"mirror_arm{s}", 0.01, 0.16, (s * 0.27, -0.52, 1.4), M["black"], "z", 6))
    parts, shoulder = driver(M, (0, 0.2, 0.9), lean=0.22, helmet=True)
    P += parts
    P += arms(M, shoulder, (0.28, -0.5, 1.33), M["jacket"])
    return P


def car(M):
    P = []
    for s in (-1, 1):
        for y in (-0.9, 0.86):
            P += wheel(f"w{s}{y}", 0.33, 0.26, (s * 0.72, y, 0.33), M, 0.2)
            P.append(box(f"flare{s}{y}", (0.2, 0.86, 0.22), (s * 0.7, y, 0.66), M["paint"], 0.09, 4))
    P.append(box("body", (1.42, 2.75, 0.52), (0, 0, 0.66), M["paint"], 0.22, 5, taper=(0.97, 0.96, 0.0)))
    P.append(box("cabin", (1.3, 1.62, 0.56), (0, 0.18, 1.18), M["glass"], 0.2, 5, taper=(0.84, 0.74, 0.1)))
    P.append(box("roof", (1.1, 1.22, 0.12), (0, 0.24, 1.46), M["paint"], 0.06, 3))
    P.append(box("roof_stripe", (0.32, 1.1, 0.03), (0, 0.24, 1.53), M["shirt"], 0.01))
    for s in (-1, 1):
        P.append(box(f"pillar{s}", (0.1, 0.12, 0.56), (s * 0.6, -0.5, 1.15), M["paint"], 0.04, 2, rot=(math.radians(-28), 0, 0)))
    P.append(box("grille", (0.8, 0.06, 0.16), (0, -1.37, 0.6), M["black"], 0.04))
    P.append(box("bumper_f", (1.46, 0.16, 0.18), (0, -1.4, 0.42), M["black"], 0.06))
    P.append(box("bumper_r", (1.46, 0.16, 0.18), (0, 1.4, 0.42), M["black"], 0.06))
    for s in (-1, 1):
        P.append(cyl(f"head_ring{s}", 0.14, 0.06, (s * 0.48, -1.36, 0.76), M["chrome"], "y", 20, 0.01))
        P.append(cyl(f"head{s}", 0.11, 0.05, (s * 0.48, -1.39, 0.76), M["lamp"], "y", 20))
        P.append(box(f"tail{s}", (0.26, 0.05, 0.18), (s * 0.52, 1.38, 0.76), M["tail"], 0.02))
        P.append(box(f"mirror{s}", (0.14, 0.08, 0.1), (s * 0.72, -0.4, 1.02), M["paint"], 0.03))
    P.append(box("plate_blank", (0.36, 0.02, 0.12), (0, 1.42, 0.58), M["shirt"], 0.01))
    return P


def bus(M):
    red = mat("bus_red", (0.55, 0.03, 0.02), 0.35, 0.0, 0.6)
    cream = mat("bus_cream", (0.8, 0.72, 0.5), 0.4, 0.0, 0.5)
    board = mat("bus_board", (1.0, 0.8, 0.2), 0.3, 0.0, 0.0, 2.0)
    P = []
    for s in (-1, 1):
        for y in (-3.0, 2.6):
            P += wheel(f"w{s}{y}", 0.5, 0.36, (s * 1.08, y, 0.5), M, 0.28)
    P.append(box("lower", (2.5, 9.6, 1.2), (0, 0, 1.15), red, 0.2, 4))
    P.append(box("upper", (2.46, 9.5, 1.5), (0, 0, 2.5), cream, 0.25, 4))
    P.append(box("roof", (2.4, 9.3, 0.3), (0, 0.05, 3.3), cream, 0.25, 4))
    for s in (-1, 1):
        for i in range(7):
            P.append(box(f"win{s}{i}", (0.06, 1.05, 0.9), (s * 1.24, -3.4 + i * 1.18, 2.5), M["glass"], 0.04, 2))
        P.append(box(f"stripe{s}", (0.04, 9.3, 0.14), (s * 1.255, 0, 1.75), M["tail"], 0.02))
    P.append(box("windscreen", (2.2, 0.08, 1.2), (0, -4.78, 2.4), M["glass"], 0.08, 3))
    P.append(box("board", (1.4, 0.1, 0.3), (0, -4.78, 3.2), board, 0.03))
    P.append(box("bumper", (2.4, 0.2, 0.3), (0, -4.85, 0.55), M["chrome"], 0.08))
    P.append(box("rbumper", (2.4, 0.2, 0.3), (0, 4.85, 0.55), M["chrome"], 0.08))
    for s in (-1, 1):
        P.append(cyl(f"head{s}", 0.17, 0.08, (s * 0.85, -4.82, 1.2), M["lamp"], "y", 20))
        P.append(box(f"tail{s}", (0.3, 0.06, 0.4), (s * 0.95, 4.82, 1.3), M["tail"], 0.03))
    for x in (-0.9, 0.0, 0.9):  # roof luggage rack
        P.append(box(f"rack{x}", (0.06, 5.0, 0.06), (x, 0.8, 3.6), M["chrome"], 0.02))
    P.append(box("bundle", (1.4, 1.6, 0.5), (0.2, 1.4, 3.75), mat("tarp", (0.15, 0.3, 0.55), 0.8), 0.15, 3))
    return P


def goat(M):
    white = mat("goat_white", (0.82, 0.78, 0.7), 0.8)
    tan = mat("goat_tan", (0.45, 0.28, 0.14), 0.8)
    horn = mat("goat_horn", (0.25, 0.22, 0.18), 0.5)
    d = 0.12  # everything sits a bit lower: shorter, sturdier legs
    P = [ball("body", 0.32, (0, 0.05, 0.62 - d), white, (0.9, 1.5, 0.95))]
    for x, y in ((-0.15, -0.3), (0.15, -0.3), (-0.15, 0.38), (0.15, 0.38)):
        P.append(cyl(f"leg{x}{y}", 0.062, 0.42, (x, y, 0.25), white, "z", 12, bevel=0.02))
        P.append(cyl(f"hoof{x}{y}", 0.066, 0.08, (x, y, 0.04), M["hair"], "z", 12))
    P.append(limb("neck", (0, -0.35, 0.75 - d), (0, -0.52, 0.98 - d), 0.12, white))
    P.append(ball("head", 0.16, (0, -0.62, 1.02 - d), tan, (0.85, 1.35, 0.9)))
    P.append(ball("muzzle", 0.09, (0, -0.82, 0.96 - d), tan, (0.9, 1.0, 0.8)))
    for s in (-1, 1):
        P.append(ball(f"eye{s}", 0.03, (s * 0.1, -0.73, 1.08 - d), M["hair"]))
        P.append(ball(f"ear{s}", 0.08, (s * 0.17, -0.58, 1.0 - d), tan, (1.5, 0.6, 0.4)))
        P.append(limb(f"horn{s}", (s * 0.05, -0.6, 1.13 - d), (s * 0.09, -0.5, 1.3 - d), 0.035, horn))
        P.append(limb(f"horn_tip{s}", (s * 0.09, -0.5, 1.3 - d), (s * 0.11, -0.36, 1.36 - d), 0.025, horn))
    P.append(limb("beard", (0, -0.8, 0.9 - d), (0, -0.78, 0.78 - d), 0.03, M["hair"]))
    P.append(limb("tail", (0, 0.52, 0.72 - d), (0, 0.62, 0.86 - d), 0.04, white))
    P.append(ball("patch", 0.2, (0.1, 0.2, 0.72 - d), tan, (0.9, 1.1, 0.7)))
    return P


MODELS = {"auto": auto, "scooter": scooter, "car": car, "bus": bus, "goat": goat}


def export(parts, path):
    bpy.ops.object.select_all(action="DESELECT")
    for ob in parts:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.convert(target="MESH")  # applies bevels, subsurf, weighted normals
    bpy.ops.object.join()
    ob = bpy.context.active_object
    bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", export_apply=True, export_yup=True,
                              export_draco_mesh_compression_enable=False, use_selection=True)
    print("[pwtv] wrote", path, f"{os.path.getsize(path) / 1024:.0f} KB", len(ob.data.polygons), "faces", flush=True)


def merge_props(folder, files, out):
    reset()
    for f in files:
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=os.path.join(folder, f))
        new = [o for o in bpy.data.objects if o not in before]
        meshes = [o for o in new if o.type == "MESH"]
        others = [o.name for o in new if o.type != "MESH"]
        bpy.ops.object.select_all(action="DESELECT")
        for m in meshes:
            m.select_set(True)
        bpy.context.view_layer.objects.active = meshes[0]
        bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
        if len(meshes) > 1:
            bpy.ops.object.join()
        ob = bpy.context.active_object
        ob.name = os.path.splitext(f)[0]
        for n in others:
            if n in bpy.data.objects:
                bpy.data.objects.remove(bpy.data.objects[n], do_unlink=True)
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        lo = min(v.co.z for v in ob.data.vertices)
        for v in ob.data.vertices:
            v.co.z -= lo
        print("[pwtv] prop", ob.name, len(ob.data.polygons), "faces", flush=True)
    bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_apply=True, export_yup=True,
                              export_draco_mesh_compression_enable=False)
    print("[pwtv] wrote", out, f"{os.path.getsize(out) / 1024:.0f} KB", flush=True)


def main():
    a = args()
    os.makedirs(a.out, exist_ok=True)
    if a.props:
        merge_props(a.props, a.files, os.path.abspath(os.path.join(a.out, "props.glb")))
        return
    only = [x for x in a.only.split(",") if x]
    for name, fn in MODELS.items():
        if only and name not in only:
            continue
        reset()
        M = materials()
        export(fn(M), os.path.abspath(os.path.join(a.out, f"{name}.glb")))


if __name__ == "__main__":
    main()
