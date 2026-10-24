"""
Gully Super Over: modelling helpers in GAME coordinates (three.js: x right, y up, z towards the batter's back
wall). Blender is z-up with -y forward, so P(x, y, z) = Blender (x, -z, y); the glTF exporter turns it back.

Every helper makes one mesh object with one material, so the scene can be merged per material for the GLB
(few draw calls) and rendered as-is in Cycles for the lite tier's backdrops.
"""
from __future__ import annotations

import math

import bmesh
import bpy
from mathutils import Matrix, Vector

_mats: dict[str, bpy.types.Material] = {}
_images: dict[str, bpy.types.Image] = {}


def P(x: float, y: float, z: float) -> Vector:
    return Vector((x, -z, y))


def srgb(h: str) -> tuple[float, float, float]:
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)  # linear


def image(key: str, path: str) -> bpy.types.Image:
    if key not in _images:
        _images[key] = bpy.data.images.load(path, check_existing=True)
    return _images[key]


def mat(name: str, color: str, rough: float = 0.7, metal: float = 0.0, emit: float = 0.0, tex: str | None = None,
        alpha_tex: bool = False, coat: float = 0.0) -> bpy.types.Material:
    """A Principled material, cached by name. `tex` = an image key whose texture multiplies the colour."""
    if name in _mats:
        return _mats[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    col = (*srgb(color), 1.0)
    b.inputs["Base Color"].default_value = col
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if coat:
        b.inputs["Coat Weight"].default_value = coat
        b.inputs["Coat Roughness"].default_value = 0.1
    if emit:
        b.inputs["Emission Color"].default_value = col
        b.inputs["Emission Strength"].default_value = emit
    if tex:
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = _images[tex]
        uv = nt.nodes.new("ShaderNodeUVMap")
        nt.links.new(uv.outputs["UV"], t.inputs["Vector"])
        mix = nt.nodes.new("ShaderNodeMix")  # texture × colour: the glTF exporter writes texture + factor
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        mix.inputs["Factor"].default_value = 1.0
        nt.links.new(t.outputs["Color"], mix.inputs[6])
        mix.inputs[7].default_value = col
        nt.links.new(mix.outputs[2], b.inputs["Base Color"])
        if alpha_tex:
            nt.links.new(t.outputs["Alpha"], b.inputs["Alpha"])
            if hasattr(m, "surface_render_method"):
                m.surface_render_method = "BLENDED"
    _mats[name] = m
    return m


def _object(name: str, bm: bmesh.types.BMesh, material: bpy.types.Material, col: bpy.types.Collection | None = None) -> bpy.types.Object:
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(material)
    ob = bpy.data.objects.new(name, me)
    (col or bpy.context.scene.collection).objects.link(ob)
    return ob


def _place(bm: bmesh.types.BMesh, center, yaw: float = 0.0, pitch: float = 0.0, roll: float = 0.0) -> None:
    """Rotates (game axes: yaw about y, pitch about x, roll about z) then moves to `center` (game coords)."""
    # game y-rotation = Blender z-rotation; game x = Blender x; game z = Blender -y
    r = Matrix.Rotation(yaw, 4, "Z") @ Matrix.Rotation(pitch, 4, "X") @ Matrix.Rotation(-roll, 4, "Y")
    bmesh.ops.transform(bm, matrix=Matrix.Translation(P(*center)) @ r, verts=bm.verts)


def box(name: str, size, center, material, yaw: float = 0.0, bevel: float = 0.0, pitch: float = 0.0, roll: float = 0.0,
        col=None, uv_tile: float | None = None) -> bpy.types.Object:
    """A box: size = (width x, height y, depth z) in game axes."""
    sx, sy, sz = size
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector((sx, sz, sy)), verts=bm.verts)
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=min(bevel, min(size) * 0.45), segments=2, affect="EDGES", profile=0.7)
    _place(bm, center, yaw, pitch, roll)
    ob = _object(name, bm, material, col)
    if uv_tile:
        world_uv(ob, uv_tile)
    return ob


def cyl(name: str, r: float, h: float, center, material, axis: str = "y", verts: int = 16, r2: float | None = None,
        yaw: float = 0.0, col=None, cap: bool = True) -> bpy.types.Object:
    """A cylinder (or cone with r2) along a game axis, centred at `center`."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=cap, segments=verts, radius1=r, radius2=r if r2 is None else r2, depth=h)
    rot = {"y": Matrix.Identity(4), "x": Matrix.Rotation(math.pi / 2, 4, "Y"), "z": Matrix.Rotation(math.pi / 2, 4, "X")}[axis]
    bmesh.ops.transform(bm, matrix=rot, verts=bm.verts)
    _place(bm, center, yaw)
    for f in bm.faces:
        f.smooth = True
    return _object(name, bm, material, col)


def sphere(name: str, r: float, center, material, scale=(1, 1, 1), segs: int = 16, col=None, yaw: float = 0.0, pitch: float = 0.0) -> bpy.types.Object:
    """A UV sphere scaled per game axis (x, y, z)."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=max(6, segs // 2), radius=r)
    bmesh.ops.scale(bm, vec=Vector((scale[0], scale[2], scale[1])), verts=bm.verts)
    _place(bm, center, yaw, pitch)
    for f in bm.faces:
        f.smooth = True
    return _object(name, bm, material, col)


def tri_strip(name: str, tris: list[tuple[Vector, Vector, Vector]], material, col=None) -> bpy.types.Object:
    """Loose triangles (game coords), double-sided by construction (flags, cloth)."""
    bm = bmesh.new()
    for a, b, c in tris:
        vs = [bm.verts.new(P(*p)) for p in (a, b, c)]
        bm.faces.new(vs)
    return _object(name, bm, material, col)


def quad(name: str, corners, material, col=None, uv=((0, 0), (1, 0), (1, 1), (0, 1))) -> bpy.types.Object:
    """One quad from four game-coordinate corners, with explicit UVs (decals: kolam, mural)."""
    bm = bmesh.new()
    vs = [bm.verts.new(P(*c)) for c in corners]
    f = bm.faces.new(vs)
    layer = bm.loops.layers.uv.new("UVMap")
    for loop, t in zip(f.loops, uv):
        loop[layer].uv = t
    return _object(name, bm, material, col)


def tube(name: str, pts: list[tuple[float, float, float]], r: float, material, col=None, sides: int = 6) -> bpy.types.Object:
    """A thin tube through game-coordinate points (wires, rails), one cylinder per segment, merged."""
    bm = bmesh.new()
    for a, b in zip(pts, pts[1:]):
        va, vb = P(*a), P(*b)
        d = vb - va
        L = d.length
        if L < 1e-4:
            continue
        geom = bmesh.ops.create_cone(bm, cap_ends=False, segments=sides, radius1=r, radius2=r, depth=L)
        q = Vector((0, 0, 1)).rotation_difference(d.normalized())
        m = Matrix.Translation((va + vb) / 2) @ q.to_matrix().to_4x4()
        bmesh.ops.transform(bm, matrix=m, verts=geom["verts"])
    return _object(name, bm, material, col)


def sag(a, b, n: int = 10, drop: float = 0.6) -> list[tuple[float, float, float]]:
    """Points along a sagging line (a parabola close enough to a catenary) between two game points."""
    out = []
    for i in range(n + 1):
        t = i / n
        out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - drop * 4 * t * (1 - t), a[2] + (b[2] - a[2]) * t))
    return out


def world_uv(ob: bpy.types.Object, tile: float) -> None:
    """Box-projected UVs from world positions (1 UV unit = `tile` metres), so textures keep scale everywhere."""
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    layer = bm.loops.layers.uv.get("UVMap") or bm.loops.layers.uv.new("UVMap")
    mw = ob.matrix_world
    for f in bm.faces:
        n = f.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for loop in f.loops:
            w = mw @ loop.vert.co
            u, v = ((w.y, w.z), (w.x, w.z), (w.x, w.y))[ax]
            loop[layer].uv = (u / tile, v / tile)
    bm.to_mesh(me)
    bm.free()


def merge_by_material(objects: list[bpy.types.Object], prefix: str) -> list[bpy.types.Object]:
    """Joins mesh objects that share a material into one object each (one draw call per material)."""
    groups: dict[str, list[bpy.types.Object]] = {}
    for ob in objects:
        if ob.type == "MESH" and ob.data.materials:
            groups.setdefault(ob.data.materials[0].name, []).append(ob)
    out = []
    for name, obs in groups.items():
        bpy.ops.object.select_all(action="DESELECT")
        for o in obs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = obs[0]
        if len(obs) > 1:
            bpy.ops.object.join()
        obs[0].name = f"{prefix}_{name}"
        out.append(obs[0])
    return out
