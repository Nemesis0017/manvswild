import { events } from '../core/events';
import { Store } from '../core/store';
import { Exploration, type ExplorationData } from '../exploration/exploration';
import { POI_LABEL, generatePois, type Poi, type PoiSet } from '../exploration/pois';
import { SKILL_NAMES, skillLevel, type SkillId } from '../items/skills';
import type { DifficultyId } from '../survival/difficulty';
import { WATER_Y, type Terrain } from '../world/terrain';
import {
  CHARACTERS, DEFAULT_SANDBOX, MODE_INFO, characterById, escalationForDay, scenarioById,
  type ModeContext, type ModeId, type SandboxOptions, type Scenario,
} from './modes';
import { MissionTracker, STORY_MISSIONS, createFacts, type Facts, type MissionDef } from './missions';
import {
  ACHIEVEMENTS, AchievementTracker, createStats, loadRecords, normalizeStats, recordEndless, recordExpedition, recordStory, saveRecords,
  type Records, type Stats,
} from './progress';
import type { Gameplay } from '../gameplay/gameplay';
import type { CharacterController } from '../physics/character';
import type { Sky } from '../world/sky';

export interface SessionConfig {
  mode: ModeId;
  difficulty: DifficultyId;
  character: string;
  seed: number;
  sandbox: SandboxOptions;
  scenarioId: string;
}

export const defaultConfig = (seed: number): SessionConfig => ({
  mode: 'story', difficulty: 'survivor', character: CHARACTERS[0].id, seed, sandbox: { ...DEFAULT_SANDBOX }, scenarioId: 'grassland',
});

export interface SessionSnapshot {
  config: SessionConfig;
  facts: Facts;
  stats: Stats;
  exploration: ExplorationData;
  missions: { index: number; completed: string[] };
  day: number;
  sawNight: boolean;
  discoveredCaveVisit: boolean;
  looted: string[];
  tracked: string | null;
  spawn: { x: number; z: number };
  outcome: Outcome | null;
}

export interface Outcome { kind: 'victory' | 'failed'; title: string; text: string }

export interface Toast { id: number; text: string; kind: 'mission' | 'achievement' | 'info' | 'skill' }

export interface SessionView {
  active: boolean;
  mode: ModeId;
  modeLabel: string;
  scenarioName: string;
  day: number;
  mission: { title: string; description: string; hint: string; progress: string; index: number; total: number } | null;
  missionList: { id: string; title: string; description: string; state: 'done' | 'current' | 'todo' }[];
  explorationPct: number;
  toasts: Toast[];
  outcome: Outcome | null;
  navAssist: boolean;
  timeLeft: number | null;
  stats: Stats;
  achievements: { id: string; name: string; description: string; unlockedAt: number | null }[];
  records: Records;
  skillsXp: { id: SkillId; name: string; level: number; xp: number }[];
  /** Bumped when waypoints, POIs or tracking change so the map can redraw. */
  mapRev: number;
  tracked: string | null;
}

const emptyView = (records: Records): SessionView => ({
  active: false, mode: 'story', modeLabel: '', scenarioName: '', day: 1, mission: null, missionList: [], explorationPct: 0, toasts: [], outcome: null,
  navAssist: true, timeLeft: null, stats: createStats(), achievements: [], records, skillsXp: [], mapRev: 0, tracked: null,
});

export const sessionStore = new Store<SessionView>(emptyView(loadRecords()));

const REACH_RADIUS = 14;
const CAMP_RANGE = 3.4;

/** Ties mode rules, missions, exploration, stats and achievements to a running Gameplay. */
export class Session {
  readonly config: SessionConfig;
  readonly exploration: Exploration;
  readonly pois: PoiSet;
  readonly scenario: Scenario | null;
  readonly tracker: MissionTracker;
  facts: Facts = createFacts();
  stats: Stats = createStats();
  readonly achievements = new AchievementTracker();
  records: Records;
  outcome: Outcome | null = null;
  spawn: { x: number; z: number };
  day = 1;
  navAssist = true;
  tracked: string | null = null;
  readonly modeCtx: ModeContext;
  private looted = new Set<string>();
  private sawNight = false;
  private caveVisit = 0;
  private caveCounted = false;
  private riverEntry: number | null = null;
  private prevPos: { x: number; z: number } | null = null;
  private prevTod = -1;
  private slow = 0;
  private revealTimer = 0;
  private observed = new Set<number>();
  private lastPhase = 'alive';
  private toasts: Toast[] = [];
  private toastId = 1;
  private toastUntil = new Map<number, number>();
  private clock = 0;
  private mapRev = 0;
  private offs: (() => void)[] = [];
  private revealNew = 0;

  constructor(
    cfg: SessionConfig,
    private terrain: Terrain,
    private gameplay: Gameplay,
    private character: CharacterController,
    private sky: Sky,
    spawn: { x: number; z: number },
    snap?: SessionSnapshot,
  ) {
    this.config = snap ? snap.config : cfg;
    this.spawn = snap ? snap.spawn : spawn;
    this.scenario = this.config.mode === 'expedition' ? scenarioById(this.config.scenarioId) : null;
    this.pois = generatePois(terrain, this.spawn);
    this.exploration = new Exploration(this.spawn.x, this.spawn.z);
    this.records = loadRecords();
    this.achievements.restore(this.records.achievements);
    const defs: MissionDef[] = this.config.mode === 'story' ? STORY_MISSIONS : this.scenario ? this.scenario.missions : [];
    this.tracker = new MissionTracker(defs);
    this.modeCtx = { mode: this.config.mode, escalation: 1, sandbox: this.config.sandbox, scenario: this.scenario };
    gameplay.modeCtx = this.modeCtx;
    gameplay.hooks = {
      campsiteNear: (x, z) => this.campNear(x, z),
      lootCampsite: (id) => { this.looted.add(id); },
    };
    gameplay.setDifficulty(this.config.difficulty);
    this.applyModeSettings();
    if (snap) {
      this.facts = { ...createFacts(), ...snap.facts };
      this.stats = normalizeStats(snap.stats);
      Object.assign(this.exploration, Exploration.deserialize(snap.exploration, this.spawn.x, this.spawn.z));
      this.tracker.restore(snap.missions);
      this.day = snap.day;
      this.sawNight = snap.sawNight;
      this.looted = new Set(snap.looted);
      this.tracked = snap.tracked;
      this.outcome = snap.outcome;
    } else {
      this.startNew();
    }
    this.modeCtx.escalation = escalationForDay(this.day);
    this.offs.push(
      events.on('gathered', (e) => { this.stats.itemsGathered += e.count; }),
      events.on('crafted', () => { this.stats.itemsCrafted++; this.facts.itemsCrafted++; }),
      events.on('built', (e) => {
        this.stats.structuresBuilt++;
        if (e.kind === 'shelter') this.facts.shelters++;
        if (e.kind === 'campfire') this.facts.campfires++;
        if (e.kind === 'shelter' || e.kind === 'sleeping_area') this.gameplay.grantXp('shelter', 5);
      }),
      events.on('fishCaught', () => { this.stats.fishCaught++; this.facts.fishCaught++; }),
      events.on('waterCollected', () => { this.stats.waterCollected++; this.facts.waterCollected++; }),
      events.on('campsiteLooted', () => { this.stats.campsitesLooted++; this.facts.campsitesLooted++; }),
      events.on('thrown', () => { this.stats.stonesThrown++; }),
      events.on('signalRaised', (e) => {
        this.stats.signals++; this.facts.signals++;
        const s = this.pois.summit;
        if (s && Math.hypot(e.x - s.x, e.z - s.z) < 70) this.facts.signalAtSummit = true;
      }),
    );
    this.publish();
  }

  private startNew(): void {
    const c = characterById(this.config.character);
    const gp = this.gameplay;
    gp.grantXp(c.perk.skill, c.perk.xp, true);
    if (this.scenario) gp.setStartItems(this.scenario.startItems);
    else if (this.config.mode === 'sandbox' && this.config.sandbox.startKit) {
      gp.setStartItems([
        { id: 'waterskin', count: 1 }, { id: 'stone_axe', count: 1 }, { id: 'stone_knife', count: 1 }, { id: 'torch', count: 1 },
        { id: 'wood', count: 10 }, { id: 'stone', count: 12 }, { id: 'branch', count: 12 }, { id: 'leaf', count: 20 },
        { id: 'fiber', count: 20 }, { id: 'rope', count: 4 }, { id: 'berries', count: 8 }, { id: 'signal_kit', count: 1 },
      ]);
    }
    if (this.scenario?.weather) gp.setStartWeather(this.scenario.weather);
    gp.say(this.config.mode === 'story' ? 'Mission: ' + (this.tracker.current?.title ?? '') : MODE_INFO[this.config.mode].label + ' begins.');
  }

  private applyModeSettings(): void {
    const m = this.config.mode;
    this.sky.dayLength = 20 * 60 * (m === 'sandbox' ? this.config.sandbox.dayLengthMult : 1);
    const lock = m === 'sandbox' ? (this.config.sandbox.weather === 'auto' ? null : this.config.sandbox.weather) : this.scenario?.weather ?? null;
    this.gameplay.weatherLock = lock;
  }

  // ---------- Queries ----------
  allPois(): Poi[] { return this.pois.all; }

  isDiscovered(p: Poi): boolean { return this.exploration.discovered.has(p.id); }

  private campNear(x: number, z: number): { id: string } | null {
    for (const c of this.pois.campsites) {
      if (this.looted.has(c.id)) continue;
      if (Math.hypot(c.x - x, c.z - z) < CAMP_RANGE) return { id: c.id };
    }
    return null;
  }

  /** World position of the current objective, if the mission has one. */
  objectiveTarget(): { x: number; z: number; label: string } | null {
    const m = this.tracker.current;
    if (!m) return null;
    const f = this.facts;
    const p = this.pois;
    let poi: Poi | null = null;
    switch (m.id) {
      case 'navigate': case 'x_beacon': poi = p.cairn; break;
      case 'cave': poi = p.cave; break;
      case 'supplies': poi = p.campsites.find((c) => !this.looted.has(c.id)) ?? null; break;
      case 'summit': case 'signal': poi = p.summit; break;
      case 'extraction': case 'x_extract': poi = p.extraction; break;
      default: poi = null;
    }
    void f;
    return poi ? { x: poi.x, z: poi.z, label: m.title } : null;
  }

  /** Where the compass arrow points: tracked waypoint or POI, else the objective when assist is on. */
  trackTarget(): { x: number; z: number; label: string } | null {
    if (this.tracked) {
      if (this.tracked.startsWith('wp:')) {
        const w = this.exploration.waypoints.find((q) => `wp:${q.id}` === this.tracked);
        if (w) return { x: w.x, z: w.z, label: w.name };
      } else {
        const p = this.pois.all.find((q) => `poi:${q.id}` === this.tracked);
        if (p) return { x: p.x, z: p.z, label: p.name };
      }
    }
    return this.navAssist ? this.objectiveTarget() : null;
  }

  setTracked(id: string | null): void {
    this.tracked = id;
    this.mapRev++;
    this.publish();
  }

  setNavAssist(v: boolean): void {
    this.navAssist = v;
    this.mapRev++;
    this.publish();
  }

  addWaypoint(x: number, z: number): void {
    const w = this.exploration.addWaypoint(x, z);
    this.gameplay.say(`${w.name} placed.`);
    this.mapRev++;
    this.publish();
  }

  removeWaypoint(id: number): void {
    this.exploration.removeWaypoint(id);
    if (this.tracked === `wp:${id}`) this.tracked = null;
    this.mapRev++;
    this.publish();
  }

  toast(text: string, kind: Toast['kind'] = 'info'): void {
    const t = { id: this.toastId++, text, kind };
    this.toasts.push(t);
    this.toastUntil.set(t.id, this.clock + 6);
    if (this.toasts.length > 4) this.toasts.shift();
  }

  // ---------- Per frame ----------
  update(dt: number): void {
    if (this.outcome) return;
    this.clock += dt;
    this.stats.playSeconds += dt;
    const f = this.character.feet;
    const cs = this.character.state;
    const inCave = this.character.underground;
    const gp = this.gameplay;

    if (!inCave) {
      if (this.prevPos) {
        const d = Math.hypot(f.x - this.prevPos.x, f.z - this.prevPos.z);
        if (d < 15) this.stats.distance += d;
      }
      this.prevPos = { x: f.x, z: f.z };
      this.stats.highestPoint = Math.max(this.stats.highestPoint, f.y);
    } else this.prevPos = null;

    if (cs.swimming) { this.stats.swimSeconds += dt; gp.trickleXp('swimming', dt * 0.25); }
    if (cs.climbing) { this.stats.climbSeconds += dt; gp.trickleXp('climbing', dt * 0.3); }
    if (cs.sprinting && cs.speed > 1) gp.trickleXp('endurance', dt * 0.2);

    // Time of day: days and nights.
    const tod = this.sky.timeOfDay;
    if (this.prevTod > 0.9 && tod < 0.1) this.day++;
    this.prevTod = tod;
    if (tod < 0.2 || tod > 0.8) this.sawNight = true;
    else if (tod > 0.27 && tod < 0.5 && this.sawNight && gp.survival.phase === 'alive') {
      this.sawNight = false;
      this.stats.nights++; this.facts.nights++;
      this.toast(`You made it through the night. Day ${this.day}.`, 'info');
    }
    this.stats.days = this.day;
    this.modeCtx.escalation = escalationForDay(this.day);

    // Reveal map and discover POIs.
    this.revealTimer += dt;
    if (this.revealTimer >= 0.25 && !inCave) {
      this.revealTimer = 0;
      const nav = skillLevel(gp.skills.navigation);
      const base = 55 + (nav - 1) * 12;
      const added = this.exploration.reveal(f.x, f.z, base);
      if (added) {
        this.revealNew += added;
        if (this.revealNew >= 10) { gp.trickleXp('navigation', this.revealNew * 0.05); this.revealNew = 0; }
        this.mapRev++;
      }
      this.checkPois(f);
      this.trackRiver(f);
    }

    // Cave time.
    if (inCave) {
      this.facts.caveSeconds += dt;
      this.caveVisit += dt;
      if (this.caveVisit >= 15 && !this.caveCounted) { this.caveCounted = true; this.stats.cavesExplored++; this.toast('You explored a cave.', 'info'); }
    } else { this.caveVisit = 0; this.caveCounted = false; }

    this.slow += dt;
    if (this.slow >= 1) {
      this.slow = 0;
      this.observeAnimals(f);
      this.facts.minutesSurvived = this.stats.playSeconds / 60;
      this.evaluate();
      this.expireToasts();
      this.publish();
    }
    if (gp.survival.phase !== this.lastPhase) {
      if (gp.survival.phase === 'rescued') this.stats.rescues++;
      this.lastPhase = gp.survival.phase;
    }
    if (gp.survival.phase === 'ended') this.finish('failed', 'Expedition over', gp.survival.failReason + '.');
    else if (this.scenario?.timeLimitMin && this.stats.playSeconds > this.scenario.timeLimitMin * 60) {
      this.finish('failed', 'Out of time', `The ${this.scenario.timeLimitMin} minute window closed before you finished.`);
    }
  }

  private checkPois(f: { x: number; y: number; z: number }): void {
    const aw = skillLevel(this.gameplay.skills.awareness);
    const range = 70 + (aw - 1) * 15;
    for (const p of this.pois.all) {
      const d = Math.hypot(p.x - f.x, p.z - f.z);
      if (d < range && !this.exploration.discovered.has(p.id)) {
        this.exploration.discovered.add(p.id);
        this.stats.poisDiscovered++;
        this.gameplay.trickleXp('awareness', 3);
        this.toast(`Discovered: ${p.name}`, 'info');
        this.mapRev++;
      }
      const reachR = p.kind === 'summit' ? 18 : REACH_RADIUS;
      if (d < reachR && (p.kind !== 'summit' || f.y > p.y - 10)) {
        if (p.kind === 'extraction') {
          if (this.config.mode === 'story' && !this.facts.signalAtSummit) {
            if (this.clock - this.lastNotReady > 20) { this.lastNotReady = this.clock; this.gameplay.say('Rescuers do not know where you are yet. Raise a signal at the summit first.'); }
          } else this.facts.extractionReached = true;
        } else if (p.kind === 'summit') this.facts.summitReached = true;
        this.facts.reached[p.id] = true;
      }
    }
  }
  private lastNotReady = -100;

  private trackRiver(f: { x: number; z: number }): void {
    const r = this.terrain.sample(f.x, f.z).river;
    const sign = Math.sign(this.terrain.riverField(f.x, f.z)) || 1;
    if (r > 0.3 && this.riverEntry === null) this.riverEntry = sign;
    else if (r < 0.05 && this.riverEntry !== null) {
      if (sign !== this.riverEntry) {
        this.facts.riverCrossings++; this.stats.riverCrossings++;
        this.toast('You crossed the river.', 'info');
      }
      this.riverEntry = null;
    }
    void WATER_Y;
  }

  private observeAnimals(f: { x: number; z: number }): void {
    for (const a of this.gameplay.wildlife.animals) {
      if (a.species === 'fish' || this.observed.has(a.id)) continue;
      const d = Math.hypot(a.x - f.x, a.z - f.z);
      if (d > 8 && d < 45 && a.state !== 'flee') {
        this.observed.add(a.id);
        this.stats.animalsObserved++;
        this.gameplay.trickleXp('wildlife', 2);
      }
    }
  }

  private evaluate(): void {
    const done = this.tracker.update(this.facts);
    for (const m of done) {
      this.stats.missionsCompleted++;
      this.toast(`Mission complete: ${m.title}`, 'mission');
      if (m.reward) this.gameplay.grantXp(m.reward.skill, m.reward.xp);
      this.mapRev++;
    }
    if (done.length && !this.tracker.finished) this.gameplay.say('New mission: ' + this.tracker.current!.title);
    for (const a of this.achievements.update(this.stats, this.exploration.percent())) {
      this.toast(`Achievement: ${a.name}`, 'achievement');
      this.persistAchievements();
    }
    if (this.tracker.finished && this.tracker.defs.length > 0) {
      if (this.config.mode === 'story') {
        this.unlockFlag('story_complete');
        recordStory(this.records, this.stats.playSeconds);
        this.finish('victory', 'Extracted', 'A helicopter lifts you out of the wilderness. You made it.');
      } else if (this.scenario) {
        this.unlockFlag('expedition_complete');
        recordExpedition(this.records, this.scenario.id, this.stats.playSeconds);
        this.finish('victory', 'Expedition complete', `${this.scenario.name} finished.`);
      }
    }
  }

  private unlockFlag(flag: string): void {
    const a = this.achievements.unlockFlag(flag, this.stats.playSeconds);
    if (a) { this.toast(`Achievement: ${a.name}`, 'achievement'); this.persistAchievements(); }
  }

  private persistAchievements(): void {
    this.records.achievements = this.achievements.serialize();
    saveRecords(this.records);
  }

  private finish(kind: Outcome['kind'], title: string, text: string): void {
    if (this.outcome) return;
    if (this.config.mode === 'endless') {
      recordEndless(this.records, this.day);
      text += ` You lasted ${this.day} day${this.day === 1 ? '' : 's'}.`;
    }
    this.outcome = { kind, title, text };
    this.persistAchievements();
    this.publish();
  }

  /** Debug and test helper: mark every remaining mission fact as satisfied. */
  debugCompleteAll(): void {
    const f = this.facts;
    f.waterCollected = 1; f.shelters = 1; f.campfires = 1; f.nights = 1; f.riverCrossings = 1; f.caveSeconds = 20; f.campsitesLooted = 1;
    f.summitReached = true; f.signalAtSummit = true; f.extractionReached = true; f.minutesSurvived = 999;
    f.reached.cairn = true;
    this.evaluate();
  }

  // ---------- Persistence ----------
  snapshot(): SessionSnapshot {
    return {
      config: structuredClone(this.config),
      facts: structuredClone(this.facts),
      stats: { ...this.stats },
      exploration: this.exploration.serialize(),
      missions: this.tracker.serialize(),
      day: this.day,
      sawNight: this.sawNight,
      discoveredCaveVisit: this.caveCounted,
      looted: [...this.looted],
      tracked: this.tracked,
      spawn: { ...this.spawn },
      outcome: this.outcome,
    };
  }

  // ---------- UI ----------
  private expireToasts(): void {
    this.toasts = this.toasts.filter((t) => (this.toastUntil.get(t.id) ?? 0) > this.clock);
  }

  publish(): void {
    const cur = this.tracker.current;
    const total = this.tracker.defs.length;
    const gp = this.gameplay;
    sessionStore.setState({
      active: true,
      mode: this.config.mode,
      modeLabel: MODE_INFO[this.config.mode].label,
      scenarioName: this.scenario?.name ?? '',
      day: this.day,
      mission: cur ? { title: cur.title, description: cur.description, hint: cur.hint, progress: cur.progress?.(this.facts) ?? '', index: this.tracker.index + 1, total } : null,
      missionList: this.tracker.defs.map((d, i) => ({ id: d.id, title: d.title, description: d.description, state: i < this.tracker.index ? 'done' as const : i === this.tracker.index ? 'current' as const : 'todo' as const })),
      explorationPct: this.exploration.percent(),
      toasts: [...this.toasts],
      outcome: this.outcome,
      navAssist: this.navAssist,
      timeLeft: this.scenario?.timeLimitMin ? Math.max(0, this.scenario.timeLimitMin * 60 - this.stats.playSeconds) : null,
      stats: { ...this.stats },
      achievements: ACHIEVEMENTS.map((a) => ({ id: a.id, name: a.name, description: a.description, unlockedAt: this.achievements.unlocked.get(a.id) ?? null })),
      records: this.records,
      skillsXp: (Object.keys(SKILL_NAMES) as SkillId[]).map((id) => ({ id, name: SKILL_NAMES[id], level: skillLevel(gp.skills[id]), xp: Math.floor(gp.skills[id]) })),
      mapRev: this.mapRev,
      tracked: this.tracked,
    });
  }

  dispose(): void {
    this.offs.forEach((o) => o());
    this.offs = [];
    this.gameplay.hooks = null;
    this.gameplay.weatherLock = null;
    sessionStore.setState({ ...emptyView(loadRecords()) });
  }

  poiLabel(p: Poi): string { return POI_LABEL[p.kind]; }
}
