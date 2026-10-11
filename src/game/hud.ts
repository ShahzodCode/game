import { $, weapons } from './core';
import { MAX_HEALTH, S } from './state';
import { gunImage } from '../shop/shopItems';

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
const healthBlocks = Array.from($('healthBar').children) as HTMLElement[];
const weaponIcon = $('weaponIcon') as HTMLImageElement;
const spareEl = $('spare');
const healthText = $('healthText');
const hurtOverlay = $('hurt');
const popup = $('popup');
export const hitmarker = $('hitmarker');
export const resumeHint = $('resumeHint');
export const overlay = $('overlay');
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

export function updateHud() {
  const w = weapons[S.current];
  const st = w.stats;
  setText(hudWeapon, 'weapon', st.name);
  const low = !st.melee && !w.reloading && w.ammo / st.magSize <= 0.25;
  if (changed('hudclass', `${low}|${w.reloading}`)) {
    hudBox.classList.toggle('low', low);
    hudBox.classList.toggle('reloading', w.reloading);
  }
  const icon = gunImage(st.id);
  if (changed('wicon', icon)) weaponIcon.src = icon;
  setHtml(hudAmmo, 'ammo', st.melee ? '<small>MELEE</small>' : `${w.ammo}`);
  if (changed('spare', st.melee ? '' : `${w.spare.length}/${st.maxMags}`)) {
    // spare magazines as pips (a number when there are many)
    spareEl.innerHTML = st.melee
      ? ''
      : st.maxMags > 8
        ? `<b>${w.spare.length} ${st.ammoLabel ?? 'mags'}</b>`
        : Array.from({ length: st.maxMags }, (_, i) => `<i${i < w.spare.length ? '' : ' class="gone"'}></i>`).join('');
  }
  setStyle(reloadFill, 'reloadfill', 'width', w.reloading ? `${Math.round((1 - w.reloadLeft / st.reloadTime) * 100)}%` : '0%');
  setText(hudScore, 'score', String(S.score));
  setText(hudCash, 'cash', `$${S.cash}`);
  setText(hudKills, 'kills', `Kills ${S.kills}` + (S.headshotKills ? ` (${S.headshotKills} HS)` : ''));
  setText(hudAccuracy, 'acc', `Accuracy ${accuracyText()}`);
  const hp = Math.max(0, S.health) / MAX_HEALTH;
  const lit = Math.ceil(hp * healthBlocks.length - 1e-6);
  if (changed('hpblocks', String(lit))) healthBlocks.forEach((el, i) => el.classList.toggle('on', i < lit));
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
