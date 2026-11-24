# Man vs Wild

A browser 3D wilderness survival game. Procedural terrain, six biomes, weather, wildlife, crafting, building, four game modes, a ten mission Story, procedural audio, IndexedDB saves and a full React UI. Built with Vite, React, TypeScript, Three.js and Rapier (WASM inlined). No server, no CDN, no external assets: textures and sound are generated at runtime. Violence is low: animals warn, shove and retreat, and there is no gore or firearms.

> Survival hints in this game are simplified for play. They are not real survival advice.

## Install and run

```
npm install
npm run dev        # development server
npm run typecheck
npm test           # vitest
npm run build      # type check + production build into dist/
npm run preview    # serve dist/ locally
```

Needs Node 20 or newer and a browser with WebGL2 and IndexedDB. Add `?debug` to the URL to expose `window.__mvw` (engine object) for testing.

## Deploy to Vercel

`vercel.json` is included (static build, output `dist`, SPA rewrite, long cache for `/assets`). Import the repository in Vercel with the Vite preset, or run `npx vercel`. No environment variables are needed.

## Modes

- **Story**: ten missions: find water, build a shelter, survive the first night, reach the ranger cairn, cross a river, explore a cave, search an abandoned campsite, reach the summit, raise a signal at the summit, reach the extraction point.
- **Endless Survival**: no goal. Each new day raises drain, weather severity, damage and scarcity (capped at 2.5x).
- **Sandbox**: toggle needs, hazards, starting kit, weather, day length and resource yield.
- **Expedition**: six scenarios (one per biome) with their own start, restrictions, objectives and best times.

Difficulties: Explorer, Survivor, Extreme, Realistic. Four characters give a small starting skill bonus. World seeds are numbers or text.

## Controls (defaults, all remappable in Settings)

| Action | Key |
| --- | --- |
| Move | W A S D or arrows |
| Look | Mouse |
| Jump / swim up / skip intro | Space |
| Sprint | Shift |
| Crouch | Ctrl or C |
| Interact, gather, place | E |
| Use held item | F or left click |
| Throw a stone | G |
| Build mode, rotate, cancel | B, Q, right click |
| Rest at a sleeping area | R |
| Hotbar | 1 to 9 |
| Backpack and crafting | I or Tab |
| Map | M |
| Journal | J |
| Place waypoint | X |
| Toggle camera | V |
| Hide HUD | H |
| Pause | P (Esc releases the mouse) |
| Quick save / quick load | F5 / F9 |

Walk into steep rock to climb. Gamepad: left stick move, right stick look, A jump, B crouch, X interact, Y camera, LB backpack, RB map, RT use, LT throw, L3 sprint, Start pause, D-pad up journal, D-pad down rest, D-pad left rotate, D-pad right hide HUD.

## Architecture

```
src/core         event bus, Store, loop, input and bindings, settings, game state
src/world        seeded noise, terrain chunks, biomes, vegetation, water, sky, weather, caves
src/physics      Rapier wrapper and character controller
src/player       camera and model
src/survival     needs, hazards, difficulty (pure rules)
src/items        items, inventory, crafting, skills, harvest nodes
src/building     build pieces and rules
src/wildlife     animal AI state machines and models
src/gameplay     Gameplay: glue between world, player and the rule modules; HUD store
src/exploration  fog of war, waypoints, points of interest, compass math
src/game         modes, missions, progress (stats, achievements, records), Session
src/save         IndexedDB wrapper (SaveDb) and save format
src/audio        Web Audio synth engine and footstep surfaces
src/render       post-processing chain (EffectComposer)
src/ui           React screens, HUD, panels, canvas map, CSS
src/game.ts      Game: engine object that wires everything together
```

Pure logic (survival, items, missions, exploration, saves) is unit tested without a browser. `Session` reads the running `Gameplay` and publishes to `sessionStore` for the UI.

## Saves

Seven slots: Autosave, Quicksave, and slots 1 to 5, in IndexedDB database `manvswild`. Autosave runs every 2 minutes by default (Settings, 0 turns it off). Settings are stored in localStorage; records and achievements are account wide in localStorage. Continue loads the most recently written slot.

See `CHECKLIST.md`, `docs/FEATURE_REPORT.md` and `docs/TEST_RESULTS.md` for what is and is not implemented or tested.
