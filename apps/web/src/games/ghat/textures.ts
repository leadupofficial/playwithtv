/**
 * GHAT RUSH textures painted in code (no files to download): wet asphalt with lane markings and laterite
 * shoulders (+ a roughness twin for the PBR tiers), the monsoon sky panorama of misty Western Ghats ridges, a soft
 * glow sprite and signboards. Deterministic (seeded) so every TV paints the same world.
 */
import * as THREE from "three";
import { makeRng } from "./race";

/** Road texture layout: u ∈ [0, ROAD_U] is the road cross-section; u ∈ [WHITE_U, 1] is plain white (rails, props). */
export const ROAD_U = 0.875;
export const WHITE_U = 0.94;
/** Metres of road per texture repeat along v. */
export const ROAD_REPEAT = 12;

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return { c, g: c.getContext("2d")! };
}

function finish(c: HTMLCanvasElement, srgb = true, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** Wet asphalt, both shoulders, lane lines; `rough` paints the matching roughness map instead. */
export function roadTexture(rough = false): THREE.CanvasTexture {
  const W = 512, H = 1024;
  const { c, g } = canvas(W, H);
  const rnd = makeRng(rough ? 77 : 77);
  const R = W * ROAD_U;
  const sh = R * 0.085; // shoulder width in px
  const px = (u: number) => u * R;
  const col = (rgb: string, r: number) => (rough ? `rgb(${r},${r},${r})` : rgb);
  // asphalt with aggregate
  g.fillStyle = col("#1b1d1f", 105);
  g.fillRect(0, 0, R, H);
  for (let i = 0; i < 14000; i++) {
    const x = sh + rnd() * (R - 2 * sh), y = rnd() * H, l = rnd();
    g.fillStyle = rough ? `rgba(255,255,255,${0.05 + l * 0.1})` : l < 0.5 ? `rgba(15,16,18,${0.35 + l * 0.3})` : `rgba(110,112,112,${0.12 + l * 0.15})`;
    g.fillRect(x, y, 1 + rnd() * 2, 1 + rnd() * 2);
  }
  // darker, smoother tyre tracks in each lane (wet = shinier)
  for (const u of [0.25, 0.37, 0.63, 0.75]) {
    const grad = g.createLinearGradient(px(u) - 22, 0, px(u) + 22, 0);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(0.5, rough ? "rgba(0,0,0,0.35)" : "rgba(8,9,11,0.45)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.fillRect(px(u) - 22, 0, 44, H);
  }
  // puddles: irregular, elongated along the road, mostly by the edges and between the tyre tracks; on the
  // colour map a dark sheen (lite fakes the reflection), on the roughness map near-mirror
  for (let i = 0; i < 5; i++) {
    const cx = px([0.16, 0.3, 0.5, 0.7, 0.84][i]! + (rnd() - 0.5) * 0.06), cy = rnd() * H;
    for (let k = 0; k < 9; k++) {
      const x = cx + (rnd() - 0.5) * 40, y = cy + (rnd() - 0.5) * 200, rx = 8 + rnd() * 16, ry = 30 + rnd() * 70;
      for (const dy of [0, H, -H]) {
        const pg = g.createRadialGradient(x, y + dy, 0, x, y + dy, ry);
        if (rough) {
          pg.addColorStop(0, "rgba(0,0,0,0.45)");
          pg.addColorStop(0.6, "rgba(0,0,0,0.22)");
          pg.addColorStop(1, "rgba(0,0,0,0)");
        } else {
          pg.addColorStop(0, "rgba(10,12,14,0.5)");
          pg.addColorStop(0.5, "rgba(60,70,76,0.22)");
          pg.addColorStop(1, "rgba(20,22,24,0)");
        }
        g.fillStyle = pg;
        g.beginPath();
        g.ellipse(x, y + dy, rx, ry, 0, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
  // shoulders: red laterite earth and gravel, a gutter line
  for (const [x0, x1] of [[0, sh], [R - sh, R]] as const) {
    g.fillStyle = col("#6b3420", 235);
    g.fillRect(x0, 0, x1 - x0, H);
    for (let i = 0; i < 2600; i++) {
      const l = rnd();
      g.fillStyle = rough ? "rgba(255,255,255,0.1)" : l < 0.5 ? "rgba(60,25,14,0.6)" : "rgba(160,90,60,0.35)";
      g.fillRect(x0 + rnd() * (x1 - x0), rnd() * H, 2 + rnd() * 3, 2 + rnd() * 3);
    }
  }
  // rumble kerbs: 1 m red/white blocks just inside each shoulder
  for (const [u0, u1] of [[0.085, 0.1], [0.9, 0.915]] as const) {
    for (let k = 0; k < ROAD_REPEAT; k++) {
      g.fillStyle = rough ? "rgb(150,150,150)" : k % 2 ? "#c9302c" : "#ece8de";
      g.fillRect(px(u0), (k * H) / ROAD_REPEAT, px(u1) - px(u0), H / ROAD_REPEAT);
    }
  }
  // lane markings: solid edge lines, dashed centre line (3 m dash per ROAD_REPEAT)
  g.fillStyle = col("#e9e6da", 150);
  const lw = 7;
  g.fillRect(px(0.1), 0, lw, H);
  g.fillRect(px(0.9) - lw, 0, lw, H);
  const dash = (H * 3.5) / ROAD_REPEAT;
  g.fillRect(px(0.5) - lw / 2, 0, lw, dash);
  g.fillRect(px(0.5) - lw / 2, H / 2, lw, dash);
  // the white column for rails and props
  g.fillStyle = rough ? "rgb(170,170,170)" : "#ffffff";
  g.fillRect(W * WHITE_U, 0, W * (1 - WHITE_U), H);
  return finish(c, !rough);
}

/** Smooth 1D value noise (fractal), periodic over `period` samples. */
function ridge(rnd: () => number, period: number, octaves: number) {
  const layers = Array.from({ length: octaves }, (_, o) => {
    const n = 4 << o;
    return Array.from({ length: n }, () => rnd());
  });
  return (x: number) => {
    let v = 0, a = 1, tot = 0;
    layers.forEach((pts, o) => {
      const n = pts.length, f = ((x / period) * n) % n, i = Math.floor(f), t = f - i;
      const s = t * t * (3 - 2 * t);
      v += a * (pts[i % n]! * (1 - s) + pts[(i + 1) % n]! * s);
      tot += a;
      a *= o === 0 ? 0.55 : 0.5;
    });
    return v / tot;
  };
}

/**
 * The 360° monsoon panorama for the sky dome: bright overcast, rain-heavy clouds, then layer after layer of
 * misty ridges (aerial perspective), mist banks between them and thin waterfalls on the nearer cliffs.
 * Covers latitudes SKY_LAT[0]..SKY_LAT[1] (degrees) from bottom to top.
 */
export const SKY_LAT = [-14, 90] as const; // the whole upper sky: one dome mesh, one draw call
export function skyPanorama(): THREE.CanvasTexture {
  const W = 2048, H = 768;
  const { c, g } = canvas(W, H);
  const rnd = makeRng(2024);
  const latToY = (lat: number) => H - ((lat - SKY_LAT[0]) / (SKY_LAT[1] - SKY_LAT[0])) * H;
  const horizon = latToY(0);
  // sky: luminous grey-white near the horizon, deeper slate above
  const sky = g.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, "#4f5f66");
  sky.addColorStop(0.55, "#93a3a3");
  sky.addColorStop(1, "#cdd7d2");
  g.fillStyle = sky;
  g.fillRect(0, 0, W, H);
  // cloud masses: soft overlapping blobs, darker undersides
  for (let i = 0; i < 260; i++) {
    const x = rnd() * W, y = rnd() * horizon * 0.75, r = 30 + rnd() * 110;
    const dark = rnd() < 0.45;
    const cg = g.createRadialGradient(x, y, 0, x, y, r);
    cg.addColorStop(0, dark ? "rgba(62,72,78,0.4)" : "rgba(226,232,230,0.26)");
    cg.addColorStop(1, "rgba(200,210,210,0)");
    g.fillStyle = cg;
    for (const dx of [0, W, -W]) {
      g.beginPath();
      g.ellipse(x + dx, y, r * 1.9, r * 0.6, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
  // ridges: far → near, each darker, greener and taller
  const layers = [
    { base: 2.5, amp: 9, col: [150, 168, 170], mist: 0.0, oct: 5 },
    { base: 1.0, amp: 12, col: [118, 140, 136], mist: 0.35, oct: 5 },
    { base: -1.5, amp: 13, col: [82, 108, 98], mist: 0.45, oct: 6 },
    { base: -5, amp: 14, col: [52, 78, 64], mist: 0.5, oct: 6 },
    { base: -9, amp: 10, col: [34, 58, 44], mist: 0.55, oct: 6 },
  ];
  layers.forEach((L, li) => {
    const n = ridge(rnd, W, L.oct);
    const top = (x: number) => latToY(L.base + Math.pow(n(x), 1.6) * L.amp * 1.6);
    g.beginPath();
    g.moveTo(0, H);
    for (let x = 0; x <= W; x += 4) g.lineTo(x, top(x));
    g.lineTo(W, H);
    g.closePath();
    const [r, gg, b] = L.col as [number, number, number];
    const lg = g.createLinearGradient(0, latToY(L.base + L.amp), 0, H);
    lg.addColorStop(0, `rgb(${r},${gg},${b})`);
    lg.addColorStop(1, `rgb(${Math.round(r * 0.8)},${Math.round(gg * 0.85)},${Math.round(b * 0.85)})`);
    g.fillStyle = lg;
    g.fill();
    // forest texture on nearer ridges: little dark bumps along the crest
    if (li >= 2) {
      for (let x = 0; x < W; x += 3) {
        const y = top(x);
        g.fillStyle = `rgba(${r * 0.6},${gg * 0.7},${b * 0.6},0.5)`;
        g.beginPath();
        g.arc(x, y + 2, 2 + rnd() * 2.5, 0, Math.PI * 2);
        g.fill();
      }
    }
    // waterfalls: thin white threads down the near cliffs
    if (li === 3) {
      for (let k = 0; k < 5; k++) {
        const x = rnd() * W, y0 = top(x) + 6, len = 30 + rnd() * 40;
        const wf = g.createLinearGradient(0, y0, 0, y0 + len);
        wf.addColorStop(0, "rgba(235,242,240,0.85)");
        wf.addColorStop(1, "rgba(235,242,240,0)");
        g.fillStyle = wf;
        g.fillRect(x, y0, 2 + rnd() * 2, len);
      }
    }
    // mist bank in front of this layer
    if (L.mist > 0) {
      const my = latToY(L.base - 1);
      const mg = g.createLinearGradient(0, my - 26, 0, my + 18);
      mg.addColorStop(0, "rgba(214,222,218,0)");
      mg.addColorStop(0.6, `rgba(214,222,218,${L.mist})`);
      mg.addColorStop(1, "rgba(214,222,218,0)");
      g.fillStyle = mg;
      g.fillRect(0, my - 26, W, 44);
    }
  });
  const t = finish(c, true, false);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

/** A soft round glow (additive sprites: lamps, sparks, boost flames). */
export function glowTexture(): THREE.CanvasTexture {
  const { c, g } = canvas(64, 64);
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, "rgba(255,255,255,1)");
  r.addColorStop(0.25, "rgba(255,255,255,0.65)");
  r.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  return finish(c, false, false);
}

/** A roadside sign: white board, black border, bold text (original wording). */
export function signTexture(lines: string[], bg = "#f3c623", fg = "#1b1b1b"): THREE.CanvasTexture {
  const { c, g } = canvas(256, 128);
  g.fillStyle = bg;
  g.fillRect(0, 0, 256, 128);
  g.strokeStyle = fg;
  g.lineWidth = 10;
  g.strokeRect(5, 5, 246, 118);
  g.fillStyle = fg;
  g.textAlign = "center";
  g.textBaseline = "middle";
  lines.forEach((l, i) => {
    g.font = `900 ${lines.length > 1 ? 40 : 56}px "Dhamaka Display", system-ui, sans-serif`;
    g.fillText(l, 128, 64 + (i - (lines.length - 1) / 2) * 46);
  });
  return finish(c, true, false);
}

/** The start/finish banner over the road. */
export function bannerTexture(): THREE.CanvasTexture {
  const { c, g } = canvas(1024, 160);
  const bg = g.createLinearGradient(0, 0, 1024, 0);
  bg.addColorStop(0, "#d62f2f");
  bg.addColorStop(0.5, "#ff7a1a");
  bg.addColorStop(1, "#d62f2f");
  g.fillStyle = bg;
  g.fillRect(0, 0, 1024, 160);
  for (let x = 0; x < 1024; x += 40) {
    g.fillStyle = (x / 40) % 2 ? "#111" : "#fff";
    g.fillRect(x, 0, 40, 18);
    g.fillStyle = (x / 40) % 2 ? "#fff" : "#111";
    g.fillRect(x, 142, 40, 18);
  }
  g.fillStyle = "#fff8e7";
  g.font = '900 96px "Dhamaka Display", system-ui, sans-serif';
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("GHAT RUSH", 512, 84);
  return finish(c, true, false);
}

/** Grey detail grain for the hillsides (multiplies the vertex colours): blades, pebbles, wet dark patches. */
export function detailTexture(): THREE.CanvasTexture {
  const S = 256;
  const { c, g } = canvas(S, S);
  const rnd = makeRng(99);
  g.fillStyle = "rgb(222,222,222)";
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 70; i++) {
    const x = rnd() * S, y = rnd() * S, r = 10 + rnd() * 40, l = rnd();
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    const v = l < 0.5 ? 150 : 255;
    grd.addColorStop(0, `rgba(${v},${v},${v},0.45)`);
    grd.addColorStop(1, `rgba(${v},${v},${v},0)`);
    g.fillStyle = grd;
    for (const [dx, dy] of [[0, 0], [S, 0], [-S, 0], [0, S], [0, -S]] as const) {
      g.beginPath();
      g.arc(x + dx, y + dy, r, 0, Math.PI * 2);
      g.fill();
    }
  }
  for (let i = 0; i < 5000; i++) {
    const v = Math.floor(120 + rnd() * 135);
    g.fillStyle = `rgba(${v},${v},${v},0.55)`;
    g.fillRect(rnd() * S, rnd() * S, 1, 2 + rnd() * 4);
  }
  return finish(c, false);
}
