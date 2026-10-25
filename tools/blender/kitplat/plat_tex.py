"""
kitplat periodic materials: textures that repeat exactly every PX tiles across and PY tiles up, so pre-rendered
tiles butt together without seams. Coordinates are wrapped onto circles (x -> cos/sin) and fed to 4D noise and
Voronoi; bricks use a brick size that divides the period. Use with sun lights only (uniform lighting).
"""
from __future__ import annotations

import math

import bpy

import plat_common as P

PX, PY = 4.0, 2.0  # texture period in tiles (x across, z up)


def _nodes(name: str):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    return m, nt, nt.nodes["Principled BSDF"]


def periodic(nt, px=PX, py=PY, r=1.0, offset=(0.0, 0.0)):
    """(vector, w) sockets: object coordinates wrapped so that x has period px and z has period py."""
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(tc.outputs["Object"], sep.inputs["Vector"])

    def angle(sock, period, off):
        m = nt.nodes.new("ShaderNodeMath")
        m.operation = "MULTIPLY_ADD"
        m.inputs[1].default_value = 2 * math.pi / period
        m.inputs[2].default_value = off
        nt.links.new(sock, m.inputs[0])
        return m

    def trig(a, op):
        t = nt.nodes.new("ShaderNodeMath")
        t.operation = op
        nt.links.new(a.outputs[0], t.inputs[0])
        s = nt.nodes.new("ShaderNodeMath")
        s.operation = "MULTIPLY"
        s.inputs[1].default_value = r
        nt.links.new(t.outputs[0], s.inputs[0])
        return s.outputs[0]

    ax = angle(sep.outputs["X"], px, offset[0])
    az = angle(sep.outputs["Z"], py, offset[1])
    comb = nt.nodes.new("ShaderNodeCombineXYZ")
    nt.links.new(trig(ax, "COSINE"), comb.inputs["X"])
    nt.links.new(trig(ax, "SINE"), comb.inputs["Y"])
    nt.links.new(trig(az, "COSINE"), comb.inputs["Z"])
    return comb.outputs["Vector"], trig(az, "SINE")


def noise(nt, vec, w, scale=2.0, detail=6.0, rough=0.55):
    n = nt.nodes.new("ShaderNodeTexNoise")
    n.noise_dimensions = "4D"
    n.inputs["Scale"].default_value = scale
    n.inputs["Detail"].default_value = detail
    n.inputs["Roughness"].default_value = rough
    nt.links.new(vec, n.inputs["Vector"])
    nt.links.new(w, n.inputs["W"])
    return n


def voronoi(nt, vec, w, scale=3.0, feature="DISTANCE_TO_EDGE"):
    v = nt.nodes.new("ShaderNodeTexVoronoi")
    v.voronoi_dimensions = "4D"
    v.feature = feature
    v.inputs["Scale"].default_value = scale
    nt.links.new(vec, v.inputs["Vector"])
    nt.links.new(w, v.inputs["W"])
    return v


def ramp(nt, sock, stops):
    r = nt.nodes.new("ShaderNodeValToRGB")
    els = r.color_ramp.elements
    while len(els) < len(stops):
        els.new(0.5)
    for e, (pos, hexc) in zip(els, stops):
        e.position = pos
        e.color = P.rgba(hexc)
    nt.links.new(sock, r.inputs["Fac"])
    return r


def bump(nt, b, sock, strength=0.4, distance=0.05):
    bp = nt.nodes.new("ShaderNodeBump")
    bp.inputs["Strength"].default_value = strength
    bp.inputs["Distance"].default_value = distance
    nt.links.new(sock, bp.inputs["Height"])
    nt.links.new(bp.outputs["Normal"], b.inputs["Normal"])
    return bp


def stone(name: str, dark: str, mid: str, light: str, cells=3.0, rough=0.8, mortar="#2a2420", offset=(0, 0)):
    """Irregular periodic stones with dark mortar and mottled faces (fill tiles, rubble, temple walls)."""
    m, nt, b = _nodes(name)
    vec, w = periodic(nt, offset=offset)
    edge = voronoi(nt, vec, w, cells)
    mot = noise(nt, vec, w, 3.0)
    face = ramp(nt, mot.outputs["Fac"], [(0.3, dark), (0.5, mid), (0.72, light)])
    mask = ramp(nt, edge.outputs["Distance"], [(0.0, "#000000"), (0.06, "#ffffff")])
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    nt.links.new(mask.outputs["Color"], mix.inputs["Factor"])
    mix.inputs[6].default_value = P.rgba(mortar)
    nt.links.new(face.outputs["Color"], mix.inputs[7])
    nt.links.new(mix.outputs[2], b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = rough
    hmix = nt.nodes.new("ShaderNodeMath")
    hmix.operation = "ADD"
    nt.links.new(mask.outputs["Color"], hmix.inputs[0])
    sm = nt.nodes.new("ShaderNodeMath")
    sm.operation = "MULTIPLY"
    sm.inputs[1].default_value = 0.25
    nt.links.new(mot.outputs["Fac"], sm.inputs[0])
    nt.links.new(sm.outputs[0], hmix.inputs[1])
    bump(nt, b, hmix.outputs[0], 0.6, 0.06)
    return m


def bricks(name: str, brick: str, brick2: str, mortar: str, bw=0.5, rh=0.25, rough=0.85, grime="#000000", grime_k=0.0):
    """Periodic bricks (brick width and row height divide the period) with mottling and optional grime streaks."""
    m, nt, b = _nodes(name)
    vec, w = periodic(nt)
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(tc.outputs["Object"], sep.inputs["Vector"])
    xz = nt.nodes.new("ShaderNodeCombineXYZ")
    nt.links.new(sep.outputs["X"], xz.inputs["X"])
    nt.links.new(sep.outputs["Z"], xz.inputs["Y"])
    br = nt.nodes.new("ShaderNodeTexBrick")
    br.offset = 0.5
    br.offset_frequency = 2
    br.inputs["Scale"].default_value = 1.0
    br.inputs["Brick Width"].default_value = bw
    br.inputs["Row Height"].default_value = rh
    br.inputs["Mortar Size"].default_value = 0.018
    br.inputs["Mortar Smooth"].default_value = 0.3
    br.inputs["Bias"].default_value = 0.0
    br.inputs["Color1"].default_value = P.rgba(brick)
    br.inputs["Color2"].default_value = P.rgba(brick)
    br.inputs["Mortar"].default_value = P.rgba(mortar)
    nt.links.new(xz.outputs["Vector"], br.inputs["Vector"])
    mot = noise(nt, vec, w, 4.0)
    tint = ramp(nt, mot.outputs["Fac"], [(0.35, brick2), (0.65, brick)])
    mul = nt.nodes.new("ShaderNodeMix")
    mul.data_type = "RGBA"
    mul.blend_type = "MULTIPLY"
    mul.inputs["Factor"].default_value = 1.0
    nt.links.new(br.outputs["Color"], mul.inputs[6])
    nt.links.new(tint.outputs["Color"], mul.inputs[7])
    out = mul.outputs[2]
    if grime_k:
        gn = noise(nt, vec, w, 1.2, 3)
        g = ramp(nt, gn.outputs["Fac"], [(0.45, "#ffffff"), (0.75, grime)])
        gm = nt.nodes.new("ShaderNodeMix")
        gm.data_type = "RGBA"
        gm.blend_type = "MULTIPLY"
        gm.inputs["Factor"].default_value = grime_k
        nt.links.new(out, gm.inputs[6])
        nt.links.new(g.outputs["Color"], gm.inputs[7])
        out = gm.outputs[2]
    nt.links.new(out, b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = rough
    inv = nt.nodes.new("ShaderNodeMath")
    inv.operation = "SUBTRACT"
    inv.inputs[0].default_value = 1.0
    nt.links.new(br.outputs["Fac"], inv.inputs[1])
    bump(nt, b, inv.outputs[0], 0.5, 0.04)
    return m


def mottled(name: str, a: str, bcol: str, scale=3.0, rough=0.7, bump_k=0.3, metal=0.0, emit=0.0):
    """A periodic two-colour mottle (moss, grass, plaster, water) with matching relief."""
    m, nt, b = _nodes(name)
    vec, w = periodic(nt)
    n = noise(nt, vec, w, scale)
    r = ramp(nt, n.outputs["Fac"], [(0.35, a), (0.7, bcol)])
    nt.links.new(r.outputs["Color"], b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if emit:
        nt.links.new(r.outputs["Color"], b.inputs["Emission Color"])
        b.inputs["Emission Strength"].default_value = emit
    if bump_k:
        bump(nt, b, n.outputs["Fac"], bump_k, 0.05)
    return m


def stripes(name: str, a: str, bcol: str, width=0.25, rough=0.6):
    """Vertical stripes with a period dividing PX (awnings, painted kerbs)."""
    m, nt, b = _nodes(name)
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(tc.outputs["Object"], sep.inputs["Vector"])
    md = nt.nodes.new("ShaderNodeMath")
    md.operation = "PINGPONG"
    md.inputs[1].default_value = width
    nt.links.new(sep.outputs["X"], md.inputs[0])
    st = nt.nodes.new("ShaderNodeMath")
    st.operation = "GREATER_THAN"
    st.inputs[1].default_value = width / 2
    nt.links.new(md.outputs[0], st.inputs[0])
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    nt.links.new(st.outputs[0], mix.inputs["Factor"])
    mix.inputs[6].default_value = P.rgba(a)
    mix.inputs[7].default_value = P.rgba(bcol)
    nt.links.new(mix.outputs[2], b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = rough
    b.inputs["Sheen Weight"].default_value = 0.4
    return m
