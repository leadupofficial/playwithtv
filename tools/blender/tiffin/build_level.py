"""
Tiffin Tornado: builds one level's kitchen carriage from its layout and renders the lite-tier backdrops (Cycles,
baked light: sun through the barred windows, warm lamps, soft shadows, AgX) and/or exports the static scene as a
GLB for the real-time tiers. Also writes `kitchen-<n>.json`: the camera the game must use so its sprites line up
with the backdrop exactly.

  node -e "…"   # writes levels.json from apps/web/src/games/tiffin/levels.ts (see README.md)
  blender -b --factory-startup -P tools/blender/tiffin/build_level.py -- --levels levels.json --level 1 \
      --kit <KayKit Restaurant Bits gltf dir> --hdri sky_2k.hdr --out apps/web/public/assets/tiffin --still --glb

Variants (stills): day; level 3 also renders doors-shut and a dark (tunnel) version.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402

import tt_common as T  # noqa: E402
import pwtv_common as C  # noqa: E402
import tt_carriage as K  # noqa: E402
import tt_light as L  # noqa: E402
import tt_stations as St  # noqa: E402

MARGIN = 1.1
IMG = (1408, 792)


def args():
    p = argparse.ArgumentParser()
    p.add_argument("--levels", required=True)
    p.add_argument("--level", type=int, required=True)
    p.add_argument("--kit", required=True)
    p.add_argument("--hdri")
    p.add_argument("--out", required=True)
    p.add_argument("--still", action="store_true")
    p.add_argument("--glb", action="store_true")
    p.add_argument("--samples", type=int, default=96)
    p.add_argument("--scale", type=float, default=1.0, help="render size multiplier (0.5 for quick looks)")
    p.add_argument("--variants", default="", help="comma list (day,shut,dark); default: all that apply")
    p.add_argument("--preview", help="directory for opaque previews of each still (for review)")
    return C.parse(p)


def facing(layout, c, r) -> float:
    H, W = len(layout), len(layout[0])

    def floor(cc, rr):
        return 0 <= rr < H and 0 <= cc < W and layout[rr][cc] in ".|"
    if floor(c, r + 1):
        return 0.0
    if floor(c + 1, r):
        return math.pi / 2
    if floor(c - 1, r):
        return -math.pi / 2
    if floor(c, r - 1):
        return math.pi
    return 0.0


def build(a, layout):
    H, W = len(layout), len(layout[0])
    kit = {}
    for n in St.KIT_PIECES:
        ob = T.import_kaykit(os.path.join(a.kit, n + ".gltf"), "kit_" + n)
        ob.hide_render = ob.hide_viewport = True
        kit[n] = ob
    static, doors_open, doors_shut = [], [], []
    pos = lambda c, r: (c - (W - 1) / 2, (H - 1) / 2 - r)  # noqa: E731
    variant = 0
    stoves_back = set()
    for r, row in enumerate(layout):
        for c, code in enumerate(row):
            if code in ".|":
                continue
            x, y = pos(c, r)
            rz = facing(layout, c, r)
            if a.level == 3 and c == (W - 1) // 2 and code == "h":
                rz = 0.0
            parts = St.station(code, kit, variant)
            variant += 1
            for o in parts:
                # rotate about the cell centre, then move there
                lx, ly = o.location.x, o.location.y
                o.location.x = x + lx * math.cos(rz) - ly * math.sin(rz)
                o.location.y = y + lx * math.sin(rz) + ly * math.cos(rz)
                o.rotation_euler.z += rz
            static += parts
            if r == 0 and code in "tikp":
                stoves_back.add(c)
    static += K.planks(W, H)
    # back wall: windows wherever no stove hood hangs
    xs = []
    x = -W / 2 + 1.3
    while x < W / 2 - 1.0:
        xs.append(x)
        x += 2.2
    yb = H / 2 + K.WALL_T / 2
    holes = []
    for x in xs:
        c = int(round(x + (W - 1) / 2))
        if any(abs(c - s) <= 0 for s in stoves_back):
            continue
        holes.append((x, K.WIN["w"], K.WIN["z0"], K.WIN["z1"]))
    static += K.wall_with_holes(W + 2 * K.WALL_T, holes, (0, yb), along_x=True)
    for hx, *_ in holes:
        static += K.train_window(hx, yb, -1)
    lamps = []
    # decorate the wall between the windows: shelves of tiffin carriers, a menu board, a fan, brass lamps
    edges = [-W / 2] + [e for h in holes for e in (h[0] - h[1] / 2 - 0.08, h[0] + h[1] / 2 + 0.08)] + [W / 2]
    gaps = sorted(((edges[i], edges[i + 1]) for i in range(0, len(edges), 2)), key=lambda g: g[0])
    widest = max(gaps, key=lambda g: g[1] - g[0])
    yw = yb - K.WALL_T / 2
    for k, (g0, g1) in enumerate(gaps):
        gw, mid = g1 - g0, (g0 + g1) / 2
        if gw < 0.45:
            continue
        if (g0, g1) == widest:
            static += K.menu_board(mid - gw * 0.22, yw, -1)
            static += K.wall_shelf(mid + gw * 0.25, yw, -1, width=min(1.0, gw * 0.42))
        elif k == 0:
            static += K.wall_fan(mid, yw, -1, z=1.62)
        elif gw > 0.9:
            static += K.wall_shelf(mid, yw, -1, width=min(1.5, gw - 0.25))
        static += K.brass_lamp(g0 + 0.18 if k else g1 - 0.18, yw, -1)
        lamps.append((g0 + 0.18 if k else g1 - 0.18, yw - 0.3, 1.82))
    static += K.garland(-W / 2, W / 2, yb - 0.12, K.WALL_H - 0.08)
    # side walls: the pass (serving window) and the dirty-plate hatch on the right
    right = []
    for r, row in enumerate(layout):
        if row[W - 1] == "w":
            right.append(((H - 1) / 2 - r, 1.0, 0.62, 1.7))
        if row[W - 1] == "d":
            right.append(((H - 1) / 2 - r, 0.8, 0.6, 1.1))
    static += K.side_wall(W, H, 1, merge_holes(right))
    ws = [r for r, row in enumerate(layout) if row[W - 1] == "w"]
    if ws:
        x, _ = pos(W - 1, 0)
        static += K.serve_sign(x - 0.05, (H - 1) / 2 - sum(ws) / len(ws) + 0.25)
    static += K.side_wall(W, H, -1, [])
    static += K.front_cut(W, H)
    static += K.undercarriage(W, H)
    static += K.bellows_and_neighbours(W, H)
    if a.level == 3:
        cx = (W - 1) // 2
        rows = [((H - 1) / 2 - r, layout[r][cx]) for r in range(H)]
        part, doors_open = K.partition(pos(cx, 0)[0], rows, shut=False)
        _, doors_shut = K.partition(pos(cx, 0)[0], rows, shut=True)
        for o in _:
            bpy.data.objects.remove(o, do_unlink=True)
        static += part
    return static, doors_open, doors_shut, lamps


def merge_holes(holes):
    """Adjacent wall openings of the same kind become one long opening."""
    holes = sorted(holes, key=lambda h: h[0])
    out = []
    for h in holes:
        if out and abs(out[-1][0] + out[-1][1] / 2 - (h[0] - h[1] / 2)) < 0.05 and out[-1][2:] == h[2:]:
            p = out.pop()
            lo, hi = p[0] - p[1] / 2, h[0] + h[1] / 2
            out.append(((lo + hi) / 2, hi - lo, h[2], h[3]))
        else:
            out.append(h)
    return out


def lights(lamps, dark: bool, hdri):
    L.sky_world(hdri, 0.04 if dark else 0.5, rotation=2.2)
    if not dark:
        sun = bpy.data.lights.new("sun", "SUN")
        sun.energy = 5.5
        sun.angle = math.radians(1.5)
        sun.color = (1.0, 0.93, 0.8)
        so = bpy.data.objects.new("sun", sun)
        bpy.context.scene.collection.objects.link(so)
        so.rotation_euler = (math.radians(-48), math.radians(14), math.radians(-12))  # from the north, high: through the windows
    for i, (x, y, z) in enumerate([(-4, -0.5, 4.0), (0, -0.5, 4.0), (4, -0.5, 4.0)]):
        L.area(f"ceiling{i}", 150 if dark else 170, (1.0, 0.72, 0.48) if dark else (1.0, 0.86, 0.68), 2.2, (x, y, z), (x, y + 0.6, 0), shadow=True, glossy=False)
    for x, y, z in lamps:
        K.lamp_light(x, y, z, power=55 if dark else 22)


def camera_for(W, H):
    e = math.radians(L.PITCH)
    s_front = -0.85 * math.cos(e) - (H / 2) * math.sin(e)
    s_top = 2.35 * math.cos(e) + (H / 2 + 0.2) * math.sin(e)
    s_c = (s_front + s_top) / 2 + 0.32
    yt = s_c / math.sin(e)
    view_w = W + 3.4
    return view_w, (0.0, yt, 0.0)


def main():
    a = args()
    t0 = time.time()
    os.makedirs(a.out, exist_ok=True)
    layout = next(l["layout"] for l in json.load(open(a.levels)) if l["id"] == a.level)
    H, W = len(layout), len(layout[0])
    C.empty_scene()
    static, doors_open, doors_shut, lamps = build(a, layout)
    view_w, target = camera_for(W, H)
    cam = L.camera(target=target, ortho_scale=view_w * MARGIN)
    name = f"kitchen-{a.level}"
    info = {
        "format": "tiffin-kitchen", "version": 1, "level": a.level, "pitchDeg": L.PITCH, "viewWidth": round(view_w, 4), "margin": MARGIN,
        "target": [target[0], target[2], -target[1]], "image": {"w": IMG[0], "h": IMG[1]}, "cols": W, "rows": H,
        "occluders": St.OCCLUDER_HEIGHT, "backdrops": {},
    }
    if a.still:
        variants = [v for v in (a.variants.split(",") if a.variants else ["day", "shut", "dark"]) if v == "day" or a.level == 3]
        for v in variants:
            for o in list(bpy.context.scene.objects):
                if o.type == "LIGHT":
                    bpy.data.objects.remove(o, do_unlink=True)
            for o in doors_open:
                o.hide_render = v == "shut"
            for o in doors_shut:
                o.hide_render = v != "shut"
            lights(lamps, v == "dark", a.hdri)
            C.setup_render("cycles", a.samples, int(IMG[0] * a.scale), int(IMG[1] * a.scale), transparent=True, look="AgX - Punchy")
            bpy.context.scene.view_settings.exposure = -0.55
            png = os.path.join(a.out, f"{name}-{v}.png")
            C.render_to(png)
            import pwtv_atlas as atlas
            img = atlas.load_rgba(png)
            atlas.save_rgba(img, os.path.join(a.out, f"{name}-{v}.webp"), "WEBP", 86)
            if a.preview:
                atlas.save_rgba(atlas.preview(img, (0.45, 0.62, 0.38), (0.35, 0.3, 0.25)), os.path.join(a.preview, f"{name}-{v}-preview.png"), "PNG")
            os.remove(png)
            info["backdrops"][v] = f"{name}-{v}.webp"
            C.log(f"{name}-{v}: {time.time() - t0:.0f}s")
    with open(os.path.join(a.out, f"{name}.json"), "w") as fh:
        json.dump(info, fh, indent=1)
    if a.glb:
        export_glb(static, doors_open, os.path.join(a.out, f"{name}.glb"))
    C.log(f"done in {time.time() - t0:.0f}s")


def export_glb(static, doors, path):
    for o in list(bpy.context.scene.objects):
        if o.type in ("LIGHT", "CAMERA") or o.name.startswith("kit_"):
            bpy.data.objects.remove(o, do_unlink=True)
    for o in static + doors:
        if o.name in bpy.data.objects and o.data and o.data.users > 1:
            o.data = o.data.copy()
    keep = [o for o in static if o.name in bpy.data.objects]
    kitchen = T.join(keep, "kitchen")
    objs = [kitchen]
    if doors:
        objs.append(T.join([o for o in doors if o.name in bpy.data.objects], "doors"))
    for o in list(bpy.context.scene.objects):
        if o not in objs:
            bpy.data.objects.remove(o, do_unlink=True)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", export_apply=True, export_draco_mesh_compression_enable=False,
                              export_yup=True, export_lights=False, export_cameras=False, export_image_format="AUTO")
    C.log(f"{os.path.basename(path)}: {os.path.getsize(path) // 1024} KB")


if __name__ == "__main__":
    main()
