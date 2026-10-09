import * as THREE from 'three';
import { COSTUMES } from './entities/mannequin';
import { rifleLoopActive, stopRifleLoop } from './audio/audio';
import { BASE_FOV, EYE_OFFSET, S, keys } from './game/state';
import { camera, flashLight, pos, renderer, scene, updateFx, vel, viewModels, weapons, world } from './game/core';
import { botHooks, mannequins, wolves } from './game/actors';
import { applyHit, currentSpread, fire, switchWeapon } from './game/combat';
import { arenaActive, checkMissions, rooms, runLevelWork, startLevel, updateFlow } from './game/flow';
import { setCrosshair, setCrosshairVisible, updateHud, updateHudTimers, updateSummary } from './game/hud';
import { applyQuality, shadowPeriod } from './game/settings';
import './game/settingsUi';
import './game/input';
import { updateNametag } from './game/nametag';
import { damagePlayer, movePlayer, usePotion } from './game/player';
import { collideWithBots } from './game/physics';
import { castRay } from './game/raycast';
import { clearProjectiles, explode, projectileCount, projectileInfo, spawnGrenade, updateProjectiles } from './game/projectiles';
import { SAVE_KEY, clearSave, loadProgress, saveProgress, startAutosave } from './game/save';
import { resetGame } from './game/session';
import { buyItem, buyMag, updateShop } from './game/shops';

applyQuality(); // graphics quality from the saved settings
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
    state: () => ({ crouching: S.crouching, playerHeight: S.playerHeight, onGround: S.onGround, y: pos.y, slideT: S.slideT, camDy: S.camDy, adsK: S.adsK }),
    firstHit: () => {
      const o = new THREE.Vector3(), d = new THREE.Vector3();
      camera.getWorldPosition(o);
      camera.getWorldDirection(d);
      const all = [...mannequins, ...wolves].filter((m) => m.alive).flatMap((m) => m.hitMeshes);
      const h = castRay(o, d, 400, [...all, ...world.blockers])[0];
      return h ? { dist: h.distance, owner: !!h.object.userData.owner, at: h.point.toArray() } : null;
    },
    scene, renderer, S, explode, spawnGrenade, projectileCount, projectileInfo, updateProjectiles, collideWithBots, clearProjectiles, setAiming: (b: boolean) => (S.aiming = b), updateAim: (dt: number) => updateAim(dt),
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

const scopeEl = document.getElementById('scope')!;
const easeIO = (t: number) => t * t * (3 - 2 * t);
/** Right mouse: aim down the sights. Zooms the view, tightens the spread, slows walking; scopes get an overlay. */
function updateAim(dt: number) {
  const w = weapons[S.current];
  const st = w.stats;
  const can = S.locked && S.aiming && !st.melee && !w.reloading && S.equipLeft <= 0 && !S.dead && !S.shopOpen;
  const rate = dt / Math.max(0.08, st.adsTime);
  S.adsK = THREE.MathUtils.clamp(S.adsK + THREE.MathUtils.clamp((can ? 1 : 0) - S.adsK, -rate, rate), 0, 1);
  const zoom = THREE.MathUtils.lerp(1, st.adsZoom, easeIO(S.adsK));
  const fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(BASE_FOV) / 2) / zoom));
  if (Math.abs(fov - camera.fov) > 0.01) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }
  S.fovScale = fov / BASE_FOV;
  const scoped = !!st.scope && S.adsK > 0.9;
  scopeEl.style.opacity = scoped ? '1' : '0';
  setCrosshairVisible(!(scoped || (S.adsK > 0.5 && !!st.scope)));
  viewModels[S.current].visible = !(st.scope && S.adsK > 0.8);
}

/** Bob, reload dip, equip dip, knife slash and muzzle flash of the weapon in the player's hand. */
function animateViewModel(dt: number) {
  S.kick = Math.max(0, S.kick - dt * 0.6);
  const vm = viewModels[S.current];
  const w = weapons[S.current];
  const ads = easeIO(S.adsK);
  const bob = S.onGround ? Math.sin(performance.now() * 0.012) * Math.hypot(vel.x, vel.z) * 0.002 * (1 - 0.8 * ads) : 0;
  const reloadDip = w.reloading ? Math.sin((1 - w.reloadLeft / w.stats.reloadTime) * Math.PI) : 0;
  const equipDip = S.equipLeft > 0 ? S.equipLeft / w.stats.equipTime : 0;
  // the weapon swings toward the centre of the screen when aiming
  const px = THREE.MathUtils.lerp(0.25, 0.0, ads);
  const py = THREE.MathUtils.lerp(-0.22, -0.145, ads);
  const pz = THREE.MathUtils.lerp(-0.5, -0.42, ads);
  vm.position.set(px, py + bob - reloadDip * 0.2 - equipDip * 0.3 - S.landDip * 0.5, pz + S.kick);
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

/** The crosshair ticks open up as the weapon's spread grows (moving, jumping, firing). */
function updateCrosshair() {
  const w = weapons[S.current];
  if (w.stats.melee) return setCrosshair(6, true);
  const spreadRad = THREE.MathUtils.degToRad(currentSpread(w));
  const px = (Math.tan(spreadRad) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * (innerHeight / 2);
  setCrosshair(4 + Math.min(px, 120), false);
}

/** Shadows: far-away bots do not cast any, and on lower quality the shadow map is redrawn less often. */
let shadowClock = 0;
let frameNo = 0;
function updateShadows(dt: number) {
  frameNo++;
  if (frameNo % shadowPeriod() === 0) renderer.shadowMap.needsUpdate = true;
  shadowClock -= dt;
  if (shadowClock > 0) return;
  shadowClock = 0.4;
  for (const m of mannequins) m.setShadows(m.alive && Math.hypot(m.group.position.x - pos.x, m.group.position.z - pos.z) < 50);
}

// ---------- main loop ----------
const clock = new THREE.Clock();
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);

  if (S.locked) {
    movePlayer(dt);
    collideWithBots();
    updateAim(dt);
    updateWeapon(dt);
    updateProjectiles(dt);
  }

  // camera: the player's eyes, plus sway of a scoped rifle, shake from blasts / heavy guns, ledge and landing offsets
  const t = performance.now() / 1000;
  const w = weapons[S.current].stats;
  let swayP = 0, swayY = 0;
  if (w.scope && S.adsK > 0.3) {
    const amp = 0.1 * (S.crouching ? 0.35 : 1) * (1 + Math.hypot(vel.x, vel.z) * 0.4) * S.adsK; // degrees
    swayP = THREE.MathUtils.degToRad(amp * (Math.sin(t * 1.1) + 0.4 * Math.sin(t * 2.9 + 1)));
    swayY = THREE.MathUtils.degToRad(amp * (Math.sin(t * 0.8 + 2) + 0.4 * Math.sin(t * 3.3)));
  }
  S.shake = Math.max(0, S.shake - dt * 2.4);
  const sh = S.shake * S.shake;
  camera.position.set(pos.x, pos.y + S.playerHeight - EYE_OFFSET + S.camDy - S.landDip, pos.z);
  camera.rotation.set(S.pitch + swayP + Math.sin(t * 63) * 0.03 * sh, S.yaw + swayY + Math.sin(t * 57 + 1) * 0.03 * sh, S.roll + Math.sin(t * 47 + 2) * 0.04 * sh);
  animateViewModel(dt);
  updateCrosshair();
  updateShadows(dt);

  // the arena is only alive while the player can reach it (not while he is in the safe room / sealed airlock)
  if (S.locked && arenaActive()) {
    for (const m of mannequins) m.update(dt);
    for (const w of wolves) w.update(dt);
  }
  if (S.locked) updateFlow(dt);
  rooms.update(S.locked ? dt : 0, performance.now() / 1000); // doors slide, candles flicker
  world.update(S.locked ? dt : 0, performance.now() / 1000, pos); // house doors, campfire, water, clouds
  world.setIndoor(THREE.MathUtils.smoothstep(pos.z, 57, 63)); // 0 in the arena, 1 inside the rooms
  updateNametag(dt);
  updateFx(dt);
  updateShop();
  updateHudTimers(dt);
  updateHud();

  renderer.render(scene, camera);
}
frame();
