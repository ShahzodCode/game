import * as THREE from 'three';
import { SHOP_IMAGES, POTION, weaponShopImage } from '../shop/shopItems';
import { $, pos, weapons, world } from './core';
import { beginReload } from './combat';
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
}
const shopHint = $('shopHint');
const shopWindow = $('shopWindow');

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
        return { image: weaponShopImage(s.id, false), name: s.name, price: `$${s.unlockPrice}`, sub: `Includes ${s.magSize} rounds + 1 spare magazine`, off: S.cash < s.unlockPrice };
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
    const html =
      `<h3>${activeShop.title}</h3><div class="cashline">Cash $${S.cash}</div><div class="shopgrid">${cards}</div>` +
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
