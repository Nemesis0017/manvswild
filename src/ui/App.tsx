import { useEffect, useRef } from 'react';
import { gameStore } from '../core/gameState';
import { settingsStore, type GraphicsPreset } from '../core/settings';
import { Game } from '../game';
import { DIFFICULTIES, DIFFICULTY_IDS, type DifficultyId } from '../survival/difficulty';
import { hudStore } from '../gameplay/hudStore';
import { Hud } from './Hud';
import { useStore } from './useStore';

export function App() {
  const host = useRef<HTMLDivElement>(null);
  const game = useRef<Game | null>(null);
  const gs = useStore(gameStore);
  const settings = useStore(settingsStore);
  const hud = useStore(hudStore);

  useEffect(() => {
    let cancelled = false;
    let created: Game | null = null;
    Game.create(host.current!)
      .then((g) => {
        if (cancelled) { g.dispose(); return; }
        created = g;
        game.current = g;
      })
      .catch((e) => gameStore.setState({ error: String(e?.message ?? e), status: 'loading', loadMessage: 'Failed' }));
    return () => {
      cancelled = true;
      created?.dispose();
      game.current = null;
    };
  }, []);

  const play = () => {
    game.current?.start();
    game.current?.requestLock();
  };

  return (
    <div className={'mvw-root' + (settings.highContrast ? ' mvw-high-contrast' : '')} style={{ fontSize: `${settings.uiScale * 100}%` }}>
      <div ref={host} className="mvw-canvas" onClick={() => (gs.introActive ? game.current?.skipIntro() : undefined)} />
      {gs.underwater && <div className="mvw-uw" />}
      {gs.status === 'playing' && !gs.introActive && <div className="mvw-cross" />}
      {(gs.status === 'playing' || gs.status === 'paused') && !gs.introActive && (
        <Hud gameplay={game.current?.gameplay ?? null} camera={game.current?.camera ?? null} />
      )}
      {gs.status === 'playing' && gs.introActive && (
        <div className="mvw-hud">Press Space or click to skip intro</div>
      )}
      {gs.status === 'loading' && (
        <div className="mvw-overlay">
          <h1 className="mvw-title">Man vs Wild</h1>
          <p className="mvw-sub">{gs.error ? `Error: ${gs.error}` : gs.loadMessage + '...'}</p>
        </div>
      )}
      {(gs.status === 'menu' || gs.status === 'paused') && (
        <div className="mvw-overlay">
          <h1 className="mvw-title">Man vs Wild</h1>
          <p className="mvw-sub">{gs.status === 'paused' ? 'Paused' : 'Survive the wilderness.'}</p>
          <button className="mvw-btn" onClick={() => (gs.status === 'paused' ? (game.current?.setPaused(false), game.current?.requestLock()) : play())}>
            {gs.status === 'paused' ? 'Resume' : 'Start'}
          </button>
          <div className="mvw-panel">
            <label htmlFor="preset">Graphics</label>
            <select id="preset" value={settings.preset} onChange={(e) => settingsStore.setState({ preset: e.target.value as GraphicsPreset })}>
              <option value="low">Low</option><option value="medium">Medium</option>
              <option value="high">High</option><option value="ultra">Ultra</option>
            </select>
            <label htmlFor="fov">Field of view {settings.fov}</label>
            <input id="fov" type="range" min={50} max={110} value={settings.fov} onChange={(e) => settingsStore.setState({ fov: +e.target.value })} />
            <label htmlFor="sens">Mouse sensitivity {settings.sensitivity.toFixed(1)}</label>
            <input id="sens" type="range" min={0.2} max={3} step={0.1} value={settings.sensitivity} onChange={(e) => settingsStore.setState({ sensitivity: +e.target.value })} />
            <label htmlFor="diff">Difficulty</label>
            <select id="diff" value={hud.difficulty} onChange={(e) => game.current?.gameplay.setDifficulty(e.target.value as DifficultyId)}>
              {DIFFICULTY_IDS.map((d) => <option key={d} value={d}>{DIFFICULTIES[d].label}</option>)}
            </select>
            <span className="mvw-hint" style={{ gridColumn: '1 / 3' }}>{DIFFICULTIES[hud.difficulty].description}</span>
            <label htmlFor="rm">Reduced motion</label>
            <input id="rm" type="checkbox" checked={settings.reducedMotion} onChange={(e) => settingsStore.setState({ reducedMotion: e.target.checked })} />
            <label htmlFor="hc">High contrast UI</label>
            <input id="hc" type="checkbox" checked={settings.highContrast} onChange={(e) => settingsStore.setState({ highContrast: e.target.checked })} />
          </div>
          <div className="mvw-keys">
            WASD move, Mouse look, Shift sprint, Ctrl/C crouch, Space jump (swim up), V first/third person, P pause.
            Walk into steep rock faces to climb. Enter cave entrances in the mountains. Gamepad supported.
            E gather or interact, F use item, 1-9 hotbar, G throw a stone to distract animals, B build mode (Q rotate), R rest at a sleeping area, I inventory and crafting.
          </div>
        </div>
      )}
    </div>
  );
}
