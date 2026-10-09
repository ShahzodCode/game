import { $, weapons } from './core';
import { MAX_HEALTH, S } from './state';
import { slotWeaponIndex } from './loadout';

// HUD elements. The DOM is only touched when a value really changed (setting innerHTML / styles every frame
// forces the browser to re-layout every frame).

export const hudWeapon = $('weapon');
const hudBox = $('hud');
const hudAmmo = $('ammo');
const reloadFill = $('reloadFill');
const hudKills = $('kills');
const hudScore = $('scoreValue');
const hudAccuracy = $('accuracy');
const hudCash = $('cash');
const potionsEl = $('potions');
const potionText = $('potionText');
const healthBox = $('health');
const healthFill = $('healthFill');
const healthText = $('healthText');
const hurtOverlay = $('hurt');
const popup = $('popup');
export const hitmarker = $('hitmarker');
export const resumeHint = $('resumeHint');
export const overlay = $('overlay');
const slotsEl = $('slots');
const bannerEl = $('banner');
const crosshair = $('crosshair');

const last = new Map<string, string>();
/** Run `apply` only if `value` differs from what this key last got. */
function changed(key: string, value: string) {
  if (last.get(key) === value) return false;
  last.set(key, value);
  return true;
}
const setText = (el: HTMLElement, key: string, v: string) => changed(key, v) && (el.textContent = v);
const setHtml = (el: HTMLElement, key: string, v: string) => changed(key, v) && (el.innerHTML = v);
const setStyle = (el: HTMLElement, key: string, prop: 'opacity' | 'width' | 'background' | 'display', v: string) => changed(key, v) && (el.style[prop] = v);

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
  setHtml(slotsEl, 'slots', html);
}

export function updateHud() {
  updateSlots();
  const w = weapons[S.current];
  const st = w.stats;
  setText(hudWeapon, 'weapon', st.name);
  const low = !st.melee && !w.reloading && w.ammo / st.magSize <= 0.25;
  if (changed('hudclass', `${low}|${w.reloading}`)) {
    hudBox.classList.toggle('low', low);
    hudBox.classList.toggle('reloading', w.reloading);
  }
  setHtml(
    hudAmmo,
    'ammo',
    st.melee ? '<small>melee</small>' : w.reloading ? '<small>reloading...</small>' : `<span class="mag">${w.ammo}</span><small>/ ${w.spare.length} ${st.ammoLabel ?? 'mags'}</small>`,
  );
  setStyle(reloadFill, 'reloadfill', 'width', w.reloading ? `${Math.round((1 - w.reloadLeft / st.reloadTime) * 100)}%` : '0%');
  setText(hudScore, 'score', String(S.score));
  setText(hudCash, 'cash', `$${S.cash}`);
  setText(hudKills, 'kills', `Kills ${S.kills}` + (S.headshotKills ? ` (${S.headshotKills} HS)` : ''));
  setText(hudAccuracy, 'acc', `Accuracy ${accuracyText()}`);
  const hp = Math.max(0, S.health) / MAX_HEALTH;
  setStyle(healthFill, 'hpw', 'width', `${Math.round(hp * 100)}%`);
  setStyle(healthFill, 'hpc', 'background', `hsl(${Math.round(hp * 120)}, 72%, 48%)`);
  setText(healthText, 'hpt', String(Math.ceil(Math.max(0, S.health))));
  if (changed('hplow', String(S.health < 30 && !S.dead))) healthBox.classList.toggle('low', S.health < 30 && !S.dead);
  setStyle(potionsEl, 'potdisp', 'display', S.potions > 0 ? 'flex' : 'none');
  setHtml(potionText, 'pott', `× ${S.potions} <kbd>H</kbd>`);
}

/** Open the crosshair ticks to `px` pixels from the centre (the weapon's spread); `melee` shows only the dot. */
export function setCrosshair(px: number, melee: boolean) {
  if (changed('xgap', String(Math.round(px)))) crosshair.style.setProperty('--gap', `${Math.round(px)}px`);
  if (changed('xmelee', String(melee))) crosshair.classList.toggle('melee', melee);
}
export function setCrosshairVisible(v: boolean) {
  setStyle(crosshair, 'xvis', 'opacity', v ? '1' : '0');
}

export function showPopup(text: string, color = '#ffd84a') {
  popup.textContent = text;
  popup.style.color = color;
  S.popupTimer = 1;
}

export function showBanner(title: string, sub = '', secs = 3.5) {
  bannerEl.innerHTML = `${title}${sub ? `<small>${sub}</small>` : ''}`;
  bannerEl.style.opacity = '1';
  last.delete('bannerop');
  S.bannerTimer = secs;
}

/** The pause-menu summary: a few chips (level, score, kills, accuracy, cash). */
export function updateSummary() {
  const chips = [`<span class="chip">Level ${S.level}</span>`];
  if (S.shotsFired) {
    chips.push(`<span class="chip">Score ${S.score}</span>`, `<span class="chip">Kills ${S.kills}</span>`);
    if (S.headshotKills) chips.push(`<span class="chip">${S.headshotKills} headshots</span>`);
    chips.push(`<span class="chip">Accuracy ${accuracyText()}</span>`);
  }
  chips.push(`<span class="chip gold">$${S.cash}</span>`);
  $('summary').innerHTML = chips.join('');
}

/** Per-frame fades: banner, hurt flash (plus a slow pulse while health is low), popup, hit marker. */
export function updateHudTimers(dt: number) {
  S.bannerTimer -= dt;
  setStyle(bannerEl, 'bannerop', 'opacity', S.bannerTimer > 0 ? '1' : '0');

  S.hurtFlash = Math.max(0, S.hurtFlash - dt * 1.6);
  const lowPulse = S.health < 30 && !S.dead ? 0.25 * (0.5 + 0.5 * Math.sin(performance.now() * 0.008)) : 0;
  hurtOverlay.style.opacity = (Math.round(Math.min(1, S.hurtFlash * 0.9 + lowPulse) * 100) / 100).toString();

  S.popupTimer = Math.max(0, S.popupTimer - dt);
  setStyle(popup, 'popupop', 'opacity', (Math.round(Math.min(1, S.popupTimer * 2) * 20) / 20).toString());
  S.hitTimer = Math.max(0, S.hitTimer - dt);
  setStyle(hitmarker, 'hitop', 'opacity', S.hitTimer > 0 ? '1' : '0');
}
