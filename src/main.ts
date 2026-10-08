import * as THREE from 'three';
import { Weapon, WEAPONS, buildViewModel } from './weapons/weapons';
import { buildWorld } from './world/world';
import { Mannequin, COSTUMES, setSpawnRule, type BotHooks } from './entities/mannequin';
import { Wolf, WOLF_INFO } from './entities/wolf';
import {
  MISSIONS_TO_FINISH, MISSIONS_PER_LEVEL, emptyStats, generateMissions, levelConfig,
  type LevelStats, type Mission,
} from './game/missions';
import { ARENA_GATE_Z, GATE1_Z } from './world/rooms';
import { SHOP_IMAGES, POTION, weaponShopImage } from './shop/shopItems';
import {
  initAudio, pistolShot, shotgunShot, startRifleLoop, stopRifleLoop, rifleLoopActive, reloadSound, stopReloadSound,
  setMuted, isMuted, wolfGrowl, hurtSound, potionSound, knifeSwish, enemyShot, doorSound, missionSound,
} from './audio/audio';

// ---------- tunables ----------
const STAND_HEIGHT = 1.8; // collision height standing
const CROUCH_HEIGHT = 1.1; // collision height crouching
const EYE_OFFSET = 0.1; // eyes sit this far below the top of the player
const PLAYER_RADIUS = 0.4;
const WALK_SPEED = 6;
const SPRINT_SPEED = 9; // hold Ctrl
const CROUCH_SPEED = 3; // hold Shift
const CROUCH_LERP = 12; // how fast height changes
const JUMP_SPEED = 7;
const GRAVITY = 20;
const MOUSE_SENS = 0.0022;

// ---------- scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 400);
camera.rotation.order = 'YXZ';
scene.add(camera);

const world = buildWorld(scene);
const START = world.playerStart.clone();
const pos = START.clone(); // player feet position
// how fighting bots (shooting cowboys, knife criminals) reach the player
const playerChestV = new THREE.Vector3();
const losRay = new THREE.Raycaster();
function hasLineOfSight(from: THREE.Vector3, to: THREE.Vector3) {
  const d = to.clone().sub(from);
  const dist = d.length();
  losRay.set(from, d.normalize());
  losRay.far = dist;
  return losRay.intersectObjects(world.blockers, false).length === 0; // terrain, crates and rocks block sight
}
const botHooks: BotHooks = {
  hurtPlayer: (d) => damagePlayer(d),
  shotFired: (from, to) => {
    spawnTracer(from, to, 0xff8a5a);
    enemyShot(from.distanceTo(pos));
  },
  stab: () => knifeSwish(),
  lineOfSight: hasLineOfSight,
  playerChest: () => playerChestV.set(pos.x, pos.y + playerHeight * 0.7, pos.z),
  playerDead: () => dead,
};
setSpawnRule(levelConfig(1).allowed); // level 1 has no criminals
const mannequins = world.spawnPoints.map((p) => {
  const m = new Mannequin(world, p, pos, botHooks);
  scene.add(m.group);
  return m;
});

// wolves: calm until shot (see wolf.ts). The level decides how many of them are active (none in level 1).
const MAX_WOLVES = 6;
const wolves = Array.from({ length: MAX_WOLVES }, () => {
  const w = new Wolf(world, world.randomFreePoint(world.arenaEntry, 35), pos, {
    hurtPlayer: (d) => damagePlayer(d),
    onAggro: () => wolfGrowl(),
  });
  w.deactivate();
  scene.add(w.group);
  return w;
});
/** Anything the player can shoot (same interface on bots and wolves). */
type Target = Mannequin | Wolf;

// ---------- player ----------
const vel = new THREE.Vector3();
const MAX_HEALTH = 100;
let health = MAX_HEALTH; // no natural regeneration: heal with potions (bought at the shop, H to drink)
let potions = 0;
let dead = false;
let hurtFlash = 0;
let playerHeight = STAND_HEIGHT; // current (smoothed) height
let crouching = false;
let yaw = 0; // yaw 0 faces -z, toward arena centre
let pitch = 0;
let onGround = true;
// scoring
const POINTS_HIT = 10;
const POINTS_HEADSHOT_KILL = 50; // bonus on top of the costume's own points
const START_CASH = 500;
let cash = START_CASH; // money comes ONLY from completing missions; spent at the shops
let kills = 0;
let headshotKills = 0;
let score = 0;
let shotsFired = 0;
let shotsHit = 0;
let recoilOffset = 0; // degrees of visual/aim kick that settles back
let roll = 0; // camera roll shake (radians)

const keys: Record<string, boolean> = {};
let locked = false;
let trigger = false; // held
let triggerPressed = false; // edge, for semi-auto

// ---------- weapons ----------
const weapons = WEAPONS.map((s) => new Weapon(s));
const viewModels = WEAPONS.map((s) => {
  const g = buildViewModel(s.id);
  g.position.set(0.25, -0.22, -0.5);
  g.visible = false;
  camera.add(g);
  return g;
});
const flashLight = new THREE.PointLight(0xffc266, 0, 6);
camera.add(flashLight);
let current = 0;
let equipLeft = 0;
let kick = 0; // viewmodel kickback
viewModels[0].visible = true;

function switchWeapon(i: number) {
  if (i === current || i < 0 || i >= weapons.length) return;
  if (!weapons[i].owned) {
    showPopup(`${weapons[i].stats.name} not owned - buy it at the shop`, '#ff9a4a');
    return;
  }
  weapons[current].reloadLeft = 0;
  stopRifleLoop();
  stopReloadSound();
  viewModels[current].visible = false;
  current = i;
  viewModels[current].visible = true;
  equipLeft = weapons[current].stats.equipTime;
}

/** Next / previous weapon that the player actually owns. */
function cycleWeapon(dir: number) {
  const n = weapons.length;
  for (let k = 1; k < n; k++) {
    const i = (current + dir * k + n * k) % n;
    if (weapons[i].owned) return switchWeapon(i);
  }
}

/** Start reloading (if possible) and play the weapon's reload sound. */
function beginReload(w: Weapon) {
  if (w.stats.melee) return;
  if (w.startReload()) reloadSound(w.stats.id);
}

// ---------- audio ----------
let lastShotTime = 0;
/** Pistol: one-shot per bullet. Rifle: looped burst while firing (stops via the frame loop when shots stop). */
function shotSound(w: Weapon) {
  lastShotTime = performance.now();
  if (w.stats.id === 'pistol') pistolShot();
  else if (w.stats.id === 'shotgun') shotgunShot();
  else if (w.stats.melee) knifeSwish();
  else startRifleLoop(); // no-op if already running
}

// ---------- effects ----------
interface Fx { obj: THREE.Object3D; life: number; max: number }
const fx: Fx[] = [];
function spawnTracer(from: THREE.Vector3, to: THREE.Vector3, color: number) {
  const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true }));
  scene.add(line);
  fx.push({ obj: line, life: 0.06, max: 0.06 });
}
function spawnImpact(p: THREE.Vector3, color: number) {
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 6, 6),
    new THREE.MeshBasicMaterial({ color, transparent: true }),
  );
  m.position.copy(p);
  scene.add(m);
  fx.push({ obj: m, life: 0.2, max: 0.2 });
}

// ---------- HUD ----------
const $ = (id: string) => document.getElementById(id)!;
const hudWeapon = $('weapon');
const hudAmmo = $('ammo');
const hudKills = $('kills');
const hudScore = $('scoreValue');
const hudAccuracy = $('accuracy');
const hudCash = $('cash');
const potionsEl = $('potions');
const potionText = $('potionText');
const shopHint = $('shopHint');
const shopWindow = $('shopWindow');
const healthFill = $('healthFill');
const healthText = $('healthText');
const hurtOverlay = $('hurt');
const resumeHint = $('resumeHint');
const popup = $('popup');
const hitmarker = $('hitmarker');
const overlay = $('overlay');
let hitTimer = 0;
let popupTimer = 0;
const accuracyText = () => (shotsFired ? `${Math.round((shotsHit / shotsFired) * 100)}%` : '--');
function updateHud() {
  const w = weapons[current];
  hudWeapon.textContent = w.stats.name;
  hudAmmo.innerHTML = w.stats.melee ? '<small>melee</small>' : w.reloading ? 'Reloading...' : `${w.ammo}<small> / ${w.spare.length} mags</small>`;
  hudScore.textContent = `Score ${score}`;
  hudCash.textContent = `$${cash}`;
  hudKills.textContent = `Kills ${kills}` + (headshotKills ? ` (${headshotKills} headshots)` : '');
  hudAccuracy.textContent = `Accuracy ${accuracyText()}`;
  const hp = Math.max(0, health) / MAX_HEALTH;
  healthFill.style.width = `${hp * 100}%`;
  healthFill.style.background = `hsl(${hp * 120}, 70%, 48%)`;
  healthText.textContent = String(Math.ceil(Math.max(0, health)));
  potionsEl.style.display = potions > 0 ? 'flex' : 'none';
  potionText.innerHTML = `× ${potions} <kbd>H</kbd>`;
}

/** Drink a health potion (H). */
function usePotion() {
  if (dead || potions <= 0) return;
  if (health >= MAX_HEALTH) return showPopup('Health already full', '#ff9a4a');
  potions--;
  health = Math.min(MAX_HEALTH, health + POTION.heal);
  potionSound();
  showPopup(`+${POTION.heal} health`, '#7dff9b');
}

// ---------- player health ----------
function damagePlayer(amount: number) {
  if (dead) return;
  health -= amount;
  hurtFlash = 1;
  hurtSound();
  if (health <= 0) {
    health = 0;
    dead = true;
    stopRifleLoop();
    stopReloadSound();
    document.exitPointerLock(); // frees the mouse; the pointerlockchange handler shows the death screen
  }
}
function showPopup(text: string, color = '#ffd84a') {
  popup.textContent = text;
  popup.style.color = color;
  popupTimer = 1;
}

// ---------- shops ----------
// Two shops: the WEAPON shop in the safe room (sells guns) and the SUPPLY shop next to the arena gate
// (magazines for the guns you own + health potions). Stand in a shop's green circle -> "Press E" hint ->
// E opens its window -> press the item's number to buy.
interface ShopCard { image: string; name: string; price: string; sub: string; off: boolean }
interface ShopDef {
  title: string;
  pos: THREE.Vector3;
  radius: number;
  cards: () => ShopCard[];
  buy: (i: number) => void;
}
const rooms = world.rooms;
/** Magazines are only sold for owned guns; melee weapons have none. */
const ownedGuns = () => weapons.map((_, i) => i).filter((i) => !weapons[i].stats.melee && weapons[i].owned);
const lockedGuns = () => weapons.map((_, i) => i).filter((i) => !weapons[i].stats.melee && weapons[i].stats.unlockPrice > 0);

const shops: ShopDef[] = [
  {
    title: 'WEAPON SHOP',
    pos: rooms.hubShop.pos,
    radius: rooms.hubShop.radius,
    cards: () =>
      lockedGuns().map((i) => {
        const w = weapons[i];
        const s = w.stats;
        if (w.owned) return { image: weaponShopImage(s.id, false), name: s.name, price: 'OWNED', sub: 'Buy shells at the supply shop by the arena gate', off: true };
        return { image: weaponShopImage(s.id, false), name: s.name, price: `$${s.unlockPrice}`, sub: `Includes ${s.magSize} rounds + 1 spare magazine`, off: cash < s.unlockPrice };
      }),
    buy: (n) => {
      const i = lockedGuns()[n];
      if (i === undefined) return;
      const w = weapons[i];
      const { name, unlockPrice } = w.stats;
      if (w.owned) return showPopup(`You already own the ${name}`, '#ff9a4a');
      if (cash < unlockPrice) return showPopup('Not enough cash', '#ff5a5a');
      cash -= unlockPrice;
      w.unlock();
      showPopup(`${name} unlocked  -$${unlockPrice}`, '#7dff9b');
    },
  },
  {
    title: 'SUPPLY SHOP',
    pos: world.shop.pos,
    radius: world.shop.radius,
    cards: () => {
      const cards: ShopCard[] = ownedGuns().map((i) => {
        const w = weapons[i];
        const s = w.stats;
        const full = !w.canBuyMag;
        return {
          image: weaponShopImage(s.id, true),
          name: s.id === 'shotgun' ? 'Shotgun shells' : `${s.name} magazine`,
          price: full ? 'FULL' : `$${s.magPrice}`,
          sub: `${s.magSize} rounds · carrying ${w.spare.length}/${s.maxMags}`,
          off: full || cash < s.magPrice,
        };
      });
      const full = potions >= POTION.max;
      cards.push({
        image: SHOP_IMAGES.potion,
        name: POTION.name,
        price: full ? 'FULL' : `$${POTION.price}`,
        sub: `Heals ${POTION.heal} (drink with H) · carrying ${potions}/${POTION.max}`,
        off: full || cash < POTION.price,
      });
      return cards;
    },
    buy: (n) => {
      const guns = ownedGuns();
      if (n === guns.length) return buyPotion();
      if (guns[n] !== undefined) buyMag(guns[n]);
    },
  },
];
let activeShop: ShopDef | null = null;
let inShop = false;
let shopOpen = false;
let shopHtml = '';

function updateShop() {
  activeShop = null;
  for (const s of shops) {
    const dx = pos.x - s.pos.x, dz = pos.z - s.pos.z;
    if (Math.hypot(dx, dz) < s.radius && Math.abs(pos.y - s.pos.y) < 2.5) activeShop = s;
  }
  inShop = !!activeShop;
  if (!inShop) shopOpen = false; // walking away closes the window
  shopHint.style.display = inShop && !shopOpen ? 'block' : 'none';
  shopWindow.style.display = shopOpen ? 'block' : 'none';
  if (inShop && !shopOpen) {
    shopHint.innerHTML = `<kbd>E</kbd>Open ${activeShop!.title.toLowerCase()}`;
  } else if (shopOpen && activeShop) {
    const list = activeShop.cards();
    const cards = list
      .map(
        (c, i) =>
          `<div class="shopitem${c.off ? ' off' : ''}"><kbd>${i + 1}</kbd><img src="${c.image}" alt="" />` +
          `<div class="name">${c.name}</div><div class="price">${c.price}</div><div class="sub">${c.sub}</div></div>`,
      )
      .join('');
    const html =
      `<h3>${activeShop.title}</h3><div class="cashline">Cash $${cash}</div><div class="shopgrid">${cards}</div>` +
      `<div class="foot">Press the item's number to buy · E to close</div>`;
    if (html !== shopHtml) {
      shopHtml = html;
      shopWindow.innerHTML = html;
    }
  }
}

function buyItem(i: number) {
  activeShop?.buy(i);
}
function buyPotion() {
  if (potions >= POTION.max) return showPopup('Potion pouch full', '#ff9a4a');
  if (cash < POTION.price) return showPopup('Not enough cash', '#ff5a5a');
  cash -= POTION.price;
  potions++;
  showPopup(`${POTION.name}  -$${POTION.price}`, '#7dff9b');
}
function buyMag(i: number) {
  const w = weapons[i];
  const { name, magPrice } = w.stats;
  if (!w.canBuyMag) return showPopup(`${name} magazines full`, '#ff9a4a');
  if (cash < magPrice) return showPopup('Not enough cash', '#ff5a5a');
  cash -= magPrice;
  w.buyMag();
  showPopup(`${name} magazine  -$${magPrice}`, '#7dff9b');
  if (i === current && w.ammo === 0) beginReload(w);
}
function updateSummary() {
  const line = shotsFired
    ? `Score ${score}  ·  Kills ${kills}  ·  Headshots ${headshotKills}  ·  Accuracy ${accuracyText()}  ·  `
    : '';
  $('summary').textContent = `Level ${level}  ·  ${line}Cash $${cash}`;
}

// ---------- saved progress (browser localStorage) ----------
// Only the long-term progress is stored: the level the player is on, his money, and his weapons with their ammo.
// (Health, potions, score and the arena itself start fresh every visit.)
const SAVE_KEY = 'botshooter.save.v1';
interface SaveData {
  v: 1;
  level: number;
  cash: number;
  weapons: { id: string; owned: boolean; ammo: number; spare: number[] }[];
}
const snapshot = (): SaveData => ({
  v: 1,
  level,
  cash: Math.round(cash),
  weapons: weapons.map((w) => ({ id: w.stats.id, owned: w.owned, ammo: w.ammo, spare: [...w.spare] })),
});
let lastSaved = '';
function saveProgress() {
  try {
    const s = JSON.stringify(snapshot());
    if (s === lastSaved) return; // nothing changed
    localStorage.setItem(SAVE_KEY, s);
    lastSaved = s;
  } catch {
    /* storage unavailable (private mode / blocked): the game simply doesn't persist */
  }
}
function clearSave() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* ignore */
  }
  lastSaved = '';
}
/** Restore the saved progress, defensively: bad or outdated data is clamped or ignored, never trusted. */
function loadProgress() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return;
    const d = JSON.parse(raw) as Partial<SaveData>;
    if (d.v !== 1) return;
    const int = (n: unknown, min: number, max: number, fallback: number) =>
      typeof n === 'number' && Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : fallback;
    level = int(d.level, 1, 999, 1);
    cash = int(d.cash, 0, 100_000_000, START_CASH);
    for (const sw of Array.isArray(d.weapons) ? d.weapons : []) {
      const w = weapons.find((x) => x.stats.id === sw?.id); // weapons that no longer exist are skipped
      if (!w) continue;
      const s = w.stats;
      w.owned = s.unlockPrice === 0 || !!sw.owned;
      if (!w.owned || s.melee) continue;
      w.ammo = int(sw.ammo, 0, s.magSize, s.magSize);
      if (Array.isArray(sw.spare)) w.spare = sw.spare.slice(0, s.maxMags).map((n) => int(n, 0, s.magSize, 0));
    }
    lastSaved = JSON.stringify(snapshot());
  } catch {
    /* corrupt save: start fresh */
  }
}
setInterval(saveProgress, 1000); // cheap: it only writes when something changed
addEventListener('pagehide', saveProgress);
document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && saveProgress());

// ---------- levels, missions and the gate flow ----------
// safe room --gate 1--> airlock --gate 2--> arena. Walking into the airlock seals gate 1; the level loads while
// both gates are shut; gate 2 then opens. Three finished missions light up gate 2 for the way back.
type Phase = 'hub' | 'sealing' | 'loading' | 'airlockReady' | 'arena' | 'exitOpen' | 'returning' | 'unloading' | 'toHub';
let phase: Phase = 'hub';
let phaseT = 0;
let level = 1;
let stats: LevelStats = emptyStats();
let missions: Mission[] = [];
let missionsDone = 0;
const bannerEl = $('banner');
const missionsEl = $('missions');
const nametag = $('nametag');
let bannerTimer = 0;
rooms.gate1.onStart = doorSound;
rooms.gate2.onStart = doorSound;

function showBanner(title: string, sub = '', secs = 3.5) {
  bannerEl.innerHTML = `${title}${sub ? `<small>${sub}</small>` : ''}`;
  bannerEl.style.opacity = '1';
  bannerTimer = secs;
}
/** The arena (bots, wolves, missions) is only simulated while the player can reach it. */
const arenaActive = () => phase === 'airlockReady' || phase === 'arena' || phase === 'exitOpen';

function addScore(n: number) {
  score += n;
  stats.score += n;
  checkMissions();
}

let missionsHtml = '';
function renderMissions() {
  const visible = missions.length > 0 && (arenaActive() || phase === 'sealing' || phase === 'loading');
  if (!visible) {
    missionsEl.style.display = 'none';
    return;
  }
  const rows = missions
    .map((m, i) => {
      const p = Math.floor(m.progress);
      return (
        `<div class="m${m.done ? ' done' : ''}"><span class="n">${m.done ? '✓' : i + 1}</span><span class="t">${m.title}</span>` +
        `<span class="p">${p}/${m.target}</span><span class="r">${m.done ? 'Paid' : 'Reward'} $${m.reward}</span></div>`
      );
    })
    .join('');
  const sub =
    missionsDone >= MISSIONS_TO_FINISH
      ? 'Level complete! Reach the glowing gate, or finish the rest for more money'
      : `Complete ${MISSIONS_TO_FINISH} of ${MISSIONS_PER_LEVEL} missions to finish (${missionsDone}/${MISSIONS_TO_FINISH})`;
  const html = `<h4>LEVEL ${level}</h4><div class="sub">${sub}</div>${rows}`;
  missionsEl.style.display = 'block';
  if (html !== missionsHtml) {
    missionsHtml = html;
    missionsEl.innerHTML = html;
  }
}

/** Re-measure every mission against the level stats; pay out and announce the ones that just completed. */
function checkMissions() {
  for (const m of missions) {
    if (m.done) continue;
    m.progress = Math.min(m.measure(stats), m.target);
    if (m.progress >= m.target) {
      m.done = true;
      missionsDone++;
      cash += m.reward; // the ONLY source of money
      if (missionsDone === MISSIONS_TO_FINISH) levelComplete();
      else if (missionsDone === MISSIONS_PER_LEVEL) {
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
  phase = 'exitOpen';
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
function startLevel() {
  const cfg = levelConfig(level);
  setSpawnRule(cfg.allowed);
  stats = emptyStats();
  missions = generateMissions(cfg);
  missionsDone = 0;
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
  for (const m of missions) {
    const id = /^kill:(.+)$/.exec(m.key)?.[1];
    if (id && id !== 'wolf') wanted.set(id, Math.max(wanted.get(id) ?? 0, m.target));
  }
  // a character that is new in this level (criminals in 2, ninjas in 7) is guaranteed to show up, at least twice
  for (const c of COSTUMES) if (c.minLevel && c.minLevel > 1 && c.minLevel === level) wanted.set(c.id, Math.max(wanted.get(c.id) ?? 0, 2));
  for (const [id, n] of wanted) {
    const alive = () => mannequins.filter((m) => m.costume.id === id).length;
    for (const m of mannequins) {
      if (alive() >= n) break;
      if (!wanted.has(m.costume.id)) m.forceCostume(id); // never steal a bot another mission needs
    }
  }
}

/** Run up to `count` queued items. True when the queue is empty. */
function runLevelWork(count: number) {
  while (count-- > 0 && levelWork.length) levelWork.shift()!();
  return levelWork.length === 0;
}
function enterPhase(p: Phase) {
  phase = p;
  phaseT = 0;
  renderMissions();
}

function updateFlow(dt: number) {
  phaseT += dt;
  const centred = Math.abs(pos.x) < 7;
  switch (phase) {
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
      if (runLevelWork(2) && phaseT > 0.6) {
        rooms.gate2.setOpen(true);
        enterPhase('airlockReady');
        showBanner(`LEVEL ${level}`, `${levelConfig(level).note} Complete ${MISSIONS_TO_FINISH} of ${MISSIONS_PER_LEVEL} missions.`, 5);
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
      if (phaseT > 0.6) {
        level++;
        rooms.gate1.setOpen(true);
        enterPhase('toHub');
      }
      break;
    case 'toHub':
      if (pos.z > GATE1_Z + 2) {
        enterPhase('hub');
        showBanner('SAFE ROOM', `Spend your money, then walk through the gate for level ${level}.`, 4.5);
      }
      break;
  }
}

/** Back to the safe room with the doors in their starting state (the level number is kept). */
function resetFlow() {
  phase = 'hub';
  phaseT = 0;
  stats = emptyStats();
  missions = [];
  missionsDone = 0;
  missionsHtml = '';
  rooms.gate1.setOpen(true, true);
  rooms.gate2.setOpen(false, true);
  rooms.setExitLight(false);
  levelWork = [];
  wolves.forEach((w) => w.deactivate()); // the arena itself is rebuilt when the next level starts
  renderMissions();
}

// ---------- name tag over whatever the crosshair is on ----------
let nameT = 0;
const nameRay = new THREE.Raycaster();
function updateNametag(dt: number) {
  nameT -= dt;
  if (nameT > 0) return;
  nameT = 0.1;
  if (!locked || dead || !arenaActive()) {
    nametag.style.opacity = '0';
    return;
  }
  camera.getWorldPosition(tmpV);
  camera.getWorldDirection(tmpDir);
  nameRay.set(tmpV, tmpDir);
  nameRay.far = 70;
  const targets = [...mannequins, ...wolves].filter((t) => t.alive).flatMap((t) => t.hitMeshes);
  const hit = nameRay.intersectObjects([...targets, ...world.blockers], false)[0];
  const owner = hit?.object.userData.owner as Target | undefined;
  if (owner) {
    nametag.innerHTML = `${owner.label}<small>${Math.ceil(owner.health)} HP</small>`;
    nametag.classList.toggle('hostile', owner.hostile);
    nametag.style.opacity = '1';
  } else {
    nametag.style.opacity = '0';
  }
}

// ---------- shooting ----------
const raycaster = new THREE.Raycaster();
const tmpV = new THREE.Vector3();
const tmpDir = new THREE.Vector3();
const muzzlePos = new THREE.Vector3();

function currentSpread(w: Weapon) {
  const s = w.stats;
  const moving = Math.hypot(vel.x, vel.z) > 0.5;
  let deg = s.spreadBase + w.bloom;
  if (moving) deg += s.spreadMoving;
  if (!onGround) deg += s.spreadAir;
  return Math.min(deg, s.spreadMax + (moving ? s.spreadMoving : 0) + (onGround ? 0 : s.spreadAir));
}

const PACK_ALERT_RADIUS = 12;
/** Shooting a wolf rouses the wolves near it; shooting a cowboy rouses the cowboys near him. */
function alertPack(shot: Target) {
  const pack: Target[] = shot instanceof Wolf ? wolves : mannequins.filter((m) => m.costume.combat === 'ranged');
  for (const o of pack) {
    if (o !== shot && o.alive && o.group.position.distanceTo(shot.group.position) < PACK_ALERT_RADIUS) o.aggravate();
  }
}

/** The player's shot or blade landed on a bot / wolf: damage, alerts, score, hit marker. */
function applyHit(owner: Target, dmg: number, head: boolean, point: THREE.Vector3) {
  alertPack(owner);
  if (owner.damage(dmg)) {
    kills++;
    const { label: name, points } = owner;
    let gained = points;
    if (head) {
      headshotKills++;
      gained += POINTS_HEADSHOT_KILL;
    }
    // level stats for the missions
    stats.kills++;
    stats.byKind[owner.kind] = (stats.byKind[owner.kind] ?? 0) + 1;
    if (head) stats.headshots++;
    if (weapons[current].stats.melee) stats.knifeKills++;
    showPopup(`${head ? 'HEADSHOT · ' : ''}${name} +${gained} pts`);
    addScore(gained); // also re-checks the missions
  }
  hitTimer = 0.15;
  hitmarker.style.color = head ? '#ff4040' : '#ffffff';
  spawnImpact(point, 0xff5533);
}

let swingT = 0; // knife swing animation
/** Knife: a short-range slash at whatever is in front of the crosshair (a small arc so it forgives aim). */
function meleeAttack(w: Weapon) {
  const s = w.stats;
  if (equipLeft > 0 || w.cooldown > 0) return;
  w.cooldown = 60 / s.rpm;
  shotsFired++;
  swingT = 0.28;
  knifeSwish();

  const targets = [...mannequins, ...wolves].filter((m) => m.alive).flatMap((m) => m.hitMeshes);
  const all = [...targets, ...world.blockers];
  camera.getWorldPosition(tmpV);
  camera.getWorldDirection(tmpDir);
  const arc = THREE.MathUtils.degToRad(s.meleeArc ?? 10);
  const up = new THREE.Vector3(0, 1, 0);
  let best: { owner: Target; head: boolean; point: THREE.Vector3; dist: number } | null = null;
  for (const a of [0, -arc, arc]) {
    const dir = tmpDir.clone().applyAxisAngle(up, a);
    raycaster.set(tmpV, dir);
    raycaster.far = s.range;
    const hit = raycaster.intersectObjects(all, false)[0];
    const owner = hit?.object.userData.owner as Target | undefined;
    if (hit && owner && (!best || hit.distance < best.dist)) {
      best = { owner, head: !!hit.object.userData.head, point: hit.point.clone(), dist: hit.distance };
    }
  }
  if (best) {
    shotsHit++;
    addScore(POINTS_HIT); // score only: money comes from missions
    applyHit(best.owner, s.damage * (best.head ? s.headshotMultiplier : 1), best.head, best.point);
  }
}

function fire() {
  const w = weapons[current];
  const s = w.stats;
  if (s.melee) return meleeAttack(w);
  if (w.reloading || equipLeft > 0 || w.cooldown > 0) return;
  if (w.ammo <= 0) {
    beginReload(w);
    return;
  }
  w.ammo--;
  w.cooldown = 60 / s.rpm;
  shotsFired++;
  let landed = false;

  const spreadRad = THREE.MathUtils.degToRad(currentSpread(w));
  const targets = [...mannequins, ...wolves].filter((m) => m.alive).flatMap((m) => m.hitMeshes);
  const all = [...targets, ...world.blockers];
  camera.getWorldPosition(tmpV);
  viewModels[current].getObjectByName('muzzle')!.getWorldPosition(muzzlePos);

  for (let p = 0; p < s.pellets; p++) {
    // random direction inside the spread cone around the camera forward
    camera.getWorldDirection(tmpDir);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), tmpDir);
    const ang = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * Math.tan(spreadRad);
    const dir = new THREE.Vector3(Math.cos(ang) * r, Math.sin(ang) * r, -1).normalize().applyQuaternion(q);

    raycaster.set(tmpV, dir);
    raycaster.far = s.range;
    const hit = raycaster.intersectObjects(all, false)[0];
    const end = hit ? hit.point.clone() : tmpV.clone().addScaledVector(dir, s.range);
    spawnTracer(muzzlePos.clone(), end, s.tracerColor);

    if (hit) {
      const owner = hit.object.userData.owner as Target | undefined;
      if (owner) {
        const head = !!hit.object.userData.head;
        const falloff = THREE.MathUtils.clamp((hit.distance - s.falloffStart) / (s.range - s.falloffStart), 0, 1);
        let dmg = s.damage * THREE.MathUtils.lerp(1, s.falloffMinMultiplier, falloff);
        if (head) dmg *= s.headshotMultiplier;
        landed = true;
        applyHit(owner, dmg, head, hit.point);
      } else {
        spawnImpact(hit.point, 0xffee88);
      }
    }
  }

  if (landed) {
    // one hit bonus per shot, however many shotgun pellets connect
    shotsHit++;
    addScore(POINTS_HIT); // score only: money comes from missions
  }

  // feedback: bloom, recoil, viewmodel kick, flash, sound
  w.bloom = Math.min(w.bloom + s.spreadPerShot, s.spreadMax);
  // recoil grows with every consecutive shot (burst), so sustained fire climbs more and more
  const mult = Math.min(1 + s.recoilBuildup * w.burst, s.recoilBuildupMax);
  w.burst++;
  const pitchKick = s.recoilPitch * mult;
  pitch += THREE.MathUtils.degToRad(pitchKick);
  yaw += THREE.MathUtils.degToRad((Math.random() * 2 - 1) * s.recoilYaw * mult);
  roll += THREE.MathUtils.degToRad((Math.random() * 2 - 1) * s.recoilRoll * mult);
  recoilOffset += pitchKick;
  kick = s.viewKick * (0.6 + 0.4 * mult);
  flashLight.intensity = 25;
  shotSound(w);
  if (w.ammo === 0) beginReload(w);
}

// ---------- input ----------
// Esc handling. Normally the browser releases the mouse on Esc itself and does NOT deliver that keydown to the
// page, and it then refuses to re-capture the mouse on the next Esc (only a click works). To get a proper
// Esc = pause / Esc = resume, startPlaying() puts the page in fullscreen and uses the Keyboard Lock API
// (Chrome / Edge) so the page receives Esc itself; we then release the mouse from script, and a mouse that was
// released from script can be captured again without a click.
// Without that support: Esc -> pointerlockchange closes the shop (soft pause) or shows the pause menu.
let softPaused = false; // shop was closed with Esc: any key / click picks the game back up
addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && locked) {
    // only reached when the page really receives Esc (keyboard lock active)
    e.preventDefault();
    if (shopOpen) {
      shopOpen = false; // Esc closes the shop first
      updateShop();
    } else {
      document.exitPointerLock(); // pause menu appears via pointerlockchange
    }
    return;
  }
  if (!locked) {
    if (e.code === 'Escape') {
      if (rules.style.display === 'flex') closeRules();
      else if (!dead) startPlaying();
    } else if (softPaused && !e.repeat) {
      startPlaying();
    }
    return;
  }
  keys[e.code] = true;
  if (e.code === 'KeyE' && inShop && !e.repeat) {
    shopOpen = !shopOpen;
    return;
  }
  if (shopOpen) {
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
  if (e.code === 'KeyR') beginReload(weapons[current]);
  if (e.code === 'KeyH' && !e.repeat) usePotion();
  if (e.code === 'KeyQ') cycleWeapon(1);
});
addEventListener('keyup', (e) => (keys[e.code] = false));
addEventListener('mousedown', (e) => {
  if (!locked) {
    if (softPaused) startPlaying();
    return;
  }
  if (e.button === 0) {
    trigger = true;
    triggerPressed = true;
  }
});
addEventListener('mouseup', (e) => {
  if (e.button === 0) trigger = false;
});
addEventListener('wheel', (e) => {
  if (locked) cycleWeapon(e.deltaY > 0 ? 1 : -1);
});
addEventListener('mousemove', (e) => {
  if (!locked) return;
  yaw -= e.movementX * MOUSE_SENS;
  pitch -= e.movementY * MOUSE_SENS;
  pitch = THREE.MathUtils.clamp(pitch, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
});
/**
 * Back to the safe room: fresh arena, score cleared. The saved progress (level, money, weapons, ammo) is KEPT,
 * unless resh is true: then it is a brand-new game (level 1, starting money and weapons).
 */
function resetGame(fresh = false) {
  kills = headshotKills = score = shotsFired = shotsHit = 0;
  if (fresh) {
    cash = START_CASH;
    level = 1;
    for (const w of weapons) w.refill();
  }
  stopRifleLoop();
  stopReloadSound();
  if (current !== 0) switchWeapon(0);
  weapons.forEach((w) => ((w.cooldown = 0), (w.bloom = 0), (w.burst = 0), (w.reloadLeft = 0)));
  equipLeft = 0;
  recoilOffset = 0;
  roll = 0;
  pos.copy(START);
  vel.set(0, 0, 0);
  yaw = 0;
  pitch = 0;
  crouching = false;
  playerHeight = STAND_HEIGHT;
  onGround = true;
  yaw = 0; // facing the airlock gate
  resetFlow(); // safe room, doors reset, fresh arena
  health = MAX_HEALTH;
  potions = 0;
  hurtFlash = 0;
  dead = false;
  popupTimer = 0;
}
// ---------- rules window (tables are generated from the real game data) ----------
const WEAPON_NOTES: Record<string, string> = {
  pistol: 'Accurate, light recoil',
  rifle: 'Fast; recoil builds as you hold fire',
  shotgun: '8 pellets: deadly close, weak far away',
  knife: `Melee, ${WEAPONS.find((w) => w.id === 'knife')?.range} m reach, silent`,
};
$('weaponTable').innerHTML =
  '<tr><th>Weapon</th><th>Damage</th><th>Magazine</th><th>Mag price</th><th>Unlock</th><th>Notes</th></tr>' +
  WEAPONS.map((s, i) => {
    const dmg = s.pellets > 1 ? `${s.damage} × ${s.pellets}` : `${s.damage}`;
    const unlock = s.unlockPrice ? `<b class="gold">$${s.unlockPrice}</b> at the weapon shop` : 'owned';
    const mag = s.melee ? '—' : `${s.magSize}`;
    const price = s.melee ? '—' : `$${s.magPrice}`;
    return `<tr><td>${i + 1}. ${s.name}</td><td>${dmg}</td><td>${mag}</td><td>${price}</td><td>${unlock}</td><td>${WEAPON_NOTES[s.id] ?? ''}</td></tr>`;
  }).join('');
$('botTable').innerHTML =
  '<tr><th>Target</th><th>Points</th><th>Health</th><th>Behaviour</th></tr>' +
  [
    ...COSTUMES.map((c) => ({ name: c.name, points: c.points, health: c.health, note: c.note })),
    { name: WOLF_INFO.name, points: WOLF_INFO.points, health: WOLF_INFO.health, note: 'Calm until shot, then hunts and bites' },
  ]
    .sort((a, b) => a.points - b.points)
    .map((c) => `<tr><td>${c.name}</td><td><b class="gold">${c.points}</b></td><td>${c.health}</td><td>${c.note}</td></tr>`)
    .join('');
const rules = $('rules');
function closeRules() {
  rules.style.display = 'none';
  overlay.style.display = 'flex';
}
$('btnRules').addEventListener('click', () => {
  overlay.style.display = 'none';
  rules.style.display = 'flex';
});
$('btnBack').addEventListener('click', closeRules);

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
  cash += 100000;
  updateSummary();
});
loadProgress(); // restore level / money / weapons / ammo from the last visit
updateSummary();
let started = false;
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === renderer.domElement;
  rules.style.display = 'none';
  if (locked) {
    if (!started) {
      showBanner(
        'SAFE ROOM',
        level > 1
          ? `Welcome back: level ${level} is waiting. Shop on the left, then walk through the gate.`
          : 'Visit the weapon shop on the left, then walk through the open gate when you are ready.',
        6,
      );
    }
    started = true;
    softPaused = false;
    overlay.style.display = 'none';
    resumeHint.style.display = 'none';
    return;
  }
  trigger = false;
  stopRifleLoop();
  stopReloadSound();
  for (const k in keys) keys[k] = false;
  const closedShopWithEsc = shopOpen && !dead;
  shopOpen = false;
  updateShop(); // hide the shop window straight away
  if (closedShopWithEsc) {
    // Esc closed the shop: no pause menu, just wait for any key / click to continue
    softPaused = true;
    overlay.style.display = 'none';
    resumeHint.style.display = 'block';
    startPlaying(); // works in browsers that allow an instant re-lock; otherwise the hint covers it
    return;
  }
  softPaused = false;
  resumeHint.style.display = 'none';
  overlay.style.display = 'flex';
  $('title').textContent = dead ? 'You died' : started ? 'Paused' : 'Bot Shooter';
  $('btnResume').style.display = dead ? 'none' : '';
  $('btnResume').textContent = started ? 'Resume' : 'Play';
  $('btnReload').textContent = dead ? 'Play again' : 'Reload map';
  updateSummary();
});
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------- player movement & collision ----------
/** True if nothing solid overhead blocks standing at full height. */
function canStand() {
  for (const b of world.boxes) {
    const overX = pos.x > b.min.x - PLAYER_RADIUS && pos.x < b.max.x + PLAYER_RADIUS;
    const overZ = pos.z > b.min.z - PLAYER_RADIUS && pos.z < b.max.z + PLAYER_RADIUS;
    if (overX && overZ && b.min.y >= pos.y + CROUCH_HEIGHT - 0.01 && b.min.y < pos.y + STAND_HEIGHT) return false;
  }
  return true;
}

function movePlayer(dt: number) {
  const w = weapons[current].stats;

  // crouch (hold Shift): lower the player; only stand up again if there is room
  const wantCrouch = !!(keys['ShiftLeft'] || keys['ShiftRight']);
  if (wantCrouch) crouching = true;
  else if (crouching && canStand()) crouching = false;
  const targetH = crouching ? CROUCH_HEIGHT : STAND_HEIGHT;
  playerHeight += (targetH - playerHeight) * (1 - Math.exp(-CROUCH_LERP * dt));
  if (Math.abs(playerHeight - targetH) < 0.002) playerHeight = targetH;

  const running = (keys['ControlLeft'] || keys['ControlRight']) && !crouching;
  const base = crouching ? CROUCH_SPEED : running ? SPRINT_SPEED : WALK_SPEED;
  const speed = base * w.moveSpeedMultiplier;

  const fwd = (keys['KeyW'] ? 1 : 0) - (keys['KeyS'] ? 1 : 0);
  const strafe = (keys['KeyD'] ? 1 : 0) - (keys['KeyA'] ? 1 : 0);
  const wish = new THREE.Vector3(
    -Math.sin(yaw) * fwd + Math.cos(yaw) * strafe,
    0,
    -Math.cos(yaw) * fwd - Math.sin(yaw) * strafe,
  );
  if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(speed);

  // smooth acceleration (less control in the air)
  const k = onGround ? 14 : 3;
  const t = 1 - Math.exp(-k * dt);
  vel.x += (wish.x - vel.x) * t;
  vel.z += (wish.z - vel.z) * t;

  if (keys['Space'] && onGround && !crouching) {
    vel.y = JUMP_SPEED;
    onGround = false;
  }
  vel.y -= GRAVITY * dt;

  // vertical move + landing on terrain / tops of boxes
  const prevY = pos.y;
  const wasGround = onGround;
  pos.y += vel.y * dt;
  onGround = false;
  let floorY = world.heightAt(pos.x, pos.z);
  for (const b of world.boxes) {
    const overX = pos.x > b.min.x - PLAYER_RADIUS && pos.x < b.max.x + PLAYER_RADIUS;
    const overZ = pos.z > b.min.z - PLAYER_RADIUS && pos.z < b.max.z + PLAYER_RADIUS;
    if (overX && overZ && prevY >= b.max.y - 0.01 && pos.y <= b.max.y) floorY = Math.max(floorY, b.max.y);
    // head bump
    if (overX && overZ && vel.y > 0 && prevY + playerHeight <= b.min.y && pos.y + playerHeight > b.min.y) {
      pos.y = b.min.y - playerHeight;
      vel.y = 0;
    }
  }
  // while grounded, stick to the surface when walking downhill
  const stick = wasGround && vel.y <= 0 ? 0.3 : 0;
  if (pos.y <= floorY + stick && vel.y <= 0) {
    pos.y = floorY;
    vel.y = 0;
    onGround = true;
  }

  // horizontal move, pushing out of box sides
  pos.x += vel.x * dt;
  pos.z += vel.z * dt;
  for (const b of world.boxes) {
    if (pos.y >= b.max.y - 0.05 || pos.y + playerHeight <= b.min.y) continue;
    const minX = b.min.x - PLAYER_RADIUS, maxX = b.max.x + PLAYER_RADIUS;
    const minZ = b.min.z - PLAYER_RADIUS, maxZ = b.max.z + PLAYER_RADIUS;
    if (pos.x <= minX || pos.x >= maxX || pos.z <= minZ || pos.z >= maxZ) continue;
    const dx = Math.min(pos.x - minX, maxX - pos.x);
    const dz = Math.min(pos.z - minZ, maxZ - pos.z);
    if (dx < dz) {
      pos.x = pos.x - minX < maxX - pos.x ? minX : maxX;
      vel.x = 0;
    } else {
      pos.z = pos.z - minZ < maxZ - pos.z ? minZ : maxZ;
      vel.z = 0;
    }
  }
}

// dev-only hook for automated checks (placing the camera, simulating input without pointer lock)
if (import.meta.env.DEV) {
  (window as any).__game = {
    pos, vel, keys, world, mannequins, resetGame, fire, weapons, switchWeapon,
    clearEquip: () => (equipLeft = 0),
    setShopOpen: (b: boolean) => (shopOpen = b),
    sync: () => {
      camera.position.set(pos.x, pos.y + playerHeight - EYE_OFFSET, pos.z);
      camera.rotation.set(pitch, yaw, roll);
      scene.updateMatrixWorld(true);
    },
    buyMag, buyItem, usePotion, potionCount: () => potions, updateShop, shopState: () => ({ inShop, cash }), setCash: (n: number) => (cash = n),
    COSTUMES,
    look3: () => ({ pitch: THREE.MathUtils.radToDeg(pitch), yaw: THREE.MathUtils.radToDeg(yaw), roll: THREE.MathUtils.radToDeg(roll) }),
    simBots: (secs: number) => { for (let i = 0; i < secs * 60; i++) mannequins.forEach((m) => m.update(1 / 60)); },
    wolves, damagePlayer, playerHealth: () => ({ health, dead }), botHooks, applyHit,
    flow: () => ({ phase, level, missionsDone, missions: missions.map((m) => ({ t: m.title, p: m.progress, g: m.target, r: m.reward, d: m.done })), stats, cash, score }),
    updateFlow, startLevel: () => { startLevel(); runLevelWork(Infinity); }, checkMissions, setLevel: (n: number) => (level = n), arenaActive, updateNametag: () => { nameT = 0; updateNametag(0.1); },
    tick: (secs: number, dt = 1 / 30) => { for (let t = 0; t < secs; t += dt) { rooms.update(dt, t); updateFlow(dt); if (arenaActive()) { for (const m of mannequins) m.update(dt); for (const w of wolves) w.update(dt); } } },
    rooms, setLocked: (b: boolean) => (locked = b),
    resetFull: () => resetGame(true), saveProgress, loadProgress, clearSave, SAVE_KEY,
    simWolves: (secs: number) => { for (let i = 0; i < secs * 60; i++) wolves.forEach((w) => w.update(1 / 60)); },
    pointerChange: () => document.dispatchEvent(new Event('pointerlockchange')),
    look: (y: number, p: number) => ((yaw = y), (pitch = p)),
    step: (dt: number) => movePlayer(dt),
    state: () => ({ crouching, playerHeight, onGround, y: pos.y }),
  };
}

// ---------- main loop ----------
const clock = new THREE.Clock();
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);

  if (locked) {
    movePlayer(dt);

    const w = weapons[current];
    w.cooldown = Math.max(0, w.cooldown - dt);
    equipLeft = Math.max(0, equipLeft - dt);
    w.bloom = Math.max(0, w.bloom - w.stats.spreadRecovery * dt);
    w.burst = Math.max(0, w.burst - w.stats.recoilBuildupDecay * dt);
    roll -= roll * (1 - Math.exp(-10 * dt)); // camera roll settles
    if (w.reloading) {
      w.reloadLeft -= dt;
      if (w.reloadLeft <= 0) {
        w.reloadLeft = 0;
        w.finishReload();
      }
    }
    if (trigger && !shopOpen && (w.stats.fireMode === 'auto' || triggerPressed)) fire();
    triggerPressed = false;
    // stop the rifle burst once shots stop coming (released, reloading, switched...)
    if (rifleLoopActive() && performance.now() - lastShotTime > 1.5 * (60000 / w.stats.rpm)) stopRifleLoop();

    // recoil settles back down
    if (recoilOffset > 0) {
      const rec = Math.min(recoilOffset, weapons[current].stats.recoilRecovery * dt);
      recoilOffset -= rec;
      pitch -= THREE.MathUtils.degToRad(rec);
    }
  }

  camera.position.set(pos.x, pos.y + playerHeight - EYE_OFFSET, pos.z);
  camera.rotation.set(pitch, yaw, roll);

  // viewmodel animation
  kick = Math.max(0, kick - dt * 0.6);
  const vm = viewModels[current];
  const w = weapons[current];
  const bob = onGround ? Math.sin(performance.now() * 0.012) * Math.hypot(vel.x, vel.z) * 0.002 : 0;
  const reloadDip = w.reloading ? Math.sin((1 - w.reloadLeft / w.stats.reloadTime) * Math.PI) : 0;
  const equipDip = equipLeft > 0 ? equipLeft / w.stats.equipTime : 0;
  vm.position.set(0.25, -0.22 + bob - reloadDip * 0.2 - equipDip * 0.3, -0.5 + kick);
  vm.rotation.set(reloadDip * 0.7 + kick * 2, 0, 0);
  if (swingT > 0) {
    // knife slash: sweeps from the right across the screen and thrusts forward
    swingT = Math.max(0, swingT - dt);
    const k = 1 - swingT / 0.28; // 0 -> 1
    const arc = Math.sin(k * Math.PI);
    vm.position.x += -0.32 * Math.sin(k * Math.PI * 0.9) + 0.05;
    vm.position.y += 0.05 * arc;
    vm.position.z += -0.18 * arc;
    vm.rotation.set(-0.5 * arc, 0.9 * arc - 0.2 * k, -1.0 * arc);
  }
  flashLight.intensity = Math.max(0, flashLight.intensity - dt * 400);

  // the arena is only alive while the player can reach it (not while he is in the safe room / sealed airlock)
  if (locked && arenaActive()) {
    for (const m of mannequins) m.update(dt);
    for (const w of wolves) w.update(dt);
  }
  if (locked) updateFlow(dt);
  rooms.update(locked ? dt : 0, performance.now() / 1000); // doors slide, candles flicker
  const k = THREE.MathUtils.smoothstep(pos.z, 57, 63); // 0 in the arena, 1 inside the rooms
  world.setIndoor(k);
  updateNametag(dt);
  bannerTimer -= dt;
  if (bannerTimer <= 0) bannerEl.style.opacity = '0';

  // red edge flash when hurt, plus a slow pulse while health is low
  hurtFlash = Math.max(0, hurtFlash - dt * 1.6);
  const lowPulse = health < 30 && !dead ? 0.25 * (0.5 + 0.5 * Math.sin(performance.now() * 0.008)) : 0;
  hurtOverlay.style.opacity = String(Math.min(1, hurtFlash * 0.9 + lowPulse));

  for (let i = fx.length - 1; i >= 0; i--) {
    const f = fx[i];
    f.life -= dt;
    const mat = (f.obj as THREE.Mesh | THREE.Line).material as THREE.Material & { opacity: number };
    mat.opacity = Math.max(0, f.life / f.max);
    if (f.life <= 0) {
      scene.remove(f.obj);
      (f.obj as THREE.Mesh).geometry.dispose();
      mat.dispose();
      fx.splice(i, 1);
    }
  }

  updateShop();
  popupTimer = Math.max(0, popupTimer - dt);
  popup.style.opacity = String(Math.min(1, popupTimer * 2));
  hitTimer = Math.max(0, hitTimer - dt);
  hitmarker.style.opacity = hitTimer > 0 ? '1' : '0';
  updateHud();

  renderer.render(scene, camera);
}
frame();
