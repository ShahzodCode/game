import { weapons } from './core';
import { S, START_CASH } from './state';

// Saved progress (browser localStorage).
// Only the long-term progress is stored: the level the player is on, his money, and his weapons with their ammo.
// (Health, potions, score and the arena itself start fresh every visit.)
// If you change the save shape, bump `v` and handle the old version in loadProgress().
export const SAVE_KEY = 'botshooter.save.v1';
interface SaveData {
  v: 1;
  level: number;
  cash: number;
  weapons: { id: string; owned: boolean; ammo: number; spare: number[] }[];
}
const snapshot = (): SaveData => ({
  v: 1,
  level: S.level,
  cash: Math.round(S.cash),
  weapons: weapons.map((w) => ({ id: w.stats.id, owned: w.owned, ammo: w.ammo, spare: [...w.spare] })),
});
let lastSaved = '';
export function saveProgress() {
  try {
    const s = JSON.stringify(snapshot());
    if (s === lastSaved) return; // nothing changed
    localStorage.setItem(SAVE_KEY, s);
    lastSaved = s;
  } catch {
    /* storage unavailable (private mode / blocked): the game simply doesn't persist */
  }
}
export function clearSave() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* ignore */
  }
  lastSaved = '';
}
/** Restore the saved progress, defensively: bad or outdated data is clamped or ignored, never trusted. */
export function loadProgress() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return;
    const d = JSON.parse(raw) as Partial<SaveData>;
    if (d.v !== 1) return;
    const int = (n: unknown, min: number, max: number, fallback: number) =>
      typeof n === 'number' && Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : fallback;
    S.level = int(d.level, 1, 999, 1);
    S.cash = int(d.cash, 0, 100_000_000, START_CASH);
    for (const sw of Array.isArray(d.weapons) ? d.weapons : []) {
      const w = weapons.find((x) => x.stats.id === sw?.id); // weapons that no longer exist are skipped
      if (!w) continue;
      const s = w.stats;
      w.owned = s.unlockPrice === 0 || !!sw.owned;
      if (!w.owned || s.melee) continue;
      w.ammo = int(sw.ammo, 0, s.magSize, s.magSize);
      if (Array.isArray(sw.spare)) w.spare = sw.spare.slice(0, s.maxMags).map((n) => int(n, 0, s.magSize, 0));
    }
    lastSaved = JSON.stringify(snapshot());
  } catch {
    /* corrupt save: start fresh */
  }
}
/** Save once a second when something changed, and when the page is hidden or closed. */
export function startAutosave() {
  setInterval(saveProgress, 1000); // cheap: it only writes when something changed
  addEventListener('pagehide', saveProgress);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && saveProgress());
}
