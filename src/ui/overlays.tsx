import { useEffect, useRef } from 'react';
import { settingsStore } from '../core/settings';
import { captionStore } from '../audio/audio';
import type { Game } from '../game';
import { sessionStore } from '../game/session';
import { formatDuration } from '../game/progress';
import { compassLabel } from '../exploration/exploration';
import { drawCompass, drawMap, headingOf } from './mapDraw';
import { useStore } from './useStore';

export function Minimap({ game }: { game: Game }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const id = window.setInterval(() => {
      const c = ref.current;
      const ctx = c?.getContext('2d');
      if (!c || !ctx) return;
      const f = game.character.feet;
      drawMap(ctx, c.width, c.height, { cx: f.x, cz: f.z, scale: 0.7 }, game, headingOf(game), { markers: true, labels: false, contours: false });
    }, 150);
    return () => window.clearInterval(id);
  }, [game]);
  return <canvas ref={ref} className="mvw-minimap" width={150} height={150} aria-label="Minimap" />;
}

export function Compass({ game }: { game: Game }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const label = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const id = window.setInterval(() => {
      const c = ref.current;
      const ctx = c?.getContext('2d');
      if (!c || !ctx) return;
      const h = headingOf(game);
      drawCompass(ctx, c.width, 28, game, h);
      if (label.current) label.current.textContent = compassLabel(h) + ' ' + Math.round(((h * 180) / Math.PI + 360) % 360) + '\u00b0';
    }, 80);
    return () => window.clearInterval(id);
  }, [game]);
  return (
    <div className="mvw-compass" aria-label="Compass">
      <canvas ref={ref} width={420} height={44} />
      <div ref={label} className="mvw-compass-label" />
    </div>
  );
}

export function MissionTracker() {
  const s = useStore(sessionStore);
  if (!s.active) return null;
  return (
    <div className="mvw-tracker" aria-live="polite">
      <div className="mvw-tracker-head">{s.modeLabel}{s.scenarioName ? `: ${s.scenarioName}` : ''} &middot; Day {s.day} &middot; Explored {s.explorationPct.toFixed(1)}%</div>
      {s.mission ? (
        <>
          <div className="mvw-tracker-title">{s.mission.title} {s.mission.total > 0 && <span className="mvw-cost">({s.mission.index}/{s.mission.total})</span>}</div>
          <div className="mvw-tracker-desc">{s.mission.description}{s.mission.progress ? ` [${s.mission.progress}]` : ''}</div>
        </>
      ) : s.mode === 'endless' ? <div className="mvw-tracker-desc">Survive as long as you can. Each day is harder.</div> : s.mode === 'sandbox' ? <div className="mvw-tracker-desc">Sandbox. No objectives.</div> : null}
      {s.timeLeft !== null && <div className="mvw-warn">Time left: {formatDuration(s.timeLeft)}</div>}
    </div>
  );
}

export function Toasts() {
  const s = useStore(sessionStore);
  return (
    <div className="mvw-toasts" aria-live="polite">
      {s.toasts.map((t) => <div key={t.id} className={'mvw-toast ' + t.kind}>{t.text}</div>)}
    </div>
  );
}

export function Captions() {
  const st = useStore(settingsStore);
  const c = useStore(captionStore);
  useEffect(() => {
    if (c.captions.length === 0) return;
    const id = window.setInterval(() => captionStore.setState({ captions: captionStore.getState().captions.filter((x) => x.until > performance.now()) }), 500);
    return () => window.clearInterval(id);
  }, [c.captions]);
  if (!st.subtitles || c.captions.length === 0) return null;
  return <div className="mvw-captions" aria-live="polite">{c.captions.map((x) => <div key={x.id}>{x.text}</div>)}</div>;
}
