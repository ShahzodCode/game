import * as THREE from 'three';
import { MeshBuilder } from './meshBuilder';
import type { Costume } from './mannequin';
import { buildGlbRig } from './glbRig';

/**
 * Detailed procedural human for the bots. Every body part (torso, head, 2 arms, 2 legs) is one merged mesh
 * with vertex colours, so a bot costs ~8 draw calls however many small details it has. Parts hang from
 * pivot groups (hips, shoulders, neck) so the walk / idle animation in mannequin.ts can move them.
 * Coordinates: metres, feet at y = 0, the bot faces +z.
 */
export interface BotRig {
  root: THREE.Group;
  head: THREE.Group;
  legs: THREE.Group[]; // [left, right]
  arms: THREE.Group[]; // [left, right]
  cape: THREE.Group | null;
  hitMeshes: THREE.Mesh[];
  materials: THREE.Material[];
  /** Bone-driven (downloaded) characters copy the arm / leg / head groups onto their bones here, once per frame. */
  post?: (phase: number, amp: number) => void;
  /** Swaps the brows + mouth (procedural humans only). */
  setExpression?: (e: Expression) => void;
  dispose: () => void;
}

export type Expression = 'neutral' | 'scared' | 'angry' | 'pain';

const SKINS = [0xf1c9a5, 0xe0ac86, 0xc68e63, 0x9a6a46, 0x6f4a2f, 0x4e3322];
const HAIRS = [0x1b1b1b, 0x3a2614, 0x6a4a2a, 0xa57c3a, 0x8a3b1d, 0xb8b8b8];
const EYES = [0x3b6fb5, 0x5a3a1c, 0x4a7a4a, 0x6b6b6b];
const pick = <T>(a: T[]): T => a[Math.floor(Math.random() * a.length)];
const shade = (hex: number, k: number) => new THREE.Color(hex).multiplyScalar(k);
const mix = (a: number, b: number, t: number) => new THREE.Color(a).lerp(new THREE.Color(b), t);
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const PI = Math.PI;

type Shoe = 'sneaker' | 'boot' | 'dress' | 'tabi' | 'clog' | 'combat' | 'cowboy' | 'superboot';
interface Look {
  sleeves: 'long' | 'short';
  glove?: number;
  shoe: Shoe;
  shoeColor: number;
  hair: 'short' | 'slick' | 'curl' | 'none';
  hairColor?: number;
  mustache?: boolean;
  muscle: number; // overall build
  belt?: number;
  buckle?: number;
  cuff?: number;
  brow: number; // brow tilt, + = angry / stern, - = worried / friendly
  smile: number; // mouth curve, + = smile, - = frown
  lid?: number; // eyelid droop 0..1 (sleepy / squinting)
  w?: number; // body width factor (shoulders, arms)
  belly?: number; // extra round belly
}

const LOOKS: Record<string, Look> = {
  regular: { sleeves: 'short', shoe: 'sneaker', shoeColor: 0x6a7a8c, hair: 'short', muscle: 1, brow: -0.12, smile: 0.2 },
  winter: { sleeves: 'long', glove: 0x2a2a30, shoe: 'boot', shoeColor: 0x3a2a1c, hair: 'short', muscle: 1.1, brow: -0.05, smile: -0.1, lid: 0.55, w: 1.04 },
  builder: { sleeves: 'long', glove: 0x9a7a44, shoe: 'boot', shoeColor: 0x6b4a2a, hair: 'short', muscle: 1.06, belt: 0x4a3016, buckle: 0xb8b8b8, brow: 0.12, smile: 0.1, w: 1.1 },
  sporty: { sleeves: 'short', shoe: 'sneaker', shoeColor: 0xe8e8e8, hair: 'short', muscle: 1.0, brow: -0.2, smile: 0.9, w: 0.94 },
  chef: { sleeves: 'long', shoe: 'clog', shoeColor: 0x222226, hair: 'short', mustache: true, muscle: 1.05, cuff: 0xffffff, brow: -0.25, smile: 1, w: 1.06, belly: 1 },
  rich: { sleeves: 'long', shoe: 'dress', shoeColor: 0x111114, hair: 'slick', mustache: true, muscle: 0.98, cuff: 0xf4f4f4, brow: -0.3, smile: 0.45, lid: 0.3, w: 0.9 },
  cowboy: { sleeves: 'long', shoe: 'cowboy', shoeColor: 0x5a3a1e, hair: 'short', mustache: true, muscle: 1.04, belt: 0x4a2c14, buckle: 0xd9b34a, brow: 0.2, smile: -0.2, lid: 0.45, w: 1.04 },
  soldier: { sleeves: 'long', glove: 0x26262a, shoe: 'combat', shoeColor: 0x1c1c1e, hair: 'none', muscle: 1.1, belt: 0x2a2a22, buckle: 0x555555, brow: 0.3, smile: -0.5, w: 1.1 },
  superman: { sleeves: 'long', shoe: 'superboot', shoeColor: 0xc22d2d, hair: 'curl', hairColor: 0x15151a, muscle: 1.14, brow: 0.14, smile: 0.5, w: 1.12 },
  zombie: { sleeves: 'long', shoe: 'boot', shoeColor: 0x2a2a24, hair: 'none', muscle: 0.98, brow: 0.3, smile: -0.8 },
  boss: { sleeves: 'long', glove: 0x1c1224, shoe: 'combat', shoeColor: 0x120c18, hair: 'none', muscle: 1.22, belt: 0x120c18, buckle: 0xb02a2a, brow: 0.5, smile: -0.8 },
  ninja: { sleeves: 'long', glove: 0x17171a, shoe: 'tabi', shoeColor: 0x17171a, hair: 'none', muscle: 1.0, cuff: 0x55555c, brow: 0.42, smile: 0 },
  criminal: { sleeves: 'long', glove: 0x1c1c20, shoe: 'boot', shoeColor: 0x1a1a1c, hair: 'none', muscle: 1.06, belt: 0x141416, buckle: 0x777777, brow: 0.45, smile: -0.7, lid: 0.25 },
};

// torso silhouette as [radius, y above the hips]: waist, chest, shoulders, neck base
const HIP = 0.9;
const PROF: [number, number][] = [
  [0.001, 0], [0.135, 0.015], [0.152, 0.1], [0.136, 0.2], [0.15, 0.32], [0.168, 0.42], [0.152, 0.5], [0.075, 0.565], [0.001, 0.585],
];
function profR(y: number) {
  for (let i = 0; i < PROF.length - 1; i++) {
    const [r0, y0] = PROF[i], [r1, y1] = PROF[i + 1];
    if (y >= y0 && y <= y1) return r0 + (r1 - r0) * ((y - y0) / (y1 - y0));
  }
  return 0.001;
}
/** A slice of the torso silhouette, scaled out by k: a vest / jacket shell. */
function slice(y0: number, y1: number, k: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let y = y0; y <= y1 + 1e-6; y += 0.03) pts.push([profR(y) * k, y]);
  return pts;
}

export function buildBot(owner: object, c: Costume): BotRig {
  if (c.id === 'boss' || c.id === 'zombie') {
    const glb = buildGlbRig(owner, c.id); // the knight / the PolyArt zombies, once they have loaded
    if (glb) return glb;
  }
  const look = LOOKS[c.id];
  const id0 = c.id;
  const skin = id0 === 'zombie' ? 0x86a878 : id0 === 'boss' ? 0x8a7aa6 : pick(SKINS); // zombies green, the boss a bruised violet
  const hair = look.hairColor ?? pick(HAIRS);
  const eyeColor = id0 === 'boss' ? 0xff2a2a : id0 === 'zombie' ? 0xe0d860 : pick(EYES);
  const bulk = rnd(0.94, 1.08);
  const mu = look.muscle;
  const bw = look.w ?? 1; // body type: shoulder / arm width
  const tx = 1.18 * bulk * mu * bw; // torso half-width factor
  const tz = 0.78 * bulk * mu; // torso half-depth factor
  const armX = 0.245 * bulk * (1 + (mu - 1) * 0.6) * (0.5 + 0.5 * bw);
  const fz = (y: number) => profR(y - HIP) * tz; // torso front surface at height y
  const id = c.id;
  const shirt = c.shirt, pants = c.pants, accent = c.accent;

  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, flatShading: true });
  const materials: THREE.Material[] = [material];
  const geos: THREE.BufferGeometry[] = [];
  const hitMeshes: THREE.Mesh[] = [];
  /** Baked 'ambient occlusion': darker low down / under things, lighter on top (multiplies the vertex colours). */
  const bake = (g: THREE.BufferGeometry, k: (y: number) => number) => {
    const pos = g.attributes.position, col = g.attributes.color;
    for (let i = 0; i < pos.count; i++) {
      const f = k(pos.getY(i));
      col.setXYZ(i, Math.min(1, col.getX(i) * f), Math.min(1, col.getY(i) * f), Math.min(1, col.getZ(i) * f));
    }
  };
  const mk = (b: MeshBuilder, isHead = false, ao?: (y: number) => number) => {
    const g = b.build();
    if (ao) bake(g, ao);
    geos.push(g);
    const m = new THREE.Mesh(g, material);
    m.castShadow = true;
    m.userData.owner = owner;
    m.userData.head = isHead;
    hitMeshes.push(m);
    return m;
  };

  const root = new THREE.Group();

  // ================= torso (jacket / shirt, pelvis, shoulders, clothing details) =================
  const t = new MeshBuilder(true);
  t.lathe(shirt, PROF, { p: [0, HIP, 0], s: [tx, 1, tz] });
  t.ball(id === 'superman' ? 0xc22d2d : pants, 0.15, { p: [0, 0.935, 0], s: [1.12 * bulk, 0.7, 0.86 * bulk] });
  for (const s of [-1, 1]) t.ball(shirt, 0.068 * bulk * Math.min(mu, 1.1), { p: [s * armX * 0.9, 1.425, 0], s: [1, 1, 0.95] });

  if (look.belly) t.ball(shirt, 0.17, { p: [0, 1.09, 0.03], s: [1.15 * bulk, 0.95, 1.0] }); // round belly

  // belt (tucked-in outfits)
  if (look.belt) {
    t.cyl(look.belt, 0.157, 0.157, 0.04, { p: [0, 1.0, 0], s: [tx, 1, tz] }, 14);
    t.box(look.buckle ?? 0xb8b8b8, id === 'cowboy' ? 0.08 : 0.045, id === 'cowboy' ? 0.055 : 0.032, 0.012, { p: [0, 1.0, fz(1.0) + 0.012] });
  }
  const buttons = (color: THREE.ColorRepresentation, ys: number[], x = 0) => ys.forEach((y) => t.ball(color, 0.009, { p: [x, y, fz(y) + 0.002] }));
  const collar = (color: THREE.ColorRepresentation, R = 0.078, tube = 0.02) => t.torus(color, R, tube, { p: [0, 1.472, 0], r: [PI / 2, 0, 0], s: [1, 0.95, 1] });

  switch (id) {
    case 'regular':
      collar(shade(shirt, 0.82)); // crew neck of the t-shirt
      break;
    case 'winter': {
      // puffy quilted jacket: horizontal ridges, high collar, zip, scarf
      for (const y of [1.04, 1.16, 1.28, 1.4]) t.torus(shade(shirt, 0.85), profR(y - HIP) * 0.98, 0.016, { p: [0, y, 0], r: [PI / 2, 0, 0], s: [tx, tz, 1] });
      t.box(0x222226, 0.012, 0.5, 0.008, { p: [0, 1.2, fz(1.2) + 0.004] });
      t.torus(shade(shirt, 0.9), 0.08, 0.034, { p: [0, 1.5, 0], r: [PI / 2, 0, 0] });
      t.torus(accent, 0.092, 0.04, { p: [0, 1.5, 0], r: [PI / 2, 0, 0] }); // scarf wrap
      t.box(accent, 0.075, 0.3, 0.03, { p: [0.06, 1.34, fz(1.34) + 0.02], r: [0, 0, 0.06] }); // scarf tail
      for (const i of [-2, -1, 0, 1, 2]) t.box(shade(accent, 0.85), 0.008, 0.04, 0.012, { p: [0.06 + i * 0.014, 1.17, fz(1.17) + 0.02] }); // fringe
      break;
    }
    case 'builder': {
      collar(shade(shirt, 0.8));
      // hi-vis vest with reflective stripes
      t.lathe(accent, slice(0.12, 0.5, 1.06), { p: [0, HIP, 0], s: [tx, 1, tz] });
      for (const y of [1.14, 1.3]) t.torus(0xe6e6e6, profR(y - HIP) * 1.07, 0.018, { p: [0, y, 0], r: [PI / 2, 0, 0], s: [tx, tz, 1] });
      // tool belt: pouches + hammer
      for (const s of [-1, 1]) t.box(0x5a3c1a, 0.075, 0.095, 0.055, { p: [s * 0.14 * bulk, 0.96, 0.07] });
      t.box(0x6a4a24, 0.016, 0.16, 0.016, { p: [0.17 * bulk, 0.88, 0.02] });
      t.box(0x6e747c, 0.06, 0.03, 0.026, { p: [0.17 * bulk, 0.79, 0.02] });
      break;
    }
    case 'sporty':
      collar(0x1a1a1a, 0.078, 0.016);
      for (const s of [-1, 1]) t.box(0xffffff, 0.012, 0.46, 0.006, { p: [s * 0.1 * tx, 1.18, fz(1.18) * 0.93 + 0.003] }); // jersey stripes
      t.box(0xffffff, 0.06, 0.07, 0.006, { p: [0, 1.28, fz(1.28) + 0.004] }); // number patch
      break;
    case 'chef': {
      collar(0xffffff, 0.082, 0.026);
      // double-breasted coat buttons + overlap
      t.box(0xeaeae6, 0.14, 0.42, 0.008, { p: [0.02, 1.2, fz(1.2) + 0.003] });
      buttons(0x888888, [1.08, 1.17, 1.26, 1.35], -0.03);
      buttons(0x888888, [1.08, 1.17, 1.26, 1.35], 0.07);
      // apron + neckerchief
      t.box(0xffffff, 0.25, 0.55, 0.014, { p: [0, 1.1, 0.145] });
      t.box(0xdddddd, 0.012, 0.1, 0.012, { p: [0.09, 1.43, 0.12] });
      t.box(0xd23b3b, 0.085, 0.085, 0.02, { p: [0, 1.455, 0.105], r: [0, 0, PI / 4] });
      break;
    }
    case 'rich': {
      // suit: white shirt front, lapels, tie, pocket square, gold buttons
      t.box(0xf2f2f2, 0.075, 0.36, 0.01, { p: [0, 1.27, fz(1.27) + 0.002] });
      for (const s of [-1, 1]) t.box(shade(shirt, 1.25), 0.045, 0.27, 0.014, { p: [s * 0.058, 1.285, fz(1.285) + 0.006], r: [0, 0, s * 0.3] });
      t.box(accent, 0.034, 0.26, 0.012, { p: [0, 1.2, fz(1.2) + 0.012] });
      t.ball(accent, 0.022, { p: [0, 1.385, fz(1.385) + 0.012], s: [1, 0.8, 0.7] });
      t.box(0xffffff, 0.045, 0.028, 0.01, { p: [0.095, 1.33, fz(1.33) + 0.005] });
      buttons(0xd9b34a, [1.06, 1.13], 0.0);
      break;
    }
    case 'cowboy': {
      // leather vest, bandana, star badge, big buckle
      t.lathe(accent, slice(0.14, 0.5, 1.05), { p: [0, HIP, 0], s: [tx, 1, tz] });
      t.torus(0xb83a32, 0.08, 0.024, { p: [0, 1.49, 0], r: [PI / 2, 0, 0] });
      t.box(0xb83a32, 0.09, 0.09, 0.02, { p: [0, 1.44, 0.1], r: [0, 0, PI / 4] });
      t.ball(0xd9b34a, 0.016, { p: [0.085, 1.3, fz(1.3) + 0.012], s: [1, 1, 0.5] });
      break;
    }
    case 'soldier': {
      // tactical vest with pouches, shoulder radio, dog tags, backpack, camo patches
      t.lathe(accent, slice(0.1, 0.52, 1.07), { p: [0, HIP, 0], s: [tx, 1, tz] });
      for (const s of [-1, 0, 1]) t.box(shade(accent, 0.7), 0.065, 0.085, 0.045, { p: [s * 0.085, 1.1, fz(1.1) + 0.03] });
      t.box(0x222226, 0.03, 0.08, 0.03, { p: [-0.17 * bulk, 1.45, 0.02] });
      t.box(0x9a9a9a, 0.026, 0.04, 0.008, { p: [0, 1.4, fz(1.4) + 0.006] });
      t.box(shade(accent, 0.8), 0.27, 0.34, 0.15, { p: [0, 1.22, -(profR(0.32) * tz + 0.07)] });
      t.box(0x2a2a22, 0.02, 0.34, 0.01, { p: [-0.07, 1.25, fz(1.25) + 0.006] }); // strap
      for (let i = 0; i < 9; i++) {
        const a = rnd(0, PI * 2), y = rnd(1.0, 1.42), r = profR(y - HIP) * 1.0;
        t.ball(i % 2 ? 0x3d4a28 : 0x6f7d48, 0.03, { p: [Math.sin(a) * r * tx, y, Math.cos(a) * r * tz], s: [1, 0.9, 0.5] });
      }
      collar(shade(shirt, 0.8));
      break;
    }
    case 'superman': {
      // sculpted chest, emblem, belt, collar clasps
      for (const s of [-1, 1]) t.ball(shade(shirt, 1.12), 0.075, { p: [s * 0.065, 1.32, fz(1.32) - 0.006], s: [1, 0.8, 0.6] });
      t.box(0xf2c500, 0.115, 0.115, 0.012, { p: [0, 1.3, fz(1.3) + 0.012], r: [0, 0, PI / 4] });
      t.box(0xc22d2d, 0.088, 0.088, 0.014, { p: [0, 1.3, fz(1.3) + 0.013], r: [0, 0, PI / 4] });
      t.box(0xf2c500, 0.05, 0.012, 0.016, { p: [0, 1.335, fz(1.3) + 0.014] }); // the S
      t.box(0xf2c500, 0.05, 0.012, 0.016, { p: [0, 1.3, fz(1.3) + 0.014], r: [0, 0, 0.5] });
      t.box(0xf2c500, 0.05, 0.012, 0.016, { p: [0, 1.265, fz(1.3) + 0.014] });
      t.cyl(0xf2c500, 0.158, 0.158, 0.045, { p: [0, 1.0, 0], s: [tx, 1, tz] }, 14);
      t.box(0xf2c500, 0.06, 0.04, 0.012, { p: [0, 1.0, fz(1.0) + 0.012] });
      for (const s of [-1, 1]) t.ball(0xf2c500, 0.016, { p: [s * 0.075, 1.5, 0.09] });
      break;
    }
    case 'criminal': {
      // classic striped convict shirt, loot sack over the shoulder
      for (let y = 1.03; y < 1.47; y += 0.075) t.torus(accent, profR(y - HIP) * 1.0, 0.014, { p: [0, y, 0], r: [PI / 2, 0, 0], s: [tx, tz, 1] });
      collar(shade(shirt, 1.6), 0.08, 0.018);
      t.ball(0x8a7350, 0.11, { p: [-0.13 * bulk, 1.18, -0.2], s: [1, 1.3, 0.8] }); // sack
      t.ball(0x6e5a3c, 0.04, { p: [-0.13 * bulk, 1.34, -0.2] });
      break;
    }
    case 'ninja': {
      // crossed gi, red sash, katana on the back
      for (const s of [-1, 1]) t.box(0x3a3a42, 0.032, 0.3, 0.008, { p: [s * 0.045, 1.33, fz(1.33) + 0.004], r: [0, 0, s * -0.5] });
      t.cyl(0xc42b2b, 0.158, 0.158, 0.075, { p: [0, 1.0, 0], s: [tx, 1, tz] }, 14);
      t.box(0xc42b2b, 0.05, 0.05, 0.03, { p: [0.1, 1.0, fz(1.0) + 0.012] });
      t.box(0xc42b2b, 0.03, 0.2, 0.012, { p: [0.12, 0.88, fz(1.0) + 0.012], r: [0, 0, 0.1] });
      const a = 0.75, cy = 1.2, cz = -(profR(0.3) * tz + 0.05);
      const dir: [number, number] = [-Math.sin(a), Math.cos(a)];
      t.box(0x2b1a12, 0.034, 0.85, 0.034, { p: [0, cy, cz], r: [0, 0, a] });
      t.box(0x1a1a1c, 0.038, 0.18, 0.038, { p: [dir[0] * 0.51, cy + dir[1] * 0.51, cz], r: [0, 0, a] }); // handle
      t.box(0xb8a050, 0.075, 0.016, 0.075, { p: [dir[0] * 0.43, cy + dir[1] * 0.43, cz], r: [0, 0, a] }); // guard
      collar(0x2a2a30);
      break;
    }
  }
  // shirt buttons for the button-up outfits
  if (id === 'builder' || id === 'cowboy') buttons(shade(shirt, 0.6), [1.1, 1.2, 1.3, 1.4]);
  // bolder silhouettes: big shapes that read from far away
  const bz = (y: number) => -fz(y); // torso back surface
  switch (id) {
    case 'winter':
      for (const y of [1.14, 1.26, 1.38]) t.torus(shade(shirt, 1.08), profR(y - HIP) * 1.1, 0.026, { p: [0, y, 0], r: [PI / 2, 0, 0], s: [tx, tz, 1] }); // puffer rings
      t.torus(0xb8322a, 0.095, 0.03, { p: [0, 1.47, 0], r: [PI / 2, 0, 0] }); // thick scarf
      t.box(0xb8322a, 0.07, 0.3, 0.025, { p: [0.05, 1.3, fz(1.3) + 0.025], r: [0, 0, 0.06] }); // scarf tails
      t.box(0x9a2a24, 0.065, 0.24, 0.025, { p: [-0.02, 1.34, fz(1.34) + 0.035], r: [0, 0, -0.05] });
      break;
    case 'sporty':
      t.torus(0xf2d13a, 0.092, 0.024, { p: [0, 1.47, 0], r: [PI / 2, 0, 0] }); // towel around the neck
      for (const s of [-1, 1]) t.box(0xf2d13a, 0.05, 0.2, 0.02, { p: [s * 0.03, 1.36, fz(1.36) + 0.022] });
      break;
    case 'rich':
      for (const s of [-1, 1]) t.box(shade(shirt, 0.95), 0.1, 0.42, 0.018, { p: [s * 0.055, 0.72, bz(1.1) - 0.01], r: [0.08, 0, s * 0.05] }); // coat tails
      break;
    case 'cowboy': {
      t.lathe(shade(accent, 0.8), [[0.19, 1.47 - HIP], [0.27, 1.34 - HIP], [0.31, 1.22 - HIP], [0.285, 1.2 - HIP], [0.19, 1.4 - HIP]], { p: [0, HIP, 0], s: [1.05 * bulk, 1, 0.95 * bulk] }); // short poncho
      for (let i = 0; i < 5; i++) t.box(0xd9b34a, 0.012, 0.03, 0.012, { p: [-0.1 + i * 0.05, 1.08 + i * 0.045, fz(1.1) + 0.03], r: [0, 0, 0.7] }); // bandolier rounds
      t.box(0x3a2410, 0.06, 0.09, 0.05, { p: [-0.17 * bulk, 0.93, 0.03] }); // holster
      break;
    }
    case 'soldier':
      t.box(0x3a4a24, 0.3, 0.42, 0.16, { p: [0, 1.2, bz(1.2) - 0.08] }); // backpack
      t.box(0x2c3a1a, 0.26, 0.1, 0.17, { p: [0, 1.43, bz(1.2) - 0.08] }); // bedroll
      t.box(0x2a2a22, 0.05, 0.4, 0.02, { p: [0.12, 1.5, fz(1.5)] }); // antenna base
      t.cyl(0x222222, 0.006, 0.006, 0.4, { p: [0.12, 1.75, bz(1.2) - 0.1] }, 4); // radio antenna
      break;
    case 'ninja':
      t.box(0x2a2a30, 0.034, 0.95, 0.034, { p: [0.04, 1.35, bz(1.3) - 0.05], r: [0, 0, 0.55] }); // katana on the back
      t.box(0xb8a050, 0.07, 0.014, 0.07, { p: [-0.14, 1.78, bz(1.3) - 0.05], r: [0, 0, 0.55] }); // guard
      break;
    case 'criminal':
      t.torus(0xc8c8c8, 0.09, 0.012, { p: [0, 1.44, 0.01], r: [PI / 2, 0, 0] }); // chain
      break;
    case 'builder':
      t.box(0xd4872a, 0.1, 0.06, 0.06, { p: [-0.17 * bulk, 0.93, 0.05] }); // tape measure
      t.box(0x2a6ab0, 0.3, 0.1, 0.1, { p: [0, 1.02, bz(1.0) - 0.05] }); // back pocket / spirit level
      break;
  }
  root.add(mk(t, false, (y) => 0.84 + 0.2 * THREE.MathUtils.smoothstep(y, 0.95, 1.5)));

  // ================= head (pivot at the neck) =================
  const h = new MeshBuilder(true);
  const masked = id === 'ninja';
  h.cyl(skin, 0.05, 0.056, 0.12, { p: [0, -0.005, 0] }); // neck
  h.ball(skin, 0.116, { p: [0, 0.15, 0], s: [0.92, 1.1, 1.0] }); // skull
  h.ball(skin, 0.074, { p: [0, 0.083, 0.03], s: [1.05, 0.8, 0.95] }); // jaw / chin
  if (!masked) h.cone(shade(skin, 0.94), 0.02, 0.05, { p: [0, 0.133, 0.116], r: [PI / 2, 0, 0] }, 4); // nose
  const lid = look.lid ?? 0;
  for (const s of [-1, 1]) {
    h.ball(skin, 0.024, { p: [s * 0.107, 0.15, 0], s: [0.5, 1, 0.7] }); // ears
    h.ball(0xffffff, 0.026, { p: [s * 0.042, 0.168, 0.098], s: [1, 1 - lid * 0.5, 0.5] }); // eye white (big, reads from afar)
    h.ball(eyeColor, 0.016, { p: [s * 0.042, 0.166 - lid * 0.006, 0.108], s: [1, 1 - lid * 0.35, 0.45] }); // iris
    h.ball(0x101010, 0.0085, { p: [s * 0.042, 0.166 - lid * 0.006, 0.112], s: [1, 1, 0.45] }); // pupil
    if (lid > 0) h.box(shade(skin, 0.88), 0.058, 0.026 * lid * 2, 0.03, { p: [s * 0.042, 0.19 - lid * 0.012, 0.1] }); // heavy eyelid
  }

  // hair
  if (look.hair === 'short' || look.hair === 'curl' || look.hair === 'slick') {
    h.dome(hair, 0.118, { p: [0, 0.152, -0.004], r: [-0.3, 0, 0], s: [0.93, 1.14, 1.05] }, 1.3);
    for (const s of [-1, 1]) h.box(hair, 0.012, 0.05, 0.02, { p: [s * 0.097, 0.14, 0.05] });
  }
  if (look.hair === 'slick') h.ball(hair, 0.1, { p: [0, 0.14, -0.06], s: [0.9, 1, 0.9] });
  if (look.hair === 'curl') {
    h.torus(hair, 0.026, 0.01, { p: [0.03, 0.218, 0.105], r: [0.5, 0, 0] });
    h.ball(hair, 0.034, { p: [0, 0.232, 0.085], s: [1.4, 0.9, 1] });
  }
  if (look.mustache) {
    const mc = id === 'chef' ? shade(hair, 1.1) : hair;
    for (const s of [-1, 1]) h.ball(mc, 0.022, { p: [s * 0.022, 0.112, 0.109], s: [1.5, 0.55, 0.6], r: [0, 0, -s * 0.25] });
    if (id === 'rich') for (const s of [-1, 1]) h.ball(mc, 0.007, { p: [s * 0.055, 0.125, 0.104] }); // waxed tips
  }
  if (id === 'rich') {
    // monocle with chain
    h.torus(0xd9b34a, 0.03, 0.0035, { p: [0.04, 0.17, 0.112] });
    h.cyl(0xd9b34a, 0.0015, 0.0015, 0.14, { p: [0.07, 0.1, 0.11], r: [0, 0, 0.35] }, 4);
  }

  // hats and headgear
  switch (id) {
    case 'winter':
      h.dome(0x33336a, 0.126, { p: [0, 0.185, 0], s: [1, 1.12, 1.06] }, 1.5);
      h.cyl(0x2a2a58, 0.127, 0.127, 0.045, { p: [0, 0.2, 0] });
      h.ball(0xf0f0f0, 0.042, { p: [0, 0.325, 0] });
      for (const a of [0, 1, 2, 3, 4, 5]) h.box(0x2a2a58, 0.008, 0.07, 0.01, { p: [Math.sin((a / 6) * PI * 2) * 0.12, 0.26, Math.cos((a / 6) * PI * 2) * 0.12], r: [0, (a / 6) * PI * 2, 0] });
      break;
    case 'builder':
      h.dome(0xf2d13a, 0.14, { p: [0, 0.19, 0], s: [1, 1, 1.08] }, 1.5);
      h.box(0xf2d13a, 0.2, 0.014, 0.09, { p: [0, 0.19, 0.115] });
      h.box(0xf2d13a, 0.18, 0.014, 0.06, { p: [0, 0.19, -0.11] });
      h.box(0xe3be22, 0.026, 0.02, 0.26, { p: [0, 0.325, 0] });
      break;
    case 'sporty':
      h.dome(shirt, 0.125, { p: [0, 0.195, 0], s: [0.99, 0.95, 1.04] }, 1.3);
      h.box(shirt, 0.15, 0.01, 0.1, { p: [0, 0.225, 0.135], r: [0.12, 0, 0] });
      h.box(shade(shirt, 0.6), 0.14, 0.006, 0.09, { p: [0, 0.219, 0.135], r: [0.12, 0, 0] });
      h.ball(shade(shirt, 0.7), 0.012, { p: [0, 0.312, 0] });
      h.ball(0xffffff, 0.013, { p: [0, 0.225, 0.124], s: [1, 1, 0.4] });
      break;
    case 'chef':
      h.cyl(0xffffff, 0.12, 0.12, 0.06, { p: [0, 0.24, 0] });
      h.cyl(0xffffff, 0.15, 0.118, 0.2, { p: [0, 0.37, 0] });
      h.ball(0xffffff, 0.15, { p: [0, 0.47, 0], s: [1, 0.55, 1] });
      for (const a of [0, 1, 2, 3, 4]) h.box(0xe8e8e8, 0.008, 0.18, 0.008, { p: [Math.sin((a / 5) * PI * 2) * 0.13, 0.37, Math.cos((a / 5) * PI * 2) * 0.13] });
      break;
    case 'rich':
      h.cyl(0x141414, 0.2, 0.2, 0.014, { p: [0, 0.232, 0] }, 14);
      h.cyl(0x141414, 0.118, 0.124, 0.26, { p: [0, 0.362, 0] }, 14);
      h.cyl(accent, 0.126, 0.126, 0.05, { p: [0, 0.262, 0] }, 14);
      break;
    case 'cowboy':
      h.lathe(0x7a4e28, [[0.001, 0.115], [0.095, 0.115], [0.108, 0.095], [0.12, 0.03], [0.13, 0.0], [0.22, -0.005], [0.275, 0.03], [0.285, 0.048], [0.272, 0.038], [0.2, 0.008], [0.125, 0.002], [0.001, 0.002]], { p: [0, 0.2, 0], s: [1, 1, 1.05] }, 14);
      h.cyl(0x2a1a0c, 0.123, 0.126, 0.03, { p: [0, 0.213, 0] }, 14);
      break;
    case 'soldier': {
      const hc = 0x4b5a32;
      h.dome(hc, 0.145, { p: [0, 0.18, 0], s: [1, 1, 1.1] }, 1.75);
      h.box(0x222222, 0.15, 0.045, 0.03, { p: [0, 0.245, 0.145] }); // goggles
      for (const s of [-1, 1]) {
        h.box(0x6aa6c8, 0.06, 0.03, 0.012, { p: [s * 0.04, 0.245, 0.162] });
        h.box(0x333333, 0.012, 0.11, 0.012, { p: [s * 0.1, 0.085, 0.05] }); // chin strap
        h.box(0x1a2a14, 0.03, 0.012, 0.012, { p: [s * 0.055, 0.125, 0.105], r: [0, 0, s * 0.4] }); // face paint
      }
      for (let i = 0; i < 7; i++) {
        const a = rnd(0, PI * 2), el = rnd(0.2, 1.2);
        h.ball(i % 2 ? 0x2f3b1d : 0x7d8b52, 0.026, { p: [Math.sin(a) * 0.14 * Math.cos(el), 0.18 + 0.14 * Math.sin(el), Math.cos(a) * 0.15 * Math.cos(el)], s: [1, 0.9, 0.5] });
      }
      break;
    }
    case 'criminal':
      h.dome(0x1a1a1e, 0.126, { p: [0, 0.185, 0], s: [1, 1.1, 1.06] }, 1.5); // dark beanie
      h.cyl(0x232328, 0.127, 0.127, 0.05, { p: [0, 0.2, 0] });
      h.box(0x101012, 0.19, 0.036, 0.012, { p: [0, 0.17, 0.095] }); // bandit mask band (eyes poke through)
      h.ball(0x17171a, 0.05, { p: [0, 0.095, 0.075], s: [1.5, 0.9, 1.1] }); // stubble shadow on the jaw
      break;
    case 'ninja':
      h.dome(0x17171a, 0.127, { p: [0, 0.15, -0.006], r: [-0.12, 0, 0], s: [0.97, 1.13, 1.08] }, 1.3);
      h.ball(0x17171a, 0.12, { p: [0, 0.1, -0.04], s: [0.95, 1.1, 0.9] }); // hood back
      h.ball(0x17171a, 0.078, { p: [0, 0.085, 0.05], s: [1.3, 0.95, 1.0] }); // face mask
      h.torus(accent, 0.121, 0.014, { p: [0, 0.205, 0], r: [PI / 2, 0, 0], s: [0.9, 1.05, 1] });
      h.box(accent, 0.03, 0.15, 0.012, { p: [0.03, 0.19, -0.135], r: [0.3, 0, 0.1] });
      h.box(accent, 0.03, 0.17, 0.012, { p: [-0.03, 0.18, -0.14], r: [0.4, 0, -0.1] });
      break;
  }
  // brows + mouth are separate little meshes (one per expression) so they can change with the mood
  const browC = masked ? 0x101010 : id === 'criminal' || id === 'soldier' ? shade(hair, 0.8) : shade(hair, 0.85);
  const face = (e: Expression) => {
    const f = new MeshBuilder(true);
    const tilt = e === 'scared' ? -0.35 : e === 'angry' ? 0.5 : e === 'pain' ? -0.15 : look.brow;
    const lift = e === 'scared' ? 0.016 : e === 'pain' ? -0.006 : e === 'angry' ? -0.008 : 0;
    for (const s of [-1, 1]) f.box(browC, 0.056, 0.014, 0.014, { p: [s * 0.042, 0.208 + lift, 0.1], r: [0, 0, s * tilt] });
    if (!masked) {
      const my = 0.095, mz = 0.108;
      if (e === 'scared') {
        f.box(0x3a1010, 0.044, 0.05, 0.014, { p: [0, my - 0.012, mz] });
        f.box(0xffffff, 0.03, 0.009, 0.016, { p: [0, my + 0.008, mz + 0.001] });
      } else if (e === 'pain') {
        f.box(0x3a1010, 0.056, 0.022, 0.014, { p: [0, my - 0.004, mz], r: [0, 0, 0.18] });
        f.box(0xffffff, 0.04, 0.007, 0.016, { p: [0, my + 0.004, mz + 0.001], r: [0, 0, 0.18] });
      } else if (e === 'angry') {
        f.box(0x3a1010, 0.056, 0.024, 0.014, { p: [0, my - 0.002, mz] });
        f.box(0xffffff, 0.05, 0.01, 0.016, { p: [0, my + 0.002, mz + 0.001] });
      } else {
        const sm = look.smile;
        const mc = 0x7a3b30;
        f.box(mc, 0.03, 0.009, 0.012, { p: [0, my - sm * 0.003, mz] });
        for (const s of [-1, 1]) f.box(mc, 0.024, 0.009, 0.012, { p: [s * 0.024, my + sm * 0.008, mz - 0.002], r: [0, 0, s * sm * 0.5] });
        if (sm > 0.8) f.box(0xffffff, 0.036, 0.008, 0.013, { p: [0, my + 0.0, mz + 0.001] }); // toothy grin
      }
    }
    const g = f.build();
    geos.push(g);
    const m = new THREE.Mesh(g, material);
    m.visible = e === 'neutral';
    return m;
  };
  const faces: Record<Expression, THREE.Mesh> = { neutral: face('neutral'), scared: face('scared'), angry: face('angry'), pain: face('pain') };
  let curExpr: Expression = 'neutral';
  const setExpression = (e: Expression) => {
    if (e === curExpr) return;
    faces[curExpr].visible = false;
    faces[e].visible = true;
    curExpr = e;
  };
  const headPivot = new THREE.Group();
  headPivot.position.set(0, 1.53, 0);
  if (id === 'boss') for (const s of [-1, 1]) h.cone(0x241a2c, 0.034, 0.22, { p: [s * 0.075, 0.3, -0.01], r: [0, 0, -s * 0.45] }, 6); // horns
  headPivot.add(mk(h, true, (y) => 0.8 + 0.28 * THREE.MathUtils.smoothstep(y, 0.0, 0.3)));
  for (const f of Object.values(faces)) headPivot.add(f);
  headPivot.scale.setScalar(1.14); // bigger head: toy-like proportions that read from far away
  root.add(headPivot);

  // ================= arms (pivot at the shoulder) =================
  const arms: THREE.Group[] = [];
  const aw = bulk * (1 + (mu - 1) * 0.9) * bw;
  for (const s of [-1, 1]) {
    const a = new MeshBuilder(true);
    const long = look.sleeves === 'long';
    const sleeve = id === 'superman' ? shirt : shirt;
    if (long) {
      a.cyl(sleeve, 0.058 * aw, 0.048 * aw, 0.3, { p: [0, -0.15, 0] });
      a.ball(sleeve, 0.05 * aw, { p: [0, -0.31, 0] });
      a.cyl(sleeve, 0.048 * aw, 0.039 * aw, 0.28, { p: [0, -0.45, 0] });
      a.cyl(look.cuff ?? shade(sleeve, 0.8), 0.04 * aw, 0.042 * aw, 0.03, { p: [0, -0.585, 0] });
    } else {
      a.cyl(sleeve, 0.06 * aw, 0.056 * aw, 0.17, { p: [0, -0.085, 0] });
      a.cyl(skin, 0.05 * aw, 0.046 * aw, 0.15, { p: [0, -0.245, 0] });
      a.ball(skin, 0.047 * aw, { p: [0, -0.31, 0] });
      a.cyl(skin, 0.045 * aw, 0.036 * aw, 0.27, { p: [0, -0.45, 0] });
    }
    if (id === 'sporty') a.cyl(0xffffff, 0.043, 0.043, 0.05, { p: [0, -0.55, 0] }); // wristband
    if (id === 'ninja') for (const y of [-0.5, -0.54]) a.cyl(0x55555c, 0.043, 0.043, 0.02, { p: [0, y, 0] });
    if (id === 'winter') a.ball(0x2a2a30, 0.056, { p: [0, -0.64, 0.005], s: [1, 1.15, 0.9] }); // mittens
    else if (look.glove) {
      a.ball(look.glove, 0.042, { p: [0, -0.625, 0], s: [0.95, 1.3, 0.75] });
      a.ball(look.glove, 0.015, { p: [-s * 0.034, -0.6, 0.014] });
    } else {
      a.ball(skin, 0.04, { p: [0, -0.625, 0], s: [0.9, 1.3, 0.7] }); // hand
      a.ball(skin, 0.014, { p: [-s * 0.033, -0.6, 0.014] }); // thumb
      for (const f of [-1.5, -0.5, 0.5, 1.5]) a.ball(skin, 0.009, { p: [f * 0.0135, -0.685, 0], s: [1, 1.8, 1] }); // fingers
    }
    // handheld props on the right hand; they point along the forearm so they aim forward when the arm is raised
    if (s === 1 && id === 'rich') {
      a.cyl(0x2a1a10, 0.011, 0.011, 0.95, { p: [0, -0.9, 0.02] }, 4); // cane
      a.ball(0xd9b34a, 0.032, { p: [0, -0.62, 0.02] }); // gold knob
    }
    if (s === 1 && id === 'criminal') {
      a.box(0x2a2a2e, 0.032, 0.1, 0.036, { p: [0, -0.63, 0] }); // handle
      a.box(0x9a9a9e, 0.05, 0.012, 0.02, { p: [0, -0.685, 0] }); // guard
      a.box(0xd6dbe0, 0.012, 0.2, 0.034, { p: [0, -0.79, 0] }); // blade
      a.cone(0xd6dbe0, 0.017, 0.04, { p: [0, -0.91, 0], r: [PI, 0, 0] }, 4); // point
    }
    if (s === 1 && id === 'ninja') {
      // drawn blade held along the forearm: black hilt, steel edge (the sheath stays on his back)
      a.box(0x1a1a1c, 0.034, 0.12, 0.034, { p: [0, -0.64, 0] }); // hilt
      a.box(0xb8a050, 0.075, 0.014, 0.075, { p: [0, -0.71, 0] }); // guard
      a.box(0xdfe4ea, 0.011, 0.5, 0.03, { p: [0, -0.97, 0] }); // blade
      a.cone(0xdfe4ea, 0.016, 0.06, { p: [0, -1.25, 0], r: [PI, 0, 0] }, 4); // point
    }
    if (s === 1 && id === 'cowboy') {
      a.box(0x5a3a1e, 0.03, 0.04, 0.062, { p: [0, -0.655, -0.02] }); // grip
      a.box(0x3a3a3e, 0.034, 0.05, 0.05, { p: [0, -0.7, 0] }); // frame
      a.cyl(0x55555a, 0.024, 0.024, 0.046, { p: [0, -0.7, 0], r: [0, 0, PI / 2] }, 8); // cylinder
      a.box(0x3a3a3e, 0.02, 0.15, 0.02, { p: [0, -0.8, 0] }); // barrel
    }
    const pivot = new THREE.Group();
    pivot.position.set(s * armX, 1.42, 0);
    pivot.rotation.z = s * 0.06;
    pivot.add(mk(a, false, (y) => 0.9 + 0.12 * THREE.MathUtils.smoothstep(y, -0.7, -0.05)));
    root.add(pivot);
    arms.push(pivot);
  }

  // ================= legs (pivot at the hip) =================
  const legs: THREE.Group[] = [];
  const lw = bulk * (1 + (mu - 1) * 0.5);
  for (const s of [-1, 1]) {
    const l = new MeshBuilder(true);
    l.cyl(pants, 0.088 * lw, 0.07 * lw, 0.44, { p: [0, -0.22, 0] });
    l.ball(pants, 0.074 * lw, { p: [0, -0.45, 0] });
    l.cyl(pants, 0.068 * lw, 0.052 * lw, 0.38, { p: [0, -0.64, 0] });
    l.cyl(shade(pants, 0.8), 0.058 * lw, 0.06 * lw, 0.03, { p: [0, -0.825, 0] });
    if (id === 'sporty') l.box(0xffffff, 0.012, 0.78, 0.05, { p: [s * 0.078 * lw, -0.43, 0] });
    if (id === 'rich') l.box(shade(pants, 1.5), 0.006, 0.7, 0.01, { p: [0, -0.43, 0.082 * lw] });
    if (id === 'builder') l.ball(0x2a2a2e, 0.06, { p: [0, -0.46, 0.045], s: [1.1, 1.1, 0.7] }); // knee pads
    if (id === 'ninja') for (const y of [-0.7, -0.75]) l.cyl(0x55555c, 0.058, 0.058, 0.022, { p: [0, y, 0] });
    if (id === 'superman') l.cyl(0xf2c500, 0.074, 0.074, 0.025, { p: [0, -0.62, 0] });
    if (id === 'soldier') {
      for (let i = 0; i < 7; i++) {
        const a = rnd(0, PI * 2), y = rnd(-0.75, -0.06), r = (0.085 - (-y / 0.8) * 0.025) * lw;
        l.ball(i % 2 ? 0x2f3b1d : 0x6f7d48, 0.034, { p: [Math.sin(a) * r, y, Math.cos(a) * r], s: [1, 1.2, 0.5], r: [0, a, 0] });
      }
    }
    addShoe(l, look, lw, id === 'sporty' ? accentFor(shirt) : 0xf5f5f5);
    const pivot = new THREE.Group();
    pivot.position.set(s * 0.1 * bulk, HIP, 0);
    pivot.add(mk(l, false, (y) => 0.8 + 0.22 * THREE.MathUtils.smoothstep(y, -0.9, -0.2)));
    root.add(pivot);
    legs.push(pivot);
  }

  // ================= cape (superman) =================
  let cape: THREE.Group | null = null;
  if (id === 'superman') {
    const cg = new THREE.PlaneGeometry(0.54, 0.95, 6, 10);
    const p = cg.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i) - 0.475; // top edge at 0, hangs to -0.95
      const d = -y;
      p.setXYZ(i, p.getX(i) * (1 + d * 0.35), y, -(0.02 + d * d * 0.1));
    }
    cg.computeVertexNormals();
    geos.push(cg);
    const capeMat = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.85, side: THREE.DoubleSide });
    materials.push(capeMat);
    const cm = new THREE.Mesh(cg, capeMat);
    cm.castShadow = true;
    cape = new THREE.Group();
    cape.position.set(0, 1.46, -(profR(0.55) * tz + 0.03));
    cape.add(cm);
    root.add(cape);
  }

  return {
    root,
    head: headPivot,
    legs,
    arms,
    cape,
    setExpression,
    hitMeshes,
    materials,
    dispose: () => {
      geos.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
    },
  };
}

const accentFor = (shirt: number) => shade(shirt, 0.7).getHex();

/** Footwear in leg-local coordinates; the sole's bottom is always at y = -0.9 (the ground). */
function addShoe(b: MeshBuilder, look: Look, w: number, trim: number) {
  const sc = look.shoeColor;
  const kind = look.shoe;
  const soleColor = kind === 'sneaker' ? 0xf2f2f2 : 0x161618;
  const soleH = kind === 'combat' ? 0.042 : kind === 'sneaker' ? 0.032 : kind === 'clog' ? 0.034 : 0.024;
  const bottom = -0.9;
  const upperY = bottom + soleH + 0.032;
  b.box(soleColor, 0.115 * w, soleH, kind === 'dress' ? 0.26 : 0.27, { p: [0, bottom + soleH / 2, 0.045] });
  b.ball(sc, 0.06 * w, { p: [0, upperY, 0.045], s: [1, 0.9, 1.9] }); // main upper
  const tall = kind === 'boot' ? 0.16 : kind === 'cowboy' ? 0.24 : kind === 'combat' ? 0.2 : kind === 'superboot' ? 0.26 : 0;
  if (tall) {
    b.cyl(sc, 0.066 * w, 0.071 * w, tall, { p: [0, bottom + soleH + tall / 2, -0.002] });
    b.box(0x151517, 0.092 * w, 0.032, 0.07, { p: [0, bottom + soleH + 0.016, -0.04] }); // heel
  }
  switch (kind) {
    case 'sneaker':
      b.ball(0xf6f6f6, 0.048 * w, { p: [0, upperY - 0.004, 0.14], s: [1, 0.72, 0.95] });
      b.box(0xdddddd, 0.052 * w, 0.006, 0.05, { p: [0, upperY + 0.05, 0.075] });
      b.box(trim, 0.006, 0.03, 0.09, { p: [0.058 * w, upperY + 0.005, 0.03] });
      b.box(trim, 0.006, 0.03, 0.09, { p: [-0.058 * w, upperY + 0.005, 0.03] });
      break;
    case 'dress':
      b.ball(shade(sc, 1.6), 0.03, { p: [0, upperY + 0.012, 0.1], s: [1.2, 0.5, 1.5] }); // polished highlight
      break;
    case 'cowboy':
      b.ball(sc, 0.045 * w, { p: [0, upperY - 0.004, 0.15], s: [0.9, 0.7, 1.3] }); // pointed toe
      b.ball(0xd9b34a, 0.014, { p: [0, bottom + soleH + 0.07, -0.08] }); // spur
      b.cone(0xd9b34a, 0.012, 0.04, { p: [0, bottom + soleH + 0.07, -0.105], r: [-PI / 2, 0, 0] }, 6);
      break;
    case 'combat':
      b.torus(0x333336, 0.07 * w, 0.006, { p: [0, bottom + soleH + 0.08, 0], r: [PI / 2, 0, 0] });
      b.torus(0x333336, 0.07 * w, 0.006, { p: [0, bottom + soleH + 0.13, 0], r: [PI / 2, 0, 0] });
      break;
    case 'superboot':
      b.cyl(0xf2c500, 0.072 * w, 0.072 * w, 0.025, { p: [0, bottom + soleH + tall - 0.012, -0.002] });
      break;
    case 'tabi':
      b.ball(sc, 0.026, { p: [-0.018, upperY - 0.006, 0.15], s: [1, 0.8, 1.2] }); // split toe
      b.ball(sc, 0.026, { p: [0.018, upperY - 0.006, 0.15], s: [1, 0.8, 1.2] });
      break;
    case 'clog':
      b.ball(sc, 0.058 * w, { p: [0, upperY, 0.1], s: [1.05, 0.85, 1.5] });
      break;
    default:
      b.ball(sc, 0.05 * w, { p: [0, upperY - 0.004, 0.135], s: [1, 0.75, 0.95] });
  }
}
