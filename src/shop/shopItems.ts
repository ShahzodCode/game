/** Static data for the shop: pictures (served from public/images/shop) and the health potion. */
export const SHOP_IMAGES = {
  pistolMagazine: '/images/shop/pistol-magazine.svg',
  rifleMagazine: '/images/shop/rifle-magazine.svg',
  shotgun: '/images/shop/shotgun.svg',
  shotgunShells: '/images/shop/shotgun-shells.svg',
  potion: '/images/shop/health-potion.svg',
  smg: '/images/shop/smg.svg',
  smgMagazine: '/images/shop/smg-magazine.svg',
  sniper: '/images/shop/sniper.svg',
  sniperRounds: '/images/shop/sniper-rounds.svg',
  crossbow: '/images/shop/crossbow.svg',
  crossbowBolts: '/images/shop/crossbow-bolts.svg',
  launcher: '/images/shop/launcher.svg',
  launcherGrenades: '/images/shop/launcher-grenades.svg',
} as const;

/** The picture for a weapon's shop entry: the gun itself until it is bought, then its ammo. */
export function weaponShopImage(weaponId: string, owned: boolean): string {
  switch (weaponId) {
    case 'pistol':
      return SHOP_IMAGES.pistolMagazine;
    case 'rifle':
      return SHOP_IMAGES.rifleMagazine;
    case 'shotgun':
      return owned ? SHOP_IMAGES.shotgunShells : SHOP_IMAGES.shotgun;
    case 'smg':
      return owned ? SHOP_IMAGES.smgMagazine : SHOP_IMAGES.smg;
    case 'sniper':
      return owned ? SHOP_IMAGES.sniperRounds : SHOP_IMAGES.sniper;
    case 'crossbow':
      return owned ? SHOP_IMAGES.crossbowBolts : SHOP_IMAGES.crossbow;
    case 'launcher':
      return owned ? SHOP_IMAGES.launcherGrenades : SHOP_IMAGES.launcher;
    default:
      return SHOP_IMAGES.pistolMagazine;
  }
}

/** Healing is only possible with potions: bought here, carried, and drunk with H. */
export const POTION = {
  name: 'Health potion',
  price: 250,
  heal: 50, // health restored per potion
  max: 3, // most potions that can be carried
};
