import { setVolume } from '../audio/audio';
import { $ } from './core';
import { overlay } from './hud';
import { applyQuality, saveSettings, settings, type Quality } from './settings';

// The Settings screen (pause menu > Settings): sensitivity, volume, graphics quality.
export const settingsEl = $('settings');
const sens = $('optSens') as HTMLInputElement;
const vol = $('optVol') as HTMLInputElement;
const quality = $('optQuality');

function refresh() {
  sens.value = String(settings.sensitivity);
  vol.value = String(settings.volume);
  $('outSens').textContent = `${settings.sensitivity.toFixed(2)}x`;
  $('outVol').textContent = `${Math.round(settings.volume * 100)}%`;
  quality.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.q === settings.quality));
}
export function openSettings() {
  overlay.style.display = 'none';
  settingsEl.style.display = 'flex';
  refresh();
}
export function closeSettings() {
  settingsEl.style.display = 'none';
  overlay.style.display = 'flex';
}
sens.addEventListener('input', () => {
  settings.sensitivity = Number(sens.value);
  refresh();
  saveSettings();
});
vol.addEventListener('input', () => {
  settings.volume = Number(vol.value);
  setVolume(settings.volume);
  refresh();
  saveSettings();
});
quality.addEventListener('click', (e) => {
  const q = (e.target as HTMLElement).closest('button')?.dataset.q as Quality | undefined;
  if (!q) return;
  settings.quality = q;
  applyQuality();
  refresh();
  saveSettings();
});
$('btnSettings').addEventListener('click', openSettings);
$('btnSettingsBack').addEventListener('click', closeSettings);
setVolume(settings.volume);
refresh();
