// Generates the spoken character lines (and synthesized groans / breaths) into public/audio/voices/<costume>-<kind>-<n>.wav
// with Piper (https://github.com/rhasspy/piper, MIT, offline TTS). Usage:
//   node scripts/voices-piper.mjs <piper dir (has piper.exe)> <voices dir (has *.onnx models)> [costume ...]
// Then run `npm run voices`. Pitch is changed by resampling, so a lower value = deeper and slower.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const [piperDir, voicesDir, ...only] = process.argv.slice(2);
if (!piperDir || !voicesDir) throw new Error('usage: node scripts/voices-piper.mjs <piper dir> <voices dir> [costume ...]');
const OUT = new URL('../public/audio/voices/', import.meta.url);
mkdirSync(OUT, { recursive: true });
const SR = 22050;
const tmp = mkdtempSync(join(tmpdir(), 'piper-'));

// voice = Piper model, ls = length_scale (>1 slower), pitch = resample factor, echo = boss reverb
const CAST = {
  superman: { voice: 'en_US-ryan-medium', ls: 1.05, pitch: 0.93 },
  cowboy: { voice: 'en_US-joe-medium', ls: 1.3, pitch: 0.96 },
  soldier: { voice: 'en_US-joe-medium', ls: 0.82, pitch: 1.06 },
  criminal: { voice: 'en_GB-northern_english_male-medium', ls: 0.95, pitch: 0.94 },
  rich: { voice: 'en_GB-alan-medium', ls: 1.12, pitch: 1.0 },
  ninja: { voice: 'en_US-john-medium', ls: 1.2, pitch: 0.9 },
  chef: { voice: 'en_US-john-medium', ls: 0.88, pitch: 1.17 },
  boss: { voice: 'en_US-joe-medium', ls: 1.2, pitch: 0.7, echo: true },
};

const LINES = {
  superman: {
    hit: ['Ha! Is that all you have?', 'You tickle me, citizen.', 'Hmph! Justice cannot be stopped!'],
    death: ['Justice... fades...', 'Tell the city... I tried.'],
    casual: ['Never fear, citizens. I am here.', 'Justice never sleeps.', 'Another beautiful day to save the world.'],
  },
  cowboy: {
    hit: ['Ow! Dang it, partner!', "You'll regret that, stranger!", 'Right in my good hat!'],
    death: ['Tell my horse... I loved her.', 'Well... shoot.'],
    casual: ["Lonesome trail today, ain't it?", "This town ain't big enough for the both of us.", 'Mighty fine weather for a showdown.'],
  },
  soldier: {
    hit: ["Contact! I'm hit!", 'Taking fire!', "That's a mistake, civilian."],
    death: ['Man down. Tell my unit.', 'Mission... failed.'],
    casual: ['Sector clear. Stay sharp.', "Eyes open. Something's off today.", 'Discipline is what keeps us alive.'],
  },
  criminal: {
    hit: ["Argh! You'll pay for that!", "Oi! That's my favourite jacket, you muppet!", "Now you've done it, mate."],
    death: ['Bleedin coppers...', "Should have stayed in the pub."],
    casual: ["Nice wallet you've got there.", 'Keep walking. Nothing to see here.', "Everyone's got a price, mate."],
  },
  rich: {
    hit: ['Good heavens! Do you know who I am?', 'This suit cost more than your house!', 'My lawyers will hear about this!'],
    death: ['Not the pension fund...', 'Cancel my appointments...'],
    casual: ['Money solves everything, you know.', 'One simply cannot find good staff these days.', 'I own half of this town, you know.'],
  },
  ninja: {
    hit: ['Impressive.', 'Careless. I will not miss.', 'Nothing personal.'],
    death: ['My honor remains.', 'The shadows take me.'],
    casual: ['Silence is the sharpest blade.', 'The wind carries your footsteps.', 'Patience. The shadow always waits.'],
  },
  chef: {
    hit: ['Ow! My kitchen, my rules!', 'You ruined my souffle!', 'Hey! Watch the apron!'],
    death: ['The oven... left on...', 'Dinner is served.'],
    casual: ['A little salt, a little love.', 'Something smells burnt. Not on my watch!', 'The secret ingredient is patience.'],
  },
  boss: {
    hit: ['Insect!', 'You dare strike me?'],
    death: ['Impossible. I am eternal.'],
    summon: ['Rise, my servants! Rise and devour!', 'Come forth, children of the grave!'],
    throw: ['Crush them! Take this!', 'Hraah! Fall!'],
  },
};

// ---------------------------------------------------------------- wav helpers
function readWav(file) {
  const b = readFileSync(file);
  let p = 12;
  while (p < b.length - 8) {
    const id = b.toString('ascii', p, p + 4);
    const size = b.readUInt32LE(p + 4);
    if (id === 'data') {
      const n = Math.floor(Math.min(size, b.length - p - 8) / 2);
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) out[i] = b.readInt16LE(p + 8 + i * 2) / 32768;
      return out;
    }
    p += 8 + size + (size & 1);
  }
  throw new Error('no data chunk in ' + file);
}
function writeWav(name, s) {
  const b = Buffer.alloc(44 + s.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + s.length * 2, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(SR, 24);
  b.writeUInt32LE(SR * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(s.length * 2, 40);
  for (let i = 0; i < s.length; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s[i])) * 32767), 44 + i * 2);
  writeFileSync(new URL(name, OUT), b);
}
function resample(s, r) {
  if (Math.abs(r - 1) < 0.001) return s;
  const n = Math.floor(s.length / r), o = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i * r, k = Math.floor(x), f = x - k;
    o[i] = (s[k] ?? 0) * (1 - f) + (s[k + 1] ?? 0) * f;
  }
  return o;
}
function trim(s) {
  let a = 0, z = s.length - 1;
  while (a < z && Math.abs(s[a]) < 0.012) a++;
  while (z > a && Math.abs(s[z]) < 0.012) z--;
  a = Math.max(0, a - 400); z = Math.min(s.length - 1, z + 900);
  const o = s.slice(a, z + 1);
  const f = 200;
  for (let i = 0; i < f && i < o.length; i++) { o[i] *= i / f; o[o.length - 1 - i] *= i / f; }
  return o;
}
function echo(s) {
  const d = Math.floor(SR * 0.11), o = new Float32Array(s.length + d * 5);
  for (let i = 0; i < s.length; i++) for (let k = 0; k < 5; k++) o[i + k * d] += s[i] * Math.pow(0.38, k);
  return o;
}
/** Same loudness for every file (the game applies VOICE_GAIN on top). */
function normalize(s, rms = 0.11) {
  let sum = 0, peak = 0;
  for (const v of s) { sum += v * v; peak = Math.max(peak, Math.abs(v)); }
  const g = Math.min(rms / Math.sqrt(sum / s.length || 1), 0.95 / (peak || 1));
  return s.map((v) => v * g);
}

// ---------------------------------------------------------------- synthesized creature sounds
let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
class Bandpass {
  constructor(f, q) {
    const w = (2 * Math.PI * f) / SR, al = Math.sin(w) / (2 * q), a0 = 1 + al;
    this.b0 = al / a0; this.b2 = -al / a0; this.a1 = (-2 * Math.cos(w)) / a0; this.a2 = (1 - al) / a0;
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
  }
  run(x) {
    const y = this.b0 * x + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}
/** A zombie-ish groan: a falling buzz (glottal saw) through vowel formants, jittery, with rasp noise. */
function groan({ dur, f0, drop, rasp, formants }) {
  const n = Math.floor(dur * SR), o = new Float32Array(n);
  const bands = formants.map((f) => new Bandpass(f, 5));
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const env = Math.min(1, t * 12) * Math.pow(1 - t, 0.7);
    const f = f0 * (1 - drop * t) * (1 + 0.04 * Math.sin(i / SR * 38) + (rnd() - 0.5) * 0.02);
    ph += f / SR; ph -= Math.floor(ph);
    const saw = ph * 2 - 1;
    const src = saw * (0.7 + 0.3 * Math.sin(i / SR * 17)) + (rnd() * 2 - 1) * rasp;
    let y = 0;
    for (const b of bands) y += b.run(src);
    o[i] = y * env;
  }
  return o;
}
function breaths(count, gap, len) {
  const n = Math.floor((count * gap + len) * SR), o = new Float32Array(n);
  const b1 = new Bandpass(900, 1.2), b2 = new Bandpass(2200, 1.5);
  for (let c = 0; c < count; c++) {
    const start = Math.floor(c * gap * SR);
    for (let i = 0; i < len * SR; i++) {
      const t = i / (len * SR), e = Math.sin(Math.PI * t) ** 1.5;
      const x = rnd() * 2 - 1;
      o[start + i] += (b1.run(x) + 0.6 * b2.run(x)) * e * (c % 2 ? 0.8 : 1);
    }
  }
  return o;
}
const CREATURES = {
  zombie: {
    hit: [
      () => groan({ dur: 0.7, f0: 125, drop: 0.35, rasp: 0.5, formants: [550, 1000] }),
      () => groan({ dur: 0.55, f0: 150, drop: 0.5, rasp: 0.7, formants: [700, 1200] }),
      () => groan({ dur: 0.9, f0: 110, drop: 0.25, rasp: 0.4, formants: [450, 850] }),
    ],
    death: [
      () => groan({ dur: 1.6, f0: 130, drop: 0.7, rasp: 0.5, formants: [500, 900] }),
      () => groan({ dur: 1.3, f0: 105, drop: 0.55, rasp: 0.8, formants: [650, 1100] }),
    ],
  },
  zombie_brute: {
    hit: [
      () => groan({ dur: 0.9, f0: 70, drop: 0.3, rasp: 0.6, formants: [350, 700] }),
      () => groan({ dur: 0.75, f0: 82, drop: 0.45, rasp: 0.7, formants: [420, 800] }),
    ],
    death: [
      () => groan({ dur: 2.0, f0: 75, drop: 0.7, rasp: 0.6, formants: [330, 650] }),
      () => groan({ dur: 1.7, f0: 62, drop: 0.55, rasp: 0.8, formants: [380, 720] }),
    ],
  },
  boss: {
    pant: [() => breaths(5, 0.55, 0.42), () => breaths(6, 0.45, 0.34)],
  },
};

// ---------------------------------------------------------------- run
const written = [];
function piper(voice, ls, text, file) {
  const r = spawnSync(join(piperDir, 'piper.exe'), ['-m', join(voicesDir, voice + '.onnx'), '--length_scale', String(ls), '--noise_scale', '0.75', '-f', file], {
    input: text + '\n', encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error(`piper failed for "${text}": ${r.stderr}`);
}
for (const [costume, kinds] of Object.entries(LINES)) {
  if (only.length && !only.includes(costume)) continue;
  const c = CAST[costume];
  for (const [kind, lines] of Object.entries(kinds)) {
    lines.forEach((text, i) => {
      const raw = join(tmp, `${costume}-${kind}-${i + 1}.wav`);
      piper(c.voice, c.ls, text, raw);
      let s = resample(readWav(raw), c.pitch);
      s = trim(s);
      if (c.echo) s = echo(s);
      writeWav(`${costume}-${kind}-${i + 1}.wav`, normalize(s));
      written.push(`${costume}-${kind}-${i + 1}`);
    });
  }
}
for (const [costume, kinds] of Object.entries(CREATURES)) {
  if (only.length && !only.includes(costume)) continue;
  for (const [kind, makers] of Object.entries(kinds)) {
    makers.forEach((make, i) => {
      writeWav(`${costume}-${kind}-${i + 1}.wav`, normalize(trim(make()), 0.13));
      written.push(`${costume}-${kind}-${i + 1}`);
    });
  }
}
console.log(written.length + ' files: ' + written.join(' '));
