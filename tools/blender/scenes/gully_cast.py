"""
Gully Super Over: prepares a KayKit kid (CC0) for sprite rendering: removes the cape and hat, paints the body in a
team jersey colour (the texture's shading kept), optionally puts a taped bat in the right hand, and saves a .blend
that render_sprites.py takes as --model (with --anim-from the gully animation library).

  blender -b --factory-startup -P tools/blender/scenes/gully_cast.py -- \
      --model apps/web/public/assets/kaykit-adventurers/mage.glb --jersey "#ff8a1f" --bat --out /tmp/kid-bat.blend
"""
from __future__ import annotations

import argparse
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, ".."))

import bpy  # noqa: E402
from mathutils import Matrix  # noqa: E402

import pwtv_common as C  # noqa: E402
import gully_kit as K  # noqa: E402
import gully_props as props  # noqa: E402


def args():
    p = argparse.ArgumentParser()
    p.add_argument("--model", required=True)
    p.add_argument("--jersey", default="#ff8a1f")
    p.add_argument("--bat", action="store_true")
    p.add_argument("--out", required=True)
    return p.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])


def jersey_material(src: bpy.types.Material, color: str) -> bpy.types.Material:
    """The texture's brightness × the team colour: shading and seams stay, the cloth turns team-coloured."""
    m = src.copy()
    m.name = "jersey"
    nt = m.node_tree
    b = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    link = next((l for l in nt.links if l.to_node == b and l.to_socket.name == "Base Color"), None)
    if not link:
        b.inputs["Base Color"].default_value = (*K.srgb(color), 1)
        return m
    bw = nt.nodes.new("ShaderNodeRGBToBW")
    nt.links.new(link.from_socket, bw.inputs["Color"])
    mul = nt.nodes.new("ShaderNodeMix")
    mul.data_type = "RGBA"
    mul.blend_type = "MULTIPLY"
    mul.inputs["Factor"].default_value = 1.0
    lift = nt.nodes.new("ShaderNodeMath")
    lift.operation = "MULTIPLY"
    lift.inputs[1].default_value = 2.1
    nt.links.new(bw.outputs["Val"], lift.inputs[0])
    comb = nt.nodes.new("ShaderNodeCombineColor")
    for k in ("Red", "Green", "Blue"):
        nt.links.new(lift.outputs[0], comb.inputs[k])
    nt.links.new(comb.outputs["Color"], mul.inputs[6])
    mul.inputs[7].default_value = (*K.srgb(color), 1)
    nt.links.new(mul.outputs[2], b.inputs["Base Color"])
    return m


def main():
    a = args()
    C.empty_scene()
    objs = C.import_model(a.model)
    every = [o for r in objs for o in [r, *r.children_recursive]]
    rig = next(o for o in every if o.type == "ARMATURE")
    for o in every:
        if o.type == "MESH" and ("Cape" in o.name or "Hat" in o.name):
            bpy.data.objects.remove(o, do_unlink=True)
    # the glTF importer's bone-shape helper sphere lives outside the scene; a .blend import would bring it back
    for o in list(bpy.data.objects):
        if o.name.startswith("Icosphere"):
            bpy.data.objects.remove(o, do_unlink=True)
    for o in [o for o in bpy.data.objects if o.type == "MESH"]:
        if "Body" in o.name and o.material_slots and o.material_slots[0].material:
            o.material_slots[0].material = jersey_material(o.material_slots[0].material, a.jersey)
    if a.bat:
        parts = props.bat()
        bpy.ops.object.select_all(action="DESELECT")
        for p in parts:
            p.select_set(True)
        bpy.context.view_layer.objects.active = parts[0]
        bpy.ops.object.join()
        bat = parts[0]
        bat.name = "bat"
        bone = next(b for b in rig.data.bones if b.name.startswith("handslot.r"))
        bpy.context.view_layer.update()
        # put the bat in the hand slot: handle in the palm, blade hanging along the slot's -Y like a held sword
        bat.parent = rig
        bat.parent_type = "BONE"
        bat.parent_bone = bone.name
        bat.matrix_parent_inverse = Matrix.Identity(4)
        # KayKit kids are ~1.6× real size (the game scales them by 0.62), so the bat is too
        bat.matrix_basis = (Matrix.Translation((0, -bone.length, 0)) @ Matrix.Rotation(math.pi / 2, 4, "Y")
                            @ Matrix.Rotation(math.pi, 4, "X") @ Matrix.Scale(1.6, 4))
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(a.out))
    C.log("saved", a.out)


if __name__ == "__main__":
    main()
