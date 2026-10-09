import * as THREE from 'three';
import { Mannequin, setSpawnRule, type BotHooks } from '../entities/mannequin';
import { Wolf } from '../entities/wolf';
import { loadCharacterModels } from '../entities/glbRig';
import { botScream, voiceLine, punchSound, enemyShot, knifeSwish, wolfGrowl } from '../audio/audio';
import { levelConfig } from './missions';
import { pos, scene, spawnTracer, world } from './core';
import { damagePlayer } from './player';
import { clearBetween } from './raycast';
import { S } from './state';

// The bots and wolves, plus how they reach the player.

const playerChestV = new THREE.Vector3();
export function hasLineOfSight(from: THREE.Vector3, to: THREE.Vector3) {
  return clearBetween(from, to, world.blockers); // the ground, trunks, rocks and walls block sight
}
/** How fighting bots (shooting cowboys, knife criminals) reach the player. */
export const botHooks: BotHooks = {
  hurtPlayer: (d) => damagePlayer(d),
  shotFired: (from, to) => {
    spawnTracer(from, to, 0xff8a5a);
    enemyShot(from.distanceTo(pos));
  },
  stab: () => knifeSwish(),
  punch: (phase) => punchSound(phase),
  scream: (at) => botScream(at.distanceTo(pos)),
  lineOfSight: hasLineOfSight,
  playerChest: () => playerChestV.set(pos.x, pos.y + S.playerHeight * 0.7, pos.z),
  playerDead: () => S.dead,
  summon: (at) => {
    // a limited number of zombies live in the arena: when all are out, the one farthest from the player vanishes
    let z = zombies.find((q) => q.disabled);
    if (!z) {
      let far = -1;
      for (const q of zombies) {
        const d = Math.hypot(q.group.position.x - pos.x, q.group.position.z - pos.z);
        if (d > far) {
          far = d;
          z = q;
        }
      }
      z?.disable();
    }
    if (!z) return false;
    const r = world.region;
    z.spawnAs('zombie', new THREE.Vector3(THREE.MathUtils.clamp(at.x, r.x0 + 2, r.x1 - 2), 0, THREE.MathUtils.clamp(at.z, r.z0 + 2, r.z1 - 2)));
    return true;
  },
  voice: (id, kind, at, owner) => voiceLine(id, kind, at.distanceTo(pos), owner),
  zombiesAlive: () => zombies.filter((q) => !q.disabled && q.alive).length,
};
setSpawnRule(levelConfig(1).allowed); // level 1 has no criminals
/** The ordinary crowd (flow.ts decides how many are in play). */
export const regulars = world.spawnPoints.map((p) => {
  const m = new Mannequin(world, p, pos, botHooks);
  scene.add(m.group);
  return m;
});
loadCharacterModels(); // the knight (boss) and the zombie models load in the background; procedural ones show until then
/** The final boss (level 21) and the zombies it summons: switched off until the boss level starts. */
export const boss = new Mannequin(world, world.arenaEntry, pos, botHooks, 4, 'boss');
export const zombies = Array.from({ length: 8 }, () => {
  const z = new Mannequin(world, world.arenaEntry, pos, botHooks, 4, 'zombie');
  z.oneLife = true;
  return z;
});
for (const m of [boss, ...zombies]) {
  scene.add(m.group);
  m.disable();
}
/** Everything that can be shot like a bot. */
export const mannequins = [...regulars, boss, ...zombies];

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
