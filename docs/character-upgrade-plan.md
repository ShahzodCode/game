# Character upgrade plan (low-poly style)

**Status:** steps 1-5 and 7 are implemented (see CLAUDE.md, "LOW-POLY CHARACTER PASS"); step 6 was replaced by the downloaded knight and PolyArt zombie models.

Decision: stay **low poly**, matching the arena (flat-shaded trees and rocks). Characters stay built in code
(`src/entities/botModel.ts`, `MeshBuilder`), because every animation, hit zone (head / torso / arms / legs) and effect
(panic poses, punch wind-up, panting, crossbow freeze, death fall) depends on that rig. Only the **boss** and the
**zombie** are candidates for downloaded models.

## What is wrong today
- The characters are detailed but *smooth*: spheres with 12-14 segments, round limbs. Next to the flat-shaded, faceted
  world they look like a different game.
- Faces are tiny geometry (eyes, brows, mouth boxes): they read poorly at 10+ m and every character has the same neutral face.
- Silhouettes are too similar: most are a person in a coloured shirt. Only hats / props differ.
- Zombies and the boss are the ordinary human model with other colours and a scale factor.

## Plan, in order (each step is shown with screenshots before it is committed)

### 1. One low-poly look for everything (biggest visual win)
- `src/entities/meshBuilder.ts`: new "faceted" option: `ball`, `cyl`, `cone` use far fewer segments (spheres 7x5 instead of
  14x10, limbs 6-7 sided), and the merged character material gets `flatShading: true` (same as rocks).
- `src/entities/botModel.ts`: torso lathe profile with fewer rings, chunkier limbs, hands as simple mitten blocks
  (no individual finger balls), shoes as wedges.
- Triangles per character drop (about 5-8k -> 2-3k), so this also helps frame rate with 24 bots + zombies.

### 2. Stylised proportions
- Slightly bigger head (about +15%), broader shoulders, shorter legs: reads better from far away and looks "toy-like",
  which suits low poly. Per-costume body type: Builder wide and heavy, Sporty lean, Chef round, Rich tall and thin,
  Soldier broad, Superman huge chest.
- Needs a few constants changed in `botModel.ts` (head scale, `tx` / `tz` torso factors, leg length) and
  a matching check of the animation pivots in `mannequin.ts` (`animate()`), so arms and legs still swing from the right joints.

### 3. Faces that read
- Face painted on a small canvas texture per costume (big eyes, brows, mouth) instead of micro geometry; expression per
  character: Soldier stern, Cowboy squint with moustache, Chef cheerful, Rich smug, Criminal scowl, Winter sleepy, Sporty grin.
- Expression changes with state: scared (wide eyes, open mouth) when fleeing, angry when attacking, pain when hit.
  (small hook in `mannequin.ts`: `setExpression(name)` called from `panic()`, `aggravate()`, `damage()`).

### 4. Distinct silhouettes per costume
- Bigger, bolder props and clothing shapes: Winter puffy jacket + bobble hat + scarf tails, Builder hard hat + vest + tool belt,
  Chef tall hat + apron, Rich top hat / suit tails + cane, Cowboy wide hat + vest + holster + poncho, Soldier helmet + backpack
  + vest, Superman cape + chest emblem, Ninja hood + scarf tails + back sword, Criminal beanie + mask + bag.
- Mostly additions in the `switch (id)` blocks of `botModel.ts` (torso details, hats, leg details).

### 5. Cheap depth and polish
- Baked "ambient occlusion" in vertex colours (darker under the chin, arms, belt; lighter on shoulders / top of head).
- Colour variety: skin / hair / outfit tints per bot already exist; add accent colours and a few outfit variants per costume.
- Small secondary animation: cape / scarf / coat tails follow motion (already for the cape; extend to scarves and coat tails).

### 6. Zombie and boss (own look, even before any downloaded model)
- Zombie: hunched posture, arms forward, torn clothes (ragged hem boxes), green-grey skin, one missing sleeve, shuffling walk
  (new walk style flag in `animate()`).
- Boss: much larger and heavier silhouette: broad hunched shoulders, long arms, horns, spiked shoulder plates, glowing eyes
  and chest cracks (emissive vertex colours), cape of torn cloth.

### 7. Wolf (small)
- Same faceted treatment (fewer segments + flat shading), keep the existing animation.

## Where it changes in the codebase
| File | Change |
|---|---|
| `src/entities/meshBuilder.ts` | segment counts, faceted mode |
| `src/entities/botModel.ts` | proportions, faceted parts, face textures, costume silhouettes, AO colours |
| `src/entities/mannequin.ts` | expressions hook, zombie walk, minor pivot fixes |
| `src/entities/wolf.ts` | faceted look |
| `CLAUDE.md` | document the new look rules |

Not touched: weapons, arena, AI, audio, HUD. Hit zones (head / torso / limbs) keep working because the part structure stays.

## Models to look for online (only these two)

Everything else stays built in code, so the whole cast keeps one consistent style and one animation system.

### 1. Boss: "The Colossus" (most important)
- What: a **giant demi-human / ogre-demon**, about 2-3 m tall relative to a normal human, bulky and hunched.
- Look: bruised violet or grey-blue skin, two horns, broad shoulders with spiked or armoured plates, long heavy arms, dark
  tattered robe or armour, red or orange glowing eyes. Stylised low poly (flat colours, chunky shapes), NOT realistic.
- Search terms: `low poly ogre rigged`, `low poly demon boss rigged`, `low poly minotaur rigged`, `low poly giant`, `low poly golem`.
- Must have: **rigged humanoid skeleton** and animations (idle, walk, attack / punch, death; throwing and summoning poses are a
  bonus, a "cast spell" or "taunt" animation is perfect), `.glb` or `.gltf`, **under about 15,000 triangles**, free licence
  that allows use in a game (CC0 or CC-BY).

### 2. Zombie
- What: a classic **shambling zombie**, human size.
- Look: green-grey skin, torn clothes, arms hanging or stretched forward, hunched, simple low-poly face (open mouth, hollow eyes).
- Search terms: `low poly zombie rigged`, `stylized zombie low poly animated`.
- Must have: rigged, animations idle / walk or shamble / run / attack / death, `.glb`, **under about 5,000 triangles** (up to 8 can
  be on screen at once), free game-use licence.
- Bonus: several skin variants of the same model.

Good sources: Quaternius (CC0, low poly, rigged, animated), Kenney (CC0), Sketchfab (filter "Downloadable" and check the licence
on each model), Mixamo (rigging and animations, needs a free Adobe account), itch.io low-poly asset packs.

### Why only these two
- **Boss:** its size and menace are the whole point of the final fight, and a hand-built human scaled up never looks like a monster.
- **Zombie:** it is the one enemy that is meant to look completely different from the humans, and good free low-poly zombies are common.
- The wolf is an animal with its own animation style; the current one is good enough and the faceted pass will bring it into the
  same look. Superman, ninja and the other humans only need silhouette and face work, which steps 1 to 5 cover.

## What I need from you
1. OK on this plan (or changes).
2. Optionally, the boss and zombie `.glb` files uploaded in the chat (I will add them after steps 1-5, or earlier if you prefer).
   Please tell me the licence / source of each model.
