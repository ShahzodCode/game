import * as THREE from 'three';
import { Mannequin } from '../entities/mannequin';
import { Wolf } from '../entities/wolf';
import type { Weapon } from '../weapons/weapons';
import {
  pistolShot, shotgunShot, startRifleLoop, stopRifleLoop, reloadSound, stopReloadSound, knifeSwish,
} from '../audio/audio';
import { camera, flashLight, spawnImpact, spawnTracer, vel, viewModels, weapons, world } from './core';
import { mannequins, wolves, type Target } from './actors';
import { addScore } from './flow';
import { hitmarker, showPopup } from './hud';
import { POINTS_HEADSHOT_KILL, POINTS_HIT, S } from './state';

// Weapon handling (switching, reloading) and the player's shooting.

export function switchWeapon(i: number) {
  if (i === S.current || i < 0 || i >= weapons.length) return;
  if (!weapons[i].owned) {
    showPopup(`${weapons[i].stats.name} not owned - buy it at the shop`, '#ff9a4a');
    return;
  }
  weapons[S.current].reloadLeft = 0;
  stopRifleLoop();
  stopReloadSound();
  viewModels[S.current].visible = false;
  S.current = i;
  viewModels[S.current].visible = true;
  S.equipLeft = weapons[S.current].stats.equipTime;
}

/** Next / previous weapon that the player actually owns. */
export function cycleWeapon(dir: number) {
  const n = weapons.length;
  for (let k = 1; k < n; k++) {
    const i = (S.current + dir * k + n * k) % n;
    if (weapons[i].owned) return switchWeapon(i);
  }
}

/** Start reloading (if possible) and play the weapon's reload sound. */
export function beginReload(w: Weapon) {
  if (w.stats.melee) return;
  if (w.startReload()) reloadSound(w.stats.id);
}

/** Pistol: one-shot per bullet. Rifle: looped burst while firing (stops via the frame loop when shots stop). */
function shotSound(w: Weapon) {
  S.lastShotTime = performance.now();
  if (w.stats.id === 'pistol') pistolShot();
  else if (w.stats.id === 'shotgun') shotgunShot();
  else if (w.stats.melee) knifeSwish();
  else startRifleLoop(); // no-op if already running
}

const raycaster = new THREE.Raycaster();
const tmpV = new THREE.Vector3();
const tmpDir = new THREE.Vector3();
const muzzlePos = new THREE.Vector3();

function currentSpread(w: Weapon) {
  const s = w.stats;
  const moving = Math.hypot(vel.x, vel.z) > 0.5;
  let deg = s.spreadBase + w.bloom;
  if (moving) deg += s.spreadMoving;
  if (!S.onGround) deg += s.spreadAir;
  return Math.min(deg, s.spreadMax + (moving ? s.spreadMoving : 0) + (S.onGround ? 0 : s.spreadAir));
}

const PACK_ALERT_RADIUS = 12;
/** Shooting a wolf rouses the wolves near it; shooting a cowboy rouses the cowboys near him. */
function alertPack(shot: Target) {
  const pack: Target[] = shot instanceof Wolf ? wolves : mannequins.filter((m) => m.costume.combat === 'ranged');
  for (const o of pack) {
    if (o !== shot && o.alive && o.group.position.distanceTo(shot.group.position) < PACK_ALERT_RADIUS) o.aggravate();
  }
}

/** The player's shot or blade landed on a bot / wolf: damage, alerts, score, hit marker. */
export function applyHit(owner: Target, dmg: number, head: boolean, point: THREE.Vector3) {
  alertPack(owner);
  if (owner.damage(dmg)) {
    S.kills++;
    const { label: name, points } = owner;
    let gained = points;
    if (head) {
      S.headshotKills++;
      gained += POINTS_HEADSHOT_KILL;
    }
    // level stats for the missions
    S.stats.kills++;
    S.stats.byKind[owner.kind] = (S.stats.byKind[owner.kind] ?? 0) + 1;
    if (head) S.stats.headshots++;
    if (weapons[S.current].stats.melee) S.stats.knifeKills++;
    showPopup(`${head ? 'HEADSHOT · ' : ''}${name} +${gained} pts`);
    addScore(gained); // also re-checks the missions
  }
  S.hitTimer = 0.15;
  hitmarker.style.color = head ? '#ff4040' : '#ffffff';
  spawnImpact(point, 0xff5533);
}

/** Knife: a short-range slash at whatever is in front of the crosshair (a small arc so it forgives aim). */
function meleeAttack(w: Weapon) {
  const s = w.stats;
  if (S.equipLeft > 0 || w.cooldown > 0) return;
  w.cooldown = 60 / s.rpm;
  S.shotsFired++;
  S.swingT = 0.28;
  knifeSwish();

  const targets = [...mannequins, ...wolves].filter((m) => m.alive).flatMap((m) => m.hitMeshes);
  const all = [...targets, ...world.blockers];
  camera.getWorldPosition(tmpV);
  camera.getWorldDirection(tmpDir);
  const arc = THREE.MathUtils.degToRad(s.meleeArc ?? 10);
  const up = new THREE.Vector3(0, 1, 0);
  let best: { owner: Target; head: boolean; point: THREE.Vector3; dist: number } | null = null;
  for (const a of [0, -arc, arc]) {
    const dir = tmpDir.clone().applyAxisAngle(up, a);
    raycaster.set(tmpV, dir);
    raycaster.far = s.range;
    const hit = raycaster.intersectObjects(all, false)[0];
    const owner = hit?.object.userData.owner as Target | undefined;
    if (hit && owner && (!best || hit.distance < best.dist)) {
      best = { owner, head: !!hit.object.userData.head, point: hit.point.clone(), dist: hit.distance };
    }
  }
  if (best) {
    S.shotsHit++;
    addScore(POINTS_HIT); // score only: money comes from missions
    applyHit(best.owner, s.damage * (best.head ? s.headshotMultiplier : 1), best.head, best.point);
  }
}

export function fire() {
  const w = weapons[S.current];
  const s = w.stats;
  if (s.melee) return meleeAttack(w);
  if (w.reloading || S.equipLeft > 0 || w.cooldown > 0) return;
  if (w.ammo <= 0) {
    beginReload(w);
    return;
  }
  w.ammo--;
  w.cooldown = 60 / s.rpm;
  S.shotsFired++;
  let landed = false;

  const spreadRad = THREE.MathUtils.degToRad(currentSpread(w));
  const targets = [...mannequins, ...wolves].filter((m) => m.alive).flatMap((m) => m.hitMeshes);
  const all = [...targets, ...world.blockers];
  camera.getWorldPosition(tmpV);
  viewModels[S.current].getObjectByName('muzzle')!.getWorldPosition(muzzlePos);

  for (let p = 0; p < s.pellets; p++) {
    // random direction inside the spread cone around the camera forward
    camera.getWorldDirection(tmpDir);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), tmpDir);
    const ang = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * Math.tan(spreadRad);
    const dir = new THREE.Vector3(Math.cos(ang) * r, Math.sin(ang) * r, -1).normalize().applyQuaternion(q);

    raycaster.set(tmpV, dir);
    raycaster.far = s.range;
    const hit = raycaster.intersectObjects(all, false)[0];
    const end = hit ? hit.point.clone() : tmpV.clone().addScaledVector(dir, s.range);
    spawnTracer(muzzlePos.clone(), end, s.tracerColor);

    if (hit) {
      const owner = hit.object.userData.owner as Target | undefined;
      if (owner) {
        const head = !!hit.object.userData.head;
        const falloff = THREE.MathUtils.clamp((hit.distance - s.falloffStart) / (s.range - s.falloffStart), 0, 1);
        let dmg = s.damage * THREE.MathUtils.lerp(1, s.falloffMinMultiplier, falloff);
        if (head) dmg *= s.headshotMultiplier;
        landed = true;
        applyHit(owner, dmg, head, hit.point);
      } else {
        spawnImpact(hit.point, 0xffee88);
      }
    }
  }

  if (landed) {
    // one hit bonus per shot, however many shotgun pellets connect
    S.shotsHit++;
    addScore(POINTS_HIT); // score only: money comes from missions
  }

  // feedback: bloom, recoil, viewmodel kick, flash, sound
  w.bloom = Math.min(w.bloom + s.spreadPerShot, s.spreadMax);
  // recoil grows with every consecutive shot (burst), so sustained fire climbs more and more
  const mult = Math.min(1 + s.recoilBuildup * w.burst, s.recoilBuildupMax);
  w.burst++;
  const pitchKick = s.recoilPitch * mult;
  S.pitch += THREE.MathUtils.degToRad(pitchKick);
  S.yaw += THREE.MathUtils.degToRad((Math.random() * 2 - 1) * s.recoilYaw * mult);
  S.roll += THREE.MathUtils.degToRad((Math.random() * 2 - 1) * s.recoilRoll * mult);
  S.recoilOffset += pitchKick;
  Mannequin.scareNear(tmpV, s.id === 'shotgun' ? 24 : 16); // civilians nearby hear the gunshot and panic
  S.kick = s.viewKick * (0.6 + 0.4 * mult);
  flashLight.intensity = 25;
  shotSound(w);
  if (w.ammo === 0) beginReload(w);
}
