"""
Tiffin Tornado: the food and the small things chefs carry, modelled in code (original, stylised, appetising).
Each builder returns ONE joined object standing on the origin (its base at z = 0), sized ~1.5× real life so it
reads from the sofa. Names match the game's item kinds (apps/web/src/games/tiffin/recipes.ts) plus a few
cooking states drawn on stations (tava_raw, tava_dosa, vada_raw, pot_veg, pot_sambar).
"""
from __future__ import annotations

import math

import bpy

from tt_common import bowl, box, cyl, join, mat, scatter, sphere, torus

S = 1.5  # food exaggeration


def katori(fill: str, r=0.078 * S, h=0.04 * S):
    """A small steel katori (side bowl) with a filling."""
    return bowl(r, h, material="steel", fill=fill, fill_level=0.8)


def tumbler(fill: str | None, froth=False):
    """A steel tumbler standing in its davara (the wide cup used to cool filter coffee)."""
    parts = bowl(0.085 * S, 0.035 * S, material="steel")
    t = cyl(0.045 * S, 0.12 * S, loc=(0, 0, 0.012 * S), material="steel", r2=0.05 * S, verts=28)
    parts.append(t)
    lip = torus(0.05 * S, 0.004 * S, loc=(0, 0, 0.132 * S), material="steel")
    parts.append(lip)
    if fill:
        bpy.ops.mesh.primitive_circle_add(radius=0.048 * S, vertices=28, fill_type="NGON", location=(0, 0, 0.122 * S))
        top = bpy.context.active_object
        top.data.materials.append(mat(fill))
        parts.append(top)
    if froth:
        parts.append(sphere(0.047 * S, loc=(0, 0, 0.122 * S), material="froth", scale=(1, 1, 0.45)))
    return parts


def banana_leaf(length=0.36 * S, width=0.27 * S, z=0.012):
    """A banana-leaf cut: a rounded rectangle with a darker midrib."""
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 0, z))
    leaf = bpy.context.active_object
    leaf.scale = (length, width, 1)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    b = leaf.modifiers.new("round", "BEVEL")
    b.affect = "VERTICES"
    b.width = width * 0.35
    b.segments = 6
    leaf.data.materials.append(mat("leaf"))
    rib = box((length * 0.9, 0.008, 0.004), loc=(0, 0, z + 0.002), material="leaf_light", bevel=0)
    return [leaf, rib]


def plate_base(dirty=False):
    """A steel thali with a banana leaf on it."""
    parts = []
    parts.append(cyl(0.2 * S, 0.012, material="steel", verts=48))
    parts.append(torus(0.2 * S, 0.008, loc=(0, 0, 0.014), material="steel", major=48))
    if dirty:
        r = scatter(4)
        for i in range(5):
            a = r() * 6.28
            parts.append(sphere(0.02 + r() * 0.02, loc=(math.cos(a) * 0.14 * r(), math.sin(a) * 0.14 * r(), 0.012), material="sambar", scale=(1.6, 1, 0.12)))
    else:
        parts += banana_leaf(z=0.014)
    return parts


# ---- the components -------------------------------------------------------------------------------------------


def half_disc(radius: float, thick: float, material: str, dome: float = 0.0):
    """A half-moon slab (a folded dosa), flat side along X, curved side towards +Y (away from the camera)."""
    import bmesh
    bpy.ops.mesh.primitive_cylinder_add(radius=radius, depth=thick, vertices=64, location=(0, 0, thick / 2))
    ob = bpy.context.active_object
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
    bmesh.ops.bisect_plane(bm, geom=geom, plane_co=(0, 0, 0), plane_no=(0, -1, 0), clear_outer=True)
    bmesh.ops.holes_fill(bm, edges=[e for e in bm.edges if e.is_boundary])
    for v in bm.verts:
        if v.co.z > thick * 0.5:
            d = math.hypot(v.co.x, v.co.y) / radius
            v.co.z += dome * (1 - d * d)
    bm.to_mesh(ob.data)
    bm.free()
    ob.location.y -= radius * 0.42  # centre the half-moon on the origin
    from tt_common import _finish
    return _finish(ob, material, bevel=0.006, segments=2)


def dosa():
    """A crisp golden dosa folded into a half moon, with brown lace spots and a darker crisp edge."""
    R = 0.15 * S
    parts = [half_disc(R, 0.022, "dosa", dome=0.03)]
    r = scatter(11)
    for i in range(26):
        a = r() * math.pi
        d = math.sqrt(r()) * R * 0.9
        x, y = math.cos(a) * d, math.sin(a) * d - R * 0.42
        parts.append(sphere(0.011 + r() * 0.012, loc=(x, y, 0.024 + 0.03 * (1 - (d / R) ** 2)), material="dosa_dark", scale=(1.5, 1, 0.22)))
    for i in range(18):  # crisp, darker rim
        a = math.pi * (i + 0.5) / 18
        parts.append(sphere(0.016, loc=(math.cos(a) * R * 0.97, math.sin(a) * R * 0.97 - R * 0.42, 0.014), material="dosa_dark", scale=(1.6, 1, 0.5)))
    return parts


def idli():
    parts = []
    for x in (-0.055 * S, 0.055 * S):
        parts.append(sphere(0.058 * S, loc=(x, 0, 0), material="idli", scale=(1, 1, 0.55), segs=28))
    return parts


def vada():
    parts = [torus(0.05 * S, 0.026 * S, loc=(-0.035 * S, 0, 0.026 * S), material="vada", scale=(1, 1, 0.8)),
             torus(0.05 * S, 0.026 * S, loc=(0.045 * S, 0.01, 0.045 * S), material="vada", scale=(1, 1, 0.8), rot=(0.35, -0.3, 0))]
    r = scatter(7)
    for i in range(10):
        a = r() * 6.28
        cx = -0.035 * S if i < 5 else 0.045 * S
        parts.append(sphere(0.006 * S, loc=(cx + math.cos(a) * 0.05 * S, math.sin(a) * 0.05 * S, 0.05 * S), material="vada_dark", scale=(1, 1, 0.5)))
    return parts


def chutney():
    parts = katori("chutney")
    r = scatter(3)
    for i in range(6):
        parts.append(sphere(0.004 * S, loc=((r() - 0.5) * 0.06, (r() - 0.5) * 0.06, 0.028 * S), material="black"))
    parts.append(box((0.02, 0.008, 0.004), loc=(0.01, 0.01, 0.029 * S), material="chilli", bevel=0.002))
    parts.append(sphere(0.012, loc=(-0.02, 0.0, 0.028 * S), material="chutney_green", scale=(1.4, 1, 0.3)))
    return parts


def sambar():
    parts = katori("sambar")
    r = scatter(5)
    for i in range(4):
        parts.append(box((0.018, 0.018, 0.01), loc=((r() - 0.5) * 0.07, (r() - 0.5) * 0.07, 0.028 * S), material="sambar_veg", bevel=0.004))
    parts.append(cyl(0.006, 0.05, loc=(0.0, -0.02, 0.028 * S), material="drumstick", rot=(0, math.pi / 2, 0.4)))
    return parts


# ---- raw things -----------------------------------------------------------------------------------------------


def batter():
    return bowl(0.12 * S, 0.06 * S, material="steel", fill="batter", fill_level=0.82)


def dough():
    parts = bowl(0.11 * S, 0.05 * S, material="steel")
    parts.append(sphere(0.085 * S, loc=(0, 0, 0.05 * S), material="dough", scale=(1, 1, 0.5)))
    return parts


def coconut():
    whole = sphere(0.075 * S, loc=(0.03 * S, 0.02, 0.07 * S), material="coconut", scale=(1, 1, 0.9))
    half = bowl(0.07 * S, 0.06 * S, material="coconut", fill="coconut_white", fill_level=0.92, thickness=0.01)
    for o in half:
        o.location.x -= 0.06 * S
        o.location.y -= 0.03
    return [whole, *half]


def veg():
    parts = [cyl(0.03 * S, 0.16 * S, loc=(0.02, 0.04, 0.03 * S), material="carrot", r2=0.004, rot=(0, math.pi / 2, 0.3))]
    for i, y in enumerate((-0.03, 0.0)):
        parts.append(cyl(0.012 * S, 0.3 * S, loc=(-0.12 * S, y, 0.015 * S + i * 0.012), material="drumstick", rot=(0, math.pi / 2, 0.1 * i)))
    parts.append(sphere(0.04 * S, loc=(-0.05, -0.06, 0.04 * S), material="onion", scale=(1, 1, 0.95)))
    parts.append(cyl(0.008 * S, 0.1 * S, loc=(0.03, -0.07, 0.01 * S), material="chilli", r2=0.002, rot=(0, math.pi / 2, -0.5)))
    return parts


def cutveg():
    parts = bowl(0.1 * S, 0.035 * S, material="steel")
    r = scatter(9)
    for i in range(14):
        m = ("carrot", "drumstick", "onion")[i % 3]
        a, d = r() * 6.28, r() * 0.06 * S
        parts.append(box((0.022, 0.022, 0.016), loc=(math.cos(a) * d, math.sin(a) * d, 0.03 * S + r() * 0.01), material=m, bevel=0.005, rot=(r(), r(), r())))
    return parts


def burnt():
    r = scatter(13)
    parts = [sphere(0.1 * S, loc=(0, 0, 0.03 * S), material="burnt", scale=(1.3, 1, 0.45))]
    for i in range(5):
        a = r() * 6.28
        parts.append(sphere(0.04 * S, loc=(math.cos(a) * 0.08, math.sin(a) * 0.06, 0.04 * S), material="burnt", scale=(1, 1, 0.7)))
    return parts


# ---- cooking states drawn on stations ------------------------------------------------------------------------


def tava_raw():
    """Batter just poured on the tava: a pale, slightly glossy disc."""
    return [cyl(0.23 * S * 0.75, 0.006, material="batter", verts=40)]


def tava_dosa():
    """A dosa crisping on the tava: golden with brown lace."""
    parts = [cyl(0.24 * S * 0.75, 0.006, material="dosa", verts=40)]
    r = scatter(21)
    for i in range(22):
        a, d = r() * 6.28, math.sqrt(r()) * 0.16 * S * 0.75
        parts.append(sphere(0.015 + r() * 0.012, loc=(math.cos(a) * d, math.sin(a) * d, 0.006), material="dosa_dark", scale=(1.3, 1, 0.12)))
    return parts


def vada_raw():
    return [torus(0.05 * S, 0.026 * S, loc=(0, 0, 0.02), material="dough", scale=(1, 1, 0.8))]


def pot_fill(kind: str):
    """The surface inside the sambar pot: chopped veg in water, or a full pot of sambar."""
    parts = [cyl(0.2, 0.01, material="water" if kind == "veg" else "sambar", verts=40)]
    r = scatter(17)
    for i in range(10 if kind == "veg" else 6):
        a, d = r() * 6.28, r() * 0.15
        parts.append(box((0.03, 0.03, 0.02), loc=(math.cos(a) * d, math.sin(a) * d, 0.01), material=("carrot", "drumstick", "onion")[i % 3], bevel=0.006, rot=(r(), r(), r())))
    return parts


BUILDERS = {
    "dosa": dosa, "idli": idli, "vada": vada, "chutney": chutney, "sambar": sambar,
    "batter": batter, "dough": dough, "coconut": coconut, "veg": veg, "cutveg": cutveg,
    "cup": lambda: tumbler(None), "coffee": lambda: tumbler("coffee", froth=True), "water": lambda: tumbler("water"),
    "burnt": burnt, "plate": lambda: plate_base(False), "dirty": lambda: plate_base(True),
    "tava_raw": tava_raw, "tava_dosa": tava_dosa, "vada_raw": vada_raw,
    "pot_veg": lambda: pot_fill("veg"), "pot_sambar": lambda: pot_fill("sambar"),
}


def build(name: str):
    """Builds one item as a single object named `name`, base on the origin."""
    parts = BUILDERS[name]()
    ob = join(parts, name)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    xs = [v.co.x for v in ob.data.vertices]
    ys = [v.co.y for v in ob.data.vertices]
    lo = min(v.co.z for v in ob.data.vertices)
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    for v in ob.data.vertices:
        v.co.x -= cx
        v.co.y -= cy
        v.co.z -= lo
    ob.location = (0, 0, 0)
    return ob
