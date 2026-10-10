import * as THREE from 'three';
import { Mannequin } from '../entities/mannequin';
import { boltHitSound, explosionSound } from '../audio/audio';
import type { WeaponStats } from '../weapons/weapons';
import { camera, pos, scene, vel, world } from './core';
import { hasLineOfSight, mannequins, wolves, type Target } from './actors';
import { applyHit } from './combat';
import { addScore } from './flow';
import { damagePlayer } from './player';
import { POINTS_HIT, S } from './state';

// Physical projectiles and debris: crossbow bolts (gravity, stick into walls), bouncing grenades with a fuse and
// a real explosion (area damage, knockback, camera shake), plus ejected shell casings and blast debris that bounce
// on the terrain and crates. Hitscan guns stay in combat.ts.

type Kind = 'bolt' | 'grenade' | 'casing' | 'debris';
interface Body {
  kind: Kind;
  mesh: THREE.Object3D;
  v: THREE.Vector3;
  r: number; // collision radius
  life: number; // seconds until it disappears
  bounce: number; // restitution
  friction: number; // tangential speed lost per bounce
  gravity: number;
  spin: THREE.Vector3; // rad/s
  rest: boolean; // lying still
  // bolts / grenades
  stats?: WeaponStats;
  fuse?: number;
  stuck?: boolean;
}
const bodies: Body[] = [];
const MAX_BODIES = 90;

// shared shapes
const grenadeGeo = new THREE.SphereGeometry(0.1, 12, 8);
const grenadeMat = new THREE.MeshStandardMaterial({ color: 0x4f5a2d, roughness: 0.6, metalness: 0.3, emissive: 0x000000 });
const casingGeo = new THREE.CylinderGeometry(0.0045, 0.0045, 0.03, 6);
const casingMat = new THREE.MeshStandardMaterial({ color: 0xc9a24a, roughness: 0.3, metalness: 0.9 });
const debrisGeo = new THREE.BoxGeometry(0.1, 0.1, 0.1);
const debrisMats = [0x6b5a3a, 0x4a4a4a, 0x7a6a50].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 1 }));
const boltShaftGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.5, 6).rotateX(Math.PI / 2);
const boltTipGeo = new THREE.ConeGeometry(0.025, 0.1, 6).rotateX(-Math.PI / 2).translate(0, 0, -0.3);
const boltFinGeo = new THREE.BoxGeometry(0.005, 0.07, 0.07).translate(0, 0, 0.22);
const boltMatWood = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 0.8 });
const boltMatSteel = new THREE.MeshStandardMaterial({ color: 0xcfd3d8, roughness: 0.3, metalness: 0.9 });
const boltMatFin = new THREE.MeshStandardMaterial({ color: 0xc4342b, roughness: 0.8 });

function makeBolt() {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(boltShaftGeo, boltMatWood), new THREE.Mesh(boltTipGeo, boltMatSteel));
  const f1 = new THREE.Mesh(boltFinGeo, boltMatFin);
  const f2 = f1.clone();
  f2.rotation.z = Math.PI / 2;
  g.add(f1, f2);
  return g;
}

function add(b: Body) {
  scene.add(b.mesh);
  bodies.push(b);
  if (bodies.length > MAX_BODIES) remove(0); // oldest goes first
}
function remove(i: number) {
  scene.remove(bodies[i].mesh);
  bodies.splice(i, 1);
}
// ---- the boss's boulders: a slow lobbed arc you can dodge; a direct hit hurts a lot ----
const ROCK_R = 0.95, ROCK_G = 16, ROCK_DAMAGE = 60;
interface BossRock { mesh: THREE.Mesh; v: THREE.Vector3; spin: THREE.Vector3; life: number; r: number; damage: number }
const SMALL_ROCK = { r: 0.32, damage: 16, speed: 14 }; // thrown by thrower zombies
const bossRocks: BossRock[] = [];
const rockGeo = new THREE.IcosahedronGeometry(ROCK_R, 1);
const rockMat = new THREE.MeshStandardMaterial({ color: 0x6f6a62, roughness: 1, flatShading: true });
export function spawnBossRock(from: THREE.Vector3, small = false) {
  const d = Math.hypot(pos.x - from.x, pos.z - from.z);
  const T = small ? THREE.MathUtils.clamp(d / SMALL_ROCK.speed, 0.9, 2.6) : THREE.MathUtils.clamp(d / 20, 1.5, 3.4); // flight time: slow enough to see it coming and sidestep
  const target = new THREE.Vector3(pos.x + vel.x * T * 0.8, pos.y + 1.1, pos.z + vel.z * T * 0.8); // leads a moving player a little
  const v = new THREE.Vector3(target.x - from.x, target.y - from.y + 0.5 * ROCK_G * T * T, target.z - from.z).divideScalar(T);
  const mesh = new THREE.Mesh(rockGeo, rockMat);
  const rr = small ? SMALL_ROCK.r / ROCK_R : 1;
  mesh.scale.set(rr, 0.85 * rr, 1.1 * rr);
  mesh.position.copy(from);
  mesh.castShadow = true;
  scene.add(mesh);
  bossRocks.push({ mesh, v, spin: new THREE.Vector3(Math.random() * 4, Math.random() * 4, Math.random() * 4), life: 8, r: small ? SMALL_ROCK.r : ROCK_R, damage: small ? SMALL_ROCK.damage : ROCK_DAMAGE });
}
function updateBossRocks(dt: number) {
  for (let i = bossRocks.length - 1; i >= 0; i--) {
    const r = bossRocks[i];
    r.v.y -= ROCK_G * dt;
    r.mesh.position.addScaledVector(r.v, dt);
    r.mesh.rotation.x += r.spin.x * dt;
    r.mesh.rotation.y += r.spin.y * dt;
    r.life -= dt;
    const m = r.mesh.position;
    const hitPlayer = !S.dead && Math.hypot(m.x - pos.x, m.z - pos.z) < r.r + 0.5 && m.y > pos.y - r.r && m.y < pos.y + S.playerHeight + r.r;
    const hitGround = m.y - r.r * 0.8 < world.heightAt(m.x, m.z) || r.life <= 0;
    if (hitPlayer) {
      damagePlayer(r.damage);
      S.shake = r.r > 0.5 ? 1 : 0.3;
    }
    if (hitPlayer || hitGround) {
      spawnDebris(m.clone(), r.r > 0.5 ? 12 : 4, r.r > 0.5 ? 7 : 3);
      explosionSound(m.distanceTo(camera.position) + (r.r > 0.5 ? 50 : 90)); // a dull crash
      if (r.r > 0.5) S.shake = Math.max(S.shake, Math.max(0, 0.6 - m.distanceTo(camera.position) / 30));
      scene.remove(r.mesh);
      bossRocks.splice(i, 1);
    }
  }
}

/** Remove everything (new game / level reset). */
export function clearProjectiles() {
  for (const r of bossRocks) scene.remove(r.mesh);
  bossRocks.length = 0;
  for (const b of bodies) scene.remove(b.mesh);
  bodies.length = 0;
  for (const f of flashes) scene.remove(f.mesh);
  flashes.length = 0;
}

// ---------------------------------------------------------------------------------------------
// collision with the world: terrain (height field) and the solid boxes (crates, walls, rocks)
// ---------------------------------------------------------------------------------------------
const _n = new THREE.Vector3();
function groundNormal(x: number, z: number, out: THREE.Vector3) {
  const e = 0.4;
  const hx = world.heightAt(x + e, z) - world.heightAt(x - e, z);
  const hz = world.heightAt(x, z + e) - world.heightAt(x, z - e);
  return out.set(-hx / (2 * e), 1, -hz / (2 * e)).normalize();
}

/** Advance one body by dt with gravity and collisions. Returns what it hit first, if anything. */
function stepBody(b: Body, dt: number): 'ground' | 'box' | null {
  const p = b.mesh.position;
  b.v.y -= b.gravity * dt;
  p.addScaledVector(b.v, dt);
  let hit: 'ground' | 'box' | null = null;

  const gy = world.heightAt(p.x, p.z);
  if (p.y - b.r < gy) {
    p.y = gy + b.r;
    groundNormal(p.x, p.z, _n);
    const vn = b.v.dot(_n);
    if (vn < 0) {
      b.v.addScaledVector(_n, -(1 + b.bounce) * vn); // mirror the speed into the surface
      const keep = 1 - b.friction;
      b.v.x *= keep;
      b.v.z *= keep;
      hit = 'ground';
    }
  }
  for (const box of world.boxesNear(p.x, p.z, b.r + 0.6)) {
    if (p.x < box.min.x - b.r || p.x > box.max.x + b.r || p.y < box.min.y - b.r || p.y > box.max.y + b.r || p.z < box.min.z - b.r || p.z > box.max.z + b.r) continue;
    // inside the padded box: leave through the nearest face
    const d = [p.x - (box.min.x - b.r), box.max.x + b.r - p.x, p.y - (box.min.y - b.r), box.max.y + b.r - p.y, p.z - (box.min.z - b.r), box.max.z + b.r - p.z];
    let k = 0;
    for (let i = 1; i < 6; i++) if (d[i] < d[k]) k = i;
    const axis = k >> 1; // 0 x, 1 y, 2 z
    const sign = k % 2 === 0 ? -1 : 1;
    const comp = axis === 0 ? 'x' : axis === 1 ? 'y' : 'z';
    p[comp] += sign * d[k];
    if (b.v[comp] * sign < 0) {
      b.v[comp] *= -b.bounce;
      const keep = 1 - b.friction * 0.5;
      for (const o of ['x', 'y', 'z'] as const) if (o !== comp) b.v[o] *= keep;
    }
    hit = 'box';
  }
  return hit;
}

// ---------------------------------------------------------------------------------------------
// spawning
// ---------------------------------------------------------------------------------------------
const _dir = new THREE.Vector3();
export function spawnBolt(origin: THREE.Vector3, dir: THREE.Vector3, stats: WeaponStats) {
  const pr = stats.projectile!;
  const mesh = makeBolt();
  mesh.position.copy(origin);
  const b: Body = {
    kind: 'bolt', mesh, v: dir.clone().setLength(pr.speed), r: 0.02, life: 6, bounce: 0, friction: 0,
    gravity: pr.gravity, spin: new THREE.Vector3(), rest: false, stats,
  };
  mesh.quaternion.setFromUnitVectors(_n.set(0, 0, -1), _dir.copy(dir).normalize());
  add(b);
}

export function spawnGrenade(origin: THREE.Vector3, dir: THREE.Vector3, stats: WeaponStats) {
  const pr = stats.projectile!;
  const mesh = new THREE.Mesh(grenadeGeo, grenadeMat.clone());
  mesh.position.copy(origin);
  add({
    kind: 'grenade', mesh, v: dir.clone().setLength(pr.speed), r: 0.1, life: 12, bounce: 0.42, friction: 0.22,
    gravity: pr.gravity, spin: new THREE.Vector3(Math.random() * 8 - 4, Math.random() * 8 - 4, Math.random() * 8 - 4),
    rest: false, stats, fuse: stats.explosion!.fuse,
  });
}

/** An ejected shell casing, flying out to the right of the weapon and bouncing on the ground. */
export function spawnCasing(scale = 1) {
  const mesh = new THREE.Mesh(casingGeo, casingMat);
  mesh.scale.setScalar(scale);
  const right = _n.set(1, 0, 0).applyQuaternion(camera.quaternion);
  const fwd = _dir.set(0, 0, -1).applyQuaternion(camera.quaternion);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  camera.getWorldPosition(mesh.position);
  mesh.position.addScaledVector(right, 0.2).addScaledVector(fwd, 0.35).addScaledVector(up, -0.12);
  const v = new THREE.Vector3()
    .addScaledVector(right, 2.0 + Math.random() * 1.2)
    .addScaledVector(up, 1.3 + Math.random() * 0.9)
    .addScaledVector(fwd, -0.4 + Math.random() * 0.6);
  v.x += vel.x * 0.5;
  v.z += vel.z * 0.5;
  add({
    kind: 'casing', mesh, v, r: 0.012, life: 2.5, bounce: 0.38, friction: 0.35, gravity: 14,
    spin: new THREE.Vector3(Math.random() * 30 - 15, Math.random() * 30 - 15, Math.random() * 30 - 15), rest: false,
  });
}

function spawnDebris(at: THREE.Vector3, count: number, speed: number) {
  for (let i = 0; i < count; i++) {
    const mesh = new THREE.Mesh(debrisGeo, debrisMats[i % debrisMats.length]);
    mesh.scale.setScalar(0.4 + Math.random() * 0.8);
    mesh.position.copy(at);
    const a = Math.random() * Math.PI * 2;
    const up = 0.5 + Math.random() * 0.9;
    add({
      kind: 'debris', mesh, v: new THREE.Vector3(Math.cos(a) * (0.4 + Math.random()), up, Math.sin(a) * (0.4 + Math.random())).multiplyScalar(speed * (0.5 + Math.random() * 0.6)),
      r: 0.06, life: 1.4 + Math.random() * 1.2, bounce: 0.35, friction: 0.4, gravity: 18,
      spin: new THREE.Vector3(Math.random() * 14 - 7, Math.random() * 14 - 7, Math.random() * 14 - 7), rest: false,
    });
  }
}

// ---------------------------------------------------------------------------------------------
// explosion: fireball, shock ring, smoke, light, debris, then damage + knockback in a radius
// ---------------------------------------------------------------------------------------------
interface Flash { mesh: THREE.Mesh; t: number; dur: number; from: number; to: number; baseOpacity: number }
const flashes: Flash[] = [];
const fireMat = () => new THREE.MeshBasicMaterial({ color: 0xffa030, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
const smokeMat = () => new THREE.MeshBasicMaterial({ color: 0x3a3836, transparent: true, opacity: 0.55, depthWrite: false });
const ringMat = () => new THREE.MeshBasicMaterial({ color: 0xffe0a0, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
// created up front (intensity 0): adding a light later would make every material recompile its shader mid-game
const boomLight = new THREE.PointLight(0xffa550, 0, 30, 2);
scene.add(boomLight);
let boomLightT = 0;

function addFlash(mesh: THREE.Mesh, dur: number, from: number, to: number) {
  scene.add(mesh);
  flashes.push({ mesh, t: 0, dur, from, to, baseOpacity: (mesh.material as THREE.MeshBasicMaterial).opacity });
}

const _c = new THREE.Vector3();
const _push = new THREE.Vector3();
export function explode(at: THREE.Vector3, stats: WeaponStats) {
  const ex = stats.explosion!;
  const R = ex.radius;

  // look and sound
  const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), fireMat());
  ball.position.copy(at);
  addFlash(ball, 0.42, 0.4, R * 0.55);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 32), ringMat());
  ring.position.copy(at).y += 0.15;
  ring.rotation.x = -Math.PI / 2;
  addFlash(ring, 0.38, 0.5, R);
  for (let i = 0; i < 5; i++) {
    const puff = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), smokeMat());
    puff.position.set(at.x + (Math.random() - 0.5) * R * 0.5, at.y + 0.3 + Math.random() * 1.2, at.z + (Math.random() - 0.5) * R * 0.5);
    addFlash(puff, 1.3 + Math.random() * 0.6, 0.4, R * (0.28 + Math.random() * 0.18));
  }
  boomLight.position.copy(at).y += 1;
  boomLightT = 0.3;
  spawnDebris(at, 16, 7);
  explosionSound(at.distanceTo(camera.position));

  // characters in the blast
  const from = _c.copy(at);
  from.y += 0.3;
  let any = false;
  const all: Target[] = [...mannequins, ...wolves];
  for (const t of all) {
    if (!t.alive) {
      // dead bodies are thrown around too (they are not damaged again)
      const dp = t.group.position;
      const d = Math.hypot(dp.x - at.x, dp.z - at.z);
      if (d < R) {
        const k = 1 - d / R;
        t.impulse(_push.set(dp.x - at.x, 0, dp.z - at.z).setLength(ex.push * k).setY(ex.push * 0.5 * k));
      }
      continue;
    }
    const centre = new THREE.Vector3(t.group.position.x, t.group.position.y + 0.95, t.group.position.z);
    const d = centre.distanceTo(at);
    if (d >= R + 0.6) continue;
    if (d > 1.2 && !hasLineOfSight(from, centre)) continue; // cover shields from the blast
    const k = Math.max(0, 1 - d / R);
    const dmg = ex.damage * Math.pow(k, 1.3);
    if (dmg < 1) continue;
    any = true;
    const dir = new THREE.Vector3(centre.x - at.x, 0, centre.z - at.z).setLength(ex.push * k);
    dir.y = ex.push * 0.55 * k + 1;
    applyHit(t, dmg, false, centre); // damage, alerts, score
    t.impulse(dir);
  }
  if (any) {
    S.shotsHit++; // one hit bonus per grenade, like a shotgun blast
    addScore(POINTS_HIT);
  }

  // the player feels it too, much more weakly (and can use it to boost a jump)
  const pc = new THREE.Vector3(pos.x, pos.y + 0.9, pos.z);
  const dp = pc.distanceTo(at);
  if (dp < R + 0.5 && (dp < 1.2 || hasLineOfSight(from, pc))) {
    const k = Math.max(0, 1 - dp / R);
    const self = ex.damage * Math.pow(k, 1.3) * ex.selfMult;
    if (self >= 1) damagePlayer(self);
    const dir = new THREE.Vector3(pc.x - at.x, 0, pc.z - at.z).setLength(ex.push * 0.8 * k);
    vel.x += dir.x;
    vel.z += dir.z;
    vel.y = Math.max(vel.y, ex.push * 0.65 * k);
    S.onGround = false;
    S.coyote = 0;
  }
  S.shake = Math.max(S.shake, Math.max(0.15, 1 - at.distanceTo(camera.position) / 40));
}

// ---------------------------------------------------------------------------------------------
// per-frame update
// ---------------------------------------------------------------------------------------------
const ray = new THREE.Raycaster();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

/** Characters near a segment (cheap pre-filter before any mesh raycast). */
function nearTargets(from: THREE.Vector3, to: THREE.Vector3): Target[] {
  const reach = from.distanceTo(to) + 2.5;
  const out: Target[] = [];
  for (const t of mannequins) if (t.alive && Math.hypot(t.group.position.x - to.x, t.group.position.z - to.z) < reach) out.push(t);
  for (const t of wolves) if (t.alive && Math.hypot(t.group.position.x - to.x, t.group.position.z - to.z) < reach) out.push(t);
  return out;
}

/** Is the sphere (centre c, radius r) touching a living character (a vertical capsule)? */
function touching(c: THREE.Vector3, r: number): Target | null {
  for (const t of nearTargets(c, c)) {
    const gp = t.group.position;
    if (c.y < gp.y - r || c.y > gp.y + 1.95 + r) continue;
    if (Math.hypot(c.x - gp.x, c.z - gp.z) < 0.45 + r) return t;
  }
  return null;
}

function updateBolt(b: Body, i: number, dt: number): boolean {
  const p = b.mesh.position;
  if (b.stuck) {
    b.life -= dt;
    return b.life > 0;
  }
  const steps = Math.max(1, Math.ceil((b.v.length() * dt) / 0.5));
  const h = dt / steps;
  for (let s = 0; s < steps; s++) {
    _a.copy(p);
    const hit = stepBody(b, h);
    // against characters: a ray along this little move (so thin targets cannot be skipped)
    _b.copy(p).sub(_a);
    const len = _b.length();
    if (len > 1e-6) {
      const near = nearTargets(_a, p);
      if (near.length) {
        ray.set(_a, _b.normalize());
        ray.far = len + 0.05;
        const meshes = near.flatMap((t) => t.hitMeshes);
        const rh = ray.intersectObjects(meshes, false)[0];
        const owner = rh?.object.userData.owner as Target | undefined;
        if (rh && owner) {
          const head = !!rh.object.userData.head;
          const st = b.stats!;
          S.shotsHit++;
          addScore(POINTS_HIT);
          _push.copy(b.v).setLength(st.impactImpulse * 0.06);
          applyHit(owner, st.damage * (head ? st.headshotMultiplier : 1), head, rh.point, _push);
          if (owner.alive) owner.crossbowHit(); // frozen for 2 s, loses its target for 5 s
          boltHitSound(rh.point.distanceTo(camera.position));
          return false; // the bolt is spent
        }
      }
    }
    if (hit) {
      // sticks into whatever it hit, pointing along its flight
      b.stuck = true;
      b.life = 8;
      b.v.set(0, 0, 0);
      boltHitSound(p.distanceTo(camera.position));
      spawnDebris(p, 3, 2.5);
      return true;
    }
  }
  // nose follows the flight path (it drops as gravity pulls it down)
  b.mesh.quaternion.setFromUnitVectors(_n.set(0, 0, -1), _dir.copy(b.v).normalize());
  void i;
  return b.life > 0;
}

function updateGrenade(b: Body, dt: number): boolean {
  const p = b.mesh.position;
  b.fuse! -= dt;
  const mat = (b.mesh as THREE.Mesh).material as THREE.MeshStandardMaterial;
  mat.emissive.setRGB(Math.sin(b.fuse! * (8 + (2.4 - b.fuse!) * 6)) > 0 ? 0.9 : 0, 0.05, 0); // blinks faster as the fuse burns
  if (b.fuse! <= 0) {
    explode(p, b.stats!);
    return false;
  }
  const steps = Math.max(1, Math.ceil((b.v.length() * dt) / 0.3));
  const h = dt / steps;
  for (let s = 0; s < steps; s++) {
    if (!b.rest) {
      const hit = stepBody(b, h);
      if (hit === 'ground' && b.v.length() < 1.6) {
        b.v.set(0, 0, 0); // it has stopped bouncing: lies there until the fuse runs out
        b.rest = true;
      }
      if (hit && b.v.lengthSq() > 4) b.spin.multiplyScalar(0.8);
    }
    // explodes on touching a living character
    const t = touching(p, b.r);
    if (t) {
      explode(p, b.stats!);
      return false;
    }
  }
  if (!b.rest) {
    b.mesh.rotation.x += b.spin.x * dt;
    b.mesh.rotation.y += b.spin.y * dt;
  }
  return true;
}

export function updateProjectiles(dt: number) {
  updateBossRocks(dt);
  for (let i = bodies.length - 1; i >= 0; i--) {
    const b = bodies[i];
    let keep = true;
    b.life -= b.kind === 'bolt' ? 0 : dt;
    if (b.kind === 'bolt') keep = updateBolt(b, i, dt);
    else if (b.kind === 'grenade') keep = updateGrenade(b, dt) && b.life > 0;
    else {
      // casings and debris
      if (!b.rest) {
        stepBody(b, dt);
        b.mesh.rotation.x += b.spin.x * dt;
        b.mesh.rotation.z += b.spin.z * dt;
        if (b.v.lengthSq() < 0.15 && b.mesh.position.y - b.r <= world.heightAt(b.mesh.position.x, b.mesh.position.z) + 0.02) b.rest = true;
      }
      keep = b.life > 0;
      if (b.life < 0.4) b.mesh.scale.multiplyScalar(Math.max(0, 1 - dt * 3)); // shrink away at the end
    }
    if (!keep) remove(i);
  }
  // explosion visuals
  for (let i = flashes.length - 1; i >= 0; i--) {
    const f = flashes[i];
    f.t += dt;
    const k = Math.min(1, f.t / f.dur);
    const e = 1 - Math.pow(1 - k, 2.5);
    f.mesh.scale.setScalar(f.from + (f.to - f.from) * e);
    (f.mesh.material as THREE.MeshBasicMaterial).opacity = f.baseOpacity * (1 - k * k);
    if (f.t >= f.dur) {
      scene.remove(f.mesh);
      f.mesh.geometry.dispose();
      (f.mesh.material as THREE.Material).dispose();
      flashes.splice(i, 1);
    }
  }
  if (boomLight) {
    boomLightT = Math.max(0, boomLightT - dt);
    boomLight.intensity = boomLightT > 0 ? 900 * (boomLightT / 0.3) ** 2 : 0;
  }
}

/** Dev / test helper. */
export function projectileCount() {
  return bodies.length;
}

/** Dev / test helper: what is flying around. */
export function projectileInfo() {
  return bodies.map((b) => ({ kind: b.kind, p: b.mesh.position.toArray().map((n) => +n.toFixed(2)), v: b.v.toArray().map((n) => +n.toFixed(1)), stuck: !!b.stuck, rest: b.rest }));
}
