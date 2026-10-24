"""
KALARI CLASH fighters: restyles the four KayKit Adventurers (CC0) into original Kalaripayattu fighters and exports
them for every render tier.

  blender -b --factory-startup -P tools/blender/kalari/fighters.py -- --src <dir with KayKit GLBs> \
      --out apps/web/public/assets/kalari-clash --blend-dir <scratch> [--preview sheet.png]

Per fighter: weapons, shields, helmets, hats and capes are removed; the palette texture is repainted in the
fighter's colours (keeping KayKit's baked gradients); a waist sash (kacha), a headband or turban and, for Mayil, a
bamboo staff with brass rings are modelled and parented to bones. Outputs:
  <id>.glb          mesh + skin, 256 px palette texture, no animations (high / ultra, kit3d Character)
  anims.glb         the shared rig with only the clips the game uses (bind by bone name)
  <blend-dir>/<id>.blend   the restyled, rigged fighter with every action, for fighter_sprites.py
"""
from __future__ import annotations

import argparse
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import pwtv_common as C  # noqa: E402

# clips the game plays (high/ultra) and renders into sprite sheets (lite)
CLIPS = [  # keep in step with apps/web/src/games/kalari/anim.ts ACTIONS
    "Unarmed_Idle", "2H_Melee_Idle", "Running_A", "Running_B", "Unarmed_Melee_Attack_Punch_A", "Unarmed_Melee_Attack_Punch_B",
    "Unarmed_Melee_Attack_Kick", "1H_Melee_Attack_Slice_Diagonal", "1H_Melee_Attack_Stab", "2H_Melee_Attack_Chop",
    "2H_Melee_Attack_Slice", "2H_Melee_Attack_Spin", "2H_Melee_Attack_Spinning", "Blocking", "Dodge_Forward", "Hit_A",
    "Jump_Full_Long", "Jump_Full_Short", "Death_A", "Cheer",
]

KEEP = ("_ArmLeft", "_ArmRight", "_Body", "_Head", "_LegLeft", "_LegRight")

# Palette swatches are 8 columns x 4 rows of vertical gradients; (col, row) -> new colour (sRGB hex). Swatches not
# listed keep their colour. Skin (0,0) and hair (1,0) are set per fighter too.
FIGHTERS = {
    "simha": dict(src="Barbarian", cape=False, palette={
        (0, 0): "#8a5434", (1, 0): "#1d1512", (6, 0): "#8a5434", (7, 0): "#6e1420", (0, 1): "#7a1626", (1, 1): "#8a5434",
        (2, 1): "#e0a630", (7, 1): "#f0d9a8", (3, 2): "#7a1626", (7, 2): "#e0a630", (3, 0): "#e0a630"},
        sash="#e0a630", sash2="#7a1626", head="turban", headc="#c41e2a", headc2="#e0a630", staff=False),
    "mayil": dict(src="Mage", cape=True, palette={
        (0, 0): "#a8704a", (1, 0): "#141016", (0, 1): "#0f6f7a", (1, 1): "#1d3f8f", (2, 1): "#0e8a6a", (7, 1): "#e3b448",
        (5, 0): "#e3b448", (4, 0): "#1d3f8f", (3, 0): "#e3b448", (3, 2): "#173c7a", (7, 2): "#e3b448", (2, 2): "#e3b448"},
        sash="#e3b448", sash2="#0e8a6a", head="crest", headc="#0e8a6a", headc2="#1d3f8f", staff=True),
    "puli": dict(src="Rogue", cape=False, palette={
        (0, 0): "#96603c", (1, 0): "#16110f", (0, 1): "#f07818", (1, 1): "#1b1b1f", (5, 0): "#1b1b1f", (6, 0): "#3a2a20",
        (7, 1): "#f2c230", (3, 2): "#24242a", (5, 2): "#96603c", (3, 0): "#f2c230"},
        sash="#1b1b1f", sash2="#f07818", head="band", headc="#d81f26", headc2="#f2c230", staff=False),
    "ashwa": dict(src="Knight", cape=False, palette={
        (0, 0): "#9c6844", (1, 0): "#18120e", (3, 0): "#f3ecdc", (7, 0): "#d8a238", (4, 0): "#7c1d22", (6, 0): "#b3202a",
        (7, 1): "#d8a238", (2, 1): "#f3ecdc", (0, 1): "#b3202a"},
        sash="#b3202a", sash2="#d8a238", head="band", headc="#f3ecdc", headc2="#d8a238", staff=False),
}


def args():
    p = argparse.ArgumentParser()
    p.add_argument("--src", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--blend-dir", required=True)
    p.add_argument("--only", default="")
    p.add_argument("--preview", help="contact sheet PNG of all fighters (Eevee)")
    p.add_argument("--tex", type=int, default=256)
    return C.parse(p)


def srgb_to_lin(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hexrgb(h: str) -> tuple[float, float, float]:
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))


def repaint(img: bpy.types.Image, palette: dict, size: int) -> None:
    """Repaints palette swatches, keeping each swatch's gradient and highlight strip; then scales to `size`."""
    w, h = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)  # bottom-up rows, linear? (sRGB image: raw values)
    sw, sh = w // 8, h // 4
    for (col, row), hexc in palette.items():
        y1 = h - row * sh
        y0 = y1 - sh
        x0 = col * sw
        block = px[y0:y1, x0:x0 + sw, :3]
        lum = block @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
        mean = float(lum.mean()) or 1e-3
        target = np.array(hexrgb(hexc), dtype=np.float32)
        k = np.clip(lum / mean, 0.35, 1.6)[..., None]
        # brighter-than-mean texels drift to white a little, darker ones keep the hue (rich shadows)
        out = np.clip(target * k, 0, 1)
        px[y0:y1, x0:x0 + sw, :3] = out
    img.pixels[:] = px.ravel()
    img.scale(size, size)
    img.update()


def mat(name: str, color: str, rough=0.6, metal=0.0, sheen=0.0, emit=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    r, g, bl = hexrgb(color)
    b.inputs["Base Color"].default_value = (srgb_to_lin(r), srgb_to_lin(g), srgb_to_lin(bl), 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if sheen:
        b.inputs["Sheen Weight"].default_value = sheen
    if emit:
        b.inputs["Emission Color"].default_value = (srgb_to_lin(r), srgb_to_lin(g), srgb_to_lin(bl), 1)
        b.inputs["Emission Strength"].default_value = emit
    return m


def bone_parent(ob: bpy.types.Object, rig: bpy.types.Object, bone: str) -> None:
    """Parents `ob` to a bone keeping its current world transform (rest pose)."""
    mw = ob.matrix_world.copy()
    ob.parent = rig
    ob.parent_type = "BONE"
    ob.parent_bone = bone
    bpy.context.view_layer.update()
    ob.matrix_world = mw


def bone_head(rig, name: str) -> Vector:
    return rig.matrix_world @ rig.data.bones[name].head_local


def add_mesh(fn, **kw) -> bpy.types.Object:
    fn(**kw)
    ob = bpy.context.active_object
    bpy.ops.object.shade_smooth()
    return ob


def body_extent(objs, z0: float, z1: float) -> tuple[float, float, float, float]:
    """x/y extent (min x, max x, min y, max y) of mesh vertices between heights z0..z1 (rest pose)."""
    xs, ys = [], []
    for ob in objs:
        mw = ob.matrix_world
        for v in ob.data.vertices:
            p = mw @ v.co
            if z0 <= p.z <= z1:
                xs.append(p.x)
                ys.append(p.y)
    return (min(xs), max(xs), min(ys), max(ys)) if xs else (-0.3, 0.3, -0.25, 0.25)


def accessories(rig, body_objs, spec, fid: str):
    made = []
    hips = bone_head(rig, "hips")
    spine = bone_head(rig, "spine")
    # waist sash (kacha): a flattened torus hugging the waist, plus two knotted tails at the front-left
    zc = (hips.z + spine.z) / 2 + 0.03
    x0, x1, y0, y1 = body_extent(body_objs, zc - 0.05, zc + 0.05)
    rx, ry = (x1 - x0) / 2 * 0.97, (y1 - y0) / 2 * 0.97
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    sash = add_mesh(bpy.ops.mesh.primitive_torus_add, major_radius=1, minor_radius=0.06, major_segments=28, minor_segments=8)
    sash.name = f"{fid}_Sash"
    sash.location = (cx, cy, zc)
    sash.scale = (rx, ry, 1.4)
    sash.data.materials.append(mat(f"{fid}_sash", spec["sash"], rough=0.7, sheen=0.6))
    made.append((sash, "hips"))
    for i, (dx, rot) in enumerate(((-0.05, 0.25), (0.04, -0.12))):
        tail = add_mesh(bpy.ops.mesh.primitive_cube_add, size=1)
        tail.name = f"{fid}_SashTail{i}"
        tail.scale = (0.07, 0.025, 0.2 - 0.04 * i)
        tail.location = (cx - rx * 0.45 + dx, cy - ry - 0.01, zc - 0.13)
        tail.rotation_euler = (0, rot, 0)
        bev = tail.modifiers.new("bevel", "BEVEL")
        bev.width, bev.segments = 0.02, 2
        tail.data.materials.append(mat(f"{fid}_sash2_{i}", spec["sash2"] if i == 0 else spec["sash"], rough=0.7, sheen=0.6))
        made.append((tail, "hips"))
    # head piece around the head bone
    head_ob = next(o for o in body_objs if o.name.endswith("_Head"))
    hlo, hhi = C.world_bounds([head_ob])
    hh = hhi.z - hlo.z
    zb = hlo.z + (0.66 if spec["head"] == "band" else 0.7) * hh
    hx0, hx1, hy0, hy1 = body_extent([head_ob], zb - 0.03, zb + 0.03)
    hcx, hcy = (hx0 + hx1) / 2, (hy0 + hy1) / 2
    hr = max(hx1 - hx0, hy1 - hy0) / 2
    if spec["head"] in ("band", "turban"):
        band = add_mesh(bpy.ops.mesh.primitive_torus_add, major_radius=hr + 0.01, minor_radius=0.045 if spec["head"] == "band" else 0.09,
                        major_segments=32, minor_segments=10)
        band.name = f"{fid}_HeadBand"
        band.location = (hcx, hcy, zb)
        band.data.materials.append(mat(f"{fid}_head", spec["headc"], rough=0.6, sheen=0.5))
        made.append((band, "head"))
        if spec["head"] == "turban":  # thalappavu: a second wrap and a gold front crest
            top = add_mesh(bpy.ops.mesh.primitive_uv_sphere_add, radius=hr * 1.04, segments=24, ring_count=12)
            top.name = f"{fid}_TurbanTop"
            top.location = (hcx, hcy, zb + 0.02)
            top.scale = (1, 1, max(0.6, (hhi.z - zb + 0.06) / (hr * 1.04)))
            top.data.materials.append(mat(f"{fid}_head_top", spec["headc"], rough=0.65, sheen=0.5))
            made.append((top, "head"))
            gem = add_mesh(bpy.ops.mesh.primitive_ico_sphere_add, radius=0.06, subdivisions=2)
            gem.name = f"{fid}_TurbanGem"
            gem.location = (hcx, hcy - hr - 0.07, zb + 0.02)
            gem.scale = (1, 0.5, 1.3)
            gem.data.materials.append(mat(f"{fid}_gem", spec["headc2"], rough=0.25, metal=1.0))
            made.append((gem, "head"))
        else:  # headband tails flying at the back
            for i, rot in enumerate((0.5, 0.2)):
                t = add_mesh(bpy.ops.mesh.primitive_cube_add, size=1)
                t.name = f"{fid}_BandTail{i}"
                t.scale = (0.05, 0.22, 0.018)
                t.location = (hcx + (i - 0.5) * 0.06, hcy + hr + 0.17, zb - 0.06 - i * 0.04)
                t.rotation_euler = (rot, 0, (i - 0.5) * 0.4)
                t.data.materials.append(mat(f"{fid}_bandtail{i}", spec["headc"], rough=0.6, sheen=0.5))
                made.append((t, "head"))
    else:  # crest: a peacock-feather fan with a gold eye
        for i in range(5):
            a = (i - 2) * 0.32
            f = add_mesh(bpy.ops.mesh.primitive_uv_sphere_add, radius=0.09, segments=16, ring_count=8)
            f.name = f"{fid}_Crest{i}"
            f.scale = (0.45, 0.25, 1.6)
            f.location = (hcx + math.sin(a) * 0.17, hcy + 0.1, hhi.z - 0.02 + math.cos(a) * 0.1)
            f.rotation_euler = (0.25, a, 0)
            f.data.materials.append(mat(f"{fid}_crest{i}", spec["headc"] if i % 2 == 0 else spec["headc2"], rough=0.35, sheen=0.3))
            made.append((f, "head"))
            eye = add_mesh(bpy.ops.mesh.primitive_uv_sphere_add, radius=0.035, segments=12, ring_count=6)
            eye.name = f"{fid}_CrestEye{i}"
            eye.location = (f.location.x + math.sin(a) * 0.1, f.location.y - 0.03, f.location.z + math.cos(a) * 0.1)
            eye.data.materials.append(mat(f"{fid}_crest_eye{i}", "#e3b448", rough=0.3, metal=0.8))
            made.append((eye, "head"))
    if spec["staff"]:  # kettukari: a bamboo staff with brass rings, held in the right hand
        hand = bone_head(rig, "handslot.r")
        staff = add_mesh(bpy.ops.mesh.primitive_cylinder_add, radius=0.035, depth=1.7, vertices=12)
        staff.name = f"{fid}_Staff"
        staff.location = hand
        staff.rotation_euler = (math.pi / 2, 0, 0)  # along the hand slot's forward axis (rest pose)
        staff.data.materials.append(mat(f"{fid}_bamboo", "#a8743a", rough=0.45, sheen=0.2))
        made.append((staff, "handslot.r"))
        for k, off in enumerate((-0.82, -0.3, 0.3, 0.82)):
            ring = add_mesh(bpy.ops.mesh.primitive_cylinder_add, radius=0.042, depth=0.05, vertices=12)
            ring.name = f"{fid}_StaffRing{k}"
            ring.location = hand + Vector((0, off, 0))
            ring.rotation_euler = (math.pi / 2, 0, 0)
            ring.data.materials.append(mat(f"{fid}_brass{k}", "#d9a441", rough=0.25, metal=1.0))
            made.append((ring, "handslot.r"))
    for ob, bone in made:
        for m in ob.modifiers:
            bpy.context.view_layer.objects.active = ob
            bpy.ops.object.modifier_apply(modifier=m.name)
        bone_parent(ob, rig, bone)
    return [o for o, _ in made]


def build(a, fid: str, spec: dict):
    C.empty_scene()
    objs = C.import_model(os.path.join(a.src, f"{spec['src']}.glb"))
    rig = next(o for r in objs for o in [r, *r.children_recursive] if o.type == "ARMATURE")
    keep = [o for o in rig.children_recursive if o.type == "MESH" and (o.name.endswith(KEEP) or (spec["cape"] and o.name.endswith("_Cape")))]
    for o in list(bpy.data.objects):
        if o.type == "MESH" and o not in keep:
            bpy.data.objects.remove(o, do_unlink=True)
    # rest pose for modelling and parenting
    ad = rig.animation_data
    ad.action = None
    for t in list(ad.nla_tracks):
        t.mute = True
    for pb in rig.pose.bones:
        pb.matrix_basis = Matrix()
    bpy.context.view_layer.update()
    img = next(n.image for m in bpy.data.materials if m.node_tree for n in m.node_tree.nodes if n.type == "TEX_IMAGE")
    repaint(img, spec["palette"], a.tex)
    img.name = f"{fid}_palette"
    img.pack()
    for m in bpy.data.materials:
        b = m.node_tree.nodes.get("Principled BSDF") if m.node_tree else None
        if b and not m.name.startswith(fid):
            b.inputs["Roughness"].default_value = 0.62
            b.inputs["Sheen Weight"].default_value = 0.35  # soft cloth sheen under the rim light
    extra = accessories(rig, keep, spec, fid)
    for o in keep:
        o.name = f"{fid}_{o.name.split('_', 1)[1]}"
    rig.name = "Rig"
    # actions: drop the clips the game never uses
    for act in list(bpy.data.actions):
        if act.name not in CLIPS:
            bpy.data.actions.remove(act)
        else:
            act.use_fake_user = True  # keep them in the .blend for fighter_sprites.py
    for t in list(ad.nla_tracks):
        ad.nla_tracks.remove(t)
    os.makedirs(a.blend_dir, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(a.blend_dir, f"{fid}.blend"))
    # mesh-only GLB
    bpy.ops.object.select_all(action="DESELECT")
    for o in [rig, *keep, *extra]:
        o.select_set(True)
    os.makedirs(a.out, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=os.path.join(a.out, f"{fid}.glb"), export_format="GLB", use_selection=True,
                              export_animations=False, export_draco_mesh_compression_enable=False,
                              export_image_format="AUTO", export_apply=False, export_yup=True)
    C.log(f"{fid}: {len(keep)} body meshes, {len(extra)} accessories")
    return rig


def export_anims(a, rig):
    """The shared rig plus the game's clips, no meshes (clips bind by bone name to every fighter)."""
    for o in list(bpy.data.objects):
        if o.type == "MESH":
            bpy.data.objects.remove(o, do_unlink=True)
    ad = rig.animation_data
    for act in bpy.data.actions:
        tr = ad.nla_tracks.new()
        tr.name = act.name
        st = tr.strips.new(act.name, int(act.frame_range[0]), act)
        st.action_slot = act.slots[0] if len(act.slots) else None
    bpy.ops.object.select_all(action="DESELECT")
    rig.select_set(True)
    bpy.ops.export_scene.gltf(filepath=os.path.join(a.out, "anims.glb"), export_format="GLB", use_selection=True,
                              export_animations=True, export_animation_mode="NLA_TRACKS", export_optimize_animation_size=True,
                              export_force_sampling=True, export_frame_step=2, export_skins=False, export_yup=True)
    C.log("anims.glb:", ", ".join(sorted(a2.name for a2 in bpy.data.actions)))


def preview(a, ids):
    """Every fighter from the front and from behind (3/4), Eevee, for review: <preview> and <preview>-back.png."""
    C.empty_scene()
    roots = []
    for i, fid in enumerate(ids):
        with bpy.data.libraries.load(os.path.join(a.blend_dir, f"{fid}.blend"), link=False) as (src, dst):
            dst.objects = list(src.objects)
        for o in dst.objects:
            if o:
                bpy.context.scene.collection.objects.link(o)
                if o.parent is None:
                    o.location = (i * 2.4, 0, 0)
                    roots.append(o)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    bpy.context.scene.collection.objects.link(cam)
    bpy.context.scene.camera = cam
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = 2.4 * len(ids) + 0.4
    cx = 2.4 * (len(ids) - 1) / 2
    cam.location = (cx, -20, 6.5)
    C.look_at(cam, Vector((cx, 0, 1.0)))
    C.light_rig("studio", None, 2.0)
    C.setup_render("eevee", 32, 1800, 640, transparent=False)
    C.render_to(a.preview)
    for o in roots:
        o.rotation_euler = (0, 0, math.pi * 0.8)
    C.render_to(a.preview.replace(".png", "-back.png"))


def main():
    a = args()
    ids = [x for x in (a.only.split(",") if a.only else FIGHTERS)]
    rig = None
    for fid in ids:
        rig = build(a, fid, FIGHTERS[fid])
    if not a.only and rig:
        export_anims(a, rig)
    if a.preview:
        preview(a, ids)


if __name__ == "__main__":
    main()
