import { $, weapons } from './core';
import { MAX_HEALTH, S } from './state';
import { slotWeaponIndex } from './loadout';

export const hudWeapon = $('weapon');
const hudAmmo = $('ammo');
const hudKills = $('kills');
const hudScore = $('scoreValue');
const hudAccuracy = $('accuracy');
const hudCash = $('cash');
const potionsEl = $('potions');
const potionText = $('potionText');
const healthFill = $('healthFill');
const healthText = $('healthText');
const hurtOverlay = $('hurt');
const popup = $('popup');
export const hitmarker = $('hitmarker');
export const resumeHint = $('resumeHint');
export const overlay = $('overlay');
const slotsEl = $('slots');
let slotsHtml = '';
const bannerEl = $('banner');

export const accuracyText = () => (S.shotsFired ? `${Math.round((S.shotsHit / S.shotsFired) * 100)}%` : '--');

/** The loadout strip at the bottom: 1 sidearm, 2 rifle, 3 heavy, 4 knife; the weapon in hand is highlighted. */
function updateSlots() {
  const html = [0, 1, 2, 3]
    .map((n) => {
      const i = slotWeaponIndex(n);
      const name = i >= 0 ? weapons[i].stats.name : 'empty';
      return `<div class="slot${i === S.current ? ' active' : ''}${i < 0 ? ' empty' : ''}"><b>${n + 1}</b>${name}</div>`;
    })
    .join('');
  if (html !== slotsHtml) {
    slotsHtml = html;
    slotsEl.innerHTML = html;
  }
}

export function updateHud() {
  updateSlots();
  const w = weapons[S.current];
  hudWeapon.textContent = w.stats.name;
  hudAmmo.innerHTML = w.stats.melee ? '<small>melee</small>' : w.reloading ? 'Reloading...' : `${w.ammo}<small> / ${w.spare.length} ${w.stats.ammoLabel ?? 'mags'}</small>`;
  hudScore.textContent = `Score ${S.score}`;
  hudCash.textContent = `$${S.cash}`;
  hudKills.textContent = `Kills ${S.kills}` + (S.headshotKills ? ` (${S.headshotKills} headshots)` : '');
  hudAccuracy.textContent = `Accuracy ${accuracyText()}`;
  const hp = Math.max(0, S.health) / MAX_HEALTH;
  healthFill.style.width = `${hp * 100}%`;
  healthFill.style.background = `hsl(${hp * 120}, 70%, 48%)`;
  healthText.textContent = String(Math.ceil(Math.max(0, S.health)));
  potionsEl.style.display = S.potions > 0 ? 'flex' : 'none';
  potionText.innerHTML = `× ${S.potions} <kbd>H</kbd>`;
}

export function showPopup(text: string, color = '#ffd84a') {
  popup.textContent = text;
  popup.style.color = color;
  S.popupTimer = 1;
}

export function showBanner(title: string, sub = '', secs = 3.5) {
  bannerEl.innerHTML = `${title}${sub ? `<small>${sub}</small>` : ''}`;
  bannerEl.style.opacity = '1';
  S.bannerTimer = secs;
}

/** The pause-menu summary line. */
export function updateSummary() {
  const line = S.shotsFired
    ? `Score ${S.score}  ·  Kills ${S.kills}  ·  Headshots ${S.headshotKills}  ·  Accuracy ${accuracyText()}  ·  `
    : '';
  $('summary').textContent = `Level ${S.level}  ·  ${line}Cash $${S.cash}`;
}

/** Per-frame fades: banner, hurt flash (plus a slow pulse while health is low), popup, hit marker. */
export function updateHudTimers(dt: number) {
  S.bannerTimer -= dt;
  if (S.bannerTimer <= 0) bannerEl.style.opacity = '0';

  S.hurtFlash = Math.max(0, S.hurtFlash - dt * 1.6);
  const lowPulse = S.health < 30 && !S.dead ? 0.25 * (0.5 + 0.5 * Math.sin(performance.now() * 0.008)) : 0;
  hurtOverlay.style.opacity = String(Math.min(1, S.hurtFlash * 0.9 + lowPulse));

  S.popupTimer = Math.max(0, S.popupTimer - dt);
  popup.style.opacity = String(Math.min(1, S.popupTimer * 2));
  S.hitTimer = Math.max(0, S.hitTimer - dt);
  hitmarker.style.opacity = S.hitTimer > 0 ? '1' : '0';
}
