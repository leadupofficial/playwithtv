"""
Tiffin Tornado: kitchen stations for each layout code (see apps/web/src/games/tiffin/levels.ts), built on KayKit
Restaurant Bits counters and stoves (CC0, at half scale: 1 m cells, 0.5 m counter tops) plus South Indian
equipment modelled in code: dosa tava, idli steamer, kadai, sambar pot, wet grinder, coffee filter, clay matka.

Every builder makes objects around the origin, facing -Y (towards the kitchen floor); the caller places and turns
them. Returned lists are joined by the caller per tile.
"""
from __future__ import annotations

import math

import bpy

import tt_food as F
from tt_common import bowl, box, cyl, instance, mat, scatter, sphere, torus

TOP = 0.5  # counter top height (KayKit counter at half scale)

KIT_PIECES = ["kitchencounter_straight_A", "kitchencounter_straight_B", "kitchencounter_sink", "stove_single", "cuttingboard",
              "dishrack", "extractorhood", "crate", "jar_A_medium", "jar_B_small", "jar_C_medium", "knife"]


def counter(kit, variant=0):
    return [instance(kit["kitchencounter_straight_B" if variant % 3 == 2 else "kitchencounter_straight_A"], "counter")]


def stove(kit):
    return [instance(kit["stove_single"], "stove")]


def tava():
    """A heavy black iron tava (flat griddle) with a little brass oil cup and a flat spatula."""
    out = [cyl(0.34, 0.03, loc=(0, 0.02, TOP + 0.09), material="iron", verts=48, bevel=0.01)]
    out.append(cyl(0.3, 0.004, loc=(0, 0.02, TOP + 0.12), material=mat("iron", rough=0.25), verts=48))
    out += bowl(0.06, 0.04, loc=(0.36, 0.32, TOP), material="brass", fill="oil")
    out.append(box((0.08, 0.12, 0.006), loc=(-0.38, 0.25, TOP + 0.02), material="steel", bevel=0.004, rot=(0, 0, 0.5)))
    out.append(cyl(0.012, 0.2, loc=(-0.38, 0.36, TOP + 0.03), material="wood_dark", rot=(0, math.pi / 2, 0.5)))
    return out


def idli_steamer():
    """A tall steel idli steamer with a domed lid and a little steam vent."""
    out = [cyl(0.27, 0.36, loc=(0, 0.02, TOP + 0.09), material="steel", verts=40, bevel=0.01)]
    out.append(torus(0.27, 0.014, loc=(0, 0.02, TOP + 0.45), material="steel", major=40))
    out.append(sphere(0.27, loc=(0, 0.02, TOP + 0.45), material="steel", scale=(1, 1, 0.35)))
    out.append(cyl(0.035, 0.05, loc=(0, 0.02, TOP + 0.53), material="iron"))
    for a in (0, math.pi):
        out.append(torus(0.05, 0.012, loc=(math.cos(a) * 0.29, 0.02, TOP + 0.36), material="steel_dark", rot=(math.pi / 2, 0, a + math.pi / 2)))
    return out


def kadai():
    """A black kadai (wok) half full of golden oil, with loop handles and a slotted ladle."""
    out = bowl(0.3, 0.16, loc=(0, 0.02, TOP + 0.1), material="iron", fill="oil", fill_level=0.62, thickness=0.015)
    for s in (-1, 1):
        out.append(torus(0.05, 0.012, loc=(s * 0.33, 0.02, TOP + 0.25), material="iron", rot=(0, math.pi / 2, 0)))
    out.append(cyl(0.01, 0.34, loc=(0.25, 0.3, TOP + 0.3), material="steel_dark", rot=(0.9, 0, 0.6)))
    return out


def sambar_pot():
    """A big open brass-rimmed steel pot (the contents are drawn by the game) and a ladle."""
    out = [cyl(0.25, 0.3, loc=(0, 0.02, TOP + 0.09), material="steel", verts=40, bevel=0.01)]
    out.append(torus(0.25, 0.02, loc=(0, 0.02, TOP + 0.39), material="brass", major=40))
    out.append(cyl(0.012, 0.42, loc=(0.18, 0.12, TOP + 0.5), material="brass", rot=(0.5, -0.5, 0)))
    for s in (-1, 1):
        out.append(box((0.08, 0.04, 0.03), loc=(s * 0.28, 0.02, TOP + 0.34), material="brass", bevel=0.01))
    return out


def wet_grinder():
    """A countertop wet grinder: a steel drum, a grey stone roller and its arm, on a cream motor base."""
    out = [box((0.62, 0.5, 0.14), loc=(0, 0.04, TOP + 0.07), material="cream", bevel=0.04)]
    out.append(cyl(0.22, 0.24, loc=(0, 0.04, TOP + 0.14), material="steel", verts=36, bevel=0.01))
    out.append(cyl(0.2, 0.01, loc=(0, 0.04, TOP + 0.33), material="chutney", verts=36))
    out.append(cyl(0.08, 0.16, loc=(0.06, 0.04, TOP + 0.3), material="stone", rot=(0, math.pi / 2, 0)))
    out.append(cyl(0.02, 0.36, loc=(0.0, 0.04, TOP + 0.42), material="steel_dark", rot=(0, math.pi / 2, 0)))
    out.append(cyl(0.025, 0.28, loc=(-0.18, 0.04, TOP + 0.14), material="steel_dark"))
    out.append(box((0.08, 0.04, 0.04), loc=(0.2, -0.2, TOP + 0.1), material="fabric_red", bevel=0.01))  # the switch
    return out


def coffee_filter():
    """A South Indian coffee filter tower and a brass milk pot; the tumbler goes in front."""
    out = [cyl(0.09, 0.22, loc=(-0.15, 0.18, TOP), material="steel", verts=28, bevel=0.006)]
    out.append(cyl(0.085, 0.16, loc=(-0.15, 0.18, TOP + 0.22), material="steel", verts=28, bevel=0.006))
    out.append(cyl(0.095, 0.02, loc=(-0.15, 0.18, TOP + 0.38), material="steel", verts=28, bevel=0.006))
    out.append(sphere(0.03, loc=(-0.15, 0.18, TOP + 0.41), material="steel"))
    out.append(cyl(0.13, 0.2, loc=(0.18, 0.2, TOP), material="brass", r2=0.1, verts=28, bevel=0.01))
    out.append(cyl(0.012, 0.12, loc=(0.29, 0.2, TOP + 0.17), material="brass", rot=(0, 1.0, 0)))
    out.append(cyl(0.11, 0.008, loc=(0, -0.12, TOP), material="steel_dark", verts=24))  # where the tumbler stands
    return out


def chopping_board(kit):
    out = [instance(kit["cuttingboard"], "board", loc=(0, 0.02, TOP))]
    out[0].scale = (0.75, 0.75, 1)
    out.append(instance(kit["knife"], "knife", loc=(0.33, 0.25, TOP + 0.02), rz=0.4))
    r = scatter(2)
    for i in range(4):
        out.append(box((0.03, 0.03, 0.02), loc=(-0.3 + r() * 0.1, 0.3 + r() * 0.05, TOP + 0.01), material=("carrot", "onion")[i % 2], bevel=0.006))
    return out


def basket(fill: str, n: int, seed: int):
    """A woven cane basket heaped with coconuts or vegetables."""
    out = [cyl(0.3, 0.18, loc=(0, 0.02, TOP), material="wood_light", r2=0.34, verts=28, bevel=0.01)]
    for z in (0.05, 0.11, 0.17):
        out.append(torus(0.31 + z * 0.2, 0.012, loc=(0, 0.02, TOP + z), material="wood", major=28))
    r = scatter(seed)
    for i in range(n):
        a, d = r() * 6.28, math.sqrt(r()) * 0.22
        x, y, z = math.cos(a) * d, 0.02 + math.sin(a) * d, TOP + 0.18 + r() * 0.06
        if fill == "coconut":
            out.append(sphere(0.085, loc=(x, y, z), material="coconut", scale=(1, 1, 0.9)))
        elif i % 3 == 0:
            out.append(cyl(0.035, 0.26, loc=(x, y, z + 0.02), material="carrot", r2=0.006, rot=(0, math.pi / 2, r() * 3)))
        elif i % 3 == 1:
            out.append(cyl(0.016, 0.42, loc=(x, y, z + 0.03), material="drumstick", rot=(0, math.pi / 2, r() * 3)))
        else:
            out.append(sphere(0.055, loc=(x, y, z), material="onion"))
    return out


def batter_tub():
    out = [cyl(0.3, 0.26, loc=(0, 0.02, TOP), material="steel", verts=36, bevel=0.01)]
    out.append(torus(0.3, 0.015, loc=(0, 0.02, TOP + 0.26), material="steel", major=36))
    out.append(cyl(0.285, 0.005, loc=(0, 0.02, TOP + 0.22), material="batter", verts=36))
    out.append(cyl(0.012, 0.4, loc=(0.12, 0.1, TOP + 0.36), material="steel_dark", rot=(0.4, -0.4, 0)))
    return out


def dough_tub():
    out = bowl(0.32, 0.17, loc=(0, 0.02, TOP), material="brass")
    out.append(sphere(0.25, loc=(0, 0.02, TOP + 0.15), material="dough", scale=(1, 1, 0.35)))
    return out


def tumbler_stack():
    """A tray with a pyramid of steel tumblers."""
    out = [cyl(0.36, 0.02, loc=(0, 0.02, TOP), material="steel_dark", verts=36)]
    spots = [(-0.17, -0.1), (0, -0.1), (0.17, -0.1), (-0.085, 0.07), (0.085, 0.07), (0, 0.22), (-0.17, 0.22), (0.17, 0.22)]
    for x, y in spots:
        out.append(cyl(0.068, 0.16, loc=(x, y + 0.02, TOP + 0.02), material="steel", r2=0.075, verts=20))
    for x, y in spots[:3]:
        out.append(cyl(0.068, 0.16, loc=(x * 0.5, y + 0.1, TOP + 0.18), material="steel", r2=0.075, verts=20))
    return out


def matka():
    """A clay water pot on a wooden stand, a steel tumbler upside down on its lid."""
    out = [box((0.6, 0.6, 0.3), loc=(0, 0.02, 0.15), material="wood_dark", bevel=0.03)]
    out.append(sphere(0.3, loc=(0, 0.02, 0.56), material="clay", scale=(1, 1, 0.9)))
    out.append(cyl(0.15, 0.08, loc=(0, 0.02, 0.8), material="clay_dark", verts=24))
    out.append(cyl(0.18, 0.025, loc=(0, 0.02, 0.88), material="clay_dark", verts=24))
    out.append(cyl(0.07, 0.14, loc=(0, 0.02, 0.9), material="steel", r2=0.06))
    for z in (0.45, 0.6):
        out.append(torus(0.29 - abs(z - 0.56) * 0.3, 0.01, loc=(0, 0.02, z), material="cream", major=32))
    return out


def bin_():
    out = [cyl(0.24, 0.5, loc=(0, 0.0, 0), material="steel_dark", verts=28, bevel=0.01)]
    out.append(cyl(0.25, 0.04, loc=(0, 0.0, 0.5), material="steel", verts=28, bevel=0.01))
    out.append(box((0.12, 0.05, 0.03), loc=(0, -0.24, 0.05), material="black", bevel=0.01))
    return out


def serve_window():
    """The pass: a counter with a brass bell and a little sign (the opening is in the carriage wall)."""
    out = [cyl(0.07, 0.015, loc=(0.25, -0.2, TOP), material="wood_dark")]
    out.append(sphere(0.07, loc=(0.25, -0.2, TOP + 0.015), material="brass", scale=(1, 1, 0.75)))
    out.append(sphere(0.015, loc=(0.25, -0.2, TOP + 0.075), material="brass"))
    return out


def plate_rack(kit):
    return [instance(kit["dishrack"], "rack", loc=(0, 0.1, TOP))]


def hatch_frame():
    """The pass-through frame of a hatch in the gangway wall (L3)."""
    out = []
    for s in (-1, 1):
        out.append(box((0.12, 0.08, 1.1), loc=(0, s * 0.46, TOP + 0.55), material="wood_dark", bevel=0.015))
    out.append(box((0.14, 1.0, 0.1), loc=(0, 0, TOP + 1.12), material="wood_dark", bevel=0.015))
    return out


def station(code: str, kit, variant: int):
    """All objects for one cell (code from the layout), around the origin, facing -Y."""
    c = code
    if c == "#":
        return counter(kit, variant)
    if c == "h":
        return counter(kit, 2) + hatch_frame()
    if c == "t":
        return stove(kit) + tava()
    if c == "i":
        return stove(kit) + idli_steamer()
    if c == "k":
        return stove(kit) + kadai()
    if c == "p":
        return stove(kit) + sambar_pot()
    if c == "g":
        return counter(kit, 1) + wet_grinder()
    if c == "f":
        return counter(kit, 1) + coffee_filter()
    if c == "x":
        return counter(kit, 0) + chopping_board(kit)
    if c == "o":
        return counter(kit, 2) + basket("coconut", 9, 4)
    if c == "v":
        return counter(kit, 2) + basket("veg", 12, 8)
    if c == "b":
        return counter(kit, 0) + batter_tub()
    if c == "u":
        return counter(kit, 0) + dough_tub()
    if c == "c":
        return counter(kit, 1) + tumbler_stack()
    if c == "m":
        return matka()
    if c == "s":
        return [instance(kit["kitchencounter_sink"], "sink")]
    if c == "r":
        return counter(kit, 1) + plate_rack(kit)
    if c == "d":
        return counter(kit, 2)
    if c == "w":
        return counter(kit, 1) + serve_window()
    if c == "z":
        return bin_()
    return []


# Heights the game's depth occluders use for each code (what stands above the floor there), metres.
OCCLUDER_HEIGHT = {"#": 0.55, "h": 0.55, "t": 0.7, "i": 1.0, "k": 0.75, "p": 0.85, "g": 0.85, "f": 0.95, "x": 0.6, "o": 0.8, "v": 0.8,
                   "b": 0.8, "u": 0.75, "c": 0.8, "m": 0.95, "s": 0.95, "r": 0.95, "d": 0.55, "w": 0.6, "z": 0.55}


def food_on(name: str):
    return F.build(name)
