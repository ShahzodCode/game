import { POTION } from '../shop/shopItems';
import { weapons } from './core';
import { S } from './state';

// Ammo and potions are only really spent when a level is survived.
// A checkpoint is taken when a level starts (and whenever the player is outside a level, so shop purchases count).
// Dying (or reloading the map) puts the checkpoint back: a retry never starts with an empty gun.
// The save file stores the checkpoint too, so reloading the page mid-level behaves like dying.

interface Checkpoint {
  weapons: { owned: boolean; ammo: number; spare: number[] }[];
  potions: number;
}
let checkpoint: Checkpoint | null = null;

/** True from the moment the doors seal until the level has been left: spending in here is provisional. */
export function inLevel() {
  return S.phase === 'loading' || S.phase === 'airlockReady' || S.phase === 'arena' || S.phase === 'exitOpen';
}

/** What is spent in the current level counts from now on (called when a level starts, and outside levels). */
export function commitStock() {
  checkpoint = { weapons: weapons.map((w) => ({ owned: w.owned, ammo: w.ammo, spare: [...w.spare] })), potions: S.potions };
}

/** Back to the stock the level started with. */
export function restoreStock() {
  if (!checkpoint) return;
  weapons.forEach((w, i) => {
    const c = checkpoint!.weapons[i];
    if (!c || (w.owned && !c.owned)) return; // a weapon unlocked during the level (quest reward) keeps its fresh ammo
    w.ammo = c.ammo;
    w.spare = [...c.spare];
  });
  S.potions = checkpoint.potions;
}

/** The stock to write into the save: the checkpoint inside a level, the live values otherwise. */
export function stockForSave() {
  if (inLevel() && checkpoint) return checkpoint;
  return { weapons: weapons.map((w) => ({ owned: w.owned, ammo: w.ammo, spare: [...w.spare] })), potions: S.potions };
}

export const clampPotions = (n: unknown) =>
  typeof n === 'number' && Number.isFinite(n) ? Math.min(POTION.max, Math.max(0, Math.floor(n))) : 0;
