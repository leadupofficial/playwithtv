/**
 * kitplat/render/view: draws a World with pre-rendered sprites through an orthographic side camera, in a fixed
 * number of draw calls whatever happens on screen:
 *   sky, far, mid backdrops (3) · decorations + tiles + moving platforms (1) · pick-ups (1) · foes + boss (1) ·
 *   heroes (1) · particles, shots, bubbles and power overlays (1)          → 8 draw calls
 * The lite tier renders at 1280×720 from half-size atlases; high/ultra at 1920×1080 from full-size ones with more
 * particles and rain. No lights, no shadow maps, no post-processing on any tier.
 */
import * as THREE from "three";
import { type AnimState, bossPose, foePose, heroPose, newAnim } from "../anim";
import { layoutTiles, type TileLayout } from "../autotile";
import { bossVulnerable } from "../boss";
import { Tile } from "../level";
import type { Hero, World } from "../types";
import { spikesOut } from "../world";
import type { Atlas, SpriteDef } from "./atlas";
import { Backdrop, LAYERS } from "./backdrop";
import { GlowBatch, Vignette } from "./glow";
import { DROP, Particles } from "./particles";
import { QuadBatch } from "./quads";

export interface ViewAssets {
  hero: Atlas; tiles: Atlas; items: Atlas; foes: Atlas;
  sky: THREE.Texture; far: THREE.Texture; mid: THREE.Texture;
  /** Foreground silhouettes (high and ultra only), or null. */
  fg: THREE.Texture | null;
  /** Decoded size of the backdrop images (w × h × 4 each). */
  bgBytes: number;
}

export interface ViewOptions {
  /** Render size (the drawing buffer), e.g. 1280×720 on lite. */
  width: number;
  height: number;
  particles: number;
  rain: number;
  /** Hue (degrees) of the heroes' paint that takes the player colour. */
  keyHue: number;
  /** Power-up id → overlay sprite drawn over the hero while it is active (an open umbrella, a kite). */
  overlays: Record<string, string>;
  /** High/ultra extras: additive glows, a vignette and the foreground layer. Off on the lite tier. */
  extras: boolean;
  /** Glow colour of gems and lamps for this world. */
  glow: string;
}

export interface HeroLook { color: string; name: string }

const TILE_EXTRA = 64;

export class PlatView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-12, 12, 6.75, -6.75, -10, 10);
  readonly particles: Particles;
  private layers: Backdrop[];
  private tiles!: QuadBatch;
  private back: QuadBatch;
  private foes: QuadBatch;
  private heroes: QuadBatch;
  private front: QuadBatch;
  private layout!: TileLayout;
  private anims: AnimState[] = [];
  private colors: THREE.Color[];
  private sp: Record<string, SpriteDef> = {};
  private time = 0;
  private rainT = 0;
  private glow: GlowBatch | null = null;
  private vignette: Vignette | null = null;
  private fg: Backdrop | null = null;
  private lamps: Array<{ x: number; y: number }> = [];

  constructor(canvas: HTMLCanvasElement, readonly assets: ViewAssets, readonly looks: HeroLook[], readonly opt: ViewOptions) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: "high-performance", stencil: false, depth: false });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(opt.width, opt.height, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.autoClear = true;
    this.layers = [new Backdrop(assets.sky, LAYERS.sky, -30, true), new Backdrop(assets.far, LAYERS.far, -29), new Backdrop(assets.mid, LAYERS.mid, -28)];
    for (const l of this.layers) this.scene.add(l.mesh);
    this.back = new QuadBatch(assets.items, 512, { order: -10 });
    this.foes = new QuadBatch(assets.foes, 96, { order: -5, outline: 1.6 });
    this.heroes = new QuadBatch(assets.hero, 8, { order: 0, keyHue: opt.keyHue, outline: 2 });
    this.front = new QuadBatch(assets.items, opt.particles + opt.rain + 64, { order: 5 });
    this.particles = new Particles(opt.particles);
    for (const b of [this.back, this.foes, this.heroes, this.front]) this.scene.add(b.mesh);
    if (opt.extras) {
      this.glow = new GlowBatch(160, 3);
      this.vignette = new Vignette(30);
      this.scene.add(this.glow.mesh, this.vignette.mesh);
      if (assets.fg) {
        this.fg = new Backdrop(assets.fg, { height: 15, fx: 1.35, fy: 1.1 }, 20);
        this.fg.mesh.material.uniforms.alpha!.value = 0.92;
        this.scene.add(this.fg.mesh);
      }
    }
    this.colors = looks.map((l) => new THREE.Color(l.color));
    for (const id of ["puff", "star", "shot", "bossshot", "bubble", "shield", "gem", "biggem", "spring", "boost", "loop", "goal", "checkpoint-on", "checkpoint-off", "lever-on", "lever-off"]) {
      if (assets.items.manifest.sprites[id]) this.sp[id] = assets.items.manifest.sprites[id]!;
    }
  }

  /** Builds the tile layer for a new level (decorations, tiles, then room for dynamic cells and platforms). */
  setLevel(w: World, grade?: string) {
    if (this.tiles) { this.scene.remove(this.tiles.mesh); this.tiles.dispose(); }
    const ids = Object.keys(this.assets.tiles.manifest.sprites);
    this.layout = layoutTiles(w.level, ids.filter((k) => k.startsWith("deco-")), w.level.w * 31 + w.level.h, ids.filter((k) => k.startsWith("wall-")));
    const L = this.layout;
    this.tiles = new QuadBatch(this.assets.tiles, L.decos.length + L.tiles.length + L.walls.length + L.dynamic.length + TILE_EXTRA, { order: -20 });
    this.scene.add(this.tiles.mesh);
    const S = this.assets.tiles.manifest.sprites;
    this.tiles.begin();
    for (const d of L.decos) { const s = S[d.sprite]; if (s) this.tiles.put(s, 0, d.x, d.y); }
    for (const list of [L.tiles, L.walls]) {
      for (const t of list) {
        const s = S[t.sprite];
        if (!s) continue;
        const bx = s.box ?? [0, 0, 1, 1];
        // deeper ground is darker (baked ambient occlusion, for free)
        const d = L.depth.get(t.r * w.level.w + t.c) ?? 0;
        const k = Math.max(0.42, 1 - d * 0.13);
        this.tiles.style.r = this.tiles.style.g = this.tiles.style.b = k;
        this.tiles.putBox(s, 0, t.c + bx[0], t.r + bx[1], bx[2], bx[3]);
      }
    }
    this.tiles.freeze();
    for (const l of this.layers) l.setGrade(grade ?? "#ffffff");
    // lamps and lanterns among the decorations glow on the high tiers
    const LAMP: Record<string, [number, number]> = { "deco-lantern": [0.45, 1.45], "deco-diya": [0, 0.95], "deco-lamp": [0.04, 0.96] };
    this.lamps = L.decos.filter((d) => LAMP[d.sprite]).map((d) => ({ x: d.x + LAMP[d.sprite]![0], y: d.y + LAMP[d.sprite]![1] }));
    this.anims = w.heroes.map(() => newAnim());
    this.particles.clear();
  }

  /** Draws one frame. `shake` offsets the camera (screen shake). */
  render(w: World, dt: number, shakeX = 0, shakeY = 0) {
    this.time += dt;
    const cam = w.cam;
    const c = this.camera;
    c.left = -cam.vw / 2; c.right = cam.vw / 2; c.top = cam.vh / 2; c.bottom = -cam.vh / 2;
    c.position.set(cam.x + shakeX, cam.y + shakeY, 5);
    c.updateProjectionMatrix();
    c.updateMatrixWorld();
    for (const l of this.layers) l.update(cam, cam.vh / 2 - 0.6);
    this.fg?.update(cam, cam.vh / 2 - 0.6);
    this.drawTiles(w);
    this.drawItems(w);
    this.drawFoes(w);
    this.drawHeroes(w, dt);
    this.drawFront(w, dt);
    if (this.glow) this.drawGlow(w);
    this.renderer.render(this.scene, c);
  }

  private drawTiles(w: World) {
    const T = this.tiles, S = this.assets.tiles.manifest.sprites;
    T.begin();
    for (const d of this.layout.dynamic) {
      const t = w.col.tile(d.c, d.r);
      const s = S[d.sprite];
      if (!s) continue;
      const bx = s.box ?? [0, 0, 1, 1];
      let x = d.c + bx[0], y = d.r + bx[1];
      if (d.sprite === "crate" && t !== Tile.Crate) continue;
      if (d.sprite === "crumble") {
        if (t !== Tile.Crumble) continue;
        const k = w.crumble[d.r * w.level.w + d.c]!;
        if (k > 0) { x += Math.sin(this.time * 70) * 0.04; y -= k * 0.1; }
      }
      if (d.sprite === "gate") {
        const open = w.col.gateOpen[t === Tile.GateA ? 0 : 1];
        if (open) { T.style.alpha = 0.22; y += 0.75; }
      }
      if (d.sprite === "tspikes-out") {
        if (!spikesOut(w, d.c)) continue;
      }
      T.putBox(s, 0, x, y, bx[2], bx[3]);
    }
    const plat = S.platform;
    if (plat) {
      const bx = plat.box ?? [-1.6, 0.25, 3.2, 0.9];
      for (const p of w.col.platforms) {
        const k = (p.hw * 2) / 3;
        T.putBox(plat, 0, p.x + bx[0] * k, p.y - 1 + bx[1], bx[2] * k, bx[3]);
      }
    }
    T.end();
  }

  private drawItems(w: World) {
    const B = this.back, S = this.assets.items.manifest.sprites, t = this.time;
    B.begin();
    for (const it of w.items) {
      switch (it.kind) {
        case "loop": { const s = S.loop; if (s) B.put(s, 0, it.x, it.y); break; }
        case "gem": case "biggem": { if (it.taken) break; const s = S[it.kind]!; B.put(s, Math.floor(t * s.fps + it.x * 0.7) % s.frames.length, it.x, it.y - 0.25); break; }
        case "powerup": {
          if (it.taken || !it.power) break;
          const s = S[it.power];
          if (s) B.put(s, Math.floor(t * s.fps) % s.frames.length, it.x, it.y - 0.4 + Math.sin(t * 3 + it.x) * 0.08);
          break;
        }
        case "spring": { const s = S.spring!; const f = it.t < 0.3 ? Math.min(s.frames.length - 1, Math.floor(it.t * s.fps)) : 0; B.put(s, f, it.x, it.y); break; }
        case "boost": { const s = S.boost; if (s) B.put(s, Math.floor(t * s.fps) % s.frames.length, it.x, it.y); break; }
        case "checkpoint": { const s = S[it.on ? "checkpoint-on" : "checkpoint-off"]; if (s) B.put(s, Math.floor(t * s.fps) % s.frames.length, it.x, it.y); break; }
        case "goal": { const s = S.goal; if (s) B.put(s, Math.floor(t * s.fps) % s.frames.length, it.x, it.y); break; }
        case "leverA": case "leverB": {
          const open = w.col.gateOpen[it.kind === "leverA" ? 0 : 1];
          const s = S[open ? "lever-on" : "lever-off"];
          if (s) B.put(s, 0, it.x, it.y);
          break;
        }
      }
    }
    B.end();
  }

  private drawFoes(w: World) {
    const F = this.foes, S = this.assets.foes.manifest.sprites;
    F.begin();
    for (const f of w.foes) {
      if (f.state === "dead" && f.deadT > 0.6) continue;
      const p = foePose(f, this.time);
      const s = S[p.clip];
      if (!s) continue;
      F.style.flipX = p.flipX; F.style.sx = p.sx; F.style.sy = p.sy; F.style.rot = p.rot; F.style.alpha = p.alpha;
      const fr = s.loop ? Math.floor(p.t * s.fps) % s.frames.length : Math.min(s.frames.length - 1, Math.floor(p.t * s.fps));
      F.put(s, fr, f.body.x, f.body.y);
    }
    const b = w.boss;
    if (b && !(b.dead && b.deadT > 2.2)) {
      const p = bossPose(b, this.time, bossVulnerable(b));
      const s = S[p.clip];
      if (s) {
        F.style.flipX = p.flipX; F.style.sx = p.sx; F.style.sy = p.sy; F.style.rot = p.rot; F.style.alpha = p.alpha;
        F.style.flash = b.hurtT > 0.75 ? 0.8 : 0;
        F.put(s, Math.floor(p.t * s.fps) % s.frames.length, b.body.x, b.body.y);
      }
    }
    F.end();
  }

  private drawHeroes(w: World, dt: number) {
    const H = this.heroes, S = this.assets.hero.manifest.sprites;
    H.begin();
    for (const h of w.heroes) {
      if (h.down === "wait") continue;
      const a = this.anims[h.slot] ?? (this.anims[h.slot] = newAnim());
      const p = heroPose(h, a, dt, this.time, w.spec.feel.walk);
      const s = S[h.down === "bubble" ? "fall" : p.clip] ?? S.idle!;
      const st = H.style;
      st.flipX = p.flipX; st.sx = p.sx; st.sy = p.sy; st.rot = p.rot; st.alpha = p.alpha;
      st.tint = this.colors[h.slot] ?? null; st.tintK = 1;
      if (h.down === "bubble") { st.sx = st.sy = 0.72; st.alpha = 0.9; }
      if (h.hurtT > 0.3) st.flash = 0.7;
      const fr = s.loop ? Math.floor(p.t * s.fps) % s.frames.length : Math.min(s.frames.length - 1, Math.floor(p.t * s.fps));
      H.put(s, fr, h.body.x, h.body.y + (h.down === "bubble" ? 0.25 : 0));
    }
    H.end();
  }

  private drawFront(w: World, dt: number) {
    const F = this.front, S = this.sp, t = this.time;
    this.particles.update(dt);
    F.begin();
    // rain (monsoon): streaks that wrap around the view
    if (this.opt.rain > 0 && S.puff) {
      this.rainT += dt;
      const cam = w.cam;
      for (let i = 0; i < this.opt.rain; i++) {
        const fx = ((i * 0.6180339 + 0.13) % 1), fy = ((i * 0.7548776 + this.rainT * 1.6 * (0.8 + (i % 5) * 0.08)) % 1);
        F.style.sx = 0.06; F.style.sy = 1.4; F.style.alpha = 0.32; F.style.rot = 0.16; F.style.r = 0.75; F.style.g = 0.85; F.style.b = 1;
        F.put(S.puff, 0, cam.x - cam.vw / 2 + fx * (cam.vw + 2), cam.y + cam.vh / 2 + 1 - fy * (cam.vh + 2));
      }
    }
    const overlays = this.opt.overlays;
    for (const h of w.heroes) {
      if (h.down === "bubble" && S.bubble) { F.style.alpha = 0.85; F.put(S.bubble, 0, h.body.x, h.body.y - 0.15); continue; }
      if (h.down) continue;
      const ov = h.power && overlays[h.power.id];
      if (ov && this.assets.items.manifest.sprites[ov] && (h.power?.glide ? !h.body.grounded : true)) {
        F.style.flipX = h.facing < 0;
        F.put(this.assets.items.manifest.sprites[ov]!, 0, h.body.x, h.body.y + h.body.h + 0.05);
      }
      if (h.shield > 0 && S.shield) { F.style.alpha = 0.6 + 0.2 * Math.sin(t * 8); F.style.rot = t; F.put(S.shield, 0, h.body.x, h.body.y - 0.1); }
    }
    for (const s of w.shots) {
      if (!s.alive || !S.shot) continue;
      F.style.rot = t * 12;
      F.put(S.shot, Math.floor(t * 14) % S.shot.frames.length, s.x, s.y - 0.2);
    }
    if (w.boss && S.bossshot) {
      for (const s of w.boss.shots) {
        if (!s.alive) continue;
        F.put(S.bossshot, Math.floor(t * 14) % S.bossshot.frames.length, s.x, s.y - 0.25);
      }
    }
    if (S.puff && S.star) this.particles.draw(F, S.puff, S.star, S.puff);
    void DROP;
    F.end();
  }

  private drawGlow(w: World) {
    const G = this.glow!, col = this.opt.glow, t = this.time;
    G.begin();
    for (const it of w.items) {
      if ((it.kind === "gem" || it.kind === "biggem") && !it.taken) G.add(it.x, it.y, it.kind === "gem" ? 0.75 : 1.2, col, 0.32 + 0.08 * Math.sin(t * 4 + it.x));
      else if (it.kind === "powerup" && !it.taken) G.add(it.x, it.y, 1.3, "#ffffff", 0.35);
      else if (it.kind === "checkpoint" && it.on) G.add(it.x + 0.3, it.y + 1.5, 1.2, "#ffd27a", 0.3);
      else if (it.kind === "goal") G.add(it.x, it.y + 1.6, 2.6, "#ffe7a0", 0.35 + 0.1 * Math.sin(t * 3));
    }
    for (const l of this.lamps) G.add(l.x, l.y, 1.5, "#ffb04a", 0.42 + 0.06 * Math.sin(t * 9 + l.x));
    for (const s of w.shots) if (s.alive) G.add(s.x, s.y, 1.0, "#fff0b0", 0.5);
    if (w.boss) for (const s of w.boss.shots) if (s.alive) G.add(s.x, s.y, 0.9, "#ff9a5a", 0.35);
    for (const h of w.heroes) if (h.power && !h.down) G.add(h.body.x, h.body.y + 0.6, 1.4, h.power.aura ?? "#fff3c4", 0.18);
    G.end();
  }

  /** Decoded image memory this view holds: its four atlases and three backdrops (w × h × 4 each). */
  decodedBytes(): number {
    const a = this.assets;
    return a.hero.bytes + a.tiles.bytes + a.items.bytes + a.foes.bytes + a.bgBytes;
  }

  /** Stats for the debug attribute and the budget tests. */
  info() {
    const r = this.renderer.info.render;
    return { calls: r.calls, tris: r.triangles };
  }

  dispose() {
    for (const l of this.layers) l.dispose();
    for (const b of [this.tiles, this.back, this.foes, this.heroes, this.front]) b?.dispose();
    this.glow?.dispose();
    this.vignette?.dispose();
    this.fg?.dispose();
    this.renderer.dispose();
  }

  /** Hero's head position in normalised screen coordinates (for name tags), into `out`. */
  headOnScreen(h: Hero, out: { x: number; y: number }) {
    const c = this.camera;
    out.x = (h.body.x - (c.position.x + c.left)) / (c.right - c.left);
    out.y = 1 - (h.body.y + h.body.h + 0.45 - (c.position.y + c.bottom)) / (c.top - c.bottom);
    return out;
  }
}
