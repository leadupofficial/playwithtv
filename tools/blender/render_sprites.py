"""
Renders a pre-lit direction × frame sprite sheet of a model (the Donkey Kong Country technique) for the lite tier.

  blender -b --factory-startup -P tools/blender/render_sprites.py -- \
      --model car.glb --hdri studio_small_08_2k.hdr --preset studio --directions 16 --size 256 \
      --out apps/web/public/assets/cinematic/showroom --name hatchback --normals

Output in --out:
  <name>.webp / <name>.png          the atlas (straight alpha, edge-bled), cells cropped to one shared rectangle
  <name>-normals.webp (optional)    the same cells as camera-space normals (for cheap 2.5D relighting)
  <name>.json                       the manifest (see docs/building-games.md, "Sprite manifest")

Conventions (the runtime in apps/web/src/games/kit25d/ relies on them):
  - the camera never moves; the MODEL turns. Lights are fixed to the camera, like one consistent world;
  - heading is screen-relative, on the ground: 0 = facing screen-right, +π/2 = facing away from the camera
    (up the screen), -π/2 = facing the viewer. Direction d shows heading angle0 + d·2π/directions;
  - frame index in the atlas = direction * framesPerDirection + frame;
  - pivot = where the model's ground centre lands in a cell, as fractions of the cell (top-left origin).
"""
from __future__ import annotations

import argparse
import json
import math
import os
import re
import shutil
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
from bpy_extras.object_utils import world_to_camera_view  # noqa: E402
from mathutils import Vector  # noqa: E402

import pwtv_atlas as atlas  # noqa: E402
import pwtv_common as C  # noqa: E402

FORWARD = {"+x": 0.0, "+y": math.pi / 2, "-x": math.pi, "-y": -math.pi / 2}


def args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--model", required=True, help="GLB/glTF/FBX/OBJ/.blend")
    p.add_argument("--out", required=True)
    p.add_argument("--name", required=True, help="file stem, e.g. hatchback")
    p.add_argument("--hdri", help="equirectangular .hdr/.exr (Poly Haven CC0)")
    p.add_argument("--preset", default="studio", choices=sorted(C.PRESETS))
    p.add_argument("--directions", type=int, default=16, help="8, 16 or 32 (any ≥1 works)")
    p.add_argument("--frames", type=int, default=1, help="animation frames per direction")
    p.add_argument("--fps", type=float, default=12)
    p.add_argument("--action", help="action (clip) name to sample; default: the first one found")
    p.add_argument("--anim-from", help="a second file whose actions drive the model's rig (bones bind by name)")
    p.add_argument("--size", type=int, default=256, help="render size of one frame (px, square) before cropping")
    p.add_argument("--camera", default="ortho", choices=["ortho", "persp"])
    p.add_argument("--elevation", type=float, default=30, help="camera pitch above the horizon, degrees")
    p.add_argument("--fov", type=float, default=28, help="perspective only: vertical field of view, degrees")
    p.add_argument("--forward", default="-y", choices=sorted(FORWARD), help="model's forward axis after import (glTF +Z = -y)")
    p.add_argument("--angle0", type=float, default=0.0, help="heading of direction 0, radians")
    p.add_argument("--engine", default="cycles", choices=["cycles", "eevee"])
    p.add_argument("--samples", type=int, default=64)
    p.add_argument("--normals", action="store_true", help="also render a normal-map sheet")
    p.add_argument("--no-shadow", action="store_true", help="no contact shadow in the sprite")
    p.add_argument("--finish", default="premium", choices=["asis", "premium", "wet"], help="material pass")
    p.add_argument("--glass", action="store_true", help="palette kits: pale unsaturated texels become dark glossy glass")
    p.add_argument("--look", default="AgX - Punchy", help="AgX look (e.g. 'AgX - Medium High Contrast')")
    p.add_argument("--scale-to", type=float, help="scale so the longest horizontal side is this many metres")
    p.add_argument("--quality", type=int, default=88, help="WebP quality")
    p.add_argument("--max-atlas", type=int, default=4096, help="largest atlas side (TV GPUs: keep ≤ 4096)")
    p.add_argument("--licence", default="", help="licence note copied into the manifest")
    p.add_argument("--no-png", action="store_true", help="WebP only (no PNG fallback): keeps the repo light")
    p.add_argument("--preview", help="also write the atlas over a grey gradient to this PNG path (for review)")
    return p.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])


def find_rig(objs):
    for root in objs:
        for ob in [root, *root.children_recursive]:
            if ob.type == "ARMATURE":
                return ob
    return None


def _base(name: str) -> str:
    """'hips.001' → 'hips' (Blender suffixes duplicate object names)."""
    return re.sub(r"\.\d{3}$", "", name)


def _drive_bones_from_empties(rig, donor_roots, act) -> None:
    """
    Some trimmed glTFs (gltf-transform, KayKit animations.glb) keep the animated skeleton as plain nodes, which
    Blender imports as empties animated per object (one action slot each). Each empty plays its own slot; after
    every frame change, apply_retarget() moves each pose bone by its empty's motion relative to the rest pose
    (bone = empty_now · empty_rest⁻¹ · bone_rest), which also absorbs the different axis conventions of bones
    and empties.
    """
    empties = {}
    for root in donor_roots:
        for ob in [root, *root.children_recursive]:
            ob.animation_data_clear()  # rest transforms first
            empties.setdefault(_base(ob.name), ob)
    bpy.context.view_layer.update()
    for pb in rig.pose.bones:  # armature order: parents before children
        target = empties.get(pb.name)
        if target:
            rest_bone = rig.matrix_world @ pb.bone.matrix_local
            RETARGET.append((rig, pb, target, target.matrix_world.inverted() @ rest_bone))
    if not RETARGET:
        raise SystemExit("--anim-from: no donor node matches a bone name of the model's rig")
    for e in empties.values():
        slot = act.slots.get("OB" + e.name)
        if slot:
            e.animation_data_create()
            e.animation_data.action = act
            e.animation_data.action_slot = slot
    C.log(f"anim-from: {len(RETARGET)} bones follow donor nodes")


RETARGET: list = []


def apply_retarget() -> None:
    """Poses retargeted bones for the current frame (call after every frame_set). Parents first, updating as we go."""
    for rig, pb, target, offset in RETARGET:
        pb.matrix = rig.matrix_world.inverted() @ (target.matrix_world @ offset)
        bpy.context.view_layer.update()


def choose_action(a, objs):
    """
    Returns (armature, action, extra_roots) or (None, None, []). With --anim-from, actions come from a second
    file: from its armature if it has one, else from its animated nodes (see _drive_bones_from_empties).
    """
    rig = find_rig(objs)
    if not rig:
        if a.frames > 1:
            raise SystemExit("--frames > 1 needs a rigged model with an action")
        return None, None, []
    actions = list(bpy.data.actions)
    extra: list = []
    if a.anim_from:
        before = set(bpy.data.actions)
        extra = C.import_model(a.anim_from)
        actions = [x for x in bpy.data.actions if x not in before] or actions
    if not actions:
        return rig, None, []
    act = next((x for x in actions if a.action and (x.name == a.action or x.name.endswith(a.action))), None)
    if a.action and not act:
        raise SystemExit(f"action {a.action!r} not found; have: {', '.join(x.name for x in actions)}")
    act = act or actions[0]
    if extra and not find_rig(extra):
        _drive_bones_from_empties(rig, extra, act)
    else:
        for root in extra:  # a real donor armature: its action binds to our rig by bone name; drop the donor
            for ob in [*root.children_recursive, root]:
                bpy.data.objects.remove(ob, do_unlink=True)
        extra = []
        rig.animation_data_create()
        rig.animation_data.action = act
        ad = rig.animation_data
        if getattr(ad, "action_slot", None) is None:
            slots = list(getattr(ad, "action_suitable_slots", None) or getattr(act, "slots", []))
            if slots:
                ad.action_slot = slots[0]
    C.log("action:", act.name, "frames", tuple(act.frame_range))
    return rig, act, extra


def camera(a, lo, hi):
    """A fixed camera looking at the model's middle from the south (-Y), framing it for every turn."""
    rh = math.hypot(max(abs(lo.x), abs(hi.x)), max(abs(lo.y), abs(hi.y)))  # turning radius about the pivot
    h = hi.z
    e = math.radians(a.elevation)
    cam_data = bpy.data.cameras.new("cam")
    cam = bpy.data.objects.new("cam", cam_data)
    bpy.context.scene.collection.objects.link(cam)
    bpy.context.scene.camera = cam
    shadow_room = 1.0 if a.no_shadow else 1.18
    target = Vector((0, 0, h / 2))
    if a.camera == "ortho":
        cam_data.type = "ORTHO"
        cam_data.ortho_scale = max(2 * rh, 2 * rh * math.sin(e) + h * math.cos(e)) * 1.06 * shadow_room
        dist = (rh + h) * 4
    else:
        cam_data.type = "PERSP"
        cam_data.sensor_fit = "VERTICAL"
        cam_data.angle_y = math.radians(a.fov)
        radius = math.sqrt(rh * rh + (h / 2) ** 2)
        dist = radius / math.sin(math.radians(a.fov) / 2) * 1.04 * shadow_room
    cam_data.clip_start, cam_data.clip_end = dist / 100, dist * 4
    cam.location = target + Vector((0, -math.cos(e) * dist, math.sin(e) * dist))
    C.look_at(cam, target)
    bpy.context.view_layer.update()
    return cam


def render_cells(a, root, rig, act, tmp: str, kind: str) -> list[str]:
    paths = []
    s = bpy.context.scene
    f0, f1 = (act.frame_range if act else (1, 1))
    for d in range(a.directions):
        heading = a.angle0 + d * 2 * math.pi / a.directions
        root.rotation_euler = (0, 0, heading - FORWARD[a.forward])
        for f in range(a.frames):
            if act:
                t = f0 + (f1 - f0) * f / max(1, a.frames)
                s.frame_set(int(math.floor(t)), subframe=t - math.floor(t))
            apply_retarget()  # no-op unless --anim-from drives the rig through donor nodes
            path = os.path.join(tmp, f"{kind}_{d:02d}_{f:02d}.png")
            C.render_to(path)
            paths.append(path)
    return paths


def main() -> None:
    a = args()
    t_start = time.time()
    os.makedirs(a.out, exist_ok=True)
    C.empty_scene()
    objs = C.import_model(a.model)
    rig, act, donor = choose_action(a, objs)
    root = C.pivot_root(objs + donor, a.scale_to)  # donor nodes turn and scale with the model
    if a.finish != "asis":
        C.premium_materials(objs, wet=a.finish == "wet", glass_from_palette=a.glass)
    # bounds after pivoting; for animated models sample a few poses so swings stay inside the frame
    lo, hi = C.world_bounds(objs)
    if act:
        for k in range(6):
            bpy.context.scene.frame_set(int(act.frame_range[0] + (act.frame_range[1] - act.frame_range[0]) * k / 6))
            apply_retarget()
            l2, h2 = C.world_bounds(objs)
            lo, hi = Vector(map(min, lo, l2)), Vector(map(max, hi, h2))
    size = max(hi.x - lo.x, hi.y - lo.y, hi.z - lo.z)
    cam = camera(a, lo, hi)
    C.light_rig(a.preset, a.hdri, size)
    floor = None if a.no_shadow else C.shadow_catcher(size)
    C.setup_render(a.engine, a.samples, a.size, a.size, transparent=True, look=a.look)

    tmp = tempfile.mkdtemp(prefix="pwtv_sprites_")
    colour = render_cells(a, root, rig, act, tmp, "c")
    t_colour = time.time() - t_start

    normals = []
    if a.normals:
        s = bpy.context.scene
        s.view_layers[0].material_override = C.unlit_normal_material()
        if floor:
            floor.hide_render = True
        try:  # normals are data: no tone mapping or display curve
            s.view_settings.view_transform = "Raw"
        except TypeError:
            s.view_settings.view_transform = "Standard"
        s.view_settings.look = "None"
        if s.render.engine == "CYCLES":
            s.cycles.use_denoising = False
            s.cycles.samples = 16
        normals = render_cells(a, root, rig, act, tmp, "n")

    # pivot: where the ground centre (the root's origin) lands in the uncropped frame
    u = world_to_camera_view(bpy.context.scene, cam, Vector((0, 0, 0)))
    pivot_px = (u.x * a.size, (1 - u.y) * a.size)

    frames = [atlas.clean_alpha(atlas.load_rgba(p)) for p in colour]
    box = atlas.union_bbox(frames)
    sheet, rects, (cols, rows) = atlas.pack(frames, box, a.max_atlas)
    if a.preview:
        atlas.save_rgba(atlas.preview(sheet), a.preview, "PNG")
    sheet = atlas.bleed_edges(sheet)
    if not a.no_png:
        atlas.save_rgba(sheet, os.path.join(a.out, f"{a.name}.png"), "PNG")
    atlas.save_rgba(sheet, os.path.join(a.out, f"{a.name}.webp"), "WEBP", a.quality)
    if normals:
        nf = [atlas.load_rgba(p) for p in normals]
        nsheet, _, _ = atlas.pack(nf, box, a.max_atlas)
        atlas.save_rgba(atlas.bleed_edges(nsheet), os.path.join(a.out, f"{a.name}-normals.webp"), "WEBP", 92)

    x0, y0, x1, y1 = box
    cw, ch = x1 - x0, y1 - y0
    cam_data = cam.data
    manifest = {
        "format": "pwtv-sprites",
        "version": 1,
        "name": a.name,
        "image": f"{a.name}.webp",
        "fallback": None if a.no_png else f"{a.name}.png",
        "normals": f"{a.name}-normals.webp" if normals else None,
        "size": {"w": int(sheet.shape[1]), "h": int(sheet.shape[0])},
        "cell": {"w": cw, "h": ch},
        "grid": {"cols": cols, "rows": rows},
        "directions": a.directions,
        "framesPerDirection": a.frames,
        "fps": a.fps,
        "angle0": a.angle0,
        "pivot": {"x": round((pivot_px[0] - x0) / cw, 4), "y": round((pivot_px[1] - y0) / ch, 4)},
        "pixelsPerMetre": round(a.size / cam_data.ortho_scale, 3) if cam_data.type == "ORTHO" else None,
        "camera": {"type": a.camera, "elevationDeg": a.elevation, "fovDeg": a.fov if a.camera == "persp" else None},
        "shadow": not a.no_shadow,
        "frames": rects,
        "source": {
            "model": os.path.basename(a.model), "animFrom": os.path.basename(a.anim_from) if a.anim_from else None,
            "action": act.name if act else None, "hdri": os.path.basename(a.hdri) if a.hdri else None,
            "preset": a.preset, "finish": a.finish, "engine": a.engine, "samples": a.samples, "look": a.look,
            "licence": a.licence,
        },
    }
    with open(os.path.join(a.out, f"{a.name}.json"), "w") as fh:
        json.dump(manifest, fh, indent=1)
    shutil.rmtree(tmp, ignore_errors=True)
    total = time.time() - t_start
    C.log(f"sprites: {len(colour)} cells {cw}x{ch} in a {cols}x{rows} grid, atlas {sheet.shape[1]}x{sheet.shape[0]}; "
          f"colour {t_colour:.1f}s, total {total:.1f}s")


if __name__ == "__main__":
    main()
