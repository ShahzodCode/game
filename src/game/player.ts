import * as THREE from 'three';
import { stopRifleLoop, stopReloadSound, hurtSound, potionSound, stepSound, landSound, splashSound } from '../audio/audio';
import { POND } from '../world/layout';
import { POTION } from '../shop/shopItems';
import { pos, vel, weapons, world } from './core';
import { showPopup } from './hud';
import {
  CROUCH_HEIGHT, CROUCH_LERP, CROUCH_SPEED, GRAVITY, JUMP_SPEED, MAX_HEALTH, PLAYER_RADIUS, S, SPRINT_SPEED,
  STAND_HEIGHT, WALK_SPEED, keys,
} from './state';

// Movement physics tunables
const STEP_HEIGHT = 0.6; // ledges up to this high are stepped onto instead of blocking
const COYOTE = 0.12; // a jump still works this long after walking off an edge
const JUMP_BUFFER = 0.12; // a jump pressed this long before landing still counts
const FALL_GRAVITY = 1.25; // falling is heavier than rising (snappier jumps)
const SAFE_LANDING = 17.5; // landing faster than this (m/s, ~6 m drop) hurts
const MAX_SLOPE = 0.85; // steeper than this (tan, ~40 degrees) the player slides down
const SLIDE_TIME = 0.85;

// Player health, potions and movement / collision.

/** Drink a health potion (H). */
export function usePotion() {
  if (S.dead || S.potions <= 0) return;
  if (S.health >= MAX_HEALTH) return showPopup('Health already full', '#ff9a4a');
  S.potions--;
  S.health = Math.min(MAX_HEALTH, S.health + POTION.heal);
  potionSound();
  showPopup(`+${POTION.heal} health`, '#7dff9b');
}

export function damagePlayer(amount: number) {
  if (S.dead) return;
  S.health -= amount;
  S.hurtFlash = 1;
  hurtSound();
  if (S.health <= 0) {
    S.health = 0;
    S.dead = true;
    stopRifleLoop();
    stopReloadSound();
    document.exitPointerLock(); // frees the mouse; the pointerlockchange handler shows the death screen
  }
}

/** True if nothing solid overhead blocks standing at full height. */
function canStand() {
  for (const b of world.boxesNear(pos.x, pos.z, PLAYER_RADIUS + 0.8)) {
    const overX = pos.x > b.min.x - PLAYER_RADIUS && pos.x < b.max.x + PLAYER_RADIUS;
    const overZ = pos.z > b.min.z - PLAYER_RADIUS && pos.z < b.max.z + PLAYER_RADIUS;
    if (overX && overZ && b.min.y >= pos.y + CROUCH_HEIGHT - 0.01 && b.min.y < pos.y + STAND_HEIGHT) return false;
  }
  return true;
}

/** Terrain gradient (rise per metre) at the player's feet. */
function slope(out: THREE.Vector2) {
  const e = 0.4;
  out.set(
    (world.heightAt(pos.x + e, pos.z) - world.heightAt(pos.x - e, pos.z)) / (2 * e),
    (world.heightAt(pos.x, pos.z + e) - world.heightAt(pos.x, pos.z - e)) / (2 * e),
  );
  return out;
}

/** 0..1: how deep in the pond the player stands (wading slows him down). */
function waterDepth() {
  if (Math.hypot(pos.x - POND.x, pos.z - POND.z) > POND.r + 3) return 0;
  const ground = world.heightAt(pos.x, pos.z);
  return THREE.MathUtils.clamp((POND.level - ground - 0.1) / 0.9, 0, 1);
}
let wasWet = false;

const _grad = new THREE.Vector2();
let jumpWasDown = false;
let jumped = false; // the current rise came from a jump (so releasing the key cuts it short)

export function movePlayer(dt: number) {
  const w = weapons[S.current].stats;
  const horiz0 = Math.hypot(vel.x, vel.z);
  const shift = !!(keys['ShiftLeft'] || keys['ShiftRight']);
  const ctrl = !!(keys['ControlLeft'] || keys['ControlRight']);
  S.slideCd = Math.max(0, S.slideCd - dt);

  // ---- crouch, and the crouch-slide (sprint, then press crouch) ----
  if (shift && !S.crouching && S.slideT <= 0 && S.slideCd <= 0 && (S.onGround || S.coyote > 0) && ctrl && horiz0 > 6.5) {
    S.slideT = SLIDE_TIME;
    S.slideCd = 1.5;
    const sp = Math.min(11.5, Math.max(horiz0, 8.5) * 1.15);
    vel.x = (vel.x / horiz0) * sp;
    vel.z = (vel.z / horiz0) * sp;
  }
  if (S.slideT > 0) {
    S.slideT -= dt;
    // bumps on uneven ground may lift the player for a frame or two: that must not end the slide
    if ((!S.onGround && S.coyote <= 0) || !shift || Math.hypot(vel.x, vel.z) < 3.2) S.slideT = 0;
  }
  if (shift) S.crouching = true;
  else if (S.crouching && S.slideT <= 0 && canStand()) S.crouching = false;
  const targetH = S.crouching ? CROUCH_HEIGHT : STAND_HEIGHT;
  S.playerHeight += (targetH - S.playerHeight) * (1 - Math.exp(-CROUCH_LERP * dt));
  if (Math.abs(S.playerHeight - targetH) < 0.002) S.playerHeight = targetH;

  // ---- wanted velocity ----
  const aimMove = THREE.MathUtils.lerp(1, w.adsMoveMult ?? 0.65, S.adsK);
  const running = ctrl && !S.crouching && S.adsK < 0.3;
  const base = S.crouching ? CROUCH_SPEED : running ? SPRINT_SPEED : WALK_SPEED;
  let speed = base * w.moveSpeedMultiplier * aimMove;

  const fwd = (keys['KeyW'] ? 1 : 0) - (keys['KeyS'] ? 1 : 0);
  const strafe = (keys['KeyD'] ? 1 : 0) - (keys['KeyA'] ? 1 : 0);
  const wish = new THREE.Vector3(
    -Math.sin(S.yaw) * fwd + Math.cos(S.yaw) * strafe,
    0,
    -Math.cos(S.yaw) * fwd - Math.sin(S.yaw) * strafe,
  );
  const g = slope(_grad);
  const wet = waterDepth();
  if (wet > 0.05 !== wasWet) {
    wasWet = wet > 0.05;
    if (S.onGround) splashSound(0.7); // wading in or out
  }
  speed *= 1 - 0.4 * wet; // water drags
  if (wish.lengthSq() > 0) {
    wish.normalize();
    // uphill is slower, downhill a little faster
    const along = wish.x * g.x + wish.z * g.y;
    speed *= along > 0 ? Math.max(0.55, 1 - along * 0.9) : Math.min(1.2, 1 - along * 0.35);
    wish.multiplyScalar(speed);
  }

  if (S.slideT > 0) {
    // sliding: no steering, momentum bleeds off, hills push you along
    const k = Math.exp(-1.9 * dt);
    vel.x = vel.x * k - g.x * GRAVITY * 0.5 * dt;
    vel.z = vel.z * k - g.y * GRAVITY * 0.5 * dt;
  } else {
    // smooth acceleration (less control in the air)
    const k = S.onGround ? 14 : 3;
    const t = 1 - Math.exp(-k * dt);
    vel.x += (wish.x - vel.x) * t;
    vel.z += (wish.z - vel.z) * t;
  }

  // too steep to stand on: slide down it
  const gm = Math.hypot(g.x, g.y);
  if (S.onGround && gm > MAX_SLOPE) {
    const push = Math.min(1, (gm - MAX_SLOPE) * 2.5);
    vel.x -= (g.x / gm) * GRAVITY * 0.7 * push * dt;
    vel.z -= (g.y / gm) * GRAVITY * 0.7 * push * dt;
    const uphill = (vel.x * g.x + vel.z * g.y) / gm;
    if (uphill > 0) {
      vel.x -= (g.x / gm) * uphill * push;
      vel.z -= (g.y / gm) * uphill * push;
    }
  }

  // ---- jumping: coyote time, jump buffering, variable height ----
  const jumpDown = !!keys['Space'];
  if (jumpDown && !jumpWasDown) S.jumpBuf = JUMP_BUFFER;
  jumpWasDown = jumpDown;
  S.jumpBuf = Math.max(0, S.jumpBuf - dt);
  S.coyote = S.onGround ? COYOTE : Math.max(0, S.coyote - dt);
  if (S.jumpBuf > 0 && S.coyote > 0 && (!S.crouching || S.slideT > 0)) {
    vel.y = JUMP_SPEED * (1 - 0.3 * wet);
    S.onGround = false;
    S.coyote = 0;
    S.jumpBuf = 0;
    S.slideT = 0;
    jumped = true;
    if (S.crouching && !shift) S.crouching = false;
  }
  let gravity = GRAVITY * (vel.y < 0 ? FALL_GRAVITY : 1);
  if (jumped && vel.y > 0 && !jumpDown) gravity *= 2.4; // released early: a short hop
  vel.y -= gravity * dt;

  // ---- vertical move: land on terrain / tops of boxes ----
  const prevY = pos.y;
  const wasGround = S.onGround;
  const fallSpeed = -vel.y;
  pos.y += vel.y * dt;
  S.onGround = false;
  let floorY = world.heightAt(pos.x, pos.z);
  for (const b of world.boxesNear(pos.x, pos.z, PLAYER_RADIUS + 0.8)) {
    const overX = pos.x > b.min.x - PLAYER_RADIUS && pos.x < b.max.x + PLAYER_RADIUS;
    const overZ = pos.z > b.min.z - PLAYER_RADIUS && pos.z < b.max.z + PLAYER_RADIUS;
    if (overX && overZ && prevY >= b.max.y - 0.01 && pos.y <= b.max.y) floorY = Math.max(floorY, b.max.y);
    // head bump
    if (overX && overZ && vel.y > 0 && prevY + S.playerHeight <= b.min.y && pos.y + S.playerHeight > b.min.y) {
      pos.y = b.min.y - S.playerHeight;
      vel.y = 0;
    }
  }
  // while grounded, stick to the surface when walking downhill
  const stick = wasGround && vel.y <= 0 ? 0.3 : 0;
  if (pos.y <= floorY + stick && vel.y <= 0) {
    pos.y = floorY;
    vel.y = 0;
    S.onGround = true;
    jumped = false;
    if (!wasGround) landed(fallSpeed);
  }

  // ---- horizontal move: slide along walls, step up small ledges ----
  pos.x += vel.x * dt;
  pos.z += vel.z * dt;
  for (const b of world.boxesNear(pos.x, pos.z, PLAYER_RADIUS + 0.8)) {
    if (pos.y >= b.max.y - 0.05 || pos.y + S.playerHeight <= b.min.y) continue;
    const minX = b.min.x - PLAYER_RADIUS, maxX = b.max.x + PLAYER_RADIUS;
    const minZ = b.min.z - PLAYER_RADIUS, maxZ = b.max.z + PLAYER_RADIUS;
    if (pos.x <= minX || pos.x >= maxX || pos.z <= minZ || pos.z >= maxZ) continue;
    // a low ledge: step up onto it instead of stopping (the camera eases up, see S.camDy)
    const rise = b.max.y - pos.y;
    if (rise > 0.02 && rise <= STEP_HEIGHT && (S.onGround || wasGround) && vel.y <= 0.5 && roomAbove(b.max.y)) {
      S.camDy -= rise;
      pos.y = b.max.y;
      vel.y = 0;
      S.onGround = true;
      continue;
    }
    const dx = Math.min(pos.x - minX, maxX - pos.x);
    const dz = Math.min(pos.z - minZ, maxZ - pos.z);
    if (dx < dz) {
      pos.x = pos.x - minX < maxX - pos.x ? minX : maxX;
      vel.x = 0;
    } else {
      pos.z = pos.z - minZ < maxZ - pos.z ? minZ : maxZ;
      vel.z = 0;
    }
  }

  // ---- feel: camera offsets settle, footsteps ----
  S.camDy += -S.camDy * (1 - Math.exp(-11 * dt));
  S.landDip += -S.landDip * (1 - Math.exp(-9 * dt));
  const hs = Math.hypot(vel.x, vel.z);
  if (S.onGround && hs > 1.5 && S.slideT <= 0) {
    S.stepPhase += hs * dt * (S.crouching ? 0.45 : 0.6);
    if (S.stepPhase >= 1) {
      S.stepPhase -= 1;
      if (wet > 0.05) splashSound(0.35 + 0.4 * wet);
      else stepSound(S.crouching ? 0.35 : hs > 7.5 ? 1 : 0.7);
    }
  }
}

/** Is there room for the player's body if he stood on a ledge at height y? */
function roomAbove(y: number) {
  for (const b of world.boxesNear(pos.x, pos.z, PLAYER_RADIUS + 0.8)) {
    const overX = pos.x > b.min.x - PLAYER_RADIUS && pos.x < b.max.x + PLAYER_RADIUS;
    const overZ = pos.z > b.min.z - PLAYER_RADIUS && pos.z < b.max.z + PLAYER_RADIUS;
    if (overX && overZ && b.min.y > y + 0.01 && b.min.y < y + S.playerHeight) return false;
  }
  return true;
}

/** Touching down after a fall: camera dip, thud, and damage from a very high drop. */
function landed(impact: number) {
  if (impact < 5) return;
  if (waterDepth() > 0.3) {
    splashSound(Math.min(1, impact / 12)); // soft landing in the pond: no thud, no damage
    S.landDip = Math.min(0.12, impact * 0.008);
    return;
  }
  S.landDip = Math.min(0.28, (impact - 4) * 0.022);
  S.roll += (Math.random() - 0.5) * 0.02;
  landSound(Math.min(1, (impact - 4) / 14));
  if (impact > SAFE_LANDING) damagePlayer(Math.min(70, (impact - SAFE_LANDING) * 5));
}
