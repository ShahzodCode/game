import * as THREE from 'three';
import { Mannequin, setSpawnRule, type BotHooks } from '../entities/mannequin';
import { Wolf } from '../entities/wolf';
import { botScream, enemyShot, knifeSwish, wolfGrowl } from '../audio/audio';
import { levelConfig } from './missions';
import { pos, scene, spawnTracer, world } from './core';
import { damagePlayer } from './player';
import { S } from './state';

// The bots and wolves, plus how they reach the player.

const playerChestV = new THREE.Vector3();
const losRay = new THREE.Raycaster();
function hasLineOfSight(from: THREE.Vector3, to: THREE.Vector3) {
  const d = to.clone().sub(from);
  const dist = d.length();
  losRay.set(from, d.normalize());
  losRay.far = dist;
  return losRay.intersectObjects(world.blockers, false).length === 0; // terrain, crates and rocks block sight
}
/** How fighting bots (shooting cowboys, knife criminals) reach the player. */
export const botHooks: BotHooks = {
  hurtPlayer: (d) => damagePlayer(d),
  shotFired: (from, to) => {
    spawnTracer(from, to, 0xff8a5a);
    enemyShot(from.distanceTo(pos));
  },
  stab: () => knifeSwish(),
  scream: (at) => botScream(at.distanceTo(pos)),
  lineOfSight: hasLineOfSight,
  playerChest: () => playerChestV.set(pos.x, pos.y + S.playerHeight * 0.7, pos.z),
  playerDead: () => S.dead,
};
setSpawnRule(levelConfig(1).allowed); // level 1 has no criminals
export const mannequins = world.spawnPoints.map((p) => {
  const m = new Mannequin(world, p, pos, botHooks);
  scene.add(m.group);
  return m;
});

// wolves: calm until shot (see wolf.ts). The level decides how many of them are active (none in level 1).
export const MAX_WOLVES = 6;
export const wolves = Array.from({ length: MAX_WOLVES }, () => {
  const w = new Wolf(world, world.randomFreePoint(world.arenaEntry, 35), pos, {
    hurtPlayer: (d) => damagePlayer(d),
    onAggro: () => wolfGrowl(),
  });
  w.deactivate();
  scene.add(w.group);
  return w;
});
/** Anything the player can shoot (same interface on bots and wolves). */
export type Target = Mannequin | Wolf;
