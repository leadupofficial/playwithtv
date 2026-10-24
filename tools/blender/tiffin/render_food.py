"""
Tiffin Tornado: renders every food item and carried thing as a pre-lit sprite (one view, the game camera's
pitch) into one atlas for the lite tier, and exports the same models as one GLB for the high/ultra tiers.

  blender -b --factory-startup -P tools/blender/tiffin/render_food.py -- \
      --hdri studio_small_09_2k.hdr --out apps/web/public/assets/tiffin --preview /tmp/food.png

Atlas manifest (pwtv-sprites v1): directions 1, framesPerDirection = number of items; `names` lists the item
for each frame (the game picks a frame by name).
"""
from __future__ import annotations

import argparse
import json
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
import tt_food as F  # noqa: E402
import tt_light as L  # noqa: E402

FRAME_M = 0.78     # metres across one render
FRAME_PX = 200     # pixels across one render (→ ~256 px per metre)


def args():
    p = argparse.ArgumentParser()
    p.add_argument("--out", required=True)
    p.add_argument("--hdri")
    p.add_argument("--samples", type=int, default=48)
    p.add_argument("--only", default="", help="comma list of items (default: all)")
    p.add_argument("--preview")
    p.add_argument("--no-glb", action="store_true")
    return C.parse(p)


def main():
    a = args()
    t0 = time.time()
    os.makedirs(a.out, exist_ok=True)
    C.empty_scene()
    names = [n for n in (a.only.split(",") if a.only else F.BUILDERS)]
    items = {n: F.build(n) for n in names}
    cam = L.camera(target=(0, 0, 0.06), ortho_scale=FRAME_M)
    L.sprite_rig(a.hdri, 0.7)
    floor = C.shadow_catcher(0.6)
    C.setup_render("cycles", a.samples, FRAME_PX, FRAME_PX, transparent=True, look="AgX - Punchy")
    bpy.context.scene.view_settings.exposure = -0.4
    bpy.context.scene.render.use_persistent_data = True
    tmp = tempfile.mkdtemp(prefix="tt_food_")
    paths = []
    for n, ob in items.items():
        for o in items.values():
            o.hide_render = o is not ob
        p = os.path.join(tmp, f"{n}.png")
        C.render_to(p)
        paths.append(p)
    frames = [atlas.clean_alpha(atlas.load_rgba(p)) for p in paths]
    box = atlas.union_bbox(frames)
    sheet, rects, (cols, rows) = atlas.pack(frames, box, 2048)
    if a.preview:
        atlas.save_rgba(atlas.preview(sheet), a.preview, "PNG")
    atlas.save_rgba(atlas.bleed_edges(sheet), os.path.join(a.out, "food.webp"), "WEBP", 90)
    u = world_to_camera_view(bpy.context.scene, cam, Vector((0, 0, 0)))
    px, py = u.x * FRAME_PX, (1 - u.y) * FRAME_PX
    x0, y0, x1, y1 = box
    cw, ch = x1 - x0, y1 - y0
    manifest = {
        "format": "pwtv-sprites", "version": 1, "name": "food", "image": "food.webp", "fallback": None, "normals": None,
        "size": {"w": int(sheet.shape[1]), "h": int(sheet.shape[0])}, "cell": {"w": cw, "h": ch}, "grid": {"cols": cols, "rows": rows},
        "directions": 1, "framesPerDirection": len(names), "fps": 1, "angle0": 0,
        "pivot": {"x": round((px - x0) / cw, 4), "y": round((py - y0) / ch, 4)},
        "pixelsPerMetre": round(FRAME_PX / FRAME_M, 3),
        "camera": {"type": "ortho", "elevationDeg": L.PITCH, "fovDeg": None}, "shadow": True, "frames": rects,
        "names": names,
        "source": {"generator": "tools/blender/tiffin/render_food.py", "licence": "original (modelled in code), CC0"},
    }
    with open(os.path.join(a.out, "food.json"), "w") as fh:
        json.dump(manifest, fh, indent=1)
    shutil.rmtree(tmp, ignore_errors=True)
    C.log(f"food sprites: {len(names)} cells {cw}x{ch}, atlas {sheet.shape[1]}x{sheet.shape[0]}, {time.time() - t0:.1f}s")

    if not a.no_glb:
        bpy.data.objects.remove(floor, do_unlink=True)
        for o in list(bpy.context.scene.objects):
            if o.type != "MESH":
                bpy.data.objects.remove(o, do_unlink=True)
        for i, ob in enumerate(items.values()):
            ob.hide_render = False
            ob.location = (i * 0.8, 0, 0)  # spread out (the game reads each node by name and re-centres it)
        bpy.ops.export_scene.gltf(filepath=os.path.join(a.out, "food.glb"), export_format="GLB", export_apply=True,
                                  export_draco_mesh_compression_enable=False, export_yup=True, export_lights=False, export_cameras=False)
        C.log(f"food.glb: {os.path.getsize(os.path.join(a.out, 'food.glb')) // 1024} KB")


if __name__ == "__main__":
    main()
