# Bot Shooter

Simple 3D first-person shooter prototype. Three.js + TypeScript + Vite. Claude is in charge of the project; the user directs it step by step.

## Commands
- `npm run dev` — dev server (http://localhost:5173). If Vite stops picking up edits (stale code in the browser) or after moving files, restart it.
- `npx tsc --noEmit` — type check

## Layout
```
index.html                 markup only (HUD, pause menu, rules window, shop containers)
src/
  main.ts                  game entry: startup, per-frame loop (weapon upkeep, viewmodel animation), DEV hook window.__game
  game/state.ts            tunables + ALL mutable game state in one object `S` (health, cash, phase, level, ...) and `keys`
  game/core.ts             renderer, scene, camera, world, player pos/vel, weapons + viewmodels, tracer/impact effects, `$`
  game/actors.ts           bots + wolves, BotHooks (how bots reach the player), Target type
  game/player.ts           damagePlayer, usePotion, movePlayer (movement + AABB collision)
  game/combat.ts           switch/cycle/reload weapons, fire(), knife, applyHit (score, alerts, mission stats)
  game/flow.ts             levels, missions, gate/phase machine (updateFlow), level build queue, resetFlow
  game/shops.ts            weapon + supply shop definitions, updateShop, buying
  game/hud.ts              HUD elements, popup/banner, per-frame HUD timers, pause-menu summary
  game/nametag.ts          crosshair name tag
  game/save.ts             localStorage save/load/autosave
  game/session.ts          resetGame()
  game/input.ts            keyboard/mouse, pointer lock + Esc handling, pause-menu buttons (mute, new game, test cash)
  game/rules.ts            rules window (tables generated from game data)
  game/missions.ts         levelConfig(level), generateMissions(): 5 missions per level, LevelStats
  styles/main.css          all CSS
  audio/audio.ts           weapon sounds, reload sounds, synthesized sfx, master gain / mute
  entities/mannequin.ts    bots: costumes (COSTUMES: points, health, weight), brains (civilian fear/flee, cowboy/criminal fighting), animation, shared pushOutOfBoxes()
  entities/botModel.ts     procedural detailed human (face, hair, hands, shoes, per-costume outfit/props), LOOKS table
  entities/wolf.ts         wolves: model (jaw, ears, bent legs, tail, fur gradient), calm/chase/bite behaviour
  entities/meshBuilder.ts  merges many small coloured shapes into ONE mesh (vertex colours) = cheap detailed models
  weapons/weapons.ts       WEAPONS stat sheet, Weapon runtime state (magazines, ownership), blocky viewmodels (fallback + knife)
  weapons/models.ts        loads the real .glb viewmodels (pistol/rifle/shotgun), scales/orients them via SPECS, studio env map for metal
  world/world.ts           heightmap terrain, structures, rocks, supply-shop kiosk, bot spawn helpers, indoor/outdoor lighting
  world/rooms.ts           safe room (weapon shop), candle-lit airlock, the two huge sliding Doors, exit light
  shop/shopItems.ts        shop image paths, health potion constants
public/
  models/                  pistol.glb, rifle.glb, shotgun.glb (optimized by scripts/optimize-models.mjs; see Conventions)
  audio/weapons/           mp3 files (rifle-burst, rifle-reload, pistol-shot, pistol-reload, shotgun-shot, shotgun-pump)
  images/shop/             SVG pictures for shop items (pistol/rifle magazine, shotgun, shotgun shells, health potion)
```

## Conventions
- Room geometry (rooms.ts): never overlap two flat faces with different colours (z-fighting flicker). Pieces must only touch (floors end exactly where the next begins, walls stop where gate pillars start). Signs are static boards (`makeSignBoard`), not Sprites (sprites swivel to face the camera).
- Weapons (pistol/rifle/shotgun) use imported .glb models (weapons/models.ts; the blocky procedural ones show until a model loads and stay as fallback; the knife is still procedural). To add or swap one: run `node scripts/optimize-models.mjs <dir>` (strips Blender camera/light/backdrop nodes, textures -> 1024 px WebP), then add a SPECS entry (rotY so the barrel points -z, length in metres, placement). Characters and wolves: build them with `MeshBuilder` and merge per body part (torso/head/arms/legs = one hit-testable mesh each, ~5-8k triangles per character). Small details automatically use fewer polygons. SVG for shop pictures. Physics is hand-rolled AABB.
- To add a costume: add an entry to COSTUMES (mannequin.ts), a LOOKS entry + its torso/hat/leg details in botModel.ts.
- Weapon tuning lives only in `WEAPONS` (weapons/weapons.ts). Bot/wolf tuning at the top of their files.
- Mutable state lives in `S` (game/state.ts): modules can't assign an imported `let`, so write `S.cash += 5`. Avoid import cycles at module top level (only call cross-module functions inside functions).
- Dev hook `window.__game` (DEV only) lets automated checks move the camera / simulate input without pointer lock.

## Game design notes
- Terrain: `world.heightAt(x, z)` (hills/pits in `BUMPS`, rock piles in `PILES`; structures flatten the ground). Arena is 120x120 (`half = 60`); 24 wandering bots, 3 wolves.
- Controls: WASD, Space jump, Ctrl run, Shift crouch, 1/2/3/4 weapons (pistol, rifle, shotgun[bought], knife), Q/wheel cycle owned weapons, R reload, H drink potion, E shop, Esc pause.
- Knife (`melee: true` in WEAPONS, always owned): no ammo/reload/shop entry (the shop lists only `shopWeapons` = non-melee), 2.4 m reach, 3 rays over a +-11 degree arc, 40 dmg (x2 head), swish sound, slash animation (`swingT`).
- Bot combat (costume fields `combat`, `zone`, `speedMul` in COSTUMES): Cowboy (`ranged`) is harmless until shot (nearby cowboys join in via `alertPack`), then keeps ~13 m away, circles, needs line of sight (`hooks.lineOfSight` raycasts world.blockers) and shoots (9 dmg, accuracy drops with distance). Criminal (`melee`, `zone: 'edge'`) spawns/patrols in the band 5-14 m from the walls (`world.randomEdgePoint`), attacks automatically within 36 m, stabs for 10 dmg, gives up after 3 s beyond 52 m, then ignores the player for 8 s. Sporty x1.7 and Superman x1.9 walking speed. `BotHooks` (mannequin.ts) is how bots reach the player (damage, tracers, sounds).
- Civilian AI (harmless costumes, `Mannequin.civilian`, modes calm/startle/flee/cower): shot => `panic(true)`: freeze 0.1-0.3 s with hands up (+ scream, `hooks.scream`), then run away at ~5.8 m/s (never faster than 1.3x; the player sprints at 9) steering around crates/walls (`pickRunHeading` probes 8 directions), 14-22 s of fear; cornered => cower. Gunshots (`Mannequin.scareNear` from `fire()`, 16 m, shotgun 24 m), deaths (26 m) and running neighbours (contagion, 9 m) panic others for 7-12 s. After calming down a bot stays `wary` 10-16 s (runs again if the player comes within 14 m). Bravery (random + soldier/builder/superman bonus) lengthens the freeze and shortens fear. Wounded (<45% HP) bots limp and hunch. Calm bots: follow the player with their head within 11 m, idle gestures (stretch, watch, hips, wave, scratch), step away from a player closer than 2 m, keep apart from each other (`separate`). Armed bots: cowboys wait ~0.5-0.9 s before the first shot, sometimes fire a quick double shot, strafe at varying speeds and sidestep when hit; criminals step back after a stab (hit and run); ninjas zig-zag; all armed bots can `retreat` (run for cover 3-5 s, once per life) when below 30% (cowboy) / 20% (melee) HP. Dying: falls backwards with arms flung (group Euler order is YXZ), lies ~2.5 s, shrinks.
- Scoring: 10 per landed shot (once per shot, not per pellet), kill = costume points (+50 headshot kill). Cash = same amounts, spent at the shop. Pause menu `#btnCash` (+$100000) is TEST ONLY - delete later (index.html + game/input.ts).
- Ammo is magazine-based: `Weapon.ammo` + `Weapon.spare[]` (max 6 spare; reload swaps in the fullest spare). Shotgun is locked at the start (`unlockPrice: 3000`, comes loaded + 1 spare); once owned its shop entry sells shells.
- Player: 100 HP, NO natural regeneration. Health potions ($250, heal 50, carry 3) bought at the shop, drunk with H. Death screen with "Play again".
- Shops (game/shops.ts): WEAPON shop in the safe room (sells locked guns: the shotgun) and SUPPLY shop beside the arena gate (magazines for owned guns + potion). Stand in the green circle -> "Press E" -> E opens the window -> press the item's number.
- Level flow (phase in game/flow.ts, updateFlow): safe room (z 80-107) --gate1 (z=80)--> airlock (z 60-80) --gate2 (z=60)--> arena. Walk 4 m into the airlock: gate1 seals -> 'loading' (startLevel() builds the level behind closed doors, 2.6 s) -> gate2 opens -> entering the arena closes gate2 behind you. 3 finished missions (MISSIONS_TO_FINISH) -> levelComplete(): gate2 opens + bright exit light; entering the airlock seals it, level++, gate1 opens (0.6 s beat, no loading screen). Bots/wolves are only simulated while renaActive(). Characters have a minLevel in COSTUMES (criminal 2, ninja 7; used by levelConfig.allowed); level 1 has no wolves; the level that introduces a character guarantees at least 2 of it. Level building is queued (levelWork, 2 items per frame while the doors are shut): no freeze, no loading screen. Missions: 5 per level, first is always a score target, harder and better paid each; rewards scale with level; startLevel forces the characters the missions need to exist (orceCostume).
- Name tag (game/nametag.ts): 10 Hz raycast from the crosshair, shows name + HP, red for hostile.
- Wolves: calm wanderers until shot, then chase at 7.5 m/s and bite (12 dmg/s); packmates within 12m join in; give up if the player stays >45m away for 6s. 30s respawn far from the player. Bots and wolves share the Target interface (`label`, `points`, `damage`, `hitMeshes`).
- Esc: first Play goes fullscreen + `navigator.keyboard.lock(['Escape'])` (Chromium) so the page receives Esc itself: Esc closes the shop, else pauses via `document.exitPointerLock()` (script exit => Esc can re-capture the mouse without a click). Fallback (no keyboard lock): the browser releases the mouse on Esc and doesn't deliver that keydown while locked. Esc in-game -> pointerlockchange: shop open => close it ("soft pause", any key/click continues), else pause menu; Esc in the menu calls startPlaying() (may be refused right after an Esc; Resume always works).
- Sounds: pistol one-shot, rifle looped burst, shotgun blast + pump 0.4s later, reload sounds for pistol/rifle (reloadTime matches: 1.15s / 2.4s). Wolf growl, hurt and potion sounds are synthesized. Mute button in the pause menu (remembered in localStorage).

- Saved progress (game/save.ts, localStorage key `botshooter.save.v1`): ONLY level, cash, and each weapon's owned/ammo/spare magazines. Written once a second when something changed + on pagehide/hidden; read once at start (`loadProgress`: clamps bad values, ignores unknown weapons and other versions). Health, potions, score, arena and missions are NOT saved. `resetGame()` keeps the save (Reload map / Play again); `resetGame(true)` + `clearSave()` is the "New game" button. If you change the save shape, bump `v` and handle the old version in `loadProgress`.

## Status
Playable prototype with a level system: safe room, airlock, arena, 5 missions per level, shops, health + potions, bots, wolves, rules window.
