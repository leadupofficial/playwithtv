"""
Shared helpers for the Play With TV Blender pipeline (Blender 5.x, headless).

Every script runs as   blender -b --factory-startup -P tools/blender/<script>.py -- <args>
and imports this module from its own folder. Nothing here touches the network.

What lives here:
  - argument parsing for the part after `--`;
  - an empty scene, model import (GLB/glTF/FBX/OBJ/.blend), bounds and centring;
  - the render setup: Cycles on the Apple GPU (Metal) with OpenImageDenoise, or EEVEE; AgX view transform;
  - HDRI worlds and three lighting presets (studio, monsoon, sunset) with key, fill and rim area lights;
  - the "premium" material pass (clear coat on paint, glossier glass, slightly rougher rubber);
  - a shadow-catcher floor, so sprites and transparent stills carry their own soft contact shadow.
"""
from __future__ import annotations

import argparse
import math
import os
import sys

import bpy
from mathutils import Vector


# ---------------------------------------------------------------------------------------------------------------
# arguments


def parse(parser: argparse.ArgumentParser) -> argparse.Namespace:
    """Parses only the arguments after Blender's `--` separator."""
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    return parser.parse_args(argv)


def log(*parts) -> None:
    print("[pwtv]", *parts, flush=True)


# ---------------------------------------------------------------------------------------------------------------
# scene and model


def empty_scene() -> bpy.types.Scene:
    """Deletes everything in the default scene (cube, light, camera)."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    return bpy.context.scene


def import_model(path: str) -> list[bpy.types.Object]:
    """Imports a model and returns its new top-level objects. Unsupported formats raise."""
    path = os.path.abspath(path)
    before = set(bpy.data.objects)
    ext = os.path.splitext(path)[1].lower()
    if ext in (".glb", ".gltf"):
        bpy.ops.import_scene.gltf(filepath=path)
    elif ext == ".fbx":
        bpy.ops.import_scene.fbx(filepath=path)
    elif ext == ".obj":
        bpy.ops.wm.obj_import(filepath=path)
    elif ext == ".blend":
        with bpy.data.libraries.load(path, link=False) as (src, dst):
            dst.objects = list(src.objects)
        for ob in dst.objects:
            if ob is not None and ob.type not in ("CAMERA", "LIGHT"):
                bpy.context.scene.collection.objects.link(ob)
    else:
        raise SystemExit(f"unsupported model format: {ext}")
    new = [o for o in bpy.data.objects if o not in before and o.name in bpy.context.scene.objects]
    if not new:
        raise SystemExit(f"nothing imported from {path}")
    return [o for o in new if o.parent is None or o.parent not in new]


def world_bounds(objs: list[bpy.types.Object]) -> tuple[Vector, Vector]:
    """Axis-aligned world bounds of every mesh under the given objects."""
    lo = Vector((math.inf,) * 3)
    hi = Vector((-math.inf,) * 3)
    bpy.context.view_layer.update()
    for root in objs:
        for ob in [root, *root.children_recursive]:
            if ob.type != "MESH":
                continue
            for c in ob.bound_box:
                w = ob.matrix_world @ Vector(c)
                lo = Vector(map(min, lo, w))
                hi = Vector(map(max, hi, w))
    if lo.x == math.inf:
        raise SystemExit("the model has no meshes")
    return lo, hi


def pivot_root(objs: list[bpy.types.Object], scale_to: float | None = None) -> bpy.types.Object:
    """
    Parents the model under one empty placed at its ground centre (bottom of the bounds), moves that to the origin
    and optionally scales so the longest horizontal side is `scale_to` metres. Turning the empty turns the model
    about its own centre, which is what direction sprites need.
    """
    lo, hi = world_bounds(objs)
    centre = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
    root = bpy.data.objects.new("pwtv_root", None)
    bpy.context.scene.collection.objects.link(root)
    root.location = centre
    bpy.context.view_layer.update()
    for ob in objs:
        mw = ob.matrix_world.copy()
        ob.parent = root
        ob.matrix_world = mw
    root.location = (0, 0, 0)
    if scale_to:
        side = max(hi.x - lo.x, hi.y - lo.y)
        root.scale = (scale_to / side,) * 3
    bpy.context.view_layer.update()
    return root


# ---------------------------------------------------------------------------------------------------------------
# render settings


def setup_render(engine: str, samples: int, width: int, height: int, transparent: bool, look: str = "AgX - Medium High Contrast") -> None:
    """Cycles on the Metal GPU (falls back to CPU) with OpenImageDenoise, or EEVEE; AgX; 8-bit RGBA PNG."""
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
            gpus = [d for d in prefs.devices if d.type == "METAL"]
            for d in prefs.devices:
                d.use = d.type == "METAL"
            s.cycles.device = "GPU" if gpus else "CPU"
        except Exception:  # no Metal (CI, Linux): CPU still works, just slower
            s.cycles.device = "CPU"
        s.cycles.samples = samples
        s.cycles.use_adaptive_sampling = True
        s.cycles.use_denoising = True
        s.cycles.denoiser = "OPENIMAGEDENOISE"
        if hasattr(s.cycles, "denoising_use_gpu"):
            s.cycles.denoising_use_gpu = True
        s.cycles.max_bounces = 8
        s.cycles.caustics_reflective = s.cycles.caustics_refractive = False
        s.cycles.sample_clamp_indirect = 10.0  # no fireflies from the HDRI's hot spots
        log("cycles device:", s.cycles.device)
    else:
        r.engine = "BLENDER_EEVEE"
        s.eevee.taa_render_samples = samples
        s.eevee.use_raytracing = True
        s.eevee.use_shadows = True
        s.eevee.use_fast_gi = True
    s.view_settings.view_transform = "AgX"
    try:
        s.view_settings.look = look
    except TypeError:
        log("look not found, using AgX base:", look)
    im = r.image_settings
    im.media_type = "IMAGE"
    im.file_format = "PNG"
    im.color_mode = "RGBA" if transparent else "RGB"
    im.color_depth = "8"
    im.compression = 30


def render_to(path: str) -> None:
    bpy.context.scene.render.filepath = os.path.abspath(path)
    bpy.ops.render.render(write_still=True)


# ---------------------------------------------------------------------------------------------------------------
# lighting


PRESETS = {
    # key (warm, soft, front-left above), fill (cool, weak), rim (behind, strong): premium "car advert" lighting
    "studio": dict(hdri_strength=0.35, hdri_rot=0.0, key=(900, (1.0, 0.95, 0.88)), fill=(220, (0.80, 0.88, 1.0)),
                   rim=(1300, (0.85, 0.92, 1.0)), sky_tint=(1, 1, 1)),
    # Western Ghats monsoon: grey-green overcast, cool wet rim, little direct sun
    "monsoon": dict(hdri_strength=0.9, hdri_rot=1.2, key=(380, (0.86, 0.92, 1.0)), fill=(140, (0.70, 0.85, 0.80)),
                    rim=(1500, (0.62, 0.80, 1.0)), sky_tint=(0.86, 0.95, 0.94)),
    # golden hour: low orange key, purple fill, hot rim
    "sunset": dict(hdri_strength=0.45, hdri_rot=2.4, key=(1100, (1.0, 0.66, 0.38)), fill=(160, (0.55, 0.45, 0.95)),
                   rim=(1700, (1.0, 0.55, 0.30)), sky_tint=(1.0, 0.85, 0.75)),
}


def world_hdri(hdri: str | None, strength: float, rotation: float, tint=(1, 1, 1)) -> None:
    """An HDRI world (or a soft grey gradient when no file is given), rotated about Z."""
    w = bpy.data.worlds.new("pwtv_world")
    bpy.context.scene.world = w
    w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputWorld")
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.inputs["Strength"].default_value = strength
    nt.links.new(bg.outputs["Background"], out.inputs["Surface"])
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.blend_type = "MULTIPLY"
    mix.inputs["Factor"].default_value = 1.0
    mix.inputs[7].default_value = (*tint, 1.0)  # B (colour)
    nt.links.new(mix.outputs[2], bg.inputs["Color"])
    if hdri:
        env = nt.nodes.new("ShaderNodeTexEnvironment")
        env.image = bpy.data.images.load(os.path.abspath(hdri), check_existing=True)
        coord = nt.nodes.new("ShaderNodeTexCoord")
        mapping = nt.nodes.new("ShaderNodeMapping")
        mapping.inputs["Rotation"].default_value = (0, 0, rotation)
        nt.links.new(coord.outputs["Generated"], mapping.inputs["Vector"])
        nt.links.new(mapping.outputs["Vector"], env.inputs["Vector"])
        nt.links.new(env.outputs["Color"], mix.inputs[6])
    else:
        sky = nt.nodes.new("ShaderNodeTexGradient")
        ramp = nt.nodes.new("ShaderNodeValToRGB")
        ramp.color_ramp.elements[0].color = (0.05, 0.06, 0.08, 1)
        ramp.color_ramp.elements[1].color = (0.55, 0.6, 0.68, 1)
        nt.links.new(sky.outputs["Fac"], ramp.inputs["Fac"])
        nt.links.new(ramp.outputs["Color"], mix.inputs[6])


def area_light(name: str, power: float, color, size: float, loc, target=(0, 0, 0.4), shadow: bool = True) -> bpy.types.Object:
    data = bpy.data.lights.new(name, "AREA")
    data.use_shadow = shadow  # only the key throws a floor shadow: one compact contact shadow per sprite
    data.energy = power
    data.color = color
    data.size = size
    data.shape = "DISK"
    ob = bpy.data.objects.new(name, data)
    ob.visible_camera = False  # lights the subject and shows in reflections, never as a disc in frame
    bpy.context.scene.collection.objects.link(ob)
    ob.location = loc
    look_at(ob, Vector(target))
    return ob


def look_at(ob: bpy.types.Object, target: Vector) -> None:
    d = target - ob.location
    ob.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


def light_rig(preset: str, hdri: str | None, size: float, cam_yaw: float = 0.0) -> None:
    """
    World HDRI plus three area lights placed relative to the camera's yaw, scaled to the subject size (metres).
    The rig stays fixed while the model turns, so every direction sprite is lit like one consistent world.
    """
    p = PRESETS[preset]
    world_hdri(hdri, p["hdri_strength"], p["hdri_rot"], p["sky_tint"])
    k = size  # distances scale with the model so a 0.5 m scooter and a 5 m bus light the same

    def at(az: float, dist: float, h: float):
        a = cam_yaw + az
        return (math.sin(a) * dist * k, -math.cos(a) * dist * k, h * k)

    e = LIGHT_SCALE * k * k  # inverse-square: watts grow with the square of the rig's size
    area_light("key", p["key"][0] * e, p["key"][1], 1.2 * k, at(-0.6, 1.3, 2.8), (0, 0, 0.3 * k))
    fill = area_light("fill", p["fill"][0] * e, p["fill"][1], 2.4 * k, at(1.2, 2.5, 0.9), (0, 0, 0.3 * k), shadow=False)
    fill.visible_glossy = False  # a fill lifts shadows; it must not show up as a disc in wet roads or paint
    area_light("rim", p["rim"][0] * e, p["rim"][1], 1.0 * k, at(math.pi - 0.5, 2.0, 1.4), (0, 0, 0.4 * k), shadow=False)


LIGHT_SCALE = 0.12  # preset watts are relative; this calibrates them to a 1 m subject under AgX


def shadow_catcher(size: float) -> bpy.types.Object:
    """A floor that renders only the shadows and occlusion falling on it (Cycles); invisible in EEVEE stills."""
    bpy.ops.mesh.primitive_plane_add(size=size * 8)
    ob = bpy.context.active_object
    ob.name = "pwtv_floor"
    ob.is_shadow_catcher = True
    return ob


# ---------------------------------------------------------------------------------------------------------------
# materials


def _principled(mat: bpy.types.Material):
    if not mat or not mat.node_tree:
        return None
    for n in mat.node_tree.nodes:
        if n.type == "BSDF_PRINCIPLED":
            return n
    return None


def premium_materials(objs: list[bpy.types.Object], wet: bool = False, glass_from_palette: bool = False) -> None:
    """
    Upgrades flat low-poly materials to look like painted metal, glass and rubber without new textures: clear coat
    on bright (paint) colours, glossy dark (glass, trim) parts, and an optional "wet" pass for monsoon scenes.
    Works per material, so palette-texture models (Kenney, KayKit) get a uniform lacquer.
    """
    seen = set()
    for root in objs:
        for ob in [root, *root.children_recursive]:
            if ob.type != "MESH":
                continue
            for slot in ob.material_slots:
                m = slot.material
                if not m or m.name in seen:
                    continue
                seen.add(m.name)
                b = _principled(m)
                if not b:
                    continue
                b.inputs["Roughness"].default_value = 0.22 if wet else 0.38
                b.inputs["Coat Weight"].default_value = 0.7 if wet else 0.35
                b.inputs["Coat Roughness"].default_value = 0.05 if wet else 0.14
                b.inputs["Specular IOR Level"].default_value = 0.55
                if glass_from_palette:
                    _palette_glass(m, b)


def _palette_glass(m: bpy.types.Material, b) -> None:
    """
    Palette-textured low-poly kits (Kenney Car Kit) paint windows a pale sky-blue swatch. Turn exactly those texels
    into dark, glossy glass, driven by the texture's own colour, so the body paint stays untouched. Thresholds are
    in linear HSV: pale (S 0.2..0.5), bright (V > 0.9), blue-ish hue (0.5..0.7).
    """
    nt = m.node_tree
    link = next((l for l in nt.links if l.to_node == b and l.to_socket.name == "Base Color"), None)
    if not link:
        return
    src = link.from_socket
    hsv = nt.nodes.new("ShaderNodeSeparateColor")
    hsv.mode = "HSV"
    nt.links.new(src, hsv.inputs["Color"])
    glass = None
    for channel, op, edge in ((1, "GREATER_THAN", 0.2), (1, "LESS_THAN", 0.5), (2, "GREATER_THAN", 0.9),
                              (0, "GREATER_THAN", 0.5), (0, "LESS_THAN", 0.7)):
        test = nt.nodes.new("ShaderNodeMath")
        test.operation = op
        test.inputs[1].default_value = edge
        nt.links.new(hsv.outputs[channel], test.inputs[0])
        if glass is None:
            glass = test
            continue
        both = nt.nodes.new("ShaderNodeMath")
        both.operation = "MULTIPLY"
        nt.links.new(glass.outputs[0], both.inputs[0])
        nt.links.new(test.outputs[0], both.inputs[1])
        glass = both
    col = nt.nodes.new("ShaderNodeMix")
    col.data_type = "RGBA"
    nt.links.new(glass.outputs[0], col.inputs["Factor"])
    nt.links.new(src, col.inputs[6])
    col.inputs[7].default_value = (0.025, 0.035, 0.05, 1.0)
    nt.links.new(col.outputs[2], b.inputs["Base Color"])
    rough = nt.nodes.new("ShaderNodeMix")
    rough.data_type = "FLOAT"
    nt.links.new(glass.outputs[0], rough.inputs["Factor"])
    rough.inputs[2].default_value = b.inputs["Roughness"].default_value
    rough.inputs[3].default_value = 0.03
    nt.links.new(rough.outputs[0], b.inputs["Roughness"])

def unlit_normal_material() -> bpy.types.Material:
    """Camera-space normals as colour (x→R, y→G, z→B, mapped to 0..1): the normal-map sheet for 2.5D relighting."""
    m = bpy.data.materials.new("pwtv_normals")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    xf = nt.nodes.new("ShaderNodeVectorTransform")
    xf.vector_type = "NORMAL"
    xf.convert_from, xf.convert_to = "WORLD", "CAMERA"
    # camera space looks down -Z; flip Z (towards the viewer = blue) and Y is already up
    flip = nt.nodes.new("ShaderNodeVectorMath")
    flip.operation = "MULTIPLY"
    flip.inputs[1].default_value = (1, 1, -1)
    half = nt.nodes.new("ShaderNodeVectorMath")
    half.operation = "MULTIPLY_ADD"
    half.inputs[1].default_value = (0.5, 0.5, 0.5)
    half.inputs[2].default_value = (0.5, 0.5, 0.5)
    emit = nt.nodes.new("ShaderNodeEmission")
    nt.links.new(geo.outputs["Normal"], xf.inputs["Vector"])
    nt.links.new(xf.outputs["Vector"], flip.inputs[0])
    nt.links.new(flip.outputs["Vector"], half.inputs[0])
    nt.links.new(half.outputs["Vector"], emit.inputs["Color"])
    nt.links.new(emit.outputs["Emission"], out.inputs["Surface"])
    return m
