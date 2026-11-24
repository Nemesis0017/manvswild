# Feature report

> Survival hints in this game are simplified for play and are not real survival advice.

## Implemented

**Exploration** (`src/exploration`): fog of war on a 32 m grid, revealed as you move (radius grows with Navigation skill). Exploration percent counts cells within 1200 m of the spawn. Points of interest are generated from the seed: ranger cairn, six landmarks, four abandoned campsites (searchable once; they give salvage, rope, leaves and clean water, and the first also holds a signal kit), up to four caves, the summit (highest point found on a grid, then refined) and the extraction point. Places are discovered within about 70 m (Awareness widens it). The map (M) pans, zooms, shows contour lines and elevations, lists places, and supports waypoints (place by click or X, rename, track, remove). The compass strip shows waypoints and the tracked or objective target. Navigation assist toggles objective markers.

**Modes** (`src/game`): Story (ten missions), Endless (escalation by day, capped at 2.5x), Sandbox (needs, hazards, kit, weather lock, day length, yield), Expedition (six biome scenarios with start items, forced weather, a time limit on one, own objectives). Failure ends the run at the end screen; victory records best times.

**Progression**: ten skills gained by use, 24 achievements, statistics, records for Story, Endless days and each Expedition. Records and achievements are stored in localStorage.

**Saves** (`src/save`): IndexedDB with 7 slots, overwrite and delete confirmations, autosave, F5 quick save, Continue.

**Audio** (`src/audio`): Web Audio synthesis only. Wind, rain, river and waterfall (positional), thunder, bird, wolf, bear, snake and deer calls, campfire crackle (positional), breathing, swimming, footsteps by surface, crickets at night, generative music that changes with day, night, danger and caves, subtitles. This closes the FEAT-002 gaps for thunder, wildlife sounds, footsteps and campfire crackle.

**UI** (`src/ui`): everything listed in `CHECKLIST.md`. The smoke test clicked through the menu, settings, panels, slots and end screen.

**Post-processing** (`src/render/post.ts`): bloom, vignette, color grade, motion blur (afterimage). The composer is bypassed when everything is off.

## Partial or simplified

- Skill effects are small: Gathering +10% yield per level, Navigation wider reveal, Endurance faster stamina recovery, Shelter slower wear, Swimming and Climbing +5% speed per level, Awareness wider discovery, Wildlife slightly later detection.
- Rivers have a procedural current, not true flow. The river crossing mission is detected by moving from one side of a river channel to the other.
- The raft is a held item, not a placeable vessel. Fishing is a timed mechanic, not tied to visible fish. These FEAT-002 limits remain.
- Vegetation density changes apply to terrain chunks generated afterwards. Anti-aliasing applies at start.
- Colorblind mode recolours HUD bars only.
- Saving needs an active run, a living player and (for autosave) no open panel.
- Expedition biome spawn searches up to 2600 m. If a biome is missing for a seed, the default spawn is used. All six biomes were found for the five seeds tried, with snow farthest (up to 1400 m).
- Story extraction only counts after a signal was raised near the summit. This is intentional.
- Records are per browser, not synced.

## Not implemented

- Tree felling, a placeable raft, insects as visible models, saving animal positions.
- Touch or mobile controls.
- Multiplayer, localisation.
- Real survival instruction.

## Not tested

- A full by-hand Story playthrough in a browser. The browser run uses a debug helper for completion; the logic test uses scripted events and teleports.
- Summit reachability on every seed. The summit is the highest point of a 1800 m square and steep rock is climbable, but no seed was climbed by hand.
- Audio by ear, gamepad hardware, real GPU performance, browsers other than Chromium, Safari IndexedDB behaviour, mobile.
- Dragging items between the backpack and a storage box in the browser. Swapping inside the backpack was tested.

## Known issues

- The production bundle is about 5.3 MB (1.95 MB gzip) in one chunk.
- After closing a panel with Esc the mouse may need a click on the canvas to be captured again.
