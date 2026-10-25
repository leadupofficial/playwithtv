"""
Tiffin Tornado: the kitchen carriage itself, modelled in code: a plank floor, two-tone walls with barred train
windows, brass lamps, a marigold garland, a wall fan, the cut-away front of the coach with its maroon livery and
cream stripe, bogies and wheels underneath, gangway bellows and the ends of the neighbouring coaches. Level 3 adds
the gangway between two coaches: a partition with pass-through hatches and sliding doors.

Coordinates: the kitchen floor spans x ∈ [-W/2, W/2], y ∈ [-H/2, H/2] (row 0 at +y), floor top at z = 0.
"""
from __future__ import annotations

import math

import bpy

from tt_common import box, cyl, instance, mat, scatter, sphere, torus

WALL_H = 2.2
WALL_T = 0.16
DADO = 0.95
WIN = dict(w=1.3, z0=1.0, z1=1.86)


def planks(W: float, H: float):
    """Floor boards along X with staggered joints and a little colour variation."""
    out = [box((W + 0.02, H + 0.02, 0.06), loc=(0, 0, -0.035), material="wood_dark", bevel=0)]
    r = scatter(31)
    shades = [mat("wood", color=c, rough=0.42, coat=0.25) for c in ((0.3, 0.135, 0.05), (0.36, 0.17, 0.065), (0.26, 0.115, 0.042), (0.33, 0.155, 0.058))]
    bw = 0.25
    n = int(round(H / bw))
    for i in range(n):
        y = -H / 2 + bw * (i + 0.5)
        x = -W / 2
        lengths = []
        while x < W / 2 - 0.01:
            L = min(W / 2 - x, 1.6 + r() * 2.2)
            lengths.append((x, L))
            x += L
        for x0, L in lengths:
            out.append(box((L - 0.012, bw - 0.012, 0.03), loc=(x0 + L / 2, y, -0.012), material=shades[int(r() * 4) % 4], bevel=0.004))
    return out


def wall_with_holes(length: float, holes, centre, along_x: bool, lower="teal", upper="cream"):
    """
    A two-tone wall (lower panel, brass dado rail, upper paint) of `length` with rectangular openings.
    holes: list of (offset along the wall, width, z0, z1). Returns the pieces.
    """
    out = []
    cx, cy = centre

    def piece(a0, a1, z0, z1, material):
        if a1 - a0 < 1e-3 or z1 - z0 < 1e-3:
            return
        a = (a0 + a1) / 2
        size = (a1 - a0, WALL_T, z1 - z0) if along_x else (WALL_T, a1 - a0, z1 - z0)
        loc = (cx + a, cy, (z0 + z1) / 2) if along_x else (cx, cy + a, (z0 + z1) / 2)
        out.append(box(size, loc=loc, material=material, bevel=0.01))

    lo, hi = -length / 2, length / 2
    # each horizontal band is cut by every hole overlapping it
    bands = sorted({0.0, DADO, WALL_H, *[h[2] for h in holes], *[h[3] for h in holes]})
    for z0, z1 in zip(bands, bands[1:]):
        material = lower if z1 <= DADO + 1e-6 else upper
        cuts = sorted((o - w / 2, o + w / 2) for o, w, h0, h1 in holes if h0 < z1 - 1e-6 and h1 > z0 + 1e-6)
        a = lo
        for c0, c1 in cuts:
            piece(a, c0, z0, z1, material)
            a = max(a, c1)
        piece(a, hi, z0, z1, material)
    # brass dado rail and a maroon cornice
    size = (length, WALL_T + 0.04, 0.035) if along_x else (WALL_T + 0.04, length, 0.035)
    out.append(box(size, loc=(cx, cy, DADO), material="brass", bevel=0.01))
    size = (length + 0.1, WALL_T + 0.1, 0.1) if along_x else (WALL_T + 0.1, length + 0.1, 0.1)
    out.append(box(size, loc=(cx, cy, WALL_H + 0.05), material="maroon", bevel=0.02))
    return out


def train_window(x: float, y: float, inward: float):
    """Frame, three steel bars and a raised louvred shutter for a back-wall window at (x, y)."""
    w, z0, z1 = WIN["w"], WIN["z0"], WIN["z1"]
    out = []
    t = WALL_T + 0.03
    for zz in (z0, z1):
        out.append(box((w + 0.12, t, 0.06), loc=(x, y, zz), material="wood_dark", bevel=0.015))
    for s in (-1, 1):
        out.append(box((0.06, t, z1 - z0 + 0.06), loc=(x + s * w / 2, y, (z0 + z1) / 2), material="wood_dark", bevel=0.015))
    for k in range(1, 4):
        zz = z0 + (z1 - z0) * k / 4
        out.append(cyl(0.012, w, loc=(x, y + inward * 0.02, zz), material="steel", rot=(0, math.pi / 2, 0), verts=10))
    # the shutter pushed up above the window
    out.append(box((w - 0.04, 0.03, 0.22), loc=(x, y + inward * 0.06, z1 + 0.13), material="teal_light", bevel=0.01))
    for k in range(3):
        out.append(box((w - 0.1, 0.035, 0.012), loc=(x, y + inward * 0.075, z1 + 0.06 + k * 0.06), material="teal", bevel=0.003))
    # sill
    out.append(box((w + 0.2, 0.12, 0.04), loc=(x, y + inward * 0.08, z0 - 0.03), material="wood", bevel=0.01))
    return out


def brass_lamp(x: float, y: float, inward: float, z=1.95):
    out = [box((0.06, 0.1, 0.06), loc=(x, y + inward * 0.05, z), material="brass", bevel=0.01)]
    out.append(cyl(0.012, 0.18, loc=(x, y + inward * 0.14, z), material="brass", rot=(math.pi / 2, 0, 0)))
    out.append(cyl(0.09, 0.1, loc=(x, y + inward * 0.24, z - 0.12), material="brass", r2=0.04, verts=20))
    bulb = sphere(0.055, loc=(x, y + inward * 0.24, z - 0.13), material="lamp")
    out.append(bulb)
    return out


def lamp_light(x, y, z, power=25.0, color=(1.0, 0.72, 0.42)):
    data = bpy.data.lights.new("lamp", "POINT")
    data.energy = power
    data.color = color
    data.shadow_soft_size = 0.08
    ob = bpy.data.objects.new("lamp", data)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = (x, y, z)
    return ob


def wall_fan(x: float, y: float, inward: float, z=1.75):
    out = [cyl(0.05, 0.12, loc=(x, y + inward * 0.06, z), material="cream", rot=(math.pi / 2, 0, 0))]
    out.append(torus(0.2, 0.008, loc=(x, y + inward * 0.2, z), material="steel", rot=(math.pi / 2, 0, 0), major=24, minor=6))
    for k in range(3):
        a = k * 2 * math.pi / 3
        out.append(box((0.07, 0.01, 0.17), loc=(x + math.sin(a) * 0.09, y + inward * 0.18, z + math.cos(a) * 0.09), material="cream", bevel=0.02, rot=(0, a, 0)))
    out.append(cyl(0.035, 0.05, loc=(x, y + inward * 0.2, z), material="teal", rot=(math.pi / 2, 0, 0)))
    return out


def garland(x0: float, x1: float, y: float, z: float, sag=0.18):
    """Marigold garland in swags along the top of the wall."""
    out = []
    n = max(1, int((x1 - x0) / 1.4))
    seg = (x1 - x0) / n
    for s in range(n):
        for k in range(16):
            t = k / 15
            x = x0 + seg * (s + t)
            zz = z - sag * math.sin(math.pi * t)
            out.append(sphere(0.035, loc=(x, y, zz), material=mat("carrot", color=(0.98, 0.42 if k % 3 else 0.62, 0.02))))
        out.append(sphere(0.03, loc=(x0 + seg * s, y, z + 0.01), material="leaf"))
    return out


def menu_board(x: float, y: float, inward: float):
    """A little framed slate with 'TIFFIN' painted on it."""
    out = [box((0.9, 0.04, 0.5), loc=(x, y + inward * 0.03, 1.5), material="wood_dark", bevel=0.02)]
    out.append(box((0.8, 0.02, 0.4), loc=(x, y + inward * 0.055, 1.5), material="black", bevel=0.005))
    bpy.ops.object.text_add(location=(x, y + inward * 0.07, 1.55), rotation=(math.pi / 2, 0, 0 if inward < 0 else math.pi))
    t = bpy.context.active_object
    t.data.body = "TIFFIN"
    t.data.align_x = "CENTER"
    t.data.align_y = "CENTER"
    t.data.size = 0.17
    t.data.extrude = 0.004
    t.data.materials.append(mat("gold_paint"))
    bpy.ops.object.convert(target="MESH")
    out.append(bpy.context.active_object)
    for k in range(3):
        out.append(box((0.5 - k * 0.08, 0.01, 0.025), loc=(x - 0.05, y + inward * 0.066, 1.42 - k * 0.055), material="cream", bevel=0.004))
    return out


def serve_sign(x: float, y: float, text="SERVE"):
    """A hanging board over the pass, facing the camera: brass frame, maroon board, gold letters, a little bell icon."""
    out = [box((1.2, 0.05, 0.36), loc=(x, y, 1.62), material="maroon", bevel=0.03)]
    out.append(box((1.26, 0.04, 0.42), loc=(x, y + 0.012, 1.62), material="brass", bevel=0.02))
    for s in (-1, 1):
        out.append(cyl(0.008, 0.4, loc=(x + s * 0.45, y + 0.02, 1.8), material="brass"))
    bpy.ops.object.text_add(location=(x, y - 0.03, 1.6), rotation=(math.pi / 2, 0, 0))
    t = bpy.context.active_object
    t.data.body = text
    t.data.align_x = "CENTER"
    t.data.align_y = "CENTER"
    t.data.size = 0.2
    t.data.extrude = 0.008
    t.data.materials.append(mat("gold_paint"))
    bpy.ops.object.convert(target="MESH")
    out.append(bpy.context.active_object)
    return out


def front_cut(W: float, H: float):
    """The cut-away front of the coach: a low wall stub in the maroon livery with a cream stripe."""
    y = -H / 2 - WALL_T / 2
    out = [box((W + 2 * WALL_T, WALL_T, 0.32), loc=(0, y, 0.16 - 0.02), material="maroon", bevel=0.015)]
    out.append(box((W + 2 * WALL_T + 0.01, WALL_T + 0.012, 0.05), loc=(0, y, 0.2), material="cream", bevel=0.005))
    out.append(box((W + 2 * WALL_T, WALL_T + 0.04, 0.04), loc=(0, y, 0.32), material="brass", bevel=0.01))
    # skirt below the floor
    out.append(box((W + 2 * WALL_T, WALL_T, 0.32), loc=(0, y, -0.18), material="maroon", bevel=0.015))
    return out


def undercarriage(W: float, H: float):
    out = [box((W - 0.6, H - 0.8, 0.3), loc=(0, 0, -0.32), material="black", bevel=0.02)]
    for bx in (-W / 2 + 1.4, W / 2 - 1.4):
        out.append(box((2.0, H - 1.2, 0.18), loc=(bx, 0, -0.48), material="steel_dark", bevel=0.03))
        for wx in (-0.6, 0.6):
            for wy in (-H / 2 + 0.35, H / 2 - 0.35):
                out.append(cyl(0.3, 0.12, loc=(bx + wx, wy, -0.55), material="iron", rot=(math.pi / 2, 0, 0), verts=28, bevel=0.01))
                out.append(cyl(0.12, 0.14, loc=(bx + wx, wy, -0.55), material="steel", rot=(math.pi / 2, 0, 0), verts=16))
        out.append(box((0.5, 0.12, 0.12), loc=(bx, -H / 2 + 0.35, -0.42), material="gold_paint", bevel=0.02))  # spring housing
    return out


def bellows_and_neighbours(W: float, H: float):
    """Gangway bellows at both ends and the ends of the next coaches (framing the diorama)."""
    out = []
    for s in (-1, 1):
        x = s * (W / 2 + WALL_T + 0.18)
        for k in range(6):
            out.append(box((0.05, H * 0.5, 2.0), loc=(x + s * k * 0.06, 0, 1.0), material="rubber", bevel=0.02))
    return out


def tiffin_carrier(x: float, y: float, z: float, lid: str, tiers=3):
    """A stacked steel tiffin carrier with a coloured enamel lid, side clips and a handle."""
    r = 0.075
    out = []
    for k in range(tiers):
        out.append(cyl(r, 0.075, loc=(x, y, z + k * 0.08), material="steel", verts=20, bevel=0.006))
    out.append(cyl(r * 0.95, 0.03, loc=(x, y, z + tiers * 0.08), material=lid, verts=20, bevel=0.01))
    for s in (-1, 1):
        out.append(cyl(0.006, tiers * 0.08 + 0.06, loc=(x + s * (r + 0.01), y, z), material="steel_dark", verts=6))
    out.append(torus(r * 0.75, 0.008, loc=(x, y, z + tiers * 0.08 + 0.07), material="steel_dark", rot=(math.pi / 2, 0, 0), major=16, minor=6))
    return out


def wall_shelf(x: float, y: float, inward: float, width=0.95, z=1.55):
    """A wooden wall shelf with tiffin carriers and spice tins."""
    out = [box((width, 0.24, 0.04), loc=(x, y + inward * 0.12, z), material="wood", bevel=0.01)]
    for s in (-1, 1):
        out.append(box((0.03, 0.2, 0.12), loc=(x + s * (width / 2 - 0.08), y + inward * 0.1, z - 0.08), material="wood_dark", bevel=0.008))
    lids = ["teal_light", "fabric_red", "gold_paint"]
    n = max(2, int(width / 0.3))
    for k in range(n):
        xx = x - width / 2 + 0.17 + k * (width - 0.34) / max(1, n - 1)
        if k % 2 == 0:
            out += tiffin_carrier(xx, y + inward * 0.12, z + 0.02, lids[k // 2 % 3], tiers=3 if k % 4 == 0 else 2)
        else:
            out.append(cyl(0.05, 0.12, loc=(xx, y + inward * 0.12, z + 0.02), material=("brass", "teal", "fabric_red")[k % 3], verts=16, bevel=0.006))
    return out


def side_wall(W: float, H: float, side: int, holes):
    x = side * (W / 2 + WALL_T / 2)
    return wall_with_holes(H + 2 * WALL_T, holes, (x, 0), along_x=False)


def sliding_door(x: float, y: float, shut: bool, width=0.9, axis_y=True):
    """Two sliding door panels with round windows; open = slid into the wall."""
    out = []
    for s in (-1, 1):
        off = s * (width / 4 if shut else width * 0.72)
        loc = (x, y + off, 1.0) if axis_y else (x + off, y, 1.0)
        size = (0.06, width / 2 - 0.01, 1.95) if axis_y else (width / 2 - 0.01, 0.06, 1.95)
        out.append(box(size, loc=loc, material="maroon", bevel=0.02))
        wloc = (x, y + off, 1.45) if axis_y else (x + off, y, 1.45)
        out.append(cyl(0.12, 0.07, loc=wloc, material="glass", rot=(0, math.pi / 2, 0) if axis_y else (math.pi / 2, 0, 0)))
        out.append(torus(0.12, 0.015, loc=wloc, material="brass", rot=(0, math.pi / 2, 0) if axis_y else (math.pi / 2, 0, 0)))
    return out


def partition(xc: float, rows: list[tuple[float, str]], shut: bool):
    """Level 3's gangway wall at x = xc: wall above the hatch counters, a door frame (and doors) at the gangway."""
    out, doors = [], []
    for y, code in rows:
        if code == "|":
            for s in (-1, 1):
                out.append(box((0.3, 0.1, 2.05), loc=(xc, y + s * 0.5, 1.02), material="wood_dark", bevel=0.02))
            out.append(box((0.3, 1.1, 0.16), loc=(xc, y, 2.05), material="wood_dark", bevel=0.02))
            doors += sliding_door(xc, y, shut)
        else:
            out.append(box((0.24, 1.0, 0.7), loc=(xc, y, 1.6), material="cream", bevel=0.02))
            out.append(box((0.26, 1.0, 0.05), loc=(xc, y, 1.27), material="brass", bevel=0.01))
            out.append(box((0.26, 1.02, 0.1), loc=(xc, y, WALL_H - 0.2), material="maroon", bevel=0.02))
    return out, doors
