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
}
const SPECS: Record<string, ModelSpec> = {
  pistol: { file: 'pistol.glb', rotY: 90, length: 0.3, centerZ: 0, topY: 0.05 },
  rifle: { file: 'rifle.glb', rotY: 0, length: 1.0, centerZ: -0.05, topY: 0.07 },
  shotgun: { file: 'shotgun.glb', rotY: -90, length: 1.15, centerZ: -0.12, topY: 0.05 },
};

let envMap: THREE.Texture | null = null;
const loader = new GLTFLoader();

/** Metal looks black without something to reflect: give the weapon materials a soft studio environment. */
export function initWeaponEnvironment(renderer: THREE.WebGLRenderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
}

/** Replace the blocky placeholder inside `group` with the real model (async; does nothing for weapons without one). */
export function upgradeViewModel(group: THREE.Group, id: string) {
  const spec = SPECS[id];
  if (!spec) return;
  loader.load(
    import.meta.env.BASE_URL + 'models/' + spec.file,
    (gltf) => {
      const model = gltf.scene;
      model.rotation.y = THREE.MathUtils.degToRad(spec.rotY);
      model.updateMatrixWorld(true);
      const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
      const s = spec.length / Math.max(size.x, size.z); // the barrel lies along x or z, whichever is longer
      model.scale.setScalar(s);
      model.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(model);
      const c = box.getCenter(new THREE.Vector3());
      model.position.set(-c.x, spec.topY - box.max.y, spec.centerZ - c.z);

      model.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.castShadow = false;
        m.frustumCulled = false; // always close to the camera
        const mat = m.material as THREE.MeshStandardMaterial;
        if (envMap) {
          mat.envMap = envMap;
          mat.envMapIntensity = 0.7;
        }
      });

      // swap: hide the placeholder boxes, keep the 'muzzle' marker and move it to the model's muzzle
      for (const child of [...group.children]) if (child.name !== 'muzzle') group.remove(child);
      group.add(model);
      const muzzle = group.getObjectByName('muzzle');
      if (muzzle) muzzle.position.set(0, spec.topY - 0.02, spec.centerZ - spec.length / 2);
    },
    undefined,
    (err) => console.warn(`Could not load the ${id} model, keeping the blocky one`, err),
  );
}
