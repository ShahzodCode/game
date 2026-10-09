// Layout of the arena (x, z in metres, the arena is 120 x 120: -60..60). West (x < 0) is the forest, east (x > 0)
// the rocky badlands; the gate with the player entry is on the south side (z = +60) and the supply shop beside it.
// Shared by the terrain (world.ts) and the scenery builders (scenery.ts).

export type Side = 'N' | 'S' | 'E' | 'W';
export interface HouseSpec { x: number; z: number; w: number; d: number; door: Side }

/** Big houses: a floor, walls with an open doorway and some windows, a gable roof and a couch. w = size along x, d = along z. */
export const HOUSES: HouseSpec[] = [
  { x: -38, z: -8, w: 17, d: 12, door: 'E' }, // in the forest, door toward the middle of the map
  { x: 32, z: 22, w: 16, d: 12, door: 'W' }, // at the edge of the badlands
];

export const CAMP = { x: -16, z: 4 }; // campfire clearing in the forest
export const POND = { x: -30, z: 18, r: 7.5, level: -0.7 }; // water surface height; the ground dips below it
export const ENTRY = { x: 0, z: 50 }; // where the arena starts (just inside the gate)

/** Plateaus: flat tops with ramps down (slopes stay walkable). */
export const MESAS = [
  { x: 36, z: -34, r: 9, h: 3.4 },
  { x: 50, z: 40, r: 6.5, h: 2.6 },
];

/** Landmarks of the rocky side. */
export const ARCHES = [
  { x: 20, z: -22, span: 5.2, rot: 0 }, // pillars along x
  { x: 48, z: 10, span: 5.6, rot: Math.PI / 2 }, // pillars along z
];
export const STONE_CIRCLE = { x: 42, z: -6, r: 5.5, n: 8 };
export const SPIRES: [number, number, number][] = [
  [28, 4, 7], [54, -20, 9], [12, -44, 8], [56, 22, 6.5], [20, 44, 7.5], [44, -50, 8.5],
];
export const BOULDER_FIELDS: [number, number][] = [[28, -2], [50, -46], [12, -38], [52, 16], [22, 36], [8, -12]];
export const ROCK_PILES: [number, number][] = [
  [26, 0], [44, -22], [18, -38], [52, -46], [34, 12], [48, 26], [24, 32], [12, -10], [40, 50], [56, 4],
  [-14, -26], [-38, 22], [-53, -22],
];
export const GIANT_OAK = { x: -22, z: -16 };

/** Dirt paths (polylines) from the gate to the houses and the camp. */
export const PATHS: [number, number][][] = [
  [[0, 56], [-4, 46], [-12, 32], [-17, 16], [-16, 4], [-22, -4], [-27, -8]],
  [[4, 56], [12, 46], [18, 30], [21, 22]],
];

/** Rectangles that are levelled flat (x, z centre, w, d size, margin = width of the blend into the hills). */
export const FLATS: { x: number; z: number; w: number; d: number; margin: number }[] = [
  ...HOUSES.map((h) => ({ x: h.x, z: h.z, w: h.w + 5, d: h.d + 5, margin: 4 })),
  { x: CAMP.x, z: CAMP.z, w: 7, d: 7, margin: 4 },
  { x: ENTRY.x + 2, z: ENTRY.z, w: 14, d: 8, margin: 6 },
  { x: 8, z: 53, w: 6, d: 5, margin: 3.5 }, // supply shop
];

/** Distance from (x, z) to the nearest dirt path. */
export function pathDistance(x: number, z: number): number {
  let best = Infinity;
  for (const path of PATHS) {
    for (let i = 0; i < path.length - 1; i++) {
      const [ax, az] = path[i], [bx, bz] = path[i + 1];
      const dx = bx - ax, dz = bz - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
      best = Math.min(best, Math.hypot(x - (ax + dx * t), z - (az + dz * t)));
    }
  }
  return best;
}

/** Is this spot inside (or near) something that must stay clear of trees and rocks? */
export function keepClear(x: number, z: number, margin: number): boolean {
  for (const f of FLATS) if (Math.abs(x - f.x) < f.w / 2 + margin && Math.abs(z - f.z) < f.d / 2 + margin) return true;
  if (Math.hypot(x - POND.x, z - POND.z) < POND.r + 1.5 + margin) return true;
  if (pathDistance(x, z) < 1.8 + margin * 0.5) return true;
  return false;
}

/**
 * The arena grows as the levels go on. Each stage is a rectangle (all nested, the south edge z = 60 with the gate is
 * always the same); everything outside the current stage is hidden and walled off. Scenery belongs to the first
 * stage whose rectangle contains it, so it appears when the walls move out. Level 25 uses the whole 120 x 120 map.
 */
export interface Stage { fromLevel: number; x0: number; x1: number; z0: number; z1: number; bots: number }
export const STAGES: Stage[] = [
  { fromLevel: 1, x0: -20, x1: 20, z0: 24, z1: 60, bots: 10 },
  { fromLevel: 3, x0: -20, x1: 20, z0: -4, z1: 60, bots: 12 },
  { fromLevel: 6, x0: -20, x1: 52, z0: -14, z1: 60, bots: 16 },
  { fromLevel: 10, x0: -50, x1: 52, z0: -24, z1: 60, bots: 20 },
  { fromLevel: 15, x0: -54, x1: 56, z0: -48, z1: 60, bots: 24 },
  { fromLevel: 20, x0: -58, x1: 59, z0: -56, z1: 60, bots: 24 },
  { fromLevel: 25, x0: -60, x1: 60, z0: -60, z1: 60, bots: 24 },
];
export function stageForLevel(level: number): number {
  let s = 0;
  for (let i = 0; i < STAGES.length; i++) if (level >= STAGES[i].fromLevel) s = i;
  return s;
}
/** The first stage that contains the point (with a margin, so things never straddle a wall). */
export function stageOf(x: number, z: number, margin = 1.5): number {
  for (let i = 0; i < STAGES.length; i++) {
    const g = STAGES[i];
    if (x > g.x0 + margin && x < g.x1 - margin && z > g.z0 + margin && z < g.z1 - margin) return i;
  }
  return STAGES.length - 1;
}
