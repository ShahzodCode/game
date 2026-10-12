// Graphics quality tiers. No imports on purpose: core.ts needs the table (to create the renderer with or without
// antialiasing) before anything else exists, and settings.ts applies it later.

export type Quality = 'high' | 'medium' | 'low';
export const QUALITY_ORDER: Quality[] = ['high', 'medium', 'low'];

export interface Tier {
  /** Render resolution as a fraction of the screen (on top of the pixel-ratio cap below). */
  scale: number;
  /** Highest device pixel ratio that is rendered (HiDPI laptops would otherwise draw 4x the pixels). */
  dprCap: number;
  /** MSAA: only chosen when the renderer is created (changing it needs a page reload). */
  aa: boolean;
  /** Sun shadow map size (0 = no shadows), the half-width in metres of the area around the player that gets shadows, and how often (every Nth frame) it is redrawn. */
  shadow: number;
  shadowRadius: number;
  shadowPeriod: number;
  /** Characters farther than this (m) from the player do not cast shadows. */
  botShadow: number;
  /** Grass, bushes and flowers are only drawn within this distance (m). */
  cover: number;
  /** Camera far plane and fog range (m): everything past `fogFar` is fog anyway, so it is not drawn. */
  far: number;
  fogNear: number;
  fogFar: number;
  /** How many of the point lights (arena lamps / safe-room candles and lamps) are used. Every light costs every lit pixel. */
  arenaLights: number;
  roomLights: number;
}

export const TIERS: Record<Quality, Tier> = {
  high: { scale: 1, dprCap: 1.5, aa: true, shadow: 2048, shadowRadius: 42, shadowPeriod: 1, botShadow: 50, cover: 62, far: 400, fogNear: 60, fogFar: 190, arenaLights: 99, roomLights: 99 },
  medium: { scale: 0.8, dprCap: 1.25, aa: false, shadow: 1024, shadowRadius: 32, shadowPeriod: 2, botShadow: 30, cover: 45, far: 220, fogNear: 45, fogFar: 150, arenaLights: 1, roomLights: 6 },
  low: { scale: 0.6, dprCap: 1, aa: false, shadow: 0, shadowRadius: 32, shadowPeriod: 1, botShadow: 0, cover: 30, far: 140, fogNear: 30, fogFar: 110, arenaLights: 0, roomLights: 3 },
};

export const SETTINGS_KEY = 'botshooter.settings.v1';

/** The saved quality choice. `auto` (the default) lets the game lower the quality by itself when the machine cannot keep up. */
export function readSavedQuality(): { quality: Quality; auto: boolean } {
  try {
    const d = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as { quality?: string; auto?: boolean };
    const quality: Quality = d.quality === 'high' || d.quality === 'medium' || d.quality === 'low' ? d.quality : 'high';
    // saves from before the Auto option: 'high' was the default, so treat it as Auto; an explicit Medium / Low stays manual
    return { quality, auto: typeof d.auto === 'boolean' ? d.auto : quality === 'high' };
  } catch {
    return { quality: 'high', auto: true };
  }
}
