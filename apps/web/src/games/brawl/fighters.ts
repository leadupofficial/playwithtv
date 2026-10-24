/**
 * How a fighter looks on the TV: a KayKit adventurer holding a pillow in the player's colour, a blob shadow,
 * a colour ring, a name tag with their wobble %, squash-and-stretch, and reaction animations driven by the
 * engine state. Knocked-out fighters turn into a little sheet ghost wearing a nightcap in their colour.
 */
import * as THREE from "three";
import { Character } from "../kit3d/character";
import { blobShadow, fadeBlob } from "../kit3d/blobShadow";
import { Squash } from "../kit3d/juice";
import { nameTag, type Labels } from "../kit3d/labels";
import { cloneModel } from "../kit3d/assets";
import type { Fighter, Match } from "./rules";

export const CHARACTER_URLS = ["knight", "barbarian", "mage", "rogue"].map((n) => `/assets/kaykit-adventurers/${n}.glb`);
export const ANIMATIONS_URL = "/assets/kaykit-adventurers/animations.glb";
const SCALE = 0.92;
/** Time in the chop clip where the pillow is raised high: held while charging, released into the smash. */
const CHOP_RAISED = 0.42;

export interface Look { name: string; color: string }

function ghostMesh(color: string): THREE.Group {
  const g = new THREE.Group();
  const sheet = new THREE.MeshLambertMaterial({ color: "#f4f1ff", emissive: "#5b4f9a", emissiveIntensity: 0.35 });
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.55, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), sheet);
  const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.7, 0.8, 14, 1, true), sheet);
  skirt.position.y = -0.4;
  const eye = new THREE.MeshBasicMaterial({ color: "#1b1033" });
  for (const x of [-0.2, 0.2]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), eye);
    e.position.set(x, 0.18, 0.47);
    e.scale.set(1, 1.4, 0.6);
    g.add(e);
  }
  const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), eye);
  mouth.position.set(0, -0.05, 0.52);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.9, 12), new THREE.MeshLambertMaterial({ color }));
  cap.position.set(0, 0.62, -0.05);
  cap.rotation.x = -0.35;
  const bobble = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), new THREE.MeshLambertMaterial({ color: "#ffffff" }));
  bobble.position.set(0, 1.0, -0.22);
  g.add(head, skirt, mouth, cap, bobble);
  g.scale.setScalar(0.8);
  return g;
}

export class FighterView {
  readonly char: Character;
  readonly pillow: THREE.Object3D;
  readonly shadow: THREE.Mesh;
  readonly ring: THREE.Mesh;
  readonly ghost: THREE.Group;
  readonly squash = new Squash();
  readonly tag: { el: HTMLElement; sub: HTMLElement };
  private lastState = "";
  private lastDamage = -1;
  private pillowMat: THREE.MeshToonMaterial | null = null;
  private baseColor: THREE.Color;
  private spin = 0;
  /** Set by the game for the podium / round-end poses. */
  pose: "none" | "cheer" | "sulk" | "idle" = "none";

  constructor(readonly id: string, readonly look: Look, model: THREE.Object3D, clips: THREE.AnimationClip[], pillowSrc: THREE.Object3D,
    private scene: THREE.Scene, private labels: Labels) {
    this.char = new Character(model, clips, { scale: SCALE });
    this.baseColor = new THREE.Color(look.color);
    // capes and hats take a little of the player's colour, so each fighter reads at a glance
    this.char.tint(look.color, 0.55, (n) => /Cape|Hat/.test(n));
    this.pillow = cloneModel(pillowSrc);
    this.pillow.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mat = (m.material as THREE.MeshToonMaterial).clone();
      mat.color.copy(this.baseColor).lerp(new THREE.Color("#ffffff"), 0.25);
      mat.map = null;
      m.material = mat;
      this.pillowMat = mat;
    });
    this.pillow.scale.setScalar(2.1);
    this.pillow.rotation.set(0, Math.PI / 2, Math.PI / 2);
    this.pillow.position.set(0, 0.35, 0);
    if (!this.char.attach("handslotr", this.pillow)) this.char.body.add(this.pillow);
    this.shadow = blobShadow(0.75);
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.78, 28).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: look.color, depthWrite: false }));
    this.ring.renderOrder = 2;
    this.ghost = ghostMesh(look.color);
    this.ghost.visible = false;
    scene.add(this.char.root, this.shadow, this.ring, this.ghost);
    this.tag = nameTag(look.name, look.color);
    labels.add(this.tag.el);
    this.char.play("Idle", { fade: 0 });
  }

  /** Where the camera should frame this fighter (null while it should not count). */
  focus(out: THREE.Vector3, f: Fighter, bedTop: number): THREE.Vector3 | null {
    if (!f.alive && f.state !== "fall") return null;
    return out.set(f.x, bedTop + Math.max(0, f.y), f.z);
  }

  /** Called when the engine reports a hit on this fighter. */
  hurt(power: number) {
    this.char.flash(0.09);
    this.squash.kick(0.35 + 0.4 * power);
  }

  landed(hard: boolean) {
    this.squash.kick(hard ? 0.5 : 0.3);
  }

  swung(power: number) {
    this.squash.kick(-0.25 - 0.3 * power);
  }

  update(f: Fighter, m: Match, dt: number, bedTop: number, camera: THREE.Camera, time: number) {
    const c = this.char;
    const ghost = f.state === "ghost";
    c.root.visible = !ghost;
    this.ghost.visible = ghost;
    this.ring.visible = f.alive;
    this.shadow.visible = f.alive || ghost;
    const changed = f.state !== this.lastState;
    this.lastState = f.state;

    if (ghost) {
      const bob = Math.sin(time * 3 + f.slot) * 0.25;
      this.ghost.position.set(f.x, bedTop + 2.3 + bob, f.z);
      this.ghost.rotation.y = f.face;
      this.ghost.rotation.z = Math.sin(time * 2.2 + f.slot) * 0.12;
      this.shadow.position.set(f.x, bedTop + 0.03, f.z);
      fadeBlob(this.shadow, 2.3);
      const ready = f.ghostCd === 0;
      this.labels.place(this.tag.el, this.ghost.position, camera, 1.6, m.phase !== "podium");
      this.tag.sub.textContent = ready ? "👻 drop!" : "👻";
      return;
    }

    c.root.position.set(f.x, bedTop + f.y, f.z);
    c.root.rotation.y = f.face;
    const speed = Math.hypot(f.vx, f.vz);
    // animation state machine
    if (this.pose !== "none") {
      c.play(this.pose === "cheer" ? "Cheer" : this.pose === "sulk" ? "Sit_Floor_Idle" : "Idle", { fade: 0.25 });
    } else if (f.state === "charge") {
      c.pose("2H_Melee_Attack_Chop", CHOP_RAISED * f.charge + 0.12, 0.1);
    } else if (f.state === "windup" && changed) {
      if (f.power >= 0.55 && c.current === "2H_Melee_Attack_Chop") c.resume(1.9);
      else if (f.power >= 0.55) c.play("2H_Melee_Attack_Chop", { once: true, from: CHOP_RAISED * 0.6, timeScale: 2, fade: 0.05 });
      else c.play("1H_Melee_Attack_Slice_Horizontal", { once: true, restart: true, timeScale: 1.8, fade: 0.05, from: 0.15 });
    } else if (f.state === "hit" && changed) {
      c.play(f.slot % 2 ? "Hit_B" : "Hit_A", { once: true, restart: true, fade: 0.05, timeScale: 1.3 });
    } else if (f.state === "dodge" && changed) {
      c.play("Dodge_Forward", { once: true, restart: true, fade: 0.05, timeScale: 1.5 });
    } else if (f.state === "fall") {
      c.play("Jump_Idle", { fade: 0.1, timeScale: 2 });
      this.spin += dt * 9;
      c.root.rotation.y = f.face + this.spin;
    } else if (f.state === "ok" || (f.state === "hit" && c.done())) {
      if (f.y > 0.25) c.play("Jump_Idle", { fade: 0.15 });
      else if (speed > 0.8) c.play("Running_A", { fade: 0.12, timeScale: Math.min(1.5, Math.max(0.7, speed / 4.5)) });
      else if (!(c.current === "1H_Melee_Attack_Slice_Horizontal" || c.current === "2H_Melee_Attack_Chop") || c.done()) c.play("Idle", { fade: 0.2 });
    }
    if (f.state !== "fall") this.spin = 0;

    // squash & stretch: crouch while charging, jelly on hits and landings
    this.squash.update(dt, f.state === "charge" ? 0.14 * f.charge : 0);
    this.squash.apply(c.body);
    // the pillow swells as the charge builds and flashes white when full
    const full = f.state === "charge" && f.charge >= 1;
    const wobble = f.state === "charge" ? 1 + 0.45 * f.charge + (full ? Math.sin(time * 40) * 0.05 : 0) : 1;
    this.pillow.scale.setScalar(2.1 * wobble);
    if (this.pillowMat) {
      this.pillowMat.emissive.set(full ? "#ffffff" : this.look.color);
      this.pillowMat.emissiveIntensity = full ? 0.6 + 0.3 * Math.sin(time * 30) : f.state === "charge" ? 0.35 * f.charge : 0;
    }
    c.update(dt);

    const ground = bedTop + 0.04;
    this.shadow.position.set(f.x, ground, f.z);
    this.ring.position.set(f.x, ground + 0.01, f.z);
    fadeBlob(this.shadow, f.y);
    const showTag = m.phase !== "podium" && f.state !== "fall";
    this.labels.place(this.tag.el, c.root.position, camera, 2.15 * SCALE * 1.45, showTag);
    const dmg = Math.round(f.damage);
    if (dmg !== this.lastDamage) {
      this.lastDamage = dmg;
      this.tag.sub.textContent = `${dmg}%`;
      const hot = Math.min(1, dmg / 120);
      this.tag.sub.style.color = `rgb(255,${Math.round(255 - 150 * hot)},${Math.round(255 - 200 * hot)})`;
      this.tag.sub.style.fontSize = `${26 + Math.round(10 * hot)}px`;
    }
  }

  /** On the podium: only the celebration (or sulking) animation runs; the podium owns the position. */
  updatePodium(dt: number) {
    this.char.play(this.pose === "cheer" ? "Cheer" : this.pose === "sulk" ? "Sit_Floor_Idle" : "Idle", { fade: 0.3 });
    this.char.body.scale.setScalar(1);
    this.pillow.scale.setScalar(2.1);
    this.char.update(dt);
  }

  dispose() {
    this.char.dispose();
    this.scene.remove(this.shadow, this.ring, this.ghost);
    this.labels.remove(this.tag.el);
  }
}
