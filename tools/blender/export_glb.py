"""
Exports the real-time model for the high and ultra tiers: plain GLB (no Draco, meshopt or KTX2: our TV page's CSP
allows no WebAssembly), textures capped per tier, PBR materials with clear coat (KHR_materials_clearcoat), and an
optional baked ambient-occlusion map on a second UV set (glTF occlusionTexture, which three.js uses as aoMap).

  blender -b --factory-startup -P tools/blender/export_glb.py -- \
      --model car.glb --out apps/web/public/assets/cinematic/showroom/hatchback-high.glb --tier high --bake-ao

Tiers: high caps textures at 1024 px, ultra at 2048 px (--max-texture overrides). The baked AO map is 512 px
(high) or 1024 px (ultra). The lite tier never loads a GLB: it uses render_sprites.py output.
"""
from __future__ import annotations

import argparse
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402

import pwtv_common as C  # noqa: E402

TIERS = {"high": {"tex": 1024, "ao": 512}, "ultra": {"tex": 2048, "ao": 1024}}


def args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--model", required=True)
    p.add_argument("--out", required=True, help="output .glb path")
    p.add_argument("--tier", default="high", choices=sorted(TIERS))
    p.add_argument("--max-texture", type=int, help="override the tier's texture cap (px)")
    p.add_argument("--finish", default="premium", choices=["asis", "premium", "wet"])
    p.add_argument("--bake-ao", action="store_true", help="bake ambient occlusion into a second UV set")
    p.add_argument("--ao-samples", type=int, default=128)
    p.add_argument("--scale-to", type=float, help="scale so the longest horizontal side is this many metres")
    p.add_argument("--no-animations", action="store_true")
    return p.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])


def meshes(objs):
    return [o for r in objs for o in [r, *r.children_recursive] if o.type == "MESH"]


def cap_textures(limit: int) -> list[str]:
    """Downscales every image larger than `limit` (keeps aspect). Returns a log of what changed."""
    changed = []
    for img in bpy.data.images:
        w, h = img.size
        if max(w, h) > limit and img.source in ("FILE", "GENERATED"):
            f = limit / max(w, h)
            img.scale(max(1, int(w * f)), max(1, int(h * f)))
            changed.append(f"{img.name}: {w}x{h} -> {img.size[0]}x{img.size[1]}")
    return changed


def gltf_output_group() -> bpy.types.NodeTree:
    """The custom node group the glTF exporter reads extra outputs from (its 'Occlusion' input → occlusionTexture)."""
    ng = bpy.data.node_groups.get("glTF Material Output")
    if ng:
        return ng
    ng = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
    ng.interface.new_socket("Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
    ng.nodes.new("NodeGroupInput")
    return ng


def bake_ao(objs, size: int, samples: int) -> None:
    """
    Lightmap-packs every mesh into a shared second UV set "AO", bakes Cycles ambient occlusion into one image, and
    wires it into each material's glTF occlusion slot through that UV set. Base colour UVs are untouched.
    """
    ms = meshes(objs)
    for ob in ms:
        if ob.data.users > 1:  # shared mesh data would share AO; make it single-user
            ob.data = ob.data.copy()
        uv = ob.data.uv_layers.get("AO") or ob.data.uv_layers.new(name="AO")
        ob.data.uv_layers.active = uv
    bpy.ops.object.select_all(action="DESELECT")
    for ob in ms:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = ms[0]
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.lightmap_pack(PREF_CONTEXT="ALL_FACES", PREF_PACK_IN_ONE=True, PREF_MARGIN_DIV=0.3)
    bpy.ops.object.mode_set(mode="OBJECT")

    img = bpy.data.images.new("ao_bake", size, size, alpha=False)
    img.colorspace_settings.name = "Non-Color"
    group = gltf_output_group()
    nodes_for_bake = []
    for mat in {s.material for ob in ms for s in ob.material_slots if s.material}:
        mat.use_nodes = True
        nt = mat.node_tree
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = img
        uvn = nt.nodes.new("ShaderNodeUVMap")
        uvn.uv_map = "AO"
        nt.links.new(uvn.outputs["UV"], tex.inputs["Vector"])
        sep = nt.nodes.new("ShaderNodeSeparateColor")
        nt.links.new(tex.outputs["Color"], sep.inputs["Color"])
        out = nt.nodes.new("ShaderNodeGroup")
        out.node_tree = group
        nt.links.new(sep.outputs[0], out.inputs["Occlusion"])
        nt.nodes.active = tex  # the bake target
        nodes_for_bake.append(tex)
    s = bpy.context.scene
    s.render.engine = "CYCLES"
    s.cycles.samples = samples
    s.render.bake.margin = 4
    bpy.ops.object.bake(type="AO")
    img.pack()
    for ob in ms:  # the colour map stays TEXCOORD_0
        ob.data.uv_layers.active = ob.data.uv_layers[0]
        ob.data.uv_layers[0].active_render = True


def main() -> None:
    a = args()
    t0 = time.time()
    C.empty_scene()
    objs = C.import_model(a.model)
    C.pivot_root(objs, a.scale_to)
    if a.finish != "asis":
        C.premium_materials(objs, wet=a.finish == "wet")  # Coat Weight → KHR_materials_clearcoat
    tier = TIERS[a.tier]
    for line in cap_textures(a.max_texture or tier["tex"]):
        C.log("texture", line)
    C.setup_render("cycles", 32, 64, 64, transparent=False)
    if a.bake_ao:
        bake_ao(objs, tier["ao"], a.ao_samples)
        C.log(f"AO baked at {tier['ao']}px")
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=os.path.abspath(a.out),
        export_format="GLB",
        export_draco_mesh_compression_enable=False,
        export_image_format="AUTO",
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
        export_cameras=False,
        export_lights=False,
        export_animations=not a.no_animations,
        export_apply=True,
        export_yup=True,
    )
    C.log(f"exported {a.out} ({os.path.getsize(a.out) / 1024:.0f} KB) in {time.time() - t0:.1f}s")


if __name__ == "__main__":
    main()
