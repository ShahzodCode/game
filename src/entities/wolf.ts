import * as THREE from 'three';
import { angleDiff, pushOutOfBoxes, type Nav } from './mannequin';
import { MeshBuilder } from './meshBuilder';

export const WOLF_INFO = { name: 'Wolf', points: 175, health: 70 };

// behaviour tunables
const RADIUS = 0.4;
const WANDER_SPEED = [1.3, 2.0]; // min, max
const CHASE_SPEED = 7.5; // faster than walking (6), slower than running (9)
const BITE_RANGE = 1.5;
const BITE_DAMAGE = 12;
const BITE_INTERVAL = 1.0;
const GIVE_UP_DISTANCE = 45; // player this far away for a while -> wolf calms down
const GIVE_UP_TIME = 6;
const BAR_HIDE_AFTER = 30;
const RESPAWN_DELAY = 30; // wolves are rare: a long wait before a new one shows up
const RESPAWN_MIN_DIST = 35;
const PI = Math.PI;

/** Fur schemes: back, saddle (darker top), light (belly, muzzle, socks), tail tip. */
const COATS = [
  { base: 0x76767b, dark: 0x4a4a50, light: 0xc9c9c4, tip: 0x2a2a2e }, // grey
  { base: 0x7a5f45, dark: 0x4d3a29, light: 0xcdbba0, tip: 0x2c2118 }, // brown
  { base: 0x2f2f33, dark: 0x1a1a1d, light: 0x77777c, tip: 0x111113 }, // black
  { base: 0xd8d8d3, dark: 0xa5a59f, light: 0xffffff, tip: 0x8a8a86 }, // white
  { base: 0x8a7a64, dark: 0x5a4d3c, light: 0xd8cbb4, tip: 0x3a3228 }, // tan
];

export interface WolfHooks {
  hurtPlayer: (damage: number) => void;
  onAggro: () => void;
}

interface LegRig { upper: THREE.Group; lower: THREE.Group; hind: boolean }

export class Wolf {
  readonly group = new THREE.Group();
  readonly hitMeshes: THREE.Mesh[] = [];
  readonly maxHealth = WOLF_INFO.health;
  health = WOLF_INFO.health;
  alive = true;
  aggravated = false;
  readonly label = WOLF_INFO.name;
  readonly points = WOLF_INFO.points;
  readonly kind = 'wolf'; // id used by missions
  readonly hostile = true;
  /** Switched off for this level: invisible, not simulated, cannot be shot. */
  disabled = false;

  /** Remove this wolf from the level (e.g. level 1 has no wolves). */
  deactivate() {
    this.disabled = true;
    this.alive = false;
    this.aggravated = false;
    this.group.visible = false;
  }
  /** Bring this wolf into the level, far from the player. */
  activate() {
    this.disabled = false;
    this.reset(true);
  }

  // model rig (rebuilt every reset for a new coat)
  private body = new THREE.Group();
  private legs: LegRig[] = []; // FL, FR, BL, BR
  private tail: THREE.Group[] = [];
  private head = new THREE.Group();
  private jaw = new THREE.Group();
  private ears: THREE.Group[] = [];
  private hackles: THREE.Mesh | null = null;
  private material: THREE.MeshStandardMaterial | null = null;
  private eyeMat = new THREE.MeshStandardMaterial({ color: 0xffcc33, emissive: 0x553300, roughness: 0.4 });
  private geos: THREE.BufferGeometry[] = [];
  private barBg = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x000000, transparent: true, opacity: 0.6, depthWrite: false }));
  private barFill = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x44dd55, depthWrite: false }));
  private baseScale = 1;
  private deadTime = 0;
  private flash = 0;
  private sinceHit = 0;
  private clock = 0;
  private seed = Math.random() * 100;

  // movement
  private heading = Math.random() * Math.PI * 2;
  private state: 'idle' | 'wander' = 'idle';
  private idleT = 1;
  private target = new THREE.Vector3();
  private speed = 1.6;
  private phase = 0;
  private amp = 0;
  private blockedT = 0;
  private detourT = 0;
  private detourDir = 1;
  private walkT = 0;
  private farT = 0;
  private biteCd = 0;
  private lunge = 0;

  constructor(
    private nav: Nav,
    start: THREE.Vector3,
    private player: THREE.Vector3,
    private hooks: WolfHooks,
  ) {
    this.group.add(this.body);
    this.barBg.scale.set(0.7, 0.09, 1);
    this.barFill.scale.set(0.66, 0.055, 1);
    this.barBg.position.set(0, 1.35, 0);
    this.barFill.position.set(0, 1.35, 0);
    this.barBg.renderOrder = 10;
    this.barFill.renderOrder = 11;
    this.group.add(this.barBg, this.barFill);
    this.group.position.copy(start);
    this.reset();
  }

  /** New wolf (new coat and size), calm, optionally somewhere else far from the player. */
  reset(relocate = false) {
    this.kv.set(0, 0, 0);
    this.air = 0;
    this.stunT = 0;
    if (relocate) this.group.position.copy(this.nav.randomFreePoint(this.player, RESPAWN_MIN_DIST));
    this.health = this.maxHealth;
    this.alive = true;
    this.aggravated = false;
    this.deadTime = 0;
    this.sinceHit = 0;
    this.baseScale = 0.95 + Math.random() * 0.2;
    this.group.scale.setScalar(this.baseScale);
    this.group.rotation.set(0, 0, 0);
    this.group.visible = true;
    this.state = 'idle';
    this.idleT = Math.random() * 2;
    this.amp = 0;
    this.farT = this.biteCd = this.lunge = 0;
    this.eyeMat.color.set(0xffcc33);
    this.eyeMat.emissive.set(0x553300);
    this.build();
    this.updateBar();
  }

  private build() {
    // throw away the previous model
    this.body.clear();
    this.geos.forEach((g) => g.dispose());
    this.geos = [];
    this.material?.dispose();
    this.legs = [];
    this.tail = [];
    this.ears = [];
    this.hitMeshes.length = 0;

    const coat = COATS[Math.floor(Math.random() * COATS.length)];
    const { base, dark, light, tip } = coat;
    const mat = (this.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
    const mk = (b: MeshBuilder, hit: boolean, head = false) => {
      const g = b.build();
      this.geos.push(g);
      const m = new THREE.Mesh(g, mat);
      m.castShadow = true;
      if (hit) {
        m.userData.owner = this;
        m.userData.head = head;
        this.hitMeshes.push(m);
      }
      return m;
    };

    // ---- torso: one smooth body (rump -> ribcage -> chest) + neck + fur tufts ----
    const t = new MeshBuilder();
    // lathe along the body axis: [radius, position along the length], rotated so the length runs along z
    t.lathe(
      base,
      [[0.001, -0.54], [0.1, -0.52], [0.17, -0.43], [0.19, -0.28], [0.2, -0.08], [0.21, 0.12], [0.235, 0.3], [0.215, 0.44], [0.12, 0.53], [0.001, 0.57]],
      { p: [0, 0.63, 0], r: [PI / 2, 0, 0], s: [1.0, 1, 1.2] },
      14,
    );
    t.ball(base, 0.13, { p: [0, 0.78, 0.52], s: [1.0, 1.35, 1.7], r: [-0.55, 0, 0] }); // neck
    t.ball(light, 0.1, { p: [0, 0.68, 0.58], s: [1.1, 1.0, 1.1] }); // throat
    for (let i = 0; i < 9; i++) {
      // chest / neck fur tufts
      const a = rnd(-1.1, 1.1), y = rnd(0.5, 0.75);
      t.cone(i % 2 ? light : base, 0.04, 0.12, { p: [Math.sin(a) * 0.19, y, 0.4 + rnd(-0.05, 0.12)], r: [rnd(0.5, 1.1), 0, -Math.sin(a) * 1.2] });
    }
    for (const s of [-1, 1]) for (let i = 0; i < 3; i++) t.cone(light, 0.035, 0.1, { p: [s * 0.17, 0.52, -0.05 - i * 0.18], r: [0, 0, s * 2.3] }); // flank fur
    const torso = mk(t, true);
    furGradient(torso.geometry, base, dark, light); // darker saddle on the back, pale belly and chest
    this.body.add(torso);

    // raised fur along the spine; swells when the wolf is angry
    const hk = new MeshBuilder();
    for (let i = 0; i < 9; i++) hk.cone(dark, 0.035, 0.1, { p: [0, 0.83 - Math.abs(i - 3.5) * 0.008, 0.38 - i * 0.1] });
    this.hackles = mk(hk, false);
    this.hackles.position.y = -0.08;
    this.body.add(this.hackles);

    // ---- head (pivot at the top of the neck) ----
    this.head = new THREE.Group();
    this.head.position.set(0, 0.86, 0.62);
    const h = new MeshBuilder();
    h.ball(base, 0.12, { p: [0, 0.0, 0.07], s: [1.0, 0.95, 1.2] }); // skull
    h.ball(dark, 0.1, { p: [0, 0.05, 0.04], s: [1.0, 0.6, 1.2] }); // forehead blaze
    h.cyl(light, 0.04, 0.075, 0.2, { p: [0, -0.015, 0.22], r: [PI / 2, 0, 0] }, 9); // muzzle
    h.ball(base, 0.05, { p: [0, 0.015, 0.2], s: [1, 0.7, 1.7] }); // bridge
    h.ball(0x131315, 0.03, { p: [0, 0.0, 0.335], s: [1.2, 0.9, 0.9] }); // nose
    for (const s of [-1, 1]) {
      h.cone(light, 0.04, 0.11, { p: [s * 0.1, -0.03, 0.03], r: [0, 0, s * -1.8] }); // cheek ruff
      h.cone(light, 0.035, 0.09, { p: [s * 0.095, -0.065, 0.06], r: [0, 0, s * -2.2] });
      h.ball(dark, 0.025, { p: [s * 0.085, 0.045, 0.14], s: [1.4, 0.6, 1.4], r: [0, 0, s * 0.3] }); // brow ridge
      for (const x of [0.014, 0.034]) h.cone(0xf2f2ea, 0.006, 0.034, { p: [s * x, -0.05, 0.3], r: [PI, 0, 0] }, 4); // upper teeth
      h.cone(0xf5f5ee, 0.011, 0.055, { p: [s * 0.045, -0.055, 0.285], r: [PI, 0, 0] }, 5); // upper fangs
    }
    this.head.add(mk(h, true, true));

    // lower jaw (opens when the wolf snarls or bites)
    this.jaw = new THREE.Group();
    this.jaw.position.set(0, -0.045, 0.06);
    const j = new MeshBuilder();
    j.ball(light, 0.07, { p: [0, -0.012, 0.12], s: [0.85, 0.45, 2.0] });
    j.ball(0xd9708a, 0.04, { p: [0, 0.0, 0.14], s: [0.85, 0.3, 2.2] }); // tongue
    for (const s of [-1, 1]) {
      j.cone(0xf5f5ee, 0.011, 0.05, { p: [s * 0.036, 0.022, 0.24] }, 5); // lower fangs
      for (const x of [0.012, 0.024]) j.cone(0xf2f2ea, 0.006, 0.026, { p: [s * x, 0.014, 0.265] }, 4);
    }
    this.jaw.add(mk(j, true, true));
    this.head.add(this.jaw);

    // ears (separate so they can flick and lay back)
    for (const s of [-1, 1]) {
      const e = new MeshBuilder();
      e.cone(base, 0.055, 0.15, { p: [0, 0.075, 0] }, 5);
      e.cone(0xc99a98, 0.03, 0.1, { p: [0, 0.07, 0.014] }, 5); // inner ear
      const ear = new THREE.Group();
      ear.position.set(s * 0.07, 0.1, 0.0);
      ear.rotation.z = -s * 0.25;
      ear.add(mk(e, false));
      this.head.add(ear);
      this.ears.push(ear);
    }
    // eyes: own material so they can glow red when the wolf is angry
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), this.eyeMat);
      eye.scale.set(1, 0.75, 0.8);
      eye.position.set(s * 0.065, 0.04, 0.155);
      this.geos.push(eye.geometry);
      this.head.add(eye);
      const pupil = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.026, 0.006), new THREE.MeshBasicMaterial({ color: 0x050505 }));
      pupil.position.set(s * 0.068, 0.04, 0.172);
      this.geos.push(pupil.geometry);
      this.head.add(pupil);
    }
    this.body.add(this.head);

    // ---- legs: shoulder/hip pivot, knee pivot, paw ----
    const legSpots: [number, number, boolean][] = [[-0.12, 0.34, false], [0.12, 0.34, false], [-0.12, -0.3, true], [0.12, -0.3, true]];
    for (const [x, z, hind] of legSpots) {
      const upperB = new MeshBuilder();
      upperB.ball(base, 0.08, { p: [0, -0.12, hind ? -0.02 : 0], s: [1, 2.3, 1.1], r: [hind ? 0.3 : 0, 0, 0] });
      if (hind) upperB.ball(dark, 0.09, { p: [0, -0.03, -0.03], s: [1.05, 1.3, 1.4] }); // haunch
      const lowerB = new MeshBuilder();
      lowerB.cyl(base, 0.05, 0.036, 0.24, { p: [0, -0.12, 0] }, 8);
      lowerB.cyl(light, 0.04, 0.037, 0.12, { p: [0, -0.19, 0] }, 8); // pale sock
      lowerB.ball(light, 0.055, { p: [0, -0.255, 0.04], s: [1, 0.65, 1.7] }); // paw
      const upper = new THREE.Group();
      upper.position.set(x, 0.52, z);
      upper.add(mk(upperB, true));
      const lower = new THREE.Group();
      lower.position.set(0, -0.26, 0);
      lower.rotation.x = hind ? -0.5 : 0;
      lower.add(mk(lowerB, true));
      upper.add(lower);
      this.body.add(upper);
      this.legs.push({ upper, lower, hind });
    }

    // ---- tail: three bushy segments that wag in a wave ----
    const segs: { y: number; z: number; r: number; len: number; col: number }[] = [
      { y: 0.7, z: -0.5, r: 0.075, len: 0.2, col: base },
      { y: 0, z: -0.2, r: 0.09, len: 0.2, col: dark },
      { y: 0, z: -0.2, r: 0.075, len: 0.16, col: tip },
    ];
    let parent: THREE.Object3D = this.body;
    for (const sg of segs) {
      const tb = new MeshBuilder();
      tb.ball(sg.col, sg.r, { p: [0, 0, -sg.len / 2], s: [1, 1, sg.len / sg.r / 1.4] });
      const seg = new THREE.Group();
      seg.position.set(0, sg.y, sg.z);
      seg.add(mk(tb, false));
      parent.add(seg);
      this.tail.push(seg);
      parent = seg;
    }
  }

  /** The player shot this wolf (or a packmate): it will chase and bite. */
  aggravate() {
    if (!this.alive || this.aggravated) return;
    this.aggravated = true;
    this.farT = 0;
    this.eyeMat.color.set(0xff3322);
    this.eyeMat.emissive.set(0xaa1100);
    this.hooks.onAggro();
  }

  // knockback (shotgun blasts, explosions): a push velocity and a height above the ground while thrown
  private kv = new THREE.Vector3();
  private air = 0;
  private stunT = 0;
  /** Shove this wolf: strong shoves throw it off its feet and stun it for a moment. */
  impulse(v: THREE.Vector3) {
    this.kv.add(v);
    const h = Math.hypot(this.kv.x, this.kv.z);
    if (h > 14) {
      this.kv.x *= 14 / h;
      this.kv.z *= 14 / h;
    }
    this.kv.y = Math.min(this.kv.y, 9);
    const strength = this.kv.length();
    if (this.alive && strength > 3) this.stunT = Math.max(this.stunT, Math.min(1, 0.2 + strength * 0.05));
  }
  private physics(dt: number) {
    const p = this.group.position;
    const flying = this.air > 0 || this.kv.y > 0;
    if (!flying && Math.hypot(this.kv.x, this.kv.z) < 0.05) {
      this.kv.set(0, 0, 0);
      return;
    }
    p.x += this.kv.x * dt;
    p.z += this.kv.z * dt;
    pushOutOfBoxes(this.nav, p, RADIUS);
    const damp = Math.exp(-(flying ? 0.25 : 6) * dt);
    this.kv.x *= damp;
    this.kv.z *= damp;
    if (flying) {
      this.kv.y -= 22 * dt;
      this.air += this.kv.y * dt;
      if (this.air <= 0) {
        this.air = 0;
        if (this.kv.y < -5 && this.alive) this.stunT = Math.max(this.stunT, 0.35);
        this.kv.y = this.kv.y < -6 ? -this.kv.y * 0.2 : 0;
        this.kv.x *= 0.6;
        this.kv.z *= 0.6;
      }
    }
  }

  /** Apply damage. Returns true if it killed the wolf. */
  damage(amount: number): boolean {
    if (!this.alive) return false;
    this.health -= amount;
    this.flash = 0.12;
    this.sinceHit = 0;
    this.aggravate();
    if (this.health <= 0) {
      this.alive = false;
      this.deadTime = 0;
      this.updateBar();
      return true;
    }
    this.updateBar();
    return false;
  }

  private updateBar() {
    const ratio = Math.max(0, this.health / this.maxHealth);
    this.barFill.scale.x = 0.66 * ratio;
    this.barFill.center.set(ratio > 0 ? 0.5 / ratio : 0.5, 0.5);
    this.barFill.material.color.setHSL(0.33 * ratio, 0.75, 0.5);
    this.barBg.visible = this.barFill.visible = this.alive && ratio < 1 && this.sinceHit < BAR_HIDE_AFTER;
  }

  // ---------- behaviour ----------
  private pickTarget() {
    const p = this.group.position;
    let t = this.nav.randomFreePoint();
    for (let i = 0; i < 8; i++) {
      const d = Math.hypot(t.x - p.x, t.z - p.z);
      if (d > 5 && d < 40) break;
      t = this.nav.randomFreePoint();
    }
    this.target.copy(t);
    this.speed = WANDER_SPEED[0] + Math.random() * (WANDER_SPEED[1] - WANDER_SPEED[0]);
    this.state = 'wander';
    this.blockedT = 0;
    this.walkT = 0;
  }

  /** Move along the current heading; returns true if something is in the way. */
  private step(speed: number, facing: number, dt: number) {
    const p = this.group.position;
    const bx = p.x, bz = p.z;
    const step = speed * facing * dt;
    p.x += Math.sin(this.heading) * step;
    p.z += Math.cos(this.heading) * step;
    pushOutOfBoxes(this.nav, p, RADIUS);
    const moved = Math.hypot(p.x - bx, p.z - bz);
    return step > 1e-4 && moved < step * 0.5;
  }

  private wander(dt: number) {
    const p = this.group.position;
    if (this.state === 'idle') {
      this.idleT -= dt;
      if (this.idleT <= 0) this.pickTarget();
      return 0;
    }
    this.walkT += dt;
    const dx = this.target.x - p.x, dz = this.target.z - p.z;
    if (Math.hypot(dx, dz) < 0.6 || this.walkT > 25) {
      this.state = 'idle';
      this.idleT = 1 + Math.random() * 4;
      return 0;
    }
    const diff = angleDiff(this.heading, Math.atan2(dx, dz));
    this.heading += THREE.MathUtils.clamp(diff, -3 * dt, 3 * dt);
    const blocked = this.step(this.speed, Math.max(0, Math.cos(diff)), dt);
    this.blockedT = blocked ? this.blockedT + dt : 0;
    if (this.blockedT > 0.4) {
      this.state = 'idle';
      this.idleT = 0;
    }
    return this.blockedT === 0 ? this.speed : 0;
  }

  private chase(dt: number) {
    const p = this.group.position;
    const dx = this.player.x - p.x, dz = this.player.z - p.z;
    const dist = Math.hypot(dx, dz);

    // lose interest if the player gets far away and stays away
    this.farT = dist > GIVE_UP_DISTANCE ? this.farT + dt : 0;
    if (this.farT > GIVE_UP_TIME) {
      this.aggravated = false;
      this.state = 'idle';
      this.idleT = 2;
      this.eyeMat.color.set(0xffcc33);
      this.eyeMat.emissive.set(0x553300);
      return 0;
    }

    this.biteCd -= dt;
    let want = Math.atan2(dx, dz);
    if (this.detourT > 0) {
      this.detourT -= dt;
      want += this.detourDir * 1.2; // go around whatever is in the way
    }
    const diff = angleDiff(this.heading, want);
    this.heading += THREE.MathUtils.clamp(diff, -9 * dt, 9 * dt);

    if (dist < BITE_RANGE && Math.abs(this.player.y - p.y) < 1.8) {
      // in range: stop and bite
      if (this.biteCd <= 0) {
        this.biteCd = BITE_INTERVAL;
        this.lunge = 0.3;
        this.hooks.hurtPlayer(BITE_DAMAGE);
      }
      return 0;
    }
    if (dist < 1.1) return 0; // standing under/over the player (e.g. on a crate)
    const blocked = this.step(CHASE_SPEED, Math.max(0, Math.cos(diff)), dt);
    this.blockedT = blocked ? this.blockedT + dt : 0;
    if (this.blockedT > 0.25) {
      this.detourT = 0.9;
      this.detourDir = Math.random() < 0.5 ? -1 : 1;
      this.blockedT = 0;
    }
    return CHASE_SPEED;
  }

  update(dt: number) {
    if (this.disabled) return;
    if (this.alive) {
      if (this.barFill.visible) {
        this.sinceHit += dt;
        if (this.sinceHit >= BAR_HIDE_AFTER) this.updateBar();
      }
      this.flash = Math.max(0, this.flash - dt);
      if (this.material) this.material.emissive.setScalar(this.flash > 0 ? 0.8 : 0);

      this.physics(dt);
      if (this.stunT > 0) this.stunT -= dt;
      const speed = this.stunT > 0 ? 0 : this.aggravated ? this.chase(dt) : this.wander(dt);
      const p = this.group.position;
      p.y = this.nav.heightAt(p.x, p.z) + this.air;
      this.group.rotation.y = this.heading;
      this.animate(dt, speed);
      return;
    }
    // death: tip over and fade away, then respawn far from the player after a long wait
    this.deadTime += dt;
    this.physics(dt);
    this.group.position.y = this.nav.heightAt(this.group.position.x, this.group.position.z) + this.air;
    const t = Math.min(this.deadTime / 0.4, 1);
    this.group.scale.setScalar(this.baseScale * (1 - t));
    this.group.rotation.z = t * 1.3;
    if (t >= 1) this.group.visible = false;
    if (this.deadTime > RESPAWN_DELAY) this.reset(true);
  }

  private animate(dt: number, speed: number) {
    this.clock += dt;
    const t = this.clock + this.seed;
    const running = speed > 4;
    this.amp += ((speed > 0.1 ? 1 : 0) - this.amp) * (1 - Math.exp(-8 * dt));
    this.phase += dt * speed * (running ? 2.2 : 3.4);
    const idle = 1 - this.amp;
    const swing = this.amp * (running ? 0.9 : 0.55);
    const angry = this.aggravated;

    // legs: diagonal gait (FL+BR together), knees fold as the leg comes forward
    const phases = [this.phase, this.phase + PI, this.phase + PI, this.phase];
    this.legs.forEach((leg, i) => {
      const p = phases[i];
      leg.upper.rotation.x = Math.sin(p) * swing * (leg.hind ? 1.0 : 0.9);
      const fold = Math.max(0, Math.cos(p)) * 0.8 * this.amp;
      leg.lower.rotation.x = (leg.hind ? -0.5 : 0) + (leg.hind ? -fold : fold);
    });

    // body: bob, gallop surge, breathing
    this.body.position.y = Math.abs(Math.cos(this.phase)) * (running ? 0.07 : 0.025) * this.amp + Math.sin(t * 2.2) * 0.004 * idle;
    this.body.rotation.x = running ? Math.sin(this.phase * 2) * 0.04 : 0;

    // head: sniffs around when calm, lowers and fixes on the player when angry
    const lowered = angry ? 0.28 : 0;
    this.head.rotation.x = lowered + Math.sin(t * 0.9) * 0.08 * idle + Math.sin(this.phase * 2) * 0.04 * this.amp;
    this.head.rotation.y = Math.sin(t * 0.6) * 0.45 * idle * (angry ? 0.2 : 1);
    this.head.position.y = 0.86 - lowered * 0.12;

    // jaw: shut when calm, panting while running, snarling when angry and standing, snapping on a bite
    let open = angry
      ? this.amp > 0.5 ? 0.18 + Math.sin(this.phase * 3) * 0.05 : 0.3 + Math.sin(t * 9) * 0.04
      : 0.03 + Math.max(0, Math.sin(t * 3)) * 0.04 * idle;
    if (this.lunge > 0) {
      this.lunge = Math.max(0, this.lunge - dt);
      const k = this.lunge / 0.3; // 1 -> 0
      open = k > 0.5 ? 0.75 : 0.75 * (k / 0.5); // wide, then snap shut
      this.body.position.z = Math.sin(k * PI) * 0.35;
      this.body.rotation.x += Math.sin(k * PI) * 0.18;
    } else {
      this.body.position.z = 0;
    }
    this.jaw.rotation.x = open;

    // ears: perked and flicking when calm, pinned back when angry
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? -1 : 1;
      this.ears[i].rotation.x = angry ? -0.9 : Math.max(0, Math.sin(t * 1.3 + i * 2.1) - 0.85) * 3;
      this.ears[i].rotation.z = -s * (angry ? 0.9 : 0.25);
    }

    // hackles rise when angry
    if (this.hackles) {
      const target = angry ? 1.9 : 1.0;
      this.hackles.scale.y += (target - this.hackles.scale.y) * (1 - Math.exp(-8 * dt));
      this.hackles.position.y = -0.08 * (this.hackles.scale.y - 0.9);
    }

    // tail: wags in a wave when calm, held low and stiff when angry
    const wag = angry ? 0.08 : 0.35 + 0.2 * this.amp;
    this.tail.forEach((seg, i) => {
      seg.rotation.y = Math.sin(t * (angry ? 3 : 4.5) - i * 0.9) * wag * (1 + i * 0.4);
    });
    this.tail[0].rotation.x = angry ? -0.1 : -0.55 + (running ? 0.35 : 0);
  }
}

function rnd(a: number, b: number) {
  return a + Math.random() * (b - a);
}

const _a = new THREE.Color();
const _b = new THREE.Color();
const smoothstep = (a: number, b: number, x: number) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
/**
 * Recolours a fur mesh by surface direction: darker on top (the saddle), pale underneath and on the chest.
 * Gives a smooth blend instead of separate coloured blobs.
 */
function furGradient(geo: THREE.BufferGeometry, base: number, dark: number, light: number) {
  const pos = geo.attributes.position, nor = geo.attributes.normal, col = geo.attributes.color;
  for (let i = 0; i < pos.count; i++) {
    const ny = nor.getY(i), y = pos.getY(i), z = pos.getZ(i);
    const kDark = smoothstep(0.25, 0.85, ny) * (1 - smoothstep(0.42, 0.62, z) * 0.6);
    const kBelly = smoothstep(-0.05, -0.6, ny);
    const kChest = z > 0.3 && y < 0.8 ? smoothstep(0.3, 0.48, z) * 0.85 : 0;
    _a.set(base).lerp(_b.set(dark), kDark).lerp(_b.set(light), Math.max(kBelly, kChest));
    col.setXYZ(i, _a.r, _a.g, _a.b);
  }
  col.needsUpdate = true;
}
