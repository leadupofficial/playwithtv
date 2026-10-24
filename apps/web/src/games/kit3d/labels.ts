/**
 * kit3d/labels: crisp HTML labels (name tags, damage %, "+1") that follow 3D points. Text stays sharp at any
 * render resolution and costs no draw calls. The overlay element must cover the canvas exactly.
 *
 *   const labels = new Labels(overlayDiv);
 *   const tag = labels.add(nameTag("Asha", "#ff5d73"));
 *   labels.place(tag, character.head(), camera, 0.6);   // every frame: 0.6 units above the head
 */
import * as THREE from "three";

const v = new THREE.Vector3();

export class Labels {
  constructor(readonly el: HTMLElement) {}

  add(child: HTMLElement): HTMLElement {
    child.style.position = "absolute";
    child.style.left = "0";
    child.style.top = "0";
    child.style.willChange = "transform";
    child.style.pointerEvents = "none";
    this.el.appendChild(child);
    return child;
  }

  /** Moves a label to the screen position of `target` (an Object3D's world position or a point), lifted by `up`. */
  place(label: HTMLElement, target: THREE.Object3D | THREE.Vector3, camera: THREE.Camera, up = 0, visible = true) {
    if (target instanceof THREE.Vector3) v.copy(target);
    else target.getWorldPosition(v);
    v.y += up;
    v.project(camera);
    const show = visible && v.z < 1 && v.z > -1;
    label.style.display = show ? "" : "none";
    if (!show) return;
    const w = this.el.clientWidth, h = this.el.clientHeight;
    const x = ((v.x + 1) / 2) * w, y = ((1 - v.y) / 2) * h;
    label.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
  }

  remove(label: HTMLElement) {
    label.remove();
  }

  clear() {
    this.el.replaceChildren();
  }
}

/** A sofa-readable name tag: the player's name on their lobby colour, with an optional line below. */
export function nameTag(name: string, color: string): { el: HTMLElement; sub: HTMLElement } {
  const el = document.createElement("div");
  el.style.cssText = "display:flex;flex-direction:column;align-items:center;gap:2px;font-weight:800;text-align:center;white-space:nowrap";
  const chip = document.createElement("div");
  chip.textContent = name;
  chip.style.cssText = "padding:2px 14px;border-radius:999px;font-size:30px;line-height:1.15;" +
    "box-shadow:0 3px 0 rgba(0,0,0,.35);border:3px solid rgba(255,255,255,.85)";
  chip.style.background = color;
  chip.style.color = readableOn(color);
  const sub = document.createElement("div");
  sub.style.cssText = "font-size:26px;color:#fff;text-shadow:0 2px 0 #000,0 0 6px #000";
  el.append(chip, sub);
  return { el, sub };
}

/** Black or white text, whichever reads better on `hex`. */
export function readableOn(hex: string): string {
  const c = new THREE.Color(hex);
  const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; // linear components
  return lum > 0.35 ? "#14112b" : "#ffffff";
}
