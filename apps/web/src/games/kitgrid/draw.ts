/**
 * kitgrid/draw: paints a board of square cells on a 2D canvas from the Blender-rendered atlas
 * (tools/blender/kitgrid → /assets/grid/grid.json + grid.webp, "pwtv-plat" v1 like kitplat).
 * Canvas 2D, no WebGL: these boards are a few hundred sprites, which a cheap TV draws in well under a
 * millisecond, and the static parts (walls, turf, mazes) are painted once into a cached layer.
 */
export interface Rect { x: number; y: number; w: number; h: number }
interface SpriteDef { frames: Rect[]; pivot: { x: number; y: number }; fps: number; loop: boolean }
interface Manifest { format: "pwtv-plat"; version: 1; image: string; ppm: number; sprites: Record<string, SpriteDef> }

export interface GridAtlas { img: HTMLImageElement; ppm: number; sprites: Record<string, SpriteDef> }

export const ATLAS_URL = "/assets/grid/grid.json";
let loading: Promise<GridAtlas> | null = null;

export function loadGridAtlas(url = ATLAS_URL): Promise<GridAtlas> {
  loading ??= (async () => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`grid atlas: HTTP ${res.status}`);
    const m = (await res.json()) as Manifest;
    if (m.format !== "pwtv-plat" || m.version !== 1) throw new Error("grid atlas: unknown format");
    const img = new Image();
    img.decoding = "async";
    img.src = url.slice(0, url.lastIndexOf("/") + 1) + m.image;
    await img.decode();
    return { img, ppm: m.ppm, sprites: m.sprites };
  })();
  loading.catch(() => (loading = null));
  return loading;
}

export interface SpriteOpts {
  rot?: number;
  /** Multiplies the sprite's natural size (1 = one Blender metre per cell). */
  scale?: number;
  alpha?: number;
  /** Frame index; default: animated by time at the sprite's fps. */
  frame?: number;
  /** Seconds offset so a row of the same sprite doesn't animate in lockstep. */
  phase?: number;
  flipX?: boolean;
}

/** One per board; the shell updates `t`, `cell` and the origin every frame. Coordinates are in cells. */
export class Draw {
  t = 0;
  cell = 32;
  ox = 0;
  oy = 0;
  /** Cached static layers by key. */
  private layers = new Map<string, HTMLCanvasElement>();

  constructor(public ctx: CanvasRenderingContext2D, public atlas: GridAtlas | null) {}

  has(id: string): boolean {
    return !!this.atlas?.sprites[id];
  }

  /** Draws sprite `id` with its ground point at cell coordinates (cx, cy) (cell centre = x + 0.5). */
  sprite(id: string, cx: number, cy: number, o: SpriteOpts = {}) {
    const s = this.atlas?.sprites[id];
    const px = this.ox + cx * this.cell;
    const py = this.oy + cy * this.cell;
    const ctx = this.ctx;
    if (!s || !this.atlas) {
      ctx.fillStyle = "#ff00ff";
      ctx.fillRect(px - this.cell * 0.3, py - this.cell * 0.3, this.cell * 0.6, this.cell * 0.6);
      return;
    }
    const n = s.frames.length;
    const f = o.frame ?? Math.floor((this.t + (o.phase ?? 0)) * s.fps);
    const r = s.frames[s.loop ? ((f % n) + n) % n : Math.min(n - 1, Math.max(0, f))]!;
    const k = (this.cell / this.atlas.ppm) * (o.scale ?? 1);
    const w = r.w * k;
    const h = r.h * k;
    const needXf = o.rot || o.flipX;
    if (o.alpha !== undefined) ctx.globalAlpha = o.alpha;
    if (needXf) {
      ctx.save();
      ctx.translate(px, py);
      if (o.rot) ctx.rotate(o.rot);
      if (o.flipX) ctx.scale(-1, 1);
      ctx.drawImage(this.atlas.img, r.x, r.y, r.w, r.h, -s.pivot.x * w, -s.pivot.y * h, w, h);
      ctx.restore();
    } else {
      ctx.drawImage(this.atlas.img, r.x, r.y, r.w, r.h, px - s.pivot.x * w, py - s.pivot.y * h, w, h);
    }
    if (o.alpha !== undefined) ctx.globalAlpha = 1;
  }

  rect(x: number, y: number, w: number, h: number, color: string, radius = 0) {
    const c = this.ctx;
    c.fillStyle = color;
    const X = this.ox + x * this.cell, Y = this.oy + y * this.cell, W = w * this.cell, H = h * this.cell;
    if (radius > 0) {
      c.beginPath();
      c.roundRect(X, Y, W, H, radius * this.cell);
      c.fill();
    } else c.fillRect(X, Y, W, H);
  }

  stroke(x: number, y: number, w: number, h: number, color: string, width = 0.06, radius = 0) {
    const c = this.ctx;
    c.strokeStyle = color;
    c.lineWidth = width * this.cell;
    c.beginPath();
    c.roundRect(this.ox + x * this.cell, this.oy + y * this.cell, w * this.cell, h * this.cell, radius * this.cell);
    c.stroke();
  }

  circle(cx: number, cy: number, r: number, color: string) {
    const c = this.ctx;
    c.fillStyle = color;
    c.beginPath();
    c.arc(this.ox + cx * this.cell, this.oy + cy * this.cell, r * this.cell, 0, Math.PI * 2);
    c.fill();
  }

  text(s: string, cx: number, cy: number, size: number, color: string, weight = 800) {
    const c = this.ctx;
    c.fillStyle = color;
    c.font = `${weight} ${Math.round(size * this.cell)}px system-ui, sans-serif`;
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText(s, this.ox + cx * this.cell, this.oy + cy * this.cell);
  }

  /**
   * A static layer (cols × rows cells) painted once by `paint` and reused until `key` or the cell size
   * changes: walls, turf and mazes cost one drawImage per frame.
   */
  layer(key: string, cols: number, rows: number, paint: (d: Draw) => void) {
    const k = `${key}|${this.cell}`;
    let cv = this.layers.get(k);
    if (!cv) {
      for (const old of this.layers.keys()) if (old.startsWith(`${key}|`)) this.layers.delete(old);
      cv = document.createElement("canvas");
      cv.width = Math.ceil(cols * this.cell);
      cv.height = Math.ceil(rows * this.cell);
      const ctx = cv.getContext("2d")!;
      const sub = new Draw(ctx, this.atlas);
      sub.cell = this.cell;
      sub.t = 0;
      paint(sub);
      this.layers.set(k, cv);
    }
    this.ctx.drawImage(cv, this.ox, this.oy);
  }

  /** Drops cached layers (level change). */
  reset() {
    this.layers.clear();
  }
}
