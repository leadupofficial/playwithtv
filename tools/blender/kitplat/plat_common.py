"""
kitplat (side-view platformer kit) Blender helpers: build simple original models from primitives, light them like a
pre-rendered 1990s console platformer (warm key, cool fill, strong rim), render side-view animation frames with a
fixed orthographic camera and pack them into named-sprite atlases for apps/web/src/games/kitplat.

Atlas manifest ("pwtv-plat" v1), written next to <name>.webp and <name>-lite.webp (half size, for 1 GB TVs):
  { format, version, name, image, lite, size {w,h}, ppm (atlas pixels per metre = per tile),
    sprites: { <id>: { frames: [{x,y,w,h}], pivot {x,y} (cell fractions, top-left origin), fps, loop } } }

World units: 1 Blender metre = 1 game tile. The camera looks along +Y (screen right = +X, up = +Z).
"""
from __future__ import annotations

import json
import math
import os
import sys
import tempfile
import time

import bpy
import numpy as np
from mathutils import Euler, Vector

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import pwtv_atlas as atlas  # noqa: E402

T0 = time.time()


def log(*parts) -> None:
    print(f"[kitplat {time.time() - T0:5.0f}s]", *parts, flush=True)


def argv() -> list[str]:
    return sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def reset() -> bpy.types.Scene:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    return bpy.context.scene


# ---------------------------------------------------------------------------------------------------------------
# materials


def lin(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def rgba(hexc: str, a: float = 1.0) -> tuple[float, float, float, float]:
    h = hexc.lstrip("#")
    return (lin(int(h[0:2], 16) / 255), lin(int(h[2:4], 16) / 255), lin(int(h[4:6], 16) / 255), a)


_mats: dict[str, bpy.types.Material] = {}


def mat(hexc: str, rough: float = 0.55, metal: float = 0.0, emit: float = 0.0, sheen: float = 0.0, coat: float = 0.0,
        bump: float = 0.0, bump_scale: float = 18.0, vary: float = 0.0, alpha: float = 1.0) -> bpy.types.Material:
    """A cached Principled material. `bump` adds fine noise relief (fur, clay, stone); `vary` mottles the colour."""
    key = f"{hexc}|{rough}|{metal}|{emit}|{sheen}|{coat}|{bump}|{bump_scale}|{vary}|{alpha}"
    if key in _mats:
        return _mats[key]
    m = bpy.data.materials.new(f"m{len(_mats)}_{hexc}")
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = rgba(hexc)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if sheen:
        b.inputs["Sheen Weight"].default_value = sheen
        b.inputs["Sheen Roughness"].default_value = 0.4
    if coat:
        b.inputs["Coat Weight"].default_value = coat
        b.inputs["Coat Roughness"].default_value = 0.1
    if emit:
        b.inputs["Emission Color"].default_value = rgba(hexc)
        b.inputs["Emission Strength"].default_value = emit
    if alpha < 1:
        b.inputs["Alpha"].default_value = alpha
        try:
            m.surface_render_method = "BLENDED"  # EEVEE: smooth glass instead of dithered noise
        except AttributeError:
            m.blend_method = "BLEND"
    if bump or vary:
        tc = nt.nodes.new("ShaderNodeTexCoord")
        nz = nt.nodes.new("ShaderNodeTexNoise")
        nz.inputs["Scale"].default_value = bump_scale
        nz.inputs["Detail"].default_value = 6
        nt.links.new(tc.outputs["Object"], nz.inputs["Vector"])
        if bump:
            bp = nt.nodes.new("ShaderNodeBump")
            bp.inputs["Strength"].default_value = bump
            bp.inputs["Distance"].default_value = 0.02
            nt.links.new(nz.outputs["Fac"], bp.inputs["Height"])
            nt.links.new(bp.outputs["Normal"], b.inputs["Normal"])
        if vary:
            mix = nt.nodes.new("ShaderNodeMix")
            mix.data_type = "RGBA"
            mix.blend_type = "MULTIPLY"
            mr = nt.nodes.new("ShaderNodeMapRange")
            mr.inputs["To Min"].default_value = 1 - vary
            mr.inputs["To Max"].default_value = 1 + vary * 0.5
            nt.links.new(nz.outputs["Fac"], mr.inputs["Value"])
            mix.inputs["Factor"].default_value = 1.0
            mix.inputs[6].default_value = rgba(hexc)
            comb = nt.nodes.new("ShaderNodeCombineColor")
            for i in range(3):
                nt.links.new(mr.outputs["Result"], comb.inputs[i])
            nt.links.new(comb.outputs["Color"], mix.inputs[7])
            nt.links.new(mix.outputs[2], b.inputs["Base Color"])
    _mats[key] = m
    return m


# ---------------------------------------------------------------------------------------------------------------
# primitives (all return the new object; `loc` in metres, `rot` in degrees)


def _finish(ob, m, loc, rot, scale, smooth=True, bevel=0.0, subsurf=0):
    ob.location = loc
    ob.rotation_euler = Euler([math.radians(r) for r in rot])
    ob.scale = scale
    if m is not None:
        ob.data.materials.append(m)
    if bevel:
        bv = ob.modifiers.new("bevel", "BEVEL")
        bv.width = bevel
        bv.segments = 3
        bv.limit_method = "ANGLE"
    if subsurf:
        ss = ob.modifiers.new("subsurf", "SUBSURF")
        ss.levels = ss.render_levels = subsurf
    if smooth and ob.type == "MESH":
        for p in ob.data.polygons:
            p.use_smooth = True
    return ob


def sphere(m, loc=(0, 0, 0), scale=(1, 1, 1), rot=(0, 0, 0), r=0.5, seg=24):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, segments=seg, ring_count=max(8, seg // 2))
    return _finish(bpy.context.active_object, m, loc, rot, scale)


def cyl(m, loc=(0, 0, 0), r=0.1, depth=1.0, rot=(0, 0, 0), scale=(1, 1, 1), verts=20, bevel=0.0):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=depth, vertices=verts)
    return _finish(bpy.context.active_object, m, loc, rot, scale, bevel=bevel)


def cone(m, loc=(0, 0, 0), r1=0.2, r2=0.0, depth=0.5, rot=(0, 0, 0), scale=(1, 1, 1), verts=20):
    bpy.ops.mesh.primitive_cone_add(radius1=r1, radius2=r2, depth=depth, vertices=verts)
    return _finish(bpy.context.active_object, m, loc, rot, scale)


def box(m, loc=(0, 0, 0), size=(1, 1, 1), rot=(0, 0, 0), bevel=0.04, smooth=False):
    bpy.ops.mesh.primitive_cube_add(size=1)
    ob = _finish(bpy.context.active_object, m, loc, rot, size, smooth=smooth, bevel=bevel)
    return ob


def torus(m, loc=(0, 0, 0), R=0.3, r=0.06, rot=(0, 0, 0), scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, major_segments=32, minor_segments=12)
    return _finish(bpy.context.active_object, m, loc, rot, scale)


def capsule(m, a, b, r=0.08, r2=None, seg=16):
    """A rounded limb from point a to point b (radius r at a, r2 at b): a cylinder with sphere caps."""
    a, b = Vector(a), Vector(b)
    r2 = r if r2 is None else r2
    d = b - a
    bpy.ops.mesh.primitive_cone_add(radius1=r, radius2=r2, depth=d.length, vertices=seg)
    ob = bpy.context.active_object
    ob.location = (a + b) / 2
    ob.rotation_euler = d.to_track_quat("Z", "Y").to_euler()
    ob.data.materials.append(m)
    for p in ob.data.polygons:
        p.use_smooth = True
    c1 = sphere(m, tuple(a), r=r, seg=seg)
    c2 = sphere(m, tuple(b), r=r2, seg=seg)
    return join([ob, c1, c2])


def join(objs):
    objs = [o for o in objs if o is not None]
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    for o in objs:  # apply modifiers so joins keep bevels
        bpy.context.view_layer.objects.active = o
        for md in list(o.modifiers):
            try:
                bpy.ops.object.modifier_apply(modifier=md.name)
            except RuntimeError:
                pass
    bpy.context.view_layer.objects.active = objs[0]
    for o in objs:
        o.select_set(True)
    if len(objs) > 1:
        bpy.ops.object.join()
    return bpy.context.active_object


# ---------------------------------------------------------------------------------------------------------------
# joints: a rig of empties with rigid parts (a vinyl-toy look; no skinning, so poses are exact and scriptable)


def joint(name: str, parent=None, loc=(0, 0, 0)):
    e = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(e)
    e.empty_display_size = 0.05
    if parent is not None:
        e.parent = parent
    e.location = loc
    e.rotation_mode = "XYZ"
    return e


def attach(ob, parent):
    """Parents `ob` to `parent`, keeping its current world placement."""
    bpy.context.view_layer.update()
    mw = ob.matrix_world.copy()
    ob.parent = parent
    ob.matrix_world = mw
    return ob


def pose(j, rot=(0, 0, 0), loc=None, scale=None):
    j.rotation_euler = Euler([math.radians(r) for r in rot])
    if loc is not None:
        j.location = loc
    if scale is not None:
        j.scale = scale


# ---------------------------------------------------------------------------------------------------------------
# camera, lights, render


LOOKS = {
    # key colour/strength, fill, rim, world colour: one per world so sprites sit in their backdrops
    "monsoon": dict(key=("#fff1dc", 4.6), fill=("#9fc3ff", 1.3), rim=("#cfeaff", 9.0), world=("#6a7d90", 1.0)),
    "festival": dict(key=("#ffe2b8", 4.6), fill=("#b48cff", 1.4), rim=("#ffbf6a", 9.0), world=("#5e4c7a", 1.0)),
    "stepwell": dict(key=("#ffe6c2", 4.6), fill=("#7fb6c9", 1.3), rim=("#ffd27a", 9.0), world=("#6a5d50", 1.0)),
}


def world(hexc: str, strength: float):
    w = bpy.data.worlds.new("w")
    bpy.context.scene.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = rgba(hexc)
    bg.inputs["Strength"].default_value = strength


def sun(name, color, energy, direction, shadow=True, angle=8.0):
    """A sun light shining along `direction` (x right, y away from the camera, z up)."""
    d = bpy.data.lights.new(name, "SUN")
    d.energy = energy
    d.color = rgba(color)[:3]
    d.use_shadow = shadow
    d.angle = math.radians(angle)
    ob = bpy.data.objects.new(name, d)
    bpy.context.scene.collection.objects.link(ob)
    ob.rotation_euler = Vector(direction).normalized().to_track_quat("-Z", "Y").to_euler()
    return ob


def light_rig(look: str = "monsoon", rim_scale: float = 1.0, key_scale: float = 1.0):
    """Sun lights only, so every position is lit the same (tiles and backdrops repeat seamlessly)."""
    L = LOOKS[look]
    world(*L["world"])
    sun("key", L["key"][0], L["key"][1] * key_scale, (0.55, 0.55, -0.65))          # front-left, high
    sun("fill", L["fill"][0], L["fill"][1], (-0.7, 0.65, -0.2), shadow=False)       # front-right, low
    sun("rim", L["rim"][0], L["rim"][1] * rim_scale, (-0.6, -0.55, -0.45), shadow=False)  # behind-right
    sun("rim2", L["rim"][0], L["rim"][1] * rim_scale * 0.6, (0.6, -0.55, -0.45), shadow=False)  # behind-left


def side_camera(center=(0, 0, 0), ortho=2.0, elevation=6.0, aspect=1.0):
    cam_d = bpy.data.cameras.new("cam")
    cam_d.type = "ORTHO"
    cam_d.ortho_scale = ortho
    cam_d.clip_start, cam_d.clip_end = 0.1, 200
    cam = bpy.data.objects.new("cam", cam_d)
    bpy.context.scene.collection.objects.link(cam)
    el = math.radians(elevation)
    dist = 40
    cx, cy, cz = center
    cam.location = (cx, cy - dist * math.cos(el), cz + dist * math.sin(el))
    cam.rotation_euler = Euler((math.pi / 2 - el, 0, 0))
    bpy.context.scene.camera = cam
    return cam


def setup(width: int, height: int, samples: int = 24, transparent: bool = True, engine: str = "eevee"):
    s = bpy.context.scene
    r = s.render
    r.resolution_x, r.resolution_y, r.resolution_percentage = width, height, 100
    r.film_transparent = transparent
    if engine == "cycles":
        r.engine = "CYCLES"
        prefs = bpy.context.preferences.addons["cycles"].preferences
        try:
            prefs.compute_device_type = "METAL"
            prefs.get_devices()
            for d in prefs.devices:
                d.use = d.type == "METAL"
            s.cycles.device = "GPU"
        except Exception:
            s.cycles.device = "CPU"
        s.cycles.samples = samples
        s.cycles.use_denoising = True
        s.cycles.denoiser = "OPENIMAGEDENOISE"
    else:
        r.engine = "BLENDER_EEVEE"
        s.eevee.taa_render_samples = samples
        s.eevee.use_shadows = True
        try:
            s.eevee.use_raytracing = True
            s.eevee.use_fast_gi = True
        except AttributeError:
            pass
    s.view_settings.view_transform = "AgX"
    try:
        s.view_settings.look = "AgX - Punchy"
    except TypeError:
        pass
    im = r.image_settings
    im.file_format = "PNG"
    im.color_mode = "RGBA" if transparent else "RGB"
    im.color_depth = "8"


_tmp = tempfile.mkdtemp(prefix="kitplat_")
_n = 0


def render_rgba() -> np.ndarray:
    """Renders the scene and returns the frame as an (h, w, 4) top-down float array."""
    global _n
    _n += 1
    p = os.path.join(_tmp, f"f{_n:05d}.png")
    bpy.context.scene.render.filepath = p
    bpy.ops.render.render(write_still=True)
    return atlas.load_rgba(p)


def project(cam, pt) -> tuple[float, float]:
    """A world point in render pixels (top-left origin)."""
    from bpy_extras.object_utils import world_to_camera_view
    bpy.context.view_layer.update()  # the camera's matrix_world is stale right after moving it
    s = bpy.context.scene
    u = world_to_camera_view(s, cam, Vector(pt))
    return u.x * s.render.resolution_x, (1 - u.y) * s.render.resolution_y


# ---------------------------------------------------------------------------------------------------------------
# packing


class Sheet:
    """Collects named sprites (each a list of frames cropped to one shared box) and packs them into one atlas."""

    def __init__(self, name: str, ppm: float):
        self.name, self.ppm = name, ppm
        self.sprites: list[dict] = []

    def add(self, sid: str, frames: list[np.ndarray], pivot_px: tuple[float, float], fps: float = 10, loop: bool = True,
            pad: int = 3, crop: bool = True, box: list[float] | None = None, ppm: float | None = None):
        frames = [atlas.clean_alpha(f, 4 / 255) for f in frames]
        if crop:
            x0, y0, x1, y1 = atlas.union_bbox(frames, pad=pad)
        else:
            x0, y0, x1, y1 = 0, 0, frames[0].shape[1], frames[0].shape[0]
        cells = [np.ascontiguousarray(f[y0:y1, x0:x1]) for f in frames]
        w, h = x1 - x0, y1 - y0
        self.sprites.append(dict(id=sid, cells=cells, w=w, h=h, fps=fps, loop=loop, box=box, ppm=ppm,
                                 pivot=(round((pivot_px[0] - x0) / w, 4), round((pivot_px[1] - y0) / h, 4))))
        log(f"  {sid}: {len(frames)} x {w}x{h}")

    def pack(self, max_w: int = 2048, gap: int = 2):
        """Shelf packing, tallest sprites first; frames of one sprite stay in reading order."""
        cells = [(s, i, c) for s in self.sprites for i, c in enumerate(s["cells"])]
        order = sorted(range(len(cells)), key=lambda k: (-cells[k][0]["h"], k))
        x = y = shelf = 0
        width = 0
        place = {}
        for k in order:
            s, i, c = cells[k]
            w, h = s["w"], s["h"]
            if x + w > max_w:
                x, y, shelf = 0, y + shelf + gap, 0
            place[k] = (x, y)
            x += w + gap
            shelf = max(shelf, h)
            width = max(width, x)
        height = y + shelf
        W = int(math.ceil(width / 4) * 4)
        H = int(math.ceil(height / 4) * 4)
        sheet = np.zeros((H, W, 4), np.float32)
        for k, (px, py) in place.items():
            s, i, c = cells[k]
            sheet[py:py + s["h"], px:px + s["w"]] = c
            s.setdefault("rects", {})[i] = {"x": px, "y": py, "w": s["w"], "h": s["h"]}
        return sheet

    def save(self, out_dir: str, max_w: int = 2048, quality: int = 82, preview: str | None = None):
        sheet = self.pack(max_w)
        os.makedirs(out_dir, exist_ok=True)
        if preview:
            atlas.save_rgba(atlas.preview(sheet), preview, "PNG")
        full = atlas.bleed_edges(sheet)
        atlas.save_rgba(full, os.path.join(out_dir, f"{self.name}.webp"), "WEBP", quality)
        # a half-size copy for 1 GB TVs, only when the atlas is over their 1536 px cap
        big = max(sheet.shape[0], sheet.shape[1]) > 1536
        lite_path = os.path.join(out_dir, f"{self.name}-lite.webp")
        if big:
            atlas.save_rgba(atlas.bleed_edges(half(sheet)), lite_path, "WEBP", quality)
        elif os.path.exists(lite_path):
            os.remove(lite_path)
        man = {
            "format": "pwtv-plat", "version": 1, "name": self.name, "image": f"{self.name}.webp", "lite": f"{self.name}-lite.webp" if big else None,
            "size": {"w": int(sheet.shape[1]), "h": int(sheet.shape[0])}, "ppm": self.ppm,
            "sprites": {s["id"]: {"frames": [s["rects"][i] for i in range(len(s["cells"]))], "pivot": {"x": s["pivot"][0], "y": s["pivot"][1]},
                                  "fps": s["fps"], "loop": s["loop"], **({"box": s["box"]} if s["box"] else {}),
                                  **({"ppm": s["ppm"]} if s["ppm"] else {})} for s in self.sprites},
        }
        with open(os.path.join(out_dir, f"{self.name}.json"), "w") as fh:
            json.dump(man, fh, separators=(",", ":"))
        log(f"{self.name}: atlas {sheet.shape[1]}x{sheet.shape[0]}{' + half-size lite copy' if big else ''}, {len(self.sprites)} sprites")


def half(a: np.ndarray) -> np.ndarray:
    """2x box downscale with premultiplied alpha (no dark fringes)."""
    h, w = a.shape[0] // 2 * 2, a.shape[1] // 2 * 2
    a = a[:h, :w]
    pm = a.copy()
    pm[:, :, :3] *= pm[:, :, 3:4]
    q = (pm[0::2, 0::2] + pm[1::2, 0::2] + pm[0::2, 1::2] + pm[1::2, 1::2]) / 4
    out = q.copy()
    al = np.maximum(q[:, :, 3:4], 1e-6)
    out[:, :, :3] = np.where(q[:, :, 3:4] > 0, q[:, :, :3] / al, 0)
    return out


def bake(ob):
    """Applies an object's transform into its mesh (origin at the world origin), so Object texture coordinates are
    world coordinates and periodic materials line up across separate objects."""
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return ob


def clear_scene_objects(keep=("key", "fill", "rim", "rim2", "cam")):
    for ob in list(bpy.data.objects):
        if ob.name not in keep:
            bpy.data.objects.remove(ob, do_unlink=True)


def save_still(arr: np.ndarray, path: str, quality: int = 80):
    atlas.save_rgba(arr, path, "WEBP", quality)
