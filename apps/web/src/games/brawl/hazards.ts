/**
 * Visuals for things on the bed that are not fighters: socks and feather piles dropped by ghosts, and the
 * pillows of an avalanche (with a growing warning ring where each will land). Small fixed pools, no
 * allocation while playing.
 */
import * as THREE from "three";
import { cloneModel } from "../kit3d/assets";
import { featherGeometry } from "../kit3d/particles";
import { DROP_FALL, FEATHER_R } from "./chaos";
import type { Match } from "./rules";

const POOL = 8;

function sock(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.MeshLambertMaterial({ color: "#ffffff" });
  const stripe = new THREE.MeshLambertMaterial({ color: "#ff5d73" });
  const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.7, 10).rotateZ(Math.PI / 2), body);
  leg.position.set(-0.15, 0.17, 0);
  const foot = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.32, 4, 10).rotateX(Math.PI / 2), body);
  foot.position.set(0.25, 0.17, 0.2);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.12, 10).rotateZ(Math.PI / 2), stripe);
  band.position.set(-0.42, 0.17, 0);
  const band2 = band.clone();
  band2.position.x = -0.2;
  g.add(leg, foot, band, band2);
  g.scale.setScalar(1.4);
  return g;
}

function featherPile(): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: "#f7f3ff", side: THREE.DoubleSide });
  const geo = featherGeometry();
  for (let i = 0; i < 9; i++) {
    const f = new THREE.Mesh(geo, mat);
    const a = i * 2.4, r = (i % 3) * 0.35 + 0.15;
    f.position.set(Math.cos(a) * r * FEATHER_R * 0.7, 0.05 + (i % 2) * 0.05, Math.sin(a) * r * FEATHER_R * 0.7);
    f.rotation.y = a * 1.7;
    f.scale.setScalar(0.55);
    g.add(f);
  }
  const fluff = new THREE.Mesh(new THREE.CircleGeometry(FEATHER_R, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.35, depthWrite: false }));
  fluff.position.y = 0.03;
  g.add(fluff);
  return g;
}

export class HazardViews {
  private socks: THREE.Group[] = [];
  private piles: THREE.Group[] = [];
  private pillows: THREE.Object3D[] = [];
  private rings: THREE.Mesh[] = [];

  constructor(scene: THREE.Scene, pillow: THREE.Object3D, private bedTop: number) {
    const ringMat = new THREE.MeshBasicMaterial({ color: "#ff5d73", transparent: true, opacity: 0.7, depthWrite: false });
    for (let i = 0; i < POOL; i++) {
      const s = sock(), p = featherPile(), pl = cloneModel(pillow);
      pl.scale.setScalar(4.2);
      const r = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.05, 24).rotateX(-Math.PI / 2), ringMat);
      r.renderOrder = 2;
      for (const o of [s, p, pl, r]) {
        o.visible = false;
        scene.add(o);
      }
      this.socks.push(s);
      this.piles.push(p);
      this.pillows.push(pl);
      this.rings.push(r);
    }
  }

  update(m: Match, time: number) {
    let si = 0, pi = 0;
    for (const h of m.hazards) {
      const grow = Math.min(1, h.age / 0.25) * Math.min(1, (h.life - h.age) / 0.5);
      if (h.kind === "sock" && si < POOL) {
        const s = this.socks[si++]!;
        s.visible = true;
        s.position.set(h.x, this.bedTop + 0.02, h.z);
        s.rotation.y = h.id * 1.3 + Math.sin(time * 4 + h.id) * 0.08;
        s.scale.setScalar(1.4 * grow);
      } else if (h.kind === "feathers" && pi < POOL) {
        const p = this.piles[pi++]!;
        p.visible = true;
        p.position.set(h.x, this.bedTop + 0.02, h.z);
        p.scale.setScalar(grow);
      }
    }
    for (let i = si; i < POOL; i++) this.socks[i]!.visible = false;
    for (let i = pi; i < POOL; i++) this.piles[i]!.visible = false;
    let di = 0;
    for (const d of m.drops) {
      if (di >= POOL) break;
      const pl = this.pillows[di]!, r = this.rings[di]!;
      di++;
      const p = 1 - d.t / DROP_FALL; // 0 → 1 as it falls
      pl.visible = r.visible = true;
      pl.position.set(d.x, this.bedTop + 0.4 + (1 - p * p) * 14, d.z);
      pl.rotation.set(d.id * 0.7 + p * 3, d.id, 0);
      r.position.set(d.x, this.bedTop + 0.05, d.z);
      r.scale.setScalar(0.4 + 0.7 * p);
    }
    for (let i = di; i < POOL; i++) this.pillows[i]!.visible = this.rings[i]!.visible = false;
  }
}
