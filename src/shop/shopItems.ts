/** Static data for the shop: pictures (served from public/images/shop) and the health potion. */
export const SHOP_IMAGES = {
  pistolMagazine: '/images/shop/pistol-magazine.svg',
  rifleMagazine: '/images/shop/rifle-magazine.svg',
  shotgun: '/images/shop/shotgun.svg',
  shotgunShells: '/images/shop/shotgun-shells.svg',
  potion: '/images/shop/health-potion.svg',
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
