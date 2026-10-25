"""
Tiffin Tornado: shared Blender helpers for the game's own models (Blender 5.x, headless).

Units: metres, one kitchen cell = 1 m, counter tops at 0.5 m (KayKit Restaurant Bits at half scale).
Game axes → Blender: game x = Blender X, game z (towards the camera) = Blender -Y, height = Blender Z.

Everything here is modelled from primitives in code (original art): chunky, bevelled, flat-coloured PBR
materials that export cleanly to glTF (no procedural textures in anything that ships as a GLB).
"""
from __future__ import annotations

import math
import os
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))  # tools/blender (pwtv_common, pwtv_atlas)

import pwtv_common as C  # noqa: E402

KAYKIT_SCALE = 0.5

# ---------------------------------------------------------------------------------------------------------------
# materials (cached by name)

PALETTE = {
    "steel": dict(color=(0.78, 0.8, 0.83), metal=1.0, rough=0.22),
    "steel_dark": dict(color=(0.42, 0.44, 0.47), metal=1.0, rough=0.35),
    "brass": dict(color=(0.95, 0.66, 0.24), metal=1.0, rough=0.28),
    "iron": dict(color=(0.07, 0.07, 0.075), metal=0.6, rough=0.45),
    "clay": dict(color=(0.62, 0.27, 0.13), rough=0.85),
    "clay_dark": dict(color=(0.42, 0.17, 0.08), rough=0.9),
    "wood": dict(color=(0.55, 0.32, 0.16), rough=0.6),
    "wood_light": dict(color=(0.74, 0.5, 0.28), rough=0.55),
    "wood_dark": dict(color=(0.3, 0.16, 0.08), rough=0.6),
    "stone": dict(color=(0.42, 0.42, 0.44), rough=0.8),
    "stone_light": dict(color=(0.66, 0.65, 0.62), rough=0.75),
    "cream": dict(color=(0.93, 0.85, 0.68), rough=0.6),
    "teal": dict(color=(0.06, 0.38, 0.4), rough=0.45, coat=0.3),
    "teal_light": dict(color=(0.16, 0.55, 0.55), rough=0.45),
    "maroon": dict(color=(0.42, 0.06, 0.08), rough=0.35, coat=0.6),
    "gold_paint": dict(color=(0.95, 0.72, 0.2), rough=0.4),
    "white": dict(color=(0.92, 0.92, 0.9), rough=0.5),
    "black": dict(color=(0.03, 0.03, 0.035), rough=0.5),
    "rubber": dict(color=(0.05, 0.05, 0.05), rough=0.9),
    "leaf": dict(color=(0.13, 0.42, 0.08), rough=0.35, coat=0.4),
    "leaf_light": dict(color=(0.3, 0.6, 0.12), rough=0.4),
    "batter": dict(color=(0.93, 0.9, 0.82), rough=0.35, sss=0.2),
    "dough": dict(color=(0.86, 0.74, 0.52), rough=0.6),
    "dosa": dict(color=(0.86, 0.55, 0.18), rough=0.45),
    "dosa_light": dict(color=(0.96, 0.78, 0.42), rough=0.5),
    "dosa_dark": dict(color=(0.55, 0.26, 0.06), rough=0.5),
    "idli": dict(color=(0.97, 0.96, 0.92), rough=0.55, sss=0.3),
    "vada": dict(color=(0.72, 0.4, 0.1), rough=0.45, coat=0.25),
    "vada_dark": dict(color=(0.48, 0.22, 0.05), rough=0.5),
    "chutney": dict(color=(0.92, 0.94, 0.86), rough=0.5),
    "chutney_green": dict(color=(0.42, 0.7, 0.25), rough=0.5),
    "sambar": dict(color=(0.72, 0.3, 0.06), rough=0.2, coat=0.5),
    "sambar_veg": dict(color=(0.95, 0.5, 0.1), rough=0.5),
    "coffee": dict(color=(0.55, 0.33, 0.17), rough=0.25),
    "froth": dict(color=(0.86, 0.72, 0.55), rough=0.6),
    "coconut": dict(color=(0.36, 0.2, 0.09), rough=0.9),
    "coconut_white": dict(color=(0.97, 0.96, 0.92), rough=0.6),
    "carrot": dict(color=(0.95, 0.42, 0.06), rough=0.5),
    "drumstick": dict(color=(0.3, 0.45, 0.12), rough=0.6),
    "onion": dict(color=(0.62, 0.18, 0.3), rough=0.4),
    "chilli": dict(color=(0.75, 0.05, 0.03), rough=0.35, coat=0.4),
    "water": dict(color=(0.55, 0.75, 0.9), rough=0.05, metal=0.0),
    "burnt": dict(color=(0.04, 0.03, 0.03), rough=0.95),
    "oil": dict(color=(0.9, 0.62, 0.12), rough=0.08, coat=0.8),
    "fabric_red": dict(color=(0.7, 0.08, 0.1), rough=0.8),
    "glass": dict(color=(0.6, 0.75, 0.8), rough=0.05, alpha=0.25),
    "lamp": dict(color=(1.0, 0.85, 0.55), rough=0.4, emit=(1.0, 0.78, 0.45), emit_strength=6.0),
    "chef_white": dict(color=(0.95, 0.94, 0.9), rough=0.7),
    "chef_trousers": dict(color=(0.13, 0.13, 0.16), rough=0.75),
    "key_magenta": dict(color=(0.85, 0.05, 0.75), rough=0.6),
    "paper": dict(color=(0.98, 0.95, 0.85), rough=0.8),
    "ink": dict(color=(0.08, 0.05, 0.04), rough=0.8),
}

def srgb(hexstr: str) -> tuple[float, float, float]:
    """'#c8822a' → linear RGB (Blender colours are linear)."""
    h = hexstr.lstrip("#")
    out = []
    for i in (0, 2, 4):
        c = int(h[i:i + 2], 16) / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return tuple(out)


# art-directed colours in sRGB (what you would pick in a paint program); converted to linear on load
SRGB = {
    "steel": "#c9ced4", "steel_dark": "#7d838a", "brass": "#e0a845", "iron": "#26262a", "clay": "#b8542a", "clay_dark": "#7c3518",
    "wood": "#a0612f", "wood_light": "#c98f55", "wood_dark": "#5e3418", "stone": "#7b7c80", "stone_light": "#a9a7a0",
    "cream": "#f2e2bf", "teal": "#1e7a7c", "teal_light": "#3ea39e", "maroon": "#8a1f2a", "gold_paint": "#f0b632",
    "white": "#f1efe8", "black": "#141416", "rubber": "#1a1a1a", "leaf": "#2f8a1e", "leaf_light": "#73b83a",
    "batter": "#f4ecd8", "dough": "#e2c08a", "dosa": "#d98a2b", "dosa_light": "#f0b75a", "dosa_dark": "#8f4a14",
    "idli": "#fbf8ef", "vada": "#c56f22", "vada_dark": "#7f3c10", "chutney": "#eef0dc", "chutney_green": "#6cab3a",
    "sambar": "#c4561a", "sambar_veg": "#f08a24", "coffee": "#8a5a32", "froth": "#e7c9a0", "coconut": "#6b3f1d",
    "coconut_white": "#f7f3e8", "carrot": "#f2741a", "drumstick": "#5c8a2a", "onion": "#a8325a", "chilli": "#c4180f",
    "water": "#9cc8e6", "burnt": "#1d1514", "oil": "#e8a52a", "fabric_red": "#b5222a", "glass": "#a8c8d4",
    "lamp": "#ffd88a", "chef_white": "#f6f4ee", "chef_trousers": "#2a2a33", "key_magenta": "#e01ac8",
    "paper": "#fbf3dc", "ink": "#2a1a12",
}
for _k, _hex in SRGB.items():
    PALETTE.setdefault(_k, {})["color"] = srgb(_hex)

_mats: dict[str, bpy.types.Material] = {}


def mat(name: str, **override) -> bpy.types.Material:
    """A Principled material from PALETTE (or with explicit overrides: color, rough, metal, coat, emit…)."""
    key = name if not override else name + "_" + "_".join(f"{k}{v}" for k, v in sorted(override.items()))
    if key in _mats and _mats[key].name in bpy.data.materials:
        return _mats[key]
    spec = {**PALETTE.get(name, {}), **override}
    m = bpy.data.materials.new("tt_" + key)
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    col = spec.get("color", (0.8, 0.8, 0.8))
    b.inputs["Base Color"].default_value = (*col, 1)
    b.inputs["Roughness"].default_value = spec.get("rough", 0.5)
    b.inputs["Metallic"].default_value = spec.get("metal", 0.0)
    if spec.get("coat"):
        b.inputs["Coat Weight"].default_value = spec["coat"]
        b.inputs["Coat Roughness"].default_value = 0.08
    if spec.get("sss"):
        b.inputs["Subsurface Weight"].default_value = spec["sss"]
        b.inputs["Subsurface Radius"].default_value = (0.05, 0.03, 0.02)
    if spec.get("emit"):
        b.inputs["Emission Color"].default_value = (*spec["emit"], 1)
        b.inputs["Emission Strength"].default_value = spec.get("emit_strength", 3.0)
    if spec.get("alpha") is not None:
        b.inputs["Alpha"].default_value = spec["alpha"]
        m.surface_render_method = "BLENDED" if hasattr(m, "surface_render_method") else m.surface_render_method
    m.diffuse_color = (*col, 1)
    _mats[key] = m
    return m


# ---------------------------------------------------------------------------------------------------------------
# primitives: every helper returns a new mesh object, already given its material


def _finish(ob, material, bevel: float = 0.0, smooth: bool = True, segments: int = 2):
    ob.data.materials.clear()
    if material is not None:
        ob.data.materials.append(material if isinstance(material, bpy.types.Material) else mat(material))
    if bevel > 0:
        m = ob.modifiers.new("bevel", "BEVEL")
        m.width = bevel
        m.segments = segments
        m.limit_method = "ANGLE"
    if smooth:
        for p in ob.data.polygons:
            p.use_smooth = True
        try:
            m = ob.modifiers.new("smooth", "SMOOTH_BY_ANGLE")  # Blender 4.1+: geometry-nodes modifier
            m.show_viewport = True
        except Exception:
            pass
        try:
            ob.data.set_sharp_from_angle(angle=math.radians(40))
        except Exception:
            pass
    return ob


def box(size, loc=(0, 0, 0), material="white", bevel=0.01, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    ob = bpy.context.active_object
    ob.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return _finish(ob, material, bevel)


def cyl(r, h, loc=(0, 0, 0), material="steel", verts=32, bevel=0.0, rot=(0, 0, 0), r2=None):
    """
    A cylinder standing on `loc` (its base at loc.z), or a cone frustum when r2 is given. A rotated cylinder is
    centred on `loc` instead (lying sticks, rolls).
    """
    centre = loc if any(rot) else (loc[0], loc[1], loc[2] + h / 2)
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=h, vertices=verts, location=centre, rotation=rot)
    else:
        bpy.ops.mesh.primitive_cone_add(radius1=r, radius2=r2, depth=h, vertices=verts, location=centre, rotation=rot)
    return _finish(bpy.context.active_object, material, bevel)


def sphere(r, loc=(0, 0, 0), material="white", scale=(1, 1, 1), segs=0):
    segs = segs or (8 if r < 0.02 else 12 if r < 0.05 else 20)  # small specks stay cheap
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, segments=segs, ring_count=max(8, segs // 2), location=loc)
    ob = bpy.context.active_object
    ob.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return _finish(ob, material)


def torus(R, r, loc=(0, 0, 0), material="white", scale=(1, 1, 1), rot=(0, 0, 0), major=32, minor=12):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, major_segments=major, minor_segments=minor, location=loc, rotation=rot)
    ob = bpy.context.active_object
    ob.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return _finish(ob, material)


def bowl(r, h, loc=(0, 0, 0), material="steel", fill=None, fill_level=0.75, thickness=0.012):
    """A round bowl (half sphere squashed to height h) with an optional filling surface."""
    bpy.ops.mesh.primitive_uv_sphere_add(radius=1, segments=32, ring_count=16, location=(0, 0, 0))
    ob = bpy.context.active_object
    me = ob.data
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(me)
    for v in [v for v in bm.verts if v.co.z > 1e-4]:
        bm.verts.remove(v)
    bm.to_mesh(me)
    bm.free()
    ob.scale = (r, r, h)
    ob.location = (loc[0], loc[1], loc[2] + h)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    sol = ob.modifiers.new("thick", "SOLIDIFY")
    sol.thickness = thickness
    out = [_finish(ob, material)]
    if fill:
        rr = r * math.sqrt(max(0.0, 1 - (1 - fill_level) ** 2))
        bpy.ops.mesh.primitive_circle_add(radius=rr, vertices=32, fill_type="NGON", location=(loc[0], loc[1], loc[2] + h * fill_level))
        out.append(_finish(bpy.context.active_object, fill))
    return out


def join(objs, name: str):
    """Joins objects into one mesh (modifiers applied first)."""
    objs = [o for o in objs if o is not None]
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        for m in list(o.modifiers):
            try:
                bpy.ops.object.modifier_apply(modifier=m.name)
            except Exception:
                o.modifiers.remove(m)
    bpy.context.view_layer.objects.active = objs[0]
    for o in objs:
        o.select_set(True)
    if len(objs) > 1:
        bpy.ops.object.join()
    ob = bpy.context.active_object
    ob.name = name
    ob.data.name = name
    return ob


def place(ob, x=0.0, y=0.0, z=0.0, rz=0.0):
    ob.location = (x, y, z)
    ob.rotation_euler = (0, 0, rz)
    return ob


def scatter(seed: int):
    """A tiny deterministic random generator (same art every run)."""
    s = [seed * 9301 + 49297]

    def r() -> float:
        s[0] = (s[0] * 16807) % 2147483647
        return s[0] / 2147483647

    return r


# KayKit's palette texture is 8×4 vertical-gradient swatches. The train kitchen repaints a few of them:
# (col, row) → (top colour, bottom colour) in sRGB.
KAYKIT_REPAINT = {
    (6, 3): ("#a3acb5", "#59626b"),  # counter tops → brushed stainless steel
    (7, 3): ("#c98a4e", "#6e3d1d"),  # cabinet bodies → warm teak
    (5, 3): ("#f3e6c8", "#c2a77a"),  # drawer fronts → cream
    (1, 1): ("#2f9a94", "#0f4b4f"),  # stove bodies → railway teal
}
_kaykit_tex: dict[str, bpy.types.Image] = {}


def kaykit_texture(img: bpy.types.Image) -> bpy.types.Image:
    """A repainted copy of the KayKit palette (cached), shared by every piece."""
    if img.name in _kaykit_tex:
        return _kaykit_tex[img.name]
    import numpy as np
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(h, w, 4)  # rows bottom-up
    sw, sh = w // 8, h // 4
    for (c, r), (top, bottom) in KAYKIT_REPAINT.items():
        raw = lambda hx: np.array([int(hx[i:i + 2], 16) / 255 for i in (1, 3, 5)], dtype=np.float32)  # noqa: E731 (stored sRGB bytes)
        t, b = raw(top), raw(bottom)
        y0 = h - (r + 1) * sh  # bottom-up rows
        ramp = np.linspace(0, 1, sh, dtype=np.float32)[:, None]  # 0 at the swatch's bottom row
        col = b * (1 - ramp) + t * ramp
        px[y0:y0 + sh, c * sw:(c + 1) * sw, :3] = col[:, None, :]
    out = bpy.data.images.new("tiffin_kitchen_palette", w, h, alpha=True)
    out.colorspace_settings.name = img.colorspace_settings.name
    out.pixels.foreach_set(px.ravel())
    out.pack()
    _kaykit_tex[img.name] = out
    return out


def import_kaykit(path: str, name: str):
    """Imports one KayKit glTF piece, scales it to our metres and returns the joined object (hidden template)."""
    objs = C.import_model(path)
    for root in objs:
        for o in [root, *root.children_recursive]:
            if o.type != "MESH":
                continue
            for m in o.data.materials:
                for n in (m.node_tree.nodes if m and m.node_tree else []):
                    if n.type == "TEX_IMAGE" and n.image and n.image.name != "tiffin_kitchen_palette":
                        n.image = kaykit_texture(n.image)
    meshes = [o for root in objs for o in [root, *root.children_recursive] if o.type == "MESH"]
    for o in meshes:
        mw = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = mw
    for root in objs:
        for o in [root, *root.children_recursive]:
            if o.type != "MESH" and o.name in bpy.data.objects:
                bpy.data.objects.remove(o, do_unlink=True)
    ob = join(meshes, name)
    ob.scale = (KAYKIT_SCALE,) * 3
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return ob


def instance(template, name: str, loc=(0, 0, 0), rz=0.0, collection=None):
    """A linked copy of a template object (shares its mesh)."""
    ob = template.copy()
    ob.name = name
    ob.location = loc
    ob.rotation_euler = (0, 0, rz)
    ob.hide_render = False
    ob.hide_viewport = False
    (collection or bpy.context.scene.collection).objects.link(ob)
    return ob


def to_collection(objs, name: str):
    col = bpy.data.collections.get(name) or bpy.data.collections.new(name)
    if col.name not in bpy.context.scene.collection.children:
        bpy.context.scene.collection.children.link(col)
    for o in objs:
        for c in list(o.users_collection):
            c.objects.unlink(o)
        col.objects.link(o)
    return col


def vec(x, y, z):
    return Vector((x, y, z))
