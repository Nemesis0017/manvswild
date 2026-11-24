import http from 'http'; import fs from 'fs'; import path from 'path';
import { chromium } from 'playwright-core';
const root = '/projects/sandbox/manvswild/dist';
const types = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.wasm':'application/wasm' };
const srv = http.createServer((q, r) => {
  let p = q.url.split('?')[0]; if (p === '/') p = '/index.html';
  const f = path.join(root, p);
  if (!fs.existsSync(f)) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
}).listen(4176);
const exe = fs.readdirSync(process.env.HOME + '/.cache/ms-playwright').find(d => d.startsWith('chromium_headless_shell'));
const browser = await chromium.launch({ executablePath: `${process.env.HOME}/.cache/ms-playwright/${exe}/chrome-headless-shell-linux64/chrome-headless-shell`, args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
page.setDefaultTimeout(120000);
const errs = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text()); });
page.on('pageerror', e => errs.push('pageerror: ' + e.message));
let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); };
const shot = (n) => page.screenshot({ path: `/projects/sandbox/.smoke/${n}.png` });
const btn = (name, exact = false) => page.getByRole('button', { name, exact });
const ev = (fn, arg) => page.evaluate(fn, arg);
const state = () => ev(() => { const g = window.__mvw; if (!g) return null; const s = g.session; const gp = g.gameplay; return s ? { mode: s.config.mode, day: s.day, mission: s.tracker.current?.id ?? null, missionsDone: s.tracker.index, wood: gp.inventory.count('wood'), x: Math.round(g.character.feet.x), z: Math.round(g.character.feet.z), seed: g.seed, outcome: s.outcome?.kind ?? null, expl: +s.exploration.percent().toFixed(2), wps: s.exploration.waypoints.length } : { noSession: true, seed: g.seed }; });

await page.goto('http://localhost:4176/?debug');
await page.waitForSelector('text=New game', { timeout: 90000 });
await page.waitForTimeout(2500);
await shot('01-menu');
check('main menu shows buttons', await btn('New game').isVisible() && await btn('Settings').isVisible() && await btn('Load game').isVisible());
check('no Continue without saves', (await btn(/Continue/).count()) === 0);
const fly = await ev(() => { const g = window.__mvw; return { y: g.camera.position.y, status: 'menu', session: !!g.session }; });
check('menu flythrough camera is above ground and no session', fly.y > 5 && !fly.session, JSON.stringify(fly));

// Menu screens
await btn('Settings').click(); await page.waitForTimeout(300);
await page.getByRole('tab', { name: 'Graphics' }).click();
await page.locator('select').first().selectOption('high');
await page.getByLabel('Bloom').check().catch(() => {});
await shot('02-settings-graphics');
let s = await ev(() => JSON.parse(localStorage.getItem('manvswild.settings.v1')));
check('graphics preset persisted to localStorage', s.preset === 'high' && s.shadows === true && s.vegetationDensity === 1, JSON.stringify({ preset: s.preset, bloom: s.bloom }));
await page.getByRole('tab', { name: 'Audio' }).click();
await page.locator('input[type=range]').first().fill('0.3');
await page.getByRole('tab', { name: 'Accessibility' }).click();
await page.locator('select').first().selectOption('deuteranopia');
await page.getByRole('tab', { name: 'Controls' }).click();
await page.getByRole('button', { name: 'Rebind' }).first().click();
await page.keyboard.press('KeyT');
await page.waitForTimeout(200);
const fwd = await ev(() => window.__mvw.input.bindings.forward);
check('remap Move forward to T', JSON.stringify(fwd) === '["KeyT"]', JSON.stringify(fwd));
await shot('03-settings-controls');
await btn('Reset bindings').click();
check('bindings reset', JSON.stringify(await ev(() => window.__mvw.input.bindings.forward)) === '["KeyW","ArrowUp"]');
await page.getByRole('tab', { name: 'Gameplay' }).click();
await btn('Back').click();
s = await ev(() => JSON.parse(localStorage.getItem('manvswild.settings.v1')));
check('audio, colorblind persisted', s.masterVolume === 0.3 && s.colorblind === 'deuteranopia', JSON.stringify({ m: s.masterVolume, c: s.colorblind }));
await btn('Achievements').click(); await page.waitForTimeout(200); check('achievements screen', await page.locator('text=First steps').isVisible()); await btn('Back').click();
await btn('Records').click(); await page.waitForTimeout(200); check('records screen', await page.locator('text=Story best time').isVisible()); await btn('Back').click();
await btn('Controls and help').click(); await page.waitForTimeout(200); check('help screen', await page.locator('text=Interact / gather').isVisible()); await btn('Back').click();
await btn('Load game').click(); await page.waitForTimeout(300); check('load screen lists slots, all empty', (await page.locator('.mvw-slot-row').count()) === 7 && (await page.locator('text=Empty').count()) === 7);
await btn('Back').click();

// New game
await btn('New game').click(); await page.waitForTimeout(300);
await shot('04-newgame');
await page.getByRole('button', { name: /Expedition/ }).first().click();
check('expedition shows scenarios', await page.locator('text=Dry Crossing').isVisible());
await page.getByRole('button', { name: /Sandbox/ }).first().click();
check('sandbox shows options', await page.locator('text=Sandbox options').isVisible());
await page.getByRole('button', { name: /^Story/ }).first().click();
await page.getByRole('button', { name: /Tinkerer/ }).click();
await page.getByRole('button', { name: /^Explorer/ }).click();
await page.getByLabel('World seed').fill('4242');
await btn('Start', true).click();
await page.waitForFunction(() => window.__mvw?.session, null, { timeout: 90000 });
await page.waitForTimeout(1000);
await page.keyboard.press('Space');
await page.waitForTimeout(8000);
let st = await state();
check('story session started with chosen seed/mode', st.mode === 'story' && st.seed === 4242 && st.mission === 'water', JSON.stringify(st));
const cfg = await ev(() => ({ d: window.__mvw.gameplay.difficulty, c: window.__mvw.session.config.character, perk: window.__mvw.gameplay.skills.crafting }));
check('difficulty and character applied', cfg.d === 'explorer' && cfg.c === 'tinkerer' && cfg.perk >= 20, JSON.stringify(cfg));
await page.waitForTimeout(1000);
await shot('05-playing-hud');
check('HUD shows compass, minimap, tracker', (await page.locator('.mvw-compass').count()) === 1 && (await page.locator('.mvw-minimap').count()) === 1 && (await page.locator('.mvw-tracker').count()) === 1);
const audio = await ev(() => { const a = window.__mvw.audio; return { ctx: !!a.ctx, state: a.ctx?.state }; });
check('audio context created and running', audio.ctx && audio.state === 'running', JSON.stringify(audio));

// Panels
for (const [key, text, name] of [['KeyM', 'Navigation assist', 'map'], ['KeyJ', 'Find water', 'journal'], ['KeyI', 'Crafting', 'inventory']]) {
  await page.keyboard.press(key); await page.waitForTimeout(700);
  check(`panel ${name} opens with ${key}`, await page.locator(`text=${text}`).first().isVisible());
  if (name === 'map') { await shot('06-map'); }
  if (name === 'inventory') {
    await ev(() => { const g = window.__mvw.gameplay; g.inventory.add('wood', 3); g.inventory.add('stone', 2); g.publishForTest?.(); });
    await page.waitForTimeout(600);
  }
  await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  check(`Escape closes ${name}`, !(await page.locator('.mvw-panelwrap').count()));
}
// map: place a waypoint by clicking, track it
await page.keyboard.press('KeyM'); await page.waitForTimeout(600);
const cv = await page.locator('.mvw-map-canvas').boundingBox();
await page.mouse.click(cv.x + cv.width * 0.6, cv.y + cv.height * 0.4); await page.waitForTimeout(400);
st = await state(); check('click on map places a waypoint', st.wps === 1, JSON.stringify(st));
await page.getByRole('button', { name: 'Track' }).first().click(); await page.waitForTimeout(300);
check('waypoint can be tracked', (await ev(() => window.__mvw.session.tracked)) === 'wp:1');
await shot('07-map-waypoint');
await page.getByRole('tab', { name: /Skills/ }).click(); check('skills tab', await page.locator('text=Wildlife observation').isVisible());
await page.getByRole('tab', { name: /Achievements/ }).click(); check('achievements tab', await page.locator('text=Cartographer').isVisible());
await page.getByRole('tab', { name: /Stats/ }).click(); check('stats tab', await page.locator('text=Distance traveled').isVisible());
await page.getByRole('tab', { name: /Backpack/ }).click(); await page.waitForTimeout(300);
// Drag and drop in inventory
const before = await ev(() => window.__mvw.gameplay.inventory.slots.slice(0, 4).map(x => x && x.id));
await page.locator('.mvw-inv .mvw-grid .mvw-slot').nth(0).dragTo(page.locator('.mvw-inv .mvw-grid .mvw-slot').nth(10));
await page.waitForTimeout(300);
const after = await ev(() => window.__mvw.gameplay.inventory.slots.map(x => x && x.id));
check('drag and drop moves an item', after[10] === before[0] && after[0] !== before[0], JSON.stringify({ before0: before[0], after0: after[0], after10: after[10] }));
await shot('08-inventory');
await page.keyboard.press('Escape'); await page.waitForTimeout(300);

// Craft through the UI button
await ev(() => { const g = window.__mvw.gameplay; g.inventory.add('fiber', 6); });
await page.keyboard.press('KeyI'); await page.waitForTimeout(600);
const ropeBefore = await ev(() => window.__mvw.gameplay.inventory.count('rope'));
await page.locator('.mvw-recipe', { hasText: 'Rope' }).first().getByRole('button', { name: 'Craft' }).click(); await page.waitForTimeout(300);
check('crafting button crafts rope', (await ev(() => window.__mvw.gameplay.inventory.count('rope'))) === ropeBefore + 1);
await page.keyboard.press('Escape'); await page.waitForTimeout(300);

// Gameplay hooks with the real engine: gather water via event, wood, walk
await ev(() => { window.__mvw.gameplay.inventory.add('wood', 5); });
const spawnPos = await ev(() => ({ x: window.__mvw.character.feet.x, z: window.__mvw.character.feet.z }));
await ev(() => { const g = window.__mvw; const p = g.session.pois.cairn; const y = g.terrain.heightAt(p.x, p.z); g.character.teleport(p.x, y + 1, p.z); });
await page.waitForTimeout(3000);
st = await state();
check('teleporting to the cairn discovers it', await ev(() => window.__mvw.session.exploration.discovered.has('cairn')), JSON.stringify(st));
check('exploration percent increases', st.expl > 0);

// Pause and save
await page.keyboard.press('KeyP'); await page.waitForTimeout(600);
await shot('09-pause');
check('pause menu appears on P', await btn('Quit to main menu').isVisible());
await btn('Save and load').click(); await page.waitForTimeout(400);
await page.locator('[data-slot="1"]').getByRole('button', { name: 'Save here' }).click(); await page.waitForTimeout(800);
check('manual save to slot 1', await page.locator('[data-slot="1"] >> text=Day').count() > 0 || await page.locator('[data-slot="1"] >> text=day').count() > 0);
await shot('10-save-slots');
await page.locator('[data-slot="1"]').getByRole('button', { name: 'Save here' }).click(); await page.waitForTimeout(300);
check('overwrite asks for confirmation', await page.locator('text=Overwrite this save?').isVisible());
await page.getByRole('button', { name: 'No' }).click();
const savedState = await state();
await btn('Back').click(); await btn('Resume').click(); await page.waitForTimeout(500);
check('resume returns to playing', (await page.locator('.mvw-overlay').count()) === 0);

// Autosave
await ev(() => { window.__mvw.autosaveTimer = 1e6; });
await page.waitForTimeout(1500);
const autoMeta = await ev(async () => { const req = indexedDB.open('manvswild'); return await new Promise((res) => { req.onsuccess = () => { const tx = req.result.transaction('saves'); const q = tx.objectStore('saves').getAllKeys(); q.onsuccess = () => res(q.result); }; }); });
check('autosave wrote the auto slot', autoMeta.includes('auto') && autoMeta.includes('1'), JSON.stringify(autoMeta));

// Reload, Continue
await page.reload();
await page.waitForSelector('text=New game', { timeout: 90000 });
await page.waitForTimeout(1500);
check('Continue button appears after reload', (await btn(/Continue/).count()) === 1);
await shot('11-menu-continue');
await btn(/Continue/).click();
await page.waitForFunction(() => window.__mvw?.session, null, { timeout: 90000 });
await page.waitForTimeout(1500);
const cont = await state();
check('Continue restores seed, mode, mission and position', cont.seed === 4242 && cont.mode === 'story' && Math.abs(cont.x - savedState.x) < 5 && Math.abs(cont.z - savedState.z) < 5 && cont.wood === savedState.wood, JSON.stringify({ cont, savedState }));
check('Continue restores exploration and waypoints', cont.wps === 1 && cont.expl >= savedState.expl - 0.01, JSON.stringify(cont));
check('Continue restores inventory', (await ev(() => window.__mvw.gameplay.inventory.count('rope'))) >= 1);

// Quick save and delete
console.log('BIND', await ev(() => JSON.stringify(window.__mvw.input.bindings.quickSave)));
await ev(() => { window.__codes = []; window.addEventListener('keydown', e => window.__codes.push(e.code)); });
await page.keyboard.press('F5'); await page.waitForTimeout(4000);
console.log('CODES', await ev(() => JSON.stringify(window.__codes)), await ev(() => JSON.stringify(window.__mvw.gameplay.messages.map(m=>m.text))));
{ const keys = await ev(async () => { const req = indexedDB.open('manvswild'); return await new Promise((res) => { req.onsuccess = () => { const q = req.result.transaction('saves').objectStore('saves').getAllKeys(); q.onsuccess = () => res(q.result); }; }); });
    check('F5 quick save writes the quick slot', keys.includes('quick'), JSON.stringify(keys) + ' ' + page.url()); }
// Scripted story completion
await ev(() => { const g = window.__mvw; g.session.debugCompleteAll(); });
await page.waitForTimeout(1500);
st = await state();
check('scripted story completion reaches victory', st.outcome === 'victory' && st.missionsDone === 10, JSON.stringify(st));
await shot('12-victory');
check('end screen visible', await page.locator('text=Extracted').first().isVisible() && await btn('Main menu').isVisible());
const rec = await ev(() => JSON.parse(localStorage.getItem('manvswild.records.v1')));
check('record and achievement saved', rec.story.completions === 1 && rec.achievements.some(a => a[0] === 'story_done'), JSON.stringify(rec.story));
console.log('HIT', await ev(() => { const bt=[...document.querySelectorAll('button')].find(x=>x.textContent==='Main menu');const r=bt.getBoundingClientRect();const e=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return JSON.stringify({r:[r.x,r.y,r.width,r.height],hit:e.tagName+'.'+e.className,n:document.querySelectorAll('.mvw-overlay').length, vp:[innerWidth,innerHeight]});}));
await btn('Main menu').click();
await page.waitForSelector('text=New game', { timeout: 90000 });
await page.waitForTimeout(1000);

// Delete with confirmation
await btn('Load game').click(); await page.waitForTimeout(500);
await page.locator('[data-slot="quick"]').getByRole('button', { name: 'Delete' }).click();
check('delete asks for confirmation', await page.locator('text=Delete this save?').isVisible());
await page.getByRole('button', { name: 'Yes' }).click(); await page.waitForTimeout(500);
check('slot deleted', (await page.locator('[data-slot="quick"] >> text=Empty').count()) === 1);
await btn('Back').click();

// Other modes
for (const [label, extra] of [['Endless Survival', null], ['Sandbox', null], ['Expedition', 'snow']]) {
  await btn('New game').click(); await page.waitForTimeout(200);
  await page.getByRole('button', { name: new RegExp('^' + label) }).first().click();
  if (extra) await page.getByRole('button', { name: /Whiteout/ }).click();
  await btn('Start', true).click();
  await page.waitForFunction(() => window.__mvw?.session, null, { timeout: 90000 });
  await page.keyboard.press('Space');
  await page.waitForTimeout(6000);
  const m = await state();
  check(`${label} starts`, !!m && !m.noSession, JSON.stringify(m));
  if (label === 'Expedition') {
    const b = await ev(() => { const g = window.__mvw; const f = g.character.feet; return { biome: g.terrain.biomeAt(f.x, f.z), weather: g.gameplay.currentWeather, mission: g.session.tracker.current.id }; });
    check('Expedition spawns in scenario biome with forced weather', b.biome === 'snow' && b.weather === 'snowstorm', JSON.stringify(b));
    await shot('13-expedition-snow');
  }
  if (label === 'Sandbox') await shot('13-sandbox');
  await page.keyboard.press('KeyP'); await page.waitForTimeout(400);
  await btn('Quit to main menu').click(); await btn('Yes, quit').click();
  await page.waitForSelector('text=New game', { timeout: 90000 }); await page.waitForTimeout(500);
}

// Post-processing in game
await btn('New game').click(); await btn('Start', true).click();
await page.waitForFunction(() => window.__mvw?.session, null, { timeout: 90000 });
await page.keyboard.press('Space'); await page.waitForTimeout(5000);
await ev(() => { const s = JSON.parse(localStorage.getItem('manvswild.settings.v1')); });
await page.keyboard.press('KeyP'); await page.waitForTimeout(300);
await btn('Settings').click();
await page.getByLabel('Bloom').check(); await page.getByLabel('Motion blur').check(); await page.getByLabel('Vignette').check();
await page.locator('select').nth(1).selectOption('filmic');
await page.waitForTimeout(500);
check('post-processing chain active', await ev(() => window.__mvw.post.active));
await btn('Back').click(); await btn('Resume').click(); await page.waitForTimeout(2500);
await shot('14-postfx');
const fps = await ev(() => document.querySelector('canvas') ? true : false);
check('canvas present with post-processing', fps);
console.log('ERRORS', JSON.stringify(errs.slice(0, 20)));
console.log(`RESULT pass=${pass} fail=${fail} consoleErrors=${errs.length}`);
await browser.close(); srv.close();
