// One-off asset prep: node scripts/optimize-models.mjs <dir-with-original-glbs>
// Removes the camera / light / studio backdrop nodes that Blender exports, shrinks textures to 1024 px (WebP)
// and writes the game-ready files to public/models/{pistol,rifle,shotgun}.glb.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup, textureCompress } from '@gltf-transform/functions';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const srcDir = process.argv[2];
const files = { pistol: /pist/i, rifle: /rifle/i, shotgun: /shotgun/i };
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
for (const [id, re] of Object.entries(files)) {
  const name = fs.readdirSync(srcDir).find((f) => re.test(f) && f.endsWith('.glb'));
  if (!name) { console.log('missing', id); continue; }
  const doc = await io.read(path.join(srcDir, name));
  for (const node of doc.getRoot().listNodes()) {
    if (!node.getMesh() && /camera|area|light/i.test(node.getName()) || node.getName() === 'Plane') node.dispose();
    else if (node.getCamera()) node.dispose();
  }
  await doc.transform(prune(), dedup(), textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 85 }));
  const out = `public/models/${id}.glb`;
  await io.write(out, doc);
  console.log(id, (fs.statSync(out).size / 1e6).toFixed(2), 'MB');
}
