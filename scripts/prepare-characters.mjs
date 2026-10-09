// One-off asset prep for the downloaded characters:
//   node scripts/prepare-characters.mjs <knight.glb> <zombie-pack.glb>
// Knight: mesh simplified to ~9k triangles, textures 1024 px WebP        -> public/models/knight.glb
// Zombie pack (10 zombies in one file): split into one file per zombie (own skeleton, hair / hat included)
//                                                                        -> public/models/zombie-<0..9>.glb
// Neither file has a walk cycle (both clips are idle sways), so one frame of the clip is baked into the bones as the
// standing pose and the animations are removed: the game animates the bones itself (src/entities/glbRig.ts).
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup, weld, simplify, resample, textureCompress, flatten } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'fs';

const [knightFile, zombieFile] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const size = (f) => (fs.statSync(f).size / 1e6).toFixed(2) + ' MB';
const tris = (doc) => doc.getRoot().listMeshes().reduce((n, m) => n + m.listPrimitives().reduce((k, p) => k + (p.getIndices()?.getCount() ?? 0) / 3, 0), 0);
await MeshoptSimplifier.ready;

/** Writes the clip's pose at `time` into the nodes (the bind pose becomes that stance) and deletes all animations. */
function bakePose(doc, time) {
  for (const a of doc.getRoot().listAnimations()) {
    for (const ch of a.listChannels()) {
      const sm = ch.getSampler(), node = ch.getTargetNode();
      if (!node) continue;
      const t = sm.getInput().getArray();
      let i = 0;
      while (i + 1 < t.length && t[i + 1] <= time) i++;
      const w = sm.getOutput().getElementSize();
      const v = Array.from(sm.getOutput().getArray().slice(i * w, i * w + w));
      const path = ch.getTargetPath();
      if (path === 'rotation') node.setRotation(v);
      else if (path === 'translation') node.setTranslation(v);
      else if (path === 'scale') node.setScale(v);
    }
  }
  for (const a of doc.getRoot().listAnimations()) {
    for (const ch of a.listChannels()) ch.dispose();
    for (const sm of a.listSamplers()) sm.dispose();
    a.dispose();
  }
}

if (knightFile) {
  const doc = await io.read(knightFile);
  for (const a of doc.getRoot().listAnimations()) if (/t-pose/i.test(a.getName())) a.dispose();
  bakePose(doc, 1.0);
  await doc.transform(
    weld(),
    simplify({ simplifier: MeshoptSimplifier, ratio: 0.18, error: 0.02, lockBorder: false }),
    prune(),
    dedup(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 82 }),
  );
  fs.mkdirSync('public/models', { recursive: true });
  await io.write('public/models/knight.glb', doc);
  console.log('knight', Math.round(tris(doc)), 'tris', size('public/models/knight.glb'));
}

if (zombieFile) {
  const probe = await io.read(zombieFile);
  const skinCount = probe.getRoot().listSkins().length;
  for (let k = 0; k < skinCount; k++) {
    const doc = await io.read(zombieFile);
    const root = doc.getRoot();
    const keep = root.listSkins()[k];
    for (const n of root.listNodes()) {
      if (n.getMesh() && n.getSkin() !== keep) n.dispose(); // other zombies, their hair and hats, the stray line mesh
    }
    bakePose(doc, 0);
    for (const sk of root.listSkins()) if (sk !== keep) sk.dispose();
    await doc.transform(prune({ keepLeaves: false }), dedup());
    const f = `public/models/zombie-${k}.glb`;
    await io.write(f, doc);
    console.log(f, Math.round(tris(doc)), 'tris', size(f));
  }
}
