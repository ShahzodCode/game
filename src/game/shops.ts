import * as THREE from 'three';
import { SHOP_IMAGES, POTION, gunImage, weaponShopImage } from '../shop/shopItems';
import { $, pos, weapons, world } from './core';
import { beginReload, switchSlot } from './combat';
import { SLOTS, SLOT_NAMES, SLOT_OPTIONS, bindArmoryScreen, equipWeapon, isEquipped, sanitizeLoadout } from './loadout';
import { rooms } from './flow';
import { showPopup } from './hud';
import { QUESTS, questsHtml } from './quests';
import { levelConfig, LAST_HORDE_LEVEL } from './missions';
import { S } from './state';

// Two shops: the ARMORY terminal in the safe room (loadout + buying guns) and the SUPPLY shop next to the arena gate
// (magazines for the guns you own + health potions). Stand in a shop's green circle -> "Press E" hint ->
// E opens its window -> press the item's number to buy.
interface ShopCard { image: string; name: string; price: string; sub: string; off: boolean }
interface ShopDef {
  title: string;
  pos: THREE.Vector3;
  radius: number;
  cards: () => ShopCard[];
  buy: (i: number) => void;
  /** Custom window content instead of the card grid (the armory terminal). */
  html?: () => string;
  /** The window needs the mouse (its buttons are clicked): the pointer lock is released while it is open. */
  mouse?: boolean;
  foot?: string;
}
/** What the supply shop sells for a weapon, and how it describes one magazine. */
const AMMO_NAMES: Record<string, string> = {
  shotgun: 'Shotgun shells', crossbow: 'Crossbow bolt', launcher: 'Grenade drum', sniper: 'Sniper magazine',
  revolver: 'Revolver speedloader', minigun: 'Ammo belt',
};
const ammoName = (s: { id: string; name: string }) => AMMO_NAMES[s.id] ?? `${s.name} magazine`;
const rounds = (s: { magSize: number; ammoLabel?: string }) =>
  s.ammoLabel === 'bolts' ? (s.magSize === 1 ? '1 bolt' : `${s.magSize} bolts`) : s.ammoLabel === 'grenades' ? `${s.magSize} grenades` : `${s.magSize} rounds`;
const shopHint = $('shopHint');
const shopWindow = $('shopWindow');

/** Magazines are only sold for the guns in the loadout (only those are carried into the arena); melee weapons have none. */
const ownedGuns = () => weapons.map((_, i) => i).filter((i) => !weapons[i].stats.melee && weapons[i].owned && isEquipped(i));

const slotIcon = (s: string) => gunImage(s);
/** The armory cursor: a column (slot) and a row (weapon). Arrow keys move it, Enter buys / equips what it points at. */
const armSel = { col: 0, row: 0 };
const armId = (col: number, row: number) => SLOT_OPTIONS[SLOTS[col]][row];
function clampSel() {
  armSel.col = Math.max(0, Math.min(SLOTS.length - 1, armSel.col));
  armSel.row = Math.max(0, Math.min(SLOT_OPTIONS[SLOTS[armSel.col]].length - 1, armSel.row));
}
/** The armory window: every slot with its weapons. The cursor weapon is outlined; Enter buys it (locked) or equips it (owned). */
function armoryHtml() {
  clampSel();
  const cols = SLOTS.map((slot, n) => {
    const rows = SLOT_OPTIONS[slot]
      .map((id, r) => {
        const wi = weapons.findIndex((x) => x.stats.id === id);
        const w = weapons[wi];
        const isOn = S.loadout[slot] === id;
        const sel = armSel.col === n && armSel.row === r;
        let state: string;
        if (isOn) state = '<em>EQUIPPED</em>';
        else if (w.owned) state = sel ? '<span class="lbtn go"><kbd>Enter</kbd>Equip</span>' : '<em>owned</em>';
        else if (w.stats.questOnly) {
          const q = QUESTS.find((x) => x.weapon === id);
          state = `<span class="lbtn quest">${q?.title ?? 'Quest reward'}</span>`;
        } else {
          const poor = S.cash < w.stats.unlockPrice;
          state = `<span class="lbtn${poor ? ' off' : ''}${sel && !poor ? ' go' : ''}">${sel && !poor ? '<kbd>Enter</kbd>' : ''}Buy $${w.stats.unlockPrice}</span>`;
        }
        return `<div class="lopt${isOn ? ' on' : ''}${w.owned ? '' : ' locked'}${sel ? ' sel' : ''}"><img src="${slotIcon(id)}" alt="" /><span class="n">${w.stats.name}</span>${state}</div>`;
      })
      .join('');
    return `<div class="lslot"><div class="lhead"><kbd>${n + 1}</kbd>${SLOT_NAMES[slot]}</div>${rows}</div>`;
  }).join('');
  return `<h3>ARMORY</h3><div class="cashline">Cash $${S.cash} · pick one weapon per slot</div><div class="loadout">${cols}</div>` +
    `<div class="foot"><kbd>&larr;</kbd><kbd>&rarr;</kbd><kbd>&uarr;</kbd><kbd>&darr;</kbd> choose · <kbd>Enter</kbd> buy or equip · <kbd>E</kbd> close · you can only change this in the safe room</div>`;
}

/** Arrow keys inside the armory window. Returns true if the key was used. */
export function shopNavigate(dx: number, dy: number): boolean {
  if (!S.shopOpen || activeShop?.title !== 'ARMORY') return false;
  if (dx) {
    const row = armSel.row;
    armSel.col = (armSel.col + dx + SLOTS.length) % SLOTS.length;
    armSel.row = row;
  }
  if (dy) armSel.row += dy;
  clampSel();
  updateShop();
  return true;
}
/** Enter inside the armory window: buy the weapon under the cursor, equip it if owned, or show the quest that unlocks it. */
export function shopEnter(): boolean {
  if (!S.shopOpen || activeShop?.title !== 'ARMORY') return false;
  clampSel();
  const slot = SLOTS[armSel.col];
  const id = armId(armSel.col, armSel.row);
  const wi = weapons.findIndex((x) => x.stats.id === id);
  const w = weapons[wi];
  if (S.loadout[slot] === id) showPopup(`${w.stats.name} is already equipped`, '#ff9a4a');
  else if (w.owned) {
    equipWeapon(slot, id);
    showPopup(`${w.stats.name} equipped`, '#7dff9b');
    if (!isEquipped(S.current)) switchSlot(0); // the weapon in hand was swapped out
  } else if (w.stats.questOnly) {
    const q = QUESTS.find((x) => x.weapon === id);
    showPopup(q ? `Quest reward: ${q.title}` : 'Quest reward', '#ff9a4a');
  } else {
    buyWeapon(wi);
    if (w.owned) equipWeapon(slot, id); // buying a weapon puts it straight into its slot
  }
  updateShop();
  return true;
}

function buyWeapon(wi: number) {
  const w = weapons[wi];
  const { name, unlockPrice } = w.stats;
  if (w.owned) return showPopup(`You already own the ${name}`, '#ff9a4a');
  if (S.cash < unlockPrice) return showPopup('Not enough cash', '#ff5a5a');
  S.cash -= unlockPrice;
  w.unlock();
  const before = JSON.stringify(S.loadout);
  sanitizeLoadout(); // an empty slot (the first heavy weapon) is filled automatically
  const equipped = before !== JSON.stringify(S.loadout);
  showPopup(`${name} unlocked  -$${unlockPrice}` + (equipped ? ' (equipped)' : ' - press its slot number to equip it'), '#7dff9b');
}

/** The world map window: a grid of levels. Levels up to the highest one reached can be clicked (only while in the safe room). */
function mapHtml() {
  const can = S.phase === 'hub' && !S.dead;
  const nodes = Array.from({ length: LAST_HORDE_LEVEL }, (_, i) => {
    const n = i + 1;
    const cfg = levelConfig(n);
    const open = n <= S.best;
    const cls = ['mnode', n < S.best ? 'done' : open ? 'open' : 'locked', n === S.level ? 'here' : '', cfg.boss ? 'boss' : cfg.horde ? 'horde' : ''].join(' ');
    return `<button class="${cls}" data-level="${n}"${open && can ? '' : ' disabled'} title="${open ? cfg.note.replace(/"/g, '') : 'Not reached yet'}">${n < S.best ? '&#10003;' : n}<small>${cfg.boss ? 'BOSS' : cfg.horde ? 'HORDE' : n === S.level ? 'HERE' : ''}</small></button>`;
  }).join('');
  return `<h3>WORLD MAP</h3><div class="cashline">Level ${S.level} selected · highest reached ${S.best}</div><div class="worldmap">${nodes}</div>` +
    `<div class="foot">${can ? 'Click a level to go back to it, then walk through the gate' : 'You can only pick a level in the safe room'} · E or Esc to close</div>`;
}
/** Go back to (or pick) a level from the map. */
export function pickLevel(n: number): boolean {
  if (S.phase !== 'hub' || S.dead || n < 1 || n > S.best) return false;
  S.level = n;
  showPopup(`Level ${n} selected - walk through the gate`, '#7dff9b');
  return true;
}
export const shopWantsMouse = () => !!activeShop?.mouse;
let lastMapKey = '';
function refreshMapScreen() {
  const key = `${S.best}/${S.level}`;
  if (key === lastMapKey) return;
  lastMapKey = key;
  rooms.setMapScreen(S.best, S.level);
}

const shops: ShopDef[] = [
  {
    title: 'WORLD MAP',
    pos: rooms.worldMap.pos,
    radius: rooms.worldMap.radius,
    cards: () => [],
    html: mapHtml,
    mouse: true,
    buy: () => {},
  },
  {
    title: 'QUEST BOARD',
    pos: rooms.questBoard.pos,
    radius: rooms.questBoard.radius,
    cards: () => [],
    html: questsHtml,
    buy: () => {},
  },
  {
    title: 'ARMORY',
    pos: rooms.armory.pos,
    radius: rooms.armory.radius,
    cards: () => [],
    html: armoryHtml,
    buy: () => {}, // the armory is driven with the arrow keys and Enter (shopNavigate / shopEnter)
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
          name: ammoName(s),
          price: full ? 'FULL' : `$${s.magPrice}`,
          sub: `${rounds(s)} · carrying ${w.spare.length}/${s.maxMags}`,
          off: full || S.cash < s.magPrice,
        };
      });
      const full = S.potions >= POTION.max;
      cards.push({
        image: SHOP_IMAGES.potion,
        name: POTION.name,
        price: full ? 'FULL' : `$${POTION.price}`,
        sub: `Heals ${POTION.heal} (drink with H) · carrying ${S.potions}/${POTION.max}`,
        off: full || S.cash < POTION.price,
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
let shopHtml = '';

bindArmoryScreen((lines) => rooms.setArmoryScreen(lines));

export function updateShop() {
  refreshMapScreen();
  activeShop = null;
  for (const s of shops) {
    const dx = pos.x - s.pos.x, dz = pos.z - s.pos.z;
    if (Math.hypot(dx, dz) < s.radius && Math.abs(pos.y - s.pos.y) < 2.5) activeShop = s;
  }
  S.inShop = !!activeShop;
  if (!S.inShop) S.shopOpen = false; // walking away closes the window
  shopHint.style.display = S.inShop && !S.shopOpen ? 'block' : 'none';
  shopWindow.style.display = S.shopOpen ? 'block' : 'none';
  if (S.inShop && !S.shopOpen) {
    shopHint.innerHTML = `<kbd>E</kbd>Open ${activeShop!.title.toLowerCase()}`;
  } else if (S.shopOpen && activeShop) {
    const list = activeShop.cards();
    const cards = list
      .map(
        (c, i) =>
          `<div class="shopitem${c.off ? ' off' : ''}"><kbd>${i + 1}</kbd><img src="${c.image}" alt="" />` +
          `<div class="name">${c.name}</div><div class="price">${c.price}</div><div class="sub">${c.sub}</div></div>`,
      )
      .join('');
    const html = activeShop.html
      ? activeShop.html()
      : `<h3>${activeShop.title}</h3><div class="cashline">Cash $${S.cash}</div><div class="shopgrid">${cards}</div>` +
        `<div class="foot">Press the item's number to buy · E to close</div>`;
    if (html !== shopHtml) {
      shopHtml = html;
      shopWindow.innerHTML = html;
    }
  }
}

export function buyItem(i: number) {
  activeShop?.buy(i);
}
function buyPotion() {
  if (S.potions >= POTION.max) return showPopup('Potion pouch full', '#ff9a4a');
  if (S.cash < POTION.price) return showPopup('Not enough cash', '#ff5a5a');
  S.cash -= POTION.price;
  S.potions++;
  showPopup(`${POTION.name}  -$${POTION.price}`, '#7dff9b');
}
export function buyMag(i: number) {
  const w = weapons[i];
  const { name, magPrice } = w.stats;
  if (!w.canBuyMag) return showPopup(`${name} magazines full`, '#ff9a4a');
  if (S.cash < magPrice) return showPopup('Not enough cash', '#ff5a5a');
  S.cash -= magPrice;
  w.buyMag();
  showPopup(`${name} magazine  -$${magPrice}`, '#7dff9b');
  if (i === S.current && w.ammo === 0) beginReload(w);
}
