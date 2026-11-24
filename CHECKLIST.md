# Checklist

[x] done and exercised in the headless smoke test or unit tests. [~] partly done. [ ] not done. See `docs/FEATURE_REPORT.md` for detail.

## World and engine
- [x] Seeded procedural terrain, six biomes, rivers, lakes, waterfalls, caves
- [x] Day and night, weather state machine with effects
- [x] Rapier character physics, swimming, climbing, first and third person
- [~] Vegetation density setting (applies to newly loaded terrain only)

## Survival, items, building, wildlife
- [x] Health, hunger, thirst, stamina, temperature, tiredness, wetness, injuries
- [x] Inventory, equipment, hotbar, crafting with skill gates
- [x] Build mode: campfire, shelter, sleeping area, storage
- [x] Wildlife AI with warn, retreat and distraction, no gore
- [~] Raft is a held item, not a placeable vessel
- [ ] Tree felling

## Exploration
- [x] Minimap and compass strip
- [x] Full map (M) with fog of war, pan and zoom, contour lines, elevation labels
- [x] Waypoints: place, rename, track, remove
- [x] Points of interest: landmarks, abandoned campsites with salvage, caves, summit, extraction
- [x] Exploration percent
- [x] Navigation assist toggle, HUD-free mode
- [~] Map shading is only height and biome colour

## Modes and progression
- [x] Story chain of ten missions through extraction
- [x] Endless Survival with escalating difficulty and day counter
- [x] Sandbox options
- [x] Expedition scenarios per biome with objectives, restrictions, time limit, records
- [x] Skills: navigation, endurance, crafting, gathering, shelter, swimming, climbing, awareness, wildlife observation (plus fieldcraft)
- [x] Achievements (24), statistics, records
- [~] Skill effects are small and simple (see report)

## Saves
- [x] IndexedDB multi-slot saves, manual save, autosave, quick save, delete with confirmation
- [x] Restores inventory, skills, stats, world changes, built pieces, storages, missions, time, weather, position, seed, exploration
- [ ] Animal positions and fishing state are not saved (animals respawn by chunk)

## Audio
- [x] Procedural wind, river, waterfall, rain, thunder, wildlife calls, campfire crackle, breathing, swimming, terrain-dependent footsteps, music
- [x] Positional audio with PannerNode, per-category volumes, subtitles
- [ ] Audio quality judged by ear (nobody has listened)

## UI
- [x] Animated main menu over a 3D flythrough
- [x] New game: mode, scenario, character, difficulty, seed
- [x] Continue, load, save slots
- [x] Settings: graphics, shadows, vegetation, post-processing, audio, remappable controls, sensitivity, FOV, UI scale, colorblind, reduced motion, camera shake, motion blur, high contrast, subtitles
- [x] Pause, backpack with drag and drop, crafting, map, journal, skills, achievements, stats
- [x] Interaction prompts, end screens (victory, failure)
- [~] Colorblind mode changes HUD bar colours only, not the map or world
- [~] Gamepad mapping exists (untested without hardware)
- [x] Post-processing: vignette, bloom, color grade, motion blur

## Docs and tests
- [x] README, CHECKLIST, FEATURE_REPORT, TEST_RESULTS
- [x] Unit tests: 125 passing
- [x] Headless browser smoke test (53 checks)
- [ ] Mobile and touch controls
- [ ] Manual full playthrough by a human
