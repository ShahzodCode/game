import * as THREE from 'three';
import { MeshBuilder } from '../entities/meshBuilder';
import { makeDisplayGun } from '../weapons/models';

// Detailed decoration for the two shops. Everything static is merged into a few vertex-coloured meshes
// (MeshBuilder), so the extra detail costs almost nothing. Pieces only touch, they never share a flat face
// with another colour (no z-fighting). The kiosk counters and walls themselves (the colliders) live in
// world.ts / rooms.ts; this adds the trimmings around them.

const WOOD = 0x8a5a2e, WOOD_DARK = 0x5e3b1c, METAL = 0x2a2d33, STEEL = 0x8c939c, BRASS = 0xb8913c;
const RED = 0xd94a3a, CREAM = 0xf2ecdc, YELLOW = 0xf2c230, BLACK = 0x1b1c20, OLIVE = 0x56612f;

const stdMat = (rough = 0.75, metal = 0.05) => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: rough, metalness: metal, flatShading: true });

function addMesh(scene: THREE.Scene, b: MeshBuilder, blockers?: THREE.Object3D[], rough = 0.75, metal = 0.05) {
  const m = new THREE.Mesh(b.build(), stdMat(rough, metal));
  m.castShadow = true;
  m.receiveShadow = false;
  scene.add(m);
  blockers?.push(m);
  return m;
}

/** Striped canvas awning. Stripes run along `axis` ('x': stripes are 0.5 wide in x, running in z). */
function awning(b: MeshBuilder, cx: number, cy: number, cz: number, w: number, d: number, tilt: number, along: 'x' | 'z') {
  const n = Math.round((along === 'x' ? w : d) / 0.5);
  const step = (along === 'x' ? w : d) / n;
  for (let i = 0; i < n; i++) {
    const col = i % 2 ? CREAM : RED;
    const off = -((along === 'x' ? w : d) / 2) + step * (i + 0.5);
    if (along === 'x') b.box(col, step, 0.06, d, { p: [cx + off, cy, cz], r: [tilt, 0, 0] });
    else b.box(col, w, 0.06, step, { p: [cx, cy, cz + off], r: [0, 0, tilt] });
  }
  // scalloped valance hanging from the low front edge
  const edge = new THREE.Vector3(0, 0, 0);
  if (along === 'x') edge.set(0, (d / 2) * Math.sin(tilt), -(d / 2) * Math.cos(tilt)); // front = -z
  else edge.set((w / 2) * Math.cos(tilt), (w / 2) * Math.sin(tilt), 0); // front = +x
  const len = along === 'x' ? w : d;
  const m = Math.round(len / 0.25);
  const st = len / m;
  for (let i = 0; i < m; i++) {
    const col = i % 2 ? CREAM : RED;
    const off = -len / 2 + st * (i + 0.5);
    if (along === 'x') b.box(col, st, 0.2, 0.05, { p: [cx + off, cy + edge.y - 0.1, cz + edge.z - 0.03] });
    else b.box(col, 0.05, 0.2, st, { p: [cx + edge.x + 0.03, cy + edge.y - 0.1, cz + off] });
  }
}

/** A small first-aid potion bottle (red glass, cork, white label with a red cross). `faceZ` = which way the label faces. */
function potion(b: MeshBuilder, x: number, y: number, z: number) {
  b.cyl(0xc42535, 0.07, 0.07, 0.2, { p: [x, y + 0.1, z] }, 12);
  b.cyl(0xc42535, 0.03, 0.06, 0.07, { p: [x, y + 0.235, z] }, 10);
  b.cyl(0x9a6a3a, 0.034, 0.034, 0.04, { p: [x, y + 0.29, z] }, 8);
  b.box(CREAM, 0.085, 0.085, 0.146, { p: [x, y + 0.1, z] });
  b.box(0xd02a3a, 0.07, 0.02, 0.15, { p: [x, y + 0.1, z] });
  b.box(0xd02a3a, 0.02, 0.07, 0.15, { p: [x, y + 0.1, z] });
}

function ammoBox(b: MeshBuilder, x: number, y: number, z: number, color = OLIVE, w = 0.34, h = 0.2, d = 0.22) {
  b.box(color, w, h, d, { p: [x, y + h / 2, z] });
  b.box(YELLOW, w + 0.01, 0.045, d + 0.01, { p: [x, y + h * 0.62, z] });
  b.box(BLACK, w * 0.5, 0.012, d + 0.012, { p: [x, y + h * 0.62, z] });
}

function barrel(b: MeshBuilder, x: number, y: number, z: number, color = 0x4a5a7a) {
  b.cyl(color, 0.34, 0.31, 0.9, { p: [x, y + 0.45, z] }, 14);
  for (const k of [0.18, 0.45, 0.72]) b.cyl(STEEL, 0.352 - (k - 0.45) * 0.05, 0.352 - (k - 0.45) * 0.05, 0.05, { p: [x, y + k, z] }, 14);
}

function crate(b: MeshBuilder, x: number, y: number, z: number, s: number, rot = 0) {
  b.box(0x9b6b3a, s, s, s, { p: [x, y + s / 2, z], r: [0, rot, 0] });
  // corner posts and cross planks stick out a little
  const e = s * 0.5;
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    const c = Math.cos(rot), sn = Math.sin(rot);
    const px = dx * e * c + dz * e * sn, pz = -dx * e * sn + dz * e * c;
    b.box(WOOD_DARK, s * 0.1, s * 1.02, s * 0.1, { p: [x + px, y + s / 2, z + pz], r: [0, rot, 0] });
  }
}

// =============================================================================================
// SUPPLY SHOP (arena, next to the gate). Kiosk: counter 3 x 1.1 x 1 at (8, 54), back wall z 55.45..55.75.
// Customers stand in front (z < 53.5) and look toward +z.
// =============================================================================================
export function buildSupplyShopProps(
  scene: THREE.Scene,
  boxes: THREE.Box3[],
  blockers: THREE.Object3D[],
  groundAt: (x: number, z: number) => number,
  makeSign: (text: string, w: number, h: number) => THREE.Object3D,
) {
  const X = 8, Z = 54;
  const y0 = groundAt(X, Z);
  const b = new MeshBuilder();

  // counter: wooden top slab with an overhang, hazard-striped kick plate, trim
  b.box(WOOD, 3.3, 0.07, 1.25, { p: [X, y0 + 1.135, Z] });
  b.box(WOOD_DARK, 3.34, 0.03, 1.29, { p: [X, y0 + 1.185, Z] });
  for (let i = 0; i < 10; i++) b.box(i % 2 ? BLACK : YELLOW, 0.3, 0.16, 0.03, { p: [X - 1.35 + i * 0.3, y0 + 0.14, Z - 0.515] });
  b.box(BRASS, 3.0, 0.04, 0.03, { p: [X, y0 + 1.0, Z - 0.515] });

  // on the counter: cash register, ammo boxes, a potion on display, a little bell
  b.box(0x3a3d44, 0.42, 0.22, 0.34, { p: [X + 1.0, y0 + 1.31, Z + 0.1] });
  b.box(0x2a2d33, 0.3, 0.16, 0.08, { p: [X + 1.0, y0 + 1.5, Z + 0.15], r: [-0.45, 0, 0] });
  b.box(0x66e08a, 0.22, 0.08, 0.01, { p: [X + 1.0, y0 + 1.5, Z + 0.105], r: [-0.45, 0, 0] });
  for (let i = 0; i < 6; i++) b.box(i % 2 ? 0xcfd2d6 : 0x9a9ea5, 0.06, 0.02, 0.05, { p: [X + 0.88 + (i % 3) * 0.1, y0 + 1.43, Z - 0.02 + Math.floor(i / 3) * 0.06] });
  ammoBox(b, X - 1.1, y0 + 1.22, Z + 0.15);
  ammoBox(b, X - 1.1, y0 + 1.42, Z + 0.15, 0x4a5530);
  ammoBox(b, X - 0.65, y0 + 1.22, Z - 0.1, 0x6a4a2a);
  potion(b, X - 0.15, y0 + 1.22, Z - 0.2);
  potion(b, X + 0.15, y0 + 1.22, Z - 0.25);
  b.cyl(BRASS, 0.01, 0.06, 0.07, { p: [X + 0.5, y0 + 1.255, Z - 0.3] }, 10);

  // shelves on the back wall with ammo boxes, potions and spare magazines
  const wz = 55.45;
  for (const sy of [1.45, 1.9, 2.3]) b.box(WOOD_DARK, 3.1, 0.05, 0.38, { p: [X, y0 + sy, wz - 0.19] });
  for (const sx of [-1.5, 1.5]) b.box(WOOD_DARK, 0.06, 1.0, 0.38, { p: [X + sx, y0 + 1.9, wz - 0.19] });
  for (let i = 0; i < 7; i++) ammoBox(b, X - 1.25 + i * 0.42, y0 + 1.475, wz - 0.22, i % 3 === 0 ? 0x6a4a2a : OLIVE);
  for (let i = 0; i < 9; i++) potion(b, X - 1.2 + i * 0.3, y0 + 1.925, wz - 0.2);
  for (let i = 0; i < 10; i++) {
    b.box(i % 2 ? 0x30343b : 0x24272c, 0.09, 0.2, 0.05, { p: [X - 1.2 + i * 0.27, y0 + 2.425, wz - 0.2], r: [0, 0, (i % 3 - 1) * 0.05] });
    b.box(BRASS, 0.09, 0.02, 0.051, { p: [X - 1.2 + i * 0.27, y0 + 2.5, wz - 0.2] });
  }
  // red cross emblem above the shelves would clash with the awning: a hanging board goes on the sign instead

  // posts and the striped canopy over the customers
  for (const sx of [-1.95, 1.95]) {
    b.cyl(WOOD, 0.07, 0.08, 2.42, { p: [X + sx, y0 + 1.21, 52.7] }, 10);
    b.box(WOOD_DARK, 0.2, 0.08, 0.2, { p: [X + sx, y0 + 0.04, 52.7] });
    boxes.push(new THREE.Box3(new THREE.Vector3(X + sx - 0.12, y0, 52.58), new THREE.Vector3(X + sx + 0.12, y0 + 2.4, 52.82)));
  }
  awning(b, X, y0 + 2.62, 54.2, 4.2, 3.2, -0.12, 'x');
  // sign poles
  for (const sx of [-1.45, 1.45]) b.cyl(METAL, 0.04, 0.04, 1.0, { p: [X + sx, y0 + 3.25, 54.4] }, 8);
  // lanterns hanging from the front corners of the canopy
  for (const sx of [-1.95, 1.95]) {
    b.cyl(METAL, 0.012, 0.012, 0.22, { p: [X + sx, y0 + 2.32, 52.72] }, 5);
    b.box(METAL, 0.17, 0.03, 0.17, { p: [X + sx, y0 + 2.19, 52.72] });
    b.box(METAL, 0.17, 0.03, 0.17, { p: [X + sx, y0 + 1.9, 52.72] });
  }
  addMesh(scene, b);

  // glowing lantern glass
  const glow = new THREE.MeshBasicMaterial({ color: 0xffc766 });
  for (const sx of [-1.95, 1.95]) {
    const g = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.26, 0.13), glow);
    g.position.set(X + sx, y0 + 2.045, 52.72);
    scene.add(g);
  }
  // fixed board facing the arena (-z); a sprite would swivel to follow the player
  const sign = makeSign('SUPPLY SHOP', 3.2, 0.8);
  sign.position.set(X, y0 + 3.4, 54.4);
  sign.rotation.y = Math.PI;
  scene.add(sign);

  // beside the kiosk: barrels and crates (solid)
  const side = new MeshBuilder();
  const place = (x: number, z: number, w: number, d: number, h: number) => {
    const g = groundAt(x, z);
    boxes.push(new THREE.Box3(new THREE.Vector3(x - w / 2, g, z - d / 2), new THREE.Vector3(x + w / 2, g + h, z + d / 2)));
    return g;
  };
  let g = place(5.0, 54.6, 0.72, 0.72, 0.9);
  barrel(side, 5.0, g, 54.6);
  g = place(5.0, 53.7, 0.72, 0.72, 0.9);
  barrel(side, 5.0, g, 53.7, 0x7a3a3a);
  g = place(11.0, 54.7, 1.0, 1.0, 1.0);
  crate(side, 11.0, g, 54.7, 1.0, 0.1);
  g = place(11.0, 54.7, 0.64, 0.64, 1.6);
  crate(side, 11.0, g + 1.0, 54.7, 0.6, -0.3);
  g = place(10.9, 53.5, 0.8, 0.8, 0.8);
  crate(side, 10.9, g, 53.5, 0.8, 0.5);
  addMesh(scene, side, blockers);
}

// =============================================================================================
// WEAPON SHOP (safe room, left wall x = -13). Back panel x -13..-12.6, z 91..97, 3 m high;
// counter x -11.8..-10.8, z 91.5..96.5, 1.1 m high. Customers stand at x > -10.8 and look toward -x.
// =============================================================================================
export function buildWeaponShopProps(
  scene: THREE.Scene,
  boxes: THREE.Box3[],
  KX: number,
  makeSign: (text: string, w: number, h: number) => THREE.Object3D,
) {
  const b = new MeshBuilder();
  const px = KX + 0.4; // front face of the back panel

  // pegboard frame, header and two gun rails on the panel
  b.box(WOOD_DARK, 0.06, 0.14, 6.0, { p: [px + 0.03, 2.93, 94] }); // header
  b.box(WOOD_DARK, 0.06, 0.12, 6.0, { p: [px + 0.03, 0.08, 94] }); // skirting
  for (const z of [91.07, 96.93]) b.box(WOOD_DARK, 0.06, 3.0, 0.14, { p: [px + 0.03, 1.5, z] });
  for (const z of [92.5, 94, 95.5]) b.box(WOOD_DARK, 0.04, 2.6, 0.06, { p: [px + 0.02, 1.5, z] }); // slats
  for (const ry of [1.5, 2.3]) {
    b.box(WOOD, 0.14, 0.06, 5.8, { p: [px + 0.07, ry, 94] }); // rail
    for (const z of [91.5, 94, 96.5]) b.box(METAL, 0.2, 0.05, 0.1, { p: [px + 0.1, ry - 0.06, z] }); // brackets
  }
  // shell and cartridge boxes on the lower rail
  for (const [z, col] of [[94.7, RED], [95.15, 0x2f6fb5], [95.6, RED], [96.05, 0x2f6fb5], [96.5, RED]] as [number, number][]) {
    b.box(col, 0.14, 0.17, 0.4, { p: [px + 0.17, 1.53 + 0.085, z] });
    b.box(CREAM, 0.145, 0.06, 0.3, { p: [px + 0.17, 1.53 + 0.1, z] });
  }
  // upper-rail knife-like tags are drawn by the signs below; price tags hang under each gun
  const tag = (z: number, y: number, col: number) => b.box(col, 0.015, 0.2, 0.34, { p: [px + 0.075, y, z] });
  tag(92.5, 2.15, CREAM);
  tag(95.2, 2.15, CREAM);

  // counter: wooden top with overhang, metal rim, hazard kick plate, front rail
  const cx = KX + 1.7; // counter centre x (counter spans KX+1.2 .. KX+2.2)
  b.box(WOOD, 1.34, 0.07, 5.34, { p: [cx, 1.135, 94] });
  b.box(METAL, 1.38, 0.03, 5.38, { p: [cx, 1.185, 94] });
  for (let i = 0; i < 10; i++) b.box(i % 2 ? BLACK : YELLOW, 0.03, 0.16, 0.5, { p: [KX + 2.215, 0.14, 91.75 + i * 0.5] });
  b.box(BRASS, 0.03, 0.04, 5.0, { p: [KX + 2.215, 1.0, 94] });
  // cash register and ammo crates at the ends of the counter
  b.box(0x3a3d44, 0.34, 0.22, 0.42, { p: [cx, 1.31, 95.9] });
  b.box(0x2a2d33, 0.08, 0.16, 0.3, { p: [cx + 0.1, 1.5, 95.9], r: [0, 0, -0.45] });
  b.box(0x66e08a, 0.01, 0.08, 0.22, { p: [cx + 0.105, 1.5, 95.9], r: [0, 0, -0.45] });
  ammoBox(b, cx, 1.22, 92.0, OLIVE, 0.4, 0.26, 0.5);
  ammoBox(b, cx, 1.48, 92.0, 0x4a5530, 0.36, 0.22, 0.46);
  b.cyl(BRASS, 0.01, 0.06, 0.07, { p: [cx - 0.3, 1.255, 95.4] }, 10);

  // glass display case on the counter
  const caseZ = 93.9;
  b.box(METAL, 1.0, 0.06, 1.7, { p: [cx, 1.25, caseZ] });
  b.box(0x7a1f2a, 0.9, 0.02, 1.6, { p: [cx, 1.29, caseZ] }); // red velvet
  for (const [x, y, z] of [[-0.48, 0, -0.83], [0.48, 0, -0.83], [-0.48, 0, 0.83], [0.48, 0, 0.83]] as const)
    b.box(METAL, 0.04, 0.5, 0.04, { p: [cx + x, 1.5, caseZ + z + y] });
  b.box(METAL, 1.0, 0.04, 1.7, { p: [cx, 1.77, caseZ] });

  // pendant lamp over the counter
  b.cyl(BLACK, 0.01, 0.01, 0.7, { p: [cx, 3.2, 94.6] }, 4);
  b.box(METAL, 0.05, 0.04, 0.05, { p: [cx, 3.57, 94.6] });
  addMesh(scene, b);

  // glass of the case (transparent, so it is its own mesh) and the lamp shade glow
  const glass = new THREE.Mesh(
    new THREE.BoxGeometry(0.94, 0.46, 1.64),
    new THREE.MeshStandardMaterial({ color: 0xbfe6f5, transparent: true, opacity: 0.2, roughness: 0.05, metalness: 0.1, depthWrite: false }),
  );
  glass.position.set(cx, 1.52, caseZ);
  scene.add(glass);
  const shade = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.26, 14, 1, true), new THREE.MeshBasicMaterial({ color: 0xffe2a8, side: THREE.DoubleSide }));
  shade.position.set(cx, 3.35, 94.6);
  scene.add(shade);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: 0xfff6d8 }));
  bulb.position.set(cx, 3.28, 94.6);
  scene.add(bulb);
  const warm = new THREE.PointLight(0xffd9a0, 55, 9, 2);
  warm.position.set(cx + 0.4, 3.1, 94.6);
  scene.add(warm);

  // real gun models: two long guns on the upper rail, pistols on the lower rail, pistols in the case
  const hang = (id: string, length: number, y: number, z: number, x = px + 0.2, yaw = 0) => {
    const g = makeDisplayGun(id, length);
    g.position.set(x, y, z);
    g.rotation.y = yaw;
    scene.add(g);
  };
  hang('shotgun', 1.9, 2.36, 92.55);
  hang('rifle', 1.7, 2.36, 95.25);
  hang('pistol', 0.55, 1.56, 91.85);
  hang('pistol', 0.55, 1.56, 92.6);
  hang('pistol', 0.55, 1.56, 93.35);
  hang('pistol', 0.45, 1.3, caseZ - 0.4, cx + 0.05, 0.4);
  hang('pistol', 0.45, 1.3, caseZ + 0.4, cx + 0.05, -0.3);

  // striped canopy over the counter, sloping down towards the customers, held up by two posts
  const aw = new MeshBuilder();
  awning(aw, KX + 1.8, 3.05, 94, 3.2, 6.2, -0.12, 'z');
  for (const z of [91.2, 96.8]) {
    aw.cyl(WOOD, 0.07, 0.08, 2.85, { p: [KX + 3.25, 1.425, z] }, 10);
    aw.box(WOOD_DARK, 0.2, 0.08, 0.2, { p: [KX + 3.25, 0.04, z] });
    boxes.push(new THREE.Box3(new THREE.Vector3(KX + 3.13, 0, z - 0.12), new THREE.Vector3(KX + 3.37, 2.85, z + 0.12)));
  }
  addMesh(scene, aw);

  // sign with glowing neon bars; the board itself faces into the room (+x)
  const sign = makeSign('WEAPON SHOP', 3.4, 0.85);
  sign.position.set(KX + 0.55, 4.7, 94);
  sign.rotation.y = Math.PI / 2;
  scene.add(sign);
  const neon = new THREE.MeshBasicMaterial({ color: 0xffd84a });
  for (const y of [5.28, 4.12]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 3.6), neon);
    bar.position.set(KX + 0.55, y, 94);
    scene.add(bar);
  }
  // floor mat in front of the counter (a different colour from the floor and the rug, touching only)
  const mat = new MeshBuilder();
  mat.box(0x3b3f4a, 2.2, 0.02, 5.4, { p: [KX + 3.4, 0.01, 94] });
  mat.box(BRASS, 2.2, 0.021, 0.08, { p: [KX + 3.4, 0.0105, 91.34] });
  mat.box(BRASS, 2.2, 0.021, 0.08, { p: [KX + 3.4, 0.0105, 96.66] });
  addMesh(scene, mat);
}

// =============================================================================================
// ARMORY TERMINAL (safe room, right wall x = +13): a machine with a screen showing the current loadout,
// like the weapon terminals in ULTRAKILL. Customers stand at x < 12 and look toward +x.
// =============================================================================================
export function buildArmoryTerminal(
  scene: THREE.Scene,
  boxes: THREE.Box3[],
  blockers: THREE.Object3D[],
  WX: number, // inner surface of the right wall
  Z: number,
  makeSign: (text: string, w: number, h: number) => THREE.Object3D,
): (lines: string[]) => void {
  const b = new MeshBuilder();
  const fx = WX - 1.0; // front face of the cabinet
  const cx = WX - 0.5;
  // cabinet, side cheeks, top hood, base
  b.box(0x2a2f3a, 1.0, 2.5, 2.0, { p: [cx, 1.25, Z] });
  b.box(0x1b1e26, 1.04, 0.12, 2.1, { p: [cx, 0.06, Z] });
  b.box(0x1b1e26, 1.06, 0.14, 2.12, { p: [cx, 2.57, Z] });
  for (const dz of [-1.04, 1.04]) b.box(0x3b4252, 1.0, 2.5, 0.08, { p: [cx, 1.25, Z + dz] });
  b.box(0x3b4252, 0.06, 2.3, 2.0, { p: [fx - 0.03, 1.3, Z] }); // front plate
  // screen bezel (the glowing screen is a separate mesh)
  b.box(0x0f1116, 0.05, 1.2, 1.7, { p: [fx - 0.085, 1.75, Z] });
  // control shelf, slanted, with three buttons
  b.box(0x20242d, 0.45, 0.1, 1.9, { p: [fx - 0.2, 1.0, Z], r: [0, 0, -0.35] });
  const colours = [0x44ff88, 0xffd84a, 0xff6a4a];
  for (let i = 0; i < 3; i++) {
    b.cyl(colours[i], 0.1, 0.1, 0.05, { p: [fx - 0.28, 1.06, Z - 0.55 + i * 0.55], r: [0, 0, 1.2] }, 14);
    b.cyl(0x15171c, 0.14, 0.14, 0.03, { p: [fx - 0.265, 1.05, Z - 0.55 + i * 0.55], r: [0, 0, 1.2] }, 14);
  }
  // dispenser slot with a lit tray
  b.box(0x0f1116, 0.2, 0.34, 1.3, { p: [fx - 0.1, 0.5, Z] });
  b.box(0x2c3a52, 0.28, 0.04, 1.3, { p: [fx - 0.14, 0.34, Z] });
  // floor mat
  b.box(0x3b3f4a, 2.3, 0.02, 2.6, { p: [fx - 1.2, 0.01, Z] });
  b.box(BRASS, 0.08, 0.021, 2.6, { p: [fx - 2.34, 0.0105, Z] });
  const m = addMesh(scene, b, blockers);
  void m;
  boxes.push(new THREE.Box3(new THREE.Vector3(fx - 0.05, 0, Z - 1.1), new THREE.Vector3(WX, 2.6, Z + 1.1)));

  // glowing screen
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 384;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const draw = (lines: string[]) => {
    const g = canvas.getContext('2d')!;
    g.fillStyle = '#04120b';
    g.fillRect(0, 0, 512, 384);
    g.strokeStyle = '#44ff88';
    g.lineWidth = 6;
    g.strokeRect(8, 8, 496, 368);
    g.fillStyle = '#44ff88';
    g.font = 'bold 54px system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillText('ARMORY', 256, 76);
    g.fillRect(36, 96, 440, 3);
    g.textAlign = 'left';
    g.font = "bold 34px system-ui, sans-serif";
    lines.forEach((l, i) => {
      g.fillStyle = l.includes('EMPTY') ? '#ff8a6a' : '#e6fff0';
      g.fillText(`${i + 1}  ${l}`, 40, 150 + i * 52);
    });
    g.font = '24px system-ui, sans-serif';
    g.fillStyle = '#7ad9a0';
    g.textAlign = 'center';
    g.fillText('press E to equip', 256, 352);
    tex.needsUpdate = true;
  };
  draw(['SIDEARM: ...', 'RIFLE: ...', 'HEAVY: ...']);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.1), new THREE.MeshBasicMaterial({ map: tex }));
  screen.position.set(fx - 0.115, 1.75, Z);
  screen.rotation.y = -Math.PI / 2;
  scene.add(screen);
  const sign = makeSign('ARMORY', 1.9, 0.5);
  sign.position.set(fx - 0.04, 2.38, Z);
  sign.rotation.y = -Math.PI / 2;
  scene.add(sign);
  const glow = new THREE.PointLight(0x66ffaa, 14, 7, 2);
  glow.position.set(fx - 0.9, 1.8, Z);
  scene.add(glow);
  return draw;
}

// =============================================================================================
// QUEST BOARD (safe room, back wall): a wooden notice board covered in notes. Press E next to it to read the global quests.
// =============================================================================================
export function buildQuestBoard(
  scene: THREE.Scene,
  boxes: THREE.Box3[],
  WZ: number, // inner surface of the back wall (z)
  X: number,
  makeSign: (text: string, w: number, h: number) => THREE.Object3D,
) {
  const b = new MeshBuilder();
  const fz = WZ - 0.12; // front of the board
  b.box(WOOD_DARK, 4.2, 2.5, 0.12, { p: [X, 1.75, WZ - 0.06] }); // frame
  b.box(0x9a6a3a, 3.96, 2.26, 0.06, { p: [X, 1.75, fz - 0.03] }); // cork / planks
  for (const [dx, dy, w, h, c, r] of [
    [-1.4, 2.4, 0.7, 0.9, 0xf0e6c8, 0.05], [-0.5, 2.55, 0.8, 0.6, 0xe8dcb8, -0.04], [0.5, 2.35, 0.7, 1.0, 0xf4ecd2, 0.03], [1.4, 2.5, 0.75, 0.7, 0xe6d9b4, -0.06],
    [-1.3, 1.5, 0.8, 0.7, 0xe8dcb8, -0.03], [-0.3, 1.45, 0.7, 0.9, 0xf0e6c8, 0.06], [0.7, 1.4, 0.85, 0.7, 0xf4ecd2, -0.05], [1.5, 1.45, 0.6, 0.8, 0xe6d9b4, 0.04],
  ] as [number, number, number, number, number, number][]) {
    b.box(c, w, h, 0.01, { p: [X + dx, dy - 0.1, fz - 0.07], r: [0, 0, r] }); // pinned note
    b.ball(0xc23b3b, 0.035, { p: [X + dx, dy + h / 2 - 0.16, fz - 0.085], s: [1, 1, 0.5] }); // pin
    for (let l = 0; l < 3; l++) b.box(0x6a5a40, w * 0.7, 0.025, 0.004, { p: [X + dx, dy - 0.1 + 0.12 - l * 0.12, fz - 0.078], r: [0, 0, r] }); // scribbles
  }
  b.box(0x2a2f3a, 4.4, 0.1, 0.9, { p: [X, 0.45, WZ - 0.5] }); // ledge
  for (const s of [-1, 1]) b.box(WOOD_DARK, 0.14, 0.5, 0.14, { p: [X + s * 2.1, 0.25, WZ - 0.5] });
  addMesh(scene, b);
  boxes.push(new THREE.Box3(new THREE.Vector3(X - 2.2, 0, WZ - 0.95), new THREE.Vector3(X + 2.2, 3.1, WZ)));
  const sign = makeSign('QUEST BOARD', 2.6, 0.65);
  sign.position.set(X, 3.15, fz - 0.05);
  sign.rotation.y = Math.PI;
  scene.add(sign);
}
