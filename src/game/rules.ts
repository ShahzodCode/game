import { COSTUMES } from '../entities/mannequin';
import { WOLF_INFO } from '../entities/wolf';
import { WEAPONS } from '../weapons/weapons';
import { $ } from './core';
import { overlay } from './hud';
import { SLOTS, SLOT_NAMES, SLOT_OPTIONS } from './loadout';

// Rules window (tables are generated from the real game data).
const WEAPON_NOTES: Record<string, string> = {
  pistol: 'Accurate, light recoil',
  rifle: 'Fast; recoil builds as you hold fire',
  shotgun: '8 pellets: deadly close, weak far away',
  smg: 'Fast and light: best on the move and up close, loses punch at range',
  sniper: 'Aim (right mouse) for a scope and a perfect shot that pierces 2 targets; wild from the hip',
  crossbow: 'Silent: nobody panics. Bolts drop over distance, one bolt per reload',
  launcher: 'Bouncing grenades, big blast and knockback (hurts you too), 3 per drum',
  knife: `Melee, ${WEAPONS.find((w) => w.id === 'knife')?.range} m reach, silent`,
};
const slotLabel = (id: string) => {
  const slot = SLOTS.find((k) => SLOT_OPTIONS[k].includes(id));
  return slot ? SLOT_NAMES[slot] : 'MELEE';
};
$('weaponTable').innerHTML =
  '<tr><th>Weapon</th><th>Damage</th><th>Magazine</th><th>Mag price</th><th>Unlock</th><th>Notes</th></tr>' +
  WEAPONS.map((s) => {
    const dmg = s.pellets > 1 ? `${s.damage} × ${s.pellets}` : `${s.damage}`;
    const unlock = s.unlockPrice ? `<b class="gold">$${s.unlockPrice}</b> at the weapon shop` : 'owned';
    const mag = s.melee ? '—' : `${s.magSize}`;
    const price = s.melee ? '—' : `$${s.magPrice}`;
    return `<tr><td>${slotLabel(s.id)} · ${s.name}</td><td>${dmg}</td><td>${mag}</td><td>${price}</td><td>${unlock}</td><td>${WEAPON_NOTES[s.id] ?? ''}</td></tr>`;
  }).join('');
$('botTable').innerHTML =
  '<tr><th>Target</th><th>Points</th><th>Health</th><th>Behaviour</th></tr>' +
  [
    ...COSTUMES.map((c) => ({ name: c.name, points: c.points, health: c.health, note: c.note })),
    { name: WOLF_INFO.name, points: WOLF_INFO.points, health: WOLF_INFO.health, note: 'Calm until shot, then hunts and bites' },
  ]
    .sort((a, b) => a.points - b.points)
    .map((c) => `<tr><td>${c.name}</td><td><b class="gold">${c.points}</b></td><td>${c.health}</td><td>${c.note}</td></tr>`)
    .join('');

export const rules = $('rules');
export function closeRules() {
  rules.style.display = 'none';
  overlay.style.display = 'flex';
}
$('btnRules').addEventListener('click', () => {
  overlay.style.display = 'none';
  rules.style.display = 'flex';
});
$('btnBack').addEventListener('click', closeRules);
