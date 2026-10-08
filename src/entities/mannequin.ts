import * as THREE from 'three';
import { buildBot, type BotRig } from './botModel';

/** What a bot needs to know about the world to wander around it. */
export interface Nav {
  heightAt: (x: number, z: number) => number;
  boxes: THREE.Box3[];
  half: number;
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
  lineOfSight: (from: THREE.Vector3, to: THREE.Vector3) => boolean;
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
  /** First level in which this character can appear (default 1). */
  minLevel?: number;
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
}
const KNIFE_CRIMINAL: MeleeStats = { aggroRange: 36, speed: 5.4, attackRange: 1.5, damage: 10, interval: 0.9, giveUp: 52, giveUpTime: 3, calmCooldown: 8 };
/** Ninja: much faster, strikes twice as often and far harder than a criminal, but is fragile. */
const NINJA_STRIKER: MeleeStats = { aggroRange: 30, speed: 8.4, attackRange: 1.7, damage: 24, interval: 0.45, giveUp: 55, giveUpTime: 3, calmCooldown: 6 };

export const COSTUMES: Costume[] = [
  { id: 'regular', name: 'Regular', health: 100, points: 100, weight: 3, shirt: 0xd9d4c7, pants: 0x4a5f82, accent: 0x8c8a85, note: 'Harmless' },
  { id: 'winter', name: 'Winter', health: 115, points: 110, weight: 2, shirt: 0x8a3a3a, pants: 0x4d4d57, accent: 0xeeeeee, note: 'Harmless' },
  { id: 'builder', name: 'Builder', health: 140, points: 120, weight: 2, shirt: 0xe7a51c, pants: 0x3b4a63, accent: 0xc7f03a, note: 'Harmless, tough' },
  { id: 'sporty', name: 'Sporty', health: 105, points: 130, weight: 2, shirt: 0x3fa35a, pants: 0x222222, accent: 0xffffff, speedMul: 1.7, note: 'Harmless, walks fast' },
  { id: 'chef', name: 'Chef', health: 95, points: 140, weight: 1.5, shirt: 0xf4f4f0, pants: 0x3a3a3a, accent: 0xffffff, note: 'Harmless' },
  { id: 'rich', name: 'Rich guy', health: 90, points: 150, weight: 1.5, shirt: 0x2f3b52, pants: 0x20242e, accent: 0xb02a2a, note: 'Harmless' },
  { id: 'cowboy', name: 'Cowboy', health: 125, points: 160, weight: 1.2, shirt: 0xa5522d, pants: 0x4a3a2a, accent: 0x5b3a1e, combat: 'ranged', note: 'Shoots back when shot' },
  { id: 'soldier', name: 'Soldier', health: 170, points: 170, weight: 1, shirt: 0x5a6b3a, pants: 0x4b5a32, accent: 0x3b4528, note: 'Harmless, very tough' },
  { id: 'superman', name: 'Superman', health: 250, points: 180, weight: 1, shirt: 0x2d5ea8, pants: 0x2d5ea8, accent: 0xc22d2d, speedMul: 1.9, note: 'Harmless, very tough, walks fast' },
  { id: 'criminal', name: 'Criminal', health: 130, points: 200, weight: 1.3, shirt: 0x1c1c20, pants: 0x2c2c32, accent: 0xf0f0f0, combat: 'melee', melee: KNIFE_CRIMINAL, zone: 'edge', minLevel: 2, note: 'Patrols the walls, attacks on sight with a knife' },
  { id: 'ninja', name: 'Ninja', health: 70, points: 220, weight: 0.7, shirt: 0x17171a, pants: 0x17171a, accent: 0xc42b2b, combat: 'melee', melee: NINJA_STRIKER, minLevel: 7, note: 'From level 7. Attacks on sight: very fast and deadly, but fragile' },
];

/** Which costumes may spawn (set per level by main.ts). Null = all. */
let spawnRule: ((c: Costume) => boolean) | null = null;
export function setSpawnRule(rule: ((c: Costume) => boolean) | null) {
  spawnRule = rule;
}
function pickCostume(): Costume {
  const pool = spawnRule ? COSTUMES.filter(spawnRule) : COSTUMES;
  const list = pool.length ? pool : COSTUMES;
  let r = Math.random() * list.reduce((s, c) => s + c.weight, 0);
  for (const c of list) if ((r -= c.weight) <= 0) return c;
  return list[0];
}

// ---- combat tunables ----
const COWBOY = { idealDist: 13, minDist: 6, maxRange: 38, damage: 9, speed: 3.4, interval: [1.0, 1.6], giveUp: 65, giveUpTime: 6 };

const RADIUS = 0.35; // bot collision radius
const BAR_HIDE_AFTER = 30; // seconds without being hit before the health bar disappears
export const angleDiff = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/** Push a walker out of crates / pillars / walls / big rocks and keep it in the arena. True if it was pushed. */
export function pushOutOfBoxes(nav: Nav, p: THREE.Vector3, radius: number): boolean {
  let pushed = false;
  const gy = nav.heightAt(p.x, p.z);
  for (const b of nav.boxes) {
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
  const lim = nav.half - 1.5; // never leave the arena
  p.x = THREE.MathUtils.clamp(p.x, -lim, lim);
  p.z = THREE.MathUtils.clamp(p.z, -lim, lim);
  return pushed;
}

const NO_HOOKS: BotHooks = {
  hurtPlayer: () => {},
  shotFired: () => {},
  stab: () => {},
  lineOfSight: () => true,
  playerChest: () => new THREE.Vector3(),
  playerDead: () => false,
};

export class Mannequin {
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

  // fighting (cowboys / criminals)
  private farT = 0;
  private calmCd = 0; // criminals ignore the player for a while after giving up
  private attackCd = 0;
  private lunge = 0; // stab animation timer
  private lungeDur = 0.32;
  private aim = 0; // 0..1 how far the gun arm is raised
  private kick = 0; // gun recoil animation
  private hasLos = false;
  private losT = 0;
  private strafeDir = 1;
  private strafeT = 0;
  private detourT = 0;
  private detourDir = 1;
  private moveSpeedNow = 0;

  constructor(
    private nav: Nav,
    start: THREE.Vector3,
    private player: THREE.Vector3,
    private hooks: BotHooks = NO_HOOKS,
    private respawnDelay = 4,
  ) {
    this.group.add(this.body);
    this.barBg.scale.set(0.7, 0.09, 1);
    this.barFill.scale.set(0.66, 0.055, 1);
    this.barBg.position.set(0, 2.15, 0);
    this.barFill.position.set(0, 2.15, 0);
    this.barBg.renderOrder = 10;
    this.barFill.renderOrder = 11;
    this.group.add(this.barBg, this.barFill);
    this.group.position.copy(start);
    this.reset();
  }

  /** Fresh bot: random costume, face and build, full health, somewhere new if `relocate`. */
  reset(relocate = false) {
    if (relocate) this.group.position.copy(this.nav.randomFreePoint(this.player, 20));
    this.alive = true;
    this.deadTime = 0;
    this.baseScale = 0.94 + Math.random() * 0.14;
    this.group.scale.setScalar(this.baseScale);
    this.group.rotation.set(0, 0, 0);
    this.heading = Math.random() * Math.PI * 2;
    this.group.visible = true;
    this.state = 'idle';
    this.idleT = Math.random() * 1.5;
    this.amp = 0;
    this.aggravated = false;
    this.farT = this.calmCd = this.attackCd = this.lunge = this.aim = this.kick = 0;
    this.costume = pickCostume();
    // criminals usually start near the outer walls, away from the middle of the map
    if (this.costume.zone === 'edge' && Math.random() < 0.85) {
      this.group.position.copy(this.nav.randomEdgePoint(this.player, 25));
    }
    this.maxHealth = this.health = this.costume.health;
    this.sinceHit = 0;
    this.updateBar();
    this.build();
  }

  /** Floating health bar, only shown once the bot has taken damage. */
  private updateBar() {
    const ratio = Math.max(0, this.health / this.maxHealth);
    this.barFill.scale.x = 0.66 * ratio;
    // anchor in screen space so the fill stays left-aligned however the bot is turned
    this.barFill.center.set(ratio > 0 ? 0.5 / ratio : 0.5, 0.5);
    this.barFill.material.color.setHSL(0.33 * ratio, 0.75, 0.5);
    this.barBg.visible = this.barFill.visible = this.alive && ratio < 1 && this.sinceHit < BAR_HIDE_AFTER;
  }

  private build() {
    if (this.rig) {
      this.body.remove(this.rig.root);
      this.rig.dispose();
    }
    this.rig = buildBot(this, this.costume);
    this.body.add(this.rig.root);
    this.hitMeshes.length = 0;
    this.hitMeshes.push(...this.rig.hitMeshes);
  }

  /** Start going after the player (cowboys when shot, criminals on sight). */
  aggravate() {
    if (!this.alive || !this.costume.combat || this.aggravated) return;
    this.aggravated = true;
    this.farT = 0;
    this.losT = 0;
  }

  /** Apply damage. Returns true if this hit killed it. */
  damage(amount: number): boolean {
    if (!this.alive) return false;
    this.health -= amount;
    this.flash = 0.12;
    this.sinceHit = 0;
    this.aggravate(); // cowboys (and criminals) react to being shot
    if (this.health <= 0) {
      this.alive = false;
      this.deadTime = 0;
      this.updateBar();
      return true;
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
    this.aggravated = false;
    this.sinceHit = 0;
    if (c.zone === 'edge') this.group.position.copy(this.nav.randomEdgePoint(this.player, 25));
    this.updateBar();
    this.build();
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

  /** Idle / walk between random spots. Returns the current walking speed (0 when standing). */
  private moveWander(dt: number) {
    const p = this.group.position;
    if (this.state === 'idle') {
      this.idleT -= dt;
      if (this.idleT <= 0) this.pickTarget();
    } else {
      this.walkT += dt;
      const dx = this.target.x - p.x, dz = this.target.z - p.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.5 || this.walkT > 20) {
        this.state = 'idle';
        this.idleT = Math.random() < 0.3 ? 0 : 0.4 + Math.random() * 2.2;
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

  // ---------- fighting ----------
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

  /** Cowboys and criminals: aggro rules, then chase / shoot. Returns walking speed. */
  private fight(dt: number): number {
    const c = this.costume;
    const p = this.group.position;
    const dx = this.player.x - p.x, dz = this.player.z - p.z;
    const dist = Math.hypot(dx, dz);
    const playerDead = this.hooks.playerDead();

    if (c.combat === 'melee' && !this.aggravated) {
      // criminals go for the player automatically once he is close enough
      this.calmCd = Math.max(0, this.calmCd - dt);
      if (this.calmCd === 0 && dist < (c.melee ?? KNIFE_CRIMINAL).aggroRange && !playerDead) this.aggravate();
    }
    this.aim += ((this.aggravated && c.combat === 'ranged' ? 1 : 0) - this.aim) * (1 - Math.exp(-8 * dt));
    if (!this.aggravated) return this.moveWander(dt);

    // lose interest when the player is too far away for a while (or dead)
    const M = c.melee ?? KNIFE_CRIMINAL;
    const giveUp = c.combat === 'melee' ? M.giveUp : COWBOY.giveUp;
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
    let want = Math.atan2(dx, dz);
    if (this.detourT > 0) {
      this.detourT -= dt;
      want += this.detourDir * 1.2; // go around whatever is in the way
    }
    const diff = angleDiff(this.heading, want);
    this.heading += THREE.MathUtils.clamp(diff, -(M.speed > 7 ? 14 : 8) * dt, (M.speed > 7 ? 14 : 8) * dt);

    if (dist < M.attackRange && Math.abs(this.player.y - this.group.position.y) < 1.8) {
      if (this.attackCd <= 0) {
        this.attackCd = M.interval;
        this.lungeDur = Math.min(0.32, M.interval * 0.7);
        this.lunge = this.lungeDur;
        this.hooks.stab();
        this.hooks.hurtPlayer(M.damage);
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
    if (!this.hasLos || dist > COWBOY.idealDist + 4) {
      blocked = this.moveBy(nx, nz, COWBOY.speed, dt);
      speed = COWBOY.speed;
    } else if (dist < COWBOY.minDist) {
      blocked = this.moveBy(-nx, -nz, COWBOY.speed * 0.8, dt);
      speed = COWBOY.speed * 0.8;
    } else {
      this.strafeT -= dt;
      if (this.strafeT <= 0) {
        this.strafeDir = -this.strafeDir;
        this.strafeT = rnd(1.5, 3);
      }
      blocked = this.moveBy(-nz * this.strafeDir, nx * this.strafeDir, 1.8, dt);
      speed = 1.8;
    }
    if (blocked) this.strafeDir = -this.strafeDir; // bumped into cover: circle the other way

    // shoot
    if (this.hasLos && dist < COWBOY.maxRange && this.attackCd <= 0 && Math.abs(diff) < 0.35 && !this.hooks.playerDead()) {
      this.attackCd = rnd(COWBOY.interval[0], COWBOY.interval[1]);
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
    this.clock += dt;
    const walking = moveSpeed > 0.05;
    this.amp += ((walking ? 1 : 0) - this.amp) * (1 - Math.exp(-8 * dt));
    this.phase += dt * moveSpeed * 4.2 * (walking ? 1 : 0.0) + dt * (walking ? 0 : 1.6);
    const s = Math.sin(this.phase) * this.amp;
    const idle = 1 - this.amp;
    const t = this.clock + this.seed;

    // walk cycle (legs swing, arms counter-swing, body bobs and sways)
    rig.legs[0].rotation.x = s * 0.7;
    rig.legs[1].rotation.x = -s * 0.7;
    rig.arms[0].rotation.x = -s * 0.6 + Math.sin(t * 1.4) * 0.025 * idle;
    rig.arms[1].rotation.x = s * 0.6 + Math.sin(t * 1.4 + 1.3) * 0.025 * idle;
    this.body.position.y = Math.abs(Math.cos(this.phase)) * 0.03 * this.amp + Math.sin(t * 1.8) * 0.004 * idle; // bob / breathing
    this.body.rotation.z = Math.sin(this.phase) * 0.025 * this.amp;
    this.body.position.z = 0;

    // head: nods while walking, looks around while standing (stares at the player while fighting)
    const calm = this.aggravated ? 0 : idle;
    rig.head.rotation.x = Math.sin(this.phase * 2) * 0.03 * this.amp;
    rig.head.rotation.y = Math.sin(t * 0.7) * 0.4 * calm + Math.sin(t * 2.3) * 0.05;
    rig.head.rotation.z = Math.sin(t * 0.5) * 0.04 * calm;

    // gun arm: raised and aimed while a cowboy fights, with a little kick per shot
    if (this.aim > 0.01) {
      rig.arms[1].rotation.x = THREE.MathUtils.lerp(rig.arms[1].rotation.x, -1.5 - this.kick * 0.25, this.aim);
      rig.arms[1].rotation.z = THREE.MathUtils.lerp(rig.arms[1].rotation.z, 0.02, this.aim);
    }
    // knife arm: stabs forward when a criminal attacks
    if (this.lunge > 0) {
      this.lunge = Math.max(0, this.lunge - dt);
      const k = 1 - this.lunge / this.lungeDur; // 0 -> 1
      rig.arms[1].rotation.x = -0.6 - Math.sin(k * Math.PI) * 1.2;
      this.body.position.z = Math.sin(k * Math.PI) * 0.25;
    }

    // cape streams behind when moving, flutters when still
    if (rig.cape) {
      rig.cape.rotation.x = 0.1 + this.amp * 0.32 + Math.sin(this.phase * 1.3) * 0.07 * this.amp + Math.sin(t * 2.2) * 0.03;
      rig.cape.rotation.z = Math.sin(t * 1.6) * 0.04;
    }
  }

  update(dt: number) {
    if (this.alive) {
      // the health bar fades away if you stop shooting this bot for a while
      if (this.barFill.visible) {
        this.sinceHit += dt;
        if (this.sinceHit >= BAR_HIDE_AFTER) this.updateBar();
      }
      const moving = this.costume.combat ? this.fight(dt) : this.moveWander(dt);
      this.moveSpeedNow = moving;
      const p = this.group.position;
      p.y = this.nav.heightAt(p.x, p.z);
      this.group.rotation.y = this.heading;
      this.animate(dt, moving);
      this.flash = Math.max(0, this.flash - dt);
      const e = this.flash > 0 ? 0.8 : 0;
      if (this.rig) for (const m of this.rig.materials) (m as THREE.MeshStandardMaterial).emissive.setScalar(e);
      return;
    }
    this.deadTime += dt;
    // shrink-and-tip-over over 0.35s, then hide until respawn
    const t = Math.min(this.deadTime / 0.35, 1);
    this.group.scale.setScalar(this.baseScale * (1 - t));
    this.group.rotation.x = t * 0.8;
    if (t >= 1) this.group.visible = false;
    if (this.deadTime > this.respawnDelay) this.reset(true);
  }
}
