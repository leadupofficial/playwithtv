/**
 * kit3d/followCamera: a shared camera that keeps every player in frame. It looks down at a fixed angle
 * (3/4 view), centres on the players, and backs off just enough that all of them fit with a margin:
 * zooming out as they spread and in as they bunch up. Extras:
 *
 *   cam.punch(point, 0.45, 0.8)   punch in towards a knockout for 0.8 s
 *   cam.orbit(yaw, distScale)     an override for intros/flyovers (yaw radians, 1 = normal distance)
 *   cam.update(points, dt, shakeOffset)
 */
import * as THREE from "three";

export interface FollowOptions {
  /** Degrees looking down from horizontal. */
  pitch?: number;
  /** Degrees around the vertical axis (0 = looking towards -z). */
  yaw?: number;
  minDist?: number;
  maxDist?: number;
  /** Extra room around the players, in world units. */
  margin?: number;
  /** How quickly the camera catches up (1/s). */
  follow?: number;
  /** Height of the point the camera looks at. */
  lookHeight?: number;
}

const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3(), fwd = new THREE.Vector3();

export class FollowCamera {
  readonly centre = new THREE.Vector3();
  dist: number;
  private o: Required<FollowOptions>;
  private punchT = 0;
  private punchDur = 1;
  private punchAmt = 0;
  private punchAt = new THREE.Vector3();
  private orbitYaw = 0;
  private orbitScale = 1;
  private orbitLift = 0;
  private wantCentre = new THREE.Vector3();
  private snap = true;

  constructor(readonly camera: THREE.PerspectiveCamera, opts: FollowOptions = {}) {
    this.o = { pitch: 52, yaw: 0, minDist: 9, maxDist: 30, margin: 1.6, follow: 3.5, lookHeight: 0.8, ...opts };
    this.dist = this.o.minDist;
  }

  /** Punches in towards `at` by `amount` (0..1 of the distance) for `seconds`. */
  punch(at: THREE.Vector3, amount = 0.4, seconds = 0.8) {
    this.punchAt.copy(at);
    this.punchAmt = amount;
    this.punchT = this.punchDur = seconds;
  }

  /** Overrides the view for intros: extra yaw (radians), distance scale and lift (radians of pitch). */
  orbit(yaw: number, distScale: number, lift = 0) {
    this.orbitYaw = yaw;
    this.orbitScale = distScale;
    this.orbitLift = lift;
  }

  /** Jumps straight to the framing on the next update (no easing), e.g. after a scene cut. */
  cut() {
    this.snap = true;
  }

  private basis(yaw: number, pitch: number) {
    fwd.set(-Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    right.set(Math.cos(yaw), 0, -Math.sin(yaw));
    up.crossVectors(right, fwd);
  }

  update(points: THREE.Vector3[], dt: number, shake?: THREE.Vector3) {
    const yaw = THREE.MathUtils.degToRad(this.o.yaw) + this.orbitYaw;
    const pitch = THREE.MathUtils.degToRad(this.o.pitch) + this.orbitLift;
    this.basis(yaw, pitch);
    // centre: middle of the players' bounding box
    if (points.length) {
      const min = tmp.set(Infinity, 0, Infinity), max = tmp2.set(-Infinity, 0, -Infinity);
      for (const p of points) {
        min.x = Math.min(min.x, p.x); min.z = Math.min(min.z, p.z);
        max.x = Math.max(max.x, p.x); max.z = Math.max(max.z, p.z);
      }
      this.wantCentre.set((min.x + max.x) / 2, this.o.lookHeight, (min.z + max.z) / 2);
    }
    // distance: just far enough that every point fits the frustum with a margin
    const tanV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const tanH = tanV * this.camera.aspect;
    let need = this.o.minDist;
    for (const p of points) {
      const d = tmp.copy(p).sub(this.wantCentre);
      const px = Math.abs(d.dot(right)) + this.o.margin, py = Math.abs(d.dot(up)) + this.o.margin, pz = d.dot(fwd);
      need = Math.max(need, px / tanH - pz, py / tanV - pz);
    }
    need = Math.min(this.o.maxDist, need) * this.orbitScale;
    const k = this.snap ? 1 : 1 - Math.exp(-this.o.follow * dt);
    this.snap = false;
    this.centre.lerp(this.wantCentre, k);
    this.dist += (need - this.dist) * k;
    // punch-in: ease towards the point and closer, then back out
    let dist = this.dist;
    const look = tmp.copy(this.centre);
    if (this.punchT > 0) {
      this.punchT = Math.max(0, this.punchT - dt);
      const p = this.punchT / this.punchDur;
      const w = Math.sin(Math.PI * Math.min(1, (1 - p) * 1.6)) * this.punchAmt;
      look.lerp(this.punchAt, Math.min(1, w * 1.4));
      dist *= 1 - w;
    }
    this.camera.position.copy(look).addScaledVector(fwd, -dist);
    if (shake) this.camera.position.add(shake);
    this.camera.lookAt(look.x + (shake?.x ?? 0) * 0.3, look.y + (shake?.y ?? 0) * 0.3, look.z);
  }
}
