import * as THREE from 'three';
import { Weapon, WEAPONS, buildViewModel } from '../weapons/weapons';
import { initWeaponEnvironment, upgradeViewModel } from '../weapons/models';
import { buildWorld } from '../world/world';

// Scene, camera, world and the player's body/weapons: created once, shared by every module.

export const $ = (id: string) => document.getElementById(id)!;

export const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

export const scene = new THREE.Scene();
export const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 400);
camera.rotation.order = 'YXZ';
scene.add(camera);

export const world = buildWorld(scene);
export const START = world.playerStart.clone();
export const pos = START.clone(); // player feet position
export const vel = new THREE.Vector3();

// ---------- weapons ----------
initWeaponEnvironment(renderer);
export const weapons = WEAPONS.map((s) => new Weapon(s));
export const viewModels = WEAPONS.map((s) => {
  const g = buildViewModel(s.id);
  g.position.set(0.25, -0.22, -0.5);
  g.visible = false;
  camera.add(g);
  upgradeViewModel(g, s.id); // swaps in the real model once it has loaded
  return g;
});
export const flashLight = new THREE.PointLight(0xffc266, 0, 6);
camera.add(flashLight);
viewModels[0].visible = true;

// ---------- effects ----------
interface Fx { obj: THREE.Object3D; life: number; max: number }
const fx: Fx[] = [];
export function spawnTracer(from: THREE.Vector3, to: THREE.Vector3, color: number) {
  const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true }));
  scene.add(line);
  fx.push({ obj: line, life: 0.06, max: 0.06 });
}
export function spawnImpact(p: THREE.Vector3, color: number) {
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 6, 6),
    new THREE.MeshBasicMaterial({ color, transparent: true }),
  );
  m.position.copy(p);
  scene.add(m);
  fx.push({ obj: m, life: 0.2, max: 0.2 });
}
/** Fade out and remove finished tracers / impact sparks. */
export function updateFx(dt: number) {
  for (let i = fx.length - 1; i >= 0; i--) {
    const f = fx[i];
    f.life -= dt;
    const mat = (f.obj as THREE.Mesh | THREE.Line).material as THREE.Material & { opacity: number };
    mat.opacity = Math.max(0, f.life / f.max);
    if (f.life <= 0) {
      scene.remove(f.obj);
      (f.obj as THREE.Mesh).geometry.dispose();
      mat.dispose();
      fx.splice(i, 1);
    }
  }
}
