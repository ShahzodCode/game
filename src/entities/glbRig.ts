import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { BotRig } from './botModel';

/**
 * Downloaded, skinned characters: the knight (the boss) and the ten PolyArt zombies (public/models, made by
 * scripts/prepare-characters.mjs). Neither file has a walk cycle, so they are posed here: the file holds one standing pose,
 * and every frame the same invisible "proxy" groups that drive the procedural humans (arms / legs / head, see
 * `animate()` in mannequin.ts) are copied onto the bones as rotations about the rig's own axes (`post`).
 * Hits are tested against invisible boxes parented to the bones (head box flagged as head), never against the skinned mesh.
 */

interface Template {
  scene: THREE.Group;
  height: number; // model units, feet to top of the head
  cx: number; // pelvis position (the pack places the zombies side by side)
  cz: number;
}

const loader = new GLTFLoader();
const templates: Record<string, Template[]> = { boss: [], zombie: [] };
const waiting: (() => void)[] = [];
let started = false;

const norm = (n: string) => n.toLowerCase().replace(/[^a-z]/g, '');

function prepare(scene: THREE.Group): Template {
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  scene.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh) return;
    m.frustumCulled = false;
    m.skeleton.update();
    const p = m.geometry.attributes.position;
    for (let i = 0; i < p.count; i += 5) {
      v.fromBufferAttribute(p, i);
      m.applyBoneTransform(i, v);
      v.applyMatrix4(m.matrixWorld);
      box.expandByPoint(v);
    }
  });
  let cx = 0, cz = 0;
  scene.traverse((o) => {
    if ((o as THREE.Bone).isBone && /pelvis/.test(norm(o.name)) && !cx && !cz) {
      const w = o.getWorldPosition(new THREE.Vector3());
      cx = w.x;
      cz = w.z;
    }
  });
  return { scene, height: box.max.y - Math.max(0, box.min.y), cx, cz };
}

/** Start loading the characters in the background (the zombies only matter once the boss summons them). */
export function loadCharacterModels() {
  if (started) return;
  started = true;
  const jobs: [string, string][] = [['boss', 'knight']];
  for (let i = 0; i < 10; i++) jobs.push(['zombie', `zombie-${i}`]);
  for (const [kind, file] of jobs) {
    loader.load(
      `${import.meta.env.BASE_URL}models/${file}.glb`,
      (g) => {
        templates[kind].push(prepare(g.scene));
        for (const cb of waiting) cb();
      },
      undefined,
      () => {}, // a missing file just keeps the procedural character
    );
  }
}

/** Called whenever another model has finished loading. */
export function onCharacterModels(cb: () => void) {
  waiting.push(cb);
}

export function hasModel(kind: string) {
  return !!templates[kind]?.length;
}

const hiddenMat = new THREE.MeshBasicMaterial({ visible: false });
const X_AXIS = new THREE.Vector3(1, 0, 0);

interface Joint {
  bone: THREE.Bone;
  restW: THREE.Quaternion; // world rotation in the standing pose (relative to the model)
  parentW: THREE.Quaternion; // the parent's world rotation in the standing pose
}

/** A bone-driven character; returns null when no model of that kind has loaded yet. */
export function buildGlbRig(owner: object, kind: 'boss' | 'zombie', prop?: 'knife' | 'gun'): BotRig | null {
  const list = templates[kind];
  if (!list.length) return null;
  const t = list[Math.floor(Math.random() * list.length)];
  const model = cloneSkinned(t.scene) as THREE.Group;
  model.updateMatrixWorld(true);

  const bones: THREE.Bone[] = [];
  model.traverse((o) => ((o as THREE.Bone).isBone ? bones.push(o as THREE.Bone) : 0));
  const byName = new Map(bones.map((b) => [norm(b.name), b]));
  const find = (part: string) => byName.get('bip' + part) ?? byName.get('ccbase' + part) ?? null;

  const joint = (part: string): Joint | null => {
    const bone = find(part);
    if (!bone) return null;
    return {
      bone,
      restW: bone.getWorldQuaternion(new THREE.Quaternion()),
      parentW: bone.parent ? bone.parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion(),
    };
  };
  const pos = (j: Joint) => j.bone.getWorldPosition(new THREE.Vector3());

  // [right, left]: arms[0] / legs[0] hang at -x (the character's right), like the procedural humans
  const sides = ['r', 'l'];
  const thigh = sides.map((s) => joint(s + 'thigh'));
  const calf = sides.map((s) => joint(s + 'calf'));
  const foot = sides.map((s) => joint(s + 'foot'));
  const upper = sides.map((s) => joint(s + 'upperarm'));
  const fore = sides.map((s) => joint(s + 'forearm'));
  const hand = sides.map((s) => joint(s + 'hand'));
  const headJ = joint('head');
  const pelvis = joint('pelvis');
  if (thigh.includes(null) || calf.includes(null) || foot.includes(null) || upper.includes(null) || fore.includes(null) || hand.includes(null) || !headJ || !pelvis) return null;

  // ---- invisible hit boxes in model space ----
  const H = t.height;
  const geos: THREE.BufferGeometry[] = [];
  const hitMeshes: THREE.Mesh[] = [];
  const addBox = (parent: THREE.Object3D, restW: THREE.Quaternion, center: THREE.Vector3, size: [number, number, number], head = false) => {
    const g = new THREE.BoxGeometry(...size);
    geos.push(g);
    const m = new THREE.Mesh(g, hiddenMat);
    m.visible = false;
    m.userData.owner = owner;
    m.userData.head = head;
    const inv = restW.clone().invert();
    const ws = parent.getWorldScale(new THREE.Vector3()).x || 1;
    m.position.copy(center).sub(parent.getWorldPosition(new THREE.Vector3())).applyQuaternion(inv).divideScalar(ws);
    m.quaternion.copy(inv);
    m.scale.setScalar(1 / ws);
    parent.add(m);
    hitMeshes.push(m);
  };
  const seg = (a: Joint, b: Joint, w: number, extraEnd = 0) => {
    const pa = pos(a), pb = pos(b);
    const mid = pa.clone().add(pb).multiplyScalar(0.5);
    mid.y -= extraEnd / 2;
    addBox(a.bone, a.restW, mid, [Math.max(Math.abs(pb.x - pa.x), w), Math.abs(pb.y - pa.y) + extraEnd, Math.max(Math.abs(pb.z - pa.z), w)]);
  };
  const ph = pos(headJ);
  addBox(headJ.bone, headJ.restW, ph.clone().add(new THREE.Vector3(0, 0.065 * H, 0.005 * H)), [0.16 * H, 0.17 * H, 0.18 * H], true);
  for (let i = 0; i < 2; i++) {
    seg(upper[i]!, fore[i]!, 0.075 * H);
    seg(fore[i]!, hand[i]!, 0.07 * H, 0.04 * H);
    seg(thigh[i]!, calf[i]!, 0.1 * H);
    const pc = pos(calf[i]!), pf = pos(foot[i]!);
    const bottom = Math.min(0, pf.y - 0.03 * H);
    addBox(calf[i]!.bone, calf[i]!.restW, new THREE.Vector3(pc.x, (pc.y + bottom) / 2, (pc.z + pf.z) / 2), [0.1 * H, pc.y - bottom, 0.14 * H]);
  }
  // torso: crotch to shoulders, one static box on the model (it only leans with the whole body)
  const pp = pos(pelvis);
  const sx = Math.abs(pos(upper[0]!).x - pos(upper[1]!).x) + 0.07 * H;
  const top = ph.y - 0.01 * H;
  const bottomT = pp.y - 0.06 * H;
  {
    const g = new THREE.BoxGeometry(sx, top - bottomT, 0.26 * H);
    geos.push(g);
    const m = new THREE.Mesh(g, hiddenMat);
    m.visible = false;
    m.userData.owner = owner;
    m.userData.head = false;
    m.position.set(pp.x, (top + bottomT) / 2, pp.z);
    model.add(m);
    hitMeshes.push(m);
  }

  // ---- materials (one clone per character so the hit flash / freeze tint is per character) ----
  const materials: THREE.Material[] = [];
  model.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || hitMeshes.includes(m)) return;
    const c = (m.material as THREE.Material).clone();
    m.material = c;
    m.castShadow = true;
    materials.push(c);
  });

  // something in the hand (knife / gun zombies): parts along the forearm, like the procedural humans' props
  if (prop) {
    const hj = hand[1]!;
    const hp = pos(hj);
    const part = (color: number, size0: [number, number, number], at0: [number, number, number], metal = 0.1) => {
      const size = size0.map((v) => v * 1.6) as [number, number, number]; // bigger than life so it reads from a distance
      const at = at0.map((v) => v * 1.6) as [number, number, number];
      const m = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: metal }));
      geos.push(m.geometry);
      materials.push(m.material as THREE.Material);
      const inv = hj.restW.clone().invert();
      const ws = hj.bone.getWorldScale(new THREE.Vector3()).x || 1;
      m.position.set(hp.x + at[0] * H, hp.y + at[1] * H, hp.z + at[2] * H).sub(hp).applyQuaternion(inv).divideScalar(ws).add(new THREE.Vector3());
      m.quaternion.copy(inv);
      m.scale.setScalar(1 / ws);
      m.castShadow = true;
      hj.bone.add(m);
    };
    if (prop === 'knife') {
      part(0x2a2a2e, [0.02 * H, 0.07 * H, 0.025 * H], [0, -0.03, 0]); // handle
      part(0xc9ced4, [0.008 * H, 0.17 * H, 0.03 * H], [0, -0.14, 0], 0.9); // blade
    } else {
      part(0x26282c, [0.03 * H, 0.05 * H, 0.1 * H], [0, -0.03, 0.03], 0.5); // gun body
      part(0x26282c, [0.026 * H, 0.1 * H, 0.03 * H], [0, -0.06, -0.01], 0.4); // grip
    }
  }

  // ---- holder: scaled to a human-like height, feet on the ground, centred on the pelvis ----
  const target = (kind === 'boss' ? 1.9 : 1.78) * (kind === 'zombie' ? 0.95 + Math.random() * 0.1 : 1);
  const k = target / H;
  const holder = new THREE.Group();
  holder.scale.setScalar(k);
  holder.position.set(-t.cx * k, 0, -t.cz * k);
  holder.add(model);

  // ---- proxy groups: the animation code in mannequin.ts moves these, post() copies them onto the bones ----
  const mkGroup = (x: number, y: number, z: number, rz = 0) => {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.z = rz;
    return g;
  };
  const arms = [mkGroup(-0.25, 1.42, 0, -0.06), mkGroup(0.25, 1.42, 0, 0.06)];
  const legs = [mkGroup(-0.1, 0.9, 0), mkGroup(0.1, 0.9, 0)];
  const head = mkGroup(0, 1.5, 0);

  const knee = kind === 'boss' ? 0.75 : 0.55;
  const qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), qc = new THREE.Quaternion();
  const knee_q = new THREE.Quaternion();
  const place = (j: Joint, d: THREE.Quaternion, parentNew: THREE.Quaternion, out: THREE.Quaternion) => {
    out.copy(d).multiply(j.restW); // new world rotation = delta (about the model's axes) * standing pose
    j.bone.quaternion.copy(qc.copy(parentNew).invert()).multiply(out);
    return out;
  };

  const post = (phase: number, amp: number) => {
    for (let i = 0; i < 2; i++) {
      // legs: thigh swings, the knee bends while the leg comes forward, the foot stays flat
      const dT = legs[i].quaternion;
      const tW = place(thigh[i]!, dT, thigh[i]!.parentW, qa);
      const flex = Math.max(0, i === 0 ? -Math.cos(phase) : Math.cos(phase)) * amp * knee;
      knee_q.setFromAxisAngle(X_AXIS, flex).multiply(dT);
      const cW = place(calf[i]!, knee_q, tW, qb);
      place(foot[i]!, IDENT, cW, qa);
      // arms: shoulder swing / raise, the elbow follows a raised arm
      const dA = arms[i].quaternion;
      const uW = place(upper[i]!, dA, upper[i]!.parentW, qa);
      const elbow = 0.12 + 0.3 * THREE.MathUtils.clamp(-arms[i].rotation.x, 0, 1.8) / 1.8;
      knee_q.setFromAxisAngle(X_AXIS, -elbow).multiply(dA);
      place(fore[i]!, knee_q, uW, qb);
    }
    place(headJ, head.quaternion, headJ.parentW, qa);
  };
  post(0, 0);

  return {
    root: holder,
    head,
    legs,
    arms,
    cape: null,
    hitMeshes,
    materials,
    post,
    dispose: () => {
      geos.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
    },
  };
}

const IDENT = new THREE.Quaternion();
