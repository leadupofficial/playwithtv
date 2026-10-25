"""
kitplat worlds: the three tile sets, built from primitives and periodic materials.
  monsoon   rain-soaked brick rooftops: wet concrete parapets with moss, striped awnings, tin-roof slopes
  festival  lantern-lit lanes: grassy earth with painted rangoli kerbs, bamboo bridges with marigold garlands
  stepwell  an ancient step-well: sandstone courses, carved cornices, stone brackets, iron gates and spike traps
Every builder works in world coordinates with the tile cell at x ∈ [k, k+1], z ∈ [0, 1], front face at y = -0.5.
"""
from __future__ import annotations

import math
import random

import bpy

import plat_common as P
import plat_tex as T


def bx(m, x0, x1, z0, z1, y0=-0.5, y1=0.6, bevel=0.03):
    ob = P.box(m, ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), (x1 - x0, y1 - y0, z1 - z0), bevel=bevel)
    return P.bake(ob)


def periodic_points(n, seed, period=4.0):
    r = random.Random(seed)
    return [r.random() * period for _ in range(n)]


def wrapped(xs, x0, x1, period=4.0):
    """Every copy of the periodic positions xs that falls in [x0, x1]."""
    out = []
    for x in xs:
        for k in range(-3, 4):
            v = x + k * period
            if x0 <= v <= x1:
                out.append(v)
    return out


def prism(m, pts, y0=-0.5, y1=0.6, name="prism"):
    """A prism from a front-face polygon [(x, z)...] extruded along y."""
    me = bpy.data.meshes.new(name)
    n = len(pts)
    verts = [(x, y0, z) for x, z in pts] + [(x, y1, z) for x, z in pts]
    faces = [list(range(n))[::-1], list(range(n, 2 * n))]
    for i in range(n):
        j = (i + 1) % n
        faces.append([i, j, n + j, n + i])
    me.from_pydata(verts, [], faces)
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob.data.materials.append(m)
    return ob


class World:
    look = "monsoon"
    cap_h = 0.45
    end_pad = 0.15

    def materials(self):
        raise NotImplementedError

    # terrain body: extends past the cell where the terrain continues, so edges never show inside the cell
    def body(self, k, L, R, top):
        x0 = k if L else k - 2
        x1 = k + 1 if R else k + 3
        return bx(self.m_fill, x0, x1, -2, 1 if top else 3, bevel=0.06 if top else 0.04)

    def terrain(self, k, L, R, top):
        self.body(k, L, R, top)
        if top:
            self.cap(k if L else k - 2, k + 1 if R else k + 3, L, R)
        else:
            self.edge_shade(k, L, R)

    def edge_shade(self, k, L, R):
        pass

    def slope(self, up):
        pts = [(0, 0), (1, 0), (1, 1)] if up else [(0, 0), (1, 0), (0, 1)]
        tri = prism(self.m_fill, pts)
        P.bake(tri)
        bx(self.m_fill, -2, 3, -2, 0, bevel=0)
        self.slope_cap(up)

    def slope_cap(self, up):
        ang = 45 if up else -45
        L = 2.2
        ob = P.box(self.m_cap, (0.5, 0.0, 0.5), (L, 1.25, 0.16), rot=(0, -ang, 0), bevel=0.04)
        ob.location = (0.5, -0.05, 0.5 + 0.06)
        P.bake(ob)


# ---------------------------------------------------------------------------------------------------------------


class Monsoon(World):
    look = "monsoon"
    cap_h = 0.4

    def materials(self):
        self.m_fill = T.bricks("brick", "#a4553a", "#7e3d2a", "#cdbfa8", grime="#3c3530", grime_k=0.55)
        self.m_cap = T.mottled("concrete", "#8f9799", "#b9bfbd", 6, rough=0.35, bump_k=0.35)
        self.m_moss = T.mottled("moss", "#3f6b2a", "#7fa63a", 10, rough=0.8, bump_k=0.6)
        self.m_tin = T.stripes("tin", "#8b9aa3", "#5f6d76", width=0.08, rough=0.3)
        self.m_awn = T.stripes("awning", "#d8433a", "#f1e7d4", width=0.25)
        self.m_metal = P.mat("#5e6b73", 0.35, metal=0.8)
        self.m_wood = T.mottled("wood", "#7a5232", "#9c6c41", 8, rough=0.7)

    def cap(self, x0, x1, L, R):
        e0 = x0 - (0.1 if L else 0)
        e1 = x1 + (0.1 if R else 0)
        bx(self.m_cap, e0, e1, 0.86, 1.14, y0=-0.62, bevel=0.05)
        bx(P.mat("#2b2724", 0.9), x0, x1, 0.8, 0.86, y0=-0.52, bevel=0)  # drip shadow line
        for x in wrapped(periodic_points(9, 3), e0 + 0.08, e1 - 0.08):
            r = 0.05 + (x * 7.3 % 1) * 0.06
            ob = P.sphere(self.m_moss, (x, -0.55 + (x * 3.1 % 1) * 0.2, 1.13), (r * 1.6, r, r * 0.8), r=1, seg=12)
            P.bake(ob)
        for x in wrapped(periodic_points(3, 11), e0 + 0.2, e1 - 0.2):  # puddles: glossy dark patches
            ob = P.sphere(P.mat("#3d4a52", 0.05, coat=1.0), (x, -0.2, 1.135), (0.22, 0.25, 0.012), r=1, seg=16)
            P.bake(ob)

    def slope_cap(self, up):
        ang = 45 if up else -45
        ob = P.box(self.m_tin, (0.5, -0.05, 0.56), (2.4, 1.25, 0.08), rot=(0, -ang, 0), bevel=0.01)
        P.bake(ob)
        ob = P.box(self.m_metal, (0.5, -0.6, 0.5), (2.4, 0.06, 0.05), rot=(0, -ang, 0), bevel=0.0)
        P.bake(ob)

    def oneway(self, side):
        x0 = -0.1 if side in "ls" else 0
        x1 = 1.1 if side in "rs" else 1
        xa, xb = (x0 if side in "ls" else -2), (x1 if side in "rs" else 3)
        ob = P.box(self.m_awn, ((xa + xb) / 2, -0.1, 0.96), (xb - xa, 1.0, 0.07), rot=(-12, 0, 0), bevel=0.01)
        P.bake(ob)
        bx(self.m_awn, xa, xb, 0.84, 0.99, y0=-0.66, y1=-0.6, bevel=0.005)          # the valance
        for x in wrapped([0.125 + 0.25 * i for i in range(16)], xa, xb):             # scallops hang below it
            P.bake(P.cyl(self.m_awn, (x, -0.62, 0.84), 0.125, 0.02, rot=(90, 0, 0), verts=20))
        P.bake(P.cyl(self.m_metal, ((xa + xb) / 2, -0.55, 0.99), 0.035, xb - xa, rot=(0, 90, 0)))
        if side in "ls":
            P.bake(P.cyl(self.m_metal, (0.0, -0.3, 0.6), 0.03, 0.8, rot=(0, 25, 0)))
        if side in "rs":
            P.bake(P.cyl(self.m_metal, (1.0, -0.3, 0.6), 0.03, 0.8, rot=(0, -25, 0)))

    def block(self):
        bx(P.mat("#c9cdc8", 0.45), 0.03, 0.97, 0.02, 0.98, bevel=0.06)
        P.bake(P.torus(self.m_metal, (0.5, -0.52, 0.5), 0.3, 0.03, rot=(90, 0, 0)))
        for i in range(5):
            P.bake(P.box(self.m_metal, (0.5, -0.52, 0.28 + i * 0.11), (0.55, 0.02, 0.025), bevel=0))
        P.bake(P.cyl(P.mat("#3a3f42", 0.6), (0.5, -0.5, 0.5), 0.07, 0.05, rot=(90, 0, 0)))

    def crate(self):
        bx(P.mat("#c99a5b", 0.75, bump=0.2, bump_scale=40), 0.04, 0.96, 0.02, 0.96, bevel=0.03)
        bx(P.mat("#e8d7a6", 0.4, coat=0.3), 0.04, 0.96, 0.45, 0.55, y0=-0.52, bevel=0)
        bx(P.mat("#d8433a", 0.5), 0.62, 0.86, 0.66, 0.84, y0=-0.53, bevel=0.005)  # a red label
        bx(P.mat("#2c62a8", 0.5), 0.14, 0.4, 0.14, 0.32, y0=-0.53, bevel=0.005)

    def spikes(self):
        bx(self.m_metal, 0.0, 1.0, 0.0, 0.12, bevel=0.01)
        for i in range(6):
            for j, y in enumerate((-0.35, 0.0, 0.3)):
                P.bake(P.cone(P.mat("#c7d0d6", 0.2, metal=0.9), (0.09 + i * 0.165 + j * 0.03, y, 0.38), 0.06, 0.0, 0.55, verts=10))

    def tspikes_base(self):
        bx(P.mat("#4a5257", 0.5, metal=0.6), 0, 1, 0.0, 0.18, bevel=0.02)
        for i in range(6):
            bx(P.mat("#111416", 0.9), 0.07 + i * 0.165, 0.15 + i * 0.165, 0.12, 0.185, y0=-0.52, bevel=0)

    def water(self, k, top):
        m = T.mottled("water", "#1d5f7a", "#3f93a8", 3, rough=0.08, bump_k=0.25, emit=0.15)
        bx(m, k - 2, k + 3, -2, 0.82 if top else 3, bevel=0)
        if top:
            bx(T.mottled("foam", "#a9dde6", "#e8f7fa", 9, rough=0.2, bump_k=0.2, emit=0.2), k - 2, k + 3, 0.78, 0.86, y0=-0.52, bevel=0)

    def ladder(self):
        for x in (0.2, 0.8):
            P.bake(P.cyl(self.m_metal, (x, -0.3, 0.5), 0.04, 1.0))
        for i in range(4):
            P.bake(P.cyl(self.m_metal, (0.5, -0.3, 0.12 + i * 0.25), 0.03, 0.6, rot=(0, 90, 0)))

    def crumble(self):
        bx(self.m_wood, 0.02, 0.98, 0.72, 1.0, bevel=0.03)
        for x in (0.3, 0.62):
            bx(P.mat("#2a1d14", 0.9), x, x + 0.03, 0.72, 1.0, y0=-0.52, bevel=0)

    def gate(self):
        for i in range(5):
            P.bake(P.cyl(self.m_metal, (0.1 + i * 0.2, -0.2, 0.5), 0.035, 1.0))
        for z in (0.15, 0.85):
            P.bake(P.box(self.m_metal, (0.5, -0.2, z), (1.0, 0.06, 0.06), bevel=0.01))

    def platform(self):
        bx(self.m_wood, -1.5, 1.5, 0.75, 1.0, bevel=0.04)
        for x in (-1.2, 1.2):
            bx(self.m_metal, x - 0.06, x + 0.06, 0.6, 0.78, bevel=0.01)

    def decos(self):
        def pot():
            P.bake(P.cyl(P.mat("#b5522e", 0.7), (0, 0, 0.22), 0.22, 0.44, scale=(1, 1, 1), verts=24))
            P.bake(P.torus(P.mat("#a24724", 0.7), (0, 0, 0.44), 0.22, 0.04))
            for i in range(9):
                a = i * 2.4
                P.bake(P.sphere(T.mottled("leaf", "#2f6b2f", "#5aa04a", 8), (math.cos(a) * 0.12, math.sin(a) * 0.12, 0.6 + (i % 3) * 0.08), (0.14, 0.1, 0.1), r=1, seg=10))

        def tank():
            P.bake(P.cyl(P.mat("#1f2224", 0.45, coat=0.4), (0, 0, 0.55), 0.42, 1.1, verts=32, bevel=0.03))
            P.bake(P.cyl(P.mat("#1f2224", 0.45), (0, 0, 1.13), 0.2, 0.08, verts=24))
            for z in (0.3, 0.6, 0.9):
                P.bake(P.torus(P.mat("#2a2e30", 0.4), (0, 0, z), 0.425, 0.02))

        def antenna():
            P.bake(P.cyl(self.m_metal, (0, 0, 0.8), 0.025, 1.6))
            for i, wdt in enumerate((0.7, 0.55, 0.4)):
                P.bake(P.cyl(self.m_metal, (0, 0, 1.2 + i * 0.16), 0.012, wdt, rot=(0, 90, 0)))

        def boxes():
            bx(P.mat("#c99a5b", 0.75), -0.45, 0.15, 0, 0.5, bevel=0.03)
            bx(P.mat("#b88a4f", 0.75), -0.1, 0.42, 0, 0.42, y0=-0.2, bevel=0.03)
            bx(P.mat("#d6ad6f", 0.75), -0.32, 0.12, 0.5, 0.82, bevel=0.03)

        return [("deco-pot", pot, 1.0, 1.0), ("deco-tank", tank, 1.2, 1.4), ("deco-antenna", antenna, 1.0, 1.8), ("deco-boxes", boxes, 1.2, 1.0)]


class Festival(World):
    look = "festival"
    cap_h = 0.45

    def materials(self):
        self.m_fill = T.stone("earth", "#5d3f2a", "#7d573b", "#9b7150", cells=2.0, mortar="#3a281c")
        self.m_cap = T.mottled("grass", "#3f7f2e", "#86b84a", 7, rough=0.85, bump_k=0.7)
        self.m_kerb = T.stripes("kerb", "#e8336d", "#ffd23f", width=0.25)
        self.m_bamboo = T.mottled("bamboo", "#b7a04a", "#d9c56a", 12, rough=0.45)
        self.m_marigold = P.mat("#ff9214", 0.8, bump=0.6, bump_scale=120)
        self.m_wood = T.mottled("wood", "#8a4f2b", "#b06b3a", 8, rough=0.6)

    def cap(self, x0, x1, L, R):
        e0, e1 = x0 - (0.08 if L else 0), x1 + (0.08 if R else 0)
        bx(self.m_kerb, e0, e1, 0.7, 0.86, y0=-0.56, bevel=0.03)
        bx(P.mat("#f3ede0", 0.5), e0, e1, 0.86, 0.9, y0=-0.57, bevel=0.01)
        bx(self.m_cap, e0 - 0.02, e1 + 0.02, 0.88, 1.08, y0=-0.5, bevel=0.07)
        for x in wrapped(periodic_points(26, 5), e0 + 0.04, e1 - 0.04):
            h = 0.1 + (x * 13.7 % 1) * 0.12
            ob = P.cone(self.m_cap, (x, -0.42 + (x * 5.3 % 1) * 0.3, 1.06 + h / 2), 0.035, 0.0, h, rot=((x * 40 % 30) - 15, 0, 0), verts=6)
            P.bake(ob)
        for x in wrapped(periodic_points(4, 9), e0 + 0.15, e1 - 0.15):
            P.bake(P.sphere(P.mat("#fff2a8", 0.4, emit=0.3), (x, -0.45, 1.12), (0.04, 0.04, 0.04), r=1, seg=8))

    def slope_cap(self, up):
        ang = 45 if up else -45
        P.bake(P.box(self.m_cap, (0.5, -0.0, 0.58), (2.4, 1.1, 0.18), rot=(0, -ang, 0), bevel=0.05))

    def oneway(self, side):
        xa, xb = (-0.1 if side in "ls" else -2), (1.1 if side in "rs" else 3)
        for z, y in ((0.95, -0.35), (0.95, 0.0), (0.88, -0.55)):
            P.bake(P.cyl(self.m_bamboo, ((xa + xb) / 2, y, z), 0.06, xb - xa, rot=(0, 90, 0), verts=12))
        for x in wrapped([0.5, 1.5, 2.5, 3.5], xa, xb):
            P.bake(P.torus(P.mat("#6b4a2a", 0.8), (x, -0.3, 0.93), 0.08, 0.015, rot=(0, 90, 0)))
        for x in wrapped([i * 0.09 for i in range(44)], xa, xb):
            sag = 0.18 * math.sin(math.pi * ((x % 1.0)))
            P.bake(P.sphere(self.m_marigold, (x, -0.62, 0.82 - sag), (0.05, 0.05, 0.05), r=1, seg=8))
        if side in "ls":
            P.bake(P.cyl(self.m_bamboo, (0.05, -0.2, 0.55), 0.05, 0.85, verts=12))
        if side in "rs":
            P.bake(P.cyl(self.m_bamboo, (0.95, -0.2, 0.55), 0.05, 0.85, verts=12))

    def block(self):
        bx(self.m_wood, 0.02, 0.98, 0.02, 0.98, bevel=0.07)
        bx(P.mat("#1f6fb2", 0.5), 0.1, 0.9, 0.1, 0.9, y0=-0.52, bevel=0.03)
        P.bake(P.torus(P.mat("#f2c230", 0.3, metal=0.8), (0.5, -0.55, 0.5), 0.24, 0.035, rot=(90, 0, 0)))
        P.bake(P.sphere(P.mat("#e8336d", 0.4), (0.5, -0.55, 0.5), (0.1, 0.05, 0.1), r=1))

    def crate(self):
        bx(P.mat("#e8336d", 0.5, coat=0.4), 0.05, 0.95, 0.02, 0.9, bevel=0.03)
        gold = P.mat("#f2c230", 0.3, metal=0.8)
        bx(gold, 0.42, 0.58, 0.02, 0.9, y0=-0.53, bevel=0)
        bx(gold, 0.05, 0.95, 0.42, 0.54, y0=-0.53, bevel=0)
        P.bake(P.torus(gold, (0.38, -0.5, 0.97), 0.1, 0.03, rot=(90, 30, 0)))
        P.bake(P.torus(gold, (0.62, -0.5, 0.97), 0.1, 0.03, rot=(90, -30, 0)))

    def spikes(self):
        bx(P.mat("#6b4a2a", 0.8), 0, 1, 0, 0.12, bevel=0.01)
        for i in range(5):
            for y in (-0.3, 0.1):
                P.bake(P.cone(P.mat("#8a8f96", 0.3, metal=0.8), (0.1 + i * 0.2, y, 0.4), 0.07, 0.0, 0.6, verts=8))

    def tspikes_base(self):
        bx(P.mat("#6b4a2a", 0.8), 0, 1, 0.0, 0.18, bevel=0.02)

    def water(self, k, top):
        m = T.mottled("pond", "#1f6f8c", "#46a7b8", 3, rough=0.06, bump_k=0.25, emit=0.15)
        bx(m, k - 2, k + 3, -2, 0.82 if top else 3, bevel=0)
        if top:
            for x in wrapped([0.7, 2.6], k - 0.5, k + 1.5):
                P.bake(P.cyl(P.mat("#3f8f3a", 0.6), (x, -0.4, 0.84), 0.22, 0.02, verts=20))
                P.bake(P.sphere(P.mat("#ff8fb1", 0.5), (x + 0.05, -0.45, 0.9), (0.07, 0.07, 0.06), r=1, seg=10))

    def ladder(self):
        for x in (0.2, 0.8):
            P.bake(P.cyl(self.m_bamboo, (x, -0.3, 0.5), 0.05, 1.0, verts=12))
        for i in range(4):
            P.bake(P.cyl(self.m_bamboo, (0.5, -0.3, 0.12 + i * 0.25), 0.035, 0.62, rot=(0, 90, 0), verts=10))

    def crumble(self):
        bx(T.mottled("clay", "#b0643a", "#d08b55", 6), 0.02, 0.98, 0.72, 1.0, bevel=0.03)
        for x in (0.33, 0.66):
            bx(P.mat("#2a1d14", 0.9), x, x + 0.03, 0.72, 1.0, y0=-0.52, bevel=0)

    def gate(self):
        for i in range(5):
            P.bake(P.cyl(self.m_bamboo, (0.1 + i * 0.2, -0.2, 0.5), 0.045, 1.0, verts=10))
        P.bake(P.box(P.mat("#6b4a2a", 0.8), (0.5, -0.25, 0.75), (1.0, 0.05, 0.08), bevel=0.01))

    def platform(self):
        for y in (-0.35, 0.0, 0.3):
            P.bake(P.cyl(self.m_bamboo, (0, y, 0.92), 0.07, 3.0, rot=(0, 90, 0), verts=12))
        for x in [i * 0.1 - 1.5 for i in range(31)]:
            sag = 0.12 * math.sin(math.pi * ((x + 1.5) / 3.0))
            P.bake(P.sphere(self.m_marigold, (x, -0.6, 0.82 - sag), (0.05, 0.05, 0.05), r=1, seg=8))

    def decos(self):
        def lantern_post():
            P.bake(P.cyl(self.m_wood, (0, 0, 0.9), 0.04, 1.8, verts=10))
            P.bake(P.cyl(self.m_wood, (0.25, 0, 1.75), 0.03, 0.55, rot=(0, 90, 0), verts=8))
            P.bake(P.sphere(P.mat("#ff5a36", 0.4, emit=2.5), (0.45, 0, 1.45), (0.16, 0.16, 0.22), r=1, seg=16))
            P.bake(P.cyl(P.mat("#f2c230", 0.3, metal=0.8), (0.45, 0, 1.69), 0.08, 0.05))

        def marigolds():
            P.bake(P.cyl(P.mat("#b5522e", 0.7), (0, 0, 0.18), 0.2, 0.36, verts=24))
            for i in range(14):
                a = i * 2.39
                r = 0.05 + (i % 4) * 0.035
                P.bake(P.sphere(self.m_marigold if i % 3 else P.mat("#ffd23f", 0.8, bump=0.5, bump_scale=120),
                                (math.cos(a) * r * 2, math.sin(a) * r, 0.42 + (i % 3) * 0.05), (0.07, 0.07, 0.06), r=1, seg=10))

        def diya_stand():
            P.bake(P.cyl(P.mat("#d6a23a", 0.3, metal=0.85), (0, 0, 0.4), 0.05, 0.8, verts=12))
            P.bake(P.cyl(P.mat("#d6a23a", 0.3, metal=0.85), (0, 0, 0.03), 0.2, 0.06, verts=24))
            P.bake(P.cyl(P.mat("#d6a23a", 0.3, metal=0.85), (0, 0, 0.82), 0.16, 0.05, verts=24))
            P.bake(P.cone(P.mat("#ffcf5a", 0.2, emit=6.0), (0, -0.05, 0.95), 0.05, 0.0, 0.16, verts=10))

        def banana():
            P.bake(P.cyl(T.mottled("trunk", "#6f7d3a", "#8f9c4a", 8), (0, 0, 0.6), 0.09, 1.2, verts=12))
            for i in range(6):
                a = i * 60
                ob = P.sphere(T.mottled("leafb", "#2f7d32", "#69b04a", 6), (math.cos(math.radians(a)) * 0.35, math.sin(math.radians(a)) * 0.2, 1.3),
                              (0.45, 0.12, 0.05), rot=(0, -25, a), r=1, seg=12)
                P.bake(ob)

        return [("deco-lantern", lantern_post, 1.2, 2.0), ("deco-marigold", marigolds, 1.0, 0.8), ("deco-diya", diya_stand, 0.8, 1.2), ("deco-banana", banana, 1.6, 1.8)]


class Stepwell(World):
    look = "stepwell"
    cap_h = 0.32

    def materials(self):
        self.m_fill = T.bricks("sandstone", "#d6aa6c", "#bf9258", "#8c6740", bw=1.0, rh=0.5, grime="#6a5238", grime_k=0.35)
        self.m_cap = T.mottled("cornice", "#d7aa70", "#b88b55", 6, rough=0.7, bump_k=0.4)
        self.m_iron = P.mat("#3b3f43", 0.4, metal=0.85)
        self.m_wood = T.mottled("teak", "#6a4428", "#8a5a34", 8, rough=0.6)

    def cap(self, x0, x1, L, R):
        e0, e1 = x0 - (0.1 if L else 0), x1 + (0.1 if R else 0)
        bx(self.m_cap, e0, e1, 0.84, 0.95, y0=-0.6, bevel=0.03)
        P.bake(P.cyl(self.m_cap, ((e0 + e1) / 2, -0.62, 0.8), 0.045, e1 - e0, rot=(0, 90, 0), verts=12))
        bx(self.m_cap, e0 - 0.03, e1 + 0.03, 0.95, 1.06, y0=-0.66, bevel=0.03)
        for x in wrapped([0.25 + 0.5 * i for i in range(8)], e0 + 0.08, e1 - 0.08):  # carved dentils
            bx(P.mat("#9a6e40", 0.8), x - 0.07, x + 0.07, 0.72, 0.8, y0=-0.58, bevel=0.01)

    def slope_cap(self, up):
        # 45° slopes are drawn as a flight of four steps (it is a step-well): the hero still glides up the ramp
        for i in range(4):
            x = i * 0.25 if up else 0.75 - i * 0.25
            bx(self.m_cap, x, x + 0.27, 0, (i + 1) * 0.25, y0=-0.62, bevel=0.02)

    def slope(self, up):
        bx(self.m_fill, -2, 3, -2, 0, bevel=0)
        for i in range(4):
            x = i * 0.25 if up else 0.75 - i * 0.25
            bx(self.m_fill, x, x + 0.25, 0, (i + 1) * 0.25 - 0.06, bevel=0.01)
        self.slope_cap(up)

    def oneway(self, side):
        xa, xb = (-0.1 if side in "ls" else -2), (1.1 if side in "rs" else 3)
        bx(self.m_cap, xa, xb, 0.86, 1.0, y0=-0.6, bevel=0.03)
        for x in wrapped([0.5, 1.5, 2.5, 3.5], xa + 0.2, xb - 0.2):
            P.bake(prism(self.m_cap, [(x - 0.12, 0.86), (x + 0.12, 0.86), (x + 0.03, 0.5), (x - 0.03, 0.5)], -0.55, 0.3))

    def block(self):
        bx(self.m_cap, 0.02, 0.98, 0.02, 0.98, bevel=0.05)
        P.bake(P.torus(P.mat("#9a6e40", 0.8), (0.5, -0.5, 0.5), 0.26, 0.04, rot=(90, 0, 0)))
        for i in range(8):
            a = i * math.pi / 4
            P.bake(P.sphere(P.mat("#9a6e40", 0.8), (0.5 + math.cos(a) * 0.15, -0.5, 0.5 + math.sin(a) * 0.15), (0.05, 0.03, 0.05), r=1, seg=8))

    def crate(self):
        clay = T.mottled("clay2", "#a5532d", "#c87444", 6)
        for x, z, r in ((0.27, 0.22, 0.24), (0.73, 0.22, 0.24), (0.5, 0.64, 0.24)):
            P.bake(P.sphere(clay, (x, 0, z), (r, r, r * 0.9), r=1, seg=20))
            P.bake(P.torus(clay, (x, 0, z + r * 0.85), r * 0.45, 0.035))
            P.bake(P.torus(P.mat("#f0e2c0", 0.6), (x, 0, z), r * 1.0, 0.012, scale=(1, 1, 0.3)))

    def spikes(self):
        bx(self.m_iron, 0, 1, 0, 0.1, bevel=0.01)
        for i in range(5):
            for y in (-0.3, 0.1):
                P.bake(P.cone(self.m_iron, (0.1 + i * 0.2, y, 0.4), 0.06, 0.0, 0.62, verts=4))

    def tspikes_base(self):
        bx(P.mat("#6e5a44", 0.8), 0, 1, 0, 0.16, bevel=0.02)
        for i in range(5):
            bx(P.mat("#141210", 0.9), 0.06 + i * 0.2, 0.14 + i * 0.2, 0.1, 0.165, y0=-0.52, bevel=0)

    def water(self, k, top):
        m = T.mottled("wellwater", "#1d4f4a", "#2f7a6c", 3, rough=0.06, bump_k=0.25, emit=0.12)
        bx(m, k - 2, k + 3, -2, 0.8 if top else 3, bevel=0)
        if top:
            bx(T.mottled("wellfoam", "#8fc9b8", "#d3efe4", 9, rough=0.2, emit=0.15), k - 2, k + 3, 0.76, 0.83, y0=-0.52, bevel=0)

    def ladder(self):
        rope = P.mat("#a8834f", 0.9, bump=0.5, bump_scale=200)
        for x in (0.25, 0.75):
            P.bake(P.cyl(rope, (x, -0.3, 0.5), 0.03, 1.0, verts=8))
        for i in range(4):
            P.bake(P.cyl(self.m_wood, (0.5, -0.3, 0.12 + i * 0.25), 0.035, 0.6, rot=(0, 90, 0), verts=10))

    def crumble(self):
        bx(self.m_cap, 0.02, 0.98, 0.7, 1.0, bevel=0.03)
        for x, a in ((0.3, 15), (0.64, -20)):
            P.bake(P.box(P.mat("#3a2a1c", 0.9), (x, -0.52, 0.85), (0.025, 0.02, 0.32), rot=(0, a, 0), bevel=0))

    def gate(self):
        for i in range(5):
            P.bake(P.cyl(self.m_iron, (0.1 + i * 0.2, -0.2, 0.5), 0.04, 1.0, verts=8))
            P.bake(P.cone(self.m_iron, (0.1 + i * 0.2, -0.2, 0.02), 0.05, 0.0, 0.12, rot=(180, 0, 0), verts=4))
        for z in (0.3, 0.8):
            P.bake(P.box(self.m_iron, (0.5, -0.2, z), (1.0, 0.06, 0.06), bevel=0.01))

    def platform(self):
        bx(self.m_cap, -1.5, 1.5, 0.72, 1.0, y0=-0.6, bevel=0.04)
        for x in (-1.0, 1.0):
            P.bake(P.cyl(P.mat("#a8834f", 0.9), (x, -0.2, 1.4), 0.02, 0.8, verts=6))

    def decos(self):
        brass = P.mat("#d6a23a", 0.3, metal=0.85)

        def lamp():
            P.bake(P.cyl(self.m_cap, (0, 0, 0.35), 0.1, 0.7, verts=12))
            P.bake(P.cyl(self.m_cap, (0, 0, 0.75), 0.2, 0.1, verts=16))
            P.bake(P.sphere(P.mat("#a5532d", 0.7), (0, 0, 0.84), (0.13, 0.13, 0.05), r=1, seg=14))
            P.bake(P.cone(P.mat("#ffcf5a", 0.2, emit=6.0), (0.04, -0.03, 0.96), 0.045, 0.0, 0.16, verts=10))

        def niche():
            bx(self.m_cap, -0.5, 0.5, 0, 1.4, y0=-0.1, bevel=0.04)
            P.bake(prism(P.mat("#3a2a1c", 0.9), [(-0.3, 0.2), (0.3, 0.2), (0.3, 0.9), (0, 1.15), (-0.3, 0.9)], -0.12, 0.2))
            P.bake(P.sphere(brass, (0, -0.15, 0.5), (0.12, 0.08, 0.25), r=1, seg=14))

        def pots():
            clay = T.mottled("clay3", "#a5532d", "#c87444", 6)
            P.bake(P.sphere(clay, (-0.18, 0, 0.25), (0.25, 0.25, 0.25), r=1, seg=18))
            P.bake(P.sphere(clay, (0.22, 0.1, 0.18), (0.18, 0.18, 0.18), r=1, seg=18))

        def bell():
            P.bake(P.cyl(self.m_iron, (0, 0, 1.2), 0.012, 0.8, verts=6))
            P.bake(P.cone(brass, (0, 0, 0.7), 0.2, 0.08, 0.32, verts=20))
            P.bake(P.sphere(brass, (0, 0, 0.53), (0.04, 0.04, 0.04), r=1, seg=8))

        return [("deco-lamp", lamp, 0.8, 1.2), ("deco-niche", niche, 1.2, 1.5), ("deco-pots", pots, 1.0, 0.6), ("deco-bell", bell, 0.8, 1.7)]


WORLDS = {"monsoon": Monsoon, "festival": Festival, "stepwell": Stepwell}
