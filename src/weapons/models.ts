import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

// Real 3D models for the first-person weapons (public/models/*.glb, prepared by scripts/optimize-models.mjs).
// The blocky procedural viewmodels from buildViewModel() stay as the fallback until a model has loaded
// (or forever, if loading fails).

interface ModelSpec {
  file: string;
  /** Rotation about Y (degrees) so the barrel points to -z (the direction the player aims). */
  rotY: number;
  /** Length of the weapon in metres, muzzle to butt. */
  length: number;
  /** Where the model's bounding box ends up inside the viewmodel group: its centre z and its top y. */
  centerZ: number;
  topY: number;
  /** The model is only modelled on one side (the other is hollow): rebuild it symmetric from the good side. */
  symmetrize?: boolean;
}
const SPECS: Record<string, ModelSpec> = {
  pistol: { file: 'pistol.glb', rotY: 90, length: 0.3, centerZ: 0, topY: 0.05, symmetrize: true },
  rifle: { file: 'rifle.glb', rotY: 0, length: 1.0, centerZ: -0.05, topY: 0.07 },
  shotgun: { file: 'shotgun.glb', rotY: -90, length: 1.15, centerZ: -0.12, topY: 0.05 },
};

let envMap: THREE.Texture | null = null;
const loader = new GLTFLoader();

/** The shared studio reflection map (null until the renderer exists). */
export const getWeaponEnvironment = () => envMap;

/** Metal looks black without something to reflect: give the weapon materials a soft studio environment. */
export function initWeaponEnvironment(renderer: THREE.WebGLRenderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
}

/**
 * Some models were only built on one side (the pistol's slide has no left wall). Keep the triangles of the intact
 * side (z >= centre) and add their mirror image, so the gun is solid from both sides.
 */
function makeSymmetric(scene: THREE.Group) {
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  const cz = (box.min.z + box.max.z) / 2;
  const meshes: THREE.Mesh[] = [];
  scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
  const v = new THREE.Vector3();
  for (const m of meshes) {
    const src = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    src.applyMatrix4(m.matrixWorld);
    const pos = src.getAttribute('position'), nor = src.getAttribute('normal'), uv = src.getAttribute('uv');
    const keep: number[] = [];
    for (let t = 0; t < pos.count; t += 3) {
      let z = 0;
      for (let k = 0; k < 3; k++) z += pos.getZ(t + k);
      if (z / 3 >= cz - 1e-4) keep.push(t);
    }
    const n = keep.length * 3 * 2;
    const P = new Float32Array(n * 3), N = new Float32Array(n * 3), U = new Float32Array(n * 2);
    let w = 0;
    const put = (i: number, mirror: boolean) => {
      v.fromBufferAttribute(pos, i);
      if (mirror) v.z = 2 * cz - v.z;
      P.set([v.x, v.y, v.z], w * 3);
      if (nor) { v.fromBufferAttribute(nor, i); if (mirror) v.z = -v.z; N.set([v.x, v.y, v.z], w * 3); }
      if (uv) U.set([uv.getX(i), uv.getY(i)], w * 2);
      w++;
    };
    for (const t of keep) {
      for (let k = 0; k < 3; k++) put(t + k, false);
      for (const k of [0, 2, 1]) put(t + k, true); // reversed order keeps the mirrored triangle facing outwards
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(P, 3));
    if (nor) g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    if (uv) g.setAttribute('uv', new THREE.BufferAttribute(U, 2));
    m.geometry = g;
    m.matrix.identity();
    m.position.set(0, 0, 0); m.rotation.set(0, 0, 0); m.scale.set(1, 1, 1);
    m.parent?.remove(m);
    scene.add(m);
  }
  scene.updateMatrixWorld(true);
}

const cache = new Map<string, Promise<THREE.Group>>();
/** Load a weapon file once; viewmodels and shop displays use clones of it (geometry and materials are shared). */
function loadScene(file: string, symmetrize = false): Promise<THREE.Group> {
  let p = cache.get(file);
  if (!p) {
    p = loader.loadAsync(import.meta.env.BASE_URL + 'models/' + file).then((gltf) => {
      gltf.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.castShadow = false;
        m.frustumCulled = false; // viewmodels are always close to the camera
        const mat = m.material as THREE.MeshStandardMaterial;
        // the rifle's material is exported as alpha-blended: its parts then sort wrongly and look see-through
        mat.transparent = false;
        mat.alphaTest = 0;
        mat.depthWrite = true;
        mat.opacity = 1;
        if (envMap) {
          mat.envMap = envMap;
          mat.envMapIntensity = 0.7;
        }
      });
      if (symmetrize) makeSymmetric(gltf.scene);
      return gltf.scene;
    });
    cache.set(file, p);
  }
  return p;
}

/** Replace the blocky placeholder inside `group` with the real model (async; does nothing for weapons without one). */
export function upgradeViewModel(group: THREE.Group, id: string) {
  const spec = SPECS[id];
  if (!spec) return;
  loadScene(spec.file, spec.symmetrize).then(
    (scene) => {
      const model = scene.clone(true);
      model.rotation.y = THREE.MathUtils.degToRad(spec.rotY);
      model.updateMatrixWorld(true);
      const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
      const s = spec.length / Math.max(size.x, size.z); // the barrel lies along x or z, whichever is longer
      model.scale.setScalar(s);
      model.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(model);
      const c = box.getCenter(new THREE.Vector3());
      model.position.set(-c.x, spec.topY - box.max.y, spec.centerZ - c.z);

      // swap: hide the placeholder boxes, keep the 'muzzle' marker and move it to the model's muzzle
      for (const child of [...group.children]) if (child.name !== 'muzzle') group.remove(child);
      group.add(model);
      const muzzle = group.getObjectByName('muzzle');
      if (muzzle) muzzle.position.set(0, spec.topY - 0.02, spec.centerZ - spec.length / 2);
    },
    (err) => console.warn(`Could not load the ${id} model, keeping the blocky one`, err),
  );
}

/**
 * A gun for a shop wall or display case. Returns a group right away that fills in once the model has loaded:
 * the barrel points to -z, the solid side faces +x (the pistol is hollow on its other side), the gun is centred
 * on x/z with its underside at y = 0, and it is `length` metres long.
 */
export function makeDisplayGun(id: string, length: number): THREE.Group {
  const holder = new THREE.Group();
  const spec = SPECS[id];
  if (!spec) return holder;
  loadScene(spec.file, spec.symmetrize).then(
    (scene) => {
      const model = scene.clone(true);
      model.rotation.y = THREE.MathUtils.degToRad(spec.rotY);
      model.updateMatrixWorld(true);
      const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
      model.scale.setScalar(length / Math.max(size.x, size.z));
      model.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(model);
      const c = box.getCenter(new THREE.Vector3());
      model.position.set(-c.x, -box.min.y, -c.z);
      holder.add(model);
    },
    (err) => console.warn(`Could not load the ${id} display model`, err),
  );
  return holder;
}
