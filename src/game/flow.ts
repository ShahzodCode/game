import * as THREE from 'three';
import { COSTUMES, COSTUME_CAP, clearSpawnCooldowns, setSpawnRule } from '../entities/mannequin';
import { ARENA_GATE_Z, GATE1_Z } from '../world/rooms';
import { doorSound, missionSound } from '../audio/audio';
import {
  MISSIONS_TO_FINISH, MISSIONS_PER_LEVEL, emptyStats, generateMissions, levelConfig, LAST_HORDE_LEVEL, type HordeCfg,
} from './missions';
import { $, camera, pos, renderer, scene, world } from './core';
import { STAGES, stageForLevel } from '../world/layout';
import { boss, regulars, spawnZombie, wolves, zombieLimit, zombies } from './actors';
import { showBanner } from './hud';
import { questLevelDone } from './quests';
import { S, type Phase } from './state';

// Levels, missions and the gate flow.
// safe room --gate 1--> airlock --gate 2--> arena. Walking into the airlock seals gate 1; the level loads while
// both gates are shut; gate 2 then opens. Three finished missions light up gate 2 for the way back.

export const rooms = world.rooms;
/** Missions to finish a level: 3 of 5, or all of them on the boss level (a single mission). */
const missionsNeeded = () => (S.missions.length >= MISSIONS_PER_LEVEL ? MISSIONS_TO_FINISH : S.missions.length);
const missionsEl = $('missions');
rooms.gate1.onStart = doorSound;
rooms.gate2.onStart = doorSound;

/** The arena (bots, wolves, missions) is only simulated while the player can reach it. */
export const arenaActive = () => S.phase === 'airlockReady' || S.phase === 'arena' || S.phase === 'exitOpen';

export function addScore(n: number) {
  S.score += n;
  S.stats.score += n;
  checkMissions();
}

let missionsHtml = '';
export function renderMissions() {
  const visible = S.missions.length > 0 && (arenaActive() || S.phase === 'sealing' || S.phase === 'loading');
  if (!visible) {
    missionsEl.style.display = 'none';
    return;
  }
  const rows = S.missions
    .map((m, i) => {
      const p = Math.floor(m.progress);
      const pct = Math.round(Math.min(1, m.progress / m.target) * 100);
      return (
        `<div class="m${m.done ? ' done' : ''}"><span class="n">${m.done ? '✓' : i + 1}</span><span class="t">${m.title}</span>` +
        `<span class="p">${p}/${m.target}</span>` +
        (m.done ? '' : `<span class="bar"><i style="width:${pct}%"></i></span>`) +
        `<span class="r">${m.done ? 'Paid' : 'Reward'} $${m.reward}</span></div>`
      );
    })
    .join('');
  const sub =
    S.missionsDone >= missionsNeeded()
      ? 'Level complete! Reach the glowing gate, or finish the rest for more money'
      : levelConfig(S.level).boss
        ? 'Defeat the boss'
        : levelConfig(S.level).horde
          ? 'Survive the horde: finish all three missions'
        : `Complete ${MISSIONS_TO_FINISH} of ${MISSIONS_PER_LEVEL} missions to finish (${S.missionsDone}/${MISSIONS_TO_FINISH})`;
  const html = `<h4>LEVEL ${S.level}</h4><div class="sub">${sub}</div>${rows}`;
  missionsEl.style.display = 'block';
  if (html !== missionsHtml) {
    missionsHtml = html;
    missionsEl.innerHTML = html;
  }
}

/** Re-measure every mission against the level stats; pay out and announce the ones that just completed. */
export function checkMissions() {
  for (const m of S.missions) {
    if (m.done) continue;
    m.progress = Math.min(m.measure(S.stats), m.target);
    if (m.progress >= m.target) {
      m.done = true;
      S.missionsDone++;
      S.cash += m.reward; // the ONLY source of money
      if (S.missionsDone === missionsNeeded()) levelComplete();
      else if (S.missionsDone === MISSIONS_PER_LEVEL) {
        missionSound();
        showBanner('ALL MISSIONS COMPLETE', `${m.title} · +$${m.reward}`, 4);
      } else {
        missionSound();
        showBanner('MISSION COMPLETE', `${m.title} · +$${m.reward}`, 3.5);
      }
    }
  }
  renderMissions();
}

function levelComplete() {
  questLevelDone(S.level, S.stats.hurt === 0);
  rooms.gate2.setOpen(true);
  rooms.setExitLight(true);
  S.phase = 'exitOpen';
  missionSound(true);
  if (levelConfig(S.level).boss) {
    for (const z of zombies) if (z.alive && !z.disabled) z.damage(99999); // the zombies fall with their master
    showBanner('THE COLOSSUS HAS FALLEN', 'But the dead keep rising. Leave through the gate: a horde of zombies waits in level 22.', 9);
    return;
  }
  if (S.level >= LAST_HORDE_LEVEL) {
    for (const z of zombies) if (z.alive && !z.disabled) z.damage(99999);
    showBanner('THE LAST WAVE IS OVER', 'You survived everything the world had left. The horde will keep coming back on the next levels.', 9);
    return;
  }
  showBanner('LEVEL COMPLETE', 'A bright light has opened at the gate. Leave now, or finish the other missions for more money.', 6);
}

/** Keep new arrivals away from the arena entrance so the player is never ambushed at the door. */
function awayFromEntry(group: THREE.Object3D, wanted = 28) {
  const minDist = Math.min(wanted, Math.max(10, (world.region.z1 - world.region.z0) * 0.5)); // small arenas: less room to keep away
  if (group.position.distanceTo(world.arenaEntry) < minDist) group.position.copy(world.randomFreePoint(world.arenaEntry, minDist));
}

/**
 * Building a level (new characters with their detailed models) takes a moment. The work is queued and a couple
 * of items run per frame while the doors are shut, so there is never one long freeze and no loading screen.
 */
let levelWork: (() => void)[] = [];
let shownStage = -1;
let arenaGrew = false;

/** Zombie levels (22+): a director keeps the arena filled with zombies until `total` have been sent. */
let horde: { cfg: HordeCfg; spawned: number; t: number } | null = null;
function pickKind(cfg: HordeCfg) {
  let r = Math.random() * cfg.mix.reduce((n, [, w]) => n + w, 0);
  for (const [id, w] of cfg.mix) if ((r -= w) <= 0) return id;
  return cfg.mix[0][0];
}
function updateHorde(dt: number) {
  if (!horde || S.phase !== 'arena') return;
  const h = horde;
  h.t -= dt;
  if (h.t > 0 || h.spawned >= h.cfg.total) return;
  const alive = zombies.filter((z) => !z.disabled && z.alive).length;
  if (alive >= h.cfg.cap) return;
  // a spot 22-50 m from the player (the zombies come from all around)
  let at = world.randomFreePoint(pos, 22);
  for (let i = 0; i < 6 && Math.hypot(at.x - pos.x, at.z - pos.z) > 50; i++) at = world.randomFreePoint(pos, 22);
  if (spawnZombie(pickKind(h.cfg), at, h.cfg.cap + 4, false)) h.spawned++;
  h.t = h.cfg.every * (0.6 + Math.random() * 0.8);
}

/** Queue everything the level needs. */
export function startLevel() {
  const cfg = levelConfig(S.level);
  setSpawnRule(cfg.allowed);
  S.stats = emptyStats();
  S.missions = generateMissions(cfg);
  S.missionsDone = 0;
  missionsHtml = '';
  clearSpawnCooldowns();
  // the arena grows with the level (layout.ts STAGES): move the walls, reveal the new scenery, fewer people in small arenas
  const stage = stageForLevel(S.level);
  world.setStage(stage);
  renderer.compile(scene, camera); // the lights of the newly revealed houses / camp: compile now, behind the closed doors
  arenaGrew = stage > shownStage && shownStage >= 0;
  shownStage = stage;
  levelWork = [];
  const botCount = cfg.boss || cfg.horde ? 0 : STAGES[stage].bots;
  zombies.forEach((z) => levelWork.push(() => z.disable()));
  zombieLimit.n = 8; // the boss may have 8 zombies out; the horde levels use the whole pool
  horde = cfg.horde ? { cfg: cfg.horde, spawned: 0, t: 2 } : null;
  levelWork.push(() => {
    if (cfg.boss) {
      boss.spawnAs('boss', world.randomFreePoint(world.arenaEntry, 45));
      boss.maxHealth = boss.health = boss.costume.health * (1 + 0.25 * (S.level - 21)); // rematches are tougher
    } else boss.disable();
  });
  regulars.forEach((m, i) => {
    levelWork.push(() => {
      if (i >= botCount) {
        m.disable();
        return;
      }
      m.reset(true);
      awayFromEntry(m.group);
    });
  });
  wolves.forEach((w, i) =>
    levelWork.push(() => {
      if (i < cfg.wolves) {
        w.activate();
        awayFromEntry(w.group, 38);
      } else w.deactivate();
    }),
  );
  levelWork.push(ensureMissionCharacters);
}

/** Make sure the characters the missions ask for really are in the arena (rare ones might not have spawned). */
function ensureMissionCharacters() {
  const wanted = new Map<string, number>();
  for (const m of S.missions) {
    const id = /^kill:(.+)$/.exec(m.key)?.[1];
    if (id && id !== 'wolf') wanted.set(id, Math.max(wanted.get(id) ?? 0, m.target));
  }
  // a character that is new in this level (criminals in 2, ninjas in 7) is guaranteed to show up, at least twice
  for (const c of COSTUMES) if (c.minLevel && c.minLevel > 1 && c.minLevel === S.level) wanted.set(c.id, Math.max(wanted.get(c.id) ?? 0, 2));
  for (const [id, n] of wanted) {
    const alive = () => regulars.filter((m) => !m.disabled && m.costume.id === id).length;
    const want = Math.min(n, COSTUME_CAP[id] ?? n);
    for (const m of regulars) {
      if (m.disabled) continue;
      if (alive() >= want) break;
      if (!wanted.has(m.costume.id)) m.forceCostume(id); // never steal a bot another mission needs
    }
  }
}

/** Run up to `count` queued items. True when the queue is empty. */
export function runLevelWork(count: number) {
  while (count-- > 0 && levelWork.length) levelWork.shift()!();
  return levelWork.length === 0;
}
function enterPhase(p: Phase) {
  S.phase = p;
  S.phaseT = 0;
  renderMissions();
}

export function updateFlow(dt: number) {
  S.phaseT += dt;
  updateHorde(dt);
  const centred = Math.abs(pos.x) < 7;
  switch (S.phase) {
    case 'hub':
      // a few steps into the airlock: the first doors seal behind the player
      if (pos.z < GATE1_Z - 4 && pos.z > ARENA_GATE_Z && centred) {
        rooms.gate1.setOpen(false);
        enterPhase('sealing');
      }
      break;
    case 'sealing':
      if (rooms.gate1.isClosed) {
        // The level is built right here, behind the closed doors. It is quick, so there is no loading screen,
        // just a short beat before the far doors open.
        startLevel();
        enterPhase('loading');
      }
      break;
    case 'loading':
      // the queued level work runs here, a couple of characters per frame, then a short beat before the doors open
      if (runLevelWork(2) && S.phaseT > 0.6) {
        rooms.gate2.setOpen(true);
        enterPhase('airlockReady');
        showBanner(`LEVEL ${S.level}`, `${arenaGrew ? 'The arena has grown! ' : ''}${levelConfig(S.level).note} ${levelConfig(S.level).boss || levelConfig(S.level).horde ? '' : `Complete ${MISSIONS_TO_FINISH} of ${MISSIONS_PER_LEVEL} missions.`}`, 5);
      }
      break;
    case 'airlockReady':
      if (pos.z < ARENA_GATE_Z - 1.5) {
        rooms.gate2.setOpen(false); // the way back is sealed until the level is beaten
        enterPhase('arena');
      }
      break;
    case 'exitOpen':
      if (pos.z > ARENA_GATE_Z + 3 && centred) {
        rooms.gate2.setOpen(false);
        rooms.setExitLight(false);
        enterPhase('returning');
      }
      break;
    case 'returning':
      if (rooms.gate2.isClosed) enterPhase('unloading');
      break;
    case 'unloading':
      if (S.phaseT > 0.6) {
        S.level++;
        rooms.gate1.setOpen(true);
        enterPhase('toHub');
      }
      break;
    case 'toHub':
      if (pos.z > GATE1_Z + 2) {
        enterPhase('hub');
        showBanner('SAFE ROOM', `Spend your money, check the quest board at the back wall, then walk through the gate for level ${S.level}.`, 5.5);
      }
      break;
  }
}

/** Back to the safe room with the doors in their starting state (the level number is kept). */
export function resetFlow() {
  S.phase = 'hub';
  S.phaseT = 0;
  S.stats = emptyStats();
  S.missions = [];
  S.missionsDone = 0;
  missionsHtml = '';
  rooms.gate1.setOpen(true, true);
  rooms.gate2.setOpen(false, true);
  rooms.setExitLight(false);
  levelWork = [];
  horde = null;
  wolves.forEach((w) => w.deactivate()); // the arena itself is rebuilt when the next level starts
  renderMissions();
}
