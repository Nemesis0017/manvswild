import { useEffect, useRef, useState } from 'react';
import type { Game } from '../game';
import { sessionStore } from '../game/session';
import { ACHIEVEMENTS as ACH_LIST, STAT_LABELS, formatDuration, type Stats } from '../game/progress';
import { SCENARIOS } from '../game/modes';
import { SKILL_EFFECTS, type SkillId } from '../items/skills';
import { POI_LABEL } from '../exploration/pois';
import { drawMap, headingOf, s2w, w2s, type MapView } from './mapDraw';
import { useStore } from './useStore';

export function MapPanel({ game }: { game: Game }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const s = useStore(sessionStore);
  const f = game.character.feet;
  const [view, setView] = useState<MapView>({ cx: f.x, cz: f.z, scale: 0.35 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const session = game.session;

  useEffect(() => {
    const draw = () => {
      const c = canvas.current;
      const ctx = c?.getContext('2d');
      if (!c || !ctx) return;
      drawMap(ctx, c.width, c.height, viewRef.current, game, headingOf(game), { markers: true, labels: true, contours: true });
    };
    draw();
    const id = window.setInterval(draw, 400);
    return () => window.clearInterval(id);
  }, [game, view, s.mapRev]);

  if (!session) return null;
  const zoom = (k: number) => setView((v) => ({ ...v, scale: Math.max(0.08, Math.min(2, v.scale * k)) }));
  const onDown = (e: React.PointerEvent) => { drag.current = { x: e.clientX, y: e.clientY, moved: false }; (e.target as HTMLElement).setPointerCapture?.(e.pointerId); };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    if (d.moved) {
      d.x = e.clientX; d.y = e.clientY;
      setView((v) => ({ ...v, cx: v.cx - dx / v.scale, cz: v.cz - dy / v.scale }));
    }
  };
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved) return;
    const c = canvas.current!;
    const r = c.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * c.width, py = ((e.clientY - r.top) / r.height) * c.height;
    // Click a waypoint to select it, otherwise place a new one.
    for (const wp of session.exploration.waypoints) {
      const [wx, wy] = w2s(viewRef.current, c.width, c.height, wp.x, wp.z);
      if (Math.hypot(wx - px, wy - py) < 14) { setSelected(wp.id); return; }
    }
    const [x, z] = s2w(viewRef.current, c.width, c.height, px, py);
    session.addWaypoint(x, z);
  };
  const discovered = session.allPois().filter((p) => session.isDiscovered(p));
  const here = game.character.feet;
  return (
    <div className="mvw-map">
      <div className="mvw-map-main">
        <canvas ref={canvas} width={720} height={520} className="mvw-map-canvas" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}
          onWheel={(e) => zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15)} aria-label="World map" />
        <div className="mvw-map-bar">
          <button className="mvw-link" onClick={() => zoom(1.4)}>Zoom in</button>
          <button className="mvw-link" onClick={() => zoom(1 / 1.4)}>Zoom out</button>
          <button className="mvw-link" onClick={() => setView((v) => ({ ...v, cx: here.x, cz: here.z }))}>Center on me</button>
          <label><input type="checkbox" checked={s.navAssist} onChange={(e) => session.setNavAssist(e.target.checked)} /> Navigation assist (objective markers)</label>
          <span>Explored {s.explorationPct.toFixed(1)}% &middot; Elevation {Math.round(here.y)} m &middot; X {Math.round(here.x)} Z {Math.round(here.z)}</span>
        </div>
        <div className="mvw-hint">Drag to pan, wheel to zoom, click empty ground to place a waypoint, click a waypoint to select it. Only explored ground is shown.</div>
      </div>
      <div className="mvw-map-side">
        <h4>Waypoints</h4>
        {session.exploration.waypoints.length === 0 && <div className="mvw-hint">None yet. Press X in the world or click the map.</div>}
        {session.exploration.waypoints.map((w) => (
          <div key={w.id} className={'mvw-row' + (selected === w.id ? ' sel' : '')}>
            <button className="mvw-link" onClick={() => setSelected(w.id)}>{w.name}</button>
            <span className="mvw-cost">{Math.round(Math.hypot(w.x - here.x, w.z - here.z))} m</span>
            <button className="mvw-link" onClick={() => session.setTracked(s.tracked === `wp:${w.id}` ? null : `wp:${w.id}`)}>{s.tracked === `wp:${w.id}` ? 'Untrack' : 'Track'}</button>
            <button className="mvw-link" onClick={() => { const n = window.prompt('Waypoint name', w.name); if (n) { session.exploration.renameWaypoint(w.id, n); session.setTracked(s.tracked); } }}>Rename</button>
            <button className="mvw-link" onClick={() => { session.removeWaypoint(w.id); setSelected(null); }}>Remove</button>
          </div>
        ))}
        <h4>Discovered places</h4>
        {discovered.length === 0 && <div className="mvw-hint">Explore to find places.</div>}
        {discovered.map((p) => (
          <div key={p.id} className="mvw-row">
            <span>{p.name}</span>
            <span className="mvw-cost">{POI_LABEL[p.kind]} &middot; {Math.round(p.y)} m &middot; {Math.round(Math.hypot(p.x - here.x, p.z - here.z))} m away</span>
            <button className="mvw-link" onClick={() => session.setTracked(s.tracked === `poi:${p.id}` ? null : `poi:${p.id}`)}>{s.tracked === `poi:${p.id}` ? 'Untrack' : 'Track'}</button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function JournalPanel() {
  const s = useStore(sessionStore);
  return (
    <div className="mvw-page">
      <h3>Journal</h3>
      <p className="mvw-hint">{s.modeLabel}{s.scenarioName ? `: ${s.scenarioName}` : ''}. Day {s.day}.</p>
      {s.missionList.length === 0 && <p>This mode has no mission chain. {s.mode === 'endless' ? 'Survive as many days as you can.' : 'Do whatever you like.'}</p>}
      {s.missionList.map((m, i) => (
        <div key={m.id} className={'mvw-mission ' + m.state}>
          <strong>{m.state === 'done' ? '\u2713' : m.state === 'current' ? '\u25b6' : '\u25cb'} {i + 1}. {m.title}</strong>
          {m.state !== 'todo' && <div className="mvw-hint">{m.description}</div>}
          {m.state === 'current' && s.mission && <div className="mvw-hint">Hint: {s.mission.hint}{s.mission.progress ? ` Progress: ${s.mission.progress}` : ''}</div>}
        </div>
      ))}
    </div>
  );
}

export function SkillsPanel({ game }: { game: Game }) {
  const s = useStore(sessionStore);
  void game;
  return (
    <div className="mvw-page">
      <h3>Skills</h3>
      <p className="mvw-hint">Skills grow when you use them. Level 5 is the maximum.</p>
      {s.skillsXp.map((k) => {
        const next = [20, 60, 120, 200][k.level - 1];
        return (
          <div key={k.id} className="mvw-skill">
            <strong>{k.name}</strong> level {k.level} <span className="mvw-cost">{k.level >= 5 ? 'max' : `${k.xp} / ${next} xp`}</span>
            <div className="mvw-bar"><div className="mvw-fill" style={{ width: `${k.level >= 5 ? 100 : (k.xp / next) * 100}%`, background: '#8ab04a' }} /></div>
            <div className="mvw-hint">{SKILL_EFFECTS[k.id as SkillId]}</div>
          </div>
        );
      })}
    </div>
  );
}

export function AchievementsList() {
  const s = useStore(sessionStore);
  const got = new Map(s.records.achievements);
  return (
    <div className="mvw-page">
      <h3>Achievements ({got.size})</h3>
      <div className="mvw-ach-grid">
        {ACH_LIST.map((a) => (
          <div key={a.id} className={'mvw-ach' + (got.has(a.id) ? ' got' : '')}>
            <strong>{got.has(a.id) ? '\u2605 ' : '\u2606 '}{a.name}</strong>
            <div className="mvw-hint">{a.description}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function StatsPanel() {
  const s = useStore(sessionStore);
  const rows = Object.keys(STAT_LABELS) as (keyof Stats)[];
  const fmt = (k: keyof Stats, v: number) => (k === 'playSeconds' ? formatDuration(v) : k === 'distance' || k === 'highestPoint' || k.endsWith('Seconds') ? Math.round(v).toString() : String(v));
  return (
    <div className="mvw-page">
      <h3>Statistics</h3>
      {s.active && (
        <table className="mvw-table"><tbody>
          {rows.map((k) => <tr key={k}><td>{STAT_LABELS[k]}</td><td>{fmt(k, s.stats[k])}</td></tr>)}
          <tr><td>Explored</td><td>{s.explorationPct.toFixed(1)}%</td></tr>
        </tbody></table>
      )}
      <h4>Records</h4>
      <table className="mvw-table"><tbody>
        <tr><td>Story best time</td><td>{s.records.story.bestSeconds === null ? 'none yet' : formatDuration(s.records.story.bestSeconds)} ({s.records.story.completions} completions)</td></tr>
        <tr><td>Endless best</td><td>{s.records.endless.bestDays} days</td></tr>
        {SCENARIOS.map((sc) => {
          const r = s.records.expeditions[sc.id];
          return <tr key={sc.id}><td>Expedition: {sc.name}</td><td>{r ? `${formatDuration(r.bestSeconds)} (${r.completions} completions)` : 'none yet'}</td></tr>;
        })}
      </tbody></table>
    </div>
  );
}
