import * as THREE from 'three';
import { MeshBuilder } from '../entities/meshBuilder';
import { getWeaponEnvironment } from './models';

// Procedural first-person models for the weapons that have no imported .glb: SMG, sniper rifle, crossbow and
// grenade launcher. Barrel points to -z, y is up, the player looks at the gun's right side... from behind and
// slightly left. Each model has a 'muzzle' marker. Built with MeshBuilder (one merged, vertex-coloured mesh).

const STEEL = 0xa9afb8, DARK = 0x3c3f47, MID = 0x5a5f69, BLACK = 0x23252a, WOOD = 0x8a5a30, WOOD_D = 0x6a4524;
const OLIVE = 0x4f5a2d, BRASS = 0xc9a24a, GLASS = 0x2a8fd0, RED = 0xb8322a;

function finish(b: MeshBuilder, muzzleZ: number, muzzleY = 0.01, rough = 0.5, metal = 0.45): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: rough, metalness: metal });
  mat.envMap = getWeaponEnvironment();
  mat.envMapIntensity = 0.8;
  const m = new THREE.Mesh(b.build(), mat);
  m.castShadow = false;
  g.add(m);
  const muzzle = new THREE.Object3D();
  muzzle.name = 'muzzle';
  muzzle.position.set(0, muzzleY, muzzleZ);
  g.add(muzzle);
  return g;
}

export function buildSmg(): THREE.Group {
  const b = new MeshBuilder();
  b.box(DARK, 0.062, 0.085, 0.36, { p: [0, 0, -0.02] }); // receiver
  b.box(MID, 0.05, 0.03, 0.34, { p: [0, 0.056, -0.02] }); // top rail
  b.box(BLACK, 0.012, 0.022, 0.03, { p: [0, 0.083, -0.17] }); // front sight
  b.box(BLACK, 0.026, 0.022, 0.02, { p: [0, 0.083, 0.12] }); // rear sight
  b.cyl(STEEL, 0.017, 0.017, 0.2, { p: [0, 0.005, -0.3], r: [Math.PI / 2, 0, 0] }, 10); // barrel
  b.cyl(BLACK, 0.024, 0.024, 0.09, { p: [0, 0.005, -0.37], r: [Math.PI / 2, 0, 0] }, 10); // suppressor-style muzzle brake
  b.box(MID, 0.05, 0.05, 0.14, { p: [0, -0.012, -0.2] }); // handguard
  b.box(DARK, 0.04, 0.17, 0.06, { p: [0, -0.125, -0.04], r: [-0.12, 0, 0] }); // magazine
  b.box(BRASS, 0.034, 0.012, 0.052, { p: [0, -0.045, -0.04] }); // mag feed lips
  b.box(DARK, 0.04, 0.12, 0.06, { p: [0, -0.1, 0.1], r: [0.35, 0, 0] }); // pistol grip
  b.box(MID, 0.032, 0.036, 0.1, { p: [0, 0.0, 0.2] }); // stock arm
  b.box(DARK, 0.036, 0.075, 0.025, { p: [0, 0.0, 0.265] }); // butt plate
  b.box(BLACK, 0.012, 0.02, 0.05, { p: [0.035, 0.015, 0.0] }); // charging handle
  return finish(b, -0.42);
}

export function buildSniper(): THREE.Group {
  const b = new MeshBuilder();
  b.box(WOOD_D, 0.05, 0.08, 0.26, { p: [0, -0.01, 0.2] }); // stock
  b.box(WOOD, 0.052, 0.1, 0.07, { p: [0, -0.035, 0.34], r: [0.12, 0, 0] }); // butt
  b.box(DARK, 0.055, 0.08, 0.34, { p: [0, 0.0, -0.02] }); // receiver
  b.cyl(STEEL, 0.014, 0.017, 0.62, { p: [0, 0.012, -0.5], r: [Math.PI / 2, 0, 0] }, 10); // long barrel
  b.cyl(DARK, 0.024, 0.024, 0.07, { p: [0, 0.012, -0.83], r: [Math.PI / 2, 0, 0] }, 10); // muzzle brake
  b.box(WOOD, 0.052, 0.045, 0.24, { p: [0, -0.04, -0.28] }); // fore-end
  // scope: tube, bell ends, lenses, mounts
  b.cyl(DARK, 0.026, 0.026, 0.3, { p: [0, 0.088, -0.04], r: [Math.PI / 2, 0, 0] }, 12);
  b.cyl(BLACK, 0.036, 0.026, 0.07, { p: [0, 0.088, -0.21], r: [Math.PI / 2, 0, 0] }, 12);
  b.cyl(BLACK, 0.026, 0.036, 0.07, { p: [0, 0.088, 0.13], r: [Math.PI / 2, 0, 0] }, 12);
  b.cyl(GLASS, 0.03, 0.03, 0.006, { p: [0, 0.088, -0.247], r: [Math.PI / 2, 0, 0] }, 12);
  b.cyl(GLASS, 0.03, 0.03, 0.006, { p: [0, 0.088, 0.167], r: [Math.PI / 2, 0, 0] }, 12);
  b.box(MID, 0.02, 0.04, 0.03, { p: [0, 0.055, -0.12] });
  b.box(MID, 0.02, 0.04, 0.03, { p: [0, 0.055, 0.04] });
  b.cyl(MID, 0.012, 0.012, 0.03, { p: [0.035, 0.088, -0.04], r: [0, 0, Math.PI / 2] }, 8); // turret knob
  // bolt: handle sticking out on the right
  b.cyl(STEEL, 0.008, 0.008, 0.06, { p: [0.045, 0.02, 0.06], r: [0, 0, Math.PI / 2] }, 6);
  b.ball(STEEL, 0.017, { p: [0.078, 0.02, 0.06] });
  b.box(DARK, 0.035, 0.1, 0.06, { p: [0, -0.1, 0.12], r: [0.25, 0, 0] }); // grip
  b.box(DARK, 0.042, 0.06, 0.1, { p: [0, -0.07, -0.02] }); // magazine
  return finish(b, -0.87, 0.012);
}

export function buildCrossbow(): THREE.Group {
  const b = new MeshBuilder();
  b.box(WOOD, 0.05, 0.06, 0.5, { p: [0, 0, -0.02] }); // stock
  b.box(WOOD_D, 0.052, 0.09, 0.07, { p: [0, -0.015, 0.26], r: [0.1, 0, 0] }); // butt
  b.box(DARK, 0.03, 0.03, 0.46, { p: [0, 0.05, -0.12] }); // flight rail
  b.box(STEEL, 0.012, 0.02, 0.4, { p: [0, 0.07, -0.12] }); // rail edge
  // prod (the bow arms): a curved bar made of segments
  for (let i = -3; i <= 3; i++) {
    const x = i * 0.062;
    const z = -0.34 + Math.abs(i) * 0.03 + Math.abs(i) * Math.abs(i) * 0.004;
    b.box(DARK, 0.07, 0.034, 0.03, { p: [x, 0.055, z], r: [0, -i * 0.12, 0] });
  }
  b.box(STEEL, 0.05, 0.05, 0.05, { p: [0, 0.05, -0.31] });
  // string: two thin bars from the arm tips back to the latch
  b.box(0xe8e2d0, 0.004, 0.004, 0.2, { p: [0.105, 0.055, -0.22], r: [0, 0.54, 0] });
  b.box(0xe8e2d0, 0.004, 0.004, 0.2, { p: [-0.105, 0.055, -0.22], r: [0, -0.54, 0] });
  // loaded bolt
  b.cyl(WOOD_D, 0.006, 0.006, 0.5, { p: [0, 0.077, -0.15], r: [Math.PI / 2, 0, 0] }, 6);
  b.cone(STEEL, 0.014, 0.05, { p: [0, 0.077, -0.42], r: [-Math.PI / 2, 0, 0] }, 5);
  b.box(RED, 0.03, 0.002, 0.04, { p: [0, 0.077, 0.1] });
  b.box(DARK, 0.034, 0.1, 0.06, { p: [0, -0.07, 0.1], r: [0.2, 0, 0] }); // grip
  // sight: tiny post
  b.box(BLACK, 0.01, 0.025, 0.01, { p: [0, 0.1, -0.3] });
  return finish(b, -0.45, 0.078, 0.7, 0.2);
}

export function buildLauncher(): THREE.Group {
  const b = new MeshBuilder();
  b.cyl(MID, 0.045, 0.045, 0.46, { p: [0, 0.0, -0.22], r: [Math.PI / 2, 0, 0] }, 14); // fat barrel
  b.cyl(DARK, 0.052, 0.052, 0.05, { p: [0, 0.0, -0.46], r: [Math.PI / 2, 0, 0] }, 14); // muzzle ring
  b.box(DARK, 0.075, 0.1, 0.28, { p: [0, -0.005, 0.1] }); // receiver
  b.cyl(OLIVE, 0.062, 0.062, 0.08, { p: [0, -0.02, -0.03], r: [Math.PI / 2, 0, 0] }, 12); // revolving drum
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    b.cyl(BRASS, 0.017, 0.017, 0.082, { p: [Math.cos(a) * 0.04, -0.02 + Math.sin(a) * 0.04, -0.03], r: [Math.PI / 2, 0, 0] }, 8); // chambers
  }
  b.box(WOOD_D, 0.05, 0.06, 0.12, { p: [0, -0.025, 0.28] }); // stock
  b.box(WOOD, 0.052, 0.085, 0.05, { p: [0, -0.04, 0.35], r: [0.12, 0, 0] });
  b.box(WOOD_D, 0.056, 0.04, 0.2, { p: [0, -0.07, -0.2] }); // fore grip
  b.box(DARK, 0.036, 0.1, 0.06, { p: [0, -0.1, 0.16], r: [0.3, 0, 0] }); // grip
  // flip-up ladder sight
  b.box(MID, 0.01, 0.07, 0.014, { p: [0.03, 0.08, -0.07] });
  b.box(MID, 0.05, 0.01, 0.014, { p: [0.03, 0.115, -0.07] });
  b.box(RED, 0.02, 0.02, 0.02, { p: [0, 0.05, -0.43] }); // front sight
  return finish(b, -0.5, 0.0, 0.55, 0.35);
}

// ---- quest rewards ----

export function buildRevolver(): THREE.Group {
  const b = new MeshBuilder();
  const NICKEL = 0xc4cad2;
  b.cyl(NICKEL, 0.016, 0.016, 0.2, { p: [0, 0.012, -0.17], r: [Math.PI / 2, 0, 0] }, 10); // barrel
  b.box(NICKEL, 0.018, 0.016, 0.19, { p: [0, -0.008, -0.165] }); // ejector rod housing
  b.box(BLACK, 0.008, 0.02, 0.012, { p: [0, 0.032, -0.26] }); // front sight blade
  b.cyl(MID, 0.034, 0.034, 0.058, { p: [0, 0.004, -0.04], r: [Math.PI / 2, 0, 0] }, 6); // cylinder (six flutes)
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    b.cyl(BRASS, 0.008, 0.008, 0.06, { p: [Math.cos(a) * 0.022, 0.004 + Math.sin(a) * 0.022, -0.04], r: [Math.PI / 2, 0, 0] }, 6); // cartridge rims
  }
  b.box(NICKEL, 0.03, 0.07, 0.11, { p: [0, 0.0, 0.03] }); // frame
  b.box(NICKEL, 0.026, 0.02, 0.08, { p: [0, 0.035, -0.02] }); // top strap
  b.box(DARK, 0.012, 0.03, 0.03, { p: [0, 0.04, 0.085], r: [-0.6, 0, 0] }); // hammer spur
  b.box(WOOD, 0.034, 0.12, 0.05, { p: [0, -0.075, 0.1], r: [0.45, 0, 0] }); // grip
  b.box(WOOD_D, 0.036, 0.02, 0.05, { p: [0, -0.125, 0.125], r: [0.45, 0, 0] }); // grip butt
  b.box(DARK, 0.006, 0.03, 0.03, { p: [0, -0.045, 0.03] }); // trigger
  return finish(b, -0.28, 0.012, 0.3, 0.75);
}

export function buildDmr(): THREE.Group {
  const b = new MeshBuilder();
  const TAN = 0xa48c5c;
  b.box(DARK, 0.056, 0.075, 0.3, { p: [0, 0, -0.02] }); // receiver
  b.box(TAN, 0.06, 0.06, 0.26, { p: [0, -0.005, -0.3] }); // handguard
  b.cyl(STEEL, 0.013, 0.015, 0.36, { p: [0, 0.008, -0.55], r: [Math.PI / 2, 0, 0] }, 10); // barrel
  b.cyl(DARK, 0.02, 0.02, 0.05, { p: [0, 0.008, -0.74], r: [Math.PI / 2, 0, 0] }, 10); // flash hider
  // short magnified optic (aims without a full-screen scope)
  b.cyl(DARK, 0.022, 0.022, 0.18, { p: [0, 0.075, -0.03], r: [Math.PI / 2, 0, 0] }, 12);
  b.cyl(BLACK, 0.028, 0.022, 0.04, { p: [0, 0.075, -0.13], r: [Math.PI / 2, 0, 0] }, 12);
  b.cyl(GLASS, 0.024, 0.024, 0.005, { p: [0, 0.075, -0.152], r: [Math.PI / 2, 0, 0] }, 12);
  b.box(MID, 0.018, 0.03, 0.025, { p: [0, 0.048, -0.08] });
  b.box(MID, 0.018, 0.03, 0.025, { p: [0, 0.048, 0.03] });
  b.box(DARK, 0.04, 0.12, 0.05, { p: [0, -0.1, -0.06], r: [-0.1, 0, 0] }); // magazine
  b.box(DARK, 0.036, 0.1, 0.055, { p: [0, -0.085, 0.09], r: [0.3, 0, 0] }); // pistol grip
  b.box(TAN, 0.05, 0.07, 0.2, { p: [0, -0.01, 0.23] }); // stock
  b.box(TAN, 0.052, 0.04, 0.12, { p: [0, 0.035, 0.24] }); // cheek rest
  b.box(BLACK, 0.054, 0.09, 0.02, { p: [0, -0.015, 0.34] }); // butt pad
  return finish(b, -0.77, 0.008);
}

export function buildMinigun(): THREE.Group {
  const b = new MeshBuilder();
  b.box(DARK, 0.11, 0.11, 0.26, { p: [0, -0.01, 0.06] }); // motor housing
  b.cyl(MID, 0.055, 0.055, 0.04, { p: [0, 0, -0.1], r: [Math.PI / 2, 0, 0] }, 14); // front bearing
  b.box(OLIVE, 0.09, 0.11, 0.12, { p: [-0.1, -0.06, 0.06] }); // ammo box
  for (let i = 0; i < 5; i++) b.box(BRASS, 0.012, 0.03, 0.018, { p: [-0.05, -0.0 + i * 0.012, 0.0 + i * 0.02], r: [0, 0, 0.4] }); // belt
  b.box(DARK, 0.04, 0.1, 0.06, { p: [0, -0.1, 0.12], r: [0.3, 0, 0] }); // rear grip
  b.box(MID, 0.03, 0.03, 0.12, { p: [0, 0.08, 0.04] }); // carry handle
  b.box(MID, 0.02, 0.04, 0.02, { p: [0, 0.06, -0.01] });
  b.box(MID, 0.02, 0.04, 0.02, { p: [0, 0.06, 0.09] });
  const g = finish(b, -0.62, 0, 0.5, 0.5);
  // the barrel cluster is a separate mesh that spins (main.ts turns it while the minigun spins up)
  const c = new MeshBuilder();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    c.cyl(STEEL, 0.011, 0.011, 0.5, { p: [Math.cos(a) * 0.03, Math.sin(a) * 0.03, -0.35], r: [Math.PI / 2, 0, 0] }, 8);
  }
  c.cyl(DARK, 0.048, 0.048, 0.025, { p: [0, 0, -0.2], r: [Math.PI / 2, 0, 0] }, 12); // clamps
  c.cyl(DARK, 0.048, 0.048, 0.025, { p: [0, 0, -0.55], r: [Math.PI / 2, 0, 0] }, 12);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.6 });
  mat.envMap = getWeaponEnvironment();
  mat.envMapIntensity = 0.8;
  const barrels = new THREE.Mesh(c.build(), mat);
  barrels.name = 'barrels';
  g.add(barrels);
  return g;
}

export function buildHammer(): THREE.Group {
  const b = new MeshBuilder();
  b.cyl(WOOD, 0.017, 0.019, 0.55, { p: [0, 0, -0.1], r: [Math.PI / 2, 0, 0] }, 8); // haft
  b.cyl(BLACK, 0.021, 0.021, 0.12, { p: [0, 0, 0.12], r: [Math.PI / 2, 0, 0] }, 8); // leather grip
  b.box(STEEL, 0.06, 0.24, 0.1, { p: [0, 0.02, -0.38] }); // head
  b.box(MID, 0.068, 0.04, 0.108, { p: [0, 0.14, -0.38] }); // striking faces
  b.box(MID, 0.068, 0.04, 0.108, { p: [0, -0.1, -0.38] });
  b.box(DARK, 0.065, 0.05, 0.11, { p: [0, 0.02, -0.38] }); // collar
  b.cone(STEEL, 0.02, 0.06, { p: [0, 0.02, -0.46], r: [-Math.PI / 2, 0, 0] }, 4); // spike on top
  return finish(b, -0.45, 0, 0.45, 0.6);
}
