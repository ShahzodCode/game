import * as THREE from 'three';
import { world } from './core';

// One place for gameplay rays. The terrain is NOT a mesh to ray-test (it has 50k triangles and made every shot cost
// ~10 ms): it is marched analytically on the height grid and added to the list of hits like any other surface.

const rc = new THREE.Raycaster();
const _p = new THREE.Vector3();

/** All hits along the ray (nearest first): the given objects plus the ground. A ground hit has no `userData.owner`. */
export function castRay(origin: THREE.Vector3, dir: THREE.Vector3, far: number, objects: THREE.Object3D[]): THREE.Intersection[] {
  rc.set(origin, dir);
  rc.far = far;
  const hits = rc.intersectObjects(objects, false);
  const t = world.terrainRay(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, far);
  if (t >= 0) {
    const ground = { distance: t, point: _p.copy(dir).multiplyScalar(t).add(origin).clone(), object: world.terrainProxy } as THREE.Intersection;
    let i = hits.findIndex((h) => h.distance > t);
    if (i < 0) i = hits.length;
    hits.splice(i, 0, ground);
  }
  return hits;
}

/** True if nothing solid (walls, rocks, trunks, ground) lies between the two points. */
export function clearBetween(from: THREE.Vector3, to: THREE.Vector3, objects: THREE.Object3D[]): boolean {
  const d = _p.copy(to).sub(from);
  const dist = d.length();
  if (dist < 1e-4) return true;
  d.divideScalar(dist);
  rc.set(from, d);
  rc.far = dist;
  if (rc.intersectObjects(objects, false).length > 0) return false;
  return world.terrainRay(from.x, from.y, from.z, d.x, d.y, d.z, dist) < 0;
}
