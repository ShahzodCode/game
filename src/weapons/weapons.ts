import * as THREE from 'three';
import { buildSmg, buildSniper, buildCrossbow, buildLauncher } from './procModels';

/**
 * Weapon stat sheet. Fields marked [future] are not used by the prototype yet
 * but are here so physics / ballistics / mechanics can be added without
 * reshaping the data.
 */
export interface WeaponStats {
  id: string;
  name: string;
  // --- firing ---
  fireMode: 'semi' | 'auto';
  rpm: number; // rounds per minute
  damage: number;
  headshotMultiplier: number;
  range: number; // max hitscan distance (m)
  falloffStart: number; // distance where damage starts dropping (m)
  falloffMinMultiplier: number; // damage multiplier at max range
  pellets: number; // bullets per shot (shotgun-style)
  // --- ammo ---
  magSize: number;
  startMags: number; // spare magazines at the start of a game
  maxMags: number; // most spare magazines the player can carry
  magPrice: number; // cost of one magazine at the shop
  unlockPrice: number; // 0 = owned from the start, otherwise it must be bought at the shop
  /** Not for sale and not owned at the start: unlocked by a quest reward (the katana). */
  questOnly?: boolean;
  reloadTime: number; // seconds
  equipTime: number; // seconds
  // --- accuracy (degrees of cone half-angle) ---
  spreadBase: number;
  spreadMoving: number; // added while moving
  spreadAir: number; // added while airborne
  spreadPerShot: number; // bloom added per shot
  spreadRecovery: number; // bloom recovered per second
  spreadMax: number;
  // --- recoil (degrees) ---
  recoilPitch: number;
  recoilYaw: number; // random +/- range
  recoilRecovery: number; // degrees/sec the kick settles back
  recoilBuildup: number; // extra kick multiplier added per consecutive shot (the camera climbs more and more)
  recoilBuildupMax: number; // cap on the kick multiplier
  recoilBuildupDecay: number; // consecutive-shot count that cools off per second
  recoilRoll: number; // random camera roll per shot (degrees)
  // --- handling ---
  moveSpeedMultiplier: number;
  adsZoom: number; // [future] FOV divisor when aiming
  adsTime: number; // [future]
  // --- ballistics / physics [future] ---
  muzzleVelocity: number; // m/s, for projectile mode
  bulletMass: number; // kg
  bulletDrag: number; // [future]
  gravityScale: number; // [future] bullet drop
  impactImpulse: number; // [future] push applied to physics bodies
  penetration: number; // [future] metres of material pierced
  weight: number; // kg [future] weapon sway / stamina
  // --- melee ---
  melee?: boolean; // swings instead of shooting: no ammo, no reload, hits what is within `range`
  meleeArc?: number; // degrees either side of the crosshair that still count as a hit
  // --- aiming (right mouse button) ---
  adsSpreadMult?: number; // spread multiplier while aiming (default 0.55)
  adsMoveMult?: number; // walking speed multiplier while aiming (default 0.65)
  scope?: boolean; // full-screen scope overlay (and no viewmodel) while fully aimed
  // --- special mechanics ---
  pierce?: number; // extra characters a bullet passes through (each one hits 40% weaker)
  /** Fires a physical projectile (gravity, bounces) instead of a hitscan ray. */
  projectile?: { kind: 'bolt' | 'grenade'; speed: number; gravity: number };
  /** The projectile explodes: damage falls off to 0 at `radius`; `fuse` seconds after launch if it hits nothing. */
  explosion?: { radius: number; damage: number; push: number; fuse: number; selfMult: number };
  silent?: boolean; // makes no noise: bystanders do not panic
  ammoLabel?: string; // what the HUD / shop call one magazine (default 'mags')
  shot?: 'smg' | 'sniper' | 'crossbow' | 'launcher'; // synthesized sound
  // --- feel ---
  viewKick: number; // viewmodel kickback distance
  soundPitch: number; // base frequency of the synthesized shot
  tracerColor: number;
}

/** Values shared by the newer weapons (each one overrides what it needs). */
const BASE = {
  headshotMultiplier: 1.5,
  pellets: 1,
  equipTime: 0.4,
  adsZoom: 1.3,
  adsTime: 0.25,
  muzzleVelocity: 400,
  bulletMass: 0.01,
  bulletDrag: 0.002,
  gravityScale: 1,
  impactImpulse: 5,
  penetration: 0.1,
  weight: 3,
  soundPitch: 150,
  tracerColor: 0xffe08a,
};

export const WEAPONS: WeaponStats[] = [
  {
    id: 'pistol',
    name: 'Pistol',
    fireMode: 'semi',
    rpm: 360,
    damage: 25,
    headshotMultiplier: 2,
    range: 120,
    falloffStart: 25,
    falloffMinMultiplier: 0.6,
    pellets: 1,
    magSize: 12,
    startMags: 3,
    maxMags: 6,
    magPrice: 300,
    unlockPrice: 0,
    reloadTime: 1.15, // matches the reload sound
    equipTime: 0.25,
    spreadBase: 0.3,
    spreadMoving: 1.0,
    spreadAir: 2.0,
    spreadPerShot: 0.6,
    spreadRecovery: 4,
    spreadMax: 3,
    recoilPitch: 0.7,
    recoilYaw: 0.2,
    recoilRecovery: 8,
    recoilBuildup: 0.05,
    recoilBuildupMax: 1.3,
    recoilBuildupDecay: 4,
    recoilRoll: 0.2,
    moveSpeedMultiplier: 1.0,
    adsZoom: 1.2,
    adsTime: 0.15,
    muzzleVelocity: 380,
    bulletMass: 0.008,
    bulletDrag: 0.002,
    gravityScale: 1,
    impactImpulse: 3,
    penetration: 0.1,
    weight: 1.0,
    viewKick: 0.07,
    soundPitch: 220,
    tracerColor: 0xffe08a,
  },
  {
    id: 'rifle',
    name: 'Assault Rifle',
    fireMode: 'auto',
    rpm: 840, // matches the cadence of the rifle-burst recording
    damage: 11,
    headshotMultiplier: 1.8,
    range: 200,
    falloffStart: 40,
    falloffMinMultiplier: 0.5,
    pellets: 1,
    magSize: 30,
    startMags: 3,
    maxMags: 6,
    magPrice: 400,
    unlockPrice: 0,
    reloadTime: 2.4, // matches the reload sound
    equipTime: 0.45,
    spreadBase: 0.5,
    spreadMoving: 1.5,
    spreadAir: 3.0,
    spreadPerShot: 0.35,
    spreadRecovery: 5,
    spreadMax: 4.5,
    recoilPitch: 0.8,
    recoilYaw: 0.4,
    recoilRecovery: 12,
    recoilBuildup: 0.06,
    recoilBuildupMax: 2.0,
    recoilBuildupDecay: 10,
    recoilRoll: 0.6,
    moveSpeedMultiplier: 0.9,
    adsZoom: 1.5,
    adsTime: 0.25,
    muzzleVelocity: 900,
    bulletMass: 0.004,
    bulletDrag: 0.001,
    gravityScale: 1,
    impactImpulse: 5,
    penetration: 0.25,
    weight: 3.4,
    viewKick: 0.045,
    soundPitch: 150,
    tracerColor: 0xffb347,
  },
  {
    id: 'shotgun',
    name: 'Shotgun',
    fireMode: 'semi',
    rpm: 70, // pump action
    damage: 12, // per pellet
    headshotMultiplier: 1.5,
    range: 35,
    falloffStart: 3, // damage drops off fast after point-blank range
    falloffMinMultiplier: 0.05,
    pellets: 8,
    magSize: 6,
    startMags: 3,
    maxMags: 6,
    magPrice: 350,
    unlockPrice: 3000,
    reloadTime: 2.4,
    equipTime: 0.5,
    spreadBase: 3.5, // wide cone: most pellets miss at range
    spreadMoving: 0.8,
    spreadAir: 1.2,
    spreadPerShot: 0,
    spreadRecovery: 5,
    spreadMax: 4.5,
    recoilPitch: 3.5,
    recoilYaw: 0.8,
    recoilRecovery: 10,
    recoilBuildup: 0.1,
    recoilBuildupMax: 1.3,
    recoilBuildupDecay: 2,
    recoilRoll: 0.8,
    moveSpeedMultiplier: 0.95,
    adsZoom: 1.2,
    adsTime: 0.3,
    muzzleVelocity: 400,
    bulletMass: 0.004, // per pellet
    bulletDrag: 0.004,
    gravityScale: 1,
    impactImpulse: 12, // per pellet
    penetration: 0.02,
    weight: 3.6,
    viewKick: 0.14,
    soundPitch: 90,
    tracerColor: 0xffd37a,
  },
  {
    id: 'knife',
    name: 'Knife',
    melee: true,
    meleeArc: 11,
    fireMode: 'semi',
    rpm: 100, // a slash every 0.6s
    damage: 40,
    headshotMultiplier: 2,
    range: 2.4,
    falloffStart: 2.4,
    falloffMinMultiplier: 1,
    pellets: 1,
    magSize: 1, // unused for melee
    startMags: 0,
    maxMags: 0,
    magPrice: 0,
    unlockPrice: 0, // basic weapon, owned from the start
    reloadTime: 0,
    equipTime: 0.25,
    spreadBase: 0,
    spreadMoving: 0,
    spreadAir: 0,
    spreadPerShot: 0,
    spreadRecovery: 1,
    spreadMax: 0,
    recoilPitch: 0,
    recoilYaw: 0,
    recoilRecovery: 1,
    recoilBuildup: 0,
    recoilBuildupMax: 1,
    recoilBuildupDecay: 1,
    recoilRoll: 0,
    moveSpeedMultiplier: 1.08, // light: a little faster than guns
    adsZoom: 1,
    adsTime: 0,
    muzzleVelocity: 0,
    bulletMass: 0,
    bulletDrag: 0,
    gravityScale: 0,
    impactImpulse: 6,
    penetration: 0,
    weight: 0.4,
    viewKick: 0,
    soundPitch: 0,
    tracerColor: 0xffffff,
  },
  {
    id: 'katana',
    name: 'Katana',
    melee: true,
    meleeArc: 18,
    fireMode: 'semi',
    rpm: 130, // a slash every 0.46s
    damage: 90,
    headshotMultiplier: 2,
    range: 3.0,
    falloffStart: 3.0,
    falloffMinMultiplier: 1,
    pellets: 1,
    magSize: 1, // unused for melee
    startMags: 0,
    maxMags: 0,
    magPrice: 0,
    unlockPrice: 0,
    questOnly: true, // reward for killing 15 ninjas
    reloadTime: 0,
    equipTime: 0.25,
    spreadBase: 0,
    spreadMoving: 0,
    spreadAir: 0,
    spreadPerShot: 0,
    spreadRecovery: 1,
    spreadMax: 0,
    recoilPitch: 0,
    recoilYaw: 0,
    recoilRecovery: 1,
    recoilBuildup: 0,
    recoilBuildupMax: 1,
    recoilBuildupDecay: 1,
    recoilRoll: 0,
    moveSpeedMultiplier: 1.08, // light: a little faster than guns
    adsZoom: 1,
    adsTime: 0,
    muzzleVelocity: 0,
    bulletMass: 0,
    bulletDrag: 0,
    gravityScale: 0,
    impactImpulse: 6,
    penetration: 0,
    weight: 0.4,
    viewKick: 0,
    soundPitch: 0,
    tracerColor: 0xffffff,
  },
  // ------------------------------------------------------------------------------------------------
  // New weapons. Each trades something for its strength:
  //  - SMG: best on the move and up close, falls off fast, bloom builds quickly.
  //  - Sniper: aim (right mouse) for a scope and a near-perfect shot that pierces two targets; useless unscoped.
  //  - Crossbow: silent (nobody panics), heavy bolts with real drop, one bolt per reload.
  //  - Grenade launcher: bouncing grenades with a big blast and knockback, slow, little ammo, hurts you too.
  // ------------------------------------------------------------------------------------------------
  {
    ...BASE,
    id: 'smg',
    name: 'SMG',
    fireMode: 'auto',
    rpm: 900,
    damage: 9,
    headshotMultiplier: 1.6,
    range: 90,
    falloffStart: 14,
    falloffMinMultiplier: 0.35,
    magSize: 32,
    startMags: 2,
    maxMags: 6,
    magPrice: 350,
    unlockPrice: 2500,
    reloadTime: 1.8,
    equipTime: 0.3,
    spreadBase: 0.9,
    spreadMoving: 0.5, // hardly punished for moving
    spreadAir: 1.5,
    spreadPerShot: 0.3,
    spreadRecovery: 6,
    spreadMax: 5.5,
    recoilPitch: 0.45,
    recoilYaw: 0.55,
    recoilRecovery: 14,
    recoilBuildup: 0.05,
    recoilBuildupMax: 1.8,
    recoilBuildupDecay: 10,
    recoilRoll: 0.5,
    moveSpeedMultiplier: 1.02,
    adsZoom: 1.3,
    adsTime: 0.15,
    adsSpreadMult: 0.6,
    adsMoveMult: 0.85,
    impactImpulse: 4,
    weight: 2.4,
    viewKick: 0.035,
    tracerColor: 0xffd27a,
    shot: 'smg',
  },
  {
    ...BASE,
    id: 'sniper',
    name: 'Sniper Rifle',
    fireMode: 'semi',
    rpm: 48, // a bolt cycle every 1.25 s
    damage: 95,
    headshotMultiplier: 3,
    range: 400,
    falloffStart: 400,
    falloffMinMultiplier: 1,
    magSize: 5,
    startMags: 2,
    maxMags: 5,
    magPrice: 500,
    unlockPrice: 5500,
    reloadTime: 3.2,
    equipTime: 0.7,
    spreadBase: 2.6, // hip fire is wild: aim down the scope
    spreadMoving: 3.0,
    spreadAir: 5.0,
    spreadPerShot: 0,
    spreadRecovery: 3,
    spreadMax: 2.6,
    recoilPitch: 3.2,
    recoilYaw: 0.6,
    recoilRecovery: 6,
    recoilBuildup: 0,
    recoilBuildupMax: 1,
    recoilBuildupDecay: 1,
    recoilRoll: 0.8,
    moveSpeedMultiplier: 0.85,
    adsZoom: 4.5,
    adsTime: 0.45,
    adsSpreadMult: 0.01, // pinpoint when scoped (standing still; sway and movement still matter)
    adsMoveMult: 0.45,
    scope: true,
    pierce: 2,
    impactImpulse: 40,
    weight: 5.0,
    viewKick: 0.12,
    tracerColor: 0xfff2c0,
    shot: 'sniper',
  },
  {
    ...BASE,
    id: 'crossbow',
    name: 'Crossbow',
    fireMode: 'semi',
    rpm: 60,
    damage: 70,
    headshotMultiplier: 3,
    range: 200,
    falloffStart: 200,
    falloffMinMultiplier: 1,
    magSize: 1, // one bolt at a time...
    startMags: 5, // ...and every spare "magazine" is one bolt
    maxMags: 10,
    magPrice: 120,
    unlockPrice: 3500,
    reloadTime: 1.7,
    equipTime: 0.4,
    spreadBase: 0.4,
    spreadMoving: 1.2,
    spreadAir: 2.5,
    spreadPerShot: 0,
    spreadRecovery: 4,
    spreadMax: 0.4,
    recoilPitch: 1.2,
    recoilYaw: 0.2,
    recoilRecovery: 9,
    recoilBuildup: 0,
    recoilBuildupMax: 1,
    recoilBuildupDecay: 1,
    recoilRoll: 0.3,
    moveSpeedMultiplier: 0.95,
    adsZoom: 2,
    adsTime: 0.25,
    adsSpreadMult: 0.1,
    adsMoveMult: 0.7,
    projectile: { kind: 'bolt', speed: 78, gravity: 7 },
    silent: true,
    ammoLabel: 'bolts',
    impactImpulse: 18,
    weight: 3.0,
    viewKick: 0.09,
    tracerColor: 0xd9d4c7,
    shot: 'crossbow',
  },
  {
    ...BASE,
    id: 'launcher',
    name: 'Grenade Launcher',
    fireMode: 'semi',
    rpm: 40,
    damage: 25, // direct impact (the explosion does the real damage)
    headshotMultiplier: 1,
    range: 120,
    falloffStart: 120,
    falloffMinMultiplier: 1,
    magSize: 3, // a three-chamber drum
    startMags: 1,
    maxMags: 4,
    magPrice: 650,
    unlockPrice: 8000,
    reloadTime: 3.4,
    equipTime: 0.6,
    spreadBase: 0.8,
    spreadMoving: 1.0,
    spreadAir: 2.0,
    spreadPerShot: 0,
    spreadRecovery: 4,
    spreadMax: 0.8,
    recoilPitch: 4.0,
    recoilYaw: 0.5,
    recoilRecovery: 7,
    recoilBuildup: 0,
    recoilBuildupMax: 1,
    recoilBuildupDecay: 1,
    recoilRoll: 1.0,
    moveSpeedMultiplier: 0.82,
    adsZoom: 1.4,
    adsTime: 0.3,
    adsSpreadMult: 0.5,
    adsMoveMult: 0.6,
    projectile: { kind: 'grenade', speed: 27, gravity: 15 },
    explosion: { radius: 6, damage: 170, push: 15, fuse: 2.4, selfMult: 0.35 },
    ammoLabel: 'grenades',
    impactImpulse: 10,
    weight: 6.0,
    viewKick: 0.16,
    tracerColor: 0xffa040,
    shot: 'launcher',
  },
];

/**
 * Runtime state for one weapon. Ammo is magazine-based: `ammo` is the loaded magazine,
 * `spare` holds the rounds in each spare magazine. Reloading takes the fullest spare and THROWS AWAY the loaded
 * magazine, whatever is left in it: reloading early wastes bullets, so make them count.
 */
export class Weapon {
  ammo = 0;
  spare: number[] = [];
  cooldown = 0;
  reloadLeft = 0;
  bloom = 0;
  burst = 0; // consecutive shots, drives the growing recoil
  owned = false; // weapons with an unlockPrice must be bought first
  constructor(public stats: WeaponStats) {
    this.refill();
  }
  get reloading() {
    return this.reloadLeft > 0;
  }
  private fullestSpare() {
    let best = -1;
    this.spare.forEach((r, i) => {
      if (best < 0 || r > this.spare[best]) best = i;
    });
    return best;
  }
  startReload(): boolean {
    const i = this.fullestSpare();
    if (this.reloading || this.ammo >= this.stats.magSize || i < 0) return false;
    this.reloadLeft = this.stats.reloadTime;
    return true;
  }
  finishReload() {
    const i = this.fullestSpare();
    if (i < 0) return;
    this.ammo = this.spare[i]; // what was left in the old magazine is lost
    this.spare.splice(i, 1);
  }
  get canBuyMag() {
    return this.spare.length < this.stats.maxMags;
  }
  buyMag() {
    if (!this.canBuyMag) return false;
    this.spare.push(this.stats.magSize);
    return true;
  }
  /** Buy the weapon: it comes loaded, with one spare magazine. */
  unlock() {
    this.owned = true;
    this.ammo = this.stats.magSize;
    this.spare = [this.stats.magSize];
  }
  /** Back to the starting loadout (weapons with an unlock price are locked again). */
  refill() {
    this.owned = this.stats.unlockPrice === 0 && !this.stats.questOnly;
    this.ammo = this.stats.magSize;
    this.spare = Array.from({ length: this.stats.startMags }, () => this.stats.magSize);
    this.reloadLeft = 0;
    this.burst = 0;
  }
}

const dark = new THREE.MeshStandardMaterial({ color: 0x25272b, roughness: 0.5, metalness: 0.6 });
const mid = new THREE.MeshStandardMaterial({ color: 0x4a4e57, roughness: 0.5, metalness: 0.5 });
const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 0.8 });

function box(w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  return mesh;
}

function finishModel(g: THREE.Group) {
  g.traverse((o) => ((o as THREE.Mesh).isMesh ? (o.castShadow = false) : 0));
  return g;
}

/** Simple blocky first-person model. The 'muzzle' child marks where shots/flash start. */
export function buildViewModel(id: string): THREE.Group {
  const g = new THREE.Group();
  if (id === 'pistol') {
    g.add(box(0.06, 0.08, 0.28, 0, 0, 0, dark)); // slide
    g.add(box(0.05, 0.1, 0.07, 0, -0.08, 0.08, mid)); // grip
  } else if (id === 'shotgun') {
    g.add(box(0.07, 0.09, 0.5, 0, 0, 0, dark)); // receiver
    g.add(box(0.05, 0.05, 0.55, 0, 0.015, -0.5, mid)); // barrel
    g.add(box(0.045, 0.04, 0.45, 0, -0.045, -0.45, dark)); // magazine tube
    g.add(box(0.075, 0.06, 0.2, 0, -0.055, -0.32, wood)); // pump
    g.add(box(0.06, 0.11, 0.26, 0, -0.03, 0.38, wood)); // stock
  } else if (id === 'smg') {
    return finishModel(buildSmg());
  } else if (id === 'sniper') {
    return finishModel(buildSniper());
  } else if (id === 'crossbow') {
    return finishModel(buildCrossbow());
  } else if (id === 'launcher') {
    return finishModel(buildLauncher());
  } else if (id === 'katana') {
    const steel = new THREE.MeshStandardMaterial({ color: 0xdfe6ee, roughness: 0.35, metalness: 0.3, emissive: 0x2a323a });
    const lacquer = new THREE.MeshStandardMaterial({ color: 0x1a1416, roughness: 0.6 });
    const brass = new THREE.MeshStandardMaterial({ color: 0xb8a050, roughness: 0.4, metalness: 0.8 });
    g.add(box(0.034, 0.04, 0.22, 0, 0, 0.06, lacquer)); // wrapped handle
    g.add(box(0.075, 0.075, 0.014, 0, 0, -0.06, brass)); // round guard (tsuba)
    g.add(box(0.012, 0.036, 0.62, 0, 0.002, -0.38, steel)); // long blade
    g.add(box(0.008, 0.014, 0.62, 0, 0.022, -0.38, mid)); // spine
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.09, 4), steel);
    tip.rotation.x = -Math.PI / 2;
    tip.position.set(0, 0.002, -0.735);
    g.add(tip);
  } else if (id === 'knife') {
    const steel = new THREE.MeshStandardMaterial({ color: 0xd6dbe0, roughness: 0.25, metalness: 0.9 });
    g.add(box(0.032, 0.04, 0.13, 0, 0, 0.02, dark)); // handle
    g.add(box(0.05, 0.012, 0.02, 0, 0.002, -0.05, mid)); // guard
    g.add(box(0.012, 0.034, 0.26, 0, 0.002, -0.19, steel)); // blade
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.017, 0.07, 4), steel); // point
    tip.rotation.x = -Math.PI / 2;
    tip.position.set(0, 0.002, -0.355);
    g.add(tip);
    g.add(box(0.008, 0.012, 0.22, 0, 0.022, -0.19, mid)); // spine
  } else {
    g.add(box(0.07, 0.1, 0.55, 0, 0, 0, dark)); // body
    g.add(box(0.04, 0.04, 0.3, 0, 0.01, -0.4, mid)); // barrel
    g.add(box(0.06, 0.16, 0.08, 0, -0.12, 0.05, mid)); // magazine
    g.add(box(0.06, 0.1, 0.22, 0, -0.02, 0.38, wood)); // stock
  }
  const muzzle = new THREE.Object3D();
  muzzle.name = 'muzzle';
  muzzle.position.set(0, 0.01, id === 'pistol' ? -0.16 : id === 'shotgun' ? -0.8 : -0.58);
  g.add(muzzle);
  g.traverse((o) => ((o as THREE.Mesh).isMesh ? (o.castShadow = false) : 0));
  return g;
}
