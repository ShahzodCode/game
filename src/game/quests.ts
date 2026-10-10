import { weapons } from './core';
import { sanitizeLoadout } from './loadout';
import { showBanner } from './hud';
import { missionSound } from '../audio/audio';
import { S } from './state';

/**
 * GLOBAL QUESTS: long-term goals that run across levels (and across visits: they are saved). They are much bigger than the
 * level missions, so each one takes several levels. They are read at the quest board in the safe room. A finished quest pays
 * cash at once and some of them unlock a weapon (the katana, for instance, for killing 15 ninjas).
 */
export type QuestStat =
  | { kind: 'kills'; id: string } // kills of one character ('wolf', 'ninja', ... or 'zombie' = every zombie type)
  | { kind: 'headshots' }
  | { kind: 'melee' } // kills with the knife / katana
  | { kind: 'level' }; // levels completed (the highest level finished)

export interface QuestDef {
  id: string;
  title: string;
  text: string;
  target: number;
  stat: QuestStat;
  cash: number;
  weapon?: string; // weapon id unlocked as a reward
}

export const QUESTS: QuestDef[] = [
  { id: 'ninjas', title: 'Blade of the Night', text: 'Kill 15 ninjas', target: 15, stat: { kind: 'kills', id: 'ninja' }, cash: 4000, weapon: 'katana' },
  { id: 'wolves', title: 'Pack Breaker', text: 'Kill 30 wolves', target: 30, stat: { kind: 'kills', id: 'wolf' }, cash: 3000 },
  { id: 'criminals', title: 'Street Cleaner', text: 'Kill 25 criminals', target: 25, stat: { kind: 'kills', id: 'criminal' }, cash: 2500 },
  { id: 'cowboys', title: "Gunslinger's Debt", text: 'Kill 20 cowboys', target: 20, stat: { kind: 'kills', id: 'cowboy' }, cash: 2500 },
  { id: 'veteran', title: 'Veteran', text: 'Finish level 10', target: 10, stat: { kind: 'level' }, cash: 1500, weapon: 'smg' },
  { id: 'soldiers', title: 'Iron Wall', text: 'Kill 12 soldiers', target: 12, stat: { kind: 'kills', id: 'soldier' }, cash: 3500 },
  { id: 'heads', title: 'Crack Shot', text: 'Get 80 headshot kills', target: 80, stat: { kind: 'headshots' }, cash: 1500, weapon: 'sniper' },
  { id: 'melee', title: 'Silent Hunter', text: 'Kill 40 with a blade', target: 40, stat: { kind: 'melee' }, cash: 2000, weapon: 'crossbow' },
  { id: 'supermen', title: 'Giant Killer', text: 'Kill 6 Supermen', target: 6, stat: { kind: 'kills', id: 'superman' }, cash: 4000 },
  { id: 'twenty', title: 'The Long Road', text: 'Finish level 20', target: 20, stat: { kind: 'level' }, cash: 6000 },
  { id: 'colossus', title: 'Colossus Slayer', text: 'Defeat the Colossus', target: 1, stat: { kind: 'kills', id: 'boss' }, cash: 10000, weapon: 'launcher' },
  { id: 'horde', title: 'Plague Doctor', text: 'Kill 200 zombies', target: 200, stat: { kind: 'kills', id: 'zombie' }, cash: 12000 },
  { id: 'last', title: 'The Last Human', text: 'Finish level 30', target: 30, stat: { kind: 'level' }, cash: 30000 },
];

const progressOf = (q: QuestDef) => Math.min(q.target, S.quests.progress[progressKey(q.stat)] ?? 0);
export const progressKey = (s: QuestStat) => (s.kind === 'kills' ? `kills:${s.id}` : s.kind);
export const questDone = (q: QuestDef) => S.quests.done.includes(q.id);

function complete(q: QuestDef) {
  S.quests.done.push(q.id);
  S.cash += q.cash;
  let extra = '';
  if (q.weapon) {
    const w = weapons.find((x) => x.stats.id === q.weapon);
    if (w && !w.owned) {
      w.unlock();
      extra = ` · ${w.stats.name} unlocked`;
    }
    sanitizeLoadout();
  }
  missionSound(true);
  showBanner('QUEST COMPLETE', `${q.title} · +$${q.cash}${extra}${q.weapon ? ' (equip it at the armory)' : ''}`, 6);
}

function bump(key: string, n = 1, absolute = false) {
  S.quests.progress[key] = absolute ? Math.max(S.quests.progress[key] ?? 0, n) : (S.quests.progress[key] ?? 0) + n;
  for (const q of QUESTS) if (!questDone(q) && progressKey(q.stat) === key && progressOf(q) >= q.target) complete(q);
}

/** The player killed something (`kind` = costume id, 'wolf'...). */
export function questKill(kind: string, head: boolean, melee: boolean) {
  bump(`kills:${kind}`);
  if (kind.startsWith('zombie')) bump('kills:zombie');
  if (head) bump('headshots');
  if (melee) bump('melee');
}
/** A level was finished. */
export function questLevelDone(level: number) {
  bump('level', level, true);
}

/** The quest board window. */
export function questsHtml() {
  const rows = QUESTS.map((q) => {
    const done = questDone(q);
    const p = progressOf(q);
    const pct = Math.round((p / q.target) * 100);
    const reward = `$${q.cash}` + (q.weapon ? ` + ${weapons.find((w) => w.stats.id === q.weapon)?.stats.name ?? q.weapon}` : '');
    return (
      `<div class="quest${done ? ' done' : ''}"><div class="qt"><b>${q.title}</b><span>${q.text}</span></div>` +
      `<div class="qp">${done ? '✓ DONE' : `${p} / ${q.target}`}<i><u style="width:${done ? 100 : pct}%"></u></i></div><div class="qr">${reward}</div></div>`
    );
  }).join('');
  const open = QUESTS.filter((q) => !questDone(q)).length;
  return `<h3>QUEST BOARD</h3><div class="cashline">${open} quests open · each takes several levels and pays far more than a mission</div><div class="quests">${rows}</div><div class="foot">Progress counts everywhere in the arena · E to close</div>`;
}

export function questsToSave() {
  return { progress: { ...S.quests.progress }, done: [...S.quests.done] };
}
export function questsFromSave(d: unknown) {
  const o = d as { progress?: Record<string, unknown>; done?: unknown } | undefined;
  S.quests.progress = {};
  S.quests.done = [];
  if (!o || typeof o !== 'object') return;
  for (const [k, v] of Object.entries(o.progress ?? {})) if (typeof v === 'number' && Number.isFinite(v)) S.quests.progress[k] = Math.max(0, Math.floor(v));
  if (Array.isArray(o.done)) S.quests.done = o.done.filter((id): id is string => typeof id === 'string' && QUESTS.some((q) => q.id === id));
}
export function resetQuests() {
  S.quests.progress = {};
  S.quests.done = [];
}
