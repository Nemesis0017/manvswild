import { useCallback, useEffect, useRef, useState } from 'react';
import { gameStore } from '../core/gameState';
import { settingsStore } from '../core/settings';
import { Game } from '../game';
import { sessionStore, type SessionConfig } from '../game/session';
import { hudStore } from '../gameplay/hudStore';
import { saveDb } from '../save/db';
import type { SaveMeta } from '../save/saveData';
import { Hud } from './Hud';
import { EndScreen, Help, InfoScreen, MainMenu, NewGame, PauseMenu, SaveSlots, SettingsScreen, type Screen } from './menus';
import { useStore } from './useStore';

export function App() {
  const host = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Game | null>(null);
  const [game, setGame] = useState<Game | null>(null);
  const gs = useStore(gameStore);
  const settings = useStore(settingsStore);
  const hud = useStore(hudStore);
  const sess = useStore(sessionStore);
  const [screen, setScreen] = useState<Screen>('main');
  const [latest, setLatest] = useState<SaveMeta | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lastCfg = useRef<SessionConfig | null>(null);
  const alive = useRef(true);

  const refreshLatest = useCallback(() => {
    saveDb.latest().then(setLatest).catch(() => setLatest(null));
  }, []);

  const disposeGame = useCallback(() => {
    gameRef.current?.dispose();
    gameRef.current = null;
    setGame(null);
  }, []);

  const createGame = useCallback(async (seed: number): Promise<Game | null> => {
    try {
      const g = await Game.create(host.current!, seed);
      if (!alive.current) { g.dispose(); return null; }
      gameRef.current = g;
      setGame(g);
      return g;
    } catch (e) {
      gameStore.setState({ error: String((e as Error)?.message ?? e), status: 'loading', loadMessage: 'Failed' });
      return null;
    }
  }, []);

  const loadSlotRef = useRef<(slot: string) => void>(() => undefined);

  const launch = useCallback(async (cfg: SessionConfig, save?: Awaited<ReturnType<typeof saveDb.get>>) => {
    setBusy(true);
    setError('');
    setScreen('none');
    disposeGame();
    settingsStore.setState({ seed: cfg.seed });
    const g = await createGame(cfg.seed);
    if (g) {
      g.onQuickLoad = () => loadSlotRef.current('quick');
      lastCfg.current = cfg;
      g.beginSession(cfg, save ?? undefined);
    }
    setBusy(false);
  }, [createGame, disposeGame]);

  const loadSlot = useCallback(async (slot: string) => {
    try {
      const data = await saveDb.get(slot);
      if (!data) { setError('That slot is empty.'); return; }
      await launch(data.session.config, data);
    } catch (e) {
      setError(`Could not load: ${String((e as Error)?.message ?? e)}`);
      setScreen(gameStore.getState().status === 'menu' ? 'main' : 'pause');
    }
  }, [launch]);
  loadSlotRef.current = (slot) => { void loadSlot(slot); };

  const toMenu = useCallback(async () => {
    setBusy(true);
    disposeGame();
    await createGame(settingsStore.getState().seed);
    setScreen('main');
    setBusy(false);
    refreshLatest();
  }, [createGame, disposeGame, refreshLatest]);

  useEffect(() => {
    alive.current = true;
    void createGame(settingsStore.getState().seed);
    refreshLatest();
    return () => { alive.current = false; gameRef.current?.dispose(); gameRef.current = null; };
  }, [createGame, refreshLatest]);

  useEffect(() => { refreshLatest(); }, [gs.status, sess.outcome, refreshLatest]);

  // Follow the engine status: show the pause menu when paused, clear overlays when playing.
  useEffect(() => {
    if (gs.status === 'paused') setScreen((s) => (s === 'none' || s === 'main' ? 'pause' : s));
    else if (gs.status === 'playing') setScreen('none');
    else if (gs.status === 'menu') setScreen((s) => (s === 'none' || s === 'pause' ? 'main' : s));
  }, [gs.status]);

  const resume = useCallback(() => {
    gameRef.current?.setPaused(false);
    gameRef.current?.requestLock();
    setScreen('none');
  }, []);

  // Escape closes panels or resumes from the pause menu.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Escape') return;
      const g = gameRef.current;
      if (!g) return;
      const st = gameStore.getState().status;
      if (st === 'playing' && g.gameplay.panelOpen) { g.gameplay.setPanel('none'); return; }
      if (st === 'paused' && screen === 'pause') resume();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [screen, resume]);

  const openPanel = (p: 'inventory' | 'map' | 'journal' | 'skills' | 'achievements' | 'stats') => {
    const g = gameRef.current;
    if (!g) return;
    g.setPaused(false);
    g.gameplay.setPanel(p);
    setScreen('none');
  };

  const canvasClick = () => {
    const g = gameRef.current;
    if (!g) return;
    if (gs.introActive) g.skipIntro();
    else if (gs.status === 'playing' && !gs.pointerLocked && hud.panel === 'none' && !sess.outcome) g.requestLock();
  };

  const showOutcome = !!sess.outcome && gs.status !== 'loading';
  const menuOpen = gs.status === 'menu' && !busy;
  return (
    <div className={'mvw-root' + (settings.highContrast ? ' mvw-high-contrast' : '') + (settings.reducedMotion ? ' mvw-reduced' : '') + (settings.colorblind !== 'none' ? ' mvw-cb-' + settings.colorblind : '')} style={{ fontSize: `${settings.uiScale * 100}%` }}>
      <div ref={host} className="mvw-canvas" onClick={canvasClick} />
      {gs.underwater && <div className="mvw-uw" />}
      {gs.status === 'playing' && !gs.introActive && hud.panel === 'none' && !showOutcome && <div className="mvw-cross" />}
      {(gs.status === 'playing' || gs.status === 'paused') && !gs.introActive && <Hud game={game} />}
      {gs.status === 'playing' && gs.introActive && <div className="mvw-hud">Press Space or click to skip intro</div>}
      {(gs.status === 'loading' || busy) && (
        <div className="mvw-overlay">
          <h1 className="mvw-title">Man vs Wild</h1>
          <p className="mvw-sub">{gs.error ? `Error: ${gs.error}` : busy ? 'Generating world...' : gs.loadMessage + '...'}</p>
          {gs.error && <button className="mvw-btn" onClick={() => location.reload()}>Reload</button>}
        </div>
      )}
      {error && (
        <div className="mvw-toast-error" role="alert">{error} <button className="mvw-link" onClick={() => setError('')}>Dismiss</button></div>
      )}
      {menuOpen && screen === 'main' && <MainMenu go={setScreen} latest={latest} busy={busy} onContinue={() => latest && void loadSlot(latest.slot)} />}
      {menuOpen && screen === 'new' && <NewGame onBack={() => setScreen('main')} onStart={(cfg) => void launch(cfg)} />}
      {menuOpen && screen === 'load' && <SaveSlots game={game} allowSave={false} onLoad={(s) => void loadSlot(s)} onBack={() => { setScreen('main'); refreshLatest(); }} />}
      {menuOpen && (screen === 'achievements' || screen === 'stats') && <InfoScreen kind={screen} onBack={() => setScreen('main')} />}
      {gs.status === 'paused' && !showOutcome && screen === 'pause' && (
        <PauseMenu onResume={resume} openPanel={openPanel} go={setScreen} onQuit={() => void toMenu()} />
      )}
      {gs.status === 'paused' && !showOutcome && screen === 'saveload' && (
        <SaveSlots game={game} allowSave onLoad={(s) => void loadSlot(s)} onBack={() => setScreen('pause')} />
      )}
      {(menuOpen || (gs.status === 'paused' && !showOutcome)) && screen === 'settings' && (
        <SettingsScreen game={game} onBack={() => setScreen(gs.status === 'menu' ? 'main' : 'pause')} />
      )}
      {(menuOpen || (gs.status === 'paused' && !showOutcome)) && screen === 'help' && <Help onBack={() => setScreen(gs.status === 'menu' ? 'main' : 'pause')} />}
      {showOutcome && (
        <EndScreen
          hasSave={!!latest}
          onMenu={() => void toMenu()}
          onRetry={() => lastCfg.current && void launch(lastCfg.current)}
          onLoadLast={() => latest && void loadSlot(latest.slot)}
        />
      )}
    </div>
  );
}
