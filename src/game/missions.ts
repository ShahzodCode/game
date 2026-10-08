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
}

export function levelConfig(level: number): LevelConfig {
  return {
    level,
    // level 1 is the gentle introduction: no criminals, no wolves. Characters appear from their own minLevel
    // (criminals from level 2, ninjas from level 7, see COSTUMES).
    wolves: level <= 1 ? 0 : Math.min(level + 1, 6),
    allowed: (c) => level >= (c.minLevel ?? 1),
    note: level <= 1 ? 'A quiet arena: harmless crowds, a few surprises.' : level === 2 ? 'Criminals and wolves have arrived.' : level === 7 ? 'Ninjas have appeared. Watch your back.' : 'The arena is getting more dangerous.',
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

/** Builds the five missions for a level, easiest first. */
export function generateMissions(cfg: LevelConfig): Mission[] {
  const L = cfg.level;
  const f = 1 + 0.4 * (L - 1); // difficulty / reward scale
  const has = (id: string) => COSTUMES.some((c) => c.id === id && cfg.allowed(c));
  const used = new Set<string>();
  const take = (pool: (() => Mission)[]): Mission => {
    const options = pool.map((p) => p()).filter((m) => !used.has(m.key));
    const m = pickOne(options.length ? options : pool.map((p) => p()));
    used.add(m.key);
    return m;
  };

  // 1: always a score target
  const m1 = mission('score', `Earn ${round50(450 * f)} points`, round50(450 * f), 250 * f, (s) => s.score);
  used.add(m1.key);
  // 2: a number of kills
  const n2 = Math.round(7 * f);
  const m2 = mission('kills', `Eliminate ${n2} characters`, n2, 350 * f, (s) => s.kills);
  used.add(m2.key);

  // 3: a common character, or headshots
  const common = ['regular', 'winter', 'builder', 'sporty', 'chef', 'rich'];
  const m3 = take([
    () => killsOf(pickOne(common), Math.round(3 * f), 500 * f),
    () => mission('head', `Get ${Math.round(3 * f) + 1} headshot kills`, Math.round(3 * f) + 1, 500 * f, (s) => s.headshots),
  ]);

  // 4: something specific and harder
  const pool4: (() => Mission)[] = [
    () => mission('knife', `Kill ${2 + L} with the knife`, 2 + L, 750 * f, (s) => s.knifeKills),
    () => killsOf('cowboy', 2 + Math.floor(L / 2), 750 * f),
    () => mission('head', `Get ${5 + 2 * L} headshot kills`, 5 + 2 * L, 750 * f, (s) => s.headshots),
  ];
  if (cfg.wolves > 0) pool4.push(() => killsOf('wolf', Math.min(1 + Math.floor(L / 2), cfg.wolves), 800 * f));
  if (has('criminal')) pool4.push(() => killsOf('criminal', 2 + Math.floor(L / 2), 800 * f));
  const m4 = take(pool4);

  // 5: the hardest
  const pool5: (() => Mission)[] = [
    () => killsOf('superman', 1 + Math.floor(L / 3), 1100 * f),
    () => killsOf('soldier', 2 + Math.floor(L / 2), 1100 * f),
    () => mission('score2', `Earn ${round50(1500 * f)} points`, round50(1500 * f), 1100 * f, (s) => s.score),
  ];
  if (has('ninja')) pool5.push(() => killsOf('ninja', 1 + Math.floor(L / 2), 1200 * f));
  if (cfg.wolves > 0) pool5.push(() => killsOf('wolf', Math.min(2 + L, cfg.wolves), 1200 * f));
  const m5 = take(pool5);

  return [m1, m2, m3, m4, m5];
}
