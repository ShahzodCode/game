import * as THREE from 'three';
import { $, camera, world } from './core';
import { mannequins, wolves, type Target } from './actors';
import { arenaActive } from './flow';
import { castRay } from './raycast';
import { S } from './state';

// Name + HP over whatever the crosshair is on (10 Hz raycast), red for hostile.
const nametag = $('nametag');
let nameT = 0;
const tmpV = new THREE.Vector3();
const tmpDir = new THREE.Vector3();

/** `force` skips the 10 Hz throttle (dev hook / tests). */
export function updateNametag(dt: number, force = false) {
  nameT -= dt;
  if (nameT > 0 && !force) return;
  nameT = 0.1;
  if (!S.locked || S.dead || !arenaActive()) {
    nametag.style.opacity = '0';
    return;
  }
  camera.getWorldPosition(tmpV);
  camera.getWorldDirection(tmpDir);
  const targets = [...mannequins, ...wolves].filter((t) => t.alive).flatMap((t) => t.hitMeshes);
  const hit = castRay(tmpV, tmpDir, 70, [...targets, ...world.blockers])[0];
  const owner = hit?.object.userData.owner as Target | undefined;
  if (owner) {
    nametag.innerHTML = `${owner.label}<small>${Math.ceil(owner.health)} HP</small>`;
    nametag.classList.toggle('hostile', owner.hostile);
    nametag.style.opacity = '1';
  } else {
    nametag.style.opacity = '0';
  }
}
