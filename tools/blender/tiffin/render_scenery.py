"""
Tiffin Tornado: the world outside the kitchen carriage, rendered with the game camera as horizontally tileable
strips (the game scrolls them while the train runs). Kinds:
  fields    paddy fields with water, coconut palms, a hut, telegraph poles, hills and sky (north of the train)
  tunnel    a rock tunnel wall with lamps
  platform  a station platform with pillars, a canopy, benches, a tea stall and the "TIFFIN JN" board
  track     the ballast, sleepers and rails under and in front of the train (the near layer)

  blender -b --factory-startup -P tools/blender/tiffin/render_scenery.py -- --kind fields --out <dir> --hdri sky.hdr
"""
from __future__ import annotations

import argparse
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402

import tt_common as T  # noqa: E402
import pwtv_atlas as atlas  # noqa: E402
import pwtv_common as C  # noqa: E402
import tt_light as L  # noqa: E402
from tt_common import box, cyl, mat, scatter, sphere  # noqa: E402

LENGTH = 18.04          # metres per tile (the widest level's view × margin)
PX = (1500, 844)
H = 7.0                 # carriage depth: the train occupies y ∈ [-H/2, H/2]


def args():
    p = argparse.ArgumentParser()
    p.add_argument("--kind", required=True, choices=["far", "fields", "tunnel", "platform", "track"])
    p.add_argument("--out", required=True)
    p.add_argument("--hdri")
    p.add_argument("--samples", type=int, default=64)
    p.add_argument("--target-y", type=float, default=1.3, help="camera target (north offset), as in kitchen-<n>.json")
    p.add_argument("--preview")
    return C.parse(p)


def tiled(fn, x, *a, **k):
    """Places something at x and, if near an edge, again one tile over (seamless wrap)."""
    out = fn(x, *a, **k)
    if x < -LENGTH / 2 + 2.5:
        out += fn(x + LENGTH, *a, **k)
    elif x > LENGTH / 2 - 2.5:
        out += fn(x - LENGTH, *a, **k)
    return out


def ground(y0, y1, material, z=0.0):
    return [box((LENGTH * 3, y1 - y0, 0.2), loc=(0, (y0 + y1) / 2, z - 0.1), material=material, bevel=0)]


def palm(x, y, h=6.0, lean=0.2, seed=1, size=1.0):
    r = scatter(seed)
    out = []
    n = 7
    for k in range(n):
        t = k / n
        out.append(cyl((0.16 - 0.05 * t) * size, h / n + 0.05, loc=(x + lean * h * t * t, y, h * t), material="wood_dark", verts=10))
    tx, tz = x + lean * h, h
    for k in range(9):
        a = k * 2 * math.pi / 9 + r()
        out.append(box((1.9 * size, 0.32 * size, 0.04), loc=(tx + math.cos(a) * 0.9 * size, y + math.sin(a) * 0.9 * size, tz - 0.25 * size), material="leaf", bevel=0.02, rot=(0, 0.5, a)))
    for k in range(3):
        out.append(sphere(0.16 * size, loc=(tx + (r() - 0.5) * 0.3 * size, y + (r() - 0.5) * 0.3 * size, tz - 0.3 * size), material="coconut"))
    return out


def pole(x, y):
    return [cyl(0.06, 3.2, loc=(x, y, 0), material="wood_dark", verts=8),
            box((0.9, 0.08, 0.08), loc=(x, y, 3.0), material="wood_dark", bevel=0.01)]


def hut(x, y):
    out = [box((2.2, 1.8, 1.4), loc=(x, y, 0.7), material="cream", bevel=0.05)]
    out.append(box((2.6, 2.2, 0.2), loc=(x, y, 1.6), material=mat("leaf", color=T.srgb("#b08a4a")), bevel=0.05, rot=(0.25, 0, 0)))
    out.append(box((0.6, 0.06, 1.0), loc=(x, y - 0.92, 0.5), material="teal", bevel=0.02))
    return out


# ---- side-view panoramas (seen through the back-wall windows and above the roofline) ----------------------------

PANO_PX = (1500, 450)   # 18.04 m × 5.4 m


def far():
    """Sky (the world), rolling green hills and tiny distant palms: the slow parallax layer."""
    r = scatter(5)
    # an ortho view never sees a horizon: a painted sky card, then cards of hills, distant palms and fields
    out = [sky_card(40)]
    out.append(box((LENGTH * 3, 0.5, 4.0), loc=(0, 30, -1.2), material=mat("leaf", color=T.srgb("#6a9e48"), coat=0), bevel=0))
    for k in range(9):
        x = (k / 9 - 0.5) * LENGTH
        out += tiled(lambda xx: [sphere(3.2, loc=(xx, 36, -0.4), material=mat("leaf", color=T.srgb("#6f9a7c"), coat=0), scale=(1.6, 0.3, 0.55))], x)
    for k in range(7):
        x = (k / 7 - 0.5) * LENGTH
        out += tiled(lambda xx: [sphere(2.4, loc=(xx + 1.2, 33, -0.6), material=mat("leaf", color=T.srgb("#4d7f55"), coat=0), scale=(1.8, 0.3, 0.5))], x)
    for k in range(14):
        x = (r() - 0.5) * LENGTH
        out += tiled(palm, x, 25 + r() * 3, 1.6 + r() * 0.6, (r() - 0.5) * 0.3, k, 0.35)
    return out


def sky_card(y: float):
    """An emissive gradient sky: pale at the horizon, deep blue at the top, a few soft clouds."""
    ob = box((LENGTH * 3, 0.2, 12), loc=(0, y, 3.0), material=None, bevel=0)
    m = bpy.data.materials.new("sky")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.25
    ramp.color_ramp.elements[0].color = (*T.srgb("#f4e9d0"), 1)
    ramp.color_ramp.elements[1].position = 0.75
    ramp.color_ramp.elements[1].color = (*T.srgb("#5aa2d6"), 1)
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 3.0
    cl = nt.nodes.new("ShaderNodeMix")
    cl.data_type = "RGBA"
    cl.inputs[7].default_value = (1, 1, 1, 1)
    nt.links.new(tc.outputs["Generated"], sep.inputs[0])
    nt.links.new(sep.outputs["Z"], ramp.inputs["Fac"])
    nt.links.new(tc.outputs["Generated"], noise.inputs["Vector"])
    thr = nt.nodes.new("ShaderNodeMapRange")
    thr.inputs["From Min"].default_value = 0.55
    thr.inputs["From Max"].default_value = 0.75
    nt.links.new(noise.outputs["Fac"], thr.inputs["Value"])
    nt.links.new(thr.outputs["Result"], cl.inputs["Factor"])
    nt.links.new(ramp.outputs["Color"], cl.inputs[6])
    nt.links.new(cl.outputs[2], em.inputs["Color"])
    em.inputs["Strength"].default_value = 1.0
    nt.links.new(em.outputs[0], out.inputs["Surface"])
    ob.data.materials.append(m)
    return ob


def fields():
    """Paddy fields, coconut palms, telegraph poles and a hut: the fast near layer (transparent above)."""
    r = scatter(7)
    out = ground(2, 9, mat("water", color=T.srgb("#6aa391"), rough=0.06, coat=0.7), z=-0.05)
    out += ground(0, 2, mat("leaf", color=T.srgb("#5d8f2c"), coat=0), z=0.1)
    for k in range(4):
        out.append(box((LENGTH * 3, 0.25, 0.16), loc=(0, 3 + k * 1.6, 0.04), material=mat("dough", color=T.srgb("#7d6a3a")), bevel=0.04))
    for k in range(260):
        x, y = (r() - 0.5) * LENGTH, 2.3 + r() * 6
        out += tiled(lambda xx: [cyl(0.08, 0.3, loc=(xx, y, 0), material=mat("leaf_light", color=T.srgb("#86c63e")), r2=0.015, verts=5)], x)
    for k in range(4):
        out += tiled(pole, -LENGTH / 2 + (k + 0.5) * LENGTH / 4, 1.0)
    for k in range(6):
        x = -LENGTH / 2 + (k + 0.15 + r() * 0.7) * LENGTH / 6
        out += tiled(palm, x, 6 + r() * 4, 3.2 + r() * 1.3, (r() - 0.5) * 0.5, k, 0.7)
    out += tiled(hut, LENGTH * 0.12, 8.5)
    return out


def tunnel():
    r = scatter(9)
    out = [box((LENGTH * 3, 1.0, 8), loc=(0, 1.2, 3.0), material=mat("stone", color=T.srgb("#3d3733"), rough=0.95), bevel=0)]
    for k in range(70):
        x, z = (r() - 0.5) * LENGTH, r() * 5.5
        out += tiled(lambda xx: [sphere(0.4 + r() * 0.5, loc=(xx, 0.75, z), material=mat("stone", color=T.srgb("#4d4640")), scale=(1.3, 0.5, 0.9))], x)
    for k in range(3):
        x = -LENGTH / 2 + (k + 0.5) * LENGTH / 3
        out += tiled(lambda xx: [box((0.6, 0.2, 0.3), loc=(xx, 0.6, 3.2), material="lamp", bevel=0.03),
                                 box((0.7, 0.25, 0.08), loc=(xx, 0.6, 3.4), material="iron", bevel=0.02)], x)
    out.append(box((LENGTH * 3, 0.15, 0.25), loc=(0, 0.55, 1.4), material="iron", bevel=0.01))  # a cable duct
    return out


def platform():
    """A station platform beside the train: the near layer at a stop (transparent above the canopy)."""
    out = [box((LENGTH * 3, 4, 1.0), loc=(0, 2.5, 0.5), material=mat("stone_light", color=T.srgb("#c2b9a6")), bevel=0.02)]
    out.append(box((LENGTH * 3, 0.4, 0.03), loc=(0, 0.75, 1.01), material="gold_paint", bevel=0))
    out.append(box((LENGTH * 3, 0.3, 3.6), loc=(0, 4.6, 2.8), material="cream", bevel=0))
    out.append(box((LENGTH * 3, 0.32, 1.0), loc=(0, 4.5, 1.5), material="maroon", bevel=0))
    out.append(box((LENGTH * 3, 4.6, 0.14), loc=(0, 2.4, 4.3), material="maroon", bevel=0, rot=(-0.1, 0, 0)))
    out.append(box((LENGTH * 3, 0.1, 0.25), loc=(0, 0.2, 4.15), material="cream", bevel=0))
    for k in range(4):
        x = -LENGTH / 2 + (k + 0.5) * LENGTH / 4
        out += tiled(lambda xx: [cyl(0.15, 3.3, loc=(xx, 2.2, 1.0), material="teal", verts=14)], x)
        out += tiled(lambda xx: [box((1.5, 0.45, 0.08), loc=(xx + 1.9, 3.6, 1.45), material="wood", bevel=0.02),
                                 box((1.5, 0.08, 0.4), loc=(xx + 1.9, 3.85, 1.7), material="wood", bevel=0.02)], x)
    out.append(box((3.4, 0.12, 0.8), loc=(0, 4.3, 3.3), material="gold_paint", bevel=0.04))
    bpy.ops.object.text_add(location=(0, 4.2, 3.3), rotation=(math.pi / 2, 0, 0))
    t = bpy.context.active_object
    t.data.body = "TIFFIN JN"
    t.data.align_x, t.data.align_y = "CENTER", "CENTER"
    t.data.size = 0.5
    t.data.extrude = 0.02
    t.data.materials.append(mat("ink"))
    bpy.ops.object.convert(target="MESH")
    out.append(bpy.context.active_object)
    sx = LENGTH * 0.28
    out.append(box((2.2, 1.2, 1.1), loc=(sx, 3.0, 1.55), material="teal_light", bevel=0.05))
    out.append(box((2.5, 1.6, 0.12), loc=(sx, 3.0, 2.85), material="fabric_red", bevel=0.03))
    for s2 in (-1, 1):
        out.append(cyl(0.04, 0.8, loc=(sx + s2 * 1.1, 2.4, 2.1), material="wood_dark", verts=6))
    for k in range(3):
        out.append(cyl(0.17, 0.42, loc=(sx - 0.6 + k * 0.6, 2.7, 2.1), material="brass", verts=14))
    for k in range(5):
        out += tiled(lambda xx: [cyl(0.22, 0.4, loc=(xx, 4.1, 1.0), material="clay", r2=0.28), sphere(0.38, loc=(xx, 4.1, 1.62), material="leaf")], -LENGTH / 2 + (k + 0.7) * LENGTH / 5)
    return out


def track():
    out = ground(-60, -H / 2 + 1.0, mat("leaf", color=T.srgb("#56802c"), coat=0), z=-0.9)
    out += ground(-H / 2 - 1.6, H / 2, mat("stone", color=T.srgb("#6b625a")), z=-0.95)
    n = int(LENGTH / 0.6)
    for k in range(n):
        x = -LENGTH / 2 + (k + 0.5) * LENGTH / n
        out.append(box((0.25, H - 0.2, 0.12), loc=(x, 0, -0.9), material=mat("wood_dark", color=T.srgb("#4a3a2c")), bevel=0.01))
    for y in (-H / 2 + 0.35, H / 2 - 0.35):
        out.append(box((LENGTH * 3, 0.1, 0.14), loc=(0, y, -0.78), material="steel", bevel=0.01))
    r = scatter(2)
    for k in range(40):
        x, y = (r() - 0.5) * LENGTH, -H / 2 - 3 - r() * 12
        out += tiled(lambda xx: [sphere(0.35 + r() * 0.4, loc=(xx, y, -0.8), material=mat("leaf", color=T.srgb("#3f7a2a")), scale=(1.3, 1, 0.7))], x)
    return out


def main():
    a = args()
    os.makedirs(a.out, exist_ok=True)
    C.empty_scene()
    {"far": far, "fields": fields, "tunnel": tunnel, "platform": platform, "track": track}[a.kind]()
    side = a.kind != "track"
    if side:  # a near-horizontal view, looking north out of the windows
        cam = L.camera(target=(0, 0, 2.35), ortho_scale=LENGTH)
        e = math.radians(0 if a.kind == "far" else 7)  # the far layer looks level, so distance doesn't move it
        cam.location = T.Vector((0, -math.cos(e) * 60, 2.35 + math.sin(e) * 60))
        C.look_at(cam, T.Vector((0, 0, 2.35)))
    else:
        L.camera(target=(0, a.target_y, 0), ortho_scale=LENGTH)
    px = PANO_PX if side else PX
    dark = a.kind == "tunnel"
    L.sky_world(a.hdri, 0.08 if dark else 1.0)
    if not dark:
        sun = bpy.data.lights.new("sun", "SUN")
        sun.energy = 4.0
        sun.angle = math.radians(2)
        so = bpy.data.objects.new("sun", sun)
        bpy.context.scene.collection.objects.link(so)
        so.rotation_euler = (math.radians(40), math.radians(-25), math.radians(-30))
    else:
        for k in range(3):
            lx = -LENGTH / 2 + (k + 0.5) * LENGTH / 3
            T.C.area_light(f"l{k}", 300, (1.0, 0.7, 0.4), 0.8, (lx, -0.4, 3.0), (lx, 0.7, 2.6))
    C.setup_render("cycles", a.samples, px[0], px[1], transparent=a.kind in ("track", "fields", "platform"), look="AgX - Punchy")
    bpy.context.scene.view_settings.exposure = -0.3
    png = os.path.join(a.out, f"scenery-{a.kind}.png")
    C.render_to(png)
    img = atlas.load_rgba(png)
    atlas.save_rgba(img, os.path.join(a.out, f"scenery-{a.kind}.webp"), "WEBP", 82)
    if a.preview:
        atlas.save_rgba(atlas.preview(img), a.preview, "PNG")
    os.remove(png)
    C.log(f"scenery-{a.kind}: {os.path.getsize(os.path.join(a.out, f'scenery-{a.kind}.webp')) // 1024} KB")


if __name__ == "__main__":
    main()
