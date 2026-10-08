import type { LevelStats, Mission } from './missions';
import { emptyStats } from './missions';

// ---------- tunables ----------
export const STAND_HEIGHT = 1.8; // collision height standing
export const CROUCH_HEIGHT = 1.1; // collision height crouching
export const EYE_OFFSET = 0.1; // eyes sit this far below the top of the player
export const PLAYER_RADIUS = 0.4;
export const WALK_SPEED = 6;
export const SPRINT_SPEED = 9; // hold Ctrl
export const CROUCH_SPEED = 3; // hold Shift
export const CROUCH_LERP = 12; // how fast height changes
export const JUMP_SPEED = 7;
export const GRAVITY = 20;
export const MOUSE_SENS = 0.0022;
export const MAX_HEALTH = 100;
export const POINTS_HIT = 10;
export const POINTS_HEADSHOT_KILL = 50; // bonus on top of the costume's own points
export const START_CASH = 500;

export type Phase = 'hub' | 'sealing' | 'loading' | 'airlockReady' | 'arena' | 'exitOpen' | 'returning' | 'unloading' | 'toHub';

/** Held keys by KeyboardEvent.code. */
export const keys: Record<string, boolean> = {};

/**
 * All mutable game state in one place, so the modules can share it (an imported `let` cannot be assigned
 * from another module). Read and write it as `S.health`, `S.cash`, ...
 */
export const S = {
  // player
  health: MAX_HEALTH, // no natural regeneration: heal with potions (bought at the shop, H to drink)
  potions: 0,
  dead: false,
  hurtFlash: 0,
  playerHeight: STAND_HEIGHT, // current (smoothed) height
  crouching: false,
  yaw: 0, // yaw 0 faces -z, toward arena centre
  pitch: 0,
  onGround: true,
  roll: 0, // camera roll shake (radians)
  recoilOffset: 0, // degrees of visual/aim kick that settles back

  // scoring; money comes ONLY from completing missions, and is spent at the shops
  cash: START_CASH,
  kills: 0,
  headshotKills: 0,
  score: 0,
  shotsFired: 0,
  shotsHit: 0,

  // input / pointer
  locked: false,
  trigger: false, // held
  triggerPressed: false, // edge, for semi-auto
  softPaused: false, // shop was closed with Esc: any key / click picks the game back up
  started: false,

  // weapons
  current: 0,
  equipLeft: 0,
  kick: 0, // viewmodel kickback
  swingT: 0, // knife swing animation
  lastShotTime: 0,

  // shops
  shopOpen: false,
  inShop: false,

  // HUD timers
  hitTimer: 0,
  popupTimer: 0,
  bannerTimer: 0,

  // levels and missions
  phase: 'hub' as Phase,
  phaseT: 0,
  level: 1,
  stats: emptyStats() as LevelStats,
  missions: [] as Mission[],
  missionsDone: 0,
};
