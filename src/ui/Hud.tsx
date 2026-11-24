import { ITEMS } from '../items/items';
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

function Slot({ s, selected, onClick, onContext, n }: { s: Stack | null; selected?: boolean; onClick?: () => void; onContext?: () => void; n?: number }) {
  return (
    <button
      className={'mvw-slot' + (selected ? ' sel' : '')}
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

export function Hud({ gameplay, camera }: { gameplay: Gameplay | null; camera: import('three').Camera | null }) {
  const h: HudState = useStore(hudStore);
  const tempText = h.temp.toFixed(1) + '\u00b0C';
  return (
    <>
      <div className="mvw-stats">
        <Bar label="Health" value={h.health} color="#d95a5a" assist={h.assist} />
        <Bar label="Hunger" value={h.hunger} color="#d9a441" assist={h.assist} />
        <Bar label="Thirst" value={h.thirst} color="#4aa3df" assist={h.assist} />
        <Bar label="Stamina" value={h.stamina} color="#7ac35a" assist={h.assist} />
        <Bar label="Body temp" value={h.temp - 28} max={14} color={h.temp < 35 ? '#6aa0ff' : h.temp > 38.5 ? '#ff7a40' : '#c8d070'} assist={h.assist} text={tempText} />
        <Bar label="Tiredness" value={h.fatigue} color="#9a7ad0" assist={h.assist} />
        <Bar label="Wetness" value={h.wetness} color="#5ac8c8" assist={h.assist} />
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
      {h.prompt && <div className="mvw-prompt">{h.prompt}</div>}
      <div className="mvw-hotbar">
        {Array.from({ length: 9 }, (_, i) => (
          <Slot key={i} n={i + 1} s={h.hotbar[i] ?? null} selected={h.selected === i} onClick={() => gameplay?.selectSlot(i)} />
        ))}
      </div>
      <div className="mvw-keyhint">E interact &middot; F use &middot; G throw stone &middot; B build &middot; R rest &middot; I inventory and crafting</div>
      {h.phase !== 'alive' && (
        <div className="mvw-fade" style={{ opacity: h.fade }}>
          {h.phase === 'rescued' && (
            <div className="mvw-modal">
              <h2>You blacked out</h2>
              <p>{h.failReason}. A rescue team found you.{h.rescuesLeft < 1e6 ? ` Rescues left after this: ${h.rescuesLeft - 1}.` : ''}</p>
              <button className="mvw-btn" onClick={() => gameplay?.acceptRescue()}>Wake up at the trail</button>
            </div>
          )}
          {h.phase === 'ended' && (
            <div className="mvw-modal">
              <h2>Expedition over</h2>
              <p>{h.failReason}. No more rescues are available on this difficulty.</p>
              <button className="mvw-btn" onClick={() => gameplay?.restart()}>Start a new expedition</button>
            </div>
          )}
        </div>
      )}
      {h.panel !== 'none' && <InventoryPanel h={h} gameplay={gameplay} camera={camera} />}
    </>
  );
}

function InventoryPanel({ h, gameplay, camera }: { h: HudState; gameplay: Gameplay | null; camera: import('three').Camera | null }) {
  const equip = (['body', 'back'] as const).map((k) => [k, h.equipment[k]] as const);
  return (
    <div className="mvw-panelwrap" onClick={(e) => e.stopPropagation()}>
      <div className="mvw-inv">
        <div className="mvw-inv-head">
          <h3>Backpack</h3>
          <span>{h.weight.toFixed(1)} / {h.weightLimit} kg</span>
          <button className="mvw-x" onClick={() => gameplay?.setPanel('none')} aria-label="Close">Close (I)</button>
        </div>
        <div className="mvw-grid">
          {h.slots.map((s, i) => (
            <Slot key={i} s={s} selected={h.selected === i} onClick={() => (h.panel === 'storage' ? gameplay?.transfer('inv', i) : camera && gameplay?.useSlot(i, camera))} onContext={() => gameplay?.dropSlot(i)} />
          ))}
        </div>
        <p className="mvw-hint">{h.panel === 'storage' ? 'Click an item to move it into the box.' : 'Click to use, eat, drink or wear. Right click drops one. Hotbar is the first 9 slots.'}</p>
        <div className="mvw-equip">
          {equip.map(([k, s]) => (
            <div key={k}>Worn ({k}): {s ? <button className="mvw-link" onClick={() => gameplay?.takeOff(k)}>{ITEMS[s.id].name} (take off)</button> : 'nothing'}</div>
          ))}
        </div>
        <div className="mvw-skills">{h.skills.map((s) => <span key={s.id}>{s.name} {s.level}</span>)}</div>
      </div>
      {h.panel === 'storage' && h.storage && (
        <div className="mvw-inv">
          <div className="mvw-inv-head"><h3>Storage box</h3></div>
          <div className="mvw-grid">
            {h.storage.map((s, i) => <Slot key={i} s={s} onClick={() => gameplay?.transfer('store', i)} />)}
          </div>
          <p className="mvw-hint">Click an item to take it out.</p>
        </div>
      )}
      <div className="mvw-inv">
        <div className="mvw-inv-head"><h3>Crafting</h3></div>
        <div className="mvw-recipes">
          {h.recipes.map((r) => (
            <div key={r.id} className={'mvw-recipe' + (r.blocker ? ' blocked' : '')}>
              <div><strong>{r.name}{r.build ? ' (build)' : ''}</strong> <span className="mvw-cost">{r.cost}</span></div>
              <div className="mvw-hint">{r.blocker ?? r.description}</div>
              <button className="mvw-link" disabled={!!r.blocker} onClick={() => gameplay?.craft(r.id)}>{r.build ? 'Place' : 'Craft'}</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
