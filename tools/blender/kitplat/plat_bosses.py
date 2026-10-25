"""
kitplat bosses (original characters):
  monsoon   the Mango Bandit: a cheeky rooftop monkey in a red bandana who stole the parcel (throws mangoes)
  festival  the Grumble Puppet: a giant papier-mâché puppet king on strings (slams, throws cracker sparks)
  stepwell  the Stone Makara: a temple-guardian statue come to life, half crocodile, half elephant (charges)
Clips: idle, move, attack, hurt, dizzy.
"""
from __future__ import annotations

import math

import plat_common as P
import plat_rig as R

CLIPS = [("idle", 8, 8, True), ("move", 8, 12, True), ("attack", 8, 14, False), ("hurt", 8, 14, True), ("dizzy", 8, 10, True)]


def stars(parent, z):
    out = []
    for i in range(3):
        s = P.sphere(P.mat("#ffe36b", 0.2, emit=5.0), (0, 0, z), (0.08, 0.08, 0.08), r=1, seg=8)
        P.attach(s, parent)
        s["base"] = tuple(s.location)
        out.append(s)
    return out


def orbit(stars_, t, r=0.3):
    for i, s in enumerate(stars_):
        a = 2 * math.pi * (t + i / 3)
        b = s["base"]
        s.location = (b[0] + math.cos(a) * r, b[1] + math.sin(a) * r, b[2])


class BipedBoss:
    clips = CLIPS
    scale = 1.8
    w, h = 3.0, 3.0

    def __init__(self):
        self.rig = R.Rig()
        self.build(self.rig)
        self.rig.root.scale = (self.scale,) * 3
        self.stars = stars(self.rig.head, 1.42)

    def build(self, rig):
        raise NotImplementedError

    def pose(self, clip, t):
        rig = self.rig
        k = 0
        for s in self.stars:
            s.hide_render = clip != "dizzy"
        if clip == "idle":
            rig.apply(R.clip_pose("idle", t, k, 6))
        elif clip == "move":
            rig.apply(R.clip_pose("run", t, k, 8))
        elif clip == "hurt":
            rig.apply(R.clip_pose("hurt", 0.5 + 0.5 * math.sin(math.pi * t), 2, 4))
        elif clip == "attack":
            wind = t < 0.5
            rig.apply(dict(arm=(20, 160 if wind else 60), elbow=(20, 70 if wind else 10), spread=(10, 30), thigh=(-20, 25), knee=(25, 20),
                           lean=-10 if wind else 18, head=-5, tail=[40, 30, 20, 10], bob=-0.02))
        else:  # dizzy: wobbling head, stars circling
            rig.apply(dict(arm=(10, -10), elbow=(30, 30), thigh=(5, -5), knee=(10, 10), lean=6 * math.sin(2 * math.pi * t), head=14,
                           twist=10 * math.sin(2 * math.pi * t), tail=[10, 5, 5, 5]))
            orbit(self.stars, t)


class MangoBandit(BipedBoss):
    scale = 1.75
    w, h = 3.0, 3.0

    def build(self, rig):
        fur = P.mat("#8a5a36", 0.85, sheen=0.6, bump=0.3, bump_scale=60, vary=0.12)
        face = P.mat("#e3a98a", 0.6, sheen=0.2)
        band = P.mat("#d8262e", 0.5, sheen=0.3)
        from plat_heroes import eye, limbs
        limbs(rig, fur, fur, face, fur, face, leg_r=0.06)
        P.attach(P.sphere(fur, (0, 0, 0.63), (0.19, 0.18, 0.21), r=1), rig.chest)
        P.attach(P.sphere(face, (0.08, -0.02, 0.6), (0.12, 0.14, 0.15), r=1), rig.chest)
        P.attach(P.sphere(fur, (0, 0, 0.5), (0.17, 0.16, 0.12), r=1), rig.hips)
        hc = (0.0, 0, 1.0)
        P.attach(P.sphere(fur, hc, (0.25, 0.24, 0.24), r=1), rig.head)
        P.attach(P.sphere(face, (0.12, 0, 0.97), (0.15, 0.19, 0.17), r=1), rig.head)
        P.attach(P.sphere(face, (0.22, 0, 0.88), (0.1, 0.13, 0.08), r=1), rig.head)
        for y in (0.24, -0.24):
            P.attach(P.sphere(face, (-0.02, y, 1.02), (0.06, 0.04, 0.08), r=1), rig.head)
        P.attach(P.torus(band, (0.0, 0, 1.13), 0.235, 0.04, rot=(0, -10, 0)), rig.head)
        P.attach(P.sphere(band, (-0.26, 0.05, 1.1), (0.06, 0.05, 0.05), r=1), rig.head)
        P.attach(P.box(P.mat("#3a1a10", 0.5), (0.27, -0.0, 0.86), (0.02, 0.14, 0.015), bevel=0.003), rig.head)
        eye(rig, hc, 0.24, (0.75, -0.62, 0.15), 0.065)
        eye(rig, hc, 0.24, (0.9, 0.38, 0.15), 0.06)
        P.attach(P.box(P.mat("#2a1810", 0.6), (0.18, -0.05, 1.12), (0.12, 0.25, 0.025), rot=(0, 15, 0), bevel=0.005), rig.head)
        rig.tail = rig.chain("tail", rig.hips, (-0.14, 0, 0.0), 5, 0.13)
        P.bpy.context.view_layer.update()
        for j in rig.tail:
            w = j.matrix_world.translation
            P.attach(P.sphere(fur, (w.x - 0.07, w.y, w.z), (0.13, 0.05, 0.05), r=1), j)
        bag = P.box(P.mat("#f2b62b", 0.5, coat=0.4), (-0.12, 0.17, 0.52), (0.18, 0.08, 0.15), bevel=0.03)  # the stolen satchel
        P.attach(bag, rig.hips)


class GrumblePuppet(BipedBoss):
    scale = 1.95
    w, h = 3.2, 3.4

    def build(self, rig):
        robe = P.mat("#7a1fa2", 0.55, sheen=0.5)
        gold = P.mat("#f2c230", 0.25, metal=0.85)
        wood = P.mat("#e8b07a", 0.45, coat=0.4)
        from plat_heroes import eye, limbs
        limbs(rig, P.mat("#f4efe2", 0.6), wood, P.mat("#2a1a10", 0.5), wood, wood, sleeve=robe, leg_r=0.065)
        P.attach(P.cone(robe, (0, 0, 0.55), 0.27, 0.16, 0.42), rig.hips)
        P.attach(P.torus(gold, (0, 0, 0.35), 0.27, 0.025), rig.hips)
        P.attach(P.sphere(robe, (0, 0, 0.66), (0.19, 0.18, 0.18), r=1), rig.chest)
        for z in (0.58, 0.68):
            P.attach(P.sphere(gold, (0.17, -0.05, z), (0.025, 0.025, 0.025), r=1), rig.chest)
        hc = (0.0, 0, 1.02)
        P.attach(P.sphere(wood, hc, (0.27, 0.25, 0.27), r=1), rig.head)
        P.attach(P.sphere(P.mat("#e05a5a", 0.4), (0.24, -0.1, 0.94), (0.05, 0.03, 0.04), r=1), rig.head)
        P.attach(P.sphere(wood, (0.27, -0.02, 1.0), (0.05, 0.05, 0.06), r=1), rig.head)
        for s in (1, -1):  # a big curled moustache
            P.attach(P.torus(P.mat("#1a1210", 0.4), (0.24, -0.02 + s * 0.09, 0.93), 0.05, 0.018, rot=(90, 0, 0)), rig.head)
        P.attach(P.cone(gold, (-0.02, 0, 1.3), 0.2, 0.15, 0.18, verts=8), rig.head)
        for i in range(5):
            a = i * 2 * math.pi / 5
            P.attach(P.cone(gold, (-0.02 + math.cos(a) * 0.16, math.sin(a) * 0.16, 1.44), 0.04, 0.0, 0.12, verts=6), rig.head)
        P.attach(P.sphere(P.mat("#2ec4b6", 0.1, coat=1.0), (0.13, -0.06, 1.33), (0.04, 0.03, 0.04), r=1), rig.head)
        eye(rig, hc, 0.26, (0.75, -0.62, 0.2), 0.075)
        eye(rig, hc, 0.26, (0.9, 0.38, 0.2), 0.07)
        for s in (1, -1):  # angry painted brows
            P.attach(P.box(P.mat("#1a1210", 0.4), (0.21, -0.02 + s * 0.12, 1.15), (0.03, 0.12, 0.025), rot=(s * 20, 0, 0), bevel=0.003), rig.head)
        for y in (0.17, -0.17):  # puppet strings
            P.attach(P.cyl(P.mat("#f4efe2", 0.5), (0, y, 1.5), 0.004, 1.2), rig.chest)


class StoneMakara:
    clips = CLIPS
    w, h = 4.3, 2.4

    def __init__(self):
        J = P.joint
        stone = P.mat("#8f8a7c", 0.85, bump=0.5, bump_scale=25, vary=0.2)
        moss = P.mat("#5a7a3a", 0.9, bump=0.5, bump_scale=40)
        gold = P.mat("#d6a23a", 0.3, metal=0.85)
        self.root = J("makara")
        self.body = J("body", self.root, (0, 0, 0.75))
        P.attach(P.sphere(stone, (0, 0, 0.8), (0.85, 0.42, 0.42), r=1, seg=28), self.body)
        for i in range(5):
            P.attach(P.cone(stone, (-0.5 + i * 0.25, 0, 1.18), 0.1, 0.0, 0.22, verts=6), self.body)
        P.attach(P.sphere(moss, (-0.2, -0.2, 1.1), (0.3, 0.2, 0.08), r=1), self.body)
        self.head = J("head", self.body, (0.75, 0, 0.1))
        P.attach(P.sphere(stone, (0.95, 0, 0.9), (0.36, 0.32, 0.3), r=1, seg=24), self.head)
        P.attach(P.cone(stone, (1.38, 0, 0.82), 0.2, 0.09, 0.6, rot=(0, 80, 0)), self.head)          # long jaw
        P.attach(P.torus(stone, (1.7, 0, 1.0), 0.12, 0.05, rot=(90, 0, 0)), self.head)               # curled trunk tip
        for x in (1.25, 1.45, 1.6):
            P.attach(P.cone(P.mat("#eee6d2", 0.5), (x, -0.1, 0.72), 0.03, 0.0, 0.1, rot=(180, 0, 0)), self.head)
        P.attach(P.torus(gold, (0.95, 0, 1.05), 0.2, 0.03, rot=(0, 70, 0)), self.head)
        from plat_creatures import eyes
        eyes(self.head, (1.1, 0, 1.05), 0.09, 0.18, brow="#3a3a33")
        self.gem = P.sphere(P.mat("#2fd6a0", 0.1, emit=2.0), (1.02, -0.2, 1.2), (0.06, 0.04, 0.06), r=1)
        P.attach(self.gem, self.head)
        self.tail = J("tail", self.body, (-0.8, 0, 0.05))
        P.attach(P.cone(stone, (-1.15, 0, 0.9), 0.25, 0.05, 0.8, rot=(0, -75, 0)), self.tail)
        P.attach(P.torus(stone, (-1.55, 0, 1.08), 0.1, 0.05, rot=(90, 0, 0)), self.tail)
        self.legs = []
        for x in (0.45, -0.45):
            for s in (1, -1):
                j = J("leg", self.body, (x, 0.3 * s, 0.0))
                P.attach(P.capsule(stone, (x, 0.3 * s, 0.75), (x + 0.05, 0.32 * s, 0.1), 0.13, 0.11), j)
                P.attach(P.sphere(stone, (x + 0.1, 0.32 * s, 0.08), (0.17, 0.12, 0.08), r=1), j)
                self.legs.append((j, s, x))
        self.root.rotation_euler = (0, 0, math.radians(-18))
        P.bpy.context.view_layer.update()
        self.stars = []
        for i in range(3):
            st = P.sphere(P.mat("#ffe36b", 0.2, emit=5.0), (0.95, 0, 1.55), (0.08, 0.08, 0.08), r=1, seg=8)
            P.attach(st, self.head)
            st["base"] = tuple(st.location)
            self.stars.append(st)

    def pose(self, clip, t):
        s = math.sin(2 * math.pi * t)
        for st in self.stars:
            st.hide_render = clip != "dizzy"
        P.pose(self.body, (0, 0, 0), loc=(0, 0, 0.75 * 0 + (0.03 * abs(s) if clip == "move" else 0)))
        P.pose(self.head, (0, 0, 0))
        P.pose(self.tail, (0, 10 * s, 0))
        for j, side, x in self.legs:
            ph = 0 if (side > 0) == (x > 0) else math.pi
            P.pose(j, (0, (28 if clip == "move" else 4) * math.sin(2 * math.pi * t + ph), 0))
        if clip == "attack":
            P.pose(self.body, (0, 12 * min(1, t * 2), 0))
            P.pose(self.head, (0, 18 * min(1, t * 2), 0))
        elif clip == "hurt":
            P.pose(self.body, (0, -10, 0), loc=(-0.1, 0, 0.05))
            P.pose(self.head, (0, -20, 0))
        elif clip == "dizzy":
            P.pose(self.head, (8 * s, 10, 0))
            orbit(self.stars, t, 0.35)
        elif clip == "idle":
            P.pose(self.head, (0, 4 * s, 0))


BOSSES = {"monsoon": MangoBandit, "festival": GrumblePuppet, "stepwell": StoneMakara}
