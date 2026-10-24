/**
 * Particles for both tiers, a handful of draw calls in total: impact sparks (additive), dust and splashes, and the
 * arena's weather: rising lamp embers at the temple, monsoon rain streaks at the docks, drifting palm leaves on
 * the rooftop. Counts follow the quality profile's particle budget.
 */
import * as THREE from "three";
import { Particles, featherGeometry, sparkleGeometry } from "../../kit3d/particles";
import { glowTexture } from "./common";

const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();

export class Effects {
  readonly sparks: Particles;
  readonly dust: Particles;
  readonly leaves: Particles | null = null;
  private rain: THREE.LineSegments | null = null;
  private rainPos: Float32Array | null = null;
  private embers: THREE.Points | null = null;
  private emberPos: Float32Array | null = null;
  private seed = 3;
  private leafT = 0;

  constructor(private scene: THREE.Scene, private weather: "embers" | "rain" | "leaves", budget: number, private area: { hx: number; hz: number }) {
    this.sparks = new Particles(sparkleGeometry(), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, vertexColors: false }), Math.min(160, budget));
    this.dust = new Particles(new THREE.IcosahedronGeometry(0.5, 0), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.55, depthWrite: false }), Math.min(120, budget));
    scene.add(this.sparks.mesh, this.dust.mesh);
    const n = Math.max(40, Math.min(budget, 900));
    if (weather === "rain") {
      this.rainPos = new Float32Array(n * 6);
      for (let i = 0; i < n; i++) this.spawnDrop(i, Math.random() * 12);
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(this.rainPos, 3).setUsage(THREE.DynamicDrawUsage));
      this.rain = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: "#b8d4e6", transparent: true, opacity: 0.45, depthWrite: false }));
      this.rain.frustumCulled = false;
      scene.add(this.rain);
    } else if (weather === "embers") {
      const k = Math.min(160, n);
      this.emberPos = new Float32Array(k * 3);
      for (let i = 0; i < k; i++) this.spawnEmber(i, true);
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(this.emberPos, 3).setUsage(THREE.DynamicDrawUsage));
      this.embers = new THREE.Points(g, new THREE.PointsMaterial({ color: "#ffb15c", size: 0.12, map: glowTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      this.embers.frustumCulled = false;
      scene.add(this.embers);
    } else {
      this.leaves = new Particles(featherGeometry(), new THREE.MeshLambertMaterial({ side: THREE.DoubleSide, color: "#ffffff" }), 60);
      scene.add(this.leaves.mesh);
    }
  }

  private rnd() {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  private spawnDrop(i: number, y: number) {
    const p = this.rainPos!;
    const x = (this.rnd() - 0.5) * 30, z = (this.rnd() - 0.5) * 22 - 2;
    p.set([x, y, z, x - 0.12, y - 0.7, z], i * 6);
  }

  private spawnEmber(i: number, anywhere: boolean) {
    const p = this.emberPos!;
    p.set([(this.rnd() - 0.5) * 18, anywhere ? this.rnd() * 6 : 0.8 + this.rnd(), -4.3 + (this.rnd() - 0.5) * 2], i * 3);
  }

  /** A strike landing: sparks flying out along `dir`, plus a ring of dust for big ones. */
  impact(at: THREE.Vector3, power: number, color = "#fff2a8", dir?: THREE.Vector3) {
    this.sparks.burst(at, { count: 6 + Math.round(12 * power), color, speed: 6 + 6 * power, up: 1.2, gravity: 4, drag: 5, life: 0.35, size: 0.35 + 0.35 * power, spin: 0, dir: dir ? tmp2.copy(dir).multiplyScalar(0.6) : undefined });
    if (power > 0.6) this.dust.burst(tmp.set(at.x, 0.15, at.z), { count: 8, color: "#d8c3a5", speed: 3, up: 0.8, gravity: 1, drag: 3, life: 0.7, size: 0.35 });
  }

  /** Feet hitting the floor hard, a landing, a roll. */
  puff(x: number, z: number, n = 6, color = "#d8c3a5") {
    this.dust.burst(tmp.set(x, 0.12, z), { count: n, color, speed: 2.2, up: 0.6, gravity: 0.6, drag: 3, life: 0.6, size: 0.3 });
  }

  /** Falling into water. */
  splash(x: number, y: number, z: number) {
    this.dust.burst(tmp.set(x, y, z), { count: 26, color: "#cfe9ff", speed: 4, up: 7, gravity: 14, drag: 1, life: 0.9, size: 0.28 });
  }

  /** A burst of gold for winners and specials. */
  confetti(at: THREE.Vector3, color = "#ffd23f", count = 26) {
    this.sparks.burst(at, { count, color, speed: 6, up: 5, gravity: 7, drag: 1.4, life: 1.3, size: 0.4 });
  }

  update(dt: number) {
    this.sparks.update(dt);
    this.dust.update(dt);
    if (this.rain && this.rainPos) {
      const p = this.rainPos;
      for (let i = 0; i < p.length / 6; i++) {
        const j = i * 6;
        p[j + 1]! -= 16 * dt; p[j + 4]! -= 16 * dt; p[j]! -= 2.5 * dt; p[j + 3]! -= 2.5 * dt;
        if (p[j + 4]! < -1) this.spawnDrop(i, 9 + this.rnd() * 3);
      }
      (this.rain.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    }
    if (this.embers && this.emberPos) {
      const p = this.emberPos;
      for (let i = 0; i < p.length / 3; i++) {
        p[i * 3 + 1]! += (0.6 + (i % 5) * 0.12) * dt;
        p[i * 3]! += Math.sin(p[i * 3 + 1]! * 2 + i) * 0.3 * dt;
        if (p[i * 3 + 1]! > 7) this.spawnEmber(i, false);
      }
      (this.embers.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    }
    if (this.leaves) {
      this.leafT -= dt;
      if (this.leafT <= 0) {
        this.leafT = 0.5 + this.rnd();
        const side = this.rnd() < 0.5 ? -1 : 1;
        this.leaves.burst(tmp.set(side * (this.area.hx + 2), 6, (this.rnd() - 0.5) * this.area.hz * 2), {
          count: 1, color: this.rnd() < 0.5 ? "#7da34a" : "#c9a44a", speed: 0.6, up: 0, gravity: 0.5, drag: 0.6, life: 9, size: 0.5, spin: 2, sway: 1.4,
          dir: tmp2.set(-side * 1.2, 0, 0.2), floor: 0.02,
        });
      }
      this.leaves.update(dt);
    }
  }

  dispose() {
    this.scene.remove(this.sparks.mesh, this.dust.mesh);
    if (this.rain) this.scene.remove(this.rain);
    if (this.embers) this.scene.remove(this.embers);
    if (this.leaves) this.scene.remove(this.leaves.mesh);
  }
}
