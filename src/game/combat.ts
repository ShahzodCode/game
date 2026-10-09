import * as THREE from 'three';
import { Mannequin } from '../entities/mannequin';
import { Wolf } from '../entities/wolf';
import type { Weapon } from '../weapons/weapons';
import {
  pistolShot, shotgunShot, startRifleLoop, stopRifleLoop, reloadSound, stopReloadSound, knifeSwish, synthShot, sniperShot,
} from '../audio/audio';
import { camera, flashLight, spawnImpact, spawnTracer, vel, viewModels, weapons, world } from './core';
import { spawnBolt, spawnCasing, spawnGrenade } from './projectiles';
import { castRay } from './raycast';
import { mannequins, wolves, type Target } from './actors';
import { addScore } from './flow';
import { equippedIndices, isEquipped, slotWeaponIndex } from './loadout';
import { hitmarker, showPopup } from './hud';
import { POINTS_HEADSHOT_KILL, POINTS_HIT, S } from './state';

// Weapon handling (switching, reloading) and the player's shooting.

export function switchWeapon(i: number) {
  if (i === S.current || i < 0 || i >= weapons.length) return;
  if (!weapons[i].owned) {
    showPopup(`${weapons[i].stats.name} not owned - buy it at the shop`, '#ff9a4a');
    return;
  }
  if (!isEquipped(i)) {
    showPopup(`${weapons[i].stats.name} is not in your loadout - change it at the armory terminal`, '#ff9a4a');
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

/** Weapon in a loadout slot (key 1-4). */
export function switchSlot(n: number) {
  const i = slotWeaponIndex(n);
  if (i < 0) {
    showPopup(n === 2 ? 'No heavy weapon in your loadout - buy one at the weapon shop' : 'Nothing in that slot', '#ff9a4a');
    return;
  }
  switchWeapon(i);
}

/** Next / previous weapon in the loadout. */
export function cycleWeapon(dir: number) {
  const list = equippedIndices();
  if (list.length < 2) return;
  const at = list.indexOf(S.current);
  switchWeapon(list[(at + dir + list.length) % list.length]);
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
  else if (w.stats.id === 'sniper') sniperShot();
  else if (w.stats.shot) synthShot(w.stats.shot);
  else startRifleLoop(); // no-op if already running
}

const tmpV = new THREE.Vector3();
const tmpDir = new THREE.Vector3();
const muzzlePos = new THREE.Vector3();

export function currentSpread(w: Weapon) {
  const s = w.stats;
  const moving = Math.hypot(vel.x, vel.z) > 0.5;
  // aiming down the sights tightens the cone; a scope stays honest about moving and jumping
  const ads = THREE.MathUtils.lerp(1, s.adsSpreadMult ?? 0.55, S.adsK);
  const scopeAds = s.scope ? S.adsK : 0;
  let deg = (s.spreadBase + w.bloom) * ads;
  if (moving) deg += s.spreadMoving * THREE.MathUtils.lerp(ads, 0.4, scopeAds);
  if (!S.onGround) deg += s.spreadAir * THREE.MathUtils.lerp(ads, 0.6, scopeAds);
  return Math.min(deg, (s.spreadMax + (moving ? s.spreadMoving : 0) + (S.onGround ? 0 : s.spreadAir)) * Math.max(ads, 0.05));
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
export function applyHit(owner: Target, dmg: number, head: boolean, point: THREE.Vector3, push?: THREE.Vector3) {
  alertPack(owner);
  if (push && (owner instanceof Mannequin || owner instanceof Wolf)) owner.impulse(push); // shoved by the impact (strong weapons throw people back)
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
    const hit = castRay(tmpV, dir, s.range, all)[0];
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

const _aim = new THREE.Vector3();
const _pushV = new THREE.Vector3();

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

    if (s.projectile) {
      // a physical projectile: it leaves the muzzle aimed at what the crosshair is on, then gravity takes over
      _aim.copy(tmpV).addScaledVector(dir, s.projectile.kind === 'bolt' ? 45 : 22);
      const launch = muzzlePos.clone();
      const d = _aim.sub(launch).normalize();
      if (s.projectile.kind === 'bolt') spawnBolt(launch, d, s);
      else spawnGrenade(launch, d, s);
      continue;
    }

    const hits = castRay(tmpV, dir, s.range, all);
    // the shot normally stops at the first thing it hits; a piercing bullet continues through up to `pierce` more characters
    let end: THREE.Vector3 | null = null;
    let through = 0;
    let lastOwner: Target | undefined;
    for (const hit of hits) {
      const owner = hit.object.userData.owner as Target | undefined;
      end = hit.point.clone();
      if (!owner) {
        spawnImpact(hit.point, 0xffee88);
        break;
      }
      if (owner === lastOwner) continue; // another body part of the same character
      lastOwner = owner;
      const head = !!hit.object.userData.head;
      const falloff = THREE.MathUtils.clamp((hit.distance - s.falloffStart) / (s.range - s.falloffStart), 0, 1);
      let dmg = s.damage * THREE.MathUtils.lerp(1, s.falloffMinMultiplier, falloff) * Math.pow(0.6, through);
      if (head) dmg *= s.headshotMultiplier;
      landed = true;
      _pushV.copy(dir).setLength(s.impactImpulse * 0.06 * Math.pow(0.6, through));
      applyHit(owner, dmg, head, hit.point, _pushV);
      if (through >= (s.pierce ?? 0)) break;
      through++;
    }
    spawnTracer(muzzlePos.clone(), end ?? tmpV.clone().addScaledVector(dir, s.range), s.tracerColor);
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
  const adsRecoil = 1 - 0.25 * S.adsK; // aiming steadies the gun a little
  const pitchKick = s.recoilPitch * mult * adsRecoil;
  S.pitch += THREE.MathUtils.degToRad(pitchKick);
  S.yaw += THREE.MathUtils.degToRad((Math.random() * 2 - 1) * s.recoilYaw * mult * adsRecoil);
  S.roll += THREE.MathUtils.degToRad((Math.random() * 2 - 1) * s.recoilRoll * mult);
  S.recoilOffset += pitchKick;
  if (!s.silent && !s.explosion) Mannequin.scareNear(tmpV, s.id === 'shotgun' || s.id === 'sniper' ? 24 : 16); // civilians nearby hear the gunshot and panic
  if (s.explosion) Mannequin.scareNear(tmpV, 18);
  S.shake = Math.max(S.shake, Math.min(0.5, s.recoilPitch * 0.08));
  S.kick = s.viewKick * (0.6 + 0.4 * mult);
  flashLight.intensity = s.silent ? 0 : 25;
  if (s.id === 'pistol' || s.id === 'rifle' || s.id === 'smg') spawnCasing();
  else if (s.id === 'sniper') spawnCasing(1.8);
  shotSound(w);
  if (w.ammo === 0) beginReload(w);
}
