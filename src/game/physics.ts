import { pos } from './core';
import { mannequins, wolves } from './actors';
import { S } from './state';

const BODY_R = 0.38; // bot / wolf collision radius
const PLAYER_R = 0.4;

/**
 * Characters are solid: the player cannot walk through a bot or a wolf, and shoves them a little when pushing
 * into them (the player gives way a bit more than they do, so a charging criminal does not get stuck in you).
 */
export function collideWithBots() {
  const minD = BODY_R + PLAYER_R;
  for (const t of [...mannequins, ...wolves]) {
    if (!t.alive) continue;
    const gp = t.group.position;
    const dy = pos.y - gp.y;
    if (dy > 1.75 || dy < -S.playerHeight) continue; // above or below it
    const dx = pos.x - gp.x, dz = pos.z - gp.z;
    const d = Math.hypot(dx, dz);
    if (d >= minD || d < 1e-4) continue;
    const overlap = minD - d;
    const nx = dx / d, nz = dz / d;
    pos.x += nx * overlap * 0.7;
    pos.z += nz * overlap * 0.7;
    gp.x -= nx * overlap * 0.3;
    gp.z -= nz * overlap * 0.3;
  }
}
