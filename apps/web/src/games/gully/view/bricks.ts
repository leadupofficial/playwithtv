/**
 * The stumps: a stack of loose bricks (one InstancedMesh, one draw call) that bursts apart when the ball hits it
 * and is stacked again for the next ball. Same layout as the Blender scene's bricks.
 */
import * as THREE from "three";

const L = 0.22, W = 0.105, H = 0.068;
const SHADES = ["#b4513a", "#a04632", "#c2603f", "#b9583c"];

interface Brick { home: THREE.Matrix4; pos: THREE.Vector3; vel: THREE.Vector3; rot: THREE.Euler; spin: THREE.Vector3; size: THREE.Vector3 }

export class Bricks {
  readonly mesh: THREE.InstancedMesh;
  private bricks: Brick[] = [];
  private flying = false;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();

  constructor(material: "lambert" | "standard") {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = material === "standard"
      ? new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 })
      : new THREE.MeshLambertMaterial();
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    let y = 0;
    for (let layer = 0; layer < 10; layer++) {
      const alongX = layer % 2 === 0;
      for (let i = 0; i < 4; i++) {
        const x = alongX ? (i % 2 === 0 ? -0.11 : 0.11) : -0.165 + i * 0.11;
        const z = alongX ? (i < 2 ? -0.055 : 0.055) : 0;
        const size = alongX ? new THREE.Vector3(L, H, W) : new THREE.Vector3(W, H, L);
        const pos = new THREE.Vector3(x + (rnd() - 0.5) * 0.024, y + H / 2, z + (rnd() - 0.5) * 0.02);
        const rot = new THREE.Euler(0, (rnd() - 0.5) * 0.12, 0);
        const home = new THREE.Matrix4().compose(pos, new THREE.Quaternion().setFromEuler(rot), size);
        this.bricks.push({ home, pos: pos.clone(), vel: new THREE.Vector3(), rot: rot.clone(), spin: new THREE.Vector3(), size });
      }
      y += H + 0.002;
    }
    this.mesh = new THREE.InstancedMesh(geo, mat, this.bricks.length);
    const c = new THREE.Color();
    this.bricks.forEach((b, i) => {
      this.mesh.setMatrixAt(i, b.home);
      this.mesh.setColorAt(i, c.set(SHADES[i % SHADES.length]!).offsetHSL(0, 0, (rnd() - 0.5) * 0.06));
    });
    this.mesh.castShadow = this.mesh.receiveShadow = true;
  }

  /** The ball hit the stack: bricks fly back and up (dir = the ball's direction of travel). */
  scatter(dir: THREE.Vector3, power = 1) {
    this.flying = true;
    let seed = 99;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (const b of this.bricks) {
      const h = b.pos.y / 0.72;
      b.vel.set(dir.x * 2 + (rnd() - 0.5) * 3, 1.5 + h * 3 * power + rnd() * 2, Math.max(1, dir.z) * (2 + h * 3) * power + (rnd() - 0.5) * 2);
      b.spin.set((rnd() - 0.5) * 14, (rnd() - 0.5) * 14, (rnd() - 0.5) * 14);
    }
  }

  /** Back to a neat stack. */
  reset() {
    this.flying = false;
    this.bricks.forEach((b, i) => {
      b.home.decompose(b.pos, this.q, b.size);
      b.rot.setFromQuaternion(this.q);
      this.mesh.setMatrixAt(i, b.home);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  get scattered() {
    return this.flying;
  }

  update(dt: number) {
    if (!this.flying || dt <= 0) return;
    this.bricks.forEach((b, i) => {
      b.vel.y -= 9.81 * dt;
      b.pos.addScaledVector(b.vel, dt);
      if (b.pos.y < b.size.y / 2) {
        b.pos.y = b.size.y / 2;
        b.vel.y = Math.abs(b.vel.y) * 0.25;
        b.vel.x *= 0.6;
        b.vel.z *= 0.6;
        b.spin.multiplyScalar(0.5);
      }
      b.rot.x += b.spin.x * dt;
      b.rot.y += b.spin.y * dt;
      b.rot.z += b.spin.z * dt;
      this.m.compose(b.pos, this.q.setFromEuler(b.rot), b.size);
      this.mesh.setMatrixAt(i, this.m);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
