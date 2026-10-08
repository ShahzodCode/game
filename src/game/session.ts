import { stopRifleLoop, stopReloadSound } from '../audio/audio';
import { START, pos, vel, weapons } from './core';
import { switchWeapon } from './combat';
import { resetFlow } from './flow';
import { clearProjectiles } from './projectiles';
import { MAX_HEALTH, S, STAND_HEIGHT, START_CASH } from './state';

/**
 * Back to the safe room: fresh arena, score cleared. The saved progress (level, money, weapons, ammo) is KEPT,
 * unless `fresh` is true: then it is a brand-new game (level 1, starting money and weapons).
 */
export function resetGame(fresh = false) {
  S.kills = S.headshotKills = S.score = S.shotsFired = S.shotsHit = 0;
  if (fresh) {
    S.cash = START_CASH;
    S.level = 1;
    for (const w of weapons) w.refill();
  }
  stopRifleLoop();
  stopReloadSound();
  if (S.current !== 0) switchWeapon(0);
  weapons.forEach((w) => ((w.cooldown = 0), (w.bloom = 0), (w.burst = 0), (w.reloadLeft = 0)));
  S.equipLeft = 0;
  S.aiming = false;
  S.adsK = 0;
  S.slideT = S.slideCd = S.coyote = S.jumpBuf = S.camDy = S.landDip = S.shake = 0;
  clearProjectiles();
  S.recoilOffset = 0;
  S.roll = 0;
  pos.copy(START);
  vel.set(0, 0, 0);
  S.pitch = 0;
  S.crouching = false;
  S.playerHeight = STAND_HEIGHT;
  S.onGround = true;
  S.yaw = 0; // facing the airlock gate
  resetFlow(); // safe room, doors reset, fresh arena
  S.health = MAX_HEALTH;
  S.potions = 0;
  S.hurtFlash = 0;
  S.dead = false;
  S.popupTimer = 0;
}
