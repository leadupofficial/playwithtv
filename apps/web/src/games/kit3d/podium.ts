/**
 * kit3d/podium: the end-of-match moment. A three-step podium (gold, silver, bronze) to stand characters on,
 * plus an awards overlay of cards that pop in one by one, each with the player's name in their colour.
 *
 *   const podium = new Podium();  scene.add(podium.group);  podium.group.position.set(0, floorY, 0);
 *   podium.place(character.root, 1);            // stands a character on the 1st-place step (4+ = in front)
 *   showAwards(overlay, "PILLOW CHAMPIONS", [{ emoji: "👑", title: "Champion", name: "Asha", color: "#f5b700", detail: "2 rounds" }]);
 */
import * as THREE from "three";
import { readableOn } from "./labels";

const STEPS = [
  { place: 1, x: 0, h: 1.5, color: "#f5c242" },
  { place: 2, x: -2.1, h: 1.05, color: "#c9d3e0" },
  { place: 3, x: 2.1, h: 0.7, color: "#d98b4b" },
];

function numberTexture(n: number): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = "#3a2a10";
  g.font = "900 96px system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(String(n), 64, 70);
  return new THREE.CanvasTexture(c);
}

export class Podium {
  readonly group = new THREE.Group();

  constructor(width = 2) {
    for (const s of STEPS) {
      const box = new THREE.Mesh(new THREE.BoxGeometry(width, s.h, width * 0.9), new THREE.MeshLambertMaterial({ color: s.color }));
      box.position.set(s.x, s.h / 2, 0);
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(width * 0.42, width * 0.42), new THREE.MeshBasicMaterial({ map: numberTexture(s.place) }));
      plate.position.set(s.x, s.h * 0.55, width * 0.451);
      this.group.add(box, plate);
    }
  }

  /** Top-of-step position for a place (1–3), or a spot on the floor in front for 4th and later. */
  spot(place: number): THREE.Vector3 {
    const s = STEPS.find((x) => x.place === place);
    if (s) return new THREE.Vector3(s.x, s.h, 0);
    return new THREE.Vector3((place % 2 ? 1 : -1) * 4.4, 0, 0.6);
  }

  /** Stands `obj` on its step facing the camera (+z). */
  place(obj: THREE.Object3D, place: number) {
    const p = this.spot(place);
    this.group.add(obj);
    obj.position.copy(p);
    obj.rotation.set(0, 0, 0);
  }
}

export interface AwardCard { emoji: string; title: string; name: string; color: string; detail?: string }

/** Shows award cards over the game, popping in one after another (`gapMs` apart). Returns the panel. */
export function showAwards(container: HTMLElement, heading: string, cards: AwardCard[], gapMs = 700): HTMLElement {
  const panel = document.createElement("div");
  panel.dataset.awards = "";
  panel.style.cssText = "position:absolute;left:0;right:0;bottom:40px;display:flex;flex-direction:column;align-items:center;gap:18px;pointer-events:none";
  const h = document.createElement("div");
  h.textContent = heading;
  h.style.cssText = "font-size:64px;font-weight:900;color:#ffd23f;-webkit-text-stroke:4px #1b1033;paint-order:stroke fill;text-shadow:0 6px 0 rgba(0,0,0,.4)";
  const row = document.createElement("div");
  row.style.cssText = "display:flex;gap:22px;justify-content:center;flex-wrap:wrap;max-width:1800px";
  panel.append(h, row);
  cards.forEach((c, i) => {
    const card = document.createElement("div");
    card.dataset.award = c.title;
    card.style.cssText = "background:rgba(20,14,48,.92);border:5px solid #fff;border-radius:26px;padding:14px 26px;min-width:300px;" +
      "text-align:center;color:#fff;box-shadow:0 10px 0 rgba(0,0,0,.35);opacity:0";
    card.style.borderColor = c.color;
    const part = (text: string, css: string) => {
      const d = document.createElement("div");
      d.textContent = text;
      d.style.cssText = css;
      card.appendChild(d);
      return d;
    };
    part(c.emoji, "font-size:64px;line-height:1.1");
    part(c.title, "font-size:36px;font-weight:900");
    const who = part(c.name, "display:inline-block;margin-top:6px;border-radius:999px;padding:2px 18px;font-size:34px;font-weight:800");
    who.style.background = c.color;
    who.style.color = readableOn(c.color);
    part(c.detail ?? "", "font-size:24px;opacity:.8;margin-top:6px");
    row.appendChild(card);
    card.animate?.([
      { transform: "translateY(60px) scale(0.6)", opacity: 0 },
      { transform: "translateY(-10px) scale(1.06)", opacity: 1, offset: 0.7 },
      { transform: "translateY(0) scale(1)", opacity: 1 },
    ], { duration: 520, delay: 400 + i * gapMs, easing: "ease-out", fill: "forwards" });
    if (!card.animate) card.style.opacity = "1";
  });
  container.appendChild(panel);
  return panel;
}
