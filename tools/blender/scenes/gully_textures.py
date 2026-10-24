"""
Gully Super Over: small procedural textures (numpy only), written as PNG next to the .blend and packed into the
GLB. Everything is original: concrete, plaster grunge, a rice-flour kolam for the doorsteps and a painted mural.
Values are sRGB, 8-bit; tiles wrap seamlessly.
"""
from __future__ import annotations

import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import pwtv_atlas as atlas  # noqa: E402


def value_noise(size: int, cells: int, rng: np.random.Generator) -> np.ndarray:
    """Tileable smooth value noise in [0, 1] (bilinear-interpolated random lattice, smoothstep)."""
    g = rng.random((cells, cells))
    t = np.linspace(0, cells, size, endpoint=False)
    i0 = np.floor(t).astype(int)
    f = t - i0
    f = f * f * (3 - 2 * f)
    i1 = (i0 + 1) % cells
    a = g[np.ix_(i0, i0)]
    b = g[np.ix_(i0, i1)]
    c = g[np.ix_(i1, i0)]
    d = g[np.ix_(i1, i1)]
    fx = f[None, :]
    fy = f[:, None]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def fbm(size: int, base: int, octaves: int, rng: np.random.Generator) -> np.ndarray:
    out = np.zeros((size, size))
    amp, total = 1.0, 0.0
    for o in range(octaves):
        out += value_noise(size, base * 2 ** o, rng) * amp
        total += amp
        amp *= 0.5
    return out / total


def rgba(rgb: np.ndarray, alpha: np.ndarray | None = None) -> np.ndarray:
    h, w = rgb.shape[:2]
    a = np.ones((h, w, 1)) if alpha is None else alpha[..., None]
    return np.clip(np.concatenate([rgb, a], axis=2), 0, 1).astype(np.float32)


def concrete(size: int = 512, seed: int = 1) -> np.ndarray:
    """Sun-bleached lane concrete: grain, soft stains, a few hairline cracks and tar patches."""
    rng = np.random.default_rng(seed)
    base = 0.6 + 0.12 * (fbm(size, 4, 5, rng) - 0.5) * 2
    grain = rng.random((size, size)) * 0.06
    stains = np.clip((fbm(size, 3, 4, rng) - 0.62) * 3.0, 0, 1) * 0.22
    v = base + grain - 0.03 - stains
    # cracks: random walks, darker
    crack = np.zeros((size, size))
    for _ in range(5):
        x, y = rng.random() * size, rng.random() * size
        ang = rng.random() * math.tau
        for _ in range(int(size * 0.4)):
            ang += rng.normal(0, 0.18)
            x, y = (x + math.cos(ang)) % size, (y + math.sin(ang)) % size
            crack[int(y), int(x)] = 1
    v -= crack * 0.1
    warm = np.stack([v * 1.03, v * 0.99, v * 0.93], axis=2)
    return rgba(warm)


def plaster(size: int = 256, seed: int = 2) -> np.ndarray:
    """Near-white plaster grunge, multiplied by each house's paint colour (glTF base colour factor)."""
    rng = np.random.default_rng(seed)
    n = fbm(size, 4, 5, rng)
    drip = value_noise(size, 16, rng)[:, :1].repeat(size, axis=1).T  # faint vertical rain streaks
    v = 0.9 + (n - 0.5) * 0.2 - np.clip(drip - 0.75, 0, 1) * 0.08 + rng.random((size, size)) * 0.025
    return rgba(np.stack([v, v, v * 0.98], axis=2))


def kolam(size: int = 256) -> np.ndarray:
    """A rice-flour kolam: a dot grid with loops around the dots (white on transparent)."""
    yy, xx = np.mgrid[0:size, 0:size] / size * 2 - 1
    a = np.zeros((size, size))
    n = 5
    pts = [(-0.8 + 1.6 * i / (n - 1), -0.8 + 1.6 * j / (n - 1)) for i in range(n) for j in range(n)]
    for (px, py) in pts:
        d = np.hypot(xx - px, yy - py)
        a = np.maximum(a, (d < 0.035).astype(float))                       # the dots
        a = np.maximum(a, np.clip(1 - np.abs(d - 0.17) / 0.018, 0, 1) * 0.95)  # a loop around each dot
    r = np.hypot(xx, yy)
    petals = np.cos(np.arctan2(yy, xx) * 8)
    a = np.maximum(a, np.clip(1 - np.abs(r - (0.92 + petals * 0.05)) / 0.02, 0, 1))  # a petal border
    a *= r < 1.0
    return rgba(np.ones((size, size, 3)) * 0.97, a)


def mural(w: int = 512, h: int = 256, seed: int = 5) -> np.ndarray:
    """The far wall's painted mural: a sunrise, hills, a kite and festive stripes (original, flat colours)."""
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:h, 0:w]
    u, v = xx / w, yy / h
    sky = np.stack([0.98 - v * 0.2, 0.62 + v * 0.2, 0.35 + v * 0.35], axis=2)
    img = sky.copy()
    sun = np.hypot((u - 0.3) * 2, v - 0.55) < 0.22
    img[sun] = (1.0, 0.86, 0.3)
    for k, (col, amp, off) in enumerate([((0.15, 0.55, 0.35), 0.06, 0.62), ((0.1, 0.42, 0.28), 0.08, 0.72)]):
        ridge = off + amp * np.sin(u * math.tau * (1.5 + k) + k)
        img[v > ridge] = col
    kite = (np.abs(u - 0.72) + np.abs(v - 0.3) * 0.7) < 0.08
    img[kite] = (0.9, 0.2, 0.45)
    stripes = v > 0.88
    band = (np.floor(u * 24) % 3).astype(int)
    pal = np.array([(0.95, 0.3, 0.3), (1.0, 0.8, 0.2), (0.2, 0.6, 0.9)])
    img[stripes] = pal[band[stripes]]
    img *= 0.92 + 0.08 * fbm(max(w, h), 6, 3, rng)[:h, :w, None]
    return rgba(img)


def write_all(out_dir: str) -> dict[str, str]:
    os.makedirs(out_dir, exist_ok=True)
    files = {
        "concrete": (concrete(), "gully_concrete.png", True),
        "plaster": (plaster(), "gully_plaster.png", True),
        "kolam": (kolam(), "gully_kolam.png", False),
        "mural": (mural(), "gully_mural.png", True),
    }
    paths = {}
    for key, (arr, name, opaque) in files.items():
        p = os.path.join(out_dir, name)
        atlas.save_rgba(arr, p, "PNG")
        if opaque:  # opaque textures travel as JPEG inside the GLB (a third of the size)
            import bpy
            img = bpy.data.images.load(p)
            img.file_format = "JPEG"
            p = p[:-4] + ".jpg"
            img.save(filepath=p, quality=88)
            bpy.data.images.remove(img)
        paths[key] = p
    return paths
