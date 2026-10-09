import * as THREE from 'three';
import { ChunkedBuilder, MeshBuilder } from '../entities/meshBuilder';
import { CAMP, GIANT_OAK, HOUSES, POND, keepClear, pathDistance, type HouseSpec } from './layout';

// Scenery builders for the arena: forest, grass, rocks, houses, campfire, pond, mountains and clouds.
// Static detail is merged into a few vertex-coloured meshes (MeshBuilder), so hundreds of trees cost a handful of
// draw calls. Trunks and rocks are bullet blockers; leaves are not (you can shoot through foliage).

export interface Ctx {
  scene: THREE.Scene;
  boxes: THREE.Box3[];
  blockers: THREE.Object3D[];
  heightAt: (x: number, z: number) => number;
  rand: () => number;
  half: number;
}

const smooth = (a: number, b: number, x: number) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const vcolMat = (rough = 0.9, flat = false) => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: rough, flatShading: flat });
const pick = <T>(rand: () => number, a: T[]): T => a[Math.floor(rand() * a.length)];
const slopeAt = (ctx: Ctx, x: number, z: number) => {
  const e = 0.5;
  return Math.hypot(ctx.heightAt(x + e, z) - ctx.heightAt(x - e, z), ctx.heightAt(x, z + e) - ctx.heightAt(x, z - e)) / (2 * e);
};

/** Cheap value noise for clumping (trees, grass). */
function noise2(x: number, z: number) {
  return 0.5 + 0.25 * Math.sin(x * 0.13 + 1.3) * Math.cos(z * 0.11 - 0.7) + 0.15 * Math.sin(x * 0.31 + z * 0.27) + 0.1 * Math.sin(z * 0.53 - x * 0.19 + 2);
}

// =============================================================================================
// Rocks
// =============================================================================================
const hash = (x: number, y: number, z: number) => {
  const v = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return v - Math.floor(v);
};
export interface Rocks {
  /** A rock of radius r on the ground (partly sunk in). Bigger rocks block the player. */
  add: (x: number, z: number, r: number, lift?: number) => void;
  /** A rock with explicit size and height (arches, spires, standing stones). Optional collider. */
  place: (x: number, y: number, z: number, sx: number, sy: number, sz: number, rotY: number, tint?: number, collide?: boolean) => void;
  /** Build the instanced meshes (call once, after the last rock was placed). */
  finish: () => void;
}
/**
 * All rocks share 4 shapes x 6 colours, so they are drawn as instanced meshes (one draw call per shape/colour
 * instead of one per rock: ~500 rocks became ~24 draw calls, in the main pass and in the shadow pass).
 */
export function makeRocks(ctx: Ctx): Rocks {
  const { scene, boxes, blockers, heightAt, rand } = ctx;
  const geos = [0, 1, 2, 3].map((k) => {
    const g = new THREE.IcosahedronGeometry(1, 1);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const f = 1 + (hash(x + k, y, z) - 0.5) * 0.5; // same input -> same offset, so shared vertices stay joined
      p.setXYZ(i, x * f, y * f, z * f);
    }
    g.computeVertexNormals();
    return g;
  });
  const mats = [0x7a7770, 0x6b6963, 0x857f74, 0x5f5d59, 0x8a7f6a, 0x9a8f78].map(
    (col) => new THREE.MeshStandardMaterial({ color: col, roughness: 1, flatShading: true }),
  );
  const buckets = new Map<number, THREE.Matrix4[]>();
  const _e = new THREE.Euler();
  const _q = new THREE.Quaternion();
  const place: Rocks['place'] = (x, y, z, sx, sy, sz, rotY, tint, collide = false) => {
    const gi = Math.floor(rand() * geos.length);
    const mi = tint === undefined ? Math.floor(rand() * mats.length) : tint % mats.length;
    _e.set((rand() - 0.5) * 0.25, rotY, (rand() - 0.5) * 0.25);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), _q.setFromEuler(_e), new THREE.Vector3(sx, sy, sz));
    const key = gi * 16 + mi;
    let list = buckets.get(key);
    if (!list) buckets.set(key, (list = []));
    list.push(m);
    if (collide) {
      const hw = 0.62 * Math.max(sx, sz);
      boxes.push(new THREE.Box3(new THREE.Vector3(x - hw, y - sy, z - hw), new THREE.Vector3(x + hw, y + sy * 0.6, z + hw)));
    }
  };
  const add: Rocks['add'] = (x, z, r, lift = 0) => {
    const sx = 0.8 + rand() * 0.5, sy = 0.55 + rand() * 0.4, sz = 0.8 + rand() * 0.5;
    const y = heightAt(x, z) + r * sy * 0.35 + lift; // partly sunk into the ground
    place(x, y, z, r * sx, r * sy, r * sz, rand() * Math.PI * 2, undefined, false);
    // only bigger rocks block the player; small ones are walked over
    if (r > 0.45) {
      const hw = 0.62 * r * ((sx + sz) / 2);
      boxes.push(new THREE.Box3(new THREE.Vector3(x - hw, y - r * sy, z - hw), new THREE.Vector3(x + hw, y + r * sy * 0.6, z + hw)));
    }
  };
  const finish = () => {
    for (const [key, list] of buckets) {
      const mesh = new THREE.InstancedMesh(geos[Math.floor(key / 16)], mats[key % 16], list.length);
      list.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.instanceMatrix.needsUpdate = true;
      scene.add(mesh);
      blockers.push(mesh); // instanced meshes are ray-tested per instance
    }
    buckets.clear();
  };
  return { add, place, finish };
}

/** A rock arch: two stacked-rock pillars and a heavy lintel you can walk under. */
export function buildArch(ctx: Ctx, rocks: Rocks, x: number, z: number, span: number, rot: number) {
  const { boxes, heightAt } = ctx;
  const dx = Math.cos(rot), dz = -Math.sin(rot); // direction between the pillars
  const g = heightAt(x, z);
  for (const s of [-1, 1]) {
    const px = x + dx * (span / 2) * s, pz = z + dz * (span / 2) * s;
    rocks.place(px, g + 0.9, pz, 1.9, 1.3, 1.7, ctx.rand() * 6, 0);
    rocks.place(px + 0.1, g + 2.5, pz - 0.1, 1.6, 1.4, 1.5, ctx.rand() * 6, 1);
    rocks.place(px - 0.1, g + 3.9, pz + 0.1, 1.35, 1.0, 1.3, ctx.rand() * 6, 2);
    boxes.push(new THREE.Box3(new THREE.Vector3(px - 1.15, g - 0.5, pz - 1.15), new THREE.Vector3(px + 1.15, g + 4.6, pz + 1.15)));
  }
  rocks.place(x, g + 5.0, z, span / 2 + 1.3, 0.95, 1.25, rot, 3);
  boxes.push(new THREE.Box3(new THREE.Vector3(x - span / 2 - 0.6, g + 4.2, z - 1.0), new THREE.Vector3(x + span / 2 + 0.6, g + 6.1, z + 1.0)).expandByScalar(0.05));
}

/** A tall spire of stacked, shrinking rocks. */
export function buildSpire(ctx: Ctx, rocks: Rocks, x: number, z: number, height: number) {
  const g = ctx.heightAt(x, z);
  const n = 4;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const r = 1.9 - t * 1.15;
    rocks.place(x + (ctx.rand() - 0.5) * 0.5, g + (i + 0.5) * (height / n) * 0.9, z + (ctx.rand() - 0.5) * 0.5, r, (height / n) * 0.62, r * 0.9, ctx.rand() * 6, i % 3);
  }
  ctx.boxes.push(new THREE.Box3(new THREE.Vector3(x - 1.4, g - 0.5, z - 1.3), new THREE.Vector3(x + 1.4, g + height * 0.85, z + 1.3)));
}

/** A ring of standing stones. */
export function buildStoneCircle(ctx: Ctx, rocks: Rocks, cx: number, cz: number, r: number, n: number) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    const h = 1.5 + ctx.rand() * 1.2;
    rocks.place(x, ctx.heightAt(x, z) + h * 0.8, z, 0.75, h, 0.5, -a + (ctx.rand() - 0.5) * 0.3, i % 4, true);
  }
  // a flat altar stone in the middle
  rocks.place(cx, ctx.heightAt(cx, cz) + 0.35, cz, 1.6, 0.45, 1.2, 0.4, 2, true);
}

// =============================================================================================
// Trees, bushes, grass
// =============================================================================================
const TRUNK = [0x5b4128, 0x6a4a2d, 0x4e3922, 0x62472b];
const PINE = [0x2f5d34, 0x2a5230, 0x356b3a, 0x244a2b];
const OAK = [0x4a7d33, 0x5b8f3a, 0x3f6e2c, 0x6a9a3a];
const BIRCH_LEAF = [0x8bb04a, 0x9bbf55, 0x7da340];

export function buildForest(ctx: Ctx) {
  const { scene, boxes, blockers, heightAt, rand } = ctx;
  const trunks = new ChunkedBuilder();
  const leaves = new ChunkedBuilder();
  const placed: [number, number][] = [];

  const treeAt = (x: number, z: number, kind: 'pine' | 'oak' | 'birch' | 'dead', s: number) => {
    const y = heightAt(x, z);
    const T = trunks.at(x, z), Lf = leaves.at(x, z);
    const tc = pick(rand, TRUNK);
    let trunkR = 0.25 * s;
    if (kind === 'pine') {
      const h = (6 + rand() * 3.5) * s;
      T.cyl(tc, 0.12 * s, 0.3 * s, h * 0.55, { p: [x, y + h * 0.27, z] }, 7);
      const pc = pick(rand, PINE);
      const col = new THREE.Color(pc);
      for (let i = 0; i < 4; i++) {
        const k = 1 - i * 0.2;
        const c = col.clone().offsetHSL(0, 0, (rand() - 0.5) * 0.04 + i * 0.012);
        Lf.cone(c, (1.9 * k + 0.2) * s, h * 0.34, { p: [x, y + h * 0.3 + i * h * 0.17 + h * 0.15, z], r: [0, rand() * 6, 0] }, 8);
      }
    } else if (kind === 'oak') {
      const th = (2.6 + rand() * 0.8) * s;
      trunkR = 0.3 * s;
      T.cyl(tc, 0.2 * s, 0.34 * s, th, { p: [x, y + th / 2, z] }, 8);
      T.cyl(tc, 0.08 * s, 0.14 * s, 1.1 * s, { p: [x + 0.4 * s, y + th * 0.85, z], r: [0, 0, -0.7] }, 6);
      const oc = pick(rand, OAK);
      Lf.ball(oc, 2.2 * s, { p: [x, y + th + 1.4 * s, z], s: [1, 0.8, 1] }, 'mid');
      for (let i = 0; i < 3; i++) {
        const a = rand() * 6.28;
        Lf.ball(new THREE.Color(oc).offsetHSL(0, 0, (rand() - 0.5) * 0.06), 1.5 * s, { p: [x + Math.cos(a) * 1.5 * s, y + th + (0.6 + rand() * 1.0) * s, z + Math.sin(a) * 1.5 * s], s: [1, 0.85, 1] }, 'mid');
      }
    } else if (kind === 'birch') {
      const h = (4.2 + rand() * 1.4) * s;
      trunkR = 0.18 * s;
      T.cyl(0xe6e2d4, 0.1 * s, 0.17 * s, h, { p: [x, y + h / 2, z] }, 7);
      for (let i = 0; i < 4; i++) T.box(0x2a2a28, 0.2 * s, 0.07 * s, 0.2 * s, { p: [x, y + h * (0.25 + i * 0.18), z], r: [0, rand() * 6, 0] });
      const bc = pick(rand, BIRCH_LEAF);
      Lf.ball(bc, 1.4 * s, { p: [x, y + h + 0.6 * s, z], s: [1, 1.2, 1] }, 'mid');
      Lf.ball(new THREE.Color(bc).offsetHSL(0, 0, 0.04), 1.0 * s, { p: [x + 0.7 * s, y + h - 0.4 * s, z + 0.3 * s] }, 'mid');
    } else {
      const h = (4 + rand() * 2.2) * s;
      trunkR = 0.24 * s;
      T.cyl(0x5a4a3c, 0.1 * s, 0.28 * s, h, { p: [x, y + h / 2, z] }, 7);
      for (let i = 0; i < 3; i++) {
        const a = rand() * 6.28;
        T.cyl(0x5a4a3c, 0.03 * s, 0.09 * s, 1.6 * s, { p: [x + Math.cos(a) * 0.5 * s, y + h * (0.6 + i * 0.12), z + Math.sin(a) * 0.5 * s], r: [Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9] }, 5);
      }
    }
    const hw = Math.max(0.3, trunkR * 1.05);
    boxes.push(new THREE.Box3(new THREE.Vector3(x - hw, y - 0.3, z - hw), new THREE.Vector3(x + hw, y + 3.2, z + hw)));
    placed.push([x, z]);
  };

  // the giant oak: a landmark in the forest
  treeAt(GIANT_OAK.x, GIANT_OAK.z, 'oak', 2.5);

  let count = 0;
  for (let tries = 0; count < 200 && tries < 5000; tries++) {
    const x = -57 + rand() * 72;
    const z = (rand() * 2 - 1) * (ctx.half - 3);
    const density = smooth(16, -16, x) * (0.25 + 0.75 * noise2(x, z));
    if (rand() > density) continue;
    if (keepClear(x, z, 3) || Math.hypot(x - GIANT_OAK.x, z - GIANT_OAK.z) < 5) continue;
    if (heightAt(x, z) < -0.25 || slopeAt(ctx, x, z) > 0.6) continue;
    if (placed.some(([px, pz]) => Math.hypot(px - x, pz - z) < 3.1)) continue;
    const r = rand();
    const kind = r < 0.45 ? 'pine' : r < 0.75 ? 'oak' : r < 0.9 ? 'birch' : 'dead';
    treeAt(x, z, kind, 0.85 + rand() * 0.55);
    count++;
  }
  // a few lone trees in the badlands
  for (let tries = 0, n = 0; n < 7 && tries < 400; tries++) {
    const x = 20 + rand() * 36, z = (rand() * 2 - 1) * 54;
    if (keepClear(x, z, 4) || heightAt(x, z) < 0 || slopeAt(ctx, x, z) > 0.5) continue;
    if (placed.some(([px, pz]) => Math.hypot(px - x, pz - z) < 7)) continue;
    treeAt(x, z, 'dead', 0.9 + rand() * 0.4);
    n++;
  }

  for (const m of trunks.build((g) => new THREE.Mesh(g, vcolMat(0.95)))) {
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    blockers.push(m);
  }
  for (const m of leaves.build((g) => new THREE.Mesh(g, vcolMat(0.9, true)))) {
    m.castShadow = true;
    scene.add(m);
  }
  return { count: placed.length };
}

/** Bushes, grass tufts, flowers, stumps, fallen logs: no collision, just life. */
export function buildGroundCover(ctx: Ctx) {
  const { scene, heightAt, rand } = ctx;
  const B = new ChunkedBuilder(30);
  let b = B.at(0, 0);
  const free = (x: number, z: number, margin: number) => !keepClear(x, z, margin) && heightAt(x, z) > -0.3;

  // bushes in the forest
  for (let i = 0, n = 0; n < 70 && i < 800; i++) {
    const x = -57 + rand() * 60, z = (rand() * 2 - 1) * 56;
    if (rand() > smooth(10, -14, x) || !free(x, z, 1.5)) continue;
    const y = heightAt(x, z);
    b = B.at(x, z);
    const col = pick(rand, [0x3f6b2c, 0x4e7d34, 0x35602a]);
    for (let k = 0; k < 3; k++) b.ball(new THREE.Color(col).offsetHSL(0, 0, (rand() - 0.5) * 0.05), 0.5 + rand() * 0.35, { p: [x + (rand() - 0.5) * 0.9, y + 0.35, z + (rand() - 0.5) * 0.9], s: [1, 0.75, 1] }, 'mid');
    n++;
  }
  // grass tufts: lush in the west, dry in the east
  for (let i = 0, n = 0; n < 2600 && i < 9000; i++) {
    const x = (rand() * 2 - 1) * (ctx.half - 2), z = (rand() * 2 - 1) * (ctx.half - 2);
    const west = smooth(8, -10, x);
    if (rand() > 0.12 + 0.88 * west * (0.4 + 0.6 * noise2(x * 1.7, z * 1.7))) continue;
    if (!free(x, z, 0.3) || pathDistance(x, z) < 1.6 || slopeAt(ctx, x, z) > 0.7) continue;
    const y = heightAt(x, z);
    b = B.at(x, z);
    const col = new THREE.Color(west > 0.5 ? 0x4c8a35 : 0x9a9a52).offsetHSL((rand() - 0.5) * 0.04, 0, (rand() - 0.5) * 0.12);
    const hgt = 0.28 + rand() * 0.3;
    for (let k = 0; k < 3; k++) {
      const a = rand() * 6.28;
      b.cone(col, 0.05, hgt, { p: [x + Math.cos(a) * 0.07, y + hgt / 2 - 0.02, z + Math.sin(a) * 0.07], r: [Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35] }, 3, true);
    }
    n++;
  }
  // flowers
  for (let i = 0, n = 0; n < 260 && i < 2500; i++) {
    const x = -56 + rand() * 62, z = (rand() * 2 - 1) * 56;
    if (rand() > smooth(6, -12, x) || !free(x, z, 0.5) || pathDistance(x, z) < 2) continue;
    const y = heightAt(x, z);
    b = B.at(x, z);
    const col = pick(rand, [0xf4f4f0, 0xffd84a, 0xc779e8, 0xff7a8a, 0x7aa8ff]);
    b.cyl(0x3f7a2c, 0.01, 0.012, 0.3, { p: [x, y + 0.15, z] }, 4);
    b.ball(col, 0.05, { p: [x, y + 0.31, z] }, 'low');
    n++;
  }
  // stumps and fallen logs in the forest
  for (let i = 0, n = 0; n < 12 && i < 300; i++) {
    const x = -56 + rand() * 54, z = (rand() * 2 - 1) * 55;
    if (!free(x, z, 2)) continue;
    const y = heightAt(x, z);
    b = B.at(x, z);
    b.cyl(0x6a4a2d, 0.3, 0.36, 0.5, { p: [x, y + 0.2, z] }, 9);
    b.cyl(0xc9a36a, 0.28, 0.28, 0.02, { p: [x, y + 0.46, z] }, 9);
    n++;
  }
  for (let i = 0, n = 0; n < 9 && i < 300; i++) {
    const x = -55 + rand() * 52, z = (rand() * 2 - 1) * 54;
    if (!free(x, z, 3)) continue;
    const y = heightAt(x, z);
    b = B.at(x, z);
    const len = 2.5 + rand() * 2;
    const a = rand() * Math.PI;
    b.cyl(0x5b4128, 0.28, 0.3, len, { p: [x, y + 0.26, z], r: [Math.PI / 2, 0, a] }, 8);
    b.cyl(0xc9a36a, 0.27, 0.27, 0.02, { p: [x + Math.sin(a) * len / 2, y + 0.26, z + Math.cos(a) * len / 2], r: [Math.PI / 2, 0, a] }, 8);
    n++;
  }
  const meshes = B.build((geo) => new THREE.Mesh(geo, vcolMat(1)));
  for (const mesh of meshes) {
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
  return meshes;
}

// =============================================================================================
// Pond
// =============================================================================================
export function buildPond(ctx: Ctx, rocks: Rocks) {
  const water = new THREE.Mesh(
    new THREE.CircleGeometry(POND.r + 2.2, 40),
    new THREE.MeshPhongMaterial({ color: 0x3a8cc0, specular: 0xffffff, shininess: 90, transparent: true, opacity: 0.86, emissive: 0x0b2a40 }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(POND.x, POND.level, POND.z);
  ctx.scene.add(water);
  // rocks and reeds around the shore
  const reeds = new MeshBuilder();
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + ctx.rand() * 0.2;
    const r = POND.r + 0.3 + ctx.rand() * 1.2;
    const x = POND.x + Math.cos(a) * r, z = POND.z + Math.sin(a) * r;
    if (i % 3 === 0) rocks.add(x, z, 0.4 + ctx.rand() * 0.5);
    else {
      const y = ctx.heightAt(x, z);
      for (let k = 0; k < 3; k++) reeds.cyl(0x6f8f3a, 0.012, 0.02, 1.0 + ctx.rand() * 0.7, { p: [x + (ctx.rand() - 0.5) * 0.3, y + 0.55, z + (ctx.rand() - 0.5) * 0.3], r: [(ctx.rand() - 0.5) * 0.2, 0, (ctx.rand() - 0.5) * 0.2] }, 4);
      reeds.cyl(0x6a4a2d, 0.035, 0.035, 0.4, { p: [x, y + 1.15, z] }, 5);
    }
  }
  // lily pads
  for (let i = 0; i < 14; i++) {
    const a = ctx.rand() * Math.PI * 2, r = Math.sqrt(ctx.rand()) * (POND.r - 1.2);
    reeds.cyl(0x4f8a3a, 0.22, 0.22, 0.02, { p: [POND.x + Math.cos(a) * r, POND.level + 0.03, POND.z + Math.sin(a) * r] }, 8);
  }
  const m = new THREE.Mesh(reeds.build(), vcolMat(0.9));
  ctx.scene.add(m);
  return (t: number) => {
    const mat = water.material as THREE.MeshPhongMaterial;
    mat.color.setHSL(0.56, 0.6, 0.5 + Math.sin(t * 0.8) * 0.02);
    water.position.y = POND.level + Math.sin(t * 1.1) * 0.012;
  };
}

// =============================================================================================
// Campfire
// =============================================================================================
export function buildCamp(ctx: Ctx, rocks: Rocks) {
  const { scene, boxes, heightAt, rand } = ctx;
  const y = heightAt(CAMP.x, CAMP.z);
  const b = new MeshBuilder();
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    b.ball(0x6d6a64, 0.2, { p: [CAMP.x + Math.cos(a) * 0.85, y + 0.1, CAMP.z + Math.sin(a) * 0.85], s: [1, 0.7, 1] });
  }
  b.cyl(0x2a2622, 0.8, 0.9, 0.06, { p: [CAMP.x, y + 0.03, CAMP.z] }, 14); // ash
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3;
    b.cyl(0x4a3524, 0.08, 0.09, 1.2, { p: [CAMP.x + Math.cos(a) * 0.25, y + 0.28, CAMP.z + Math.sin(a) * 0.25], r: [Math.sin(a) * 1.0, 0, -Math.cos(a) * 1.0] }, 6);
  }
  // seats: logs around the fire, and a tent-like stack of firewood
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.6;
    const x = CAMP.x + Math.cos(a) * 2.7, z = CAMP.z + Math.sin(a) * 2.7;
    b.cyl(0x6a4a2d, 0.28, 0.28, 1.5, { p: [x, y + 0.28, z], r: [Math.PI / 2, 0, -a + Math.PI / 2] }, 8);
    boxes.push(new THREE.Box3(new THREE.Vector3(x - 0.6, y - 0.1, z - 0.6), new THREE.Vector3(x + 0.6, y + 0.55, z + 0.6)));
  }
  for (let i = 0; i < 6; i++) b.cyl(0x7a5535, 0.1, 0.1, 1.1, { p: [CAMP.x + 4.3, y + 0.12 + (i > 2 ? 0.2 : 0), CAMP.z - 1.4 + (i % 3) * 0.22], r: [0, 0, Math.PI / 2] }, 6);
  scene.add(new THREE.Mesh(b.build(), vcolMat(0.95)));
  rocks.add(CAMP.x - 5, CAMP.z + 3, 0.9);

  const flameMat = [0xff7a1a, 0xffb02a, 0xffe27a].map((c) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.92 }));
  const flames = [0, 1, 2].map((i) => {
    const m = new THREE.Mesh(new THREE.ConeGeometry(0.42 - i * 0.1, 1.0 - i * 0.2, 7), flameMat[i]);
    m.position.set(CAMP.x, y + 0.55 + (1 - i * 0.2) * 0.3, CAMP.z);
    scene.add(m);
    return m;
  });
  const light = new THREE.PointLight(0xff9a45, 30, 18, 2);
  light.position.set(CAMP.x, y + 1.2, CAMP.z);
  scene.add(light);
  void rand;
  return (t: number) => {
    flames.forEach((f, i) => {
      const k = 1 + Math.sin(t * (9 + i * 3) + i) * 0.16 + Math.sin(t * 23 + i * 2) * 0.08;
      f.scale.set(1 / Math.sqrt(k), k, 1 / Math.sqrt(k));
      f.rotation.y = t * (1 + i);
    });
    light.intensity = 26 + Math.sin(t * 11) * 4 + Math.sin(t * 27) * 3;
  };
}

// =============================================================================================
// Houses
// =============================================================================================
/** A triangular prism (gable end): base width `w` along z, height `h` along y, thickness `t` along x, centred on x = 0. */
function prismGeo(w: number, h: number, t: number) {
  const g = new THREE.BufferGeometry();
  const pts: number[] = [];
  const nrm: number[] = [];
  const idx: number[] = [];
  const face = (verts: number[][], n: number[]) => {
    const o = pts.length / 3;
    for (const v of verts) {
      pts.push(...v);
      nrm.push(...n);
    }
    for (let i = 1; i < verts.length - 1; i++) idx.push(o, o + i, o + i + 1);
  };
  const x0 = -t / 2, x1 = t / 2;
  face([[x1, 0, -w / 2], [x1, 0, w / 2], [x1, h, 0]], [1, 0, 0]);
  face([[x0, 0, w / 2], [x0, 0, -w / 2], [x0, h, 0]], [-1, 0, 0]);
  const sl = Math.hypot(h, w / 2);
  face([[x0, 0, w / 2], [x0, h, 0], [x1, h, 0], [x1, 0, w / 2]], [0, (w / 2) / sl, h / sl]);
  face([[x1, 0, -w / 2], [x1, h, 0], [x0, h, 0], [x0, 0, -w / 2]], [0, (w / 2) / sl, -h / sl]);
  face([[x0, 0, -w / 2], [x0, 0, w / 2], [x1, 0, w / 2], [x1, 0, -w / 2]], [0, -1, 0]);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array((pts.length / 3) * 2).fill(0), 2));
  g.setIndex(idx);
  return g;
}

export interface HouseHandle {
  update: (dt: number, player: THREE.Vector3) => void;
  /** Footprint (with walls) so nothing spawns inside. */
  rect: { x0: number; x1: number; z0: number; z1: number };
}

export function buildHouse(ctx: Ctx, spec: HouseSpec, style: { wall: number; trim: number; roof: number; floorA: number; floorB: number }): HouseHandle {
  const { scene, boxes, blockers, heightAt } = ctx;
  const { x: cx, z: cz, w, d } = spec;
  const y0 = heightAt(cx, cz);
  const T = 0.3, H = 3.6, RISE = 2.2, FLOOR = 0.08;
  const b = new MeshBuilder();
  const solid = (x0: number, x1: number, ya: number, yb: number, z0: number, z1: number, col: number) => {
    b.box(col, x1 - x0, yb - ya, z1 - z0, { p: [(x0 + x1) / 2, y0 + (ya + yb) / 2, (z0 + z1) / 2] });
    boxes.push(new THREE.Box3(new THREE.Vector3(x0, y0 + ya, z0), new THREE.Vector3(x1, y0 + yb, z1)));
  };
  interface Opening { c: number; w: number; y0: number; y1: number }
  /** One wall (along `axis` at the fixed coordinate `fixed`) with door / window openings cut out of it. */
  const wall = (axis: 'x' | 'z', fixed: number, from: number, to: number, openings: Opening[]) => {
    const piece = (a: number, bb: number, ya: number, yb: number) => {
      if (bb - a < 0.01 || yb - ya < 0.01) return;
      if (axis === 'x') solid(a, bb, ya, yb, fixed - T / 2, fixed + T / 2, style.wall);
      else solid(fixed - T / 2, fixed + T / 2, ya, yb, a, bb, style.wall);
    };
    let cursor = from;
    for (const o of [...openings].sort((p, q) => p.c - q.c)) {
      const a = o.c - o.w / 2, bb = o.c + o.w / 2;
      piece(cursor, a, -0.05, H);
      if (o.y0 > 0) piece(a, bb, -0.05, o.y0); // sill
      piece(a, bb, o.y1, H); // lintel
      cursor = bb;
    }
    piece(cursor, to, -0.05, H);
  };
  const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
  const DOOR_W = 2.4, DOOR_H = 2.7;
  const door = (side: string, len: number, c: number): Opening[] => [{ c, w: DOOR_W, y0: 0, y1: DOOR_H }, ...[-1, 1].map((s) => ({ c: c + s * len * 0.3, w: 1.3, y0: 1.0, y1: 2.15 }))];
  const windows = (len: number, c: number): Opening[] => [-1, 1].map((s) => ({ c: c + s * len * 0.26, w: 1.3, y0: 1.0, y1: 2.15 }));
  wall('x', z0, x0 - T / 2, x1 + T / 2, spec.door === 'N' ? door('N', w, cx) : windows(w, cx));
  wall('x', z1, x0 - T / 2, x1 + T / 2, spec.door === 'S' ? door('S', w, cx) : windows(w, cx));
  wall('z', x0, z0 + T / 2, z1 - T / 2, spec.door === 'W' ? door('W', d, cz) : [{ c: cz, w: 1.3, y0: 1.0, y1: 2.15 }]);
  wall('z', x1, z0 + T / 2, z1 - T / 2, spec.door === 'E' ? door('E', d, cz) : [{ c: cz, w: 1.3, y0: 1.0, y1: 2.15 }]);
  // corner posts (a little taller than the walls, so no flat faces coincide)
  for (const px of [x0, x1]) for (const pz of [z0, z1]) b.box(style.trim, 0.46, H + 0.12, 0.46, { p: [px, y0 + (H + 0.12) / 2 - 0.05, pz] });
  // base trim and window sills (outside)
  b.box(style.trim, w + 0.7, 0.28, 0.1, { p: [cx, y0 + 0.09, z0 - T / 2 - 0.03] });
  b.box(style.trim, w + 0.7, 0.28, 0.1, { p: [cx, y0 + 0.09, z1 + T / 2 + 0.03] });
  // wooden floor of alternating planks (one collider for all of it)
  const inner0x = x0 + T / 2, inner1x = x1 - T / 2, inner0z = z0 + T / 2, inner1z = z1 - T / 2;
  const planks = Math.round((inner1x - inner0x) / 0.5);
  const pw = (inner1x - inner0x) / planks;
  for (let i = 0; i < planks; i++) b.box(i % 2 ? style.floorA : style.floorB, pw, FLOOR, inner1z - inner0z, { p: [inner0x + pw * (i + 0.5), y0 + FLOOR / 2, cz] });
  boxes.push(new THREE.Box3(new THREE.Vector3(inner0x, y0, inner0z), new THREE.Vector3(inner1x, y0 + FLOOR, inner1z)));
  // porch slab in front of the door
  const out = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] }[spec.door];
  const doorX = spec.door === 'E' ? x1 : spec.door === 'W' ? x0 : cx;
  const doorZ = spec.door === 'N' ? z0 : spec.door === 'S' ? z1 : cz;
  const porchX = doorX + out[0] * 1.0, porchZ = doorZ + out[1] * 1.0;
  b.box(0x8a8478, out[0] ? 1.6 : 2.6, 0.12, out[0] ? 2.6 : 1.6, { p: [porchX, y0 + 0.06, porchZ] });
  // roof: ridge along the long side, slabs with an overhang, ridge cap, gable ends, chimney
  const alongX = w >= d;
  const L = alongX ? w : d; // ridge length
  const B = alongX ? d : w; // span the roof covers
  const half = B / 2 + 0.6;
  const theta = Math.atan2(RISE, half);
  const slab = Math.hypot(half, RISE) + 0.05;
  const roofY = y0 + H + RISE / 2 + 0.02;
  for (const s of [-1, 1]) {
    if (alongX) b.box(style.roof, L + 1.0, 0.18, slab, { p: [cx, roofY, cz + (s * half) / 2], r: [s * theta, 0, 0] });
    else b.box(style.roof, slab, 0.18, L + 1.0, { p: [cx + (s * half) / 2, roofY, cz], r: [0, 0, -s * theta] });
  }
  if (alongX) b.box(style.trim, L + 1.1, 0.16, 0.34, { p: [cx, y0 + H + RISE + 0.1, cz] });
  else b.box(style.trim, 0.34, 0.16, L + 1.1, { p: [cx, y0 + H + RISE + 0.1, cz] });
  for (const s of [-1, 1]) {
    const gx = alongX ? cx + s * (w / 2) : cx;
    const gz = alongX ? cz : cz + s * (d / 2);
    b.geo(prismGeo(B + 0.1, RISE, T), style.wall, { p: [gx, y0 + H - 0.01, gz], r: [0, alongX ? 0 : Math.PI / 2, 0] }, true);
  }
  // chimney
  const chx = alongX ? cx - L * 0.3 : cx + 0.5, chz = alongX ? cz - 0.9 : cz - L * 0.3;
  b.box(0x7d7468, 0.8, 2.6, 0.8, { p: [chx, y0 + H + 1.1, chz] });
  b.box(0x4a443c, 0.95, 0.14, 0.95, { p: [chx, y0 + H + 2.45, chz] });
  const mesh = new THREE.Mesh(b.build(), vcolMat(0.9));
  mesh.castShadow = mesh.receiveShadow = true;
  scene.add(mesh);
  blockers.push(mesh);

  // a warm lamp inside, so the house is not a dark box
  const lamp = new THREE.PointLight(0xffe2b0, 80, 18, 2);
  lamp.position.set(cx, y0 + H - 0.4, cz);
  scene.add(lamp);

  // couch against the wall opposite the door, facing the door
  const cb = new MeshBuilder();
  const SEAT = 0x35627a, CUSH = 0x4a7f99, LEG = 0x2a2420;
  cb.box(SEAT, 2.4, 0.38, 0.95, { p: [0, 0.34, 0] });
  cb.box(SEAT, 2.4, 0.62, 0.24, { p: [0, 0.75, -0.36] });
  for (const sx of [-1, 1]) cb.box(SEAT, 0.24, 0.62, 0.95, { p: [sx * 1.08, 0.5, 0] });
  for (let i = -1; i <= 1; i++) {
    cb.box(CUSH, 0.62, 0.15, 0.66, { p: [i * 0.66, 0.6, 0.1] });
    cb.box(CUSH, 0.6, 0.38, 0.12, { p: [i * 0.66, 0.84, -0.18], r: [-0.18, 0, 0] });
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) cb.box(LEG, 0.08, 0.14, 0.08, { p: [sx * 1.08, 0.07, sz * 0.38] });
  const couch = new THREE.Mesh(cb.build(), vcolMat(0.95));
  const yaw = { E: Math.PI / 2, W: -Math.PI / 2, N: Math.PI, S: 0 }[spec.door];
  const bx = cx - out[0] * (w / 2 - T / 2 - 0.65), bz = cz - out[1] * (d / 2 - T / 2 - 0.65);
  couch.position.set(bx, y0 + FLOOR, bz);
  couch.rotation.y = yaw;
  couch.castShadow = couch.receiveShadow = true;
  scene.add(couch);
  couch.updateMatrixWorld(true);
  const couchBox = new THREE.Box3().setFromObject(couch);
  couchBox.max.y = y0 + FLOOR + 1.0; // taller than a step: the couch is an obstacle
  boxes.push(couchBox);
  blockers.push(couch);

  // no door any more: the doorway stays open so people and bots can walk in and out
  const update: HouseHandle['update'] = () => {};
  return { update, rect: { x0: x0 - 1.5, x1: x1 + 1.5, z0: z0 - 1.5, z1: z1 + 1.5 } };
}

export const HOUSE_STYLES = [
  { wall: 0x9a7650, trim: 0x4e3622, roof: 0x4a505c, floorA: 0x9c7a52, floorB: 0x8e6e48 }, // wooden cabin in the forest
  { wall: 0xd2c7ac, trim: 0x6b5b45, roof: 0xa5482f, floorA: 0xa88660, floorB: 0x9a7a56 }, // plaster house with a clay roof
];

// =============================================================================================
// Backdrop: mountains, ground beyond the walls, clouds
// =============================================================================================
export function buildBackdrop(scene: THREE.Scene, rand: () => number) {
  // endless ground outside the walls: a big disc with a square hole where the arena terrain is (so it cannot hide the pond)
  const shape = new THREE.Shape();
  shape.absarc(0, 0, 520, 0, Math.PI * 2, false);
  const hole = new THREE.Path();
  const q = 60.3;
  hole.moveTo(-q, -q);
  hole.lineTo(-q, q);
  hole.lineTo(q, q);
  hole.lineTo(q, -q);
  hole.closePath();
  shape.holes.push(hole);
  const ground = new THREE.Mesh(new THREE.ShapeGeometry(shape, 48), new THREE.MeshStandardMaterial({ color: 0x4f7a3a, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.03;
  scene.add(ground);
  // a ring of low-poly mountains, hazy with distance
  const b = new MeshBuilder();
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + rand() * 0.15;
    const r = 150 + rand() * 60;
    const h = 28 + rand() * 38;
    const col = new THREE.Color(0x6a7d8c).offsetHSL((rand() - 0.5) * 0.03, 0, (rand() - 0.5) * 0.07);
    b.cone(col, 26 + rand() * 20, h, { p: [Math.cos(a) * r, h / 2 - 3, Math.sin(a) * r], r: [0, rand() * 6, 0] }, 6 + Math.floor(rand() * 3));
    b.cone(0xe8eef2, (26 + rand() * 6) * 0.35, h * 0.28, { p: [Math.cos(a) * r, h - h * 0.14 - 3, Math.sin(a) * r] }, 6); // snowy tip (roughly)
  }
  const m = new THREE.Mesh(b.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true, fog: true }));
  scene.add(m);
}

export function buildClouds(scene: THREE.Scene, rand: () => number) {
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false, fog: false });
  const clouds: THREE.Group[] = [];
  for (let i = 0; i < 9; i++) {
    const g = new THREE.Group();
    const n = 4 + Math.floor(rand() * 3);
    for (let k = 0; k < n; k++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 6), mat);
      s.scale.set(9 + rand() * 8, 3 + rand() * 2.5, 6 + rand() * 4);
      s.position.set(k * 9 - n * 4, rand() * 2, (rand() - 0.5) * 6);
      g.add(s);
    }
    g.position.set((rand() * 2 - 1) * 220, 75 + rand() * 25, (rand() * 2 - 1) * 220);
    scene.add(g);
    clouds.push(g);
  }
  return (dt: number) => {
    for (const c of clouds) {
      c.position.x += dt * 2.2;
      if (c.position.x > 240) c.position.x = -240;
    }
  };
}

export { HOUSES };
