"""
KALARI CLASH lite-tier fighters: one pre-lit sprite atlas per fighter holding EVERY move clip, 8 directions.

  blender -b --factory-startup -P tools/blender/kalari/fighter_sprites.py -- --blend <scratch>/simha.blend \
      --fighter simha --out apps/web/public/assets/kalari-clash --preview <scratch>/simha-sheet.png

Built on render_sprites.py (same camera, light rig, cropping, packing and manifest format), but samples several
actions into one sheet: framesPerDirection is the sum of all clips, and the manifest gains
"clips": {name: {start, frames, fps, loop}} so the game picks frame = start + clip frame.
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

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))

import bpy  # noqa: E402
from bpy_extras.object_utils import world_to_camera_view  # noqa: E402
from mathutils import Vector  # noqa: E402

import pwtv_atlas as atlas  # noqa: E402
import pwtv_common as C  # noqa: E402
import render_sprites as RS  # noqa: E402

# game clip -> (frames, fps, loop); the action per fighter is in ACTIONS
CLIPS = [
    ("idle", 4, 6, True), ("run", 6, 12, True), ("jab", 4, 16, False), ("cross", 4, 16, False), ("kick", 5, 14, False),
    ("heavy", 5, 12, False), ("guard", 1, 4, True), ("hit", 3, 12, False), ("roll", 5, 14, False), ("special", 7, 10, False),
    ("cheer", 4, 8, True), ("ko", 4, 10, False),
]
BASE = {
    "idle": "Unarmed_Idle", "run": "Running_A", "jab": "Unarmed_Melee_Attack_Punch_A", "cross": "Unarmed_Melee_Attack_Punch_B",
    "kick": "Unarmed_Melee_Attack_Kick", "heavy": "2H_Melee_Attack_Chop", "guard": "Blocking", "hit": "Hit_A",
    "roll": "Dodge_Forward", "cheer": "Cheer", "ko": "Death_A",
}
ACTIONS = {
    "simha": {**BASE, "special": "Jump_Full_Short"},
    "mayil": {**BASE, "idle": "2H_Melee_Idle", "run": "Running_B", "jab": "1H_Melee_Attack_Stab", "cross": "1H_Melee_Attack_Slice_Diagonal",
              "kick": "2H_Melee_Attack_Slice", "special": "2H_Melee_Attack_Spinning"},
    "puli": {**BASE, "special": "Jump_Full_Long"},
    "ashwa": {**BASE, "special": "2H_Melee_Attack_Spin"},
}


def args():
    p = argparse.ArgumentParser()
    p.add_argument("--blend", required=True)
    p.add_argument("--fighter", required=True, choices=sorted(ACTIONS))
    p.add_argument("--out", required=True)
    p.add_argument("--directions", type=int, default=8)
    p.add_argument("--size", type=int, default=200)
    p.add_argument("--samples", type=int, default=24)
    p.add_argument("--engine", default="cycles")
    p.add_argument("--preset", default="studio")
    p.add_argument("--elevation", type=float, default=30)
    p.add_argument("--ortho", type=float, default=3.4, help="metres across a cell before cropping (fixed, so the fighter fills it)")
    p.add_argument("--quality", type=int, default=86)
    p.add_argument("--preview")
    p.add_argument("--only-clips", default="", help="debug: render only these clips")
    a = C.parse(p)
    # what render_sprites.camera() reads
    a.camera, a.fov, a.no_shadow, a.forward, a.angle0 = "ortho", 28, False, "-y", 0.0
    return a


def set_action(rig, act) -> None:
    ad = rig.animation_data or rig.animation_data_create()
    ad.action = act
    if len(act.slots):
        ad.action_slot = act.slots[0]


def sample_times(act, n: int, loop: bool) -> list[float]:
    f0, f1 = act.frame_range
    return [f0 + (f1 - f0) * (k / n if loop else k / max(1, n - 1)) for k in range(n)]


def main() -> None:
    a = args()
    t0 = time.time()
    bpy.ops.wm.open_mainfile(filepath=os.path.abspath(a.blend))
    s = bpy.context.scene
    for ob in list(s.objects):
        if ob.type in ("CAMERA", "LIGHT"):
            bpy.data.objects.remove(ob, do_unlink=True)
    rig = next(o for o in s.objects if o.type == "ARMATURE")
    roots = [o for o in s.objects if o.parent is None]
    meshes = [o for o in rig.children_recursive if o.type == "MESH"]
    clips = [c for c in CLIPS if not a.only_clips or c[0] in a.only_clips.split(",")]
    acts = {name: bpy.data.actions[ACTIONS[a.fighter][name]] for name, *_ in clips}
    root = C.pivot_root(roots)
    # bounds over every sampled pose, so kicks and leaps stay inside the shared cell
    lo, hi = C.world_bounds(meshes)
    for name, n, _, loop in clips:
        set_action(rig, acts[name])
        for t in sample_times(acts[name], n, loop):
            s.frame_set(int(t), subframe=t - int(t))
            l2, h2 = C.world_bounds(meshes)
            lo, hi = Vector(map(min, lo, l2)), Vector(map(max, hi, h2))
    lo.z = 0.0
    size = max(hi.x - lo.x, hi.y - lo.y, hi.z - lo.z)
    cam = RS.camera(a, lo, hi)
    cam.data.ortho_scale = a.ortho  # frame the standing fighter tightly; leaps and falls may touch the edge
    C.light_rig(a.preset, None, max(1.6, hi.z))
    C.shadow_catcher(size)
    C.setup_render(a.engine, a.samples, a.size, a.size, transparent=True, look="AgX - Punchy")
    tmp = tempfile.mkdtemp(prefix="kalari_sprites_")
    paths, meta, start = [], {}, 0
    for name, n, fps, loop in clips:
        meta[name] = {"start": start, "frames": n, "fps": fps, "loop": loop}
        start += n
    for d in range(a.directions):
        heading = a.angle0 + d * 2 * math.pi / a.directions
        root.rotation_euler = (0, 0, heading - RS.FORWARD[a.forward])
        for name, n, _, loop in clips:
            set_action(rig, acts[name])
            for k, t in enumerate(sample_times(acts[name], n, loop)):
                s.frame_set(int(t), subframe=t - int(t))
                p = os.path.join(tmp, f"c_{d:02d}_{name}_{k:02d}.png")
                C.render_to(p)
                paths.append(p)
        C.log(f"direction {d + 1}/{a.directions} done, {time.time() - t0:.0f}s")
    u = world_to_camera_view(s, cam, Vector((0, 0, 0)))
    pivot_px = (u.x * a.size, (1 - u.y) * a.size)
    frames = [atlas.clean_alpha(atlas.load_rgba(p)) for p in paths]
    box = atlas.union_bbox(frames)
    sheet, rects, (cols, rows) = atlas.pack(frames, box, 4096)
    if a.preview:
        atlas.save_rgba(atlas.preview(sheet), a.preview, "PNG")
    sheet = atlas.bleed_edges(sheet)
    os.makedirs(a.out, exist_ok=True)
    name = f"{a.fighter}-sprites"
    atlas.save_rgba(sheet, os.path.join(a.out, f"{name}.webp"), "WEBP", a.quality)
    x0, y0, x1, y1 = box
    cw, ch = x1 - x0, y1 - y0
    manifest = {
        "format": "pwtv-sprites", "version": 1, "name": name, "image": f"{name}.webp", "fallback": None, "normals": None,
        "size": {"w": int(sheet.shape[1]), "h": int(sheet.shape[0])}, "cell": {"w": cw, "h": ch}, "grid": {"cols": cols, "rows": rows},
        "directions": a.directions, "framesPerDirection": start, "fps": 12, "angle0": a.angle0,
        "pivot": {"x": round((pivot_px[0] - x0) / cw, 4), "y": round((pivot_px[1] - y0) / ch, 4)},
        "pixelsPerMetre": round(a.size / cam.data.ortho_scale, 3),
        "camera": {"type": "ortho", "elevationDeg": a.elevation, "fovDeg": None}, "shadow": True, "frames": rects,
        "clips": meta,
        "source": {"model": f"{a.fighter} (restyled KayKit Adventurers, CC0)", "actions": {k: acts[k].name for k in acts},
                   "preset": a.preset, "engine": a.engine, "samples": a.samples, "licence": "CC0 1.0 (KayKit by Kay Lousberg)"},
    }
    with open(os.path.join(a.out, f"{name}.json"), "w") as fh:
        json.dump(manifest, fh, indent=1)
    shutil.rmtree(tmp, ignore_errors=True)
    C.log(f"{name}: {len(paths)} cells {cw}x{ch}, atlas {sheet.shape[1]}x{sheet.shape[0]}, {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
