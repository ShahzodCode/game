import { setVolume } from '../audio/audio';
import { $ } from './core';
import { overlay } from './hud';
import { saveProgress } from './save';
import { aaNeedsReload, applyQuality, saveSettings, settings, type Quality } from './settings';

// The Settings screen (pause menu > Settings): sensitivity, volume, graphics quality.
export const settingsEl = $('settings');
const sens = $('optSens') as HTMLInputElement;
const vol = $('optVol') as HTMLInputElement;
const quality = $('optQuality');
const NOTES = {
  auto: 'Starts on High and lowers itself if your computer cannot keep up (the resolution first, then the whole quality). Recommended.',
  high: 'Sharp picture, smooth edges, full shadows, every light, long view distance.',
  medium: 'Lower resolution, no edge smoothing, lighter shadows, fewer lights, shorter view distance. A good choice for older computers.',
  low: 'Lowest resolution, no shadows, almost no lights, short view distance (distant things fade into fog). Use it on slow computers or laptops without a graphics card.',
};

function refresh() {
  sens.value = String(settings.sensitivity);
  vol.value = String(settings.volume);
  $('outSens').textContent = `${settings.sensitivity.toFixed(2)}x`;
  $('outVol').textContent = `${Math.round(settings.volume * 100)}%`;
  const shown = settings.auto ? 'auto' : settings.quality;
  quality.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.q === shown));
  $('outQuality').textContent = settings.auto ? `Auto (now ${settings.quality})` : '';
  $('noteQuality').textContent = NOTES[shown as keyof typeof NOTES];
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
  const q = (e.target as HTMLElement).closest('button')?.dataset.q as Quality | 'auto' | undefined;
  if (!q) return;
  if (q === 'auto') settings.auto = true;
  else {
    settings.auto = false;
    settings.quality = q;
  }
  applyQuality();
  refresh();
  saveSettings();
  if (q !== 'auto' && aaNeedsReload(settings.quality)) {
    // edge smoothing can only be chosen when the graphics are created: reload (the progress is saved first)
    $('noteQuality').textContent = 'Applying the new quality (reloading the page)...';
    saveProgress();
    setTimeout(() => location.reload(), 250);
  }
});
$('btnSettings').addEventListener('click', openSettings);
$('btnSettingsBack').addEventListener('click', closeSettings);
setVolume(settings.volume);
refresh();
