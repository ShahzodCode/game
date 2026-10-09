// Lists public/audio/voices/<costume>-<hit|death|casual>-<n>.mp3 into manifest.json (run after adding recordings: npm run voices)
import { readdirSync, writeFileSync } from 'node:fs';
const dir = new URL('../public/audio/voices/', import.meta.url);
const out = {};
for (const f of readdirSync(dir).sort()) {
  const m = /^([a-z]+)-(hit|death|casual|summon|throw|pant)-(\d+)\.mp3$/.exec(f);
  if (!m) continue;
  ((out[m[1]] ??= {})[m[2]] ??= []).push(f);
}
writeFileSync(new URL('manifest.json', dir), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out));
