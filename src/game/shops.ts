import * as THREE from 'three';
import { SHOP_IMAGES, POTION, gunImage, weaponShopImage } from '../shop/shopItems';
import { $, pos, weapons, world } from './core';
import { beginReload, switchSlot } from './combat';
import { SLOTS, SLOT_NAMES, SLOT_OPTIONS, bindArmoryScreen, cycleSlot, isEquipped, sanitizeLoadout } from './loadout';
import { rooms } from './flow';
import { showPopup } from './hud';
import { S } from './state';

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
  /** Custom window content instead of the card grid (the armory terminal). */
  html?: () => string;
  foot?: string;
}
/** What the supply shop sells for a weapon, and how it describes one magazine. */
const AMMO_NAMES: Record<string, string> = {
  shotgun: 'Shotgun shells', crossbow: 'Crossbow bolt', launcher: 'Grenade drum', sniper: 'Sniper magazine',
};
const ammoName = (s: { id: string; name: string }) => AMMO_NAMES[s.id] ?? `${s.name} magazine`;
const rounds = (s: { magSize: number; ammoLabel?: string }) =>
  s.ammoLabel === 'bolts' ? (s.magSize === 1 ? '1 bolt' : `${s.magSize} bolts`) : s.ammoLabel === 'grenades' ? `${s.magSize} grenades` : `${s.magSize} rounds`;
const shopHint = $('shopHint');
const shopWindow = $('shopWindow');

/** Magazines are only sold for the guns in the loadout (only those are carried into the arena); melee weapons have none. */
const ownedGuns = () => weapons.map((_, i) => i).filter((i) => !weapons[i].stats.melee && weapons[i].owned && isEquipped(i));
const lockedGuns = () => weapons.map((_, i) => i).filter((i) => !weapons[i].stats.melee && weapons[i].stats.unlockPrice > 0);

const slotIcon = (s: string) => gunImage(s);
/** The armory window: three slots, every candidate weapon listed, the equipped one marked. */
function armoryHtml() {
  const cols = SLOTS.map((slot, n) => {
    const rows = SLOT_OPTIONS[slot]
      .map((id) => {
        const w = weapons[weapons.findIndex((x) => x.stats.id === id)];
        const isOn = S.loadout[slot] === id;
        const state = isOn ? 'EQUIPPED' : w.owned ? 'owned' : `locked · $${w.stats.unlockPrice}`;
        return `<div class="lopt${isOn ? ' on' : ''}${w.owned ? '' : ' locked'}"><img src="${slotIcon(id)}" alt="" /><span class="n">${w.stats.name}</span><em>${state}</em></div>`;
      })
      .join('');
    return `<div class="lslot"><div class="lhead"><kbd>${n + 1}</kbd>${SLOT_NAMES[slot]}</div>${rows}</div>`;
  }).join('');
  return `<h3>ARMORY</h3><div class="cashline">Pick one weapon per slot. The knife is always with you.</div><div class="loadout">${cols}</div>` +
    `<div class="foot">Press 1 / 2 / 3 to switch the weapon in that slot · E to close · you can only change this in the safe room</div>`;
}

const shops: ShopDef[] = [
  {
    title: 'ARMORY',
    pos: rooms.armory.pos,
    radius: rooms.armory.radius,
    cards: () => [],
    html: armoryHtml,
    buy: (n) => {
      if (n < 0 || n > 2) return;
      const name = cycleSlot(SLOTS[n]);
      if (name) showPopup(`${name} equipped`, '#7dff9b');
      else showPopup('No other weapon owned for that slot: buy more at the weapon shop', '#ff9a4a');
      if (!isEquipped(S.current)) switchSlot(0); // the weapon in hand was swapped out
    },
  },
  {
    title: 'WEAPON SHOP',
    pos: rooms.hubShop.pos,
    radius: rooms.hubShop.radius,
    cards: () =>
      lockedGuns().map((i) => {
        const w = weapons[i];
        const s = w.stats;
        if (w.owned) return { image: weaponShopImage(s.id, false), name: s.name, price: 'OWNED', sub: 'Buy ammo at the supply shop by the arena gate', off: true };
        return { image: weaponShopImage(s.id, false), name: s.name, price: `$${s.unlockPrice}`, sub: `Includes ${rounds(s)} + 1 spare`, off: S.cash < s.unlockPrice };
      }),
    buy: (n) => {
      const i = lockedGuns()[n];
      if (i === undefined) return;
      const w = weapons[i];
      const { name, unlockPrice } = w.stats;
      if (w.owned) return showPopup(`You already own the ${name}`, '#ff9a4a');
      if (S.cash < unlockPrice) return showPopup('Not enough cash', '#ff5a5a');
      S.cash -= unlockPrice;
      w.unlock();
      const before = JSON.stringify(S.loadout);
      sanitizeLoadout(); // an empty slot (the first heavy weapon) is filled automatically
      const equipped = before !== JSON.stringify(S.loadout);
      showPopup(`${name} unlocked  -$${unlockPrice}` + (equipped ? ' (equipped)' : ' - equip it at the armory terminal'), '#7dff9b');
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
