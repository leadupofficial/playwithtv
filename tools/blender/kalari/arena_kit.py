"""
Building blocks for the KALARI CLASH arenas (tools/blender/kalari/arenas.py): materials (CC0 ambientCG image sets
pre-tinted and shrunk so they export into glTF, plus flat PBR colours), boxes, coconut palms, brass oil lamps
(nilavilakku), lotus pads, a Kochi-style cantilever fishing net and simple boats. Everything is low-poly with
bevels: the lighting and materials carry the look.
"""
from __future__ import annotations

import math
import os

import bpy
import numpy as np
from mathutils import Vector

TEX_SIZE = 512


def lin(hexc: str):
    h = hexc.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c) + (1.0,)


def flat(name: str, hexc: str, rough=0.6, metal=0.0, emit=0.0, alpha=1.0, emit_hex: str | None = None):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = lin(hexc)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if emit:
        b.inputs["Emission Color"].default_value = lin(emit_hex or hexc)
        b.inputs["Emission Strength"].default_value = emit
    if alpha < 1:
        b.inputs["Alpha"].default_value = alpha
    return m


def textured(name: str, color: str, normal: str | None, out_dir: str, tint=(1, 1, 1), rough=0.7, normal_strength=0.8):
    """An image material from an ambientCG set: colour pre-multiplied by `tint`, both maps shrunk to TEX_SIZE JPEGs."""
    m = bpy.data.materials.get(name)
    if m:
        return m
    os.makedirs(out_dir, exist_ok=True)

    def prep(path: str, suffix: str, mul=None, data=False):
        img = bpy.data.images.load(path)
        img.scale(TEX_SIZE, TEX_SIZE)
        if mul:
            px = np.array(img.pixels[:], dtype=np.float32).reshape(-1, 4)
            px[:, :3] *= np.array(mul, dtype=np.float32)
            img.pixels[:] = np.clip(px, 0, 1).ravel()
        dst = os.path.join(out_dir, f"{name}_{suffix}.jpg")
        img.filepath_raw = dst
        img.file_format = "JPEG"
        bpy.context.scene.render.image_settings.quality = 82
        img.save()
        out = bpy.data.images.load(dst)
        out.colorspace_settings.name = "Non-Color" if data else "sRGB"
        return out

    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    uv = nt.nodes.new("ShaderNodeTexCoord")
    t = nt.nodes.new("ShaderNodeTexImage")
    t.image = prep(color, "c", tint)
    nt.links.new(uv.outputs["UV"], t.inputs["Vector"])
    nt.links.new(t.outputs["Color"], b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = rough
    if normal:
        n = nt.nodes.new("ShaderNodeTexImage")
        n.image = prep(normal, "n", data=True)
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nm.inputs["Strength"].default_value = normal_strength
        nt.links.new(uv.outputs["UV"], n.inputs["Vector"])
        nt.links.new(n.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], b.inputs["Normal"])
    return m


def water(name: str, hexc: str):
    """Deep glossy water: mirror-smooth with a gentle noise ripple (bump) for the renders; flat glossy in glTF."""
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = flat(name, hexc, rough=0.04)
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Specular IOR Level"].default_value = 0.8
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 3.0
    noise.inputs["Detail"].default_value = 4
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.12
    nt.links.new(noise.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    return m


def _uv_box(ob, scale: float):
    """Box-projected UVs in metres / scale (textures tile evenly whatever the object's size)."""
    me = ob.data
    if not me.uv_layers:
        me.uv_layers.new(name="UVMap")
    uv = me.uv_layers.active.data
    mw = ob.matrix_world
    for poly in me.polygons:
        n = poly.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for li in poly.loop_indices:
            p = mw @ me.vertices[me.loops[li].vertex_index].co
            u, v = [(p.y, p.z), (p.x, p.z), (p.x, p.y)][ax]
            uv[li].uv = (u / scale, v / scale)


def box(name: str, lo, hi, mat, bevel=0.0, uv=0.0, col=None):
    lo, hi = Vector(lo), Vector(hi)
    bpy.ops.mesh.primitive_cube_add(size=1, location=(lo + hi) / 2)
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = hi - lo
    bpy.ops.object.transform_apply(scale=True)
    if bevel:
        mod = ob.modifiers.new("bevel", "BEVEL")
        mod.width, mod.segments = bevel, 2
        bpy.ops.object.modifier_apply(modifier="bevel")
    ob.data.materials.append(mat)
    if uv:
        _uv_box(ob, uv)
    if col:
        move(ob, col)
    return ob


def cyl(name: str, loc, r: float, h: float, mat, verts=12, col=None, r2: float | None = None):
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=h, vertices=verts, location=(loc[0], loc[1], loc[2] + h / 2))
    else:
        bpy.ops.mesh.primitive_cone_add(radius1=r, radius2=r2, depth=h, vertices=verts, location=(loc[0], loc[1], loc[2] + h / 2))
    ob = bpy.context.active_object
    ob.name = name
    bpy.ops.object.shade_smooth()
    ob.data.materials.append(mat)
    if col:
        move(ob, col)
    return ob


def collection(name: str):
    c = bpy.data.collections.get(name) or bpy.data.collections.new(name)
    if c.name not in bpy.context.scene.collection.children:
        bpy.context.scene.collection.children.link(c)
    return c


def move(ob, col):
    for c in list(ob.users_collection):
        c.objects.unlink(ob)
    col.objects.link(ob)


def join(objs, name: str):
    """Joins meshes into one object (fewer draw calls in three.js)."""
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    ob = bpy.context.active_object
    ob.name = name
    return ob


def roof(name: str, x0, x1, y0, y1, z0, ridge_h, mat, overhang=0.6, col=None):
    """A gabled roof (ridge along x), the Kerala nalukettu silhouette, with thick eaves."""
    xs, xe = x0 - overhang, x1 + overhang
    ys, ye = y0 - overhang, y1 + overhang
    ym = (y0 + y1) / 2
    zr = z0 + ridge_h
    verts = [(xs, ys, z0), (xe, ys, z0), (xe, ye, z0), (xs, ye, z0), (xs + overhang * 1.8, ym, zr), (xe - overhang * 1.8, ym, zr)]
    faces = [(0, 1, 5, 4), (2, 3, 4, 5), (1, 2, 5), (3, 0, 4), (0, 3, 2, 1)]
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    sol = ob.modifiers.new("thick", "SOLIDIFY")
    sol.thickness = 0.18
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_apply(modifier="thick")
    me.materials.append(mat)
    _uv_box(ob, 2.0)
    if col:
        move(ob, col)
    return ob


def palm(name: str, base, height: float, lean=(0.0, 0.0), fronds=9, col=None, scale=1.0):
    """A coconut palm: a curved, ringed trunk and drooping fronds (one mesh), plus a few coconuts."""
    trunk_mat = flat("palm_trunk", "#6b5440", rough=0.85)
    leaf_mat = flat("palm_leaf", "#3f7a2c", rough=0.55)
    leaf_mat.use_backface_culling = False
    parts = []
    seg = 7
    pts = []
    for i in range(seg + 1):
        t = i / seg
        pts.append(Vector((base[0] + lean[0] * t * t * height, base[1] + lean[1] * t * t * height, base[2] + t * height)))
    for i in range(seg):
        a, b = pts[i], pts[i + 1]
        d = b - a
        r = 0.2 * scale * (1 - 0.35 * i / seg)
        bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=d.length * 1.02, vertices=8, location=(a + b) / 2)
        c = bpy.context.active_object
        c.rotation_mode = "QUATERNION"
        c.rotation_quaternion = d.to_track_quat("Z", "Y")
        c.data.materials.append(trunk_mat)
        parts.append(c)
    top = pts[-1]
    for k in range(fronds):
        a = k / fronds * math.tau + 0.3
        length = (2.6 + 0.6 * math.sin(k * 2.3)) * scale
        n = 6
        verts, faces = [], []
        for j in range(n + 1):
            t = j / n
            w = 0.42 * scale * math.sin(math.pi * min(1, t * 1.15)) + 0.02
            droop = -1.6 * scale * t * t + 0.5 * scale * t
            cx, cy = math.cos(a) * length * t, math.sin(a) * length * t
            px, py = -math.sin(a) * w, math.cos(a) * w
            verts += [(top.x + cx + px, top.y + cy + py, top.z + droop - 0.08 * w), (top.x + cx - px, top.y + cy - py, top.z + droop - 0.08 * w),
                      (top.x + cx, top.y + cy, top.z + droop + 0.06 * scale)]
            if j:
                i0 = (j - 1) * 3
                faces += [(i0, i0 + 3, i0 + 5, i0 + 2), (i0 + 2, i0 + 5, i0 + 4, i0 + 1)]
        me = bpy.data.meshes.new(f"{name}_frond{k}")
        me.from_pydata(verts, [], faces)
        me.materials.append(leaf_mat)
        ob = bpy.data.objects.new(me.name, me)
        bpy.context.scene.collection.objects.link(ob)
        parts.append(ob)
    nut = flat("coconut", "#5a4a22", rough=0.6)
    for k in range(3):
        a = k * 2.1
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.16 * scale, segments=10, ring_count=6,
                                             location=(top.x + math.cos(a) * 0.22 * scale, top.y + math.sin(a) * 0.22 * scale, top.z - 0.25 * scale))
        c = bpy.context.active_object
        c.data.materials.append(nut)
        parts.append(c)
    ob = join(parts, name)
    if col:
        move(ob, col)
    return ob


def lamp(name: str, x, y, flame_z, col=None, stand=True):
    """A brass nilavilakku: stand, dish and a small flame; the flame is emissive (bloom) and lights the scene."""
    brass = flat("brass", "#c9922e", rough=0.28, metal=1.0)
    parts = []
    if stand:
        base_z = flame_z - 1.25
        parts.append(cyl(f"{name}_foot", (x, y, base_z), 0.22, 0.08, brass, 16, r2=0.16))
        parts.append(cyl(f"{name}_stem", (x, y, base_z + 0.08), 0.045, 1.0, brass, 10))
        for k, z in enumerate((0.35, 0.7)):
            parts.append(cyl(f"{name}_knot{k}", (x, y, base_z + z), 0.08, 0.05, brass, 12))
    parts.append(cyl(f"{name}_dish", (x, y, flame_z - 0.17), 0.08, 0.1, brass, 16, r2=0.24))
    stand_ob = join(parts, f"{name}_brass")
    fl = flat("flame", "#ffb347", rough=1.0, emit=40.0, emit_hex="#ff9a2e")
    bpy.ops.mesh.primitive_cone_add(radius1=0.05, radius2=0.0, depth=0.16, vertices=8, location=(x, y, flame_z))
    flame = bpy.context.active_object
    flame.name = f"{name}_Flame"
    flame.data.materials.append(fl)
    light = bpy.data.lights.new(f"{name}_light", "POINT")
    light.energy = 140
    light.color = (1.0, 0.62, 0.3)
    light.shadow_soft_size = 0.15
    lo = bpy.data.objects.new(f"{name}_light", light)
    bpy.context.scene.collection.objects.link(lo)
    lo.location = (x, y, flame_z + 0.1)
    if col:
        for o in (stand_ob, flame, lo):
            move(o, col)
    return stand_ob, flame


def lotus(name: str, x, y, z, r=0.45, flower=False, col=None):
    pad = flat("lotus_pad", "#3d7a35", rough=0.4)
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=0.02, vertices=14, location=(x, y, z))
    ob = bpy.context.active_object
    ob.name = name
    ob.data.materials.append(pad)
    parts = [ob]
    if flower:
        petal = flat("lotus_petal", "#f39ab8", rough=0.45)
        for k in range(6):
            a = k / 6 * math.tau
            bpy.ops.mesh.primitive_uv_sphere_add(radius=0.09, segments=8, ring_count=6, location=(x + math.cos(a) * 0.07, y + math.sin(a) * 0.07, z + 0.1))
            p = bpy.context.active_object
            p.scale = (0.6, 0.6, 1.5)
            p.rotation_euler = (math.sin(a) * 0.5, -math.cos(a) * 0.5, 0)
            p.data.materials.append(petal)
            parts.append(p)
    ob = join(parts, name)
    if col:
        move(ob, col)
    return ob


def fishing_net(name: str, x, y, z, s=1.0, col=None):
    """A Kochi cantilever fishing net silhouette: two leaning poles, a beam and a square net, on a small platform."""
    wood = flat("net_wood", "#4a3a2a", rough=0.8)
    netm = flat("net_mesh", "#2c2a26", rough=0.9, alpha=0.6)
    parts = [box(f"{name}_deck", (x - 1.2 * s, y - 1 * s, z - 0.3), (x + 1.2 * s, y + 1 * s, z), wood)]
    tip = Vector((x - 5 * s, y - 2 * s, z + 4.5 * s))
    for dx in (-0.5, 0.5):
        a = Vector((x + dx * s, y, z))
        d = tip - a
        bpy.ops.mesh.primitive_cylinder_add(radius=0.08 * s, depth=d.length, vertices=6, location=a + d / 2)
        c = bpy.context.active_object
        c.rotation_mode = "QUATERNION"
        c.rotation_quaternion = d.to_track_quat("Z", "Y")
        c.data.materials.append(wood)
        parts.append(c)
    bpy.ops.mesh.primitive_plane_add(size=3.6 * s, location=(tip.x - 0.4 * s, tip.y, tip.z - 2.6 * s))
    n = bpy.context.active_object
    n.rotation_euler = (0.2, 0.9, 0)
    n.data.materials.append(netm)
    parts.append(n)
    ob = join(parts, name)
    if col:
        move(ob, col)
    return ob


def boat(name: str, x, y, z, length=6.0, rot=0.0, col=None, hexc="#2b4a66"):
    """A long, slim country boat (vallam): a stretched, flattened hull with a raised prow and stern."""
    hull = flat(f"boat_{hexc}", hexc, rough=0.5)
    trim = flat("boat_trim", "#c9a24a", rough=0.5)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=1, segments=24, ring_count=10, location=(x, y, z))
    h = bpy.context.active_object
    h.scale = (length / 2, 0.55, 0.45)
    bpy.ops.object.transform_apply(scale=True)
    for v in h.data.vertices:  # cut the top off and lift the ends
        if v.co.z > 0.05:
            v.co.z = 0.05 + (abs(v.co.x) / (length / 2)) ** 4 * 0.9
    h.data.materials.append(hull)
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, y, z + 0.06))
    t = bpy.context.active_object
    t.scale = (length * 0.8, 1.02, 0.06)
    t.data.materials.append(trim)
    ob = join([h, t], name)
    ob.rotation_euler = (0, 0, rot)
    if col:
        move(ob, col)
    return ob
