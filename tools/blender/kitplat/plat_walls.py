"""
kitplat wall details: things fixed to the face of the ground's fill tiles so long walls never look like wallpaper
(barred windows and pipes on the monsoon rooftops, painted rangoli medallions and lamp niches in the festival
lanes, carved lotus panels and moss in the step-well). Each is one tile cell [0, 1] × [0, 1] on a transparent
background; the game scatters them over fill tiles.
"""
from __future__ import annotations

import math

import plat_common as P
from plat_world import bx, prism


def monsoon(W):
    metal = W.m_metal

    def window():
        bx(P.mat("#2a6f97", 0.5, coat=0.3), 0.18, 0.82, 0.2, 0.86, y0=-0.56, y1=-0.46, bevel=0.02)
        bx(P.mat("#ffd9a0", 0.4, emit=1.6), 0.24, 0.76, 0.26, 0.8, y0=-0.58, y1=-0.55, bevel=0)
        for i in range(5):
            P.bake(P.cyl(metal, (0.28 + i * 0.11, -0.6, 0.53), 0.012, 0.56, verts=6))
        bx(P.mat("#d8433a", 0.6), 0.12, 0.88, 0.86, 0.94, y0=-0.62, bevel=0.01)   # a little sunshade
        bx(P.mat("#5a3b22", 0.7), 0.15, 0.85, 0.16, 0.2, y0=-0.62, bevel=0.01)

    def pipe():
        P.bake(P.cyl(P.mat("#5d6a70", 0.35, metal=0.7), (0.3, -0.56, 0.5), 0.06, 1.0, verts=14))
        for z in (0.15, 0.85):
            bx(metal, 0.22, 0.38, z - 0.03, z + 0.03, y0=-0.64, bevel=0.005)
        bx(P.mat("#3d4a52", 0.1, coat=1.0), 0.45, 0.7, 0.06, 0.1, y0=-0.55, bevel=0)  # a wet streak

    def ac():
        bx(P.mat("#d9dcd6", 0.45), 0.12, 0.88, 0.25, 0.75, y0=-0.85, y1=-0.5, bevel=0.03)
        P.bake(P.torus(metal, (0.38, -0.86, 0.5), 0.17, 0.02, rot=(90, 0, 0)))
        for i in range(4):
            bx(metal, 0.62, 0.82, 0.32 + i * 0.1, 0.35 + i * 0.1, y0=-0.87, bevel=0)

    return [("wall-window", window), ("wall-pipe", pipe), ("wall-ac", ac)]


def festival(W):
    def medallion():
        for i, (r, c) in enumerate(((0.36, "#f4efe2"), (0.3, "#e8336d"), (0.22, "#ffd23f"), (0.13, "#2ec4b6"))):
            P.bake(P.cyl(P.mat(c, 0.6), (0.5, -0.52 - i * 0.004, 0.5), r, 0.01, rot=(90, 0, 0), verts=32))
        for k in range(8):
            a = k * math.pi / 4
            P.bake(P.sphere(P.mat("#f4efe2", 0.6), (0.5 + math.cos(a) * 0.3, -0.54, 0.5 + math.sin(a) * 0.3), (0.035, 0.01, 0.035), r=1, seg=8))

    def niche():
        P.bake(prism(P.mat("#2a1610", 0.9), [(0.25, 0.15), (0.75, 0.15), (0.75, 0.62), (0.5, 0.85), (0.25, 0.62)], -0.53, -0.4))
        P.bake(P.sphere(P.mat("#a5532d", 0.7), (0.5, -0.5, 0.22), (0.12, 0.08, 0.05), r=1, seg=12))
        P.bake(P.cone(P.mat("#ffcf5a", 0.2, emit=6.0), (0.52, -0.52, 0.33), 0.04, 0.0, 0.13, verts=8))

    def garland():
        for i in range(11):
            t = i / 10
            P.bake(P.sphere(P.mat("#ff9214" if i % 2 else "#ffd23f", 0.8, bump=0.5, bump_scale=120), (0.05 + t * 0.9, -0.55, 0.8 - 0.25 * math.sin(math.pi * t)), (0.05, 0.05, 0.05), r=1, seg=8))
        for x in (0.05, 0.95):
            P.bake(P.sphere(P.mat("#3f8f3a", 0.6), (x, -0.56, 0.72), (0.06, 0.02, 0.12), r=1, seg=8))

    return [("wall-medallion", medallion), ("wall-niche", niche), ("wall-garland", garland)]


def stepwell(W):
    carve = P.mat("#a77d4c", 0.85, bump=0.4, bump_scale=30)

    def lotus():
        bx(P.mat("#c99a62", 0.8), 0.1, 0.9, 0.1, 0.9, y0=-0.53, y1=-0.45, bevel=0.03)
        for k in range(8):
            a = k * math.pi / 4
            P.bake(P.sphere(carve, (0.5 + math.cos(a) * 0.2, -0.55, 0.5 + math.sin(a) * 0.2), (0.12, 0.02, 0.06), rot=(0, -math.degrees(a), 0), r=1, seg=10))
        P.bake(P.sphere(carve, (0.5, -0.56, 0.5), (0.09, 0.02, 0.09), r=1, seg=12))

    def arch():
        P.bake(prism(P.mat("#1f1610", 0.95), [(0.22, 0.05), (0.78, 0.05), (0.78, 0.6), (0.5, 0.9), (0.22, 0.6)], -0.53, -0.4))
        P.bake(P.cyl(carve, (0.2, -0.55, 0.35), 0.05, 0.6, verts=10))
        P.bake(P.cyl(carve, (0.8, -0.55, 0.35), 0.05, 0.6, verts=10))
        P.bake(P.sphere(P.mat("#d6a23a", 0.3, metal=0.8), (0.5, -0.5, 0.18), (0.08, 0.06, 0.08), r=1, seg=10))

    def moss():
        m = P.mat("#4a7a34", 0.85, bump=0.6, bump_scale=40)
        for k in range(9):
            x = 0.12 + (k * 0.37) % 0.8
            z = 0.7 + ((k * 0.53) % 0.3)
            P.bake(P.sphere(m, (x, -0.52, z), (0.12, 0.03, 0.08), r=1, seg=10))
        for k in range(3):
            P.bake(P.cyl(m, (0.25 + k * 0.25, -0.53, 0.5), 0.015, 0.45 + k * 0.1, verts=6))

    return [("wall-lotus", lotus), ("wall-arch", arch), ("wall-moss", moss)]


WALLS = {"monsoon": monsoon, "festival": festival, "stepwell": stepwell}
