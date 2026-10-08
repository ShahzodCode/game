import { weapons } from './core';
import { S } from './state';

// Loadout: the player carries ONE weapon per slot into the arena (plus the knife), chosen at the armory terminal in
// the safe room. Slot keys: 1 sidearm, 2 rifle class, 3 heavy, 4 knife.

export type Slot = 'side' | 'rifle' | 'heavy';
export const SLOTS: Slot[] = ['side', 'rifle', 'heavy'];
export const SLOT_NAMES: Record<Slot, string> = { side: 'SIDEARM', rifle: 'RIFLE', heavy: 'HEAVY' };
/** Which weapons may go in each slot. */
export const SLOT_OPTIONS: Record<Slot, string[]> = {
  side: ['pistol', 'smg'],
  rifle: ['rifle', 'sniper', 'crossbow'],
  heavy: ['shotgun', 'launcher'],
};

const weaponIndex = (id: string) => weapons.findIndex((w) => w.stats.id === id);
const owned = (id: string) => !!weapons[weaponIndex(id)]?.owned;

/** Index into `weapons` for a slot key (0 sidearm, 1 rifle, 2 heavy, 3 knife); -1 if the slot is empty. */
export function slotWeaponIndex(n: number): number {
  if (n === 3) return weaponIndex('knife');
  const id = S.loadout[SLOTS[n]];
  return id ? weaponIndex(id) : -1;
}

/** Is this weapon (by index) in the current loadout? The knife always is. */
export function isEquipped(i: number): boolean {
  const id = weapons[i]?.stats.id;
  if (!id) return false;
  return id === 'knife' || S.loadout.side === id || S.loadout.rifle === id || S.loadout.heavy === id;
}

/** Weapon indices in the loadout, in key order (1, 2, 3, 4). */
export function equippedIndices(): number[] {
  return [0, 1, 2, 3].map(slotWeaponIndex).filter((i) => i >= 0);
}

/** Make the loadout valid: only owned weapons, in the right slots (used after loading a save / buying). */
export function sanitizeLoadout() {
  for (const slot of SLOTS) {
    const cur = S.loadout[slot];
    if (cur && SLOT_OPTIONS[slot].includes(cur) && owned(cur)) continue;
    S.loadout[slot] = SLOT_OPTIONS[slot].find(owned) ?? null;
  }
  refreshArmoryScreen();
}

/** Put the next owned option of a slot into the loadout. Returns the new weapon's name, or null if there is no other choice. */
export function cycleSlot(slot: Slot): string | null {
  const options = SLOT_OPTIONS[slot].filter(owned);
  if (options.length === 0) return null;
  const at = options.indexOf(S.loadout[slot] ?? '');
  const next = options[(at + 1) % options.length];
  if (next === S.loadout[slot] && options.length === 1) return null;
  S.loadout[slot] = next;
  refreshArmoryScreen();
  return weapons[weaponIndex(next)].stats.name;
}

/** Hook set by world setup: redraws the terminal's screen. */
let screen: ((lines: string[]) => void) | null = null;
export function bindArmoryScreen(fn: (lines: string[]) => void) {
  screen = fn;
  refreshArmoryScreen();
}
export function refreshArmoryScreen() {
  if (!screen) return;
  screen(
    SLOTS.map((s) => {
      const id = S.loadout[s];
      const w = id ? weapons[weaponIndex(id)] : null;
      return `${SLOT_NAMES[s]}: ${w ? w.stats.name : 'EMPTY'}`;
    }),
  );
}
