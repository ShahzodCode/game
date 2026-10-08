import * as THREE from 'three';
import { COSTUMES } from './entities/mannequin';
import { rifleLoopActive, stopRifleLoop } from './audio/audio';
import { EYE_OFFSET, S, keys } from './game/state';
import { camera, flashLight, pos, renderer, scene, updateFx, vel, viewModels, weapons, world } from './game/core';
import { botHooks, mannequins, wolves } from './game/actors';
import { applyHit, fire, switchWeapon } from './game/combat';
import { arenaActive, checkMissions, rooms, runLevelWork, startLevel, updateFlow } from './game/flow';
import { updateHud, updateHudTimers, updateSummary } from './game/hud';
import './game/input';
import { updateNametag } from './game/nametag';
import { damagePlayer, movePlayer, usePotion } from './game/player';
import { SAVE_KEY, clearSave, loadProgress, saveProgress, startAutosave } from './game/save';
import { resetGame } from './game/session';
import { buyItem, buyMag, updateShop } from './game/shops';

startAutosave();
loadProgress(); // restore level / money / weapons / ammo from the last visit
updateSummary();

// dev-only hook for automated checks (placing the camera, simulating input without pointer lock)
if (import.meta.env.DEV) {
  (window as any).__game = {
    pos, vel, keys, world, mannequins, resetGame, fire, weapons, switchWeapon,
    clearEquip: () => (S.equipLeft = 0),
    setShopOpen: (b: boolean) => (S.shopOpen = b),
    sync: () => {
      camera.position.set(pos.x, pos.y + S.playerHeight - EYE_OFFSET, pos.z);
      camera.rotation.set(S.pitch, S.yaw, S.roll);
      scene.updateMatrixWorld(true);
    },
    buyMag, buyItem, usePotion, potionCount: () => S.potions, updateShop, shopState: () => ({ inShop: S.inShop, cash: S.cash }), setCash: (n: number) => (S.cash = n),
    COSTUMES,
    look3: () => ({ pitch: THREE.MathUtils.radToDeg(S.pitch), yaw: THREE.MathUtils.radToDeg(S.yaw), roll: THREE.MathUtils.radToDeg(S.roll) }),
    simBots: (secs: number) => { for (let i = 0; i < secs * 60; i++) mannequins.forEach((m) => m.update(1 / 60)); },
    wolves, damagePlayer, playerHealth: () => ({ health: S.health, dead: S.dead }), botHooks, applyHit,
    flow: () => ({ phase: S.phase, level: S.level, missionsDone: S.missionsDone, missions: S.missions.map((m) => ({ t: m.title, p: m.progress, g: m.target, r: m.reward, d: m.done })), stats: S.stats, cash: S.cash, score: S.score }),
    updateFlow, startLevel: () => { startLevel(); runLevelWork(Infinity); }, checkMissions, setLevel: (n: number) => (S.level = n), arenaActive, updateNametag: () => updateNametag(0.1, true),
    tick: (secs: number, dt = 1 / 30) => { for (let t = 0; t < secs; t += dt) { rooms.update(dt, t); updateFlow(dt); if (arenaActive()) { for (const m of mannequins) m.update(dt); for (const w of wolves) w.update(dt); } } },
    rooms, setLocked: (b: boolean) => (S.locked = b),
    resetFull: () => resetGame(true), saveProgress, loadProgress, clearSave, SAVE_KEY,
    simWolves: (secs: number) => { for (let i = 0; i < secs * 60; i++) wolves.forEach((w) => w.update(1 / 60)); },
    pointerChange: () => document.dispatchEvent(new Event('pointerlockchange')),
    look: (y: number, p: number) => ((S.yaw = y), (S.pitch = p)),
    step: (dt: number) => movePlayer(dt),
    state: () => ({ crouching: S.crouching, playerHeight: S.playerHeight, onGround: S.onGround, y: pos.y }),
  };
}

/** Per-frame upkeep of the held weapon: cooldowns, spread, reload timer, trigger, recoil settling. */
function updateWeapon(dt: number) {
  const w = weapons[S.current];
  w.cooldown = Math.max(0, w.cooldown - dt);
  S.equipLeft = Math.max(0, S.equipLeft - dt);
  w.bloom = Math.max(0, w.bloom - w.stats.spreadRecovery * dt);
  w.burst = Math.max(0, w.burst - w.stats.recoilBuildupDecay * dt);
  S.roll -= S.roll * (1 - Math.exp(-10 * dt)); // camera roll settles
  if (w.reloading) {
    w.reloadLeft -= dt;
    if (w.reloadLeft <= 0) {
      w.reloadLeft = 0;
      w.finishReload();
    }
  }
  if (S.trigger && !S.shopOpen && (w.stats.fireMode === 'auto' || S.triggerPressed)) fire();
  S.triggerPressed = false;
  // stop the rifle burst once shots stop coming (released, reloading, switched...)
  if (rifleLoopActive() && performance.now() - S.lastShotTime > 1.5 * (60000 / w.stats.rpm)) stopRifleLoop();

  // recoil settles back down
  if (S.recoilOffset > 0) {
    const rec = Math.min(S.recoilOffset, w.stats.recoilRecovery * dt);
    S.recoilOffset -= rec;
    S.pitch -= THREE.MathUtils.degToRad(rec);
  }
}

/** Bob, reload dip, equip dip, knife slash and muzzle flash of the weapon in the player's hand. */
function animateViewModel(dt: number) {
  S.kick = Math.max(0, S.kick - dt * 0.6);
  const vm = viewModels[S.current];
  const w = weapons[S.current];
  const bob = S.onGround ? Math.sin(performance.now() * 0.012) * Math.hypot(vel.x, vel.z) * 0.002 : 0;
  const reloadDip = w.reloading ? Math.sin((1 - w.reloadLeft / w.stats.reloadTime) * Math.PI) : 0;
  const equipDip = S.equipLeft > 0 ? S.equipLeft / w.stats.equipTime : 0;
  vm.position.set(0.25, -0.22 + bob - reloadDip * 0.2 - equipDip * 0.3, -0.5 + S.kick);
  vm.rotation.set(reloadDip * 0.3 + S.kick * 2, 0, reloadDip * 0.25); // gentle tilt: tipping the muzzle up shows the weapon's rear and top
  if (S.swingT > 0) {
    // knife slash: sweeps from the right across the screen and thrusts forward
    S.swingT = Math.max(0, S.swingT - dt);
    const k = 1 - S.swingT / 0.28; // 0 -> 1
    const arc = Math.sin(k * Math.PI);
    vm.position.x += -0.32 * Math.sin(k * Math.PI * 0.9) + 0.05;
    vm.position.y += 0.05 * arc;
    vm.position.z += -0.18 * arc;
    vm.rotation.set(-0.5 * arc, 0.9 * arc - 0.2 * k, -1.0 * arc);
  }
  flashLight.intensity = Math.max(0, flashLight.intensity - dt * 400);
}

// ---------- main loop ----------
const clock = new THREE.Clock();
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);

  if (S.locked) {
    movePlayer(dt);
    updateWeapon(dt);
  }

  camera.position.set(pos.x, pos.y + S.playerHeight - EYE_OFFSET, pos.z);
  camera.rotation.set(S.pitch, S.yaw, S.roll);
  animateViewModel(dt);

  // the arena is only alive while the player can reach it (not while he is in the safe room / sealed airlock)
  if (S.locked && arenaActive()) {
    for (const m of mannequins) m.update(dt);
    for (const w of wolves) w.update(dt);
  }
  if (S.locked) updateFlow(dt);
  rooms.update(S.locked ? dt : 0, performance.now() / 1000); // doors slide, candles flicker
  world.setIndoor(THREE.MathUtils.smoothstep(pos.z, 57, 63)); // 0 in the arena, 1 inside the rooms
  updateNametag(dt);
  updateFx(dt);
  updateShop();
  updateHudTimers(dt);
  updateHud();

  renderer.render(scene, camera);
}
frame();
