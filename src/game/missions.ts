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
  hurt: number; // health the player lost in this level (the Untouchable quest wants 0)
}
export const emptyStats = (): LevelStats => ({ score: 0, kills: 0, headshots: 0, knifeKills: 0, byKind: {}, hurt: 0 });

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
  boss?: boolean; // level 21: the boss fight
  horde?: HordeCfg; // levels 22+: wave after wave of zombies
}

/** Zombie levels 22-30 (30 repeats after that): how many come, how many at once, how fast, which kinds. */
export interface HordeCfg {
  total: number; // zombies to kill (and to spawn)
  cap: number; // alive at the same time
  every: number; // seconds between spawns while below the cap
  mix: [string, number][]; // costume id and spawn weight
}
export const BOSS_LEVEL = 21;
export const LAST_HORDE_LEVEL = 30;
const HORDE_MIX: [string, number][][] = [
  [['zombie', 10]], // 22: only the plain shamblers
  [['zombie', 8], ['zombie_runner', 4]], // 23: + fast little ones
  [['zombie', 7], ['zombie_runner', 4], ['zombie_brute', 2]], // 24: + big slow ones
  [['zombie', 6], ['zombie_runner', 4], ['zombie_brute', 3], ['zombie_stabber', 3]], // 25: + knives
  [['zombie', 5], ['zombie_runner', 4], ['zombie_brute', 3], ['zombie_stabber', 3], ['zombie_thrower', 2]], // 26: + rock throwers
  [['zombie', 5], ['zombie_runner', 4], ['zombie_brute', 3], ['zombie_stabber', 3], ['zombie_thrower', 2], ['zombie_gunner', 2]], // 27: + gunners
  [['zombie', 4], ['zombie_runner', 4], ['zombie_brute', 4], ['zombie_stabber', 4], ['zombie_thrower', 3], ['zombie_gunner', 3]],
  [['zombie', 3], ['zombie_runner', 5], ['zombie_brute', 4], ['zombie_stabber', 4], ['zombie_thrower', 4], ['zombie_gunner', 4]],
  [['zombie', 3], ['zombie_runner', 5], ['zombie_brute', 5], ['zombie_stabber', 5], ['zombie_thrower', 5], ['zombie_gunner', 5]], // 30
];
export function hordeConfig(level: number): HordeCfg {
  const k = Math.min(Math.max(level, BOSS_LEVEL + 1), LAST_HORDE_LEVEL) - (BOSS_LEVEL + 1); // 0..8
  return { total: 40 + k * 12, cap: Math.min(10 + Math.round(k * 2.5), 30), every: 1.1 - k * 0.07, mix: HORDE_MIX[k] };
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
  22: 'THE HORDE. Zombies pour in from everywhere. Keep moving and thin them out.',
  23: 'Runners join the horde: small, very fast and hard to hit.',
  24: 'Brutes: huge and slow, but one blow hurts. Shoot them from afar.',
  25: 'Some zombies now carry knives.',
  26: 'Thrower zombies lob rocks from a distance. Close in on them or break their line.',
  27: 'Gun zombies shoot back. Everything is in the arena now.',
  30: 'The last wave. Survive it, Noah.',
  21: 'THE COLOSSUS. It keeps away and calls zombies: thin them out, then rush it while it pants.',
};

export function levelConfig(level: number): LevelConfig {
  return {
    level,
    boss: level === BOSS_LEVEL,
    horde: level > BOSS_LEVEL ? hordeConfig(level) : undefined,
    wolves: level > MAX_LEVEL || level < 3 ? 0 : Math.min(2 + Math.floor((level - 3) / 3), 6),
    allowed: (c) => level >= (c.minLevel ?? 1),
    note: INTRO_NOTES[level] ?? (level > BOSS_LEVEL ? 'The horde grows. More of them, and worse kinds.' : level === MAX_LEVEL ? 'The last normal level. The boss waits after it.' : 'The arena is getting more dangerous.'),
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
  if (cfg.horde) return hordeMissions(cfg);
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

/** Horde levels: three missions, all three needed (the horde itself, a specialty, a score). */
function hordeMissions(cfg: LevelConfig): Mission[] {
  const h = cfg.horde!;
  const k = Math.min(cfg.level, LAST_HORDE_LEVEL) - (BOSS_LEVEL + 1);
  const f = 1 + 0.12 * k;
  const zombieKills = (s: LevelStats) => Object.entries(s.byKind).reduce((n, [id, v]) => n + (id.startsWith('zombie') ? v : 0), 0);
  const m1 = mission('horde', `Destroy the horde: kill ${h.total} zombies`, h.total, 3000 * f, zombieKills);
  // a specialty of the level: the newest kind, or headshots on the first horde level
  const kinds = h.mix.map(([id]) => id).filter((id) => id !== 'zombie');
  let m2: Mission;
  if (kinds.length === 0) m2 = mission('horde-head', 'Get 15 headshot kills', 15, 2000 * f, (s) => s.headshots);
  else {
    const id = kinds[kinds.length - 1];
    const share = (h.mix.find(([x]) => x === id)![1] / h.mix.reduce((n, [, w]) => n + w, 0)) * h.total;
    const n = Math.max(2, Math.floor(share * 0.5));
    m2 = mission(`horde-${id}`, `Kill ${n} ${COSTUMES.find((c) => c.id === id)?.name ?? id}s`, n, 2200 * f, (s) => s.byKind[id] ?? 0);
  }
  const target = round50(h.total * 38);
  const m3 = mission('horde-score', `Earn ${target} points`, target, 2500 * f, (s) => s.score);
  return [m1, m2, m3];
}
