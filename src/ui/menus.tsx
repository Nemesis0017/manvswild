import { useEffect, useState } from 'react';
import { DEFAULT_SETTINGS, PRESETS, settingsStore, type GraphicsPreset, type Settings } from '../core/settings';
import { DEFAULT_BINDINGS, type Action } from '../core/input';
import type { Game } from '../game';
import { CHARACTERS, DEFAULT_SANDBOX, MODE_IDS, MODE_INFO, SCENARIOS, parseSeed, type ModeId, type SandboxOptions } from '../game/modes';
import { defaultConfig, sessionStore, type SessionConfig } from '../game/session';
import { formatDuration } from '../game/progress';
import { WEATHER_IDS, WEATHER_NAMES, type WeatherId } from '../world/weather';
import { saveDb } from '../save/db';
import { SLOT_IDS, slotLabel, type SaveMeta } from '../save/saveData';
import { DIFFICULTIES, DIFFICULTY_IDS } from '../survival/difficulty';
import { ACTION_LABELS, ACTION_ORDER, codeLabel } from './bindings';
import { AchievementsList, StatsPanel } from './panels';
import { useStore } from './useStore';

export type Screen = 'none' | 'main' | 'new' | 'load' | 'saveload' | 'settings' | 'help' | 'achievements' | 'stats' | 'pause';

export function Back({ onClick, label = 'Back' }: { onClick: () => void; label?: string }) {
  return <button className="mvw-btn secondary" onClick={onClick}>{label}</button>;
}

// ---------------- Main menu ----------------
export function MainMenu({ go, onContinue, latest, busy }: { go: (s: Screen) => void; onContinue: () => void; latest: SaveMeta | null; busy: boolean }) {
  return (
    <div className="mvw-overlay menu">
      <h1 className="mvw-title anim">Man vs Wild</h1>
      <p className="mvw-sub">Survive the wilderness. Learn its rules. Find your way out.</p>
      <div className="mvw-menu">
        {latest && (
          <button className="mvw-btn" disabled={busy} onClick={onContinue}>
            Continue <span className="mvw-btn-sub">{latest.name}, day {latest.summary.day}, {formatDuration(latest.summary.playSeconds)}</span>
          </button>
        )}
        <button className="mvw-btn" disabled={busy} onClick={() => go('new')}>New game</button>
        <button className="mvw-btn" disabled={busy} onClick={() => go('load')}>Load game</button>
        <button className="mvw-btn secondary" onClick={() => go('settings')}>Settings</button>
        <button className="mvw-btn secondary" onClick={() => go('achievements')}>Achievements</button>
        <button className="mvw-btn secondary" onClick={() => go('stats')}>Records</button>
        <button className="mvw-btn secondary" onClick={() => go('help')}>Controls and help</button>
      </div>
      <p className="mvw-fine">Survival hints in this game are simplified for play and are not real survival advice.</p>
    </div>
  );
}

// ---------------- New game ----------------
export function NewGame({ onStart, onBack }: { onStart: (cfg: SessionConfig) => void; onBack: () => void }) {
  const st = useStore(settingsStore);
  const [mode, setMode] = useState<ModeId>('story');
  const [difficulty, setDifficulty] = useState<SessionConfig['difficulty']>('survivor');
  const [character, setCharacter] = useState(CHARACTERS[0].id);
  const [seedText, setSeedText] = useState(String(st.seed));
  const [scenarioId, setScenarioId] = useState(SCENARIOS[0].id);
  const [sandbox, setSandbox] = useState<SandboxOptions>({ ...DEFAULT_SANDBOX });
  const sc = SCENARIOS.find((s) => s.id === scenarioId)!;
  return (
    <div className="mvw-overlay scroll">
      <h2>New game</h2>
      <div className="mvw-form">
        <fieldset>
          <legend>Mode</legend>
          <div className="mvw-cards">
            {MODE_IDS.map((m) => (
              <button key={m} className={'mvw-card' + (mode === m ? ' on' : '')} aria-pressed={mode === m} onClick={() => setMode(m)}>
                <strong>{MODE_INFO[m].label}</strong><span>{MODE_INFO[m].description}</span>
              </button>
            ))}
          </div>
        </fieldset>
        {mode === 'expedition' && (
          <fieldset>
            <legend>Scenario</legend>
            <div className="mvw-cards">
              {SCENARIOS.map((s) => (
                <button key={s.id} className={'mvw-card' + (scenarioId === s.id ? ' on' : '')} aria-pressed={scenarioId === s.id} onClick={() => setScenarioId(s.id)}>
                  <strong>{s.name} ({s.biome})</strong><span>{s.brief}</span>
                </button>
              ))}
            </div>
            <p className="mvw-hint">Objectives: {sc.missions.map((m) => m.title).join(', ')}. Restrictions: {sc.restrictions.join(', ')}.</p>
          </fieldset>
        )}
        {mode === 'sandbox' && (
          <fieldset>
            <legend>Sandbox options</legend>
            <label><input type="checkbox" checked={sandbox.needs} onChange={(e) => setSandbox({ ...sandbox, needs: e.target.checked })} /> Hunger, thirst and tiredness drain</label>
            <label><input type="checkbox" checked={!sandbox.invulnerable} onChange={(e) => setSandbox({ ...sandbox, invulnerable: !e.target.checked })} /> Hazards can hurt me</label>
            <label><input type="checkbox" checked={sandbox.startKit} onChange={(e) => setSandbox({ ...sandbox, startKit: e.target.checked })} /> Start with a full kit</label>
            <label>Weather
              <select value={sandbox.weather} onChange={(e) => setSandbox({ ...sandbox, weather: e.target.value as 'auto' | WeatherId })}>
                <option value="auto">Natural cycle</option>
                {WEATHER_IDS.map((w) => <option key={w} value={w}>Always {WEATHER_NAMES[w]}</option>)}
              </select>
            </label>
            <label>Day length
              <select value={sandbox.dayLengthMult} onChange={(e) => setSandbox({ ...sandbox, dayLengthMult: +e.target.value })}>
                <option value={0.25}>Very short (5 min)</option><option value={0.5}>Short (10 min)</option><option value={1}>Normal (20 min)</option><option value={2}>Long (40 min)</option>
              </select>
            </label>
            <label>Resource yield
              <select value={sandbox.resourceMult} onChange={(e) => setSandbox({ ...sandbox, resourceMult: +e.target.value })}>
                <option value={0.5}>Scarce</option><option value={1}>Normal</option><option value={2}>Plentiful</option><option value={4}>Abundant</option>
              </select>
            </label>
          </fieldset>
        )}
        <fieldset>
          <legend>Difficulty</legend>
          <div className="mvw-cards">
            {DIFFICULTY_IDS.map((d) => (
              <button key={d} className={'mvw-card' + (difficulty === d ? ' on' : '')} aria-pressed={difficulty === d} onClick={() => setDifficulty(d)}>
                <strong>{DIFFICULTIES[d].label}</strong><span>{DIFFICULTIES[d].description}</span>
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>Character</legend>
          <div className="mvw-cards">
            {CHARACTERS.map((c) => (
              <button key={c.id} className={'mvw-card' + (character === c.id ? ' on' : '')} aria-pressed={character === c.id} onClick={() => setCharacter(c.id)}>
                <strong><span className="mvw-swatch" style={{ background: '#' + c.color.toString(16).padStart(6, '0') }} /> {c.name}</strong><span>{c.description}</span>
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>World seed</legend>
          <div className="mvw-row">
            <input aria-label="World seed" value={seedText} onChange={(e) => setSeedText(e.target.value)} />
            <button className="mvw-link" onClick={() => setSeedText(String(Math.floor(Math.random() * 999999) + 1))}>Random</button>
          </div>
          <p className="mvw-hint">Numbers are used directly, other text is turned into a number. The same seed gives the same world.</p>
        </fieldset>
      </div>
      <div className="mvw-row center">
        <Back onClick={onBack} />
        <button className="mvw-btn" onClick={() => onStart({ ...defaultConfig(parseSeed(seedText)), mode, difficulty, character, sandbox, scenarioId })}>Start</button>
      </div>
    </div>
  );
}

// ---------------- Save slots ----------------
export function SaveSlots({ game, allowSave, onLoad, onBack }: { game: Game | null; allowSave: boolean; onLoad: (slot: string) => void; onBack: () => void }) {
  const [metas, setMetas] = useState<Record<string, SaveMeta>>({});
  const [confirm, setConfirm] = useState<{ slot: string; kind: 'delete' | 'overwrite' } | null>(null);
  const [note, setNote] = useState('');
  const refresh = () => saveDb.list().then((l) => setMetas(Object.fromEntries(l.map((m) => [m.slot, m])))).catch((e) => setNote(String(e?.message ?? e)));
  useEffect(() => { void refresh(); }, []);
  const doSave = async (slot: string) => {
    const ok = await game?.saveToSlot(slot);
    setNote(ok ? `Saved to ${slotLabel(slot)}.` : 'Could not save. You can only save while alive and in an active game.');
    setConfirm(null);
    void refresh();
  };
  return (
    <div className="mvw-overlay scroll">
      <h2>{allowSave ? 'Save and load' : 'Load game'}</h2>
      {!saveDb.available && <p className="mvw-warn">IndexedDB is not available, so saving is disabled in this browser.</p>}
      <div className="mvw-slots">
        {SLOT_IDS.map((id) => {
          const m = metas[id];
          const canSave = allowSave && id !== 'auto';
          return (
            <div key={id} className="mvw-slot-row" data-slot={id}>
              <div className="mvw-slot-info">
                <strong>{slotLabel(id)}</strong>
                {m ? <span>{m.summary.modeLabel}, {m.summary.difficulty}, day {m.summary.day}, {formatDuration(m.summary.playSeconds)}, {m.summary.explorationPct.toFixed(1)}% explored. {m.summary.mission && `Mission: ${m.summary.mission}.`} Saved {new Date(m.updatedAt).toLocaleString()}</span> : <span className="mvw-cost">Empty</span>}
              </div>
              <div className="mvw-row">
                {confirm?.slot === id ? (
                  <>
                    <span>{confirm.kind === 'delete' ? 'Delete this save?' : 'Overwrite this save?'}</span>
                    <button className="mvw-link" onClick={() => (confirm.kind === 'delete' ? saveDb.delete(id).then(() => { setConfirm(null); setNote('Deleted.'); return refresh(); }) : doSave(id))}>Yes</button>
                    <button className="mvw-link" onClick={() => setConfirm(null)}>No</button>
                  </>
                ) : (
                  <>
                    {canSave && <button className="mvw-link" onClick={() => (m ? setConfirm({ slot: id, kind: 'overwrite' }) : void doSave(id))}>Save here</button>}
                    <button className="mvw-link" disabled={!m} onClick={() => onLoad(id)}>Load</button>
                    <button className="mvw-link" disabled={!m} onClick={() => setConfirm({ slot: id, kind: 'delete' })}>Delete</button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {note && <p className="mvw-hint" role="status">{note}</p>}
      <Back onClick={onBack} />
    </div>
  );
}

// ---------------- Settings ----------------
type Tab = 'graphics' | 'audio' | 'controls' | 'access' | 'gameplay';

function Slider({ label, value, min, max, step = 0.05, onChange, fmt }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; fmt?: (v: number) => string }) {
  return (
    <label className="mvw-setting">{label} <span className="mvw-cost">{fmt ? fmt(value) : value.toFixed(2)}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} />
    </label>
  );
}
function Check({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return <label className="mvw-setting"><span>{label}</span><input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} /></label>;
}

export function SettingsScreen({ game, onBack }: { game: Game | null; onBack: () => void }) {
  const s = useStore(settingsStore);
  const set = (p: Partial<Settings>) => settingsStore.setState(p);
  const [tab, setTab] = useState<Tab>('graphics');
  const tabs: [Tab, string][] = [['graphics', 'Graphics'], ['audio', 'Audio'], ['controls', 'Controls'], ['access', 'Accessibility'], ['gameplay', 'Gameplay']];
  const sess = useStore(sessionStore);
  return (
    <div className="mvw-overlay scroll">
      <h2>Settings</h2>
      <div className="mvw-tabs" role="tablist">
        {tabs.map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} className={'mvw-tab' + (tab === id ? ' on' : '')} onClick={() => setTab(id)}>{label}</button>)}
      </div>
      <div className="mvw-settings">
        {tab === 'graphics' && (
          <>
            <label className="mvw-setting">Graphics preset
              <select value={s.preset} onChange={(e) => { const p = e.target.value as GraphicsPreset; set({ preset: p, shadows: PRESETS[p].shadows, vegetationDensity: PRESETS[p].vegetationDensity }); }}>
                <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="ultra">Ultra</option>
              </select>
            </label>
            <Check label="Shadows" value={s.shadows} onChange={(v) => set({ shadows: v })} />
            <Slider label="Vegetation density (new terrain only)" value={s.vegetationDensity} min={0.2} max={1.5} onChange={(v) => set({ vegetationDensity: v })} />
            <Slider label="Field of view" value={s.fov} min={50} max={110} step={1} onChange={(v) => set({ fov: v })} fmt={(v) => String(v)} />
            <Check label="Adaptive resolution" value={s.adaptiveResolution} onChange={(v) => set({ adaptiveResolution: v })} />
            <h4>Post-processing</h4>
            <Check label="Bloom" value={s.bloom} onChange={(v) => set({ bloom: v })} />
            <Check label="Vignette" value={s.vignette} onChange={(v) => set({ vignette: v })} />
            <Check label="Motion blur" value={s.motionBlur} onChange={(v) => set({ motionBlur: v })} />
            <label className="mvw-setting">Color grade
              <select value={s.colorGrade} onChange={(e) => set({ colorGrade: e.target.value as Settings['colorGrade'] })}>
                <option value="none">None</option><option value="warm">Warm</option><option value="cool">Cool</option><option value="filmic">Filmic</option>
              </select>
            </label>
            <p className="mvw-hint">The anti-aliasing setting of a preset applies on the next start.</p>
          </>
        )}
        {tab === 'audio' && (
          <>
            <Slider label="Master volume" value={s.masterVolume} min={0} max={1} onChange={(v) => set({ masterVolume: v })} />
            <Slider label="Music" value={s.musicVolume} min={0} max={1} onChange={(v) => set({ musicVolume: v })} />
            <Slider label="Ambience" value={s.ambienceVolume} min={0} max={1} onChange={(v) => set({ ambienceVolume: v })} />
            <Slider label="Effects" value={s.sfxVolume} min={0} max={1} onChange={(v) => set({ sfxVolume: v })} />
            <Check label="Subtitles for sounds" value={s.subtitles} onChange={(v) => set({ subtitles: v })} />
          </>
        )}
        {tab === 'controls' && <Controls game={game} s={s} />}
        {tab === 'access' && (
          <>
            <Slider label="UI scale" value={s.uiScale} min={0.8} max={1.6} step={0.05} onChange={(v) => set({ uiScale: v })} />
            <label className="mvw-setting">Colorblind mode
              <select value={s.colorblind} onChange={(e) => set({ colorblind: e.target.value as Settings['colorblind'] })}>
                <option value="none">Off</option><option value="protanopia">Protanopia</option><option value="deuteranopia">Deuteranopia</option><option value="tritanopia">Tritanopia</option>
              </select>
            </label>
            <Check label="Reduced motion" value={s.reducedMotion} onChange={(v) => set({ reducedMotion: v })} />
            <Check label="Camera shake and stagger" value={s.cameraShake} onChange={(v) => set({ cameraShake: v })} />
            <Check label="High contrast UI" value={s.highContrast} onChange={(v) => set({ highContrast: v })} />
            <Check label="Subtitles for sounds" value={s.subtitles} onChange={(v) => set({ subtitles: v })} />
            <Check label="HUD-free mode (H toggles)" value={s.hudHidden} onChange={(v) => set({ hudHidden: v })} />
          </>
        )}
        {tab === 'gameplay' && (
          <>
            <Slider label="Autosave every (minutes, 0 is off)" value={s.autosaveMinutes} min={0} max={10} step={1} onChange={(v) => set({ autosaveMinutes: v })} fmt={(v) => String(v)} />
            <Check label="Navigation assist (objective markers on map and compass)" value={sess.navAssist} onChange={(v) => game?.session?.setNavAssist(v)} />
            <p className="mvw-hint">Navigation assist only applies inside a running game.</p>
            <button className="mvw-link" onClick={() => settingsStore.setState({ ...DEFAULT_SETTINGS, seed: s.seed })}>Reset all settings to defaults</button>
          </>
        )}
      </div>
      <Back onClick={onBack} />
    </div>
  );
}

function Controls({ game, s }: { game: Game | null; s: Settings }) {
  const [capturing, setCapturing] = useState<Action | null>(null);
  const [, bump] = useState(0);
  const [note, setNote] = useState('');
  const input = game?.input;
  useEffect(() => {
    if (!capturing || !input) return;
    const finish = (code: string) => {
      for (const a of Object.keys(input.bindings) as Action[]) {
        if (a !== capturing && input.bindings[a].includes(code)) {
          input.rebind(a, input.bindings[a].filter((c) => c !== code));
          setNote(`${codeLabel(code)} was also bound to "${ACTION_LABELS[a]}". That binding was removed.`);
        }
      }
      input.rebind(capturing, [code]);
      setCapturing(null);
      bump((n) => n + 1);
    };
    const key = (e: KeyboardEvent) => {
      e.preventDefault(); e.stopPropagation();
      if (e.code === 'Escape') { setCapturing(null); return; }
      finish(e.code);
    };
    const mouse = (e: MouseEvent) => { e.preventDefault(); e.stopPropagation(); finish('Mouse' + e.button); };
    window.addEventListener('keydown', key, true);
    const t = window.setTimeout(() => window.addEventListener('mousedown', mouse, true), 100);
    return () => { window.removeEventListener('keydown', key, true); window.removeEventListener('mousedown', mouse, true); window.clearTimeout(t); };
  }, [capturing, input]);
  return (
    <>
      <Slider label="Mouse sensitivity" value={s.sensitivity} min={0.2} max={3} step={0.1} onChange={(v) => settingsStore.setState({ sensitivity: v })} fmt={(v) => v.toFixed(1)} />
      <Check label="Invert Y axis" value={s.invertY} onChange={(v) => settingsStore.setState({ invertY: v })} />
      <h4>Key bindings</h4>
      {!input && <p className="mvw-hint">Controls are available once the world has loaded.</p>}
      {input && (
        <table className="mvw-table">
          <tbody>
            {ACTION_ORDER.map((a) => (
              <tr key={a}>
                <td>{ACTION_LABELS[a]}</td>
                <td>{input.bindings[a].map(codeLabel).join(' / ') || 'unbound'}</td>
                <td><button className="mvw-link" onClick={() => { setNote(''); setCapturing(a); }}>{capturing === a ? 'Press a key (Esc cancels)' : 'Rebind'}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {note && <p className="mvw-hint" role="status">{note}</p>}
      {input && <button className="mvw-link" onClick={() => { for (const a of Object.keys(DEFAULT_BINDINGS) as Action[]) input.rebind(a, [...DEFAULT_BINDINGS[a]]); setNote('Bindings reset.'); bump((n) => n + 1); }}>Reset bindings</button>}
      <p className="mvw-hint">Gamepad: left stick move, right stick look, A jump, B crouch, X interact, Y camera, LB backpack, RB map, RT use, LT throw, L3 sprint, Start pause, D-pad up journal, D-pad down rest.</p>
    </>
  );
}

// ---------------- Help ----------------
export function Help({ onBack }: { onBack: () => void }) {
  return (
    <div className="mvw-overlay scroll">
      <h2>Controls and help</h2>
      <table className="mvw-table">
        <tbody>
          {ACTION_ORDER.map((a) => <tr key={a}><td>{ACTION_LABELS[a]}</td><td>{DEFAULT_BINDINGS[a].map(codeLabel).join(' / ')}</td></tr>)}
          <tr><td>Hotbar</td><td>1 to 9</td></tr>
          <tr><td>Build mode piece</td><td>1 to 4</td></tr>
          <tr><td>Climb</td><td>Walk into steep rock faces</td></tr>
        </tbody>
      </table>
      <p className="mvw-fine">Survival hints in this game are simplified for play and are not real survival advice.</p>
      <Back onClick={onBack} />
    </div>
  );
}

export function InfoScreen({ kind, onBack }: { kind: 'achievements' | 'stats'; onBack: () => void }) {
  return (
    <div className="mvw-overlay scroll">
      {kind === 'achievements' ? <AchievementsList /> : <StatsPanel />}
      <Back onClick={onBack} />
    </div>
  );
}

// ---------------- Pause and end ----------------
export function PauseMenu({ onResume, openPanel, go, onQuit }: { onResume: () => void; openPanel: (p: 'inventory' | 'map' | 'journal' | 'skills' | 'achievements' | 'stats') => void; go: (s: Screen) => void; onQuit: () => void }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="mvw-overlay">
      <h2>Paused</h2>
      <div className="mvw-menu">
        <button className="mvw-btn" onClick={onResume}>Resume</button>
        <button className="mvw-btn secondary" onClick={() => openPanel('inventory')}>Backpack and crafting</button>
        <button className="mvw-btn secondary" onClick={() => openPanel('map')}>Map</button>
        <button className="mvw-btn secondary" onClick={() => openPanel('journal')}>Journal</button>
        <button className="mvw-btn secondary" onClick={() => openPanel('skills')}>Skills</button>
        <button className="mvw-btn secondary" onClick={() => openPanel('achievements')}>Achievements</button>
        <button className="mvw-btn secondary" onClick={() => openPanel('stats')}>Statistics</button>
        <button className="mvw-btn secondary" onClick={() => go('saveload')}>Save and load</button>
        <button className="mvw-btn secondary" onClick={() => go('settings')}>Settings</button>
        <button className="mvw-btn secondary" onClick={() => go('help')}>Controls</button>
        {confirm ? (
          <div className="mvw-row center">
            <span>Quit to the main menu? Unsaved progress is lost.</span>
            <button className="mvw-link" onClick={onQuit}>Yes, quit</button>
            <button className="mvw-link" onClick={() => setConfirm(false)}>Cancel</button>
          </div>
        ) : <button className="mvw-btn secondary" onClick={() => setConfirm(true)}>Quit to main menu</button>}
      </div>
    </div>
  );
}

export function EndScreen({ onMenu, onRetry, onLoadLast, hasSave }: { onMenu: () => void; onRetry: () => void; onLoadLast: () => void; hasSave: boolean }) {
  const s = useStore(sessionStore);
  const o = s.outcome;
  if (!o) return null;
  return (
    <div className="mvw-overlay end" role="dialog" aria-label={o.title}>
      <h1 className="mvw-title">{o.title}</h1>
      <p className="mvw-sub">{o.text}</p>
      <table className="mvw-table"><tbody>
        <tr><td>Time played</td><td>{formatDuration(s.stats.playSeconds)}</td></tr>
        <tr><td>Days</td><td>{s.day}</td></tr>
        <tr><td>Distance</td><td>{Math.round(s.stats.distance)} m</td></tr>
        <tr><td>Explored</td><td>{s.explorationPct.toFixed(1)}%</td></tr>
        <tr><td>Missions completed</td><td>{s.stats.missionsCompleted}</td></tr>
      </tbody></table>
      <div className="mvw-row center">
        <button className="mvw-btn" onClick={onMenu}>Main menu</button>
        <button className="mvw-btn secondary" onClick={onRetry}>New run, same settings</button>
        {o.kind === 'failed' && hasSave && <button className="mvw-btn secondary" onClick={onLoadLast}>Load last save</button>}
      </div>
    </div>
  );
}
