"""
Tiffin Tornado: renders a chef (a KayKit adventurer dressed by tt_chef.py) as an 8-direction sprite sheet with all
the game's clips in ONE atlas (one draw call per chef on the lite tier), and exports the dressed model (no
animations: the game uses kaykit-adventurers/animations.glb) as a GLB for the real-time tiers.

  blender -b --factory-startup -P tools/blender/tiffin/render_chefs.py -- --model Knight.glb --base Knight \
      --name chef-1 --hdri studio_small_09_2k.hdr --out apps/web/public/assets/tiffin --glb

Manifest: pwtv-sprites v1, framesPerDirection = every clip's frames back to back, plus
"clips": {"idle": {"start": 0, "count": 4, "fps": 6}, …}.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
from bpy_extras.object_utils import world_to_camera_view  # noqa: E402
from mathutils import Vector  # noqa: E402

import tt_common as T  # noqa: E402
import pwtv_atlas as atlas  # noqa: E402
import pwtv_common as C  # noqa: E402
import tt_chef as Ch  # noqa: E402
import tt_light as L  # noqa: E402

# name, KayKit action, frames, fps, carry pose
CLIPS = [
    ("idle", "Idle", 4, 5, False),
    ("run", "Running_A", 8, 14, False),
    ("carry", "Idle", 2, 3, True),
    ("carryrun", "Running_A", 8, 14, True),
    ("work", "1H_Melee_Attack_Chop", 6, 14, False),
    ("cheer", "Cheer", 6, 9, False),
]
DIRECTIONS = 8
FRAME_M = 1.9
FRAME_PX = 216


def args():
    p = argparse.ArgumentParser()
    p.add_argument("--model", required=True)
    p.add_argument("--base", required=True, help="KayKit character name prefix, e.g. Knight")
    p.add_argument("--name", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--hdri")
    p.add_argument("--samples", type=int, default=32)
    p.add_argument("--engine", default="cycles", choices=["cycles", "eevee"])
    p.add_argument("--glb", action="store_true")
    p.add_argument("--test", help="write a quick contact sheet of a few poses to this PNG and stop")
    p.add_argument("--preview")
    return C.parse(p)


def find_action(name):
    for a in bpy.data.actions:
        if a.name == name or a.name.endswith("|" + name) or a.name.split("|")[-1] == name:
            return a
    raise SystemExit(f"no action {name}: {[a.name for a in bpy.data.actions][:10]}")


def set_action(rig, act):
    rig.animation_data_create()
    ad = rig.animation_data
    ad.action = act
    if getattr(ad, "action_slot", None) is None:
        slots = list(getattr(ad, "action_suitable_slots", None) or getattr(act, "slots", []))
        if slots:
            ad.action_slot = slots[0]


def main():
    a = args()
    t0 = time.time()
    os.makedirs(a.out, exist_ok=True)
    C.empty_scene()
    objs = C.import_model(a.model)
    rig = Ch.rig_of(objs)
    Ch.strip(objs, a.base)
    for o in bpy.context.scene.objects:  # glTF import may add the actions to the rig already
        if o.animation_data:
            o.animation_data.action = None
    Ch.dress(rig, 1)
    objs = [o for o in bpy.context.scene.objects if o.parent is None]
    root = C.pivot_root(objs)
    lo, hi = C.world_bounds(objs)
    k = Ch.HEIGHT / (hi.z - lo.z)
    root.scale = (k, k, k)
    bpy.context.view_layer.update()
    cam = L.camera(target=(0, 0, 0.58), ortho_scale=FRAME_M)
    L.sprite_rig(a.hdri, 1.3)
    C.shadow_catcher(1.2)
    C.setup_render(a.engine, a.samples, FRAME_PX, FRAME_PX, transparent=True, look="AgX - Punchy")
    bpy.context.scene.view_settings.exposure = -0.4
    bpy.context.scene.render.use_persistent_data = True  # keep the BVH between the ~270 renders (much faster)
    tmp = tempfile.mkdtemp(prefix="tt_chef_")
    paths, clips, start = [], {}, 0
    plan = CLIPS if not a.test else [("idle", "Idle", 1, 5, False), ("carry", "Idle", 1, 3, True), ("work", "1H_Melee_Attack_Chop", 2, 14, False), ("run", "Running_A", 1, 14, True)]
    dirs = DIRECTIONS if not a.test else 2
    for name, action, n, fps, carry in plan:
        clips[name] = {"start": start, "count": n, "fps": fps}
        start += n
    for d in range(dirs):
        heading = d * 2 * math.pi / DIRECTIONS if not a.test else (-math.pi / 2 if d == 0 else 0)
        root.rotation_euler = (0, 0, heading + math.pi / 2)
        for name, action, n, fps, carry in plan:
            act = find_action(action)
            set_action(rig, act)
            Ch.mute_arms(act, carry)
            f0, f1 = act.frame_range
            for f in range(n):
                t = f0 + (f1 - f0) * f / n
                bpy.context.scene.frame_set(int(math.floor(t)), subframe=t - math.floor(t))
                Ch.carry_pose(rig, carry, root)
                p = os.path.join(tmp, f"{d:02d}_{name}_{f:02d}.png")
                C.render_to(p)
                paths.append(p)
            Ch.mute_arms(act, False)
    frames = [atlas.clean_alpha(atlas.load_rgba(p)) for p in paths]
    box = atlas.union_bbox(frames)
    sheet, rects, (cols, rows) = atlas.pack(frames, box, 4096)
    if a.test or a.preview:
        atlas.save_rgba(atlas.preview(sheet), a.test or a.preview, "PNG")
    if a.test:
        return
    atlas.save_rgba(atlas.bleed_edges(sheet), os.path.join(a.out, f"{a.name}.webp"), "WEBP", 88)
    u = world_to_camera_view(bpy.context.scene, cam, Vector((0, 0, 0)))
    px, py = u.x * FRAME_PX, (1 - u.y) * FRAME_PX
    x0, y0, x1, y1 = box
    cw, ch = x1 - x0, y1 - y0
    manifest = {
        "format": "pwtv-sprites", "version": 1, "name": a.name, "image": f"{a.name}.webp", "fallback": None, "normals": None,
        "size": {"w": int(sheet.shape[1]), "h": int(sheet.shape[0])}, "cell": {"w": cw, "h": ch}, "grid": {"cols": cols, "rows": rows},
        "directions": DIRECTIONS, "framesPerDirection": start, "fps": 12, "angle0": 0,
        "pivot": {"x": round((px - x0) / cw, 4), "y": round((py - y0) / ch, 4)},
        "pixelsPerMetre": round(FRAME_PX / FRAME_M, 3),
        "camera": {"type": "ortho", "elevationDeg": L.PITCH, "fovDeg": None}, "shadow": True, "frames": rects, "clips": clips,
        "tintKey": "magenta",
        "source": {"generator": "tools/blender/tiffin/render_chefs.py", "model": os.path.basename(a.model),
                   "licence": "KayKit Character Pack: Adventurers 1.0 by Kay Lousberg (CC0 1.0), dressed as a chef in code"},
    }
    with open(os.path.join(a.out, f"{a.name}.json"), "w") as fh:
        json.dump(manifest, fh, indent=1)
    shutil.rmtree(tmp, ignore_errors=True)
    C.log(f"{a.name}: {len(paths)} cells {cw}x{ch}, atlas {sheet.shape[1]}x{sheet.shape[0]}, {time.time() - t0:.0f}s")
    if a.glb:
        export(rig, root, os.path.join(a.out, f"{a.name}.glb"))


def export(rig, root, path):
    """The dressed chef (mesh, skin, toque and apron on their bones), at game scale, without animations."""
    for o in list(bpy.context.scene.objects):
        if o.type in ("LIGHT", "CAMERA") or o.name == "pwtv_floor":
            bpy.data.objects.remove(o, do_unlink=True)
    root.rotation_euler = (0, 0, 0)
    for o in bpy.context.scene.objects:
        if o.animation_data:
            o.animation_data.action = None
    Ch.carry_pose(rig, False)
    for pb in rig.pose.bones:
        pb.location = (0, 0, 0)
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.scale = (1, 1, 1)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", export_apply=False, export_animations=False,
                              export_draco_mesh_compression_enable=False, export_yup=True, export_lights=False, export_cameras=False)
    C.log(f"{os.path.basename(path)}: {os.path.getsize(path) // 1024} KB")


if __name__ == "__main__":
    main()
