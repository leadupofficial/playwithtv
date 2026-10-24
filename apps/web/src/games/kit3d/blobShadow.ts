/**
 * kit3d/blobShadow: a soft round shadow quad under a character, instead of real-time shadow maps (far too
 * expensive on a Mali-G31). One shared 64×64 gradient texture; depthWrite off so overlapping blobs blend.
 *
 *   const shadow = blobShadow(0.7);
 *   scene.add(shadow);
 *   shadow.position.set(x, floorY + 0.02, z);
 *   fadeBlob(shadow, heightAboveFloor);   // shrinks and fades while jumping
 */
import * as THREE from "three";

let tex: THREE.CanvasTexture | null = null;
let geo: THREE.PlaneGeometry | null = null;

function gradient(): THREE.CanvasTexture {
  if (tex) return tex;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const r = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  r.addColorStop(0, "rgba(0,0,0,0.75)");
  r.addColorStop(0.55, "rgba(0,0,0,0.4)");
  r.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  tex = new THREE.CanvasTexture(c);
  return tex;
}

/** A flat blob shadow of the given radius, lying on the XZ plane. */
export function blobShadow(radius: number, opacity = 0.8): THREE.Mesh {
  geo ??= new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({ map: gradient(), transparent: true, depthWrite: false, opacity });
  const m = new THREE.Mesh(geo, mat);
  m.scale.setScalar(radius);
  m.renderOrder = 1;
  m.userData.radius = radius;
  m.userData.opacity = opacity;
  return m;
}

/** Shrinks and fades a blob as its owner rises `height` units above the ground. */
export function fadeBlob(m: THREE.Mesh, height: number) {
  const k = 1 / (1 + Math.max(0, height) * 0.35);
  m.scale.setScalar((m.userData.radius as number) * (0.55 + 0.45 * k));
  (m.material as THREE.MeshBasicMaterial).opacity = (m.userData.opacity as number) * k;
}
