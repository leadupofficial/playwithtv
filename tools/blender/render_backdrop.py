"""
Renders a backdrop for the lite tier: a still (PNG + WebP at 1920×1080 and 1280×720), parallax layers with alpha,
or a seamlessly looping H.264 video (720p) with a poster frame. The TV decodes the video in hardware, almost free.

  # a looping 4 s video of the built-in "ghat road" stage around a model, monsoon light
  blender -b --factory-startup -P tools/blender/render_backdrop.py -- \
      --model car.glb --hdri kloofendal_overcast_puresky_2k.hdr --preset monsoon --stage road \
      --video --seconds 4 --fps 24 --path sway --out apps/web/public/assets/cinematic/showroom --name ghat-loop

  # stills of your own scene (its camera and animation), with parallax layers from collections sky/far/mid
  blender -b --factory-startup -P tools/blender/render_backdrop.py -- --scene level.blend --still --layers sky,far,mid ...

Your own .blend: put the active camera in place (animate it for a path), and, for --layers, put objects in
collections named after the layers. The sky layer shows only the world; every other layer is rendered alone
with a transparent background (objects of other layers hidden), so the game can scroll them at different speeds.

Outputs (in --out): <name>.mp4 + <name>-poster.webp (video), <name>-1080.webp/.png + <name>-720.webp/.png (still),
<name>-<layer>-1080.webp/... (layers), and <name>.json describing what was rendered.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

import pwtv_atlas as atlas  # noqa: E402
import pwtv_common as C  # noqa: E402


def args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    src = p.add_mutually_exclusive_group(required=True)
    src.add_argument("--scene", help="a .blend with a camera (its animation is the path)")
    src.add_argument("--model", help="a model to place on a built-in stage")
    p.add_argument("--stage", default="road", choices=["road", "studio"], help="built-in stage (with --model)")
    p.add_argument("--hdri")
    p.add_argument("--preset", default="monsoon", choices=sorted(C.PRESETS))
    kind = p.add_mutually_exclusive_group(required=True)
    kind.add_argument("--still", action="store_true")
    kind.add_argument("--video", action="store_true")
    p.add_argument("--layers", default="", help="comma list of collection names (stills only), e.g. sky,far,mid")
    p.add_argument("--path", default="sway", choices=["sway", "orbit", "static", "scene"], help="camera move (loops)")
    p.add_argument("--seconds", type=float, default=4.0)
    p.add_argument("--fps", type=int, default=24)
    p.add_argument("--sizes", default="1920x1080,1280x720", help="still sizes")
    p.add_argument("--video-size", default="1280x720")
    p.add_argument("--crf", type=int, default=23)
    p.add_argument("--engine", default="cycles", choices=["cycles", "eevee"])
    p.add_argument("--samples", type=int, default=48)
    p.add_argument("--finish", default="wet", choices=["asis", "premium", "wet"])
    p.add_argument("--glass", action="store_true", help="palette kits: pale blue texels become dark glass")
    p.add_argument("--look", default="AgX - Punchy")
    p.add_argument("--quality", type=int, default=84, help="WebP quality")
    p.add_argument("--out", required=True)
    p.add_argument("--name", required=True)
    p.add_argument("--licence", default="")
    return p.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])


def collection(name: str) -> bpy.types.Collection:
    col = bpy.data.collections.get(name) or bpy.data.collections.new(name)
    if col.name not in bpy.context.scene.collection.children:
        bpy.context.scene.collection.children.link(col)
    return col


def move_to(ob: bpy.types.Object, col: bpy.types.Collection) -> None:
    for c in list(ob.users_collection):
        c.objects.unlink(ob)
    col.objects.link(ob)
    for ch in ob.children_recursive:
        for c in list(ch.users_collection):
            c.objects.unlink(ch)
        col.objects.link(ch)


def wet_road_material(width: float = 0.0, dash: float = 1.0, base=(0.022, 0.024, 0.027), rough=(0.1, 0.7)) -> bpy.types.Material:
    """
    Dark asphalt (or, with width 0, wet earth) with noise-driven puddles: glossy where wet, rough where dry. With a
    width, a dashed centre line is painted along Y (dash = dash length, metres).
    """
    m = bpy.data.materials.new("pwtv_wet_road" if width else "pwtv_wet_ground")
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 0.6
    noise.inputs["Detail"].default_value = 6
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position, ramp.color_ramp.elements[1].position = 0.48, 0.56
    nt.links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    rng = rough
    rough = nt.nodes.new("ShaderNodeMapRange")
    rough.inputs["To Min"].default_value, rough.inputs["To Max"].default_value = rng
    nt.links.new(ramp.outputs["Color"], rough.inputs["Value"])
    nt.links.new(rough.outputs["Result"], b.inputs["Roughness"])
    b.inputs["Base Color"].default_value = (*base, 1)
    if width:  # centre line: |x| < width/2 and the dash phase along y
        coord = nt.nodes.new("ShaderNodeTexCoord")
        xyz = nt.nodes.new("ShaderNodeSeparateXYZ")
        nt.links.new(coord.outputs["Object"], xyz.inputs["Vector"])

        def math(op, a, bval=None):
            n = nt.nodes.new("ShaderNodeMath")
            n.operation = op
            if isinstance(a, float):
                n.inputs[0].default_value = a
            else:
                nt.links.new(a, n.inputs[0])
            if bval is not None:
                if isinstance(bval, float):
                    n.inputs[1].default_value = bval
                else:
                    nt.links.new(bval, n.inputs[1])
            return n.outputs[0]
        inside = math("LESS_THAN", math("ABSOLUTE", xyz.outputs["X"]), width / 2)
        on = math("LESS_THAN", math("FRACT", math("DIVIDE", xyz.outputs["Y"], dash * 2)), 0.5)
        line = math("MULTIPLY", inside, on)
        paint = nt.nodes.new("ShaderNodeMix")
        paint.data_type = "RGBA"
        nt.links.new(line, paint.inputs["Factor"])
        paint.inputs[6].default_value = (*base, 1)
        paint.inputs[7].default_value = (0.55, 0.53, 0.45, 1)
        nt.links.new(paint.outputs[2], b.inputs["Base Color"])
    grain = nt.nodes.new("ShaderNodeTexNoise")
    grain.inputs["Scale"].default_value = 180
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.08
    nt.links.new(grain.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    return m


def hill_material(depth: float) -> bpy.types.Material:
    """Monsoon-green hills, lifted towards the sky colour with distance (aerial perspective without a volume)."""
    m = bpy.data.materials.new(f"pwtv_hill_{depth:.2f}")
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    near, haze = (0.03, 0.07, 0.04), (0.42, 0.50, 0.54)
    b.inputs["Base Color"].default_value = (*[n + (h - n) * depth for n, h in zip(near, haze)], 1)
    b.inputs["Roughness"].default_value = 0.9
    return m


def build_stage(a, size: float) -> None:
    """The built-in stage: sky (world), far (misty hills), mid (road + model). Units follow the model's size."""
    k = size
    far, mid = collection("far"), collection("mid")
    if a.stage == "road":
        bpy.ops.mesh.primitive_plane_add(size=k * 60)
        ground = bpy.context.active_object
        ground.name = "ground"
        ground.data.materials.append(wet_road_material(base=(0.018, 0.03, 0.016), rough=(0.45, 0.95)))
        move_to(ground, mid)
        bpy.ops.mesh.primitive_plane_add(size=1)
        road = bpy.context.active_object
        road.name = "road"
        road.location.z = size * 0.002  # just above the ground: no z-fighting
        road.scale = (k * 1.5, k * 60, 1)
        bpy.ops.object.transform_apply(scale=True)
        road.data.materials.append(wet_road_material(width=k * 0.03, dash=k * 0.5))
        move_to(road, mid)
        for i, (x, y, s) in enumerate([(-9, 26, 9), (4, 34, 12), (16, 24, 8), (-22, 36, 13), (28, 40, 14)]):
            bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=4, radius=1)
            h = bpy.context.active_object
            h.name = f"hill{i}"
            h.location = (x * k, y * k, -s * 0.35 * k)
            h.scale = (s * k * 1.3, s * k, s * k * 0.75)
            tex = bpy.data.textures.new(f"hn{i}", "CLOUDS")
            tex.noise_scale = 0.6
            d = h.modifiers.new("disp", "DISPLACE")
            d.texture, d.strength = tex, 0.35
            bpy.ops.object.shade_smooth()
            h.data.materials.append(hill_material(min(0.85, (y - 18) / 26)))
            move_to(h, far)
    else:
        floor = C.shadow_catcher(size)
        move_to(floor, mid)


def camera_rig(a, size: float) -> bpy.types.Object:
    """A camera on a looping path: sway (a figure-of-eight drift), orbit (one full turn) or static."""
    s = bpy.context.scene
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    s.collection.objects.link(cam)
    s.camera = cam
    cam.data.lens = 40
    cam.data.clip_end = size * 400
    target = Vector((0, 0, size * 0.25))
    n = int(round(a.seconds * a.fps)) if a.video else 1
    s.frame_start, s.frame_end = 1, max(1, n)
    s.render.fps = a.fps
    base = Vector((size * 1.5, -size * 2.6, size * 0.75))
    for f in range(n + 1 if a.video else 1):
        t = f / max(1, n)
        w = 2 * math.pi * t
        if a.path == "orbit":
            r = math.hypot(base.x, base.y)
            ang = math.atan2(base.y, base.x) + w
            pos = Vector((math.cos(ang) * r, math.sin(ang) * r, base.z))
        elif a.path == "sway":  # returns exactly to the start: the video loops without a seam
            pos = base + Vector((math.sin(w) * size * 0.35, math.sin(w) * size * 0.15, math.sin(2 * w) * size * 0.06))
        else:
            pos = base
        cam.location = pos
        C.look_at(cam, target + Vector((0, 0, math.sin(w) * size * 0.02)))
        if a.video:
            cam.keyframe_insert("location", frame=f + 1)
            cam.keyframe_insert("rotation_euler", frame=f + 1)
    if a.video and cam.animation_data and cam.animation_data.action:
        for fc in getattr(cam.animation_data.action, "fcurves", []):
            for kp in fc.keyframe_points:
                kp.interpolation = "LINEAR"
    return cam


def encode(frames_dir: str, out: str, fps: int, crf: int) -> None:
    """H.264 Main profile, yuv420p, faststart, no audio: plays on every TV's hardware decoder."""
    if not shutil.which("ffmpeg"):
        raise SystemExit("ffmpeg not found (brew install ffmpeg)")
    cmd = ["ffmpeg", "-v", "error", "-y", "-framerate", str(fps), "-i", os.path.join(frames_dir, "f_%04d.png"),
           "-c:v", "libx264", "-profile:v", "main", "-preset", "slow", "-crf", str(crf), "-pix_fmt", "yuv420p",
           "-g", str(fps * 2), "-movflags", "+faststart", "-an", out]
    subprocess.run(cmd, check=True)


def still_sizes(spec: str) -> list[tuple[int, int]]:
    return [tuple(int(v) for v in s.lower().split("x")) for s in spec.split(",") if s]


def render_still(path_stem: str, sizes, quality: int, transparent: bool) -> list[str]:
    s = bpy.context.scene
    s.render.film_transparent = transparent
    s.render.image_settings.color_mode = "RGBA" if transparent else "RGB"
    written = []
    for w, h in sizes:
        s.render.resolution_x, s.render.resolution_y = w, h
        png = f"{path_stem}-{h}.png"
        C.render_to(png)
        atlas.save_rgba(atlas.load_rgba(png), f"{path_stem}-{h}.webp", "WEBP", quality)
        written += [os.path.basename(png), os.path.basename(f"{path_stem}-{h}.webp")]
    return written


def set_layer(layer: str, layers: list[str]) -> None:
    """Shows only `layer`'s collection (the sky layer shows none: just the world)."""
    for name in layers:
        col = bpy.data.collections.get(name)
        if col:
            col.hide_render = name != layer


def main() -> None:
    a = args()
    t0 = time.time()
    os.makedirs(a.out, exist_ok=True)
    if a.scene:
        bpy.ops.wm.open_mainfile(filepath=os.path.abspath(a.scene))
        size = 4.0
        if not bpy.context.scene.camera:
            raise SystemExit("the scene has no active camera")
    else:
        C.empty_scene()
        objs = C.import_model(a.model)
        root = C.pivot_root(objs)
        if a.finish != "asis":
            C.premium_materials(objs, wet=a.finish == "wet", glass_from_palette=a.glass)
        lo, hi = C.world_bounds(objs)
        size = max(hi.x - lo.x, hi.y - lo.y)
        C.light_rig(a.preset, a.hdri, size, cam_yaw=0.6)
        if a.stage == "road":  # a mirror-wet road would show the key as a big disc: the sky does the reflections
            bpy.data.objects["key"].visible_glossy = False
        build_stage(a, size)
        move_to(root, collection("mid"))
        camera_rig(a, size)
    vw, vh = still_sizes(a.video_size)[0]
    C.setup_render(a.engine, a.samples, vw, vh, transparent=False, look=a.look)
    s = bpy.context.scene
    out_files: list[str] = []
    stem = os.path.join(a.out, a.name)
    if a.still:
        layers = [x for x in a.layers.split(",") if x]
        if layers:
            for layer in layers:
                set_layer(layer, layers)
                out_files += render_still(f"{stem}-{layer}", still_sizes(a.sizes), a.quality, transparent=layer != layers[0])
            set_layer("", [])
        else:
            out_files += render_still(stem, still_sizes(a.sizes), a.quality, transparent=False)
    else:
        tmp = tempfile.mkdtemp(prefix="pwtv_backdrop_")
        s.render.resolution_x, s.render.resolution_y = vw, vh
        s.render.filepath = os.path.join(tmp, "f_####")
        s.render.use_file_extension = True
        bpy.ops.render.render(animation=True)
        encode(tmp, f"{stem}.mp4", a.fps, a.crf)
        atlas.save_rgba(atlas.load_rgba(os.path.join(tmp, "f_0001.png")), f"{stem}-poster.webp", "WEBP", a.quality)
        out_files += [f"{a.name}.mp4", f"{a.name}-poster.webp"]
        shutil.rmtree(tmp, ignore_errors=True)
    meta = {
        "format": "pwtv-backdrop", "version": 1, "name": a.name, "kind": "video" if a.video else "still",
        "files": out_files, "fps": a.fps if a.video else None, "seconds": a.seconds if a.video else None,
        "loop": bool(a.video), "layers": [x for x in a.layers.split(",") if x] if a.still else [],
        "source": {"scene": os.path.basename(a.scene) if a.scene else None, "model": os.path.basename(a.model) if a.model else None,
                   "hdri": os.path.basename(a.hdri) if a.hdri else None, "preset": a.preset, "stage": a.stage,
                   "engine": a.engine, "samples": a.samples, "licence": a.licence},
    }
    with open(f"{stem}.json", "w") as fh:
        json.dump(meta, fh, indent=1)
    C.log(f"backdrop {meta['kind']}: {', '.join(out_files)} in {time.time() - t0:.1f}s")


if __name__ == "__main__":
    main()
