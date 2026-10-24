/**
 * kit3d/character: an animated, tintable character built from a (cloned) glTF model plus animation clips
 * from any file that shares its rig (clips bind by bone name, so one animation library serves every model).
 *
 *   const c = new Character(cloneModel(knight.scene), library.animations, { scale: 0.7 });
 *   scene.add(c.root);
 *   c.play("Running_A");                 // crossfades from the current clip
 *   c.play("Hit_A", { once: true });     // plays once, then holds the last frame (see `done`)
 *   c.pose("2H_Melee_Attack_Chop", 0.4); // a frozen frame (e.g. a wind-up while charging)
 *   c.flash(0.08);                       // white hit flash
 *   c.update(dt);                        // every frame
 *
 * Structure: `root` (place/rotate it) → `body` (squash & stretch scales this) → the model.
 */
import * as THREE from "three";
import { cheapMaterials } from "./assets";

export interface PlayOptions {
  fade?: number;
  once?: boolean;
  timeScale?: number;
  /** Start again even if this clip is already playing. */
  restart?: boolean;
  /** Start at this many seconds into the clip. */
  from?: number;
}

type Lit = THREE.MeshToonMaterial | THREE.MeshLambertMaterial | THREE.MeshStandardMaterial;

export class Character {
  readonly root = new THREE.Group();
  readonly body = new THREE.Group();
  readonly mixer: THREE.AnimationMixer;
  current: string | null = null;
  private actions = new Map<string, THREE.AnimationAction>();
  private mats: Lit[] = [];
  private flashT = 0;
  private flashColor = new THREE.Color("#ffffff");
  private flashK = 0.85;

  constructor(readonly model: THREE.Object3D, clips: THREE.AnimationClip[], opts: { scale?: number; material?: "toon" | "lambert" | "keep" } = {}) {
    // "keep": leave the model's own (PBR) materials, for the cinematic tiers
    if (opts.material !== "keep") cheapMaterials(model, opts.material ?? "toon");
    model.scale.setScalar(opts.scale ?? 1);
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.frustumCulled = false; // skinned bounds do not follow the animation; the whole cast is always on screen anyway
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) this.mats.push(mat as Lit);
    });
    this.body.add(model);
    this.root.add(this.body);
    this.mixer = new THREE.AnimationMixer(model);
    for (const clip of clips) this.actions.set(clip.name, this.mixer.clipAction(clip));
  }

  has(name: string) {
    return this.actions.has(name);
  }

  /** Crossfades to a clip. Unknown names are ignored (so a model without a clip never throws). */
  play(name: string, o: PlayOptions = {}) {
    const next = this.actions.get(name);
    if (!next) return;
    const prev = this.current ? this.actions.get(this.current) : undefined;
    if (prev === next && !o.restart && next.timeScale !== 0) {
      next.timeScale = o.timeScale ?? 1;
      return;
    }
    next.reset();
    next.setLoop(o.once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    next.clampWhenFinished = !!o.once;
    next.timeScale = o.timeScale ?? 1;
    if (o.from) next.time = o.from;
    next.enabled = true;
    next.play();
    const fade = o.fade ?? 0.15;
    if (prev && prev !== next) {
      next.crossFadeFrom(prev, fade, false);
    } else next.fadeIn(fade);
    this.current = name;
  }

  /** Holds one frame of a clip (time in seconds), fading into it. */
  pose(name: string, time: number, fade = 0.12) {
    const a = this.actions.get(name);
    if (!a) return;
    if (this.current !== name || a.timeScale !== 0) this.play(name, { fade, once: true, from: time });
    a.time = time;
    a.timeScale = 0;
  }

  /** Continues the current (posed) clip from where it is held. */
  resume(timeScale = 1) {
    const a = this.current ? this.actions.get(this.current) : undefined;
    if (a) a.timeScale = timeScale;
  }

  /** True once a `once` clip has reached its end. */
  done(name = this.current ?? ""): boolean {
    const a = this.actions.get(name);
    return !a || (a.loop === THREE.LoopOnce && a.time >= a.getClip().duration - 1e-3);
  }

  duration(name: string): number {
    return this.actions.get(name)?.getClip().duration ?? 0;
  }

  /** Puts `obj` in a bone's space (e.g. a pillow in the hand slot). */
  attach(boneName: string, obj: THREE.Object3D): boolean {
    const bone = this.model.getObjectByName(boneName);
    if (!bone) return false;
    bone.add(obj);
    return true;
  }

  /** The head bone (for name tags and dizzy stars); the root if the model has none. */
  head(): THREE.Object3D {
    return this.model.getObjectByName("head") ?? this.root;
  }

  /** Mixes a colour into the materials of meshes whose name matches (`amount` 0..1). */
  tint(color: THREE.ColorRepresentation, amount: number, match: (meshName: string) => boolean) {
    const c = new THREE.Color(color);
    this.model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !match(m.name)) return;
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) (mat as Lit).color.lerp(c, amount);
    });
  }

  /** A short emissive flash (hit feedback). */
  flash(seconds: number, color: THREE.ColorRepresentation = "#ffffff", intensity = 0.85) {
    this.flashT = seconds;
    this.flashColor.set(color);
    this.flashK = intensity;
  }

  update(dt: number) {
    this.mixer.update(dt);
    if (this.flashT > 0 || this.mats[0]?.emissiveIntensity) {
      this.flashT = Math.max(0, this.flashT - dt);
      const k = this.flashT > 0 ? this.flashK : 0;
      for (const m of this.mats) {
        m.emissive.copy(this.flashColor);
        m.emissiveIntensity = k;
      }
    }
  }

  dispose() {
    this.mixer.stopAllAction();
    this.root.removeFromParent();
  }
}
