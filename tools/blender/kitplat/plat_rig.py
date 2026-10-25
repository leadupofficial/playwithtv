"""
kitplat biped rig: a chibi "vinyl toy" skeleton of empties with rigid parts, and procedural poses for every clip a
platformer hero needs. Poses are set directly before each render (no keyframes), so clips are exact and loop cleanly.

Character faces +X (screen right); the camera sits at -Y, so the RIGHT limbs (y < 0) are nearest the camera.
Angles in degrees. `swing` = limb rotated forward (towards +X), `bend` = knee/elbow flexion.
"""
from __future__ import annotations

import math

import plat_common as P

HIP_Z = 0.46
THIGH = 0.22
SHIN = 0.21
CHEST_Z = 0.36      # chest joint above the hips
SHOULDER_Z = 0.30   # shoulders above the hips
ARM = 0.16
FOREARM = 0.15
HEAD_Z = 0.56       # head centre above the hips
SPIN_Z = 0.62       # somersault pivot above the ground


class Rig:
    def __init__(self):
        J = P.joint
        self.root = J("root")
        self.spin = J("spin", self.root, (0, 0, SPIN_Z))
        self.hips = J("hips", self.spin, (0, 0, HIP_Z - SPIN_Z))
        self.chest = J("chest", self.hips, (0, 0, 0.0))
        self.head = J("head", self.chest, (0, 0, HEAD_Z))
        self.sh = {s: J(f"shoulder{s}", self.chest, (0, 0.17 * (1 if s == "L" else -1), SHOULDER_Z)) for s in "LR"}
        self.el = {s: J(f"elbow{s}", self.sh[s], (0, 0, -ARM)) for s in "LR"}
        self.th = {s: J(f"thigh{s}", self.hips, (0, 0.085 * (1 if s == "L" else -1), 0)) for s in "LR"}
        self.kn = {s: J(f"knee{s}", self.th[s], (0, 0, -THIGH)) for s in "LR"}
        self.tail: list = []
        self.base_yaw = -24.0  # three-quarter view: the face turns towards the camera
        self.scarf: list = []

    def chain(self, name: str, parent, start, n: int, seg: float, direction=(-1, 0, 0)):
        js = []
        p = P.joint(f"{name}0", parent, start)
        js.append(p)
        for i in range(1, n):
            p = P.joint(f"{name}{i}", p, tuple(c * seg for c in direction))
            js.append(p)
        return js

    # ---- pose helpers
    def limb(self, s: str, thigh: float, knee: float, arm: float, elbow: float, spread: float = 0.0):
        P.pose(self.th[s], (0, -thigh, 0))
        P.pose(self.kn[s], (0, knee, 0))
        P.pose(self.sh[s], (spread if s == "L" else -spread, -arm, 0))
        P.pose(self.el[s], (0, -elbow, 0))

    def apply(self, p: dict):
        """p: thighs/knees/arms/elbows as (L, R) pairs, lean, head, bob, flip, yaw, tail (list), sx/sz squash."""
        for i, s in enumerate("LR"):
            self.limb(s, p.get("thigh", (0, 0))[i], p.get("knee", (5, 5))[i], p.get("arm", (0, 0))[i], p.get("elbow", (15, 15))[i],
                      p.get("spread", (8, 8))[i])
        P.pose(self.chest, (p.get("twist", 0), p.get("lean", 0), 0))
        P.pose(self.head, (0, p.get("head", 0), 0))
        P.pose(self.hips, (0, 0, 0), loc=(0, 0, HIP_Z - SPIN_Z + p.get("bob", 0)))
        P.pose(self.spin, (0, p.get("flip", 0), 0))
        P.pose(self.root, (0, 0, self.base_yaw + p.get("yaw", 0)), loc=(0, 0, p.get("lift", 0)))
        for k, j in enumerate(self.tail):
            P.pose(j, (0, (p.get("tail", [0])[k % len(p.get("tail", [0]))] if p.get("tail") else 0), 0))
        for k, j in enumerate(self.scarf):
            P.pose(j, (0, (p.get("scarf", [0])[k % len(p.get("scarf", [0]))] if p.get("scarf") else 0), 0))


def wave(t: float, amp: float, phase: float = 0.0, n: int = 4, lag: float = 0.7) -> list[float]:
    return [amp * math.sin(2 * math.pi * t + phase - k * lag) for k in range(n)]


def clip_pose(clip: str, t: float, k: int, n: int) -> dict:
    """The pose for frame k of n (t = k / n for loops, k / (n - 1) for one-shots)."""
    s, c = math.sin(2 * math.pi * t), math.cos(2 * math.pi * t)
    if clip == "idle":
        return dict(arm=(4 + 3 * s, -4 - 3 * s), elbow=(18, 18), bob=-0.008 + 0.008 * s, head=3 * s, lean=2,
                    tail=[18 + 6 * s, 14 + 8 * math.sin(2 * math.pi * t - 0.8), 10, 8], scarf=wave(t, 6, 0, 4, 0.6))
    if clip == "run":
        sw = 48 * s
        kneeR = 25 + 70 * max(0.0, math.sin(2 * math.pi * t + 1.4))
        kneeL = 25 + 70 * max(0.0, math.sin(2 * math.pi * t + 1.4 + math.pi))
        return dict(thigh=(-sw, sw), knee=(kneeL, kneeR), arm=(sw * 1.0, -sw * 1.0), elbow=(80, 80), lean=14,
                    bob=0.03 * abs(c) - 0.01, head=-6, tail=[40 + 10 * s, 20 + 12 * math.sin(2 * math.pi * t - 0.9), 10, 6],
                    scarf=[70 + 8 * s, 10 + 10 * math.sin(2 * math.pi * t - 1), 8, 6])
    if clip == "jump":
        f = k / max(1, n - 1)
        return dict(thigh=(-25 + 10 * f, 55 + 15 * f), knee=(40, 95), arm=(115 - 15 * f, 130 - 10 * f), elbow=(35, 30), spread=(40, 55), lean=-4,
                    head=-8, bob=0.02, tail=[-20 - 15 * f, -25, -15, -10], scarf=[-30, -20, -10, -5])
    if clip == "fall":
        return dict(thigh=(10 + 12 * s, 25 - 12 * s), knee=(35, 45), arm=(120 + 15 * s, 130 - 15 * s), elbow=(30, 30), spread=(55, 65), lean=4,
                    head=6, tail=[50 + 10 * s, 40, 25, 15], scarf=[110, 20 + 10 * s, 10, 5])
    if clip == "hurt":
        f = k / max(1, n - 1)
        return dict(thigh=(25, -15), knee=(20, 25), arm=(70 + 20 * f, -60 - 15 * f), elbow=(15, 15), spread=(30, 45), lean=-22, head=-18,
                    bob=0.01, tail=[70, 40, 20, 10], scarf=[120, 30, 10, 5])
    if clip == "victory":
        hop = max(0.0, math.sin(2 * math.pi * t))
        return dict(lift=0.22 * hop, thigh=(30 * hop, 50 * hop), knee=(50 * hop + 5, 80 * hop + 5), arm=(30, 160), elbow=(20, 25 + 40 * (1 - hop)), spread=(15, 60),
                    lean=-4, head=-10 + 6 * hop, twist=8, tail=[30 + 20 * s, 30, 20, 10], scarf=wave(t, 18, 0, 4, 0.8))
    if clip == "climb":
        a = 25 * s
        return dict(yaw=90, arm=(150 + a, 150 - a), elbow=(40 - 0.6 * a, 40 + 0.6 * a), spread=(30, 30), thigh=(40 - a, 40 + a), knee=(60 - a, 60 + a),
                    lean=2, tail=[10, 8, 6, 4], scarf=[10, 8, 6, 4])
    if clip == "hang":
        return dict(arm=(165, 160), elbow=(8, 8), spread=(28, 40), thigh=(8 + 6 * s, -6 - 6 * s), knee=(15, 20), lean=-10, head=-20, bob=0.0,
                    tail=[5 + 6 * s, 4, 3, 2], scarf=[5, 4, 3, 2])
    if clip == "flip":
        return dict(flip=360 * t, thigh=(95, 100), knee=(125, 125), arm=(70, 80), elbow=(110, 110), lean=20, head=10,
                    tail=[40, 40, 30, 20], scarf=[60, 30, 20, 10])
    if clip == "skid":
        return dict(thigh=(-30, 35), knee=(55, 5), arm=(-40, -60), elbow=(40, 40), lean=-18, head=10, bob=-0.03,
                    tail=[60, 30, 20, 10], scarf=[60, 20, 10, 5])
    if clip == "push":   # pulling a lever / pushing
        return dict(thigh=(-20, 30), knee=(30, 20), arm=(80 + 10 * s, 85 - 10 * s), elbow=(30, 30), lean=18, bob=-0.02)
    raise ValueError(clip)


# clip name -> (frames, fps, loop)
CLIPS = {
    "idle": (8, 8, True), "run": (8, 14, True), "jump": (8, 16, False), "fall": (8, 12, True), "hurt": (8, 16, False),
    "victory": (8, 10, True), "climb": (8, 12, True), "hang": (8, 8, True), "flip": (8, 18, True), "skid": (2, 8, True),
    "push": (8, 10, True),
}


def frame_times(n: int, loop: bool) -> list[float]:
    return [k / n if loop else k / max(1, n - 1) for k in range(n)]
