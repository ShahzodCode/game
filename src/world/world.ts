import * as THREE from 'three';
import { buildRooms, makeSignBoard, type Rooms } from './rooms';
import { buildSupplyShopProps } from './shopProps';
import { BoxGrid } from './boxGrid';
import { ARCHES, BOULDER_FIELDS, ENTRY, FLATS, HOUSES, MESAS, POND, ROCK_PILES, SPIRES, STONE_CIRCLE, keepClear, pathDistance } from './layout';
import {
  HOUSE_STYLES, buildArch, buildBackdrop, buildCamp, buildClouds, buildForest, buildGroundCover, buildHouse, buildPond,
  buildSpire, buildStoneCircle, makeRocks, type Ctx, type HouseHandle,
} from './scenery';

export interface World {
  /** Solid boxes used for player collision (structures + big rocks). */
  boxes: THREE.Box3[];
  /** Meshes that block bullets (terrain, structures, rocks). */
  blockers: THREE.Object3D[];
  spawnPoints: THREE.Vector3[];
  half: number; // half-size of the arena
  /** Terrain surface height at (x, z). */
  heightAt: (x: number, z: number) => number;
  randomFreePoint: (avoid?: THREE.Vector3, minDist?: number) => THREE.Vector3;
  /** Random walkable spot close to the outer walls. */
  randomEdgePoint: (avoid?: THREE.Vector3, minDist?: number) => THREE.Vector3;
  /** Where a new game starts: inside the safe room. */
  playerStart: THREE.Vector3;
  /** The arena side of the entrance gate (where the level begins). */
  arenaEntry: THREE.Vector3;
  /** Safe room, airlock and the two sets of doors. */
  rooms: Rooms;
  /** 0 = outdoors in the arena, 1 = inside the rooms: dims the sun, tints the fog. */
  setIndoor: (k: number) => void;
  /** Ammo shop buy zone: stand inside `radius` of `pos` to buy. */
  shop: { pos: THREE.Vector3; radius: number };
  /** Distance along a ray to the ground, or -1 (the terrain is not ray-tested as a mesh: see game/raycast.ts). */
  terrainRay: (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, far: number) => number;
  /** Stands in for the ground in hit lists (no owner). */
  terrainProxy: THREE.Object3D;
  /** Collision boxes near a point (a fresh array each call). */
  boxesNear: (x: number, z: number, r: number) => THREE.Box3[];
  /** Quality knob: sun shadow resolution (0 = shadows off). */
  setShadowQuality: (mapSize: number) => void;
  /** Per-frame life: doors that open, campfire, water, clouds. */
  update: (dt: number, time: number, player: THREE.Vector3) => void;
}

// ---------- helpers ----------
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const smooth = (a: number, b: number, x: number) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const gauss = (x: number, z: number, cx: number, cz: number, sigma: number, amp: number) =>
  amp * Math.exp(-((x - cx) ** 2 + (z - cz) ** 2) / (2 * sigma * sigma));

// ---------- layout data ----------
interface Structure { x: number; z: number; w: number; h: number; d: number; color: number }
/** The only free-standing boxes left: the supply shop kiosk (counter + back wall). */
const STRUCTURES: Structure[] = [
  { x: 8, z: 54, w: 3, h: 1.1, d: 1, color: 0x3b6ea8 },
  { x: 8, z: 55.6, w: 3.4, h: 2.4, d: 0.3, color: 0x2f3b52 },
];

// gentle forest hills in the west, big rugged ridges in the east: [x, z, sigma, amplitude]
const BUMPS: [number, number, number, number][] = [
  // forest (west): soft, wide
  [-45, -10, 10, 2.0], [-20, 22, 9, 1.5], [-50, 38, 9, 2.2], [-22, -42, 10, 2.2], [-8, 40, 8, 1.2], [-48, -46, 8, 1.8],
  [-8, -14, 7, 1.3], [-52, 8, 7, 1.6],
  // middle
  [2, -6, 9, 1.2], [4, 26, 8, 1.0],
  // badlands (east): taller and tighter
  [30, -8, 5, 3.0], [48, -10, 6, 3.4], [22, -26, 6, 2.6], [52, 34, 6, 2.6], [28, 40, 6, 2.2], [14, 12, 5, 1.9], [42, 4, 4.5, 2.2],
  [56, -34, 6, 2.8], [10, -46, 7, 2.4],
];

const PLAYER_START = new THREE.Vector2(0, 50);
const SHOP_ZONE = { x: 8, z: 51.4, radius: 3 };

export function buildWorld(scene: THREE.Scene): World {
  const half = 60;
  const rand = rng(1337);
  const boxes: THREE.Box3[] = [];
  const blockers: THREE.Object3D[] = [];

  scene.background = new THREE.Color(0x9ec9e8);
  scene.fog = new THREE.Fog(0x9ec9e8, 60, 190);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x556655, 0.8);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2d6, 2.2);
  sun.position.set(25, 40, 15);
  sun.castShadow = true;
  sun.position.set(50, 80, 30);
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.bias = -0.0004; // steadier shadows: no acne / flicker on flat walls
  sun.shadow.normalBias = 0.04;
  const s = sun.shadow.camera;
  s.left = s.bottom = -half - 5;
  s.right = s.top = half + 5;
  s.far = 220;
  scene.add(sun);

  // ---------- terrain height function ----------
  const analyticHeight = (x: number, z: number) => {
    let h = 0;
    for (const [cx, cz, sg, a] of BUMPS) h += gauss(x, z, cx, cz, sg, a);
    for (const [cx, cz] of ROCK_PILES) h += gauss(x, z, cx, cz, 2.6, 1.1);
    for (const m of MESAS) h += m.h * (1 - smooth(m.r, m.r + 7, Math.hypot(x - m.x, z - m.z))); // flat-topped plateaus with ramps
    h += gauss(x, z, POND.x, POND.z, 5.2, -2.4); // the pond basin
    const east = smooth(-6, 16, x);
    h += (0.1 + 0.08 * east) * Math.sin(x * 0.7) * Math.cos(z * 0.55) + 0.07 * Math.sin(x * 1.9 + z * 1.3); // small bumps
    h += east * 0.8 * Math.abs(Math.sin(x * 0.09 + z * 0.05 + 1)); // long ridges in the badlands
    // keep ground flat under the houses, camp, entrance and shop, and near the outer walls
    let mask = smooth(1, 6, half - Math.max(Math.abs(x), Math.abs(z)));
    for (const f of FLATS) {
      const dx = Math.max(Math.abs(x - f.x) - f.w / 2, 0);
      const dz = Math.max(Math.abs(z - f.z) - f.d / 2, 0);
      mask *= smooth(0, f.margin, Math.hypot(dx, dz));
    }
    return h * mask;
  };

  // The height is sampled on a 0.5 m grid with bilinear interpolation: bots, projectiles and the player ask for it
  // hundreds of times per frame, and the analytic version sums ~40 gaussians each time.
  const GRID = 0.5;
  const GN = Math.round((half * 2) / GRID) + 1;
  const grid = new Float32Array(GN * GN);
  for (let j = 0; j < GN; j++) for (let i = 0; i < GN; i++) grid[j * GN + i] = analyticHeight(-half + i * GRID, -half + j * GRID);
  const heightAt = (x: number, z: number) => {
    const fx = THREE.MathUtils.clamp((x + half) / GRID, 0, GN - 1.0001);
    const fz = THREE.MathUtils.clamp((z + half) / GRID, 0, GN - 1.0001);
    const i = Math.floor(fx), j = Math.floor(fz);
    const tx = fx - i, tz = fz - j;
    const k = j * GN + i;
    return (grid[k] * (1 - tx) + grid[k + 1] * tx) * (1 - tz) + (grid[k + GN] * (1 - tx) + grid[k + GN + 1] * tx) * tz;
  };
  /** March a ray over the height field; refine the crossing by bisection. */
  const terrainRay = (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, far: number) => {
    const STEP = 0.6;
    let tPrev = 0;
    if (oy - heightAt(ox, oz) < 0) return -1; // starting below the ground: ignore
    for (let t = STEP; ; t += STEP) {
      const tt = Math.min(t, far);
      const x = ox + dx * tt, z = oz + dz * tt;
      if (Math.abs(x) > half + 1 || Math.abs(z) > half + 1) return -1; // left the arena (the walls stop rays first)
      const f = oy + dy * tt - heightAt(x, z);
      if (f < 0) {
        let lo = tPrev, hi = tt;
        for (let k = 0; k < 10; k++) {
          const mid = (lo + hi) / 2;
          if (oy + dy * mid - heightAt(ox + dx * mid, oz + dz * mid) < 0) hi = mid;
          else lo = mid;
        }
        return hi;
      }
      if (tt >= far) return -1;
      tPrev = tt;
    }
  };

  // ---------- terrain mesh ----------
  const seg = 160;
  const geo = new THREE.PlaneGeometry(half * 2, half * 2, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)));
  geo.computeVertexNormals();
  const colors = new Float32Array(pos.count * 3);
  const norm = geo.attributes.normal;
  const grassW = new THREE.Color(0x4a8236), grassW2 = new THREE.Color(0x5d9440), sand = new THREE.Color(0xa89b68), dryE = new THREE.Color(0x8d8a52);
  const dirt = new THREE.Color(0x6b5238), stone = new THREE.Color(0x7d7a72), path = new THREE.Color(0x826646), mud = new THREE.Color(0x4a3b2a);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), h = pos.getY(i);
    const east = smooth(-8, 14, x);
    const patch = 0.5 + 0.5 * Math.sin(x * 0.21 + 1) * Math.cos(z * 0.17);
    c.copy(grassW).lerp(grassW2, patch * 0.7 + rand() * 0.2);
    c.lerp(east > 0.5 ? sand : dryE, east * (0.55 + patch * 0.3 + rand() * 0.12)); // dusty badlands
    c.lerp(dirt, smooth(-0.3, -1.3, h)); // the shore and the pond bed
    c.lerp(mud, smooth(-1.0, -1.8, h) * 0.8);
    c.lerp(stone, smooth(0.93, 0.8, norm.getY(i)) * 0.75); // steep ground is bare rock
    c.lerp(path, (1 - smooth(1.4, 3.2, pathDistance(x, z))) * 0.85); // dirt paths
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const terrain = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  terrain.receiveShadow = true;
  scene.add(terrain); // render only: gameplay rays use terrainRay (it is not in `blockers`)
  const terrainProxy = new THREE.Object3D();

  // ---------- structures ----------
  const addBox = (st: Structure) => {
    const x0 = st.x - st.w / 2, x1 = st.x + st.w / 2, z0 = st.z - st.d / 2, z1 = st.z + st.d / 2;
    const base = Math.min(heightAt(x0, z0), heightAt(x1, z0), heightAt(x0, z1), heightAt(x1, z1));
    const bottom = base - 0.5; // buried a little so it never floats
    const height = st.h + 0.5;
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(st.w, height, st.d),
      new THREE.MeshStandardMaterial({ color: st.color, roughness: 0.9 }),
    );
    m.position.set(st.x, bottom + height / 2, st.z);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    blockers.push(m);
    boxes.push(new THREE.Box3().setFromObject(m));
  };
  STRUCTURES.forEach(addBox);

  // ---------- ammo shop decorations (no collision) ----------
  const shopGround = heightAt(SHOP_ZONE.x, SHOP_ZONE.z);
  const kioskTop = heightAt(8, 54);
  // counter trim, shelves with stock, striped canopy, sign, crates and barrels: see shopProps.ts
  buildSupplyShopProps(scene, boxes, blockers, heightAt, makeSignBoard);
  const zone = new THREE.Mesh(
    new THREE.CylinderGeometry(SHOP_ZONE.radius, SHOP_ZONE.radius, 0.1, 40),
    new THREE.MeshBasicMaterial({ color: 0x44ff88, transparent: true, opacity: 0.3, depthWrite: false }),
  );
  zone.position.set(SHOP_ZONE.x, shopGround + 0.08, SHOP_ZONE.z);
  scene.add(zone);
  // outer walls
  const wallColor = 0x8d8577;
  const wall = (x: number, z: number, w: number, d: number) =>
    addBox({ x, z, w, h: 4, d, color: wallColor });
  wall(0, -half, half * 2, 1);
  // the south wall has a 10 m gap: the entrance gate to the airlock (see rooms.ts)
  wall(-(half + 6.6) / 2, half, half - 6.6, 1); // ends at x = -6.6, where the gate pillar starts
  wall((half + 6.6) / 2, half, half - 6.6, 1);
  wall(-half, 0, 1, half * 2);
  wall(half, 0, 1, half * 2);

  // ---------- scenery: rocks (east), trees (west), landmarks ----------
  const ctx: Ctx = { scene, boxes, blockers, heightAt, rand, half };
  const rocks = makeRocks(ctx);
  const clearOfStart = (x: number, z: number, m = 0) => Math.hypot(x - ENTRY.x, z - ENTRY.z) > 9 + m && !keepClear(x, z, 1 + m);

  // rock piles: big rocks in the middle, smaller towards the edge
  for (const [px, pz] of ROCK_PILES) {
    const n = 12 + Math.floor(rand() * 7);
    const R = 3.4;
    for (let i = 0; i < n; i++) {
      const ang = rand() * Math.PI * 2;
      const d = Math.pow(rand(), 0.8) * R;
      const t = 1 - d / R; // 1 at centre
      const r = 0.3 + t * (0.5 + rand() * 0.7) + rand() * 0.15;
      rocks.add(px + Math.cos(ang) * d, pz + Math.sin(ang) * d, r, t * 0.25);
    }
  }
  // boulder fields: clusters of big boulders you can hide behind
  for (const [bx, bz] of BOULDER_FIELDS) {
    const n = 8 + Math.floor(rand() * 6);
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * 8;
      const x = bx + Math.cos(a) * d, z = bz + Math.sin(a) * d;
      if (Math.abs(x) > half - 5 || Math.abs(z) > half - 5 || !clearOfStart(x, z)) continue;
      rocks.add(x, z, 1.1 + rand() * 1.4);
    }
  }
  // scattered loners: many in the badlands, a few in the forest
  let placed = 0;
  for (let tries = 0; placed < 170 && tries < 4000; tries++) {
    const x = (rand() * 2 - 1) * (half - 4);
    const z = (rand() * 2 - 1) * (half - 4);
    if (rand() > 0.2 + 0.8 * smooth(-4, 14, x)) continue;
    if (!clearOfStart(x, z)) continue;
    if (ROCK_PILES.some(([px, pz]) => Math.hypot(x - px, z - pz) < 4.5)) continue;
    const big = rand() < 0.15;
    rocks.add(x, z, big ? 0.9 + rand() * 0.6 : 0.2 + rand() * 0.55);
    placed++;
  }
  for (const a of ARCHES) buildArch(ctx, rocks, a.x, a.z, a.span, a.rot);
  for (const [sx, sz, sh] of SPIRES) buildSpire(ctx, rocks, sx, sz, sh);
  buildStoneCircle(ctx, rocks, STONE_CIRCLE.x, STONE_CIRCLE.z, STONE_CIRCLE.r, STONE_CIRCLE.n);

  buildForest(ctx);
  buildGroundCover(ctx);
  const updatePond = buildPond(ctx, rocks);
  const updateCamp = buildCamp(ctx, rocks);
  rocks.finish(); // every rock is placed now: build the instanced meshes
  const houseHandles: HouseHandle[] = HOUSES.map((h, i) => buildHouse(ctx, h, HOUSE_STYLES[i % HOUSE_STYLES.length]));
  buildBackdrop(scene, rand);
  const updateClouds = buildClouds(scene, rand);

  // ---------- walkable spots for bots (y follows the ground) ----------
  const isFree = (x: number, z: number) => {
    const gy = heightAt(x, z);
    if (gy < POND.level + 0.2) return false; // not in the pond
    if (houseHandles.some((h) => x > h.rect.x0 && x < h.rect.x1 && z > h.rect.z0 && z < h.rect.z1)) return false; // not in the houses
    return !boxes.some(
      (b) =>
        b.max.y > gy + 0.25 &&
        x > b.min.x - 1 && x < b.max.x + 1 && z > b.min.z - 1 && z < b.max.z + 1,
    );
  };
  const randomFreePoint = (avoid?: THREE.Vector3, minDist = 0) => {
    const lim = half - 5; // keep well away from the walls
    for (let i = 0; i < 200; i++) {
      const x = (Math.random() * 2 - 1) * lim;
      const z = (Math.random() * 2 - 1) * lim;
      if (avoid && Math.hypot(x - avoid.x, z - avoid.z) < minDist) continue;
      if (isFree(x, z)) return new THREE.Vector3(x, heightAt(x, z), z);
    }
    return new THREE.Vector3(0, heightAt(0, 0), 0);
  };
  /** A walkable spot in the band close to the outer walls (where criminals live). */
  const randomEdgePoint = (avoid?: THREE.Vector3, minDist = 0) => {
    for (let i = 0; i < 300; i++) {
      const along = (Math.random() * 2 - 1) * (half - 5);
      const depth = half - 5 - Math.random() * 9; // 5..14 m in from the wall
      const side = Math.floor(Math.random() * 4);
      const x = side === 0 ? along : side === 1 ? along : side === 2 ? depth : -depth;
      const z = side === 0 ? depth : side === 1 ? -depth : along;
      if (avoid && Math.hypot(x - avoid.x, z - avoid.z) < minDist) continue;
      if (isFree(x, z)) return new THREE.Vector3(x, heightAt(x, z), z);
    }
    return randomFreePoint(avoid, minDist);
  };
  const arenaEntry = new THREE.Vector3(PLAYER_START.x, heightAt(PLAYER_START.x, PLAYER_START.y), PLAYER_START.y);
  const spawnPoints = Array.from({ length: 24 }, () => randomFreePoint(arenaEntry, 20));

  const shop = { pos: new THREE.Vector3(SHOP_ZONE.x, shopGround, SHOP_ZONE.z), radius: SHOP_ZONE.radius };

  // ---------- safe room + airlock behind the south gate ----------
  const rooms = buildRooms(scene, boxes, blockers);
  const playerStart = rooms.hubSpawn.clone();

  // indoors the sun is switched off and the fog closes in, so the rooms are lit by their own lamps and candles
  const skyColor = new THREE.Color(0x9ec9e8);
  const indoorColor = new THREE.Color(0x0a0908);
  const fog = scene.fog as THREE.Fog;
  const setIndoor = (k: number) => {
    sun.intensity = 2.2 * (1 - k);
    hemi.intensity = 0.8 * (1 - k) + 0.28 * k;
    (scene.background as THREE.Color).copy(skyColor).lerp(indoorColor, k);
    fog.color.copy(skyColor).lerp(indoorColor, k);
    fog.near = 60 + (14 - 60) * k;
    fog.far = 190 + (70 - 190) * k;
  };

  const update = (dt: number, time: number, player: THREE.Vector3) => {
    for (const h of houseHandles) h.update(dt, player);
    updateCamp(time);
    updatePond(time);
    updateClouds(dt);
  };

  const boxGrid = new BoxGrid(boxes); // built last: every collision box exists now
  const setShadowQuality = (mapSize: number) => {
    sun.castShadow = mapSize > 0;
    if (mapSize > 0 && sun.shadow.mapSize.x !== mapSize) {
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
      sun.shadow.mapSize.set(mapSize, mapSize);
    }
  };

  return {
    boxes, blockers, spawnPoints, half, heightAt, randomFreePoint, randomEdgePoint, playerStart, arenaEntry, rooms, setIndoor, shop, update,
    terrainRay, terrainProxy, boxesNear: (x, z, r) => boxGrid.near(x, z, r), setShadowQuality,
  };
}
