/**
 * Weapon audio. Files live in public/audio/weapons.
 *  - rifle-burst: attack + steady fire (loops seamlessly). We start it on the first shot,
 *    loop the steady middle while firing, and fade out on release (no hard cut).
 *  - pistol-shot: one-shot per bullet (slight random pitch).
 *  - shotgun-shot + shotgun-pump: the blast, then the pump action a moment later.
 *  - pistol-reload / rifle-reload: played when a reload starts, cut off if it is cancelled.
 */
const FILES = [
  'rifle-burst', 'pistol-shot', 'shotgun-shot', 'shotgun-pump', 'pistol-reload', 'rifle-reload',
] as const;
type Name = (typeof FILES)[number];

// Rifle burst: shots repeat every ~0.357s pattern; loop a whole number of patterns from the steady part.
const BURST_START = 0.1;
const BURST_LOOP_START = 0.6;
const BURST_LOOP_LEN = 0.357 * 4;

let ctx: AudioContext | null = null;
let master: GainNode | null = null; // everything goes through this so mute is one switch
let muted = false;
const buffers = {} as Record<Name, AudioBuffer>;
let loopStartT = BURST_LOOP_START;
let loopEndT = BURST_LOOP_START + BURST_LOOP_LEN;
let loading: Promise<void> | null = null;

/** Nearest upward zero crossing to t, so the loop seam has no click. */
function snapToZeroCrossing(buf: AudioBuffer, t: number) {
  const d = buf.getChannelData(0);
  const c = Math.floor(t * buf.sampleRate);
  for (let r = 0; r < 2000; r++) {
    for (const i of [c - r, c + r]) {
      if (d[i] <= 0 && d[i + 1] > 0) return (i + 1) / buf.sampleRate;
    }
  }
  return t;
}

/** Call from a user gesture (the "Play" button). */
export function initAudio() {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 1;
    master.connect(ctx.destination);
  }
  void ctx.resume();
  loading ??= Promise.all(
    FILES.map(async (n) => {
      const res = await fetch(`/audio/weapons/${n}.mp3`);
      buffers[n] = await ctx!.decodeAudioData(await res.arrayBuffer());
    }),
  ).then(() => {
    loopStartT = snapToZeroCrossing(buffers['rifle-burst'], BURST_LOOP_START);
    loopEndT = snapToZeroCrossing(buffers['rifle-burst'], BURST_LOOP_START + BURST_LOOP_LEN);
  });
}

export function setMuted(m: boolean) {
  muted = m;
  if (master && ctx) master.gain.setTargetAtTime(m ? 0 : 1, ctx.currentTime, 0.02);
}
export const isMuted = () => muted;

/** Low snarl when a wolf turns on the player (synthesized). */
export function wolfGrowl() {
  if (!ctx || !master) return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(95, t);
  osc.frequency.linearRampToValueAtTime(55, t + 0.6);
  const trem = ctx.createOscillator(); // rough, rattling tremolo
  trem.frequency.value = 28;
  const tremGain = ctx.createGain();
  tremGain.gain.value = 0.35;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.5, t + 0.08);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
  trem.connect(tremGain).connect(g.gain);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 500;
  osc.connect(lp).connect(g).connect(master);
  osc.start(t);
  trem.start(t);
  osc.stop(t + 0.75);
  trem.stop(t + 0.75);
}

/** Dull thud + crunch when the player takes damage (synthesized). */
export function hurtSound() {
  if (!ctx || !master) return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.frequency.setValueAtTime(130, t);
  osc.frequency.exponentialRampToValueAtTime(40, t + 0.18);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.7, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + 0.25);
}

/** Quick rising "glug" when drinking a potion (synthesized). */
export function potionSound() {
  if (!ctx || !master) return;
  const t = ctx.currentTime;
  for (let i = 0; i < 3; i++) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    const s = t + i * 0.11;
    osc.frequency.setValueAtTime(220 + i * 70, s);
    osc.frequency.exponentialRampToValueAtTime(420 + i * 90, s + 0.09);
    g.gain.setValueAtTime(0.0001, s);
    g.gain.exponentialRampToValueAtTime(0.35, s + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, s + 0.1);
    osc.connect(g).connect(master);
    osc.start(s);
    osc.stop(s + 0.12);
  }
}

/** "Shk" of a blade slicing the air (synthesized): filtered noise burst. */
export function knifeSwish() {
  if (!ctx || !master) return;
  const t = ctx.currentTime;
  const len = Math.floor(ctx.sampleRate * 0.18);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.sin((i / len) * Math.PI) ** 1.5;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(2600, t);
  bp.frequency.exponentialRampToValueAtTime(900, t + 0.16);
  bp.Q.value = 0.9;
  const g = ctx.createGain();
  g.gain.value = 0.55;
  src.connect(bp).connect(g).connect(master);
  src.start(t);
}

/** Heavy stone-on-stone rumble of the huge doors sliding, ending in a deep clunk (synthesized, ~1.8s). */
export function doorSound() {
  if (!ctx || !master) return;
  const t = ctx.currentTime;
  const len = Math.floor(ctx.sampleRate * 1.9);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.min(1, i / 4000) * Math.min(1, (len - i) / 12000);
  const noise = ctx.createBufferSource();
  noise.buffer = buf;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(220, t);
  lp.frequency.linearRampToValueAtTime(520, t + 0.9);
  lp.frequency.linearRampToValueAtTime(160, t + 1.8);
  const g = ctx.createGain();
  g.gain.value = 1.4;
  noise.connect(lp).connect(g).connect(master);
  noise.start(t);
  // low groan
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(46, t);
  osc.frequency.linearRampToValueAtTime(58, t + 0.9);
  osc.frequency.linearRampToValueAtTime(40, t + 1.8);
  const og = ctx.createGain();
  og.gain.setValueAtTime(0.0001, t);
  og.gain.linearRampToValueAtTime(0.25, t + 0.2);
  og.gain.linearRampToValueAtTime(0.0001, t + 1.8);
  const lp2 = ctx.createBiquadFilter();
  lp2.type = 'lowpass';
  lp2.frequency.value = 180;
  osc.connect(lp2).connect(og).connect(master);
  osc.start(t);
  osc.stop(t + 1.9);
  // clunk at the end
  const k = ctx.createOscillator();
  k.frequency.setValueAtTime(90, t + 1.75);
  k.frequency.exponentialRampToValueAtTime(30, t + 1.95);
  const kg = ctx.createGain();
  kg.gain.setValueAtTime(0.0001, t + 1.75);
  kg.gain.exponentialRampToValueAtTime(0.9, t + 1.77);
  kg.gain.exponentialRampToValueAtTime(0.001, t + 2.0);
  k.connect(kg).connect(master);
  k.start(t + 1.75);
  k.stop(t + 2.05);
}

/** Bright rising chime. `big` = the level-complete fanfare (longer, with a higher final note). */
export function missionSound(big = false) {
  if (!ctx || !master) return;
  const t = ctx.currentTime;
  const notes = big ? [523, 659, 784, 1047, 1319] : [659, 880, 1175];
  notes.forEach((f, i) => {
    const osc = ctx!.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = f;
    const g = ctx!.createGain();
    const s = t + i * 0.11;
    g.gain.setValueAtTime(0.0001, s);
    g.gain.exponentialRampToValueAtTime(0.35, s + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, s + (big && i === notes.length - 1 ? 0.9 : 0.35));
    osc.connect(g).connect(master!);
    osc.start(s);
    osc.stop(s + 1.0);
  });
}

/** A shot fired by an enemy: the pistol recording, quieter and a bit lower the further away it is. */
let lastScream = 0;
/** A scared bot's cry: a short rising-then-falling squeal; quieter with distance, each voice a little different. */
export function botScream(distance: number) {
  if (!ctx || !master) return;
  const vol = Math.max(0, 1 - distance / 60);
  const now = performance.now();
  if (vol < 0.05 || now - lastScream < 90) return; // a crowd panicking must not turn into noise
  lastScream = now;
  const t = ctx.currentTime;
  const base = 330 + Math.random() * 330;
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(base, t);
  osc.frequency.exponentialRampToValueAtTime(base * 1.7, t + 0.12);
  osc.frequency.exponentialRampToValueAtTime(base * 1.15, t + 0.4);
  const vib = ctx.createOscillator();
  vib.frequency.value = 9 + Math.random() * 4;
  const vibGain = ctx.createGain();
  vibGain.gain.value = base * 0.04;
  vib.connect(vibGain).connect(osc.frequency);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1100;
  bp.Q.value = 1.2;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.22 * vol, t + 0.05);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
  osc.connect(bp).connect(g).connect(master);
  osc.start(t);
  vib.start(t);
  osc.stop(t + 0.5);
  vib.stop(t + 0.5);
}
export function enemyShot(distance: number) {
  const vol = Math.max(0.12, 1 - distance / 70);
  playClip('pistol-shot', 0.12, 0.7, 1.5 * vol, 0.82);
}

interface Voice { src: AudioBufferSourceNode; gain: GainNode }

/** Play a slice of a file once (after `delay` seconds), fading the last 80ms. */
function playClip(name: Name, offset: number, duration: number, gain: number, rate = 1, delay = 0): Voice | null {
  if (!ctx || !buffers[name]) return null;
  const t = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = buffers[name];
  src.playbackRate.value = rate;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.setValueAtTime(gain, t + duration - 0.08);
  g.gain.linearRampToValueAtTime(0, t + duration);
  src.connect(g).connect(master!);
  src.start(t, offset, duration);
  return { src, gain: g };
}

/** Fade a voice out quickly (used when a reload / pump is interrupted). */
function fadeOut(v: Voice | null) {
  if (!ctx || !v) return;
  const t = ctx.currentTime;
  v.gain.gain.cancelScheduledValues(t);
  v.gain.gain.setValueAtTime(v.gain.gain.value, t);
  v.gain.gain.linearRampToValueAtTime(0, t + 0.05);
  try {
    v.src.stop(t + 0.06);
  } catch {
    /* already stopped */
  }
}

export function pistolShot() {
  playClip('pistol-shot', 0.12, 0.7, 1.9, 0.97 + Math.random() * 0.06); // slight pitch variation
}

let pump: Voice | null = null;
/** Blast now, pump action ~0.4s later (just before the next shot is possible). */
export function shotgunShot() {
  playClip('shotgun-shot', 0.04, 1.2, 0.8);
  fadeOut(pump);
  pump = playClip('shotgun-pump', 0.02, 0.5, 0.6, 1, 0.4);
}

let reload: Voice | null = null;
/** Start the reload sound for a weapon id. Lengths match the weapons' reloadTime. */
export function reloadSound(id: string) {
  fadeOut(reload);
  if (id === 'pistol') reload = playClip('pistol-reload', 0.15, 1.1, 0.9);
  else if (id === 'rifle') reload = playClip('rifle-reload', 0.25, 2.45, 1.5);
  else reload = null;
}

/** Cut the reload / pump sounds (weapon switched or game paused). */
export function stopReloadSound() {
  fadeOut(reload);
  fadeOut(pump);
  reload = pump = null;
}

let loop: { src: AudioBufferSourceNode; gain: GainNode } | null = null;

export function rifleLoopActive() {
  return loop !== null;
}

export function startRifleLoop() {
  if (!ctx || !buffers['rifle-burst'] || loop) return;
  const src = ctx.createBufferSource();
  src.buffer = buffers['rifle-burst'];
  src.loop = true;
  src.loopStart = loopStartT;
  src.loopEnd = loopEndT;
  const gain = ctx.createGain();
  gain.gain.value = 0.75;
  src.connect(gain).connect(master!);
  src.start(ctx.currentTime, BURST_START);
  loop = { src, gain };
}

/** Fade the burst out smoothly (~50ms) instead of cutting it. */
export function stopRifleLoop() {
  if (!ctx || !loop) return;
  const { src, gain } = loop;
  const t = ctx.currentTime;
  gain.gain.cancelScheduledValues(t);
  gain.gain.setValueAtTime(gain.gain.value, t);
  gain.gain.linearRampToValueAtTime(0, t + 0.06);
  src.stop(t + 0.07);
  loop = null;
}
