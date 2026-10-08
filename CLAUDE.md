# Bot Shooter

Simple 3D first-person shooter prototype. Three.js + TypeScript + Vite. Claude is in charge of the project; the user directs it step by step.

## Commands
- `npm run dev` — dev server (http://localhost:5173). If Vite stops picking up edits (stale code in the browser) or after moving files, restart it.
- `npx tsc --noEmit` — type check

## Layout
```
index.html                 markup only (HUD, pause menu, rules window, shop containers)
src/
  main.ts                  game entry: scene, player movement/collision, input, shooting, HUD, shops, level/gate flow, name tag, loop
  game/missions.ts         levelConfig(level), generateMissions(): 5 missions per level, LevelStats
  styles/main.css          all CSS
  audio/audio.ts           weapon sounds, reload sounds, synthesized sfx, master gain / mute
  entities/mannequin.ts    bots: costumes (COSTUMES: points, health, weight), wandering + animation, shared pushOutOfBoxes()
  entities/botModel.ts     procedural detailed human (face, hair, hands, shoes, per-costume outfit/props), LOOKS table
  entities/wolf.ts         wolves: model (jaw, ears, bent legs, tail, fur gradient), calm/chase/bite behaviour
  entities/meshBuilder.ts  merges many small coloured shapes into ONE mesh (vertex colours) = cheap detailed models
  weapons/weapons.ts       WEAPONS stat sheet, Weapon runtime state (magazines, ownership), blocky viewmodels
  world/world.ts           heightmap terrain, structures, rocks, supply-shop kiosk, bot spawn helpers, indoor/outdoor lighting
  world/rooms.ts           safe room (weapon shop), candle-lit airlock, the two huge sliding Doors, exit light
  shop/shopItems.ts        shop image paths, health potion constants
public/
  audio/weapons/           mp3 files (rifle-burst, rifle-reload, pistol-shot, pistol-reload, shotgun-shot, shotgun-pump)
  images/shop/             SVG pictures for shop items (pistol/rifle magazine, shotgun, shotgun shells, health potion)
```

## Conventions
- Room geometry (rooms.ts): never overlap two flat faces with different colours (z-fighting flicker). Pieces must only touch (floors end exactly where the next begins, walls stop where gate pillars start). Signs are static boards (`makeSignBoard`), not Sprites (sprites swivel to face the camera).
- 3D models are procedural (no asset files): build them with `MeshBuilder` and merge per body part (torso/head/arms/legs = one hit-testable mesh each, ~5-8k triangles per character). Small details automatically use fewer polygons. SVG for shop pictures. Physics is hand-rolled AABB.
- To add a costume: add an entry to COSTUMES (mannequin.ts), a LOOKS entry + its torso/hat/leg details in botModel.ts.
- Weapon tuning lives only in `WEAPONS` (weapons/weapons.ts). Bot/wolf tuning at the top of their files.
- Dev hook `window.__game` (DEV only) lets automated checks move the camera / simulate input without pointer lock.

## Game design notes
- Terrain: `world.heightAt(x, z)` (hills/pits in `BUMPS`, rock piles in `PILES`; structures flatten the ground). Arena is 120x120 (`half = 60`); 24 wandering bots, 3 wolves.
- Controls: WASD, Space jump, Ctrl run, Shift crouch, 1/2/3/4 weapons (pistol, rifle, shotgun[bought], knife), Q/wheel cycle owned weapons, R reload, H drink potion, E shop, Esc pause.
- Knife (`melee: true` in WEAPONS, always owned): no ammo/reload/shop entry (the shop lists only `shopWeapons` = non-melee), 2.4 m reach, 3 rays over a +-11 degree arc, 40 dmg (x2 head), swish sound, slash animation (`swingT`).
- Bot combat (costume fields `combat`, `zone`, `speedMul` in COSTUMES): Cowboy (`ranged`) is harmless until shot (nearby cowboys join in via `alertPack`), then keeps ~13 m away, circles, needs line of sight (`hooks.lineOfSight` raycasts world.blockers) and shoots (9 dmg, accuracy drops with distance). Criminal (`melee`, `zone: 'edge'`) spawns/patrols in the band 5-14 m from the walls (`world.randomEdgePoint`), attacks automatically within 36 m, stabs for 10 dmg, gives up after 3 s beyond 52 m, then ignores the player for 8 s. Sporty x1.7 and Superman x1.9 walking speed. `BotHooks` (mannequin.ts) is how bots reach the player (damage, tracers, sounds).
- Scoring: 10 per landed shot (once per shot, not per pellet), kill = costume points (+50 headshot kill). Cash = same amounts, spent at the shop. Pause menu `#btnCash` (+$100000) is TEST ONLY - delete later (index.html + main.ts).
- Ammo is magazine-based: `Weapon.ammo` + `Weapon.spare[]` (max 6 spare; reload swaps in the fullest spare). Shotgun is locked at the start (`unlockPrice: 3000`, comes loaded + 1 spare); once owned its shop entry sells shells.
- Player: 100 HP, NO natural regeneration. Health potions ($250, heal 50, carry 3) bought at the shop, drunk with H. Death screen with "Play again".
- Shops (shops in main.ts): WEAPON shop in the safe room (sells locked guns: the shotgun) and SUPPLY shop beside the arena gate (magazines for owned guns + potion). Stand in the green circle -> "Press E" -> E opens the window -> press the item's number.
- Level flow (phase in main.ts, updateFlow): safe room (z 80-107) --gate1 (z=80)--> airlock (z 60-80) --gate2 (z=60)--> arena. Walk 4 m into the airlock: gate1 seals -> 'loading' (startLevel() builds the level behind closed doors, 2.6 s) -> gate2 opens -> entering the arena closes gate2 behind you. 3 finished missions (MISSIONS_TO_FINISH) -> levelComplete(): gate2 opens + bright exit light; entering the airlock seals it, level++, gate1 opens (0.6 s beat, no loading screen). Bots/wolves are only simulated while renaActive(). Characters have a minLevel in COSTUMES (criminal 2, ninja 7; used by levelConfig.allowed); level 1 has no wolves; the level that introduces a character guarantees at least 2 of it. Level building is queued (levelWork, 2 items per frame while the doors are shut): no freeze, no loading screen. Missions: 5 per level, first is always a score target, harder and better paid each; rewards scale with level; startLevel forces the characters the missions need to exist (orceCostume).
- Name tag (updateNametag): 10 Hz raycast from the crosshair, shows name + HP, red for hostile.
- Wolves: calm wanderers until shot, then chase at 7.5 m/s and bite (12 dmg/s); packmates within 12m join in; give up if the player stays >45m away for 6s. 30s respawn far from the player. Bots and wolves share the Target interface (`label`, `points`, `damage`, `hitMeshes`).
- Esc: first Play goes fullscreen + `navigator.keyboard.lock(['Escape'])` (Chromium) so the page receives Esc itself: Esc closes the shop, else pauses via `document.exitPointerLock()` (script exit => Esc can re-capture the mouse without a click). Fallback (no keyboard lock): the browser releases the mouse on Esc and doesn't deliver that keydown while locked. Esc in-game -> pointerlockchange: shop open => close it ("soft pause", any key/click continues), else pause menu; Esc in the menu calls startPlaying() (may be refused right after an Esc; Resume always works).
- Sounds: pistol one-shot, rifle looped burst, shotgun blast + pump 0.4s later, reload sounds for pistol/rifle (reloadTime matches: 1.15s / 2.4s). Wolf growl, hurt and potion sounds are synthesized. Mute button in the pause menu (remembered in localStorage).

- Saved progress (main.ts, localStorage key `botshooter.save.v1`): ONLY level, cash, and each weapon's owned/ammo/spare magazines. Written once a second when something changed + on pagehide/hidden; read once at start (`loadProgress`: clamps bad values, ignores unknown weapons and other versions). Health, potions, score, arena and missions are NOT saved. `resetGame()` keeps the save (Reload map / Play again); `resetGame(true)` + `clearSave()` is the "New game" button. If you change the save shape, bump `v` and handle the old version in `loadProgress`.

## Status
Playable prototype with a level system: safe room, airlock, arena, 5 missions per level, shops, health + potions, bots, wolves, rules window.
