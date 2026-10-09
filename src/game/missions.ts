import { COSTUMES, type Costume } from '../entities/mannequin';

/**
 * Levels and missions.
 *
 * Every level offers FIVE missions of rising difficulty; the first is always a score target.
 * Completing THREE finishes the level (the exit light appears); the other two are optional bonuses.
 * Money comes ONLY from missions (shots and kills just give score).
 */
export const MISSIONS_TO_FINISH = 3;
export const MISSIONS_PER_LEVEL = 5;

/** What the player has achieved so far in the current level. */
export interface LevelStats {
  score: number;
  kills: number;
  headshots: number; // headshot kills
  knifeKills: number;
  byKind: Record<string, number>; // kills per costume id, plus 'wolf'
}
export const emptyStats = (): LevelStats => ({ score: 0, kills: 0, headshots: 0, knifeKills: 0, byKind: {} });

export interface Mission {
  key: string; // unique within a level (avoids duplicates)
  title: string;
  target: number;
  reward: number; // money paid on completion
  measure: (s: LevelStats) => number;
  progress: number;
  done: boolean;
}

export interface LevelConfig {
  level: number;
  wolves: number; // how many wolves live in the arena
  allowed: (c: Costume) => boolean; // which characters can spawn
  note: string; // shown on the level banner
  boss?: boolean; // level 21+: the boss fight
}

/**
 * Difficulty curve (levels 1-25). New characters are introduced one at a time so nothing nasty shows up early:
 * 1-2 harmless crowds, 3 wolves, 4 criminals, 5 cowboys, 7 soldiers, 10 Superman, 15 ninjas (COSTUMES.minLevel).
 */
export const MAX_LEVEL = 20; // the last ordinary level; level 21 is the boss
export const INTRO_NOTES: Record<number, string> = {
  1: 'A quiet arena: harmless crowds. Take your time.',
  2: 'Still peaceful, but the crowds are bigger.',
  3: 'Wolves have arrived. Shoot one and the pack comes for you.',
  4: 'Criminals now patrol the walls. They carry knives.',
  5: 'Cowboys have arrived: they shoot back when shot.',
  7: 'Soldiers: very tough, they never run away.',
  10: 'Superman is here. A punch hurts a lot, but he is slow to recover.',
  14: 'Ninjas have appeared. Watch your back.',
  21: 'THE COLOSSUS. It keeps away and calls zombies: thin them out, then rush it while it pants.',
};

export function levelConfig(level: number): LevelConfig {
  return {
    level,
    boss: level > MAX_LEVEL,
    wolves: level > MAX_LEVEL || level < 3 ? 0 : Math.min(2 + Math.floor((level - 3) / 3), 6),
    allowed: (c) => level >= (c.minLevel ?? 1),
    note: INTRO_NOTES[level] ?? (level === MAX_LEVEL ? 'The last normal level. The boss waits after it.' : 'The arena is getting more dangerous.'),
  };
}

function pickOne<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}
const round10 = (n: number) => Math.round(n / 10) * 10;
const round50 = (n: number) => Math.round(n / 50) * 50;
const nameOf = (id: string) => (id === 'wolf' ? 'Wolf' : COSTUMES.find((c) => c.id === id)?.name ?? id);
const plural = (name: string, n: number) => (n === 1 ? name : name === 'Wolf' ? 'Wolves' : `${name}s`);

function mission(key: string, title: string, target: number, reward: number, measure: (s: LevelStats) => number): Mission {
  return { key, title, target, reward: round10(reward), measure, progress: 0, done: false };
}
const killsOf = (id: string, n: number, reward: number) =>
  mission(`kill:${id}`, `Kill ${n} ${plural(nameOf(id), n)}`, n, reward, (s) => s.byKind[id] ?? 0);

/** Builds the five missions for a level, easiest first. Targets grow slowly (level 20 is about 3.3x level 1). */
export function generateMissions(cfg: LevelConfig): Mission[] {
  if (cfg.boss) return [mission('boss', 'Defeat the Colossus', 1, 15000, (s) => s.byKind['boss'] ?? 0)];
  const L = Math.min(cfg.level, MAX_LEVEL);
  const sc = 1 + 0.12 * (L - 1); // how big the targets are
  const f = 1 + 0.18 * (L - 1); // how well the missions pay
  const has = (id: string) => COSTUMES.some((c) => c.id === id && cfg.allowed(c));
  const used = new Set<string>();
  const take = (pool: (() => Mission)[]): Mission => {
    const options = pool.map((p) => p()).filter((m) => !used.has(m.key));
    const m = pickOne(options.length ? options : pool.map((p) => p()));
    used.add(m.key);
    return m;
  };

  // 1: always a score target (easy at first)
  const m1 = mission('score', `Earn ${round50(300 * sc)} points`, round50(300 * sc), 250 * f, (s) => s.score);
  used.add(m1.key);
  // 2: a number of kills
  const n2 = Math.round(4 * sc);
  const m2 = mission('kills', `Eliminate ${n2} characters`, n2, 350 * f, (s) => s.kills);
  used.add(m2.key);

  // 3: a common character, or headshots
  const common = ['regular', 'winter', 'builder', 'sporty', 'chef', 'rich'];
  const m3 = take([
    () => killsOf(pickOne(common), Math.round(2 * sc), 500 * f),
    () => mission('head', `Get ${Math.round(2 * sc) + 1} headshot kills`, Math.round(2 * sc) + 1, 500 * f, (s) => s.headshots),
  ]);

  // 4: something specific and harder (only characters that exist on this level)
  const pool4: (() => Mission)[] = [
    () => mission('knife', `Kill ${1 + Math.ceil(L / 3)} with the knife`, 1 + Math.ceil(L / 3), 750 * f, (s) => s.knifeKills),
    () => mission('head', `Get ${3 + Math.round(L * 0.6)} headshot kills`, 3 + Math.round(L * 0.6), 750 * f, (s) => s.headshots),
  ];
  if (has('cowboy')) pool4.push(() => killsOf('cowboy', Math.min(1 + Math.floor(L / 6), 4), 750 * f));
  if (cfg.wolves > 0) pool4.push(() => killsOf('wolf', Math.min(1 + Math.floor((L - 3) / 4), cfg.wolves), 800 * f));
  if (has('criminal')) pool4.push(() => killsOf('criminal', Math.min(1 + Math.floor((L - 4) / 4), 4), 800 * f));
  const m4 = take(pool4);

  // 5: the hardest
  const pool5: (() => Mission)[] = [() => mission('score2', `Earn ${round50(1000 * sc)} points`, round50(1000 * sc), 1100 * f, (s) => s.score)];
  if (has('soldier')) pool5.push(() => killsOf('soldier', Math.min(1 + Math.floor((L - 7) / 5), 4), 1100 * f));
  if (has('superman')) pool5.push(() => killsOf('superman', Math.min(1 + Math.floor((L - 10) / 8), 3), 1100 * f));
  if (has('ninja')) pool5.push(() => killsOf('ninja', Math.min(1 + Math.floor((L - 15) / 4), 4), 1200 * f));
  if (cfg.wolves > 0) pool5.push(() => killsOf('wolf', Math.min(1 + Math.floor(L / 4), cfg.wolves), 1200 * f));
  const m5 = take(pool5);

  return [m1, m2, m3, m4, m5];
}
