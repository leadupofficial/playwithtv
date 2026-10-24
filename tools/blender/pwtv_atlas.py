"""
Sprite atlas packing for the Play With TV Blender pipeline (numpy + Blender's image IO; no Pillow needed).

All frames of one sheet are cropped to the SAME rectangle (the union of every frame's visible pixels plus a small
pad), so the model keeps one scale and one pivot across directions and frames. Cells are then laid out in a near-
square grid, row-major, in the order the caller gives (direction-major: index = direction * frames + frame).

Coordinates in the manifest are image pixels with the origin at the TOP-LEFT (the web's convention), although
Blender stores pixel rows bottom-up internally.
"""
from __future__ import annotations

import math
import os

import bpy
import numpy as np


def load_rgba(path: str) -> np.ndarray:
    """An (h, w, 4) float array, rows TOP-DOWN, values 0..1 exactly as stored in the file (no colour conversion)."""
    img = bpy.data.images.load(os.path.abspath(path), check_existing=False)
    img.colorspace_settings.name = "Non-Color"  # read the stored bytes, never convert
    w, h = img.size
    buf = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(buf)
    bpy.data.images.remove(img)
    return buf.reshape(h, w, 4)[::-1]


def save_rgba(arr: np.ndarray, path: str, fmt: str = "PNG", quality: int = 90) -> None:
    """Writes an (h, w, 4) TOP-DOWN array as PNG or WEBP (8-bit, straight alpha)."""
    h, w = arr.shape[:2]
    img = bpy.data.images.new(os.path.basename(path), w, h, alpha=True, float_buffer=False)
    img.colorspace_settings.name = "Non-Color"
    img.alpha_mode = "STRAIGHT"
    img.pixels.foreach_set(np.ascontiguousarray(arr[::-1]).ravel().astype(np.float32))
    img.filepath_raw = os.path.abspath(path)
    img.file_format = fmt
    if fmt == "WEBP":
        img.save(filepath=os.path.abspath(path), quality=quality)
    else:
        img.save()
    bpy.data.images.remove(img)


def clean_alpha(frame: np.ndarray, floor: float = 10 / 255) -> np.ndarray:
    """
    Fades out near-invisible alpha (the shadow catcher's faint, far-reaching occlusion) so cells crop tight: alpha
    is remapped (a - floor) / (1 - floor), continuous, so the shadow's edge stays soft.
    """
    frame[:, :, 3] = np.clip((frame[:, :, 3] - floor) / (1 - floor), 0, 1)
    return frame


def union_bbox(frames: list[np.ndarray], pad: int = 2, threshold: float = 1.5 / 255) -> tuple[int, int, int, int]:
    """(x0, y0, x1, y1), top-left origin, exclusive end: the smallest box holding every visible pixel of every frame."""
    h, w = frames[0].shape[:2]
    mask = np.zeros((h, w), dtype=bool)
    for f in frames:
        mask |= f[:, :, 3] > threshold
    ys, xs = np.nonzero(mask)
    if len(xs) == 0:
        return 0, 0, w, h
    x0, x1 = max(0, xs.min() - pad), min(w, xs.max() + 1 + pad)
    y0, y1 = max(0, ys.min() - pad), min(h, ys.max() + 1 + pad)
    # even sizes keep half-pixel pivots tidy
    def even(a: int, b: int, limit: int) -> tuple[int, int]:
        if (b - a) % 2:
            if b < limit:
                b += 1
            elif a > 0:
                a -= 1
        return a, b
    x0, x1 = even(int(x0), int(x1), w)
    y0, y1 = even(int(y0), int(y1), h)
    return x0, y0, x1, y1


def grid_for(count: int, cw: int, ch: int, max_size: int = 4096) -> tuple[int, int]:
    """Columns and rows for `count` cells of cw×ch that make the most square atlas within max_size."""
    best = None
    for cols in range(1, count + 1):
        rows = math.ceil(count / cols)
        w, h = cols * cw, rows * ch
        if w > max_size or h > max_size:
            continue
        score = (max(w, h), w * h)
        if best is None or score < best[0]:
            best = (score, cols, rows)
    if best is None:
        raise SystemExit(f"{count} frames of {cw}x{ch} do not fit a {max_size}px atlas: lower --size or --frames")
    return best[1], best[2]


def pack(frames: list[np.ndarray], box: tuple[int, int, int, int], max_size: int = 4096):
    """Crops every frame to `box` and lays them out in a grid. Returns (atlas, rects, (cols, rows))."""
    x0, y0, x1, y1 = box
    cw, ch = x1 - x0, y1 - y0
    cols, rows = grid_for(len(frames), cw, ch, max_size)
    atlas = np.zeros((rows * ch, cols * cw, 4), dtype=np.float32)
    rects = []
    for i, f in enumerate(frames):
        c, r = i % cols, i // cols
        atlas[r * ch:(r + 1) * ch, c * cw:(c + 1) * cw] = f[y0:y1, x0:x1]
        rects.append({"x": c * cw, "y": r * ch, "w": cw, "h": ch})
    return atlas, rects, (cols, rows)


def preview(sheet: np.ndarray, top=(0.42, 0.47, 0.52), bottom=(0.20, 0.22, 0.25)) -> np.ndarray:
    """The atlas over a soft vertical gradient (opaque): for eyeballing shadows and edges, not for the game."""
    h = sheet.shape[0]
    t = np.linspace(0, 1, h, dtype=np.float32)[:, None, None]
    bg = np.array(top, np.float32) * (1 - t) + np.array(bottom, np.float32) * t
    a = sheet[:, :, 3:4]
    out = np.ones_like(sheet)
    out[:, :, :3] = sheet[:, :, :3] * a + bg * (1 - a)
    return out


def bleed_edges(atlas: np.ndarray) -> np.ndarray:
    """
    Copies colour (not alpha) of visible pixels into their transparent neighbours, a few times. Bilinear filtering
    on the TV then never pulls black fringes into the sprite's edge.
    """
    out = atlas.copy()
    rgb, a = out[:, :, :3], out[:, :, 3]
    known = a > 1.5 / 255
    for _ in range(4):
        acc = np.zeros_like(rgb)
        cnt = np.zeros(a.shape, dtype=np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            sk = np.roll(known, (dy, dx), axis=(0, 1))
            acc += np.roll(rgb, (dy, dx), axis=(0, 1)) * sk[:, :, None]
            cnt += sk
        grow = (~known) & (cnt > 0)
        rgb[grow] = acc[grow] / cnt[grow][:, None]
        known = known | grow
    return out
