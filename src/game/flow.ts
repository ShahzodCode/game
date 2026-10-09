import * as THREE from 'three';
import { COSTUMES, setSpawnRule } from '../entities/mannequin';
import { ARENA_GATE_Z, GATE1_Z } from '../world/rooms';
import { doorSound, missionSound } from '../audio/audio';
import {
  MISSIONS_TO_FINISH, MISSIONS_PER_LEVEL, emptyStats, generateMissions, levelConfig,
} from './missions';
import { $, pos, world } from './core';
import { mannequins, wolves } from './actors';
import { showBanner } from './hud';
import { S, type Phase } from './state';

// Levels, missions and the gate flow.
// safe room --gate 1--> airlock --gate 2--> arena. Walking into the airlock seals gate 1; the level loads while
// both gates are shut; gate 2 then opens. Three finished missions light up gate 2 for the way back.

export const rooms = world.rooms;
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
    S.missionsDone >= MISSIONS_TO_FINISH
      ? 'Level complete! Reach the glowing gate, or finish the rest for more money'
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
      if (S.missionsDone === MISSIONS_TO_FINISH) levelComplete();
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
  rooms.gate2.setOpen(true);
  rooms.setExitLight(true);
  S.phase = 'exitOpen';
  missionSound(true);
  showBanner('LEVEL COMPLETE', 'A bright light has opened at the gate. Leave now, or finish the other missions for more money.', 6);
}

/** Keep new arrivals away from the arena entrance so the player is never ambushed at the door. */
function awayFromEntry(group: THREE.Object3D, minDist = 28) {
  if (group.position.distanceTo(world.arenaEntry) < minDist) group.position.copy(world.randomFreePoint(world.arenaEntry, minDist));
}

/**
 * Building a level (new characters with their detailed models) takes a moment. The work is queued and a couple
 * of items run per frame while the doors are shut, so there is never one long freeze and no loading screen.
 */
let levelWork: (() => void)[] = [];

/** Queue everything the level needs. */
export function startLevel() {
  const cfg = levelConfig(S.level);
  setSpawnRule(cfg.allowed);
  S.stats = emptyStats();
  S.missions = generateMissions(cfg);
  S.missionsDone = 0;
  missionsHtml = '';
  levelWork = [];
  for (const m of mannequins) {
    levelWork.push(() => {
      m.reset(true);
      awayFromEntry(m.group);
    });
  }
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
    const alive = () => mannequins.filter((m) => m.costume.id === id).length;
    for (const m of mannequins) {
      if (alive() >= n) break;
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
        showBanner(`LEVEL ${S.level}`, `${levelConfig(S.level).note} Complete ${MISSIONS_TO_FINISH} of ${MISSIONS_PER_LEVEL} missions.`, 5);
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
        showBanner('SAFE ROOM', `Spend your money, then walk through the gate for level ${S.level}.`, 4.5);
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
  wolves.forEach((w) => w.deactivate()); // the arena itself is rebuilt when the next level starts
  renderMissions();
}
