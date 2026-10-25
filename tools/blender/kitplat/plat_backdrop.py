"""
kitplat backdrops: three parallax layers per world (sky, far, mid), each seamless left-to-right so the game can
scroll them forever. Objects are placed at x in [0, W) and copied at x ± W; the orthographic camera sees exactly
one period. Sky is opaque; far and mid have alpha. Full 1920×1080 WebP plus a 960×540 -lite copy each.

  blender -b --factory-startup -P tools/blender/kitplat/plat_backdrop.py -- <world> <out_dir> [preview.png]
"""
from __future__ import annotations

import json
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
import numpy as np  # noqa: E402

import plat_common as P  # noqa: E402
import pwtv_atlas as atlas  # noqa: E402

W, H = 32.0, 18.0
RES = (1920, 1080)


def emit(hexc, strength=1.0):
    m = bpy.data.materials.new("e")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    o = nt.nodes.new("ShaderNodeOutputMaterial")
    e = nt.nodes.new("ShaderNodeEmission")
    e.inputs["Color"].default_value = P.rgba(hexc)
    e.inputs["Strength"].default_value = strength
    nt.links.new(e.outputs[0], o.inputs[0])
    return m


def sky_plane(top, horizon, cloud, cloud_k=0.5, stars=0.0, glow=None):
    """A full-frame emission plane: vertical gradient, periodic clouds (and stars), optional sun/moon glow."""
    import plat_tex as T
    m = bpy.data.materials.new("sky")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    nt.links.new(em.outputs[0], out.inputs[0])
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(tc.outputs["Object"], sep.inputs["Vector"])
    grad = nt.nodes.new("ShaderNodeMapRange")
    grad.inputs["From Min"].default_value = 0
    grad.inputs["From Max"].default_value = H
    nt.links.new(sep.outputs["Z"], grad.inputs["Value"])
    g = T.ramp(nt, grad.outputs["Result"], [(0.0, horizon), (0.75, top)])
    vec, w = T.periodic(nt, W, H / 1.5, 3.0)
    n = T.noise(nt, vec, w, 0.9, 8, 0.6)
    mask = T.ramp(nt, n.outputs["Fac"], [(0.5, "#000000"), (0.7, "#ffffff")])
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    k = nt.nodes.new("ShaderNodeMath")
    k.operation = "MULTIPLY"
    k.inputs[1].default_value = cloud_k
    nt.links.new(mask.outputs["Color"], k.inputs[0])
    nt.links.new(k.outputs[0], mix.inputs["Factor"])
    nt.links.new(g.outputs["Color"], mix.inputs[6])
    mix.inputs[7].default_value = P.rgba(cloud)
    col = mix.outputs[2]
    if stars:
        vec2, w2 = T.periodic(nt, W, H * 4, 40.0)
        sv = T.voronoi(nt, vec2, w2, 1.0, "F1")
        st = T.ramp(nt, sv.outputs["Distance"], [(0.0, "#ffffff"), (0.04, "#000000")])
        add = nt.nodes.new("ShaderNodeMix")
        add.data_type = "RGBA"
        add.blend_type = "ADD"
        add.inputs["Factor"].default_value = stars
        nt.links.new(col, add.inputs[6])
        nt.links.new(st.outputs["Color"], add.inputs[7])
        col = add.outputs[2]
    nt.links.new(col, em.inputs["Color"])
    bpy.ops.mesh.primitive_plane_add(size=1)
    pl = bpy.context.active_object
    pl.scale = (W * 3, H * 2, 1)
    pl.rotation_euler = (math.pi / 2, 0, 0)
    pl.location = (W / 2, 20, H / 2)
    P.bake(pl)
    pl.data.materials.append(m)
    if glow:
        x, z, r, c = glow
        for dx in (-W, 0, W):
            glow_disc(x + dx, z, r * 4.0, c, 0.9, 19.0)
            P.sphere(emit(c, 6.0), (x + dx, 18.9, z), (r, 0.01, r), r=1, seg=40)


def glow_disc(x, z, radius, hexc, strength=1.0, y=19.0):
    """A soft radial glow (transparent at the rim): sun haze, moon halos, lamp glows."""
    m = bpy.data.materials.new("glow")
    m.use_nodes = True
    try:
        m.surface_render_method = "BLENDED"
    except AttributeError:
        m.blend_method = "BLEND"
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    gr = nt.nodes.new("ShaderNodeTexGradient")
    gr.gradient_type = "SPHERICAL"
    nt.links.new(tc.outputs["Object"], gr.inputs["Vector"])
    pw = nt.nodes.new("ShaderNodeMath")
    pw.operation = "POWER"
    pw.inputs[1].default_value = 2.2
    nt.links.new(gr.outputs["Fac"], pw.inputs[0])
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = P.rgba(hexc)
    em.inputs["Strength"].default_value = strength * 3
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(pw.outputs[0], mix.inputs["Fac"])
    nt.links.new(tr.outputs[0], mix.inputs[1])
    nt.links.new(em.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs[0])
    bpy.ops.mesh.primitive_plane_add(size=2)
    pl = bpy.context.active_object
    pl.data.materials.append(m)
    pl.rotation_euler = (math.pi / 2, 0, 0)
    pl.scale = (radius, radius, 1)
    pl.location = (x, y, z)
    return pl


def rep(build, xs):
    """Builds an object at every periodic copy of each x."""
    for x in xs:
        for dx in (-W, 0, W):
            build(x + dx)


def setup_layer(transparent):
    P.setup(RES[0], RES[1], samples=24, transparent=transparent)
    cam = bpy.context.scene.camera
    cam.data.ortho_scale = W
    cam.location = (W / 2, -30, H / 2)
    cam.rotation_euler = (math.pi / 2, 0, 0)


def resize(img, w, h):
    """Bilinear resize with premultiplied alpha (numpy)."""
    H0, W0 = img.shape[:2]
    pm = img.copy()
    pm[:, :, :3] *= pm[:, :, 3:4]
    ys = np.linspace(0, H0 - 1, h)
    xs = np.linspace(0, W0 - 1, w)
    y0 = np.floor(ys).astype(int)
    x0 = np.floor(xs).astype(int)
    y1 = np.minimum(y0 + 1, H0 - 1)
    x1 = np.minimum(x0 + 1, W0 - 1)
    fy = (ys - y0)[:, None, None]
    fx = (xs - x0)[None, :, None]
    a = pm[y0][:, x0] * (1 - fx) + pm[y0][:, x1] * fx
    b = pm[y1][:, x0] * (1 - fx) + pm[y1][:, x1] * fx
    out = a * (1 - fy) + b * fy
    al = np.maximum(out[:, :, 3:4], 1e-6)
    out[:, :, :3] = np.where(out[:, :, 3:4] > 0, out[:, :, :3] / al, 0)
    return out.astype(np.float32)


def save_layer(img, out, name, quality=80, lite=True):
    os.makedirs(out, exist_ok=True)
    if img.shape[2] == 4 and img[:, :, 3].min() > 0.99:
        pass
    P.save_still(atlas.bleed_edges(img), os.path.join(out, f"{name}.webp"), quality)
    if lite:
        P.save_still(atlas.bleed_edges(resize(img, 1280, 720)), os.path.join(out, f"{name}-lite.webp"), quality)
    P.log(f"{name}: {img.shape[1]}x{img.shape[0]} + lite")


def main():
    a = P.argv()
    world, out = a[0], a[1]
    preview = a[2] if len(a) > 2 and a[2] != "-" else None
    import plat_scenery as S
    builders = S.SCENERY[world]
    imgs = []
    for layer in ("sky", "far", "mid", "fg"):
        P.reset()
        P.light_rig(world)
        P.side_camera((W / 2, 0, H / 2), W, elevation=0)
        random.seed({"sky": 1, "far": 2, "mid": 3, "fg": 4}[layer])
        builders[layer]()
        setup_layer(layer != "sky")
        if layer != "sky":
            bpy.context.scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 1.2
        img = P.render_rgba()
        # lite gets the mid layer alone (sky + far are pre-composited below); the foreground is high/ultra only
        save_layer(img, out, f"bg-{world}-{layer}", lite=layer == "mid")
        if layer != "fg":
            imgs.append(img)
    # lite tier: the sky and far layers pre-composited into one opaque layer (one full-screen pass less on the
    # TV), and where each alpha layer's content begins (the game trims the quad above it: fewer fragments)
    sky, far, mid = imgs
    back = sky.copy()
    al = far[:, :, 3:4]
    back[:, :, :3] = far[:, :, :3] * al + sky[:, :, :3] * (1 - al)
    back[:, :, 3] = 1
    P.save_still(resize(back, 1280, 720), os.path.join(out, f"bg-{world}-back-lite.webp"), 80)
    bounds = {}
    for name, im in (("far", far), ("mid", mid)):
        rows = np.nonzero(im[:, :, 3].max(axis=1) > 0.02)[0]
        bounds[name] = {"top": round(1 - (rows.min() / im.shape[0] if len(rows) else 1), 4)}
    with open(os.path.join(out, f"bg-{world}.json"), "w") as fh:
        json.dump(bounds, fh)
    P.log(f"bg-{world}: back-lite composite, content bounds {bounds}")
    if preview:
        comp = imgs[0].copy()
        for im in imgs[1:]:
            al = im[:, :, 3:4]
            comp[:, :, :3] = im[:, :, :3] * al + comp[:, :, :3] * (1 - al)
        comp[:, :, 3] = 1
        atlas.save_rgba(np.ascontiguousarray(comp[::2, ::2]), preview, "PNG")


if __name__ == "__main__":
    main()
