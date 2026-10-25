"""
kitplat creatures: small original foes on joints of empties, each with a pose(clip, t) for procedural animation.
Bosses are in plat_bosses.py. Every creature faces +X; its feet are at z = 0.
"""
from __future__ import annotations

import math

import plat_common as P
from plat_bosses import BOSSES

J = P.joint


def eyes(parent, at, r=0.07, spread=0.1, look=(1, -0.4, 0), brow=None):
    """Two cartoon eyes placed around `at` (the near eye bigger), optionally with grumpy brows."""
    for k, (dy, s) in enumerate(((-spread, 1.0), (spread, 0.85))):
        c = (at[0], at[1] + dy, at[2])
        w = P.sphere(P.mat("#f7f3ea", 0.25, coat=0.6), c, (r * s, r * s, r * 1.15 * s), r=1, seg=14)
        p = P.sphere(P.mat("#15100c", 0.2, coat=1.0), (c[0] + r * 0.55 * s, c[1] - r * 0.35 * s, c[2]), (r * 0.5 * s, r * 0.5 * s, r * 0.65 * s), r=1, seg=10)
        h = P.sphere(P.mat("#ffffff", 0.1, emit=2.0), (c[0] + r * 0.8 * s, c[1] - r * 0.6 * s, c[2] + r * 0.3), (0.012, 0.012, 0.012), r=1, seg=6)
        for o in (w, p, h):
            P.attach(o, parent)
        if brow:
            b = P.box(P.mat(brow, 0.6), (c[0] + 0.01, c[1] - 0.02, c[2] + r * 1.15 * s), (r * 1.3, 0.03, 0.025), rot=(0, 18 if k == 0 else 12, 0), bevel=0.005)
            P.attach(b, parent)


class Creature:
    w = 1.4
    h = 1.2
    clips: list = []

    def pose(self, clip, t):
        raise NotImplementedError


class Crab(Creature):
    """Monsoon walker: a rain crab in a little yellow sou'wester."""
    w, h = 1.3, 1.0
    clips = [("walk", 6, 10, True), ("squash", 1, 1, True)]

    def __init__(self, shell="#d9502f", hat="#ffcc1a"):
        self.root = J("crab")
        self.body = J("body", self.root, (0, 0, 0.3))
        m = P.mat(shell, 0.4, coat=0.5, bump=0.2, bump_scale=40)
        P.attach(P.sphere(m, (0, 0, 0.32), (0.36, 0.28, 0.2), r=1, seg=24), self.body)
        P.attach(P.sphere(P.mat("#f0b28a", 0.6), (0.05, -0.1, 0.24), (0.3, 0.2, 0.1), r=1, seg=16), self.body)
        P.attach(P.cone(P.mat(hat, 0.4, coat=0.4), (-0.02, 0, 0.6), 0.2, 0.08, 0.16), self.body)
        P.attach(P.cyl(P.mat(hat, 0.4, coat=0.4), (0.0, 0, 0.52), 0.3, 0.03, rot=(0, -8, 0)), self.body)
        for dy in (-0.08, 0.08):
            P.attach(P.cyl(m, (0.18, dy, 0.48), 0.025, 0.16, rot=(0, 15, 0)), self.body)
        eyes(self.body, (0.24, 0, 0.58), 0.06, 0.08)
        self.claws = []
        for s, dy in (("L", 0.2), ("R", -0.22)):
            j = J(f"claw{s}", self.body, (0.25, dy, 0.28 - 0.3))
            P.attach(P.capsule(m, (0.25, dy, 0.28), (0.42, dy * 1.1, 0.36), 0.04), j)
            P.attach(P.sphere(m, (0.5, dy * 1.1, 0.4), (0.11, 0.07, 0.09), r=1, seg=16), j)
            P.attach(P.cone(m, (0.62, dy * 1.1, 0.44), 0.05, 0.0, 0.14, rot=(0, 70, 0)), j)
            self.claws.append(j)
        self.legs = []
        for i in range(3):
            for s, dy in ((1, 0.18), (-1, -0.2)):
                j = J("leg", self.body, (-0.1 + i * 0.13, dy, 0.25 - 0.3))
                P.attach(P.capsule(m, (-0.1 + i * 0.13, dy, 0.25), (-0.16 + i * 0.13, dy * 1.5, 0.0), 0.025, 0.018), j)
                self.legs.append((j, i, s))

    def pose(self, clip, t):
        s = math.sin(2 * math.pi * t)
        squash = clip == "squash"
        P.pose(self.body, (0, 0, 0), loc=(0, 0, 0.3 + (0 if squash else 0.02 * abs(s))), scale=(1.15, 1.1, 0.45) if squash else (1, 1, 1))
        for j, i, side in self.legs:
            P.pose(j, (side * 20 * math.sin(2 * math.pi * t + i * 2.1), 0, 0))
        for k, c in enumerate(self.claws):
            P.pose(c, (0, -12 * math.sin(2 * math.pi * t + k * math.pi), 0))


class Frog(Creature):
    w, h = 1.1, 1.4
    clips = [("idle", 2, 3, True), ("jump", 3, 8, False)]

    def __init__(self, skin="#3f9a3a", belly="#cfe39a", spots=None):
        self.root = J("frog")
        self.body = J("body", self.root, (0, 0, 0.0))
        m = P.mat(skin, 0.35, coat=0.6, bump=0.15, bump_scale=30)
        P.attach(P.sphere(m, (0, 0, 0.3), (0.3, 0.26, 0.24), rot=(0, -15, 0), r=1, seg=24), self.body)
        P.attach(P.sphere(P.mat(belly, 0.5), (0.1, -0.06, 0.24), (0.2, 0.2, 0.16), r=1, seg=16), self.body)
        self.throat = P.sphere(P.mat(belly, 0.5), (0.2, 0, 0.2), (0.12, 0.13, 0.08), r=1, seg=14)
        P.attach(self.throat, self.body)
        for dy in (-0.13, 0.13):
            P.attach(P.sphere(m, (0.12, dy, 0.52), (0.1, 0.1, 0.1), r=1, seg=16), self.body)
        eyes(self.body, (0.17, 0, 0.56), 0.065, 0.13)
        P.attach(P.box(P.mat("#5a1a1a", 0.5), (0.27, -0.0, 0.33), (0.02, 0.2, 0.012), rot=(0, 0, 0), bevel=0.003), self.body)
        if spots:
            for x, y, z in ((-0.1, -0.22, 0.4), (0.0, -0.2, 0.48), (-0.18, -0.12, 0.3)):
                P.attach(P.sphere(P.mat(spots, 0.4), (x, y, z), (0.05, 0.02, 0.05), r=1, seg=10), self.body)
        self.legs = []
        for dy in (-0.2, 0.2):
            j = J("hind", self.body, (-0.15, dy, 0.18))
            P.attach(P.capsule(m, (-0.15, dy, 0.18), (0.05, dy * 1.1, 0.05), 0.08, 0.05), j)
            P.attach(P.sphere(m, (0.1, dy * 1.1, 0.02), (0.1, 0.06, 0.025), r=1, seg=12), j)
            self.legs.append(j)

    def pose(self, clip, t):
        if clip == "idle":
            P.pose(self.body, (0, 0, 0), scale=(1, 1, 1))
            self.throat.scale = (0.12 * (1 + 0.5 * t), 0.13 * (1 + 0.5 * t), 0.08 * (1 + 0.6 * t))
            for j in self.legs:
                P.pose(j, (0, 0, 0))
            return
        crouch, stretch = t < 0.3, t > 0.3
        P.pose(self.body, (0, -10 if stretch else 5, 0), loc=(0, 0, 0.0 if crouch else 0.15), scale=(1.1, 1, 0.8) if crouch else (0.92, 1, 1.15))
        for j in self.legs:
            P.pose(j, (0, 0 if crouch else 70, 0))


class Bird(Creature):
    """Flyers: a crow (monsoon), a grumpy paper lantern (festival), a bat (step-well)."""
    w, h = 1.4, 1.2
    clips = [("fly", 6, 12, True)]

    def __init__(self, kind="crow"):
        self.kind = kind
        self.root = J("bird", None, (0, 0, 0.5))
        if kind == "lantern":
            body = P.mat("#ff5a36", 0.4, emit=1.8)
            P.attach(P.sphere(body, (0, 0, 0.5), (0.3, 0.3, 0.36), r=1, seg=24), self.root)
            for z in (-0.18, 0.0, 0.18):
                P.attach(P.torus(P.mat("#c4122d", 0.5), (0, 0, 0.5 + z), 0.3 * math.cos(z * 2.2), 0.014), self.root)
            gold = P.mat("#f2c230", 0.3, metal=0.8)
            P.attach(P.cyl(gold, (0, 0, 0.88), 0.12, 0.07), self.root)
            P.attach(P.cyl(gold, (0, 0, 0.12), 0.12, 0.07), self.root)
            P.attach(P.cyl(P.mat("#ffd23f", 0.6), (0, 0, -0.05), 0.03, 0.3), self.root)
            eyes(self.root, (0.24, 0, 0.56), 0.07, 0.1, brow="#3a1010")
            wing = P.mat("#ffd8a8", 0.5, sheen=0.4)
        elif kind == "bat":
            body = P.mat("#5a4a5e", 0.7, sheen=0.6, bump=0.3, bump_scale=60)
            P.attach(P.sphere(body, (0, 0, 0.5), (0.2, 0.18, 0.22), r=1, seg=20), self.root)
            P.attach(P.sphere(body, (0.14, 0, 0.66), (0.14, 0.13, 0.13), r=1, seg=18), self.root)
            for dy in (-0.07, 0.07):
                P.attach(P.cone(body, (0.12, dy, 0.82), 0.05, 0.0, 0.14), self.root)
            eyes(self.root, (0.25, 0, 0.7), 0.045, 0.05, brow="#2a1a2a")
            wing = P.mat("#3d3242", 0.6, sheen=0.3)
        else:
            body = P.mat("#24252b", 0.45, sheen=0.7, coat=0.3)
            P.attach(P.sphere(body, (0, 0, 0.5), (0.3, 0.17, 0.18), rot=(0, -10, 0), r=1, seg=20), self.root)
            P.attach(P.sphere(body, (0.27, 0, 0.62), (0.14, 0.12, 0.12), r=1, seg=18), self.root)
            P.attach(P.cone(P.mat("#3a3b40", 0.3, coat=0.6), (0.45, 0, 0.6), 0.05, 0.0, 0.2, rot=(0, 90, 0)), self.root)
            P.attach(P.cone(body, (-0.32, 0, 0.5), 0.1, 0.0, 0.3, rot=(0, -100, 0), scale=(1, 0.4, 1)), self.root)
            eyes(self.root, (0.32, 0, 0.67), 0.04, 0.07)
            wing = P.mat("#1c1d22", 0.5, sheen=0.6)
        self.wings = []
        for s in (1, -1):
            j = J("wing", self.root, (0, 0.12 * s, 0.55 - 0.5 if kind != "lantern" else 0.62 - 0.5))
            if kind == "lantern":
                P.attach(P.sphere(wing, (0, 0.33 * s, 0.62), (0.08, 0.2, 0.03), r=1, seg=12), j)
            else:
                P.attach(P.sphere(wing, (-0.02, 0.32 * s, 0.55), (0.18, 0.3, 0.025), r=1, seg=14), j)
            self.wings.append((j, s))

    def pose(self, clip, t):
        a = 45 * math.sin(2 * math.pi * t)
        for j, s in self.wings:
            P.pose(j, (s * a, 0, 0))
        P.pose(self.root, (0, 0, 0), loc=(0, 0, 0.5 + 0.04 * math.sin(2 * math.pi * t + 1)))


class Pangolin(Creature):
    """Curler: an armoured pangolin that rolls into a ball when stomped."""
    w, h = 1.4, 1.0
    clips = [("walk", 6, 8, True), ("ball", 4, 14, True)]

    def __init__(self, scale_col="#8a6a4a", skin="#d8b08a"):
        self.root = J("pangolin")
        self.walker = J("walker", self.root)
        self.ball = J("ball", self.root, (0, 0, 0.32))
        sc = P.mat(scale_col, 0.5, coat=0.3, bump=0.15, bump_scale=30)
        for i in range(6):
            x = 0.22 - i * 0.12
            P.attach(P.sphere(sc, (x, 0, 0.36 + 0.06 * math.sin(i * 0.7)), (0.13, 0.2, 0.15 - 0.012 * i), rot=(0, -20, 0), r=1, seg=14), self.walker)
        P.attach(P.cone(sc, (-0.55, 0, 0.18), 0.12, 0.03, 0.4, rot=(0, -110, 0)), self.walker)
        P.attach(P.sphere(P.mat(skin, 0.6), (0.38, 0, 0.3), (0.13, 0.1, 0.1), r=1, seg=16), self.walker)
        P.attach(P.cone(P.mat(skin, 0.6), (0.52, 0, 0.27), 0.06, 0.02, 0.16, rot=(0, 95, 0)), self.walker)
        eyes(self.walker, (0.45, 0, 0.34), 0.035, 0.05)
        self.legs = []
        for x in (0.2, -0.25):
            for s in (1, -1):
                j = J("leg", self.walker, (x, 0.13 * s, 0.22))
                P.attach(P.capsule(P.mat(skin, 0.6), (x, 0.13 * s, 0.22), (x + 0.03, 0.14 * s, 0.03), 0.04), j)
                self.legs.append((j, s, x))
        for i in range(10):
            a = i * 2 * math.pi / 10
            P.attach(P.sphere(sc, (math.cos(a) * 0.2, 0, 0.32 + math.sin(a) * 0.2), (0.12, 0.24, 0.1), rot=(0, -math.degrees(a) - 90, 0), r=1, seg=12), self.ball)
        P.attach(P.sphere(sc, (0, 0, 0.32), (0.22, 0.22, 0.22), r=1, seg=16), self.ball)

    def pose(self, clip, t):
        walk = clip == "walk"
        self.walker.hide_render = not walk
        for o in self.walker.children_recursive:
            o.hide_render = not walk
        for o in self.ball.children_recursive:
            o.hide_render = walk
        if walk:
            for j, s, x in self.legs:
                P.pose(j, (0, 25 * math.sin(2 * math.pi * t + (0 if (s > 0) == (x > 0) else math.pi)), 0))
            P.pose(self.walker, (0, 0, 0), loc=(0, 0, 0.015 * abs(math.sin(2 * math.pi * t))))
        else:
            P.pose(self.ball, (0, 360 * t, 0), loc=(0, 0, 0.32))


class Pot(Creature):
    """Festival walker: a waddling clay pot with a painted band."""
    w, h = 1.1, 1.1
    clips = [("walk", 6, 10, True), ("squash", 1, 1, True)]

    def __init__(self):
        self.root = J("pot")
        self.body = J("body", self.root)
        clay = P.mat("#b5562f", 0.6, bump=0.15, bump_scale=30)
        P.attach(P.sphere(clay, (0, 0, 0.36), (0.3, 0.3, 0.3), r=1, seg=24), self.body)
        P.attach(P.cyl(clay, (0, 0, 0.7), 0.13, 0.12), self.body)
        P.attach(P.torus(clay, (0, 0, 0.76), 0.15, 0.04), self.body)
        P.attach(P.torus(P.mat("#f4efe2", 0.5), (0, 0, 0.4), 0.3, 0.025), self.body)
        P.attach(P.torus(P.mat("#e8336d", 0.5), (0, 0, 0.47), 0.285, 0.02), self.body)
        eyes(self.body, (0.25, 0, 0.5), 0.07, 0.1, brow="#3a1a10")
        self.feet = []
        for s in (1, -1):
            j = J("foot", self.body, (0, 0.13 * s, 0.1))
            P.attach(P.sphere(P.mat("#8a3f22", 0.6), (0.04, 0.13 * s, 0.04), (0.1, 0.07, 0.05), r=1, seg=12), j)
            self.feet.append((j, s))

    def pose(self, clip, t):
        s = math.sin(2 * math.pi * t)
        if clip == "squash":
            P.pose(self.body, (0, 0, 0), scale=(1.2, 1.2, 0.5))
            return
        P.pose(self.body, (8 * s, 0, 0), loc=(0, 0, 0.03 * abs(s)), scale=(1, 1, 1))
        for j, side in self.feet:
            P.pose(j, (0, 0, 0), loc=(0.06 * s * side, 0.13 * side, 0.1 + 0.03 * max(0, s * side)))


class Beetle(Crab):
    """Step-well walker: a jewel scarab beetle."""
    def __init__(self):
        self.root = J("beetle")
        self.body = J("body", self.root, (0, 0, 0.3))
        shell = P.mat("#1d7a6c", 0.25, metal=0.6, coat=0.8)
        P.attach(P.sphere(shell, (-0.05, 0, 0.32), (0.34, 0.26, 0.22), r=1, seg=24), self.body)
        P.attach(P.box(P.mat("#0f3a34", 0.4), (-0.05, -0.27, 0.36), (0.6, 0.01, 0.015), bevel=0), self.body)
        P.attach(P.sphere(P.mat("#132a26", 0.4), (0.28, 0, 0.28), (0.12, 0.13, 0.1), r=1, seg=16), self.body)
        P.attach(P.cone(P.mat("#d6a23a", 0.3, metal=0.8), (0.4, 0, 0.38), 0.03, 0.0, 0.18, rot=(0, 40, 0)), self.body)
        eyes(self.body, (0.35, 0, 0.32), 0.04, 0.08)
        self.claws = []
        self.legs = []
        for i in range(3):
            for s, dy in ((1, 0.18), (-1, -0.2)):
                j = J("leg", self.body, (-0.1 + i * 0.13, dy, 0.25 - 0.3))
                P.attach(P.capsule(P.mat("#132a26", 0.4), (-0.1 + i * 0.13, dy, 0.25), (-0.14 + i * 0.13, dy * 1.5, 0.0), 0.025, 0.018), j)
                self.legs.append((j, i, s))


WORLD_FOES = {
    "monsoon": {"walker": lambda: Crab(), "hopper": lambda: Frog(), "flyer": lambda: Bird("crow"), "curler": lambda: Pangolin(), "boss": BOSSES["monsoon"]},
    "festival": {"walker": lambda: Pot(), "hopper": lambda: Frog("#ff6fa5", "#ffe08a", "#ffd23f"), "flyer": lambda: Bird("lantern"),
                 "curler": lambda: Pangolin("#7a5a3a", "#e8c8a0"), "boss": BOSSES["festival"]},
    "stepwell": {"walker": lambda: Beetle(), "hopper": lambda: Frog("#7d7a5a", "#c8c09a", "#4a4a36"), "flyer": lambda: Bird("bat"),
                 "curler": lambda: Pangolin("#6d5a48", "#c9a888"), "boss": BOSSES["stepwell"]},
}
