"""
Tiffin Tornado: turns a KayKit adventurer (CC0) into a chef: weapons, hats and capes off; a white chef's coat and
gloves, dark trousers, a puffy toque on the head bone, and an apron plus neckerchief in a "key" magenta that the
game recolours to each player's colour. Also poses the arms forward for carrying.
"""
from __future__ import annotations

import math

import bpy
from mathutils import Euler, Quaternion

from tt_common import box, cyl, mat, sphere, torus

KEEP = ("Body", "ArmLeft", "ArmRight", "Head", "LegLeft", "LegRight")
HEIGHT = 1.25  # metres, toque included


def rig_of(objs):
    for root in objs:
        for o in [root, *root.children_recursive]:
            if o.type == "ARMATURE":
                return o
    raise SystemExit("no armature")


def strip(objs, base: str):
    """Deletes weapons, hats and capes; recolours coat, gloves and trousers."""
    for root in objs:
        for o in list([root, *root.children_recursive]):
            if o.type != "MESH":
                continue
            part = o.name.replace(base + "_", "").split(".")[0]
            if part not in KEEP:
                bpy.data.objects.remove(o, do_unlink=True)
                continue
            if part in ("Body", "ArmLeft", "ArmRight"):
                o.data.materials.clear()
                o.data.materials.append(mat("chef_white"))
            elif part in ("LegLeft", "LegRight"):
                o.data.materials.clear()
                o.data.materials.append(mat("chef_trousers"))


def attach(ob, rig, bone: str):
    """Parents `ob` (built in world space at the rest pose) to a bone, keeping where it is."""
    mw = ob.matrix_world.copy()
    ob.parent = rig
    ob.parent_type = "BONE"
    ob.parent_bone = bone
    bpy.context.view_layer.update()
    ob.matrix_world = mw


def bone_head(rig, name):
    return rig.matrix_world @ rig.data.bones[name].head_local


def dress(rig, seed: int):
    """Adds the toque, apron and neckerchief (world units of the imported model)."""
    bpy.context.view_layer.update()
    head = bone_head(rig, "head")
    chest = bone_head(rig, "chest")
    hips = bone_head(rig, "hips")
    print("[pwtv] bones head", tuple(round(v, 2) for v in head), "chest", tuple(round(v, 2) for v in chest), "hips", tuple(round(v, 2) for v in hips))
    s = (head.z - hips.z)  # model scale reference
    # toque: a band and a puffy crown of spheres, on top of the head
    top = head.z + s * 0.95
    parts = [cyl(s * 0.42, s * 0.28, loc=(head.x, head.y, top - s * 0.05), material="chef_white", verts=28)]
    for k in range(7):
        a = k * 2 * math.pi / 7
        parts.append(sphere(s * 0.24, loc=(head.x + math.cos(a) * s * 0.22, head.y + math.sin(a) * s * 0.22, top + s * 0.36), material="chef_white"))
    parts.append(sphere(s * 0.3, loc=(head.x, head.y, top + s * 0.45), material="chef_white"))
    for p in parts:
        attach(p, rig, "head")
    # neckerchief at the collar
    nk = torus(s * 0.36, s * 0.07, loc=(chest.x, chest.y, chest.z + s * 0.42), material="key_magenta", major=24, minor=8)
    knot = sphere(s * 0.1, loc=(chest.x, chest.y - s * 0.36, chest.z + s * 0.36), material="key_magenta")
    for p in (nk, knot):
        attach(p, rig, "chest")
    # apron: a bib on the chest and a skirt on the hips (front = -Y)
    bib = box((s * 0.55, s * 0.05, s * 0.45), loc=(chest.x, chest.y - s * 0.43, chest.z + s * 0.05), material="key_magenta", bevel=s * 0.03)
    attach(bib, rig, "chest")
    skirt = box((s * 0.7, s * 0.05, s * 0.4), loc=(hips.x, hips.y - s * 0.42, hips.z + s * 0.12), material="key_magenta", bevel=s * 0.03, rot=(0.1, 0, 0))
    pocket = box((s * 0.28, s * 0.06, s * 0.12), loc=(hips.x, hips.y - s * 0.46, hips.z + s * 0.1), material=mat("key_magenta", color=(0.5, 0.02, 0.42)), bevel=s * 0.02)
    for p in (skirt, pocket):
        attach(p, rig, "hips")


ARM_BONES = ("upperarm.l", "upperarm.r", "lowerarm.l", "lowerarm.r", "wrist.l", "wrist.r", "hand.l", "hand.r")


def mute_arms(action, mute: bool):
    """Mutes (or restores) the arm channels of an action, so a carry pose can hold the arms out."""
    fcurves = []
    try:
        from bpy_extras import anim_utils
        for slot in action.slots:
            bag = anim_utils.action_get_channelbag_for_slot(action, slot)
            if bag:
                fcurves += list(bag.fcurves)
    except Exception:
        fcurves = list(getattr(action, "fcurves", []))
    n = 0
    for fc in fcurves:
        if any(f'"{b}"' in fc.data_path for b in ARM_BONES):
            fc.mute = mute
            n += 1
    print("[pwtv] mute_arms", action.name, mute, n, "of", len(fcurves))


# carry pose: rotations (in each bone's local space) that bring both arms forward, elbows bent, hands together
CARRY = {
    "upperarm.l": Euler((math.radians(-10), 0, math.radians(-75)), "XYZ"),
    "upperarm.r": Euler((math.radians(-10), 0, math.radians(75)), "XYZ"),
    "lowerarm.l": Euler((0, 0, math.radians(-40)), "XYZ"),
    "lowerarm.r": Euler((0, 0, math.radians(40)), "XYZ"),
}


def carry_pose(rig, on: bool, root=None):
    """Resets the (muted) arm bones; with on=True, aims them forward so the hands hold a plate in front."""
    for name in ARM_BONES:
        pb = rig.pose.bones.get(name)
        if pb:
            pb.rotation_mode = "QUATERNION"
            pb.rotation_quaternion = Quaternion()
    if not on:
        return
    from mathutils import Matrix, Vector
    # world directions for each bone (model faces -Y): upper arms forward and a bit down, forearms forward
    aims = [("upperarm.l", Vector((0.25, -0.8, -0.55))), ("upperarm.r", Vector((-0.25, -0.8, -0.55))),
            ("lowerarm.l", Vector((-0.35, -0.9, 0.05))), ("lowerarm.r", Vector((0.35, -0.9, 0.05)))]
    for name, d in aims:
        pb = rig.pose.bones.get(name)
        if not pb:
            continue
        bpy.context.view_layer.update()
        mw = rig.matrix_world @ pb.matrix
        head = mw.to_translation()
        y = (mw.to_3x3() @ Vector((0, 1, 0))).normalized()
        if root is not None:
            d = root.matrix_world.to_3x3() @ d
        q = y.rotation_difference(d.normalized())
        new = Matrix.Translation(head) @ q.to_matrix().to_4x4() @ Matrix.Translation(-head) @ mw
        pb.matrix = rig.matrix_world.inverted() @ new
    bpy.context.view_layer.update()
