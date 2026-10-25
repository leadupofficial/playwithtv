"""
kitplat scenery: what each world's three backdrop layers show (see plat_backdrop.py for the seamless set-up).
Far layers are hazy silhouettes with a few lit windows or lamps; mid layers are closer, warmer and more detailed.
"""
from __future__ import annotations

import math
import random

import plat_common as P
from plat_backdrop import H, W, emit, rep, sky_plane


def haze(hexc, glow=0.35):
    return P.mat(hexc, 1.0, emit=glow)


def spread(n, lo=0.0, hi=W, jitter=0.35):
    step = (hi - lo) / n
    return [lo + step * (i + 0.5) + (random.random() - 0.5) * step * jitter for i in range(n)]


def windows(x0, w, z0, h, y, lit="#ffd28a", dark="#2a2f3a", cols=None, rows=None, chance=0.45, size=(0.32, 0.42)):
    cols = cols or max(1, int(w / 0.8))
    rows = rows or max(1, int(h / 1.0))
    for i in range(cols):
        for j in range(rows):
            x = x0 + (i + 0.5) * w / cols
            z = z0 + (j + 0.55) * h / rows
            on = random.random() < chance
            P.box(emit(lit, 2.5) if on else P.mat(dark, 0.6), (x, y, z), (size[0], 0.05, size[1]), bevel=0)


def palm(x, z0, y, col, scale=1.0):
    P.cyl(col, (x, y, z0 + 1.6 * scale), 0.08 * scale, 3.2 * scale, rot=(0, 6, 0), verts=8)
    for i in range(7):
        a = i * 2 * math.pi / 7
        P.sphere(col, (x + math.cos(a) * 0.7 * scale, y, z0 + 3.2 * scale + math.sin(a) * 0.25 * scale), (0.85 * scale, 0.05, 0.14 * scale),
                 rot=(0, -math.degrees(a) * 0.5 + (20 if math.cos(a) > 0 else -20), 0), r=1, seg=10)


# ---------------------------------------------------------------------------------------------------------------
# monsoon rooftops


def monsoon_sky():
    sky_plane("#26364f", "#d1a98c", "#4f5d72", cloud_k=0.85, glow=(22.0, 7.5, 1.1, "#ffd9a0"))


def monsoon_far():
    col = haze("#5f6f86", 0.5)
    lit = "#ffcf8a"
    xs = spread(14)
    for x0 in xs:
        w = random.uniform(1.6, 3.2)
        h = random.uniform(3.0, 8.5)
        seed = random.random()

        def b(x, w=w, h=h, seed=seed):
            random.seed(int(seed * 1e6))
            P.box(col, (x, 6, h / 2), (w, 1, h), bevel=0.02)
            windows(x - w / 2 + 0.15, w - 0.3, 0.6, h - 1.2, 5.4, lit=lit, dark="#4a5870", chance=0.3, size=(0.22, 0.3))
            if seed > 0.5:
                P.cyl(col, (x + w * 0.2, 6, h + 0.45), 0.35, 0.9, verts=16)
        rep(b, [x0])
    # a temple tower and palms on the skyline
    def gopuram(x):
        for i in range(6):
            P.box(col, (x, 6, 2 + i * 1.0), (3.2 - i * 0.45, 1, 1.0), bevel=0.03)
        P.sphere(emit("#ffcf8a", 2), (x, 5.4, 8.2), (0.12, 0.05, 0.12), r=1)
    rep(gopuram, [9.0])
    rep(lambda x: palm(x, 3.0, 5.5, col, 1.2), [4.0, 19.5, 27.0])


def monsoon_mid():
    walls = ["#c98f86", "#7fa7c9", "#e3c46b", "#9bc59a", "#e3a0b8", "#d8b48a"]
    xs = spread(7)
    for x0 in xs:
        w = random.uniform(3.2, 4.6)
        h = random.uniform(2.6, 5.2)
        wall = P.mat(random.choice(walls), 0.8, bump=0.3, bump_scale=6, vary=0.15)
        seed = random.random()

        def b(x, w=w, h=h, wall=wall, seed=seed):
            random.seed(int(seed * 1e6))
            P.box(wall, (x, 2, h / 2), (w, 1.2, h), bevel=0.04)
            P.box(P.mat("#8f9799", 0.4), (x, 1.9, h + 0.12), (w + 0.2, 1.4, 0.24), bevel=0.04)
            windows(x - w / 2 + 0.3, w - 0.6, 0.5, h - 1.2, 1.35, lit="#ffd9a0", dark="#2c3440", chance=0.35, size=(0.5, 0.6))
            if seed > 0.35:  # a black water tank on the roof
                P.cyl(P.mat("#1f2224", 0.4, coat=0.4), (x - w * 0.25, 2, h + 0.85), 0.5, 1.2, verts=24)
            if seed < 0.6:  # a laundry line with colourful clothes
                for i in range(6):
                    c = random.choice(["#e8336d", "#ffd23f", "#2ec4b6", "#3a86ff", "#ff7a1a", "#ffffff"])
                    P.box(P.mat(c, 0.7, sheen=0.4), (x - w / 2 + 0.5 + i * (w - 1) / 5, 1.0, h - 0.6), (0.35, 0.02, 0.5), bevel=0)
                P.cyl(P.mat("#333333", 0.5), (x, 1.0, h - 0.33), 0.01, w - 0.6, rot=(0, 90, 0), verts=6)
        rep(b, [x0])


# ---------------------------------------------------------------------------------------------------------------
# lantern festival night


def festival_sky():
    sky_plane("#140d33", "#5a2f78", "#2c2258", cloud_k=0.45, stars=0.9, glow=(7.0, 14.0, 0.9, "#fff1cf"))
    for x0, z, c in ((14, 13, "#ff5ab4"), (24, 15, "#ffd23f"), (29, 11.5, "#5ad7ff")):
        def burst(x, z=z, c=c):
            for i in range(18):
                a = i * 2 * math.pi / 18
                P.cyl(emit(c, 4.0), (x + math.cos(a) * 0.9, 19, z + math.sin(a) * 0.9), 0.04, 0.8, rot=(90 - math.degrees(a), 0, 0) if False else (0, -math.degrees(a) + 90, 0), verts=6)
        rep(burst, [x0])


def festival_far():
    col = haze("#3a2c63", 0.5)
    rep(lambda x: P.sphere(col, (x, 6, 0.5), (6.5, 1, 4.6), r=1, seg=48), [3.0, 16.0, 26.0])
    rep(lambda x: P.sphere(haze("#2f2454", 0.45), (x, 6.2, 0.0), (5.5, 1, 6.2), r=1, seg=48), [10.0, 21.5])

    def lights(x):
        for i in range(40):
            t = i / 39
            P.sphere(emit(random.choice(["#ffd23f", "#ff7a3c", "#ff5ab4"]), 5.0), (x + (t - 0.5) * 9, 5.4, 4.6 - 0.9 * math.sin(math.pi * t) + 0.6 * math.cos(t * 5)),
                     (0.06, 0.03, 0.06), r=1, seg=6)
    rep(lights, [6.0, 22.0])

    def temple(x):
        for i in range(5):
            P.box(col, (x, 6, 4.2 + i * 0.8), (2.6 - i * 0.45, 1, 0.8), bevel=0.03)
        P.sphere(emit("#ffcf8a", 3), (x, 5.4, 8.4), (0.15, 0.05, 0.15), r=1)
    rep(temple, [15.0])


def festival_mid():
    walls = ["#c2563f", "#3f7fbf", "#d89a2b", "#8a4fa8", "#2e9a7a"]
    for x0 in spread(6):
        w = random.uniform(3.4, 4.8)
        h = random.uniform(2.6, 4.4)
        wall = P.mat(random.choice(walls), 0.8, bump=0.3, bump_scale=6, vary=0.18)
        seed = random.random()

        def b(x, w=w, h=h, wall=wall, seed=seed):
            random.seed(int(seed * 1e6))
            P.box(wall, (x, 2, h / 2), (w, 1.2, h), bevel=0.04)
            P.box(P.mat("#5a3a2a", 0.7), (x, 1.8, h + 0.15), (w + 0.4, 1.6, 0.3), bevel=0.05)
            windows(x - w / 2 + 0.3, w - 0.6, 0.5, h - 1.2, 1.35, lit="#ffb84a", dark="#2a1e2e", chance=0.7, size=(0.5, 0.6))
            for i in range(5):  # a string of lanterns along the roof
                lx = x - w / 2 + 0.4 + i * (w - 0.8) / 4
                P.sphere(emit(random.choice(["#ff5a36", "#ffd23f", "#ff5ab4"]), 3.0), (lx, 1.0, h - 0.35 - 0.2 * math.sin(math.pi * i / 4)), (0.17, 0.1, 0.22), r=1, seg=14)
            P.cyl(P.mat("#222222", 0.5), (x, 1.05, h - 0.1), 0.01, w - 0.6, rot=(0, 90, 0), verts=6)
        rep(b, [x0])

    def kite(x):
        z = 9 + random.random() * 4
        c = random.choice(["#e8336d", "#ffd23f", "#2ec4b6", "#ff7a1a"])
        P.cone(P.mat(c, 0.5, emit=0.4), (x, 3, z), 0.5, 0.0, 0.01, rot=(90, 45, 0), verts=4, scale=(1, 1.3, 1))
        P.cyl(P.mat("#dddddd", 0.5), (x - 1.2, 3, z - 1.6), 0.008, 4.0, rot=(0, 37, 0), verts=4)
    rep(kite, [5.0, 17.0, 27.5])


# ---------------------------------------------------------------------------------------------------------------
# step-well


def stepwell_sky():
    sky_plane("#f6dfae", "#5a412d", "#8a6a4a", cloud_k=0.35, glow=(16.0, 17.5, 3.0, "#fff3d0"))


def arcade(z0, rows_y, col, n, h=1.8, w=1.1):
    for x0 in [i * W / n for i in range(n)]:
        def b(x):
            P.box(col, (x, rows_y, z0 + h / 2), (0.35, 0.6, h), bevel=0.03)
            P.box(col, (x + W / n / 2, rows_y, z0 + h + 0.15), (W / n + 0.36, 0.6, 0.3), bevel=0.03)
            P.box(P.mat("#2a1d14", 1.0, emit=0.15), (x + W / n / 2, rows_y + 0.32, z0 + h * 0.45), (W / n - 0.4, 0.05, h * 0.9), bevel=0)
        rep(b, [x0])


def stepwell_far():
    for i, (z0, c) in enumerate(((1.0, "#8a6845"), (3.6, "#9c7a52"), (6.2, "#ad8b60"), (8.8, "#bf9d70"))):
        arcade(z0, 6 - i * 0.1, haze(c, 0.45), 10 - i, h=2.0)
    for x0 in (6.0, 21.0):  # slanting shafts of sunlight
        rep(lambda x: P.box(P.mat("#fff0c0", 1, alpha=0.18, emit=1.5), (x, 4, 8), (1.6, 0.05, 20), rot=(0, 18, 0), bevel=0), [x0])


def stepwell_mid():
    stone = P.mat("#b48a5c", 0.8, bump=0.4, bump_scale=8, vary=0.15)
    for x0 in spread(5):
        def pillar(x):
            P.box(stone, (x, 2, 3.0), (1.1, 1.1, 6.0), bevel=0.05)
            for z in (0.5, 2.4, 4.4, 5.8):
                P.box(stone, (x, 1.9, z), (1.4, 1.3, 0.3), bevel=0.04)
            P.torus(P.mat("#8a6a45", 0.8), (x, 1.3, 3.3), 0.35, 0.06, rot=(90, 0, 0))
        rep(pillar, [x0])

    def stairs(x):
        for i in range(8):
            P.box(stone, (x + i * 0.45, 3, 0.25 + i * 0.45), (0.5, 1.4, 0.5 + i * 0.9), bevel=0.02)
    rep(stairs, [11.0, 26.0])

    def vines(x):
        leaf = P.mat("#4a7a34", 0.8, bump=0.5, bump_scale=30)
        for i in range(10):
            P.sphere(leaf, (x + math.sin(i) * 0.2, 1.2, H - 0.5 - i * 0.35), (0.18, 0.08, 0.16), r=1, seg=8)
    rep(vines, [3.0, 15.0, 24.0])


SCENERY = {
    "monsoon": {"sky": monsoon_sky, "far": monsoon_far, "mid": monsoon_mid},
    "festival": {"sky": festival_sky, "far": festival_far, "mid": festival_mid},
    "stepwell": {"sky": stepwell_sky, "far": stepwell_far, "mid": stepwell_mid},
}
