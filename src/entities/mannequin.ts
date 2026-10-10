import * as THREE from 'three';
import { buildBot, type BotRig } from './botModel';
import { onCharacterModels } from './glbRig';

/** What a bot needs to know about the world to wander around it. */
export interface Nav {
  heightAt: (x: number, z: number) => number;
  boxes: THREE.Box3[];
  /** Collision boxes near a point (use this in per-frame code instead of scanning `boxes`). */
  boxesNear: (x: number, z: number, r: number) => THREE.Box3[];
  /** The part of the map in play (the walls). */
  region: { x0: number; x1: number; z0: number; z1: number };
  /** Random walkable spot (not inside walls/crates/big rocks), optionally far from `avoid`. */
  randomFreePoint: (avoid?: THREE.Vector3, minDist?: number) => THREE.Vector3;
  /** Random walkable spot close to the outer walls. */
  randomEdgePoint: (avoid?: THREE.Vector3, minDist?: number) => THREE.Vector3;
}

/** How fighting bots act on the player (provided by main.ts). */
export interface BotHooks {
  hurtPlayer: (damage: number) => void;
  /** A bot fired a gun: draw the tracer + play the sound. */
  shotFired: (from: THREE.Vector3, to: THREE.Vector3) => void;
  /** A bot swung a knife. */
  stab: () => void;
  /** A heavy punch (Superman) wound up / landed: sound only. */
  punch?: (phase: 'wind' | 'hit' | 'miss') => void;
  lineOfSight: (from: THREE.Vector3, to: THREE.Vector3) => boolean;
  /** The boss calls a zombie out of the ground here. False if none is free. */
  summon?: (at: THREE.Vector3) => boolean;
  zombiesAlive?: () => number;
  /** A character speaks a recorded line (hit / death / casual chatter), see audio.ts voiceLine. */
  voice?: (id: string, kind: 'hit' | 'death' | 'casual' | 'summon' | 'throw' | 'pant', at: THREE.Vector3, owner?: object) => void;
  /** The boss hurls a boulder from its hand toward the player (game/projectiles.ts). */
  throwRock?: (from: THREE.Vector3, small?: boolean) => void;
  /** A scared bot cried out at this spot (optional: draws nothing, only plays a sound). */
  scream?: (at: THREE.Vector3) => void;
  /** Where to aim at the player (roughly the chest). */
  playerChest: () => THREE.Vector3;
  playerDead: () => boolean;
}

export interface Costume {
  id: string; // key into LOOKS in botModel.ts
  name: string;
  points: number; // score for a kill
  health: number;
  weight: number; // how often it spawns (relative)
  shirt: number; // main top colour
  pants: number;
  accent: number; // signature colour (tie, vest, cape, scarf, headband...)
  speedMul?: number; // walking speed multiplier (default 1)
  /** ranged = shoots back once shot; melee = attacks the player on sight. Default: harmless. */
  combat?: 'ranged' | 'melee';
  /** edge = usually spawns and patrols close to the outer walls. */
  zone?: 'edge';
  /** Never scared by the player, whatever happens (no running away, no retreating). */
  fearless?: boolean;
  /** First level in which this character can appear (default 1). */
  minLevel?: number;
  /** Body size multiplier (the boss is a giant). */
  scale?: number;
  /** The boss: keeps its distance, summons zombies, pants when you get close (see bossBrain). */
  boss?: boolean;
  /** A zombie type (the boss's summons and the horde levels): always hunts, never gives up, uses the zombie models. */
  zombie?: boolean;
  /** Something held in the hand (zombie models): a knife or a gun. */
  prop?: 'knife' | 'gun';
  /** Keeps its distance and throws rocks (see throwerBrain). */
  rocks?: boolean;
  /** Stats for `combat: 'melee'` bots. */
  melee?: MeleeStats;
  note: string; // shown in the Rules window
}

export interface MeleeStats {
  aggroRange: number; // notices the player (and attacks automatically) within this distance
  speed: number; // chase speed, m/s
  attackRange: number;
  damage: number;
  interval: number; // seconds between strikes
  giveUp: number; // stops chasing beyond this distance...
  giveUpTime: number; // ...for this many seconds
  calmCooldown: number; // then ignores the player for this long
  /** Only fights back once it has been shot (default: attacks on sight within aggroRange). */
  provoked?: boolean;
  /** Heavy hitter: seconds of visible wind-up before each blow (the player can step out of range). */
  windup?: number;
}
const KNIFE_CRIMINAL: MeleeStats = { aggroRange: 36, speed: 4.2, attackRange: 1.5, damage: 10, interval: 0.9, giveUp: 52, giveUpTime: 3, calmCooldown: 8 };
/** Ninja: much faster, strikes twice as often and far harder than a criminal, but is fragile. */
/**
 * Superman: only fights once shot. Then he walks up and winds up a punch that hits very hard (45), and afterwards
 * stands there catching his breath for a long time (interval), which is the player's window to shoot back.
 */
const SUPERMAN_PUNCH: MeleeStats = { aggroRange: 0, speed: 6.4, attackRange: 2.1, damage: 45, interval: 4.2, giveUp: 60, giveUpTime: 8, calmCooldown: 5, provoked: true, windup: 0.6 };
/** Zombies (summoned by the boss): slow, relentless, they always know where you are. */
const ZOMBIE_CLAW: MeleeStats = { aggroRange: 200, speed: 3.3, attackRange: 1.5, damage: 7, interval: 1.0, giveUp: 9999, giveUpTime: 9999, calmCooldown: 0 };
/** Horde zombies (levels 22-30): runners are fast and weak, brutes slow and brutal, stabbers carry a knife. */
const ZOMBIE_RUNNER: MeleeStats = { aggroRange: 300, speed: 5.9, attackRange: 1.3, damage: 5, interval: 0.55, giveUp: 9999, giveUpTime: 9999, calmCooldown: 0 };
const ZOMBIE_BRUTE: MeleeStats = { aggroRange: 300, speed: 2.1, attackRange: 2.2, damage: 26, interval: 1.7, giveUp: 9999, giveUpTime: 9999, calmCooldown: 0, windup: 0.55 };
const ZOMBIE_STABBER: MeleeStats = { aggroRange: 300, speed: 4.1, attackRange: 1.6, damage: 12, interval: 0.7, giveUp: 9999, giveUpTime: 9999, calmCooldown: 0 };
const ZOMBIE_GUNNER: MeleeStats = { aggroRange: 300, speed: 3.4, attackRange: 0, damage: 0, interval: 1, giveUp: 9999, giveUpTime: 9999, calmCooldown: 0 }; // only the aggro range is used
const ZOMBIE_THROW = { keepMin: 11, keepMax: 30, every: [3, 4.6], wind: 0.9, minDist: 8, maxDist: 55, speed: 3 };
/** The boss only swats at you when you crowd it (weak): its danger is the zombies it calls. */
const BOSS_SWAT: MeleeStats = { aggroRange: 0, speed: 2.6, attackRange: 4.6, damage: 15, interval: 1.3, giveUp: 9999, giveUpTime: 9999, calmCooldown: 0, windup: 1 };
const BOSS = { keepMin: 17, keepMax: 32, tiredDist: 6.5, closeDist: 5, summonNear: 10, pant: 3.2, pantCd: 9, fleeSpeed: 3.6, approach: 2.6, summonEvery: [6, 8.5], summonRage: [3.5, 5], maxZombies: 8, maxRage: 10, perCast: 2, perCastRage: 3, rockMin: 24, rockMax: 85, rockEvery: [4.5, 6.5], rockWind: 1.2 };
const NINJA_STRIKER: MeleeStats = { aggroRange: 30, speed: 6, attackRange: 1.7, damage: 24, interval: 0.45, giveUp: 55, giveUpTime: 3, calmCooldown: 6 };

export const COSTUMES: Costume[] = [
  { id: 'regular', name: 'Regular', health: 100, points: 100, weight: 3, shirt: 0xd9d4c7, pants: 0x4a5f82, accent: 0x8c8a85, note: 'Harmless, runs away when shot' },
  { id: 'winter', name: 'Winter', health: 115, points: 110, weight: 2, shirt: 0x8a3a3a, pants: 0x4d4d57, accent: 0xeeeeee, note: 'Harmless, runs away when shot' },
  { id: 'builder', name: 'Builder', health: 140, points: 120, weight: 2, shirt: 0xe7a51c, pants: 0x3b4a63, accent: 0xc7f03a, note: 'Harmless, tough, runs away when shot' },
  { id: 'sporty', name: 'Sporty', health: 105, points: 130, weight: 2, shirt: 0x3fa35a, pants: 0x222222, accent: 0xffffff, speedMul: 1.7, note: 'Harmless, walks fast, runs away when shot' },
  { id: 'chef', name: 'Chef', health: 95, points: 140, weight: 1.5, shirt: 0xf4f4f0, pants: 0x3a3a3a, accent: 0xffffff, note: 'Harmless, runs away when shot' },
  { id: 'rich', name: 'Rich guy', health: 90, points: 150, weight: 1.5, shirt: 0x2f3b52, pants: 0x20242e, accent: 0xb02a2a, note: 'Harmless, runs away when shot' },
  { id: 'cowboy', name: 'Cowboy', health: 125, points: 160, weight: 1.2, shirt: 0xa5522d, pants: 0x4a3a2a, accent: 0x5b3a1e, combat: 'ranged', fearless: true, minLevel: 5, note: 'Never flees: shoots back when shot, dodges' },
  { id: 'soldier', name: 'Soldier', health: 170, points: 170, weight: 1, shirt: 0x5a6b3a, pants: 0x4b5a32, accent: 0x3b4528, fearless: true, minLevel: 7, note: 'Harmless, very tough, never flees: stares you down when shot' },
  { id: 'superman', name: 'Superman', health: 250, points: 180, weight: 1, shirt: 0x2d5ea8, pants: 0x2d5ea8, accent: 0xc22d2d, speedMul: 1.9, combat: 'melee', melee: SUPERMAN_PUNCH, fearless: true, minLevel: 10, note: 'Harmless until shot, then a huge slow punch (45 dmg) and a long rest: dodge it and shoot back' },
  { id: 'zombie', name: 'Zombie', health: 70, points: 40, weight: 0, shirt: 0x4a5a3a, pants: 0x3a3a30, accent: 0x6a7a50, combat: 'melee', melee: ZOMBIE_CLAW, fearless: true, zombie: true, minLevel: 999, note: 'Summoned by the boss: slow, relentless' },
  { id: 'zombie_runner', name: 'Runner Zombie', health: 40, points: 30, weight: 0, scale: 0.72, shirt: 0x4a5a3a, pants: 0x3a3a30, accent: 0x6a7a50, combat: 'melee', melee: ZOMBIE_RUNNER, fearless: true, zombie: true, minLevel: 999, note: 'Horde: small and very fast, hard to hit' },
  { id: 'zombie_brute', name: 'Brute Zombie', health: 260, points: 120, weight: 0, scale: 1.4, shirt: 0x4a5a3a, pants: 0x3a3a30, accent: 0x6a7a50, combat: 'melee', melee: ZOMBIE_BRUTE, fearless: true, zombie: true, minLevel: 999, note: 'Horde: big and slow, but every blow is heavy' },
  { id: 'zombie_stabber', name: 'Knife Zombie', health: 80, points: 60, weight: 0, shirt: 0x4a5a3a, pants: 0x3a3a30, accent: 0x6a7a50, combat: 'melee', melee: ZOMBIE_STABBER, fearless: true, zombie: true, prop: 'knife', minLevel: 999, note: 'Horde: runs at you with a knife' },
  { id: 'zombie_thrower', name: 'Thrower Zombie', health: 90, points: 90, weight: 0, shirt: 0x4a5a3a, pants: 0x3a3a30, accent: 0x6a7a50, combat: 'melee', melee: ZOMBIE_GUNNER, fearless: true, zombie: true, rocks: true, minLevel: 999, note: 'Horde: keeps away and lobs rocks' },
  { id: 'zombie_gunner', name: 'Gun Zombie', health: 70, points: 90, weight: 0, shirt: 0x4a5a3a, pants: 0x3a3a30, accent: 0x6a7a50, combat: 'ranged', melee: ZOMBIE_GUNNER, fearless: true, zombie: true, prop: 'gun', minLevel: 999, note: 'Horde: shoots from a distance' },
  { id: 'boss', name: 'The Colossus', health: 2400, points: 2000, weight: 0, shirt: 0x3a2448, pants: 0x241830, accent: 0xb02a2a, combat: 'melee', melee: BOSS_SWAT, fearless: true, boss: true, scale: 2.1, minLevel: 999, note: 'Final boss: keeps away, summons zombies, pants when you get close' },
  { id: 'criminal', name: 'Criminal', health: 130, points: 200, weight: 1.3, shirt: 0x1c1c20, pants: 0x2c2c32, accent: 0xf0f0f0, combat: 'melee', melee: KNIFE_CRIMINAL, zone: 'edge', minLevel: 4, note: 'Patrols the walls, attacks on sight with a knife, hits and backs off' },
  { id: 'ninja', name: 'Ninja', health: 70, points: 220, weight: 0.7, shirt: 0x17171a, pants: 0x17171a, accent: 0xc42b2b, combat: 'melee', melee: NINJA_STRIKER, minLevel: 14, fearless: true, note: 'From level 14. Attacks on sight, zig-zags: fast and deadly, but fragile' },
];

/** Which costumes may spawn (set per level by main.ts). Null = all. */
let spawnRule: ((c: Costume) => boolean) | null = null;
export function setSpawnRule(rule: ((c: Costume) => boolean) | null) {
  spawnRule = rule;
}
/** The armed characters are limited: at most this many alive at once, and a cooldown after one has been killed. */
export const COSTUME_CAP: Record<string, number> = { criminal: 2, cowboy: 2 };
const RESPAWN_COOLDOWN = 25; // seconds before a killed capped character can spawn again
const cooldownUntil = new Map<string, number>();
const nowSec = () => performance.now() / 1000;
export function clearSpawnCooldowns() {
  cooldownUntil.clear();
}
function pickCostume(self: Mannequin, crowd: Mannequin[]): Costume {
  const open = (c: Costume) => {
    const cap = COSTUME_CAP[c.id];
    if (cap === undefined) return true;
    if (nowSec() < (cooldownUntil.get(c.id) ?? 0)) return false;
    return crowd.filter((m) => m !== self && m.alive && m.costume?.id === c.id).length < cap;
  };
  const base = spawnRule ? COSTUMES.filter(spawnRule) : COSTUMES;
  const pool = base.filter((c) => c.weight > 0 && open(c));
  const list = pool.length ? pool : COSTUMES;
  let r = Math.random() * list.reduce((s, c) => s + c.weight, 0);
  for (const c of list) if ((r -= c.weight) <= 0) return c;
  return list[0];
}

// ---- combat tunables ----
// civilians (the harmless bots) panic when shot, when a gun goes off near them, or when someone dies near them
const FLEE_SPEED = 5.8; // m/s: slower than the player's sprint (9), faster than his walk (6)
const BRAVERY: Record<string, number> = { soldier: 0.5, builder: 0.3, superman: 0.4, sporty: -0.1, chef: -0.2, rich: -0.2 }; // adds to a random 0..0.5
const COWBOY = { idealDist: 13, minDist: 6, maxRange: 38, damage: 9, speed: 3.4, interval: [1.0, 1.6], giveUp: 65, giveUpTime: 6 };

const RADIUS = 0.35; // bot collision radius
const WITNESS_RADIUS = 6; // a character that is shot or dies only scares those this close (gunshots alone scare nobody)
const BAR_HIDE_AFTER = 30; // seconds without being hit before the health bar disappears
export const angleDiff = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/** Push a walker out of crates / pillars / walls / big rocks and keep it in the arena. True if it was pushed. */
export function pushOutOfBoxes(nav: Nav, p: THREE.Vector3, radius: number): boolean {
  let pushed = false;
  const gy = nav.heightAt(p.x, p.z);
  for (const b of nav.boxesNear(p.x, p.z, radius + 0.6)) {
    if (b.max.y <= gy + 0.25) continue; // low bumps can be walked over
    const minX = b.min.x - radius, maxX = b.max.x + radius;
    const minZ = b.min.z - radius, maxZ = b.max.z + radius;
    if (p.x <= minX || p.x >= maxX || p.z <= minZ || p.z >= maxZ) continue;
    const dx = Math.min(p.x - minX, maxX - p.x);
    const dz = Math.min(p.z - minZ, maxZ - p.z);
    if (dx < dz) p.x = p.x - minX < maxX - p.x ? minX : maxX;
    else p.z = p.z - minZ < maxZ - p.z ? minZ : maxZ;
    pushed = true;
  }
  const r = nav.region; // never leave the arena
  p.x = THREE.MathUtils.clamp(p.x, r.x0 + 1.5, r.x1 - 1.5);
  p.z = THREE.MathUtils.clamp(p.z, r.z0 + 1.5, r.z1 - 1.5);
  return pushed;
}

const NO_HOOKS: BotHooks = {
  scream: () => {},
  punch: () => {},
  hurtPlayer: () => {},
  shotFired: () => {},
  stab: () => {},
  lineOfSight: () => true,
  playerChest: () => new THREE.Vector3(),
  playerDead: () => false,
};

const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;

/** How a bot is behaving. Harmless bots use all four; armed bots only use 'calm' (their fight AI is separate). */
type Mode = 'calm' | 'startle' | 'flee' | 'cower';

export class Mannequin {
  /** Every bot, so they can keep apart, spread panic and hear each other. */
  private static crowd: Mannequin[] = [];

  /** A gun went off / a bot died at `origin`: harmless bots within `radius` panic (closer = more likely). */
  static scareNear(origin: THREE.Vector3, radius: number, except?: Mannequin) {
    for (const m of Mannequin.crowd) {
      if (m === except || !m.alive || m.costume.combat) continue;
      const d = Math.hypot(m.group.position.x - origin.x, m.group.position.z - origin.z);
      if (d < radius && Math.random() < 1.15 - d / radius) m.panic(false);
    }
  }

  readonly group = new THREE.Group();
  readonly hitMeshes: THREE.Mesh[] = [];
  maxHealth = 100; // set from the costume in reset()
  health = 100;
  alive = true;
  costume!: Costume;
  /** Cowboys / criminals that are currently going after the player. */
  aggravated = false;
  /** Name / kill points, shared interface with Wolf so shooting code treats both alike. */
  get label() {
    return this.costume.name;
  }
  get points() {
    return this.costume.points;
  }
  /** Id used by missions ("kill 3 cowboys"). */
  get kind() {
    return this.costume.id;
  }
  /** True for characters that can hurt the player (shown in red on the name tag). */
  get hostile() {
    return !!this.costume.combat;
  }

  private body = new THREE.Group();
  private rig: BotRig | null = null;
  private armRestZ = [0, 0];
  private barBg = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x000000, transparent: true, opacity: 0.6, depthWrite: false }));
  private barFill = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x44dd55, depthWrite: false }));
  private deadTime = 0;
  private flash = 0;
  private sinceHit = 0; // seconds since this bot was last damaged
  private baseScale = 1;
  private seed = Math.random() * 100; // desynchronises idle animations between bots

  // wandering
  private state: 'idle' | 'walk' = 'idle';
  private idleT = 0;
  private target = new THREE.Vector3();
  private speed = 1.6;
  private heading = Math.random() * Math.PI * 2;
  private phase = 0; // walk-cycle
  private amp = 0; // walk-cycle strength 0..1
  private blockedT = 0;
  private walkT = 0;
  private clock = 0;

  // brain (civilians): fear, running away
  private mode: Mode = 'calm';
  private modeT = 0; // time left in 'startle' / 'cower'
  private fearT = 0; // how much longer this bot stays scared
  private wary = 0; // after calming down it stays jumpy for a while
  private waryTick = 0;
  private bravery = 0;
  private steerT = 0;
  private runHeading = 0;
  private probe = new THREE.Vector3();
  private retreatT = 0; // armed bots that are badly hurt run for cover for this long
  private retreated = false;
  private alertT = 0; // fearless bots that were shot stand and stare at the player for this long
  /** Dies for good (summoned zombies): after lying there it is switched off instead of respawning. */
  oneLife = false;
  private bossSummonT = 4;
  private bossPantCd = 0;
  private bossRockT = 5;
  private rootT = 0;
  private chatT = 8;
  private hitVoiceT = 0;
  private bossAct: 'summon' | 'throw' = 'summon';
  private windT = 0; // heavy punch wind-up
  private windDur = 0.6;
  private recoverT = 0; // catching breath after a heavy punch
  private recoverDur = 1;
  private kv = new THREE.Vector3(); // knockback velocity (shoved by hits / explosions); y = upward
  private air = 0; // height above the ground while thrown into the air
  private stunT = 0; // knocked about: the AI is suspended for this long

  // idle gestures
  private gesture = 0;
  private gestureT = 0;
  private gestureDur = 0;
  private gestureK = 0;

  // pose blending
  private pStartle = 0;
  private pCower = 0;
  private pPanic = 0;
  private headYaw = 0;
  private flinch = 0;

  // fighting (cowboys / criminals)
  private farT = 0;
  private calmCd = 0; // criminals ignore the player for a while after giving up
  private attackCd = 0;
  private lunge = 0; // stab animation timer
  private lungeDur = 0.32;
  private backT = 0; // criminals step back after a stab (hit and run)
  private aim = 0; // 0..1 how far the gun arm is raised
  private kick = 0; // gun recoil animation
  private hasLos = false;
  private losT = 0;
  private strafeDir = 1;
  private strafeT = 0;
  private strafeSpeed = 1.8;
  private dodgeT = 0;
  private dodgeDir = 1;
  private detourT = 0;
  private detourDir = 1;
  private moveSpeedNow = 0;

  constructor(
    private nav: Nav,
    start: THREE.Vector3,
    private player: THREE.Vector3,
    private hooks: BotHooks = NO_HOOKS,
    private respawnDelay = 4,
    initial?: string,
  ) {
    this.group.rotation.order = 'YXZ'; // yaw first, then tip over around the bot's own axis
    this.group.add(this.body);
    this.barBg.scale.set(0.7, 0.09, 1);
    this.barFill.scale.set(0.66, 0.055, 1);
    this.barBg.position.set(0, 2.15, 0);
    this.barFill.position.set(0, 2.15, 0);
    this.barBg.renderOrder = 10;
    this.barFill.renderOrder = 11;
    this.group.add(this.barBg, this.barFill);
    this.group.position.copy(start);
    Mannequin.crowd.push(this);
    // the boss / zombies are downloaded models: swap one in as soon as it is available
    if (initial === 'boss') onCharacterModels(() => {
      if (!this.rig?.post) this.build();
    });
    this.reset(false, initial ? COSTUMES.find((c) => c.id === initial) : undefined);
  }

  /** Fresh bot: random costume, face and build, full health, somewhere new if `relocate`. */
  /** Switched off for this level (small arenas have fewer people): invisible, not hittable, not simulated until reset(). */
  disabled = false;
  disable() {
    this.disabled = true;
    this.alive = false;
    this.group.visible = false;
    this.updateBar();
  }

  reset(relocate = false, forced?: Costume) {
    this.disabled = false;
    if (relocate) this.group.position.copy(this.nav.randomFreePoint(this.player, 20));
    this.alive = true;
    this.deadTime = 0;
    this.group.rotation.set(0, 0, 0);
    this.body.position.set(0, 0, 0);
    this.body.rotation.set(0, 0, 0);
    this.heading = Math.random() * Math.PI * 2;
    this.group.visible = true;
    this.state = 'idle';
    this.idleT = Math.random() * 1.5;
    this.amp = 0;
    this.costume = forced ?? pickCostume(this, Mannequin.crowd);
    this.baseScale = (0.94 + Math.random() * 0.14) * (this.costume.scale ?? 1);
    this.group.scale.setScalar(this.baseScale);
    this.resetBrain();
    // criminals usually start near the outer walls, away from the middle of the map
    if (this.costume.zone === 'edge' && Math.random() < 0.85) {
      this.group.position.copy(this.nav.randomEdgePoint(this.player, 25));
    }
    this.maxHealth = this.health = this.costume.health;
    this.sinceHit = 0;
    this.updateBar();
    this.build();
  }

  /** Calm, unhurt state of mind (new life or new costume). */
  private resetBrain() {
    this.aggravated = false;
    this.farT = this.calmCd = this.attackCd = this.lunge = this.aim = this.kick = this.backT = this.dodgeT = 0;
    this.mode = 'calm';
    this.modeT = this.fearT = this.wary = this.retreatT = this.flinch = this.alertT = this.windT = this.recoverT = 0;
    this.retreated = false;
    this.bossSummonT = 4;
    this.bossPantCd = 0;
    this.bossRockT = 5;
    this.rootT = 0;
    this.chatT = rnd(5, 18);
    this.hitVoiceT = 0;
    this.pStartle = this.pCower = this.pPanic = this.gestureK = 0;
    this.gesture = 0;
    this.kv.set(0, 0, 0);
    this.air = 0;
    this.stunT = 0;
    this.bravery = clamp(Math.random() * 0.5 + (BRAVERY[this.costume.id] ?? 0), 0, 1);
  }

  /** Floating health bar, only shown once the bot has taken damage. */
  private updateBar() {
    const ratio = Math.max(0, this.health / this.maxHealth);
    this.barFill.scale.x = 0.66 * ratio;
    // anchor in screen space so the fill stays left-aligned however the bot is turned
    this.barFill.center.set(ratio > 0 ? 0.5 / ratio : 0.5, 0.5);
    this.barFill.material.color.setHSL(0.33 * ratio, 0.75, 0.5);
    this.barBg.visible = this.barFill.visible = this.alive && ratio < 1 && this.sinceHit < BAR_HIDE_AFTER && !this.costume.boss; // the boss has its own bar on the HUD
  }

  private build() {
    if (this.rig) {
      this.body.remove(this.rig.root);
      this.rig.dispose();
    }
    this.rig = buildBot(this, this.costume);
    this.armRestZ = this.rig.arms.map((a) => a.rotation.z);
    this.body.add(this.rig.root);
    this.hitMeshes.length = 0;
    this.hitMeshes.push(...this.rig.hitMeshes);
    this.shadowMeshes = [];
    this.rig.root.traverse((o) => ((o as THREE.Mesh).isMesh ? this.shadowMeshes.push(o as THREE.Mesh) : 0));
    this.shadowsOn = true;
  }

  private shadowMeshes: THREE.Mesh[] = [];
  private shadowsOn = true;
  /** Far-away bots do not need to cast shadows (saves a lot in the shadow pass). */
  setShadows(on: boolean) {
    if (on === this.shadowsOn) return;
    this.shadowsOn = on;
    for (const m of this.shadowMeshes) m.castShadow = on;
  }

  /** Start going after the player (cowboys when shot, criminals on sight). */
  aggravate() {
    if (!this.alive || !this.costume.combat || this.aggravated) return;
    this.aggravated = true;
    this.farT = 0;
    this.losT = 0;
    this.attackCd = this.costume.combat === 'ranged' ? rnd(0.45, 0.9) : this.costume.melee?.provoked ? 0.5 : 0; // takes a moment to draw
  }

  /**
   * A harmless bot gets scared: it freezes for a moment, then runs away from the player.
   * `direct` = it was hit itself (scared for longer, and it screams).
   */
  panic(direct: boolean) {
    if (!this.alive || this.costume.combat || this.costume.fearless) return;
    const brave = 1 - this.bravery * 0.35;
    this.fearT = Math.max(this.fearT, direct ? rnd(55, 65) : rnd(18, 28) * brave); // shot: afraid until a minute passes without being shot again; a witness calms down sooner
    if (this.mode === 'calm') {
      this.mode = 'startle';
      this.modeT = (direct ? rnd(0.08, 0.25) : rnd(0.25, 0.7)) * (0.5 + this.bravery);
      this.state = 'idle';
      this.gesture = 0;
      if (direct || Math.random() < 0.4) this.hooks.scream?.(this.group.position);
    } else if (this.mode === 'cower' && direct) {
      this.modeT = Math.min(this.modeT, 0.3); // shot while hiding: bolt
    }
  }

  /** Apply damage. Returns true if this hit killed it. */
  damage(amount: number): boolean {
    if (!this.alive) return false;
    this.health -= amount;
    this.flash = 0.12;
    this.flinch = 0.35;
    this.sinceHit = 0;
    if (this.health > 0) Mannequin.scareNear(this.group.position, WITNESS_RADIUS, this); // right next to someone being shot
    if (this.health > 0 && this.hitVoiceT <= 0) {
      this.hitVoiceT = 1.6;
      this.hooks.voice?.(this.costume.id, 'hit', this.group.position, this);
    }
    if (this.health <= 0) {
      this.alive = false;
      if (COSTUME_CAP[this.costume.id] !== undefined) cooldownUntil.set(this.costume.id, nowSec() + RESPAWN_COOLDOWN);
      this.deadTime = 0;
      // shoved away from the player as it falls
      const away = new THREE.Vector3(this.group.position.x - this.player.x, 0, this.group.position.z - this.player.z).setLength(1.6);
      this.kv.add(away); // shoved away from the player as it falls
      this.updateBar();
      this.hooks.voice?.(this.costume.id, 'death', this.group.position, this);
      Mannequin.scareNear(this.group.position, WITNESS_RADIUS, this); // only people right next to it panic
      return true;
    }
    if (this.costume.combat) {
      this.aggravate(); // cowboys (and criminals) react to being shot
      const ranged = this.costume.combat === 'ranged';
      const low = this.health / this.maxHealth < (ranged ? 0.3 : 0.2);
      if (!this.costume.fearless && !this.retreated && this.aggravated && low && Math.random() < (ranged ? 0.7 : 0.35)) {
        this.retreated = true;
        this.retreatT = rnd(3, 5); // runs for cover, then comes back
      }
      if (ranged && Math.random() < 0.5) {
        this.dodgeT = 0.35; // jumps sideways when hit
        this.dodgeDir = Math.random() < 0.5 ? -1 : 1;
      }
    } else if (this.costume.fearless) {
      this.alertT = 6; // not afraid: turns and stares the shooter down
    } else {
      this.panic(true);
    }
    this.updateBar();
    return false;
  }

  /** Turn this bot into a specific character (so a level always has the characters its missions ask for). */
  forceCostume(id: string) {
    const c = COSTUMES.find((x) => x.id === id);
    if (!c) return;
    this.costume = c;
    this.maxHealth = this.health = c.health;
    this.resetBrain();
    this.sinceHit = 0;
    if (c.zone === 'edge') this.group.position.copy(this.nav.randomEdgePoint(this.player, 25));
    this.updateBar();
    this.build();
  }

  /**
   * Shove this character (hits, explosions): `v` is a velocity change in m/s. Strong shoves throw it off its feet:
   * it flies through the air and the AI is suspended while it is stunned. Works on dead bodies too.
   */
  impulse(v: THREE.Vector3) {
    this.kv.add(v);
    const h = Math.hypot(this.kv.x, this.kv.z);
    if (h > 16) {
      this.kv.x *= 16 / h;
      this.kv.z *= 16 / h;
    }
    this.kv.y = Math.min(this.kv.y, 11);
    const strength = this.kv.length(); // the total shove it is under now (a shotgun blast = many small pellets)
    if (this.alive && strength > 2.5) this.stunT = Math.max(this.stunT, Math.min(1.2, 0.25 + strength * 0.05));
  }

  /** Knockback physics: slide, fly, fall back to the ground. True while the body is moving by itself. */
  private physics(dt: number): boolean {
    const p = this.group.position;
    const flying = this.air > 0 || this.kv.y > 0;
    const horiz = Math.hypot(this.kv.x, this.kv.z);
    if (!flying && horiz < 0.05) {
      this.kv.set(0, 0, 0);
      return false;
    }
    p.x += this.kv.x * dt;
    p.z += this.kv.z * dt;
    pushOutOfBoxes(this.nav, p, RADIUS);
    const damp = Math.exp(-(flying ? 0.25 : 6) * dt); // little drag in the air, strong friction on the ground
    this.kv.x *= damp;
    this.kv.z *= damp;
    if (flying) {
      this.kv.y -= 22 * dt;
      this.air += this.kv.y * dt;
      if (this.air <= 0) {
        this.air = 0;
        if (this.kv.y < -5 && this.alive) this.stunT = Math.max(this.stunT, 0.4); // hard landing
        this.kv.y = this.kv.y < -6 ? -this.kv.y * 0.25 : 0; // a small bounce on a heavy landing
        this.kv.x *= 0.6;
        this.kv.z *= 0.6;
      }
    }
    return true;
  }

  // ---------- wandering ----------
  private pickTarget() {
    const p = this.group.position;
    const edge = this.costume.zone === 'edge';
    const pick = () => (edge ? this.nav.randomEdgePoint() : this.nav.randomFreePoint());
    let t = pick();
    for (let i = 0; i < 8; i++) {
      const d = Math.hypot(t.x - p.x, t.z - p.z);
      if (d > 4 && d < 50) break; // prefer a real walk, not a shuffle
      t = pick();
    }
    this.target.copy(t);
    this.speed = (1.2 + Math.random() * 1.1) * (this.costume.speedMul ?? 1);
    this.state = 'walk';
    this.blockedT = 0;
    this.walkT = 0;
  }

  /** Standing around: sometimes stretch, check a watch, wave at a passer-by, scratch the head... */
  private startIdle(pause: number) {
    this.state = 'idle';
    this.idleT = pause;
    if (Math.random() < 0.5) {
      const nearPlayer = Math.hypot(this.player.x - this.group.position.x, this.player.z - this.group.position.z) < 16;
      // 1 stretch, 2 look at watch, 3 hands on hips, 4 wave (only when the player is around), 5 scratch head
      this.gesture = nearPlayer ? 1 + Math.floor(Math.random() * 5) : 1 + Math.floor(Math.random() * 3) + (Math.random() < 0.3 ? 4 : 0);
      this.gestureDur = rnd(1.6, 2.6);
      this.gestureT = 0;
      this.idleT = Math.max(pause, this.gestureDur + 0.2);
    } else this.gesture = 0;
  }

  /** Idle / walk between random spots. Returns the current walking speed (0 when standing). */
  private moveWander(dt: number) {
    const p = this.group.position;
    if (this.state === 'idle') {
      this.idleT -= dt;
      if (this.idleT <= 0) {
        this.gesture = 0;
        this.pickTarget();
      }
    } else {
      this.walkT += dt;
      const dx = this.target.x - p.x, dz = this.target.z - p.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.5 || this.walkT > 20) {
        this.startIdle(Math.random() < 0.3 ? 0 : 0.4 + Math.random() * 2.2);
      } else {
        // turn toward the goal, walk once roughly facing it
        const want = Math.atan2(dx, dz);
        const diff = angleDiff(this.heading, want);
        this.heading += THREE.MathUtils.clamp(diff, -6 * dt, 6 * dt);
        const facing = Math.max(0, Math.cos(diff));
        const step = this.speed * facing * dt;
        const bx = p.x, bz = p.z;
        p.x += Math.sin(this.heading) * step;
        p.z += Math.cos(this.heading) * step;
        pushOutOfBoxes(this.nav, p, RADIUS);
        const moved = Math.hypot(p.x - bx, p.z - bz);
        // blocked by something: give up on this target
        this.blockedT = step > 1e-4 && moved < step * 0.5 ? this.blockedT + dt : 0;
        if (this.blockedT > 0.4) {
          this.state = 'idle';
          this.idleT = 0; // immediately choose another direction
        }
      }
    }
    return this.state === 'walk' && this.blockedT === 0 ? this.speed : 0;
  }

  // ---------- movement helpers ----------
  /** Move in a world direction (not necessarily where the bot faces). True if something blocked it. */
  private moveBy(dirX: number, dirZ: number, speed: number, dt: number) {
    const p = this.group.position;
    const len = Math.hypot(dirX, dirZ) || 1;
    const bx = p.x, bz = p.z;
    const step = speed * dt;
    p.x += (dirX / len) * step;
    p.z += (dirZ / len) * step;
    pushOutOfBoxes(this.nav, p, RADIUS);
    return step > 1e-4 && Math.hypot(p.x - bx, p.z - bz) < step * 0.5;
  }

  /** 0..1: how far a straight run in this direction gets before a crate, rock or wall (probed up to `len` metres). */
  private clearance(angle: number, len: number) {
    const p = this.group.position;
    const sx = Math.sin(angle), sz = Math.cos(angle);
    const STEP = 0.6; // fine enough that thin walls (houses) cannot be skipped over
    const n = Math.ceil(len / STEP);
    for (let k = 1; k <= n; k++) {
      const d = k * STEP;
      this.probe.set(p.x + sx * d, p.y, p.z + sz * d);
      const bx = this.probe.x, bz = this.probe.z;
      pushOutOfBoxes(this.nav, this.probe, RADIUS + 0.15);
      if (Math.hypot(this.probe.x - bx, this.probe.z - bz) > 0.02) return (k - 1) / n;
    }
    return 1;
  }

  /** How close (0 = fine .. ~2 = in a corner / outside) a spot is to the arena walls. */
  private wallPenalty(x: number, z: number) {
    const r = this.nav.region;
    const pen = (d: number) => clamp((7 - d) / 7, 0, 1.5);
    return pen(Math.min(x - r.x0, r.x1 - x)) + pen(Math.min(z - r.z0, r.z1 - z)); // a corner counts twice
  }

  /**
   * Best direction to run: away from the threat, but around obstacles and, above all, away from the walls and
   * corners (a runner that heads for a corner is trapped). `escape` = it is stuck: head back into the open instead.
   */
  private pickRunHeading(away: number, escape = false) {
    const p = this.group.position;
    const r = this.nav.region;
    const toCentre = Math.atan2((r.x0 + r.x1) / 2 - p.x, (r.z0 + r.z1) / 2 - p.z);
    const base = escape ? toCentre : away;
    let best = base;
    let bestScore = -Infinity;
    const near = this.wallPenalty(p.x, p.z); // near a wall: stop insisting on 'straight away' and run along it instead
    for (const o of [0, 0.45, -0.45, 0.9, -0.9, 1.5, -1.5, 2.3, -2.3, Math.PI]) {
      const a = base + o;
      const ex = p.x + Math.sin(a) * 7, ez = p.z + Math.cos(a) * 7;
      const gain = Math.hypot(ex - this.player.x, ez - this.player.z) - Math.hypot(p.x - this.player.x, p.z - this.player.z); // moves it away from the threat?
      const score =
        (escape ? 0 : (Math.cos(angleDiff(away, a)) * 0.9) / (1 + near * 2)) +
        this.clearance(a, 7) * (escape ? 3.5 : 1.6) -
        this.wallPenalty(ex, ez) * 1.5 +
        (escape ? 0 : Math.cos(angleDiff(this.heading, a)) * (0.7 + 0.5 * Math.min(near, 1.5))) +
        clamp(gain, -7, 7) * (escape ? 0.12 : 0.06);
      if (score > bestScore) {
        bestScore = score;
        best = a;
      }
    }
    return best;
  }

  private escapeT = 0;
  /** One step of running away from `from`. Returns the speed it actually moved at. */
  private runFrom(dt: number, from: THREE.Vector3, speed: number) {
    const p = this.group.position;
    this.steerT -= dt;
    this.escapeT -= dt;
    // pressed against a wall / corner / crate: break out toward open ground and stick to that for a moment
    if (this.blockedT > 0.2 && this.escapeT <= 0) {
      this.runHeading = this.pickRunHeading(Math.atan2(p.x - from.x, p.z - from.z), true);
      this.escapeT = 1.3;
      this.steerT = 1.3;
      this.blockedT = 0;
    } else if (this.steerT <= 0) {
      this.steerT = rnd(0.15, 0.3);
      this.runHeading = this.pickRunHeading(Math.atan2(p.x - from.x, p.z - from.z));
    }
    const diff = angleDiff(this.heading, this.runHeading);
    this.heading += clamp(diff, -10 * dt, 10 * dt);
    const facing = Math.max(0.35, Math.cos(diff));
    const blocked = this.moveBy(Math.sin(this.heading), Math.cos(this.heading), speed * facing, dt);
    this.blockedT = blocked ? this.blockedT + dt : Math.max(0, this.blockedT - dt * 2);
    return speed * facing;
  }

  /** Bots are solid: gently push apart so they do not walk through each other. */
  private separate() {
    const p = this.group.position;
    for (const o of Mannequin.crowd) {
      if (o === this || !o.alive) continue;
      const dx = p.x - o.group.position.x, dz = p.z - o.group.position.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.8 && d > 1e-4) {
        const push = (0.8 - d) * 0.5;
        p.x += (dx / d) * push;
        p.z += (dz / d) * push;
      }
    }
  }

  /**
   * Hit by a crossbow bolt: frozen for 2 s and it loses the player for 5 s (it calms down and ignores him; being shot
   * again makes it attack right away). The boss is immune to the freeze, but it stops throwing boulders for 5 s.
   */
  crossbowHit() {
    if (!this.alive) return;
    if (this.costume.boss) {
      this.bossRockT = Math.max(this.bossRockT, 5);
      return;
    }
    this.rootT = 2;
    if (this.costume.combat) {
      this.aggravated = false;
      this.retreatT = 0;
      this.windT = this.recoverT = 0;
      this.aim = 0;
      this.calmCd = Math.max(this.calmCd, 5);
    }
  }

  /** Idle small talk: now and then a calm character says something when the player is within earshot. */
  private chatter(dt: number, dist: number) {
    this.hitVoiceT -= dt;
    this.chatT -= dt;
    if (this.chatT > 0) return;
    this.chatT = rnd(14, 30);
    if (dist < 16) this.hooks.voice?.(this.costume.id, 'casual', this.group.position, this);
  }

  // ---------- civilians (the harmless bots) ----------
  private civilian(dt: number): number {
    const p = this.group.position;
    const dx = this.player.x - p.x, dz = this.player.z - p.z;
    const dist = Math.hypot(dx, dz);
    if (this.fearT > 0) this.fearT -= dt;
    const playerDead = this.hooks.playerDead();
    if (this.mode === 'calm') this.chatter(dt, dist);
    else this.hitVoiceT -= dt;

    switch (this.mode) {
      case 'calm': {
        if (this.alertT > 0) {
          this.alertT -= dt;
          this.heading += clamp(angleDiff(this.heading, Math.atan2(dx, dz)), -9 * dt, 9 * dt);
          return 0;
        }
        // jumpy for a while after a scare: the player coming close sets them off again
        if (this.wary > 0) {
          this.wary -= dt;
          this.waryTick -= dt;
          if (this.waryTick <= 0) {
            this.waryTick = 0.4;
            if (dist < 6 && !playerDead) this.panic(false);
          }
        }
        // personal space: step away from a player who walks right up to them
        if (dist < 2 && !playerDead) this.moveBy(-dx, -dz, 1.6, dt);
        return this.moveWander(dt);
      }
      case 'startle': {
        // freeze, turn to look at the danger, then run
        this.modeT -= dt;
        this.heading += clamp(angleDiff(this.heading, Math.atan2(dx, dz)), -12 * dt, 12 * dt);
        if (this.modeT <= 0) {
          this.mode = 'flee';
          this.steerT = 0;
          this.blockedT = 0;
        }
        return 0;
      }
      case 'cower': {
        this.modeT -= dt;
        if (this.modeT <= 0 || dist > 25) {
          this.mode = this.fearT > 0 && dist < 25 ? 'flee' : 'calm';
          this.blockedT = 0;
          if (this.mode === 'calm') this.startIdle(1);
        }
        return 0;
      }
      case 'flee': {
        // calmed down: far enough away and the fear has run out (or the player is gone)
        if ((this.fearT <= 0 && dist > 20) || dist > 60 || playerDead) {
          this.mode = 'calm';
          this.wary = rnd(10, 16);
          this.startIdle(rnd(0.5, 1.5));
          return 0;
        }
        const hurt = 1 - this.health / this.maxHealth;
        const speed = FLEE_SPEED * Math.min(this.costume.speedMul ?? 1, 1.3) * (1 - 0.35 * hurt) * (0.92 + this.bravery * 0.1);
        const moved = this.runFrom(dt, this.player, speed);
        // trapped against a wall or crate with the player close: curl up
        if (this.blockedT > 1.2 && dist < 4) { // only truly pinned between the wall and the player
          this.mode = 'cower';
          this.modeT = rnd(2, 3.5);
          this.blockedT = 0;
          return 0;
        }
        return moved;
      }
    }
  }

  /** Bring this (switched-off) character to life as a specific costume at a spot: the boss and its zombies. */
  spawnAs(id: string, at: THREE.Vector3) {
    const c = COSTUMES.find((x) => x.id === id);
    if (!c) return;
    this.reset(false, c);
    this.group.position.set(at.x, this.nav.heightAt(at.x, at.z), at.z);
    this.heading = Math.atan2(this.player.x - at.x, this.player.z - at.z);
    this.aggravate();
  }

  /**
   * The boss: huge. It stays 17-32 m away. Far from you (24 m+) it hurls boulders (they hurt a LOT if they land).
   * It calls zombies, which appear next to the PLAYER (the farthest zombie vanishes when too many are alive), and does
   * so at once when you come close. Closer than 5 m it punches; if you run right up to it it gets winded for a few
   * seconds (your chance to unload on it).
   */
  private bossBrain(dt: number): number {
    const B = BOSS;
    const p = this.group.position;
    const dx = this.player.x - p.x, dz = this.player.z - p.z;
    const dist = Math.hypot(dx, dz);
    const rage = this.health < this.maxHealth * 0.5;
    this.bossSummonT -= dt;
    this.bossRockT -= dt;
    this.bossPantCd -= dt;
    this.attackCd -= dt;
    this.hitVoiceT -= dt;
    const face = (rate: number) => {
      this.heading += clamp(angleDiff(this.heading, Math.atan2(dx, dz)), -rate * dt, rate * dt);
    };
    const swat = () => {
      if (dist < BOSS_SWAT.attackRange && this.attackCd <= 0 && !this.hooks.playerDead()) {
        this.attackCd = BOSS_SWAT.interval;
        this.lungeDur = this.lunge = 0.4;
        this.hooks.punch?.('hit');
        this.hooks.hurtPlayer(BOSS_SWAT.damage);
      }
    };
    // winded: bent over and panting, can only punch whoever stands next to it
    if (this.recoverT > 0) {
      this.recoverT -= dt;
      face(2);
      swat();
      return 0;
    }
    // casting / throwing: arms thrown back, then the zombies rise next to the player / the boulder flies
    if (this.windT > 0) {
      this.windT -= dt;
      face(this.bossAct === 'throw' ? 4 : 3);
      if (this.windT <= 0) {
        if (this.bossAct === 'throw') {
          this.hooks.throwRock?.(new THREE.Vector3(p.x, p.y + 3.4, p.z));
          this.bossRockT = rnd(B.rockEvery[0], B.rockEvery[1]);
        } else {
          for (let i = 0, n = rage ? B.perCastRage : B.perCast; i < n; i++) {
            const a = Math.random() * Math.PI * 2, r = 6 + Math.random() * 3;
            this.hooks.summon?.(new THREE.Vector3(this.player.x + Math.sin(a) * r, 0, this.player.z + Math.cos(a) * r));
          }
          this.bossSummonT = rage ? rnd(B.summonRage[0], B.summonRage[1]) : rnd(B.summonEvery[0], B.summonEvery[1]);
        }
      }
      return 0;
    }
    if (dist < B.tiredDist && this.bossPantCd <= 0) {
      this.recoverDur = this.recoverT = B.pant;
      this.bossPantCd = B.pantCd;
      this.hooks.voice?.('boss', 'pant', p, this);
      return 0;
    }
    // too close for comfort: punches, and reacts by calling more zombies right away
    if (dist < B.summonNear) this.bossSummonT = Math.min(this.bossSummonT, 0.8);
    if (this.bossSummonT <= 0 && dist < 90) {
      this.bossAct = 'summon';
      this.windDur = this.windT = 1.0;
      this.hooks.voice?.('boss', 'summon', p, this);
      return 0;
    }
    if (dist < B.closeDist) {
      face(5);
      swat();
      return 0;
    }
    if (this.bossRockT <= 0 && dist >= B.rockMin && dist <= B.rockMax && !this.hooks.playerDead()) {
      this.bossAct = 'throw';
      this.windDur = this.windT = B.rockWind;
      this.hooks.voice?.('boss', 'throw', p, this);
      return 0;
    }
    if (dist < B.keepMin) return this.runFrom(dt, this.player, B.fleeSpeed);
    face(2.5);
    if (dist > B.keepMax) {
      this.moveBy(Math.sin(this.heading), Math.cos(this.heading), B.approach, dt);
      return B.approach;
    }
    return 0;
  }

  /** Thrower zombie: stays 11-30 m away and lobs rocks (arms thrown back for 0.9 s first). */
  private throwerBrain(dt: number): number {
    const T = ZOMBIE_THROW;
    const p = this.group.position;
    const dx = this.player.x - p.x, dz = this.player.z - p.z;
    const dist = Math.hypot(dx, dz);
    this.bossRockT -= dt;
    this.hitVoiceT -= dt;
    const face = (rate: number) => {
      this.heading += clamp(angleDiff(this.heading, Math.atan2(dx, dz)), -rate * dt, rate * dt);
    };
    if (this.windT > 0) {
      this.windT -= dt;
      face(4);
      if (this.windT <= 0) {
        this.hooks.throwRock?.(new THREE.Vector3(p.x, p.y + 1.9 * this.baseScale, p.z), true);
        this.bossRockT = rnd(T.every[0], T.every[1]);
      }
      return 0;
    }
    if (this.bossRockT <= 0 && dist >= T.minDist && dist <= T.maxDist && !this.hooks.playerDead()) {
      this.windDur = this.windT = T.wind;
      return 0;
    }
    face(3);
    if (dist < T.keepMin) return this.runFrom(dt, this.player, T.speed * 1.3);
    if (dist > T.keepMax) {
      this.moveBy(Math.sin(this.heading), Math.cos(this.heading), T.speed, dt);
      return T.speed;
    }
    return 0;
  }

  // ---------- fighting ----------
  /** Cowboys and criminals: aggro rules, then chase / shoot. Returns walking speed. */
  private fight(dt: number): number {
    const c = this.costume;
    const p = this.group.position;
    const dx = this.player.x - p.x, dz = this.player.z - p.z;
    const dist = Math.hypot(dx, dz);
    const playerDead = this.hooks.playerDead();

    if ((c.combat === 'melee' || c.zombie) && !this.aggravated && !c.melee?.provoked) {
      // criminals go for the player automatically once he is close enough
      this.calmCd = Math.max(0, this.calmCd - dt);
      if (this.calmCd === 0 && dist < (c.melee ?? KNIFE_CRIMINAL).aggroRange && !playerDead) this.aggravate();
    }
    const retreating = this.retreatT > 0;
    this.aim += ((this.aggravated && c.combat === 'ranged' && !retreating ? 1 : 0) - this.aim) * (1 - Math.exp(-8 * dt));
    if (!this.aggravated) {
      this.chatter(dt, dist);
      return this.moveWander(dt);
    }
    this.hitVoiceT -= dt;

    // badly hurt: run for cover for a few seconds, then come back
    if (retreating) {
      this.retreatT -= dt;
      const base = c.combat === 'melee' ? (c.melee ?? KNIFE_CRIMINAL).speed * 0.9 : 5.2;
      return this.runFrom(dt, this.player, base);
    }

    // lose interest when the player is too far away for a while (or dead)
    const M = c.melee ?? KNIFE_CRIMINAL;
    const giveUp = c.zombie ? 1e9 : c.combat === 'melee' ? M.giveUp : COWBOY.giveUp; // zombies never give up
    const giveUpTime = c.combat === 'melee' ? M.giveUpTime : COWBOY.giveUpTime;
    this.farT = dist > giveUp || playerDead ? this.farT + dt : 0;
    if (this.farT > giveUpTime) {
      this.aggravated = false;
      this.state = 'idle';
      this.idleT = 1;
      if (c.combat === 'melee') this.calmCd = M.calmCooldown;
      return 0;
    }
    return c.combat === 'melee' ? this.meleeChase(dt, dx, dz, dist) : this.rangedFight(dt, dx, dz, dist);
  }

  private meleeChase(dt: number, dx: number, dz: number, dist: number) {
    const M = this.costume.melee ?? KNIFE_CRIMINAL;
    this.attackCd -= dt;
    const ninja = this.costume.id === 'ninja';

    // heavy hitter (Superman): wind-up -> blow -> long rest. The rest is the player's window to shoot back.
    if (this.recoverT > 0) {
      this.recoverT -= dt;
      this.heading += clamp(angleDiff(this.heading, Math.atan2(dx, dz)), -3 * dt, 3 * dt);
      return 0;
    }
    if (this.windT > 0) {
      this.windT -= dt;
      this.heading += clamp(angleDiff(this.heading, Math.atan2(dx, dz)), -6 * dt, 6 * dt);
      if (this.windT <= 0) {
        const landed = dist < M.attackRange + 0.7 && Math.abs(this.player.y - this.group.position.y) < 1.8;
        this.lungeDur = 0.3;
        this.lunge = 0.3;
        this.hooks.punch?.(landed ? 'hit' : 'miss');
        if (landed) this.hooks.hurtPlayer(M.damage);
        this.recoverDur = M.interval;
        this.recoverT = M.interval;
      }
      return 0;
    }

    // hit and run: step back right after a stab (criminals)
    if (this.backT > 0) {
      this.backT -= dt;
      this.heading += clamp(angleDiff(this.heading, Math.atan2(dx, dz)), -8 * dt, 8 * dt);
      this.moveBy(-dx, -dz, 2.6, dt);
      return 2.6;
    }

    let want = Math.atan2(dx, dz);
    if (this.detourT > 0) {
      this.detourT -= dt;
      want += this.detourDir * 1.2; // go around whatever is in the way
    }
    if (ninja && dist > 3.5) want += Math.sin(this.clock * 5 + this.seed) * 0.5; // zig-zags to be hard to hit
    const diff = angleDiff(this.heading, want);
    this.heading += THREE.MathUtils.clamp(diff, -(M.speed > 7 ? 14 : 8) * dt, (M.speed > 7 ? 14 : 8) * dt);

    if (dist < M.attackRange && Math.abs(this.player.y - this.group.position.y) < 1.8) {
      if (this.attackCd <= 0 && M.windup) {
        this.windDur = M.windup;
        this.windT = M.windup;
        this.hooks.punch?.('wind');
      } else if (this.attackCd <= 0) {
        this.attackCd = M.interval;
        this.lungeDur = Math.min(0.32, M.interval * 0.7);
        this.lunge = this.lungeDur;
        this.hooks.stab();
        this.hooks.hurtPlayer(M.damage);
        if (!ninja && Math.random() < 0.6) this.backT = 0.4;
      }
      return 0;
    }
    if (dist < 1.1) return 0;
    const facing = Math.max(0, Math.cos(diff));
    const blocked = this.moveBy(Math.sin(this.heading), Math.cos(this.heading), M.speed * facing, dt);
    this.blockedT = blocked ? this.blockedT + dt : 0;
    if (this.blockedT > 0.25) {
      this.detourT = 0.9;
      this.detourDir = Math.random() < 0.5 ? -1 : 1;
      this.blockedT = 0;
    }
    return M.speed * facing;
  }

  private rangedFight(dt: number, dx: number, dz: number, dist: number) {
    const p = this.group.position;
    this.attackCd -= dt;
    this.kick = Math.max(0, this.kick - dt * 5);

    // always face the player
    const want = Math.atan2(dx, dz);
    const diff = angleDiff(this.heading, want);
    this.heading += THREE.MathUtils.clamp(diff, -8 * dt, 8 * dt);

    // line of sight, refreshed a few times a second
    this.losT -= dt;
    if (this.losT <= 0) {
      this.losT = 0.35;
      const from = new THREE.Vector3(p.x, p.y + 1.4 * this.baseScale, p.z);
      this.hasLos = this.hooks.lineOfSight(from, this.hooks.playerChest());
    }

    // positioning: close in until there is a clear shot at a sensible range, back off if the player is too close, else circle
    const nx = dx / (dist || 1), nz = dz / (dist || 1);
    let speed = 0;
    let blocked = false;
    if (this.dodgeT > 0) {
      this.dodgeT -= dt; // just got hit: quick sidestep
      blocked = this.moveBy(-nz * this.dodgeDir, nx * this.dodgeDir, 4.6, dt);
      speed = 4.6;
    } else if (!this.hasLos || dist > COWBOY.idealDist + 4) {
      blocked = this.moveBy(nx, nz, COWBOY.speed, dt);
      speed = COWBOY.speed;
    } else if (dist < COWBOY.minDist) {
      blocked = this.moveBy(-nx, -nz, COWBOY.speed * 0.8, dt);
      speed = COWBOY.speed * 0.8;
    } else {
      this.strafeT -= dt;
      if (this.strafeT <= 0) {
        this.strafeDir = -this.strafeDir;
        this.strafeT = rnd(1.2, 2.8);
        this.strafeSpeed = rnd(1.5, 2.7);
      }
      blocked = this.moveBy(-nz * this.strafeDir, nx * this.strafeDir, this.strafeSpeed, dt);
      speed = this.strafeSpeed;
    }
    if (blocked) this.strafeDir = -this.strafeDir; // bumped into cover: circle the other way

    // shoot (sometimes two quick shots in a row)
    if (this.hasLos && dist < COWBOY.maxRange && this.attackCd <= 0 && Math.abs(diff) < 0.35 && !this.hooks.playerDead()) {
      this.attackCd = Math.random() < 0.3 ? 0.22 : rnd(COWBOY.interval[0], COWBOY.interval[1]);
      this.fireGun(dist);
    }
    return speed;
  }

  private fireGun(dist: number) {
    const p = this.group.position;
    const from = new THREE.Vector3(
      p.x + Math.sin(this.heading) * 0.6 * this.baseScale,
      p.y + 1.15 * this.baseScale,
      p.z + Math.cos(this.heading) * 0.6 * this.baseScale,
    );
    const chest = this.hooks.playerChest();
    // accuracy falls with distance
    const hitChance = THREE.MathUtils.clamp(0.72 - dist * 0.017, 0.14, 0.7);
    const hit = Math.random() < hitChance;
    const to = chest.clone();
    if (!hit) to.add(new THREE.Vector3(rnd(-1.2, 1.2), rnd(-0.6, 0.8), rnd(-1.2, 1.2)));
    this.kick = 1;
    this.hooks.shotFired(from, to);
    if (hit) this.hooks.hurtPlayer(COWBOY.damage);
  }

  // ---------- animation ----------
  private animate(dt: number, moveSpeed: number) {
    const rig = this.rig;
    if (!rig) return;
    const p = this.group.position;
    this.clock += dt;
    const walking = moveSpeed > 0.05;
    this.amp += ((walking ? 1 : 0) - this.amp) * (1 - Math.exp(-8 * dt));
    this.phase += dt * moveSpeed * 3.9 * (this.costume.boss ? 0.5 : 1) * (walking ? 1 : 0.0) + dt * (walking ? 0 : 1.6);
    const s = Math.sin(this.phase) * this.amp;
    const idle = 1 - this.amp;
    const t = this.clock + this.seed;
    const run = clamp((moveSpeed - 3.4) / 3, 0, 1) * this.amp; // jogging / sprinting
    const wound = clamp((0.45 - this.health / this.maxHealth) / 0.45, 0, 1); // limp + hunch when badly hurt
    const k = 1 - Math.exp(-10 * dt);
    this.pStartle += ((this.mode === 'startle' || this.stunT > 0 || this.air > 0.1 ? 1 : 0) - this.pStartle) * k;
    this.pCower += ((this.mode === 'cower' ? 1 : 0) - this.pCower) * k;
    this.pPanic += ((this.mode === 'flee' ? 1 : 0) - this.pPanic) * k;
    const rest = this.armRestZ;
    const side = [Math.sign(rest[0]) || -1, Math.sign(rest[1]) || 1];

    // walk cycle (legs swing, arms counter-swing, body bobs and sways); bigger and leaning forward when running
    const legA = 0.7 + 0.5 * run;
    const armA = 0.6 + 0.55 * run;
    rig.legs[0].rotation.x = s * legA;
    rig.legs[1].rotation.x = -s * legA * (1 - 0.4 * wound);
    rig.arms[0].rotation.x = -s * armA + Math.sin(t * 1.4) * 0.025 * idle;
    rig.arms[1].rotation.x = s * armA + Math.sin(t * 1.4 + 1.3) * 0.025 * idle;
    rig.arms[0].rotation.z = rest[0];
    rig.arms[1].rotation.z = rest[1];
    rig.legs[0].rotation.z = 0;
    rig.legs[1].rotation.z = 0;
    this.body.position.set(0, Math.abs(Math.cos(this.phase)) * (0.03 + 0.04 * run) * this.amp + Math.sin(t * 1.8) * 0.004 * idle, 0);
    this.body.rotation.set(0.28 * run + 0.2 * wound, 0, Math.sin(this.phase) * (0.025 + 0.05 * wound) * this.amp);

    // head: nods while walking, glances around while standing, follows a nearby player, stares while fighting
    const calm = this.aggravated || this.alertT > 0 || this.mode !== 'calm' ? 0 : idle;
    const dx = this.player.x - p.x, dz = this.player.z - p.z;
    const distP = Math.hypot(dx, dz);
    const toPlayer = angleDiff(this.heading, Math.atan2(dx, dz));
    let headTarget = Math.sin(t * 0.7) * (0.4 + (this.wary > 0 ? 0.5 : 0)) * calm + Math.sin(t * 2.3) * 0.05;
    if (this.mode === 'flee') headTarget = Math.sin(t * 3.4) * 0.9; // frantic glances over the shoulder
    else if (this.mode === 'startle' || this.mode === 'cower' || this.aggravated || this.alertT > 0) headTarget = clamp(toPlayer, -1.2, 1.2);
    else if (distP < 11 && Math.abs(toPlayer) < 2.3) headTarget = clamp(toPlayer, -1.1, 1.1) * 0.9; // curious about the player
    this.headYaw += (headTarget - this.headYaw) * (1 - Math.exp(-7 * dt));
    rig.head.rotation.x = Math.sin(this.phase * 2) * 0.03 * this.amp;
    rig.head.rotation.y = this.headYaw;
    rig.head.rotation.z = Math.sin(t * 0.5) * 0.04 * calm;

    // idle gestures
    if (this.state === 'idle' && this.gesture > 0 && this.mode === 'calm' && !this.aggravated) this.gestureT += dt;
    const doing = this.state === 'idle' && this.gesture > 0 && this.gestureT < this.gestureDur && this.mode === 'calm' && !this.aggravated && this.alertT <= 0;
    this.gestureK += ((doing ? 1 : 0) - this.gestureK) * (1 - Math.exp(-7 * dt));
    const g = this.gestureK;
    if (g > 0.01) {
      const a = rig.arms;
      switch (this.gesture) {
        case 1: // stretch
          for (let i = 0; i < 2; i++) {
            a[i].rotation.x = lerp(a[i].rotation.x, -2.9, g);
            a[i].rotation.z = lerp(a[i].rotation.z, side[i] * 0.35, g);
          }
          this.body.rotation.x -= 0.1 * g;
          rig.head.rotation.x -= 0.25 * g;
          break;
        case 2: // look at a watch
          a[0].rotation.x = lerp(a[0].rotation.x, -1.25, g);
          a[0].rotation.z = lerp(a[0].rotation.z, -side[0] * 0.45, g);
          rig.head.rotation.x += 0.35 * g;
          break;
        case 3: // hands on hips
          for (let i = 0; i < 2; i++) {
            a[i].rotation.x = lerp(a[i].rotation.x, -0.15, g);
            a[i].rotation.z = lerp(a[i].rotation.z, side[i] * 0.62, g);
          }
          break;
        case 4: // wave
          a[1].rotation.x = lerp(a[1].rotation.x, -2.7, g);
          a[1].rotation.z = lerp(a[1].rotation.z, side[1] * (0.45 + Math.sin(t * 9) * 0.35), g);
          break;
        case 5: // scratch the head
          a[0].rotation.x = lerp(a[0].rotation.x, -2.75 + Math.sin(t * 12) * 0.12, g);
          a[0].rotation.z = lerp(a[0].rotation.z, -side[0] * 0.15, g);
          rig.head.rotation.z += 0.12 * g;
          break;
      }
    }

    // panic: arms flail while running away
    if (this.pPanic > 0.01) {
      for (let i = 0; i < 2; i++) {
        rig.arms[i].rotation.z += side[i] * (0.3 + 0.25 * Math.sin(this.phase * 2 + i * 2)) * this.pPanic;
        rig.arms[i].rotation.x -= 0.5 * this.pPanic;
      }
    }
    // startled: throws the hands up and leans back
    if (this.pStartle > 0.01) {
      const q = this.pStartle;
      for (let i = 0; i < 2; i++) {
        rig.arms[i].rotation.x = lerp(rig.arms[i].rotation.x, -2.35, q);
        rig.arms[i].rotation.z = lerp(rig.arms[i].rotation.z, side[i] * 0.5, q);
      }
      this.body.rotation.x = lerp(this.body.rotation.x, -0.18, q);
      rig.head.rotation.x -= 0.2 * q;
    }
    // cowering: bowed over, hands over the head, trembling
    if (this.pCower > 0.01) {
      const q = this.pCower;
      const bow = 0.85;
      this.body.rotation.x = lerp(this.body.rotation.x, bow, q);
      this.body.position.z = lerp(this.body.position.z, -Math.sin(bow) * 0.95, q);
      this.body.position.y = lerp(this.body.position.y, -0.12, q);
      rig.legs[0].rotation.x = lerp(rig.legs[0].rotation.x, -bow, q); // keep the legs upright under the bowed body
      rig.legs[1].rotation.x = lerp(rig.legs[1].rotation.x, -bow, q);
      for (let i = 0; i < 2; i++) {
        rig.arms[i].rotation.x = lerp(rig.arms[i].rotation.x, -2.7, q);
        rig.arms[i].rotation.z = lerp(rig.arms[i].rotation.z, side[i] * 0.2, q);
      }
      this.body.rotation.z += Math.sin(t * 38) * 0.03 * q;
    }

    // gun arm: raised and aimed while a cowboy fights, with a little kick per shot
    if (this.aim > 0.01) {
      rig.arms[1].rotation.x = THREE.MathUtils.lerp(rig.arms[1].rotation.x, -1.5 - this.kick * 0.25, this.aim);
      rig.arms[1].rotation.z = THREE.MathUtils.lerp(rig.arms[1].rotation.z, 0.02, this.aim);
    }
    // heavy punch: the fist is pulled way back during the wind-up, then the whole body snaps forward
    if (this.windT > 0) {
      const w = 1 - this.windT / this.windDur;
      const e = w * w * (3 - 2 * w);
      rig.arms[1].rotation.x = lerp(rig.arms[1].rotation.x, 1.25, e);
      rig.arms[1].rotation.z = lerp(rig.arms[1].rotation.z, side[1] * 0.25, e);
      rig.arms[0].rotation.x = lerp(rig.arms[0].rotation.x, -1.0, e);
      this.body.rotation.x = lerp(this.body.rotation.x, -0.24, e);
      this.body.rotation.z += Math.sin(t * 45) * 0.012 * e; // straining
    }
    // catching breath after a heavy punch: bent over, heaving
    if (this.recoverT > 0) {
      const r = clamp(Math.min((this.recoverDur - this.recoverT) / 0.3, this.recoverT / 0.5), 0, 1);
      this.body.rotation.x = lerp(this.body.rotation.x, 0.3 + Math.sin(t * 7) * 0.03, r);
      for (let i = 0; i < 2; i++) rig.arms[i].rotation.x = lerp(rig.arms[i].rotation.x, 0.25 + Math.sin(t * 7 + i) * 0.04, r);
      rig.head.rotation.x += 0.3 * r;
    }
    // knife arm: stabs forward when a criminal attacks (the heavy punch lunges much further)
    if (this.lunge > 0) {
      this.lunge = Math.max(0, this.lunge - dt);
      const k2 = 1 - this.lunge / this.lungeDur; // 0 -> 1
      const heavy = !!this.costume.melee?.windup;
      rig.arms[1].rotation.x = heavy ? -1.6 * Math.sin(k2 * Math.PI * 0.8 + 0.3) : -0.6 - Math.sin(k2 * Math.PI) * 1.2;
      this.body.position.z = Math.sin(k2 * Math.PI) * (heavy ? 0.6 : 0.25);
      if (heavy) this.body.rotation.x = Math.sin(k2 * Math.PI) * 0.3;
    }

    // hit reaction: the body jerks back, arms fly up, head snaps back
    if (this.flinch > 0) {
      this.flinch = Math.max(0, this.flinch - dt);
      const u = this.flinch / 0.35;
      const jerk = u * u;
      this.body.rotation.x -= 0.35 * jerk;
      rig.arms[0].rotation.x -= 1.0 * jerk;
      rig.arms[1].rotation.x -= 0.8 * jerk;
      rig.head.rotation.x -= 0.4 * jerk;
    }

    // cape streams behind when moving, flutters when still
    if (rig.cape) {
      rig.cape.rotation.x = 0.1 + (this.amp + run * 0.6) * 0.32 + Math.sin(this.phase * 1.3) * 0.07 * this.amp + Math.sin(t * 2.2) * 0.03;
      rig.cape.rotation.z = Math.sin(t * 1.6) * 0.04;
    }
    rig.post?.(this.phase, this.amp);
    rig.setExpression?.(this.flinch > 0 ? 'pain' : this.mode === 'flee' || this.mode === 'startle' || this.mode === 'cower' ? 'scared' : this.aggravated || this.windT > 0 || this.lunge > 0 || this.alertT > 0 ? 'angry' : 'neutral');
  }

  update(dt: number) {
    if (this.disabled) return;
    if (this.alive) {
      // the health bar fades away if you stop shooting this bot for a while
      if (this.barFill.visible) {
        this.sinceHit += dt;
        if (this.sinceHit >= BAR_HIDE_AFTER) this.updateBar();
      }
      this.physics(dt);
      if (this.stunT > 0) this.stunT -= dt;
      // knocked about: the AI waits until the character is back on its feet
      if (this.rootT > 0) this.rootT -= dt;
      const moving = this.stunT > 0 || this.rootT > 0 ? 0 : this.costume.boss ? this.bossBrain(dt) : this.costume.rocks ? this.throwerBrain(dt) : this.costume.combat ? this.fight(dt) : this.civilian(dt);
      this.moveSpeedNow = moving;
      this.separate();
      const p = this.group.position;
      pushOutOfBoxes(this.nav, p, RADIUS);
      p.y = this.nav.heightAt(p.x, p.z) + this.air;
      this.group.rotation.y = this.heading;
      this.animate(dt, moving);
      this.flash = Math.max(0, this.flash - dt);
      const e = this.flash > 0 ? 0.8 : 0;
      if (this.rig) for (const m of this.rig.materials) {
        const em = (m as THREE.MeshStandardMaterial).emissive;
        if (this.rootT > 0 && e === 0) em.setRGB(0.05, 0.22, 0.35); // frozen by a bolt: a cold blue tint
        else em.setScalar(e);
      }
      return;
    }
    this.dieAnimation(dt);
  }

  /** Falls over backwards with the arms flung out, lies there for a moment, then shrinks away until it respawns. */
  private dieAnimation(dt: number) {
    this.deadTime += dt;
    const rig = this.rig;
    const f = Math.min(this.deadTime / 0.55, 1);
    const fall = 1 - Math.pow(1 - f, 3); // eases out
    this.group.rotation.x = -1.5 * fall;
    const p = this.group.position;
    this.physics(dt); // slides away from the shot / flies if blown up
    p.y = this.nav.heightAt(p.x, p.z) + 0.1 * fall + this.air;
    if (rig) {
      const sd = [Math.sign(this.armRestZ[0]) || -1, Math.sign(this.armRestZ[1]) || 1];
      for (let i = 0; i < 2; i++) {
        rig.arms[i].rotation.x = lerp(rig.arms[i].rotation.x, -2.4 + i * 0.5, fall * 0.4);
        rig.arms[i].rotation.z = lerp(rig.arms[i].rotation.z, sd[i] * 0.9, fall * 0.4);
        rig.legs[i].rotation.z = lerp(rig.legs[i].rotation.z, sd[i] * 0.25, fall * 0.4);
        rig.legs[i].rotation.x *= 1 - fall * 0.3;
      }
    }
    rig?.post?.(this.phase, this.amp);
    if (this.costume.boss) return; // the boss stays where it fell
    const shrinkStart = Math.max(0.9, this.respawnDelay - 0.5);
    const t = clamp((this.deadTime - shrinkStart) / 0.4, 0, 1);
    this.group.scale.setScalar(this.baseScale * (1 - t));
    if (t >= 1) this.group.visible = false;
    if (this.deadTime > this.respawnDelay) {
      if (this.oneLife) this.disable();
      else this.reset(true);
    }
  }
}
