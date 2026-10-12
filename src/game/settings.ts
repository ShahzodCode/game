import { camera, renderer, world } from './core';
import { showBanner } from './hud';
import { QUALITY_ORDER, SETTINGS_KEY, TIERS, readSavedQuality, type Quality, type Tier } from './quality';

// Player settings (pause menu > Settings), remembered in localStorage: mouse sensitivity, volume, graphics quality.
export type { Quality } from './quality';
export interface Settings { quality: Quality; auto: boolean; sensitivity: number; volume: number }

export const settings: Settings = { ...readSavedQuality(), sensitivity: 1, volume: 1 };
try {
  const d = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<Settings>;
  if (typeof d.sensitivity === 'number' && Number.isFinite(d.sensitivity)) settings.sensitivity = Math.min(2.5, Math.max(0.3, d.sensitivity));
  if (typeof d.volume === 'number' && Number.isFinite(d.volume)) settings.volume = Math.min(1, Math.max(0, d.volume));
} catch {
  /* no saved settings */
}
export function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* storage unavailable */
  }
}

export const tier = (): Tier => TIERS[settings.quality];
export const shadowPeriod = () => tier().shadowPeriod;
/** Antialiasing is fixed when the renderer is created (core.ts), so changing it later needs a page reload. */
const startedWithAA = TIERS[settings.quality].aa;
export const aaNeedsReload = (q: Quality) => TIERS[q].aa !== startedWithAA;

// Things that depend on the tier but live elsewhere (the point-light set in main.ts) register here.
const listeners: ((t: Tier) => void)[] = [];
export const onQualityChange = (cb: (t: Tier) => void) => void listeners.push(cb);

// Dynamic resolution: when frames take too long the render resolution drops a little. It is only raised again by
// trying: after a while of smooth frames it steps up once, and if the next second is slow again it steps back and
// waits twice as long before the next try (a 60 Hz screen always shows ~16 ms frames, so "spare time" cannot be measured).
// In Auto mode, when even the lowest resolution cannot keep up, the whole tier is lowered. Not used by automated browsers.
let resScale = 1;
let accT = 0, accN = 0, goodSecs = 0, probeWait = 10, probing = false, hopeless = 0;
const minScale = () => Math.min(1, Math.max(0.5, 0.4 / tier().scale)); // never below 40% of the screen resolution in total

function applyResolution() {
  const t = tier();
  renderer.setPixelRatio(Math.min(devicePixelRatio, t.dprCap) * t.scale * resScale);
  renderer.setSize(innerWidth, innerHeight);
}

function lowerTier() {
  const i = QUALITY_ORDER.indexOf(settings.quality);
  if (i >= QUALITY_ORDER.length - 1) return;
  settings.quality = QUALITY_ORDER[i + 1];
  resScale = 1;
  probeWait = 10;
  saveSettings();
  applyQuality();
  showBanner('GRAPHICS LOWERED', `Switched to ${settings.quality} quality to keep the game smooth. You can change this in Settings.`, 5);
}

export function tuneResolution(dt: number) {
  if (navigator.webdriver || dt <= 0) return;
  accT += dt;
  accN++;
  if (accT < 1) return;
  const avg = accT / accN;
  accT = accN = 0;
  const min = minScale();
  if (avg > 1 / 50) {
    goodSecs = 0;
    const old = resScale;
    if (probing) {
      probing = false; // the last step up was too much: go back and wait longer before trying again
      resScale = Math.max(min, resScale - 0.1);
      probeWait = Math.min(120, probeWait * 2);
    } else resScale = Math.max(min, resScale - (avg > 1 / 30 ? 0.2 : 0.1));
    if (resScale !== old) applyResolution();
    if (settings.auto && resScale <= min + 1e-3 && avg > 1 / 40) {
      if (++hopeless >= 5) {
        hopeless = 0;
        lowerTier();
      }
    } else hopeless = 0;
    return;
  }
  hopeless = 0;
  probing = false;
  if (resScale < 1 && ++goodSecs >= probeWait) {
    goodSecs = 0;
    probing = true;
    resScale = Math.min(1, resScale + 0.1);
    applyResolution();
  }
}

/** Apply the graphics quality: resolution, shadows, view distance, grass range, and whoever listens (the light set). */
export function applyQuality() {
  const t = tier();
  applyResolution();
  renderer.shadowMap.autoUpdate = false; // main.ts asks for a shadow redraw every `shadowPeriod` frames
  renderer.shadowMap.needsUpdate = true;
  world.setShadowQuality(t.shadow, t.shadowRadius);
  world.setViewRange(t.cover, t.fogNear, t.fogFar);
  camera.far = t.far;
  camera.updateProjectionMatrix();
  for (const f of listeners) f(t);
}
