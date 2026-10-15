import * as THREE from 'three';
import { initAudio, stopRifleLoop, stopReloadSound, setMuted, isMuted } from '../audio/audio';
import { $, camera, renderer, weapons } from './core';
import { beginReload, cycleWeapon, switchSlot } from './combat';
import { resumeHint, overlay, showBanner, updateSummary } from './hud';
import { usePotion } from './player';
import { rules, closeRules } from './rules';
import { buyItem, pickLevel, shopEnter, shopNavigate, shopWantsMouse, updateShop } from './shops';
import { clearSave, saveProgress } from './save';
import { resetGame } from './session';
import { MOUSE_SENS, S, keys } from './state';
import { settings } from './settings';
import { settingsEl, closeSettings } from './settingsUi';

// Input, pointer lock and the pause menu.
//
// Esc handling. Normally the browser releases the mouse on Esc itself and does NOT deliver that keydown to the
// page, and it then refuses to re-capture the mouse on the next Esc (only a click works). To get a proper
// Esc = pause / Esc = resume, startPlaying() puts the page in fullscreen and uses the Keyboard Lock API
// (Chrome / Edge) so the page receives Esc itself; we then release the mouse from script, and a mouse that was
// released from script can be captured again without a click.
// Without that support: Esc -> pointerlockchange closes the shop (soft pause) or shows the pause menu.

let fullscreenTried = false;
// Keys the game captures while playing, so that Ctrl+W / Ctrl+D / Ctrl+R / Ctrl+H / Ctrl+Shift+... reach the game
// instead of the browser (Chromium keyboard lock, fullscreen only). F1-F12 and the Windows / Meta key are NOT in the
// list on purpose: F11, F5, F12 and the Start menu keep working. While paused only Esc is captured (so Esc resumes).
const PLAY_KEYS = [
  ...Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ', (c) => `Key${c}`),
  ...Array.from('0123456789', (c) => `Digit${c}`),
  'Escape', 'Tab', 'Space', 'Enter', 'Backspace', 'Backquote', 'Minus', 'Equal', 'BracketLeft', 'BracketRight',
  'Semicolon', 'Quote', 'Comma', 'Period', 'Slash', 'Backslash', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight',
];
function setKeyLock(playing: boolean) {
  try {
    (navigator as any).keyboard?.lock?.(playing ? PLAY_KEYS : ['Escape']);
  } catch {
    /* unsupported: fall back to the browser's own Esc behaviour */
  }
}
const lockEscapeKey = () => setKeyLock(false);
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

/** Close the world map: the mouse goes back to the game. */
function closeMap() {
  S.mapOpen = false;
  S.shopOpen = false;
  updateShop();
  S.softPaused = true;
  resumeHint.style.display = 'block';
  startPlaying();
}
$('shopWindow').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('[data-level]') as HTMLButtonElement | null;
  if (b && S.mapOpen && pickLevel(Number(b.dataset.level))) closeMap();
});

addEventListener('keydown', (e) => {
  if (S.mapOpen && !S.locked && (e.code === 'Escape' || e.code === 'KeyE') && !e.repeat) {
    closeMap();
    return;
  }
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
      else if (settingsEl.style.display === 'flex') closeSettings();
      else if (!S.dead) startPlaying();
    } else if (S.softPaused && !e.repeat) {
      startPlaying();
    }
    return;
  }
  keys[e.code] = true;
  if (e.code === 'KeyE' && S.inShop && !e.repeat) {
    S.shopOpen = !S.shopOpen;
    if (S.shopOpen && shopWantsMouse()) {
      S.mapOpen = true;
      document.exitPointerLock(); // free the mouse so the levels can be clicked
    }
    return;
  }
  if (S.shopOpen) {
    // armory: arrow keys move the cursor, Enter buys / equips
    const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.code as 'ArrowLeft'];
    if (dir) {
      shopNavigate(dir[0], dir[1]);
      return;
    }
    if ((e.code === 'Enter' || e.code === 'NumpadEnter') && !e.repeat) {
      shopEnter();
      return;
    }
    // number keys buy while the shop window is open
    const m = /^Digit([1-9])$/.exec(e.code);
    if (m) {
      if (!e.repeat) buyItem(Number(m[1]) - 1);
      return;
    }
  }
  if (e.code === 'Digit1') switchSlot(0);
  if (e.code === 'Digit2') switchSlot(1);
  if (e.code === 'Digit3') switchSlot(2);
  if (e.code === 'Digit4') switchSlot(3);
  if (e.code === 'KeyR') beginReload(weapons[S.current]);
  if (e.code === 'KeyH' && !e.repeat) usePotion();
  if (e.code === 'KeyQ') cycleWeapon(1);
});
addEventListener('keyup', (e) => (keys[e.code] = false));
// While playing, block only what would break the game: browser shortcuts (anything with Ctrl / Alt / Cmd held:
// Ctrl+W, Ctrl+D, Ctrl+R, Ctrl+H, Ctrl+Shift+..., Alt+Left) and the keys that scroll / press buttons (Space, Tab, Enter,
// Backspace). Plain keys, Shift, Esc, the F-keys (F5, F11, F12 ...) and the Windows key are left alone. In the menus nothing is blocked.
addEventListener(
  'keydown',
  (e) => {
    if (!S.locked && !S.shopOpen) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    if (e.code === 'Escape' || /^F\d+$/.test(e.code) || /^(Control|Shift|Alt|Meta)(Left|Right)$/.test(e.code)) return;
    if (e.ctrlKey || e.altKey || e.metaKey || e.code === 'Space' || e.code === 'Tab' || e.code === 'Enter' || e.code === 'Backspace') e.preventDefault();
  },
  { capture: true },
);
// Safety net for shortcuts a normal tab cannot intercept (Ctrl+W = crouch + forward!): ask before leaving, but only
// while actually playing, so closing or reloading from the menu is never nagged.
addEventListener('beforeunload', (e) => {
  if (!S.locked) return;
  e.preventDefault();
  e.returnValue = '';
});
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
  S.yaw -= e.movementX * MOUSE_SENS * settings.sensitivity * S.fovScale; // slower look while zoomed in
  S.pitch -= e.movementY * MOUSE_SENS * settings.sensitivity * S.fovScale;
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
$('btnResume').addEventListener('click', () => {
  if (S.dead) resetGame(); // the death screen's Play: back to the safe room with the saved progress
  startPlaying();
});
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

document.addEventListener('pointerlockchange', () => {
  S.locked = document.pointerLockElement === renderer.domElement;
  if (document.fullscreenElement) setKeyLock(S.locked); // playing: capture the shortcut keys; paused: only Esc
  rules.style.display = 'none';
  settingsEl.style.display = 'none';
  if (S.locked) {
    S.mapOpen = false;
    if (!S.started) {
      showBanner(
        'SAFE ROOM',
        S.level > 1
          ? `Welcome back: level ${S.level} is waiting. Pick a level on the map or walk through the gate.`
          : 'Visit the armory on the right, then walk through the open gate when you are ready.',
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
  if (S.mapOpen) return; // the world map is open: no pause menu, the window stays and the mouse is free
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
  overlay.classList.toggle('dead', S.dead);
  document.querySelector('#overlay .kicker')!.textContent = S.dead ? 'YOUR RUN ENDED' : S.started ? 'GAME PAUSED' : 'FIRST-PERSON ARENA SHOOTER';
  $('title').textContent = S.dead ? 'You died' : S.started ? 'Paused' : 'Lethe Protocol';
  // the death screen only offers Play and New game
  $('btnResume').querySelector('span')!.textContent = S.dead || !S.started ? 'Play' : 'Resume';
  for (const el of document.querySelectorAll<HTMLElement>('#btnReload, #overlay .menurow, #overlay .hintbar')) el.style.display = S.dead ? 'none' : '';
  updateSummary();
});
