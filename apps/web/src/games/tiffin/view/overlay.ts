/**
 * HTML over the 3D kitchen (crisp at any render size, no draw calls): each chef's name tag with the icon of what
 * their ACTION button would do, cooking/working rings over stations, and "+28" pop-ups when a dish is served.
 */
import * as THREE from "three";
import { Labels, nameTag } from "../../kit3d/labels";
import type { Ring } from "./model";

const v = new THREE.Vector3();

export class Overlay {
  private labels: Labels;
  private tags = new Map<string, { el: HTMLElement; sub: HTMLElement }>();
  private rings = new Map<string, { el: HTMLElement; fill: HTMLElement; icon: HTMLElement; seen: boolean }>();

  constructor(readonly el: HTMLElement) {
    this.labels = new Labels(el);
  }

  tag(id: string, name: string, color: string, x: number, y: number, z: number, icon: string, camera: THREE.Camera, show = true) {
    let t = this.tags.get(id);
    if (!t) {
      t = nameTag(name, color);
      t.el.firstElementChild!.setAttribute("style", (t.el.firstElementChild as HTMLElement).style.cssText + ";font-size:22px;padding:1px 10px");
      t.sub.style.fontSize = "30px";
      this.labels.add(t.el);
      this.tags.set(id, t);
    }
    if (t.sub.textContent !== icon) t.sub.textContent = icon;
    this.labels.place(t.el, v.set(x, y, z), camera, 0, show);
  }

  /** Draws the rings for this frame (rings not given are hidden). */
  setRings(list: Ring[], camera: THREE.Camera, show = true) {
    for (const r of this.rings.values()) r.seen = false;
    for (const ring of list) {
      let r = this.rings.get(ring.key);
      if (!r) {
        const el = document.createElement("div");
        el.style.cssText = "width:46px;height:46px;border-radius:50%;padding:5px;box-sizing:border-box;background:rgba(18,12,30,.72);" +
          "box-shadow:0 3px 8px rgba(0,0,0,.45);display:grid;place-items:center";
        const fill = document.createElement("div");
        fill.style.cssText = "position:absolute;inset:4px;border-radius:50%";
        const icon = document.createElement("div");
        icon.style.cssText = "position:relative;font-size:20px;line-height:1;text-shadow:0 1px 2px #000;white-space:nowrap";
        el.append(fill, icon);
        this.labels.add(el);
        r = { el, fill, icon, seen: true };
        this.rings.set(ring.key, r);
      }
      r.seen = true;
      const pct = Math.round(Math.max(0, Math.min(1, ring.value)) * 100);
      r.fill.style.background = `conic-gradient(${ring.color} ${pct}%, rgba(255,255,255,.12) ${pct}% 100%)`;
      r.fill.style.webkitMask = "radial-gradient(circle, transparent 52%, #000 54%)";
      r.fill.style.mask = "radial-gradient(circle, transparent 52%, #000 54%)";
      if (r.icon.textContent !== ring.icon) r.icon.textContent = ring.icon;
      this.labels.place(r.el, v.set(ring.x, ring.y, ring.z), camera, 0, show);
    }
    for (const [k, r] of this.rings) {
      if (!r.seen) {
        r.el.remove();
        this.rings.delete(k);
      }
    }
  }

  /** A pop-up that rises and fades ("+28", "PERFECT!"). */
  pop(text: string, color: string, x: number, y: number, z: number, camera: THREE.Camera, size = 40) {
    const el = document.createElement("div");
    el.textContent = text;
    el.style.cssText = `font-weight:900;font-size:${size}px;color:${color};-webkit-text-stroke:4px #1b1033;paint-order:stroke fill;white-space:nowrap`;
    this.labels.add(el);
    this.labels.place(el, v.set(x, y, z), camera, 0);
    const base = el.style.transform;
    el.animate?.([
      { transform: `${base} scale(0.4)`, opacity: 0 },
      { transform: `${base} translateY(-20px) scale(1.15)`, opacity: 1, offset: 0.2 },
      { transform: `${base} translateY(-70px) scale(1)`, opacity: 0 },
    ], { duration: 1300, easing: "ease-out", fill: "forwards" });
    setTimeout(() => el.remove(), 1350);
  }

  clear() {
    this.labels.clear();
    this.tags.clear();
    this.rings.clear();
  }
}
