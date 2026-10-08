import * as THREE from 'three';
import { initAudio, stopRifleLoop, stopReloadSound, setMuted, isMuted } from '../audio/audio';
import { $, camera, renderer, weapons } from './core';
import { beginReload, cycleWeapon, switchWeapon } from './combat';
import { resumeHint, overlay, showBanner, updateSummary } from './hud';
import { usePotion } from './player';
import { rules, closeRules } from './rules';
import { buyItem, updateShop } from './shops';
import { clearSave, saveProgress } from './save';
import { resetGame } from './session';
import { MOUSE_SENS, S, keys } from './state';

// Input, pointer lock and the pause menu.
//
// Esc handling. Normally the browser releases the mouse on Esc itself and does NOT deliver that keydown to the
// page, and it then refuses to re-capture the mouse on the next Esc (only a click works). To get a proper
// Esc = pause / Esc = resume, startPlaying() puts the page in fullscreen and uses the Keyboard Lock API
// (Chrome / Edge) so the page receives Esc itself; we then release the mouse from script, and a mouse that was
// released from script can be captured again without a click.
// Without that support: Esc -> pointerlockchange closes the shop (soft pause) or shows the pause menu.

let fullscreenTried = false;
function lockEscapeKey() {
  try {
    (navigator as any).keyboard?.lock?.(['Escape']); // delivers Esc to the page (needs fullscreen; Chromium only)
  } catch {
    /* unsupported: fall back to the browser's own Esc behaviour */
  }
}
function capturePointer() {
  try {
    // returns a promise in modern browsers; it rejects if the browser refuses (e.g. right after a manual Esc)
    (renderer.domElement.requestPointerLock() as unknown as Promise<void> | undefined)?.catch?.(() => {});
  } catch {
    /* ignore: the Resume button / a click will retry */
  }
}
function startPlaying() {
  initAudio();
  const root = document.documentElement;
  if (!fullscreenTried && !document.fullscreenElement && root.requestFullscreen) {
    // first time only: go fullscreen (a normal thing for a shooter) so that Esc can be used to pause / resume
    fullscreenTried = true;
    root.requestFullscreen().then(() => { lockEscapeKey(); capturePointer(); }).catch(() => capturePointer());
    return;
  }
  if (document.fullscreenElement) lockEscapeKey();
  capturePointer();
}

addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && S.locked) {
    // only reached when the page really receives Esc (keyboard lock active)
    e.preventDefault();
    if (S.shopOpen) {
      S.shopOpen = false; // Esc closes the shop first
      updateShop();
    } else {
      document.exitPointerLock(); // pause menu appears via pointerlockchange
    }
    return;
  }
  if (!S.locked) {
    if (e.code === 'Escape') {
      if (rules.style.display === 'flex') closeRules();
      else if (!S.dead) startPlaying();
    } else if (S.softPaused && !e.repeat) {
      startPlaying();
    }
    return;
  }
  keys[e.code] = true;
  if (e.code === 'KeyE' && S.inShop && !e.repeat) {
    S.shopOpen = !S.shopOpen;
    return;
  }
  if (S.shopOpen) {
    // number keys buy while the shop window is open
    const m = /^Digit([1-9])$/.exec(e.code);
    if (m) {
      if (!e.repeat) buyItem(Number(m[1]) - 1);
      return;
    }
  }
  if (e.code === 'Digit1') switchWeapon(0);
  if (e.code === 'Digit2') switchWeapon(1);
  if (e.code === 'Digit3') switchWeapon(2);
  if (e.code === 'Digit4') switchWeapon(3);
  if (e.code === 'Digit5') switchWeapon(4);
  if (e.code === 'Digit6') switchWeapon(5);
  if (e.code === 'Digit7') switchWeapon(6);
  if (e.code === 'Digit8') switchWeapon(7);
  if (e.code === 'KeyR') beginReload(weapons[S.current]);
  if (e.code === 'KeyH' && !e.repeat) usePotion();
  if (e.code === 'KeyQ') cycleWeapon(1);
});
addEventListener('keyup', (e) => (keys[e.code] = false));
addEventListener('mousedown', (e) => {
  if (!S.locked) {
    if (S.softPaused) startPlaying();
    return;
  }
  if (e.button === 0) {
    S.trigger = true;
    S.triggerPressed = true;
  }
  if (e.button === 2) S.aiming = true; // aim down the sights
});
addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('mouseup', (e) => {
  if (e.button === 0) S.trigger = false;
  if (e.button === 2) S.aiming = false;
});
addEventListener('wheel', (e) => {
  if (S.locked) cycleWeapon(e.deltaY > 0 ? 1 : -1);
});
addEventListener('mousemove', (e) => {
  if (!S.locked) return;
  S.yaw -= e.movementX * MOUSE_SENS * S.fovScale; // slower look while zoomed in
  S.pitch -= e.movementY * MOUSE_SENS * S.fovScale;
  S.pitch = THREE.MathUtils.clamp(S.pitch, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
});
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------- pause menu ----------
// mute toggle (remembered between visits)
const btnMute = $('btnMute');
function applyMute(m: boolean) {
  setMuted(m);
  btnMute.classList.toggle('muted', m);
  btnMute.setAttribute('aria-label', m ? 'Unmute sound' : 'Mute sound');
  try {
    localStorage.setItem('botshooter.muted', m ? '1' : '0');
  } catch {
    /* storage unavailable */
  }
}
try {
  applyMute(localStorage.getItem('botshooter.muted') === '1');
} catch {
  applyMute(false);
}
btnMute.addEventListener('click', () => applyMute(!isMuted()));
$('btnResume').addEventListener('click', startPlaying);
$('btnReload').addEventListener('click', () => {
  resetGame(); // keeps your saved progress
  startPlaying();
});
$('btnNew').addEventListener('click', () => {
  if (!confirm('Start a brand-new game? This erases your saved level, money, weapons and ammo.')) return;
  clearSave();
  resetGame(true);
  saveProgress();
  startPlaying();
});
// TEST ONLY: free cash for trying out the shop. Remove this button (and #btnCash in index.html) before release.
$('btnCash').addEventListener('click', () => {
  S.cash += 100000;
  updateSummary();
});

document.addEventListener('pointerlockchange', () => {
  S.locked = document.pointerLockElement === renderer.domElement;
  rules.style.display = 'none';
  if (S.locked) {
    if (!S.started) {
      showBanner(
        'SAFE ROOM',
        S.level > 1
          ? `Welcome back: level ${S.level} is waiting. Shop on the left, then walk through the gate.`
          : 'Visit the weapon shop on the left, then walk through the open gate when you are ready.',
        6,
      );
    }
    S.started = true;
    S.softPaused = false;
    overlay.style.display = 'none';
    resumeHint.style.display = 'none';
    return;
  }
  S.trigger = false;
  S.aiming = false;
  stopRifleLoop();
  stopReloadSound();
  for (const k in keys) keys[k] = false;
  const closedShopWithEsc = S.shopOpen && !S.dead;
  S.shopOpen = false;
  updateShop(); // hide the shop window straight away
  if (closedShopWithEsc) {
    // Esc closed the shop: no pause menu, just wait for any key / click to continue
    S.softPaused = true;
    overlay.style.display = 'none';
    resumeHint.style.display = 'block';
    startPlaying(); // works in browsers that allow an instant re-lock; otherwise the hint covers it
    return;
  }
  S.softPaused = false;
  resumeHint.style.display = 'none';
  overlay.style.display = 'flex';
  $('title').textContent = S.dead ? 'You died' : S.started ? 'Paused' : 'Bot Shooter';
  $('btnResume').style.display = S.dead ? 'none' : '';
  $('btnResume').textContent = S.started ? 'Resume' : 'Play';
  $('btnReload').textContent = S.dead ? 'Play again' : 'Reload map';
  updateSummary();
});
