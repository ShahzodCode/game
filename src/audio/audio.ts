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
let volume = 1; // 0..1, the volume slider
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
    master.gain.value = muted ? 0 : volume;
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
  if (master && ctx) master.gain.setTargetAtTime(m ? 0 : volume, ctx.currentTime, 0.02);
}
export function setVolume(v: number) {
  volume = Math.min(1, Math.max(0, v));
  if (master && ctx) master.gain.setTargetAtTime(muted ? 0 : volume, ctx.currentTime, 0.02);
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
/** Superman's punch: a rising whoosh for the wind-up, a heavy thud when it connects, a dull whoosh when it misses. */
export function punchSound(phase: 'wind' | 'hit' | 'miss') {
  if (!ctx || !master) return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  if (phase === 'hit') {
    osc.type = 'sine';
    osc.frequency.setValueAtTime(110, t);
    osc.frequency.exponentialRampToValueAtTime(32, t + 0.3);
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
  } else {
    osc.type = 'sawtooth';
    const lo = phase === 'wind' ? 70 : 200;
    osc.frequency.setValueAtTime(lo, t);
    osc.frequency.exponentialRampToValueAtTime(phase === 'wind' ? 240 : 70, t + (phase === 'wind' ? 0.55 : 0.25));
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(phase === 'wind' ? 0.16 : 0.2, t + (phase === 'wind' ? 0.5 : 0.06));
    g.gain.exponentialRampToValueAtTime(0.001, t + (phase === 'wind' ? 0.6 : 0.3));
  }
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = phase === 'hit' ? 400 : 700;
  osc.connect(lp).connect(g).connect(master);
  osc.start(t);
  osc.stop(t + 0.65);
}
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
  else {
    reload = null;
    synthReload(id);
  }
}

/** Cut the reload / pump sounds (weapon switched or game paused). */
export function stopReloadSound() {
  fadeOut(reload);
  fadeOut(pump);
  reload = pump = null;
  cutSynthReload();
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

// ---------------------------------------------------------------------------------------------
// Synthesized sounds for the newer weapons, the explosion, and the player's footsteps / landings.
// ---------------------------------------------------------------------------------------------
let noiseBuf: AudioBuffer | null = null;
function noise(): AudioBuffer {
  if (!noiseBuf) {
    noiseBuf = ctx!.createBuffer(1, ctx!.sampleRate, ctx!.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}
/** A burst of filtered noise: `type` filter at `freq`, `peak` volume, `dur` seconds, starting `delay` from now. */
function noiseBurst(type: BiquadFilterType, freq: number, peak: number, dur: number, delay = 0, q = 0.7, sweepTo?: number): GainNode | null {
  if (!ctx || !master) return null;
  const t = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = noise();
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, t);
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + Math.min(0.01, dur / 4));
  g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.05);
  return g;
}
/** A pitched thump / tone that glides from f0 to f1. */
function tone(type: OscillatorType, f0: number, f1: number, peak: number, dur: number, delay = 0): GainNode | null {
  if (!ctx || !master) return null;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.03);
  return g;
}

/** Gunshots of the newer weapons. */
export function synthShot(kind: 'smg' | 'sniper' | 'crossbow' | 'launcher') {
  if (!ctx || !master) return;
  if (kind === 'smg') {
    noiseBurst('highpass', 1800 + Math.random() * 600, 0.5, 0.07);
    noiseBurst('bandpass', 900, 0.5, 0.09, 0, 0.8);
    tone('sine', 190, 70, 0.55, 0.08);
  } else if (kind === 'sniper') {
    noiseBurst('highpass', 2500, 0.9, 0.05);
    noiseBurst('lowpass', 2200, 0.7, 0.9, 0, 0.7, 120); // the long rolling echo
    tone('sine', 110, 28, 0.9, 0.55);
    // bolt action: lift, pull back, push, lock
    for (const [d, f] of [[0.6, 2600], [0.82, 1800], [1.0, 2100], [1.14, 3000]] as const) {
      noiseBurst('bandpass', f, 0.18, 0.04, d, 6);
      tone('square', f / 5, f / 7, 0.05, 0.03, d);
    }
  } else if (kind === 'crossbow') {
    tone('triangle', 520, 150, 0.5, 0.2); // string twang
    tone('sine', 260, 110, 0.35, 0.28);
    noiseBurst('bandpass', 3200, 0.22, 0.05, 0, 3);
  } else {
    noiseBurst('lowpass', 900, 0.8, 0.16, 0, 0.7, 200); // "thunk" of the launching charge
    tone('sine', 150, 40, 0.8, 0.3);
    noiseBurst('highpass', 3000, 0.25, 0.04);
  }
}

/** Boom of a grenade. Quieter and duller with distance. */
export function explosionSound(distance: number) {
  if (!ctx || !master) return;
  const vol = Math.max(0.1, 1 - distance / 120);
  noiseBurst('lowpass', 1800, 1.0 * vol, 1.1, 0, 0.7, 70);
  noiseBurst('highpass', 1500, 0.5 * vol, 0.12);
  tone('sine', 85, 24, 1.0 * vol, 0.9);
  tone('sawtooth', 60, 20, 0.35 * vol, 0.6);
}

let synthReloadGains: GainNode[] = [];
/** Mechanical clicks for the reload of a weapon that has no recording (spread over its reload time). */
function synthReload(id: string) {
  if (!ctx || !master) return;
  const plan: Record<string, [number, number][]> = {
    smg: [[0.15, 1800], [0.55, 2400], [1.05, 1500], [1.4, 2800]], // mag out, mag in, slap, charge
    sniper: [[0.3, 2200], [0.9, 1600], [1.7, 2600], [2.1, 1900], [2.6, 2900]], // bolt open, mag, rounds, bolt shut
    crossbow: [[0.2, 1200], [0.7, 2000], [1.2, 1500], [1.45, 3200]], // crank, crank, bolt placed, latch
    launcher: [[0.4, 1400], [1.0, 2200], [1.6, 1700], [2.2, 2400], [2.9, 3000]], // open, drum out, drum in, close
    shotgun: [[0.3, 2000], [0.7, 2200], [1.1, 2000], [1.5, 2200], [1.9, 2800]], // shells going in
  };
  for (const [d, f] of plan[id] ?? []) {
    const a = noiseBurst('bandpass', f, 0.28, 0.05, d, 5);
    const b = tone('square', f / 6, f / 9, 0.06, 0.04, d);
    if (a) synthReloadGains.push(a);
    if (b) synthReloadGains.push(b);
  }
}
function cutSynthReload() {
  if (!ctx) return;
  const t = ctx.currentTime;
  for (const g of synthReloadGains) {
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(0.0001, t);
  }
  synthReloadGains = [];
}

/** Soft footstep (volume 0..1). */
export function stepSound(vol: number) {
  noiseBurst('lowpass', 500 + Math.random() * 250, 0.16 * vol, 0.09);
}
/** Thud of landing: bigger for harder landings (intensity 0..1). */
export function landSound(intensity: number) {
  noiseBurst('lowpass', 420, 0.5 * intensity + 0.1, 0.18);
  tone('sine', 110, 45, 0.45 * intensity, 0.16);
}
/** Sharp click of an arrow / bolt sticking into something. */
export function boltHitSound(distance: number) {
  const vol = Math.max(0.1, 1 - distance / 80);
  noiseBurst('bandpass', 1500, 0.3 * vol, 0.05, 0, 2);
  tone('square', 220, 90, 0.12 * vol, 0.06);
}

/** Splashing through water (vol 0..1). */
export function splashSound(vol: number) {
  noiseBurst('bandpass', 1400, 0.3 * vol + 0.05, 0.22, 0, 0.6, 500);
  noiseBurst('lowpass', 600, 0.25 * vol, 0.3);
}
/** A door creaking as it swings (volume falls with the player's distance). */
export function doorCreak(distance: number) {
  const vol = Math.max(0, 1 - distance / 14);
  if (vol < 0.05 || !ctx || !master) return;
  tone('sawtooth', 140, 210, 0.07 * vol, 0.5);
  tone('square', 90, 130, 0.04 * vol, 0.45, 0.05);
}
