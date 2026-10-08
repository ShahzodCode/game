# Bot Shooter: plan and progress

Read `CLAUDE.md` first: it has the file layout, conventions and design notes. This file is the hand-off: what is done and what is next.

## Stack
Three.js + TypeScript (strict) + Vite. Procedural 3D (no model files). Run `npm install`, `npm run dev` (http://localhost:5173), check types with `npx tsc --noEmit`.

## Done
- First-person controls: move, jump, run (Ctrl), crouch (Shift), mouse look, hand-rolled AABB physics, hilly terrain.
- Weapons: pistol, rifle, shotgun (bought), knife. Magazine-based ammo, reload sounds.
- Bots with 11 costumes (regular, winter, builder, sporty, chef, rich, cowboy, soldier, superman, criminal, ninja). Ranged and melee AI. Wolves.
- Player health, potions (shop only), score.
- Levels: safe room -> airlock -> arena, with sliding doors. 5 missions per level, 3 needed. Money comes only from missions. Weapon shop (hub) and supply shop (arena gate). Characters unlock by level (criminal 2, ninja 7).
- Rules window, pause menu, mute, Esc handling (fullscreen + keyboard lock).
- Progress saved in localStorage (level, cash, weapons, ammo).

## Known caveats
- Nothing has been hand-played by the author. It was checked with simulated tests and screenshots, so gameplay feel (balance, difficulty) is untested.
- The pause menu button `+$100000 (test)` (`#btnCash` in index.html + its handler in src/game/input.ts) is TEST ONLY. Delete it before release.
- Esc-to-resume relies on Chromium fullscreen/keyboard lock.
- Save is per browser and origin.

- Bot AI v2: civilians flee/cower/spread panic, armed bots dodge/retreat, more animation (run, flinch, gestures, death fall). Untested by hand: tune FLEE_SPEED, fear times and radii in `mannequin.ts` after playtesting.

## Ideas / next steps (the user decides priority; ask when unsure)
1. Playtest and balance: mission targets, rewards, enemy health/damage per level.
2. ~~Split `src/main.ts` into modules.~~ Done: see `src/game/*` and the layout in `CLAUDE.md`.
3. More weapons for the weapon shop (it currently sells only the shotgun). Pistol/rifle/shotgun now use real .glb models (done); the knife and the characters/wolves are still procedural. Licences of the uploaded models are unknown: add credits if they need them.
4. More enemy types for later levels, possibly bosses.
5. Remove the test cash button.
6. Settings (mouse sensitivity, volume), a proper title screen.

## Conventions to keep
- Never overlap coplanar faces of different colours (z-fighting). Signs are static boards.
- Weapon tuning only in `WEAPONS`; bot tuning at the top of their files.
- Update `CLAUDE.md` when mechanics change.
