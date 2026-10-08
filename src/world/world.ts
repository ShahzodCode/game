import * as THREE from 'three';
import { buildRooms, makeSignBoard, type Rooms } from './rooms';

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
const CRATE = 0x9b6b3a, PILLAR = 0x6f6f78, STEEL = 0x777f8c;
const STRUCTURES: Structure[] = [
  { x: -8, z: -6, w: 2, h: 1.2, d: 2, color: CRATE },
  { x: -5, z: -8, w: 1.5, h: 0.8, d: 1.5, color: CRATE },
  { x: 7, z: -10, w: 2.5, h: 1.5, d: 2.5, color: CRATE },
  { x: 10, z: 6, w: 2, h: 1, d: 2, color: CRATE },
  { x: -12, z: 8, w: 3, h: 1.5, d: 2, color: CRATE },
  { x: 0, z: 12, w: 1, h: 3, d: 1, color: PILLAR },
  { x: -18, z: -14, w: 1, h: 3, d: 1, color: PILLAR },
  { x: 16, z: -2, w: 1, h: 3, d: 1, color: PILLAR },
  // platform with steps
  { x: 20, z: 18, w: 8, h: 1.6, d: 6, color: STEEL },
  { x: 14.5, z: 18, w: 3, h: 0.55, d: 3, color: STEEL },
  { x: 16.5, z: 18, w: 2, h: 1.1, d: 3, color: STEEL },
  // long cover wall
  { x: -4, z: 3, w: 8, h: 1.4, d: 0.6, color: 0x8a5a5a },

  // ---- outer areas (the arena is 120 x 120) ----
  { x: -35, z: -30, w: 2.5, h: 1.5, d: 2.5, color: CRATE },
  { x: -38, z: -28, w: 1.5, h: 0.9, d: 1.5, color: CRATE },
  { x: 35, z: -35, w: 3, h: 1.5, d: 2, color: CRATE },
  { x: 40, z: 30, w: 2, h: 1.2, d: 2, color: CRATE },
  { x: -40, z: 25, w: 2.5, h: 1.3, d: 2.5, color: CRATE },
  { x: -30, z: 45, w: 2, h: 1, d: 2, color: CRATE },
  { x: 30, z: -8, w: 2, h: 1.2, d: 2, color: CRATE },
  { x: 48, z: -20, w: 2, h: 1, d: 2, color: CRATE },
  { x: -48, z: -5, w: 2.5, h: 1.5, d: 2.5, color: CRATE },
  { x: 22, z: 38, w: 2, h: 1, d: 2, color: CRATE },
  { x: -22, z: -40, w: 2, h: 1.2, d: 2, color: CRATE },
  { x: 8, z: -45, w: 3, h: 1.5, d: 2, color: CRATE },
  { x: -8, z: 35, w: 2, h: 1, d: 2, color: CRATE },
  { x: -30, z: -10, w: 1, h: 3, d: 1, color: PILLAR },
  { x: 32, z: 14, w: 1, h: 3, d: 1, color: PILLAR },
  { x: -36, z: 40, w: 1, h: 3, d: 1, color: PILLAR },
  { x: 44, z: -42, w: 1, h: 3, d: 1, color: PILLAR },
  { x: 0, z: -30, w: 1, h: 3, d: 1, color: PILLAR },
  { x: -45, z: -30, w: 1, h: 3, d: 1, color: PILLAR },
  // second platform with steps
  { x: -35, z: -48, w: 8, h: 1.6, d: 6, color: STEEL },
  { x: -29.5, z: -48, w: 3, h: 0.55, d: 3, color: STEEL },
  { x: -31.5, z: -48, w: 2, h: 1.1, d: 3, color: STEEL },
  // bunker walls
  { x: 45, z: 45, w: 12, h: 2.2, d: 0.8, color: 0x8d8577 },
  { x: 51, z: 40, w: 0.8, h: 2.2, d: 10, color: 0x8d8577 },
  // ammo shop kiosk (counter + back wall); the buy zone is in front of it, see SHOP_ZONE
  { x: 8, z: 54, w: 3, h: 1.1, d: 1, color: 0x3b6ea8 },
  { x: 8, z: 55.6, w: 3.4, h: 2.4, d: 0.3, color: 0x2f3b52 },
  // cover walls
  { x: 30, z: -22, w: 10, h: 1.4, d: 0.6, color: 0x8a5a5a },
  { x: -20, z: -30, w: 0.6, h: 1.4, d: 10, color: 0x8a5a5a },
];

// gentle hills (+) and pits (-): [x, z, sigma, amplitude]
const BUMPS: [number, number, number, number][] = [
  // hills
  [-20, 4, 6, 3.2],
  [14, -18, 7, 3.6],
  [-2, 20, 6.5, 2.4],
  [24, -6, 5, 2.2],
  [-42, -18, 8, 3.6],
  [40, -30, 9, 4.2],
  [38, 40, 8, 3.2],
  [-30, 40, 8, 3.0],
  [5, -48, 8, 3.0],
  [-5, -20, 6, 2.2],
  [48, 12, 7, 3.0],
  [-50, 2, 6, 2.5],
  // pits
  [2, -2, 3.2, -1.8],
  [-14, -18, 3.5, -2.0],
  [22, 6, 3, -1.6],
  [8, 18, 2.8, -1.4],
  [30, 22, 3.5, -1.8],
  [-40, 10, 3.2, -1.6],
  [20, -40, 3.5, -2.0],
  [46, -8, 3, -1.5],
  [-18, -48, 3.2, -1.7],
  [14, 36, 3, -1.5],
];

// rock piles: each forms a little rocky hill (terrain bump + clustered rocks)
const PILES: [number, number][] = [
  [-10, -14],
  [5, -24],
  [26, 2],
  [-22, 22],
  [6, 6],
  [-42, 40],
  [30, -50],
  [50, -24],
  [-48, -40],
  [12, -34],
  [-20, 48],
  [40, 12],
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
  const heightAt = (x: number, z: number) => {
    let h = 0;
    for (const [cx, cz, sg, a] of BUMPS) h += gauss(x, z, cx, cz, sg, a);
    for (const [cx, cz] of PILES) h += gauss(x, z, cx, cz, 2.6, 1.1);
    h += 0.12 * Math.sin(x * 0.7) * Math.cos(z * 0.55) + 0.08 * Math.sin(x * 1.9 + z * 1.3); // small bumps
    // keep ground flat under structures and near the outer walls
    let mask = smooth(1, 6, half - Math.max(Math.abs(x), Math.abs(z)));
    for (const st of STRUCTURES) {
      const dx = Math.max(Math.abs(x - st.x) - st.w / 2, 0);
      const dz = Math.max(Math.abs(z - st.z) - st.d / 2, 0);
      mask *= smooth(0, 3.5, Math.hypot(dx, dz));
    }
    return h * mask;
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
  const grass = new THREE.Color(0x5a8a3f), dry = new THREE.Color(0x8a8f4a);
  const dirt = new THREE.Color(0x6b5238), stone = new THREE.Color(0x7d7a72);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const h = pos.getY(i);
    c.copy(grass).lerp(dry, smooth(0.3, 2.5, h) * 0.6 + rand() * 0.18);
    c.lerp(dirt, smooth(-0.3, -1.4, h));
    c.lerp(stone, smooth(0.93, 0.8, norm.getY(i)) * 0.7);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const terrain = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  terrain.receiveShadow = true;
  scene.add(terrain);
  blockers.push(terrain);

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
  const awning = new THREE.Mesh(
    new THREE.BoxGeometry(4, 0.12, 2.6),
    new THREE.MeshStandardMaterial({ color: 0xd94a3a, roughness: 0.8 }),
  );
  awning.position.set(8, kioskTop + 2.6, 54.2);
  awning.rotation.x = -0.12;
  awning.castShadow = true;
  scene.add(awning);
  // fixed board facing the arena (-z); a sprite would swivel to follow the player
  const sign = makeSignBoard('SUPPLY SHOP', 3.2, 0.8);
  sign.position.set(8, kioskTop + 3.4, 54.4);
  sign.rotation.y = Math.PI;
  scene.add(sign);
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

  // ---------- rocks ----------
  const hash = (x: number, y: number, z: number) => {
    const v = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
    return v - Math.floor(v);
  };
  const rockGeos = [0, 1, 2, 3].map((k) => {
    const g = new THREE.IcosahedronGeometry(1, 1);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      // same input -> same offset, so shared vertices stay joined
      const f = 1 + (hash(x + k, y, z) - 0.5) * 0.5;
      p.setXYZ(i, x * f, y * f, z * f);
    }
    g.computeVertexNormals();
    return g;
  });
  const rockMats = [0x7a7770, 0x6b6963, 0x857f74, 0x5f5d59].map(
    (col) => new THREE.MeshStandardMaterial({ color: col, roughness: 1, flatShading: true }),
  );

  const nearStructure = (x: number, z: number, margin: number) =>
    STRUCTURES.some((st) => Math.abs(x - st.x) < st.w / 2 + margin && Math.abs(z - st.z) < st.d / 2 + margin);

  const addRock = (x: number, z: number, r: number, lift = 0) => {
    const sx = 0.8 + rand() * 0.5, sy = 0.55 + rand() * 0.4, sz = 0.8 + rand() * 0.5;
    const m = new THREE.Mesh(
      rockGeos[Math.floor(rand() * rockGeos.length)],
      rockMats[Math.floor(rand() * rockMats.length)],
    );
    m.scale.set(r * sx, r * sy, r * sz);
    const y = heightAt(x, z) + r * sy * 0.35 + lift; // partly sunk into the ground
    m.position.set(x, y, z);
    m.rotation.set((rand() - 0.5) * 0.4, rand() * Math.PI * 2, (rand() - 0.5) * 0.4);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    blockers.push(m);
    // only bigger rocks block the player; small ones are walked over
    if (r > 0.45) {
      const hw = 0.62 * r * ((sx + sz) / 2);
      boxes.push(
        new THREE.Box3(
          new THREE.Vector3(x - hw, y - r * sy, z - hw),
          new THREE.Vector3(x + hw, y + r * sy * 0.6, z + hw),
        ),
      );
    }
  };

  // rock piles: big rocks in the middle, smaller towards the edge
  for (const [px, pz] of PILES) {
    const n = 11 + Math.floor(rand() * 6);
    const R = 3.2;
    for (let i = 0; i < n; i++) {
      const ang = rand() * Math.PI * 2;
      const d = Math.pow(rand(), 0.8) * R;
      const t = 1 - d / R; // 1 at centre
      const r = 0.3 + t * (0.5 + rand() * 0.6) + rand() * 0.15;
      addRock(px + Math.cos(ang) * d, pz + Math.sin(ang) * d, r, t * 0.25);
    }
  }
  // scattered loners, mixed sizes
  let placed = 0;
  for (let tries = 0; placed < 140 && tries < 2000; tries++) {
    const x = (rand() * 2 - 1) * (half - 4);
    const z = (rand() * 2 - 1) * (half - 4);
    if (nearStructure(x, z, 1.5)) continue;
    if (Math.hypot(x - PLAYER_START.x, z - PLAYER_START.y) < 4) continue;
    if (PILES.some(([px, pz]) => Math.hypot(x - px, z - pz) < 4.5)) continue;
    const big = rand() < 0.15;
    addRock(x, z, big ? 0.9 + rand() * 0.6 : 0.2 + rand() * 0.55);
    placed++;
  }

  // ---------- walkable spots for bots (y follows the ground) ----------
  const isFree = (x: number, z: number) => {
    const gy = heightAt(x, z);
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

  return { boxes, blockers, spawnPoints, half, heightAt, randomFreePoint, randomEdgePoint, playerStart, arenaEntry, rooms, setIndoor, shop };
}
