/**
 * kitplat/render/backdrop: a pre-rendered parallax layer (sky, far, mid) as one screen-covering quad whose UVs
 * scroll with the camera: one draw call per layer, seamless left-to-right (RepeatWrapping), slow vertical drift.
 */
import * as THREE from "three";
import type { Cam } from "../camera";

const VERT = /* glsl */ `
uniform vec4 win;     // u0, v0, du, dv
uniform float cut;    // fraction of the screen height (from the bottom) the layer's content can reach
varying vec2 vUv;
void main() {
  vec2 c = vec2(position.x + 0.5, (position.y + 0.5) * cut);
  vUv = win.xy + c * win.zw;
  gl_Position = vec4(c * 2.0 - 1.0, 0.999, 1.0);
}`;

const FRAG = /* glsl */ `
uniform sampler2D map;
uniform vec3 grade;
uniform float alpha;
varying vec2 vUv;
void main() {
  vec4 t = texture2D(map, vec2(vUv.x, clamp(vUv.y, 0.002, 0.998)));
  if (t.a * alpha < 0.01) discard;
  gl_FragColor = vec4(t.rgb * grade, t.a * alpha);
  #include <colorspace_fragment>
}`;

export interface LayerSpec {
  /** World height (tiles) the whole image spans; its width follows the image's aspect. */
  height: number;
  /** Parallax factors: 0 = fixed to the screen, 1 = moves with the level. */
  fx: number;
  fy: number;
}

export const LAYERS: Record<"sky" | "far" | "mid", LayerSpec> = {
  sky: { height: 20, fx: 0.04, fy: 0.02 },
  far: { height: 19, fx: 0.16, fy: 0.1 },
  mid: { height: 16.5, fx: 0.38, fy: 0.3 },
};

export class Backdrop {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private aspect: number;

  /**
   * `contentTop`: how high (fraction of the image, from the bottom) the layer has any pixels; the quad stops there,
   * so a TV never shades the empty sky part of the far and mid layers.
   */
  constructor(texture: THREE.Texture, readonly spec: LayerSpec, order: number, opaque = false, private contentTop = 1) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.needsUpdate = true;
    const img = texture.image as HTMLImageElement;
    this.aspect = (img.naturalWidth || img.width || 16) / (img.naturalHeight || img.height || 9);
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: !opaque, depthTest: false, depthWrite: false,
      uniforms: { map: { value: texture }, win: { value: new THREE.Vector4(0, 0, 1, 1) }, grade: { value: new THREE.Color(1, 1, 1) }, alpha: { value: 1 }, cut: { value: 1 } },
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = order;
  }

  setGrade(c: THREE.ColorRepresentation) {
    (this.mesh.material.uniforms.grade!.value as THREE.Color).set(c);
  }

  /** Points the layer's window at the camera. `floorY` is the level's lowest camera centre. */
  update(cam: Cam, floorY: number) {
    const s = this.spec;
    const lw = s.height * this.aspect;
    const du = cam.vw / lw;
    const dv = Math.min(1, cam.vh / s.height);
    const u0 = (cam.x * s.fx) / lw - du / 2;
    const v0 = Math.max(0, Math.min(1 - dv, ((cam.y - floorY) * s.fy) / s.height));
    (this.mesh.material.uniforms.win!.value as THREE.Vector4).set(u0, v0, du, dv);
    this.mesh.material.uniforms.cut!.value = Math.max(0, Math.min(1, (this.contentTop + 0.01 - v0) / dv));
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
