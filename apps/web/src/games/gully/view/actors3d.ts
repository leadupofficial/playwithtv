/**
 * The people on the lane for the real-time tiers: KayKit kids (CC0) in team colours, a taped bat for the batters,
 * name tags, blob shadows, and kids cheering from the balconies. Driven by choreo.ts.
 */
import * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { Character } from "../../kit3d/character";
import { cloneModel } from "../../kit3d/assets";
import { blobShadow } from "../../kit3d/blobShadow";
import { nameTag, type Labels } from "../../kit3d/labels";
import { CLIP_NAMES, ONCE, type Actor, type Clip } from "./choreo";
import type { Look } from "./types";

export const KID_MODELS = ["knight", "mage", "rogue"].map((n) => `/assets/kaykit-adventurers/${n}.glb`);
export const ANIMS_URL = "/assets/gully/animations.glb";
const SCALE = 0.62; // KayKit kids are ~2 m tall at scale 1: gully kids are ~1.25 m

/** A taped tennis-ball bat, built from boxes (held in the right hand slot). */
export function makeBat(pbr: boolean): THREE.Group {
  const M = (c: string, r = 0.6) => (pbr ? new THREE.MeshStandardMaterial({ color: c, roughness: r }) : new THREE.MeshLambertMaterial({ color: c }));
  const g = new THREE.Group();
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.56, 0.045), M("#e3c48d", 0.55));
  blade.position.y = -0.36;
  const tape = new THREE.Mesh(new THREE.BoxGeometry(0.114, 0.05, 0.049), M("#e8452c"));
  tape.position.y = -0.5;
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.26, 8), M("#22252b", 0.7));
  handle.position.y = 0.02;
  g.add(blade, tape, handle);
  g.traverse((o) => ((o as THREE.Mesh).castShadow = pbr));
  return g;
}

/**
 * Team jersey: the body texture's brightness times the team colour, so seams and shading stay but the cloth
 * takes the colour whatever the original outfit was (KayKit's robes, armour and tunics differ).
 */
export function jerseyMaterial(m: THREE.MeshStandardMaterial | THREE.MeshLambertMaterial, color: string) {
  m.color.set(color).multiplyScalar(1.7);
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>", `
#ifdef USE_MAP
  vec4 texel = texture2D(map, vMapUv);
  float lum = dot(texel.rgb, vec3(0.299, 0.587, 0.114));
  diffuseColor *= vec4(vec3(clamp(lum, 0.08, 0.75)), texel.a);
#endif`);
  };
  m.customProgramCacheKey = () => "gully-jersey";
  m.needsUpdate = true;
}

interface Person { char: Character; bat: THREE.Group; shadow: THREE.Mesh; tag: { el: HTMLElement; sub: HTMLElement } | null; clip: Clip | null; heading: number }

export class Actors3D {
  readonly group = new THREE.Group();
  private people = new Map<string, Person>();
  private kids: Character[] = [];
  private v = new THREE.Vector3();

  constructor(private models: GLTF[], private clips: THREE.AnimationClip[], private looks: Map<string, Look>, private labels: Labels, private pbr: boolean) {}

  private make(model: number, jersey: string, scale = SCALE): Character {
    const c = new Character(cloneModel(this.models[model % this.models.length]!.scene), this.clips, { scale, material: "lambert" });
    c.model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      if (/Cape|Hat/.test(m.name)) m.visible = false;
      m.castShadow = this.pbr;
      if (this.pbr) {
        // real-time tiers: PBR so the HDRI sky and the warm sun light them like the lane
        const old = m.material as THREE.MeshLambertMaterial;
        m.material = new THREE.MeshStandardMaterial({ map: old.map, color: old.color, roughness: 0.68, metalness: 0 });
        old.dispose();
      }
    });
    // team jersey: the body mesh takes the team colour
    c.model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && /Body/.test(m.name)) jerseyMaterial(m.material as THREE.MeshStandardMaterial, jersey);
    });
    return c;
  }

  private person(a: Actor): Person {
    const key = a.id ?? `${a.key}-${a.team}`;
    let p = this.people.get(key);
    if (p) return p;
    const look = a.id ? this.looks.get(a.id) : undefined;
    const teamColor = look?.teamColor ?? (a.team === 0 ? "#ff8a1f" : "#2fa7ff");
    const char = this.make((look?.model ?? a.key.length * 3 + a.team) % 3, teamColor);
    const bat = makeBat(this.pbr);
    bat.scale.setScalar(1 / SCALE);
    bat.rotation.set(0, Math.PI / 2, 0);
    if (!char.attach("handslotr", bat)) char.body.add(bat);
    const shadow = blobShadow(0.42, 0.55);
    shadow.position.y = 0.012;
    char.root.add(shadow);
    const tag = look && !look.cpu ? nameTag(look.name, look.color) : null;
    if (tag) this.labels.add(tag.el);
    this.group.add(char.root);
    p = { char, bat, shadow, tag, clip: null, heading: 0 };
    this.people.set(key, p);
    return p;
  }

  /** Places everyone for this frame (actors from choreo), plays their clips, and labels the people that matter. */
  update(actors: Actor[], dt: number, camera: THREE.Camera, slow = 1) {
    const seen = new Set<Person>();
    for (const a of actors) {
      const p = this.person(a);
      seen.add(p);
      p.char.root.visible = true;
      const r = p.char.root;
      // snap on a cut (big jump), otherwise glide
      const far = Math.hypot(r.position.x - a.x, r.position.z - a.z) > 2.5;
      const k = far ? 1 : Math.min(1, dt * 14);
      r.position.x += (a.x - r.position.x) * k;
      r.position.z += (a.z - r.position.z) * k;
      let dh = a.heading - p.heading;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      p.heading += far ? dh : dh * Math.min(1, dt * 10);
      r.rotation.y = p.heading;
      p.bat.visible = a.bat;
      if (p.clip !== a.clip) {
        const ts = a.clip === "swing" ? 1.5 : a.clip === "bowl" ? 1.25 : a.clip === "run" ? 1.2 : 1;
        p.char.play(CLIP_NAMES[a.clip], { once: ONCE.has(a.clip), timeScale: ts * slow, restart: true, from: a.clip === "swing" ? 0.12 : 0 });
        p.clip = a.clip;
      }
      p.char.update(dt * slow);
      if (p.tag) {
        const show = a.role === "batter" || a.role === "bowler";
        this.labels.place(p.tag.el, p.char.head(), camera, 0.5, show);
      }
    }
    for (const p of this.people.values()) {
      if (seen.has(p)) continue;
      p.char.root.visible = false;
      if (p.tag) p.tag.el.style.display = "none";
    }
  }

  /** Kids on the balconies: cheering for the big moments, otherwise watching. */
  spectators(spots: Array<{ x: number; y: number; z: number; side: number }>, cheering: boolean, dt: number) {
    if (!this.kids.length) {
      spots.slice(0, 8).forEach((s, i) => {
        const c = this.make((i + 1) % 3, ["#ff4d6d", "#3bceac", "#ffd23f", "#9575cd"][i % 4]!, 0.5);
        c.root.position.set(s.x, s.y, s.z);
        c.root.rotation.y = s.side === 0 ? Math.PI : s.side > 0 ? -Math.PI / 2 : Math.PI / 2;
        c.play("Idle", { from: i * 0.3 });
        this.group.add(c.root);
        this.kids.push(c);
      });
    }
    this.kids.forEach((c, i) => {
      const want = cheering ? "Cheer" : i % 3 === 0 ? "Interact" : "Idle";
      if (c.current !== want) c.play(want, { from: (i * 0.37) % 0.8 });
      c.update(dt);
    });
  }

  /** The batter's world position (for the camera and effects). */
  position(id: string): THREE.Vector3 | null {
    const p = this.people.get(id);
    return p ? p.char.root.getWorldPosition(this.v) : null;
  }

  dispose() {
    for (const p of this.people.values()) {
      p.char.dispose();
      if (p.tag) this.labels.remove(p.tag.el);
    }
    for (const k of this.kids) k.dispose();
    this.people.clear();
  }
}
