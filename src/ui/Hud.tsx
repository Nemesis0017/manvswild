import { ITEMS } from '../items/items';
import { settingsStore } from '../core/settings';
import type { Game } from '../game';
import type { Panel } from '../gameplay/hudStore';
import { paletteFor, type Palette } from './palette';
import { Captions, Compass, Minimap, MissionTracker, Toasts } from './overlays';
import { AchievementsList, JournalPanel, MapPanel, SkillsPanel, StatsPanel } from './panels';
import { hudStore, type HudState } from '../gameplay/hudStore';
import type { Gameplay } from '../gameplay/gameplay';
import type { Stack } from '../items/inventory';
import { useStore } from './useStore';

function Bar({ label, value, max = 100, color, assist, text }: { label: string; value: number; max?: number; color: string; assist: boolean; text?: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="mvw-stat" role="meter" aria-label={label} aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={max}>
      <span className="mvw-stat-label">{label}</span>
      <div className="mvw-bar"><div className="mvw-fill" style={{ width: `${pct}%`, background: color }} /></div>
      {assist && <span className="mvw-stat-num">{text ?? Math.round(value)}</span>}
    </div>
  );
}

function stackLabel(s: Stack): string {
  const d = ITEMS[s.id];
  return d.name + (s.count > 1 ? ` x${s.count}` : '') + (s.dur !== undefined ? ` (${Math.ceil(s.dur)}/${d.durability})` : '');
}

interface DragApi { index: number; from: 'inv' | 'store'; onDropOn: (from: 'inv' | 'store', fromIndex: number, to: 'inv' | 'store', toIndex: number) => void }

function Slot({ s, selected, onClick, onContext, n, drag }: { s: Stack | null; selected?: boolean; onClick?: () => void; onContext?: () => void; n?: number; drag?: DragApi }) {
  return (
    <button
      className={'mvw-slot' + (selected ? ' sel' : '')}
      draggable={!!drag && !!s}
      onDragStart={drag ? (e) => { e.dataTransfer.setData('text/plain', `${drag.from}:${drag.index}`); e.dataTransfer.effectAllowed = 'move'; } : undefined}
      onDragOver={drag ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } : undefined}
      onDrop={drag ? (e) => {
        e.preventDefault();
        const [f, i] = e.dataTransfer.getData('text/plain').split(':');
        if ((f === 'inv' || f === 'store') && i !== undefined) drag.onDropOn(f, +i, drag.from, drag.index);
      } : undefined}
      title={s ? `${stackLabel(s)}: ${ITEMS[s.id].description}` : 'Empty'}
      onClick={onClick}
      onContextMenu={(e) => { e.preventDefault(); onContext?.(); }}
    >
      {n !== undefined && <span className="mvw-slot-n">{n}</span>}
      {s && <span className="mvw-slot-name">{ITEMS[s.id].name}</span>}
      {s && s.count > 1 && <span className="mvw-slot-count">{s.count}</span>}
      {s && s.dur !== undefined && <span className="mvw-slot-dur" style={{ width: `${(s.dur / (ITEMS[s.id].durability ?? 1)) * 100}%` }} />}
    </button>
  );
}


const TABS: { id: Panel; label: string }[] = [
  { id: 'inventory', label: 'Backpack (I)' }, { id: 'map', label: 'Map (M)' }, { id: 'journal', label: 'Journal (J)' },
  { id: 'skills', label: 'Skills' }, { id: 'achievements', label: 'Achievements' }, { id: 'stats', label: 'Stats' },
];

export function Hud({ game }: { game: Game | null }) {
  const h: HudState = useStore(hudStore);
  const st = useStore(settingsStore);
  const gameplay = game?.gameplay ?? null;
  const pal: Palette = paletteFor(st.colorblind);
  const tempText = h.temp.toFixed(1) + '\u00b0C';
  const hidden = st.hudHidden && h.panel === 'none';
  return (
    <>
      <Captions />
      {!hidden && (
        <>
          {game && <Compass game={game} />}
          {game && <Minimap game={game} />}
          <MissionTracker />
          <Toasts />
          <div className="mvw-stats">
            <Bar label="Health" value={h.health} color={pal.health} assist={h.assist} />
            <Bar label="Hunger" value={h.hunger} color={pal.hunger} assist={h.assist} />
            <Bar label="Thirst" value={h.thirst} color={pal.thirst} assist={h.assist} />
            <Bar label="Stamina" value={h.stamina} color={pal.stamina} assist={h.assist} />
            <Bar label="Body temp" value={h.temp - 28} max={14} color={h.temp < 35 ? pal.cold : h.temp > 38.5 ? pal.hot : pal.ok} assist={h.assist} text={tempText} />
            <Bar label="Tiredness" value={h.fatigue} color={pal.fatigue} assist={h.assist} />
            <Bar label="Wetness" value={h.wetness} color={pal.wet} assist={h.assist} />
            {h.warnings.length > 0 && <div className="mvw-warn">{h.warnings.join(' / ')}</div>}
          </div>
          <div className="mvw-env">
            <div>{h.clock} &middot; {h.weather}</div>
            {h.assist && <div>{h.ambient.toFixed(0)}&deg;C air &middot; {h.difficulty}</div>}
            {h.animal && h.assist && <div>Nearby: {h.animal}</div>}
            {h.signalActive && <div>Signal smoke is rising</div>}
            {h.fishing && <div>Fishing: {h.fishing}</div>}
            {h.resting && <div>Resting (R or move to get up)</div>}
          </div>
          <div className="mvw-log" aria-live="polite">
            {h.messages.map((m) => <div key={m.id}>{m.text}</div>)}
          </div>
          <div className="mvw-hotbar">
            {Array.from({ length: 9 }, (_, i) => (
              <Slot key={i} n={i + 1} s={h.hotbar[i] ?? null} selected={h.selected === i} onClick={() => gameplay?.selectSlot(i)}
                drag={gameplay ? { index: i, from: 'inv', onDropOn: (f, fi, t, ti) => (f === 'inv' && t === 'inv' ? gameplay.swapSlots(fi, ti) : gameplay.transfer(f, fi)) } : undefined} />
            ))}
          </div>
          <div className="mvw-keyhint">E interact &middot; F use &middot; G throw stone &middot; B build &middot; R rest &middot; I backpack &middot; M map &middot; J journal &middot; H hide HUD</div>
        </>
      )}
      {h.prompt && <div className="mvw-prompt">{h.prompt}</div>}
      {h.phase !== 'alive' && h.phase !== 'ended' && (
        <div className="mvw-fade" style={{ opacity: h.fade }}>
          {h.phase === 'rescued' && (
            <div className="mvw-modal">
              <h2>You blacked out</h2>
              <p>{h.failReason}. A rescue team found you.{h.rescuesLeft < 1e6 ? ` Rescues left after this: ${h.rescuesLeft - 1}.` : ''}</p>
              <button className="mvw-btn" onClick={() => gameplay?.acceptRescue()}>Wake up at the trail</button>
            </div>
          )}
        </div>
      )}
      {h.panel !== 'none' && game && <PanelHost h={h} game={game} />}
    </>
  );
}

function PanelHost({ h, game }: { h: HudState; game: Game }) {
  const gameplay = game.gameplay;
  const active: Panel = h.panel === 'storage' ? 'inventory' : h.panel;
  return (
    <div className="mvw-panelwrap" onClick={(e) => e.stopPropagation()}>
      <div className="mvw-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={active === t.id} className={'mvw-tab' + (active === t.id ? ' on' : '')} onClick={() => gameplay.setPanel(t.id)}>{t.label}</button>
        ))}
        <button className="mvw-x" onClick={() => gameplay.setPanel('none')} aria-label="Close panel">Close (Esc)</button>
      </div>
      <div className="mvw-tabbody">
        {(h.panel === 'inventory' || h.panel === 'storage') && <InventoryPanel h={h} gameplay={gameplay} camera={game.camera} />}
        {h.panel === 'map' && <MapPanel game={game} />}
        {h.panel === 'journal' && <JournalPanel />}
        {h.panel === 'skills' && <SkillsPanel game={game} />}
        {h.panel === 'achievements' && <AchievementsList />}
        {h.panel === 'stats' && <StatsPanel />}
      </div>
    </div>
  );
}

function InventoryPanel({ h, gameplay, camera }: { h: HudState; gameplay: Gameplay; camera: import('three').Camera }) {
  const equip = (['body', 'back'] as const).map((k) => [k, h.equipment[k]] as const);
  const onDropOn = (f: 'inv' | 'store', fi: number, t: 'inv' | 'store', ti: number) => {
    if (f === 'inv' && t === 'inv') gameplay.swapSlots(fi, ti);
    else if (f !== t) gameplay.transfer(f, fi);
  };
  return (
    <div className="mvw-invrow">
      <div className="mvw-inv">
        <div className="mvw-inv-head">
          <h3>Backpack</h3>
          <span>{h.weight.toFixed(1)} / {h.weightLimit} kg</span>
        </div>
        <div className="mvw-grid">
          {h.slots.map((s, i) => (
            <Slot key={i} s={s} selected={h.selected === i}
              drag={{ index: i, from: 'inv', onDropOn }}
              onClick={() => (h.panel === 'storage' ? gameplay.transfer('inv', i) : gameplay.useSlot(i, camera))} onContext={() => gameplay.dropSlot(i)} />
          ))}
        </div>
        <div className="mvw-dropzone" onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); const [f, i] = e.dataTransfer.getData('text/plain').split(':'); if (f === 'inv') gameplay.dropSlot(+i); }}>
          Drop here to discard one
        </div>
        <p className="mvw-hint">{h.panel === 'storage' ? 'Click or drag an item to move it into the box.' : 'Click to use, eat, drink or wear. Drag to rearrange. Right click drops one. The first 9 slots are the hotbar.'}</p>
        <div className="mvw-equip">
          {equip.map(([k, s]) => (
            <div key={k}>Worn ({k}): {s ? <button className="mvw-link" onClick={() => gameplay.takeOff(k)}>{ITEMS[s.id].name} (take off)</button> : 'nothing'}</div>
          ))}
        </div>
      </div>
      {h.panel === 'storage' && h.storage && (
        <div className="mvw-inv">
          <div className="mvw-inv-head"><h3>Storage box</h3></div>
          <div className="mvw-grid">
            {h.storage.map((s, i) => <Slot key={i} s={s} drag={{ index: i, from: 'store', onDropOn }} onClick={() => gameplay.transfer('store', i)} />)}
          </div>
          <p className="mvw-hint">Click or drag an item to take it out.</p>
        </div>
      )}
      <div className="mvw-inv">
        <div className="mvw-inv-head"><h3>Crafting</h3></div>
        <div className="mvw-recipes">
          {h.recipes.map((r) => (
            <div key={r.id} className={'mvw-recipe' + (r.blocker ? ' blocked' : '')}>
              <div><strong>{r.name}{r.build ? ' (build)' : ''}</strong> <span className="mvw-cost">{r.cost}</span></div>
              <div className="mvw-hint">{r.blocker ?? r.description}</div>
              <button className="mvw-link" disabled={!!r.blocker} onClick={() => gameplay.craft(r.id)}>{r.build ? 'Place' : 'Craft'}</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
