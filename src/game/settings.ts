import { renderer, world } from './core';

// Player settings (pause menu > Settings), remembered in localStorage: mouse sensitivity, volume, graphics quality.
export type Quality = 'high' | 'medium' | 'low';
export interface Settings { quality: Quality; sensitivity: number; volume: number }

const KEY = 'botshooter.settings.v1';
export const settings: Settings = { quality: 'high', sensitivity: 1, volume: 1 };
try {
  const d = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>;
  if (d.quality === 'high' || d.quality === 'medium' || d.quality === 'low') settings.quality = d.quality;
  if (typeof d.sensitivity === 'number' && Number.isFinite(d.sensitivity)) settings.sensitivity = Math.min(2.5, Math.max(0.3, d.sensitivity));
  if (typeof d.volume === 'number' && Number.isFinite(d.volume)) settings.volume = Math.min(1, Math.max(0, d.volume));
} catch {
  /* no saved settings */
}
export function saveSettings() {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* storage unavailable */
  }
}

/** pixelRatio: render resolution cap; shadow: sun shadow map size (0 = off); period: the shadow map is redrawn every Nth frame. */
const QUALITY: Record<Quality, { pixelRatio: number; shadow: number; period: number }> = {
  high: { pixelRatio: 2, shadow: 2048, period: 1 },
  medium: { pixelRatio: 1.25, shadow: 1536, period: 2 },
  low: { pixelRatio: 1, shadow: 0, period: 1 },
};
export const shadowPeriod = () => QUALITY[settings.quality].period;

// Dynamic resolution: when frames take too long the render resolution drops a little, and it creeps back up when
// there is time to spare, so the game stays smooth on any machine. Not used by automated test browsers.
let resScale = 1;
let slowT = 0, fastT = 0, accT = 0, accN = 0;
export function tuneResolution(dt: number) {
  if (navigator.webdriver || dt <= 0) return;
  accT += dt;
  accN++;
  if (accT < 1) return;
  const avg = accT / accN;
  accT = accN = 0;
  const old = resScale;
  if (avg > 1 / 52) {
    fastT = 0;
    if (++slowT >= 1) resScale = Math.max(0.55, resScale - (avg > 1 / 30 ? 0.2 : 0.1));
  } else if (avg < 1 / 85) {
    slowT = 0;
    if (++fastT >= 5) { resScale = Math.min(1, resScale + 0.1); fastT = 0; }
  } else slowT = fastT = 0;
  if (resScale !== old) applyQuality();
}

/** Apply the graphics quality to the renderer and the sun. */
export function applyQuality() {
  const q = QUALITY[settings.quality];
  renderer.setPixelRatio(Math.min(devicePixelRatio, q.pixelRatio) * resScale);
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.autoUpdate = false; // main.ts asks for a shadow redraw every `period` frames
  renderer.shadowMap.needsUpdate = true;
  world.setShadowQuality(q.shadow);
}
