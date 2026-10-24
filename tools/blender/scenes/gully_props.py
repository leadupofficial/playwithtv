"""
Gully Super Over props, modelled from primitives in a stylised, toy-like way (chunky bevels, saturated paint):
the brick-stack stumps, an auto-rickshaw, the sleeping dog, a bat, water tanks, pots, chairs, a bicycle, a coconut
palm, bunting and string lights. Game coordinates (see gully_kit.P). Original designs: no brands, no plates.
"""
from __future__ import annotations

import math
import random

from gully_kit import box, cyl, mat, sag, sphere, tri_strip, tube


def bricks(cx: float, cz: float, rnd: random.Random) -> list:
    """The stumps: a stack of loose bricks, 0.44 m wide and ~0.72 m tall, laid crosswise like a kid would."""
    out = []
    shades = [mat("brick_a", "#b4513a", 0.85), mat("brick_b", "#a04632", 0.85), mat("brick_c", "#c2603f", 0.85)]
    L, W, H = 0.22, 0.105, 0.068
    y = 0.0
    for layer in range(10):
        along_x = layer % 2 == 0
        for i in range(4):
            if along_x:
                x = cx + (-0.11 if i % 2 == 0 else 0.11)
                z = cz + (-0.055 if i < 2 else 0.055)
                size = (L, H, W)
            else:
                x = cx - 0.165 + i * 0.11
                z = cz
                size = (W, H, L)
            j = rnd.uniform(-0.012, 0.012)
            out.append(box(f"brick{layer}_{i}", size, (x + j, y + H / 2, z + rnd.uniform(-0.01, 0.01)),
                           rnd.choice(shades), yaw=rnd.uniform(-0.06, 0.06), bevel=0.01))
        y += H + 0.002
    return out


def auto_rickshaw(x: float, z: float, yaw: float = 0.0) -> list:
    """A three-wheeler parked at the bowler's end: yellow body, black canopy, green trim (no markings)."""
    yellow = mat("auto_yellow", "#f7c21e", 0.35, coat=0.6)
    black = mat("auto_black", "#1d1d1f", 0.55)
    green = mat("auto_green", "#1f8a4c", 0.4, coat=0.4)
    glass = mat("auto_glass", "#1c2a33", 0.05, metal=0.2)
    chrome = mat("chrome", "#d9dde2", 0.2, metal=1.0)
    tyre = mat("tyre", "#151515", 0.8)
    lamp = mat("lamp", "#fff3c4", 0.2, emit=3.0)
    c, s = math.cos(yaw), math.sin(yaw)

    def at(lx, ly, lz):  # local → game (yaw about y)
        return (x + lx * c + lz * s, ly, z - lx * s + lz * c)

    parts = [
        box("auto_tub", (1.24, 0.34, 2.15), at(0, 0.5, 0.05), yellow, yaw=yaw, bevel=0.08),
        box("auto_back", (1.3, 0.62, 0.95), at(0, 0.95, 0.62), yellow, yaw=yaw, bevel=0.1),
        box("auto_seat", (1.1, 0.12, 0.5), at(0, 0.98, 0.1), black, yaw=yaw, bevel=0.04),
        box("auto_cowl", (0.62, 0.95, 0.34), at(0, 0.98, -0.92), yellow, yaw=yaw, bevel=0.1),
        box("auto_stripe_l", (0.03, 0.08, 2.0), at(-0.63, 0.62, 0.05), green, yaw=yaw),
        box("auto_stripe_r", (0.03, 0.08, 2.0), at(0.63, 0.62, 0.05), green, yaw=yaw),
        box("auto_screen", (0.92, 0.58, 0.03), at(0, 1.52, -0.82), glass, yaw=yaw, pitch=-0.18),
        box("auto_canopy", (1.36, 0.1, 2.05), at(0, 1.86, 0.12), black, yaw=yaw, bevel=0.05),
        box("auto_canopy_back", (1.34, 0.85, 0.06), at(0, 1.42, 1.12), black, yaw=yaw, bevel=0.03),
        cyl("auto_lamp", 0.07, 0.06, at(0, 1.18, -1.1), lamp, axis="z", yaw=yaw),
        cyl("auto_bar", 0.018, 0.7, at(0, 1.32, -0.7), chrome, axis="x", yaw=yaw),
    ]
    for side in (-1, 1):
        parts.append(cyl(f"auto_post{side}", 0.022, 0.86, at(side * 0.62, 1.42, -0.78), black))
        parts.append(cyl(f"auto_wheel{side}", 0.22, 0.13, at(side * 0.6, 0.22, 0.72), tyre, axis="x", yaw=yaw, verts=20))
        parts.append(cyl(f"auto_hub{side}", 0.09, 0.14, at(side * 0.6, 0.22, 0.72), chrome, axis="x", yaw=yaw))
    parts.append(cyl("auto_wheel_f", 0.22, 0.13, at(0, 0.22, -1.0), tyre, axis="x", yaw=yaw, verts=20))
    parts.append(cyl("auto_hub_f", 0.09, 0.14, at(0, 0.22, -1.0), chrome, axis="x", yaw=yaw))
    parts.append(box("auto_guard", (0.2, 0.06, 0.5), at(0, 0.47, -1.0), green, yaw=yaw, bevel=0.02))
    return parts


def dog(x: float, z: float, yaw: float = 0.6) -> list:
    """The boundary's sleeping street dog, curled up (tan with a white chest)."""
    tan = mat("dog_tan", "#b9824d", 0.9)
    white = mat("dog_white", "#efe6d8", 0.9)
    dark = mat("dog_dark", "#3a2a1e", 0.8)
    c, s = math.cos(yaw), math.sin(yaw)

    def at(lx, ly, lz):
        return (x + lx * c + lz * s, ly, z - lx * s + lz * c)

    return [
        sphere("dog_body", 0.3, at(0, 0.2, 0), tan, scale=(1.35, 0.72, 0.95), yaw=yaw),
        sphere("dog_chest", 0.17, at(0.28, 0.14, -0.12), white, scale=(1, 0.8, 1.1), yaw=yaw),
        sphere("dog_head", 0.15, at(0.34, 0.14, -0.3), tan, scale=(1, 0.85, 1.15), yaw=yaw),
        sphere("dog_snout", 0.07, at(0.38, 0.11, -0.44), white, scale=(1, 0.8, 1.3), yaw=yaw),
        sphere("dog_nose", 0.025, at(0.39, 0.13, -0.51), dark, yaw=yaw),
        sphere("dog_ear_l", 0.06, at(0.25, 0.25, -0.27), dark, scale=(0.6, 1.3, 1.0), yaw=yaw, pitch=0.5),
        sphere("dog_ear_r", 0.06, at(0.43, 0.24, -0.25), dark, scale=(0.6, 1.3, 1.0), yaw=yaw, pitch=0.5),
        sphere("dog_paw_l", 0.06, at(0.22, 0.05, -0.38), white, scale=(1, 0.7, 1.6), yaw=yaw),
        sphere("dog_paw_r", 0.06, at(0.42, 0.05, -0.36), white, scale=(1, 0.7, 1.6), yaw=yaw),
        tube("dog_tail", [at(-0.38, 0.15, 0.05), at(-0.42, 0.12, -0.12), at(-0.3, 0.08, -0.28), at(-0.1, 0.07, -0.34)], 0.045, tan),
    ]


def bat() -> list:
    """A taped tennis-ball cricket bat (for sprites and the GLB): willow blade, black grip."""
    willow = mat("bat_willow", "#e3c48d", 0.55)
    grip = mat("bat_grip", "#22252b", 0.7)
    tape = mat("bat_tape", "#e8452c", 0.6)
    return [
        box("bat_blade", (0.105, 0.56, 0.04), (0, -0.33, 0), willow, bevel=0.015),
        box("bat_tape", (0.108, 0.05, 0.043), (0, -0.48, 0), tape),
        cyl("bat_handle", 0.017, 0.26, (0, 0.06, 0), grip),
    ]


def water_tank(x: float, y: float, z: float, r: float = 0.55) -> list:
    black = mat("tank_black", "#202124", 0.5)
    return [cyl("tank", r, r * 1.6, (x, y + r * 0.8, z), black, verts=20),
            cyl("tank_lid", r * 0.35, 0.08, (x, y + r * 1.64, z), black)]


def pot(x: float, z: float, plant: bool = True, y: float = 0.0) -> list:
    clay = mat("terracotta", "#c1663d", 0.8)
    leaf = mat("leaf", "#3f8f3a", 0.7)
    out = [cyl("pot", 0.17, 0.3, (x, y + 0.15, z), clay, r2=0.22, verts=14)]
    if plant:
        for k in range(5):
            a = k * math.tau / 5
            out.append(sphere("plant", 0.13, (x + math.cos(a) * 0.08, y + 0.42, z + math.sin(a) * 0.08), leaf, scale=(1, 1.2, 1), segs=8))
    return out


def chair(x: float, z: float, yaw: float, color: str = "#d93a3a") -> list:
    plastic = mat(f"plastic_{color}", color, 0.4)
    c, s = math.cos(yaw), math.sin(yaw)

    def at(lx, ly, lz):
        return (x + lx * c + lz * s, ly, z - lx * s + lz * c)
    out = [box("chair_seat", (0.45, 0.05, 0.43), at(0, 0.45, 0), plastic, yaw=yaw, bevel=0.02),
           box("chair_back", (0.45, 0.42, 0.05), at(0, 0.7, 0.2), plastic, yaw=yaw, bevel=0.02, pitch=0.12)]
    for lx in (-0.19, 0.19):
        for lz in (-0.18, 0.18):
            out.append(cyl("chair_leg", 0.02, 0.45, at(lx, 0.22, lz), plastic, verts=8))
    return out


def bicycle(x: float, z: float, yaw: float) -> list:
    frame = mat("cycle_frame", "#1e5aa8", 0.4, metal=0.3)
    tyre = mat("tyre", "#151515", 0.8)
    c, s = math.cos(yaw), math.sin(yaw)

    def at(lx, ly, lz):
        return (x + lx * c + lz * s, ly, z - lx * s + lz * c)
    out = []
    for lz in (-0.52, 0.52):
        out.append(cyl("cycle_wheel", 0.33, 0.04, at(0, 0.33, lz), tyre, axis="x", yaw=yaw, verts=24))
    out.append(tube("cycle_frame", [at(0, 0.33, -0.52), at(0, 0.75, -0.25), at(0, 0.75, 0.25), at(0, 0.33, 0.52)], 0.025, frame))
    out.append(tube("cycle_frame2", [at(0, 0.75, -0.25), at(0, 0.33, 0.0), at(0, 0.75, 0.25)], 0.025, frame))
    out.append(box("cycle_seat", (0.1, 0.05, 0.22), at(0, 0.88, 0.25), mat("auto_black", "#1d1d1f"), yaw=yaw, bevel=0.02))
    return out


def palm(x: float, z: float, h: float, rnd: random.Random) -> list:
    """A coconut palm peeking over the rooftops."""
    trunk = mat("palm_trunk", "#8a6a4b", 0.9)
    frond = mat("palm_frond", "#3c8f3e", 0.75)
    nut = mat("coconut", "#5c7a2a", 0.6)
    out = []
    lean = rnd.uniform(-0.25, 0.25)
    pts = [(x + lean * (k / 6) ** 2 * h * 0.3, k / 6 * h, z) for k in range(7)]
    out.append(tube("palm_trunk", pts, 0.16, trunk, sides=8))
    top = pts[-1]
    tris = []
    for k in range(9):
        a = k * math.tau / 9 + rnd.uniform(-0.2, 0.2)
        L = rnd.uniform(2.2, 2.8)
        tip = (top[0] + math.cos(a) * L, top[1] - rnd.uniform(0.6, 1.3), top[2] + math.sin(a) * L)
        mid = (top[0] + math.cos(a) * L * 0.5, top[1] + 0.25, top[2] + math.sin(a) * L * 0.5)
        side = (-math.sin(a) * 0.35, 0, math.cos(a) * 0.35)
        for sgn in (-1, 1):
            m2 = (mid[0] + side[0] * sgn, mid[1] - 0.12, mid[2] + side[2] * sgn)
            tris.append((top, m2, mid))
            tris.append((mid, m2, tip))
    out.append(tri_strip("palm_fronds", tris, frond))
    for k in range(3):
        a = k * math.tau / 3
        out.append(sphere("coconut", 0.13, (top[0] + math.cos(a) * 0.2, top[1] - 0.2, top[2] + math.sin(a) * 0.2), nut, segs=8))
    return out


BUNTING = ["#ff4d6d", "#ffd23f", "#3bceac", "#2f9bff", "#ff9f1c"]


def bunting(a, b, n: int = 16, drop: float = 0.5) -> list:
    """A string of triangular paper flags across the lane (five colours, merged per colour)."""
    pts = sag(a, b, n, drop)
    per = {c: [] for c in BUNTING}
    for i in range(n):
        p, q = pts[i], pts[i + 1]
        tip = ((p[0] + q[0]) / 2, (p[1] + q[1]) / 2 - 0.32, (p[2] + q[2]) / 2 + 0.02)
        per[BUNTING[i % len(BUNTING)]].append((p, q, tip))
    out = [tube("bunting_string", pts, 0.006, mat("string", "#f4efe6", 0.9), sides=4)]
    for c, tris in per.items():
        if tris:
            out.append(tri_strip(f"flags_{c}", tris, mat(f"flag_{c}", c, 0.8)))
    return out


def string_lights(a, b, n: int = 22, drop: float = 0.7) -> list:
    """Warm festival bulbs on a wire (they glow under bloom on high/ultra)."""
    pts = sag(a, b, n, drop)
    bulb = mat("bulb", "#ffcf7a", 0.3, emit=6.0)
    out = [tube("light_wire", pts, 0.006, mat("wire", "#202020", 0.6), sides=4)]
    for p in pts[1:-1]:
        out.append(sphere("bulb", 0.045, (p[0], p[1] - 0.06, p[2]), bulb, segs=8))
    return out
