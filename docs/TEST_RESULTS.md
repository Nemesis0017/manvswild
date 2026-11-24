# Test results

All output below was produced in this sandbox (Node 22, headless Chromium with SwiftShader software WebGL, no GPU).

## npm run typecheck, npm test, npm run build

```
> manvswild@0.1.0 typecheck
> tsc --noEmit

---


 RUN  v5.1.1 /projects/sandbox/manvswild

 ✓ src/wildlife/ai.test.ts (14 tests) 47ms
 ✓ src/world/weather.test.ts (9 tests) 42ms
 ✓ src/world/terrain.test.ts (8 tests) 120ms
 ✓ src/survival/survival.test.ts (25 tests) 94ms
 ✓ src/exploration/exploration.test.ts (8 tests) 43ms
 ✓ src/save/save.test.ts (6 tests) 23ms
 ✓ src/game/session.test.ts (6 tests) 159ms
 ✓ src/items/inventory.test.ts (9 tests) 9ms
 ✓ src/items/nodes.test.ts (6 tests) 27ms
 ✓ src/building/building.test.ts (10 tests) 7ms
 ✓ src/game/game.test.ts (11 tests) 13ms
 ✓ src/items/crafting.test.ts (7 tests) 8ms
 ✓ src/audio/surface.test.ts (3 tests) 5ms
 ✓ src/ui/bindings.test.ts (3 tests) 4ms

 Test Files  14 passed (14)
      Tests  125 passed (125)
   Start at  15:27:39
   Duration  500ms (tests 53%, import 28%, transform 14%, worker 5%)

---
✓ 91 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                     0.55 kB │ gzip:     0.37 kB
dist/assets/index-D8pCIr52.css     11.55 kB │ gzip:     3.05 kB
dist/assets/index-Ckf3iN6M.js   5,351.45 kB │ gzip: 1,953.91 kB

[plugin builtin:vite-reporter] 
(!) Some chunks are larger than 2500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rolldownOptions.output.codeSplitting to improve chunking: https://rolldown.rs/reference/OutputOptions.codeSplitting
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
✓ built in 433ms
---
      2 https://react.dev/errors/
      3 http://www.w3.org/1998/Math/MathML
      1 http://www.w3.org/1999/xhtml
      7 http://www.w3.org/1999/xlink
      5 http://www.w3.org/2000/svg
      3 http://www.w3.org/XML/1998/namespace
```

`npm test`: 14 files, 125 tests, all passing. This includes the save/load round trip against an IndexedDB implementation (`fake-indexeddb`), a scripted ten mission Story playthrough driven through the real `Session` class (events, teleports, sky time, river crossing, cave time, summit, signal, extraction), the mission tracker, endless escalation, sandbox options, exploration and fog of war, POI generation, footstep surface mapping and key binding tables.

The only URLs in `dist/` are XML namespace identifiers and React's error documentation link strings. No script, font, image or style is fetched from a CDN.

`npm run preview` was not run (a preview server was not allowed in this sandbox). The smoke test serves `dist/` with a small Node static server instead, which serves the same files.

## Headless browser smoke test

Script: `scripts/smoke-flow.mjs` (uses `playwright-core` installed outside the repo plus a Chromium headless shell; paths inside the script are specific to this sandbox). It serves `dist/`, opens `/?debug` (which exposes `window.__mvw`), and drives the real UI by clicks and key presses. Some state is inspected or set through `window.__mvw`, for example `session.debugCompleteAll()` for the scripted story completion and teleporting to the cairn.

```
PASS main menu shows buttons
PASS no Continue without saves
PASS menu flythrough camera is above ground and no session  {"y":19.16627909829298,"status":"menu","session":false}
PASS graphics preset persisted to localStorage  {"preset":"high","bloom":true}
PASS remap Move forward to T  ["KeyT"]
PASS bindings reset
PASS audio, colorblind persisted  {"m":0.3,"c":"deuteranopia"}
PASS achievements screen
PASS records screen
PASS help screen
PASS load screen lists slots, all empty
PASS expedition shows scenarios
PASS sandbox shows options
PASS story session started with chosen seed/mode  {"mode":"story","day":1,"mission":"water","missionsDone":0,"wood":0,"x":-6,"z":10,"seed":4242,"outcome":null,"expl":0.2,"wps":0}
PASS difficulty and character applied  {"d":"explorer","c":"tinkerer","perk":20}
PASS HUD shows compass, minimap, tracker
PASS audio context created and running  {"ctx":true,"state":"running"}
PASS panel map opens with KeyM
PASS Escape closes map
PASS panel journal opens with KeyJ
PASS Escape closes journal
PASS panel inventory opens with KeyI
PASS Escape closes inventory
PASS click on map places a waypoint  {"mode":"story","day":1,"mission":"water","missionsDone":0,"wood":3,"x":-6,"z":10,"seed":4242,"outcome":null,"expl":0.2,"wps":1}
PASS waypoint can be tracked
PASS skills tab
PASS achievements tab
PASS stats tab
PASS drag and drop moves an item  {"before0":"waterskin","after0":null,"after10":"waterskin"}
PASS crafting button crafts rope
PASS teleporting to the cairn discovers it  {"mode":"story","day":1,"mission":"water","missionsDone":0,"wood":8,"x":-394,"z":107,"seed":4242,"outcome":null,"expl":0.41,"wps":1}
PASS exploration percent increases
PASS pause menu appears on P
PASS manual save to slot 1
PASS overwrite asks for confirmation
PASS resume returns to playing
PASS autosave wrote the auto slot  ["1","auto"]
PASS Continue button appears after reload
PASS Continue restores seed, mode, mission and position  {"cont":{"mode":"story","day":1,"mission":"water","missionsDone":0,"wood":8,"x":-394,"z":107,"seed":4242,"outcome":null,"expl":0.41,"wps":1},"savedState":{"mode":"story","day":1,"mission":"water","missionsDone":0,"wood":8,"x":-394,"z":107,"seed":4242,"outcome":null,"expl":0.41,"wps":1}}
PASS Continue restores exploration and waypoints  {"mode":"story","day":1,"mission":"water","missionsDone":0,"wood":8,"x":-394,"z":107,"seed":4242,"outcome":null,"expl":0.41,"wps":1}
PASS Continue restores inventory
BIND ["F5"]
CODES ["F5"] ["Game saved."]
PASS F5 quick save writes the quick slot  ["1","auto","quick"] http://localhost:4176/?debug
PASS scripted story completion reaches victory  {"mode":"story","day":1,"mission":null,"missionsDone":10,"wood":8,"x":-394,"z":107,"seed":4242,"outcome":"victory","expl":0.41,"wps":1}
PASS end screen visible
PASS record and achievement saved  {"bestSeconds":12.683333333333543,"completions":1}
HIT {"r":[420,474,159,48],"hit":"BUTTON.mvw-btn","n":1,"vp":[1280,720]}
PASS delete asks for confirmation
PASS slot deleted
PASS Endless Survival starts  {"mode":"endless","day":1,"mission":null,"missionsDone":0,"wood":0,"x":-6,"z":10,"seed":4242,"outcome":null,"expl":0,"wps":0}
PASS Sandbox starts  {"mode":"sandbox","day":1,"mission":null,"missionsDone":0,"wood":10,"x":-6,"z":10,"seed":4242,"outcome":null,"expl":0.32,"wps":0}
PASS Expedition starts  {"mode":"expedition","day":1,"mission":"x_fire","missionsDone":0,"wood":4,"x":-941,"z":-808,"seed":4242,"outcome":null,"expl":0,"wps":0}
PASS Expedition spawns in scenario biome with forced weather  {"biome":"snow","weather":"snowstorm","mission":"x_fire"}
PASS post-processing chain active
PASS canvas present with post-processing
ERRORS []
RESULT pass=53 fail=0 consoleErrors=0
```

What this does and does not prove:

- The menu, new game form, settings (persisted), key rebinding, panels, waypoint placement, drag and drop, crafting button, manual save, overwrite confirmation, autosave, quick save, reload, Continue, delete confirmation, victory screen, records, the other three modes, expedition biome spawn with forced weather, and post-processing activation all ran in a real browser with zero console errors or warnings.
- The Story completion in the browser uses `debugCompleteAll()`. The event-level version of the playthrough is the vitest file `src/game/session.test.ts`. Nobody has played the Story from start to finish by hand in a browser.
- Audio: the smoke test confirms an `AudioContext` is created and running. Nobody listened to it, so sound quality, balance and positional accuracy are untested by ear.
- Gamepad input was not tested (no gamepad available).
- Screenshots were viewed for the main menu, map, and victory screens only. Rendering used software WebGL, so frame rate figures are meaningless.
- One real defect was found and fixed during this run: the end screen and pause menu kept the mouse pointer locked, so their buttons could not be clicked. The game now releases pointer lock for the pause menu, rescue prompt and end screen.
- The quick save check was flaky on the slow software renderer (the IndexedDB read ran before the write finished), so the script now waits longer. The final run passed every check.
