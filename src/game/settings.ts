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
  high: { pixelRatio: 2, shadow: 4096, period: 1 },
  medium: { pixelRatio: 1.25, shadow: 2048, period: 2 },
  low: { pixelRatio: 1, shadow: 0, period: 1 },
};
export const shadowPeriod = () => QUALITY[settings.quality].period;

/** Apply the graphics quality to the renderer and the sun. */
export function applyQuality() {
  const q = QUALITY[settings.quality];
  renderer.setPixelRatio(Math.min(devicePixelRatio, q.pixelRatio));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.autoUpdate = false; // main.ts asks for a shadow redraw every `period` frames
  renderer.shadowMap.needsUpdate = true;
  world.setShadowQuality(q.shadow);
}
