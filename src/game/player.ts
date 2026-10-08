import * as THREE from 'three';
import { stopRifleLoop, stopReloadSound, hurtSound, potionSound } from '../audio/audio';
import { POTION } from '../shop/shopItems';
import { pos, vel, weapons, world } from './core';
import { showPopup } from './hud';
import {
  CROUCH_HEIGHT, CROUCH_LERP, CROUCH_SPEED, GRAVITY, JUMP_SPEED, MAX_HEALTH, PLAYER_RADIUS, S, SPRINT_SPEED,
  STAND_HEIGHT, WALK_SPEED, keys,
} from './state';

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
  for (const b of world.boxes) {
    const overX = pos.x > b.min.x - PLAYER_RADIUS && pos.x < b.max.x + PLAYER_RADIUS;
    const overZ = pos.z > b.min.z - PLAYER_RADIUS && pos.z < b.max.z + PLAYER_RADIUS;
    if (overX && overZ && b.min.y >= pos.y + CROUCH_HEIGHT - 0.01 && b.min.y < pos.y + STAND_HEIGHT) return false;
  }
  return true;
}

export function movePlayer(dt: number) {
  const w = weapons[S.current].stats;

  // crouch (hold Shift): lower the player; only stand up again if there is room
  const wantCrouch = !!(keys['ShiftLeft'] || keys['ShiftRight']);
  if (wantCrouch) S.crouching = true;
  else if (S.crouching && canStand()) S.crouching = false;
  const targetH = S.crouching ? CROUCH_HEIGHT : STAND_HEIGHT;
  S.playerHeight += (targetH - S.playerHeight) * (1 - Math.exp(-CROUCH_LERP * dt));
  if (Math.abs(S.playerHeight - targetH) < 0.002) S.playerHeight = targetH;

  const running = (keys['ControlLeft'] || keys['ControlRight']) && !S.crouching;
  const base = S.crouching ? CROUCH_SPEED : running ? SPRINT_SPEED : WALK_SPEED;
  const speed = base * w.moveSpeedMultiplier;

  const fwd = (keys['KeyW'] ? 1 : 0) - (keys['KeyS'] ? 1 : 0);
  const strafe = (keys['KeyD'] ? 1 : 0) - (keys['KeyA'] ? 1 : 0);
  const wish = new THREE.Vector3(
    -Math.sin(S.yaw) * fwd + Math.cos(S.yaw) * strafe,
    0,
    -Math.cos(S.yaw) * fwd - Math.sin(S.yaw) * strafe,
  );
  if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(speed);

  // smooth acceleration (less control in the air)
  const k = S.onGround ? 14 : 3;
  const t = 1 - Math.exp(-k * dt);
  vel.x += (wish.x - vel.x) * t;
  vel.z += (wish.z - vel.z) * t;

  if (keys['Space'] && S.onGround && !S.crouching) {
    vel.y = JUMP_SPEED;
    S.onGround = false;
  }
  vel.y -= GRAVITY * dt;

  // vertical move + landing on terrain / tops of boxes
  const prevY = pos.y;
  const wasGround = S.onGround;
  pos.y += vel.y * dt;
  S.onGround = false;
  let floorY = world.heightAt(pos.x, pos.z);
  for (const b of world.boxes) {
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
  }

  // horizontal move, pushing out of box sides
  pos.x += vel.x * dt;
  pos.z += vel.z * dt;
  for (const b of world.boxes) {
    if (pos.y >= b.max.y - 0.05 || pos.y + S.playerHeight <= b.min.y) continue;
    const minX = b.min.x - PLAYER_RADIUS, maxX = b.max.x + PLAYER_RADIUS;
    const minZ = b.min.z - PLAYER_RADIUS, maxZ = b.max.z + PLAYER_RADIUS;
    if (pos.x <= minX || pos.x >= maxX || pos.z <= minZ || pos.z >= maxZ) continue;
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
}
