import { events } from '../core/events';
import { settingsStore, type Settings } from '../core/settings';
import { Store } from '../core/store';
import { STEP_PARAMS, type Surface } from './surface';

export interface Caption { id: number; text: string; until: number }
export const captionStore = new Store<{ captions: Caption[] }>({ captions: [] });

export interface AudioState {
  listener: { x: number; y: number; z: number; fx: number; fy: number; fz: number };
  wind: number;
  rain: number;
  /** Nearby river source: gain 0..1 and where it sounds from. */
  river: { gain: number; x: number; y: number; z: number } | null;
  waterfall: { gain: number; x: number; y: number; z: number } | null;
  night: boolean;
  inCave: boolean;
  underwater: boolean;
  stamina: number;
  sprinting: boolean;
  danger: number;
  fire: { x: number; y: number; z: number; dist: number } | null;
  /** Animals near enough to hear. */
  animals: { species: string; x: number; y: number; z: number; dist: number; state: string }[];
  biome: string;
}

type Mood = 'day' | 'night' | 'tense' | 'cave';
const SCALES: Record<Mood, { root: number; steps: number[] }> = {
  day: { root: 196, steps: [0, 2, 4, 7, 9, 12] },
  night: { root: 110, steps: [0, 3, 5, 7, 10, 12] },
  tense: { root: 82.4, steps: [0, 1, 5, 6, 8] },
  cave: { root: 65.4, steps: [0, 5, 7, 12] },
};

/** Procedural Web Audio: layered ambience, positional sources, one-shots and generative music. */
export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private busMusic!: GainNode;
  private busAmb!: GainNode;
  private busSfx!: GainNode;
  private noise!: AudioBuffer;
  private wind!: { gain: GainNode; filter: BiquadFilterNode };
  private rain!: GainNode;
  private river!: { gain: GainNode; panner: PannerNode };
  private fall!: { gain: GainNode; panner: PannerNode };
  private crickets!: GainNode;
  private pad!: { a: OscillatorNode; b: OscillatorNode; gain: GainNode };
  private delayIn!: GainNode;
  private mood: Mood = 'day';
  private noteTimer = 3;
  private breathTimer = 0;
  private crackleTimer = 0;
  private birdTimer = 4;
  private wolfTimer = 25;
  private captionId = 1;
  private offs: (() => void)[] = [];
  private lastState: AudioState | null = null;
  private listenerSet = false;

  constructor() {
    this.offs.push(
      events.on('thunder', (e) => this.thunder(e.delay)),
      events.on('animalCall', (e) => this.animalCall(e.species, e.x, e.y, e.z, e.kind)),
      events.on('playerLanded', (e) => { if (e.speed > 6) this.thud(Math.min(1, e.speed / 18)); }),
      events.on('signalRaised', () => this.caption('[A flare hisses and smoke rises]')),
      events.on('built', () => this.tone(220, 0.15, 'triangle', 0.15)),
      events.on('crafted', () => this.tone(330, 0.12, 'triangle', 0.12)),
      events.on('gathered', () => this.burst({ type: 'bandpass', freq: 3000, q: 1, dur: 0.12, gain: 0.25 })),
    );
  }

  /** Create or resume the context. Must be called from a user gesture. */
  unlock(): void {
    if (typeof AudioContext === 'undefined') return;
    if (!this.ctx) this.build();
    void this.ctx?.resume();
  }

  setActive(on: boolean): void {
    if (!this.ctx) return;
    if (on) void this.ctx.resume(); else void this.ctx.suspend();
  }

  private build(): void {
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    this.busMusic = ctx.createGain(); this.busAmb = ctx.createGain(); this.busSfx = ctx.createGain();
    for (const b of [this.busMusic, this.busAmb, this.busSfx]) b.connect(this.master);
    this.applyVolumes(settingsStore.getState());

    // 2 s of white noise, shared by every layer.
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    const loop = (): AudioBufferSourceNode => {
      const s = ctx.createBufferSource();
      s.buffer = this.noise; s.loop = true; s.start(0, Math.random());
      return s;
    };
    const gain = (v: number) => { const g = ctx.createGain(); g.gain.value = v; return g; };

    // Wind
    const wf = ctx.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = 450; wf.Q.value = 0.5;
    const wg = gain(0);
    loop().connect(wf); wf.connect(wg); wg.connect(this.busAmb);
    this.wind = { gain: wg, filter: wf };
    // Rain
    const rf = ctx.createBiquadFilter(); rf.type = 'highpass'; rf.frequency.value = 1500;
    const rl = ctx.createBiquadFilter(); rl.type = 'lowpass'; rl.frequency.value = 9000;
    this.rain = gain(0);
    loop().connect(rf); rf.connect(rl); rl.connect(this.rain); this.rain.connect(this.busAmb);
    // River and waterfall (positional)
    const mkWater = (freq: number, q: number, type: BiquadFilterType) => {
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = gain(0);
      const p = this.makePanner(0, 0, 0);
      p.refDistance = 8; p.rolloffFactor = 1.1;
      loop().connect(f); f.connect(g); g.connect(p); p.connect(this.busAmb);
      return { gain: g, panner: p };
    };
    this.river = mkWater(750, 0.7, 'bandpass');
    this.fall = mkWater(1800, 0.3, 'lowpass');
    // Crickets at night
    const co = ctx.createOscillator(); co.frequency.value = 4300;
    const am = ctx.createOscillator(); am.type = 'square'; am.frequency.value = 13;
    const amg = gain(0.5);
    this.crickets = gain(0);
    const cg = gain(0.5);
    am.connect(amg); amg.connect(cg.gain); co.connect(cg); cg.connect(this.crickets); this.crickets.connect(this.busAmb);
    co.start(); am.start();
    // Music pad and delay send
    const delay = ctx.createDelay(1); delay.delayTime.value = 0.42;
    const fb = gain(0.38);
    this.delayIn = gain(0.6);
    this.delayIn.connect(delay); delay.connect(fb); fb.connect(delay); delay.connect(this.busMusic);
    const pg = gain(0.0);
    const pf = ctx.createBiquadFilter(); pf.type = 'lowpass'; pf.frequency.value = 500;
    const a = ctx.createOscillator(); a.type = 'sawtooth'; a.frequency.value = 98;
    const b = ctx.createOscillator(); b.type = 'sawtooth'; b.frequency.value = 98.7;
    a.connect(pf); b.connect(pf); pf.connect(pg); pg.connect(this.busMusic);
    a.start(); b.start();
    this.pad = { a, b, gain: pg };
    pg.gain.setTargetAtTime(0.05, ctx.currentTime, 4);
  }

  applyVolumes(s: Settings): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(s.masterVolume, t, 0.05);
    this.busMusic.gain.setTargetAtTime(s.musicVolume, t, 0.05);
    this.busAmb.gain.setTargetAtTime(s.ambienceVolume, t, 0.05);
    this.busSfx.gain.setTargetAtTime(s.sfxVolume, t, 0.05);
  }

  private makePanner(x: number, y: number, z: number): PannerNode {
    const p = this.ctx!.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = 4;
    p.maxDistance = 400;
    p.rolloffFactor = 1.3;
    this.setPos(p, x, y, z);
    return p;
  }

  private setPos(p: PannerNode, x: number, y: number, z: number): void {
    if (p.positionX) {
      const t = this.ctx!.currentTime;
      p.positionX.setValueAtTime(x, t); p.positionY.setValueAtTime(y, t); p.positionZ.setValueAtTime(z, t);
    } else (p as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(x, y, z);
  }

  caption(text: string): void {
    if (!settingsStore.getState().subtitles) return;
    const now = performance.now();
    const list = captionStore.getState().captions.filter((c) => c.until > now);
    if (list.some((c) => c.text === text)) return;
    list.push({ id: this.captionId++, text, until: now + 3500 });
    captionStore.setState({ captions: list.slice(-4) });
  }

  // ---------- Frame update ----------
  update(dt: number, st: AudioState): void {
    this.lastState = st;
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const l = st.listener;
    const L = ctx.listener;
    if (L.positionX) {
      L.positionX.setValueAtTime(l.x, t); L.positionY.setValueAtTime(l.y, t); L.positionZ.setValueAtTime(l.z, t);
      L.forwardX.setValueAtTime(l.fx, t); L.forwardY.setValueAtTime(l.fy, t); L.forwardZ.setValueAtTime(l.fz, t);
      L.upX.setValueAtTime(0, t); L.upY.setValueAtTime(1, t); L.upZ.setValueAtTime(0, t);
    } else {
      const old = L as unknown as { setPosition(x: number, y: number, z: number): void; setOrientation(a: number, b: number, c: number, d: number, e: number, f: number): void };
      old.setPosition(l.x, l.y, l.z);
      old.setOrientation(l.fx, l.fy, l.fz, 0, 1, 0);
    }
    this.listenerSet = true;

    const muffle = st.underwater ? 0.25 : 1;
    this.wind.gain.gain.setTargetAtTime((st.inCave ? 0.02 : 0.03 + st.wind * 0.35) * muffle, t, 0.4);
    this.wind.filter.frequency.setTargetAtTime(300 + st.wind * 900, t, 0.5);
    this.rain.gain.setTargetAtTime((st.inCave ? st.rain * 0.05 : st.rain * 0.4) * muffle, t, 0.5);
    if (st.river && !st.inCave) {
      this.setPos(this.river.panner, st.river.x, st.river.y, st.river.z);
      this.river.gain.gain.setTargetAtTime(st.river.gain * 0.55, t, 0.3);
    } else this.river.gain.gain.setTargetAtTime(0, t, 0.3);
    if (st.waterfall && !st.inCave) {
      this.setPos(this.fall.panner, st.waterfall.x, st.waterfall.y, st.waterfall.z);
      this.fall.gain.gain.setTargetAtTime(st.waterfall.gain * 0.9, t, 0.3);
    } else this.fall.gain.gain.setTargetAtTime(0, t, 0.3);
    this.crickets.gain.setTargetAtTime(st.night && !st.inCave && st.biome !== 'snow' && st.rain < 0.3 ? 0.012 : 0, t, 1);

    // Mood and music
    const mood: Mood = st.inCave ? 'cave' : st.danger > 0 ? 'tense' : st.night ? 'night' : 'day';
    if (mood !== this.mood) {
      this.mood = mood;
      const root = SCALES[mood].root;
      this.pad.a.frequency.setTargetAtTime(root / 2, t, 1.5);
      this.pad.b.frequency.setTargetAtTime(root / 2 * 1.006, t, 1.5);
    }
    this.noteTimer -= dt;
    if (this.noteTimer <= 0) {
      this.noteTimer = (mood === 'tense' ? 2.2 : 3.5) + Math.random() * 4;
      this.playNote(mood);
    }

    // Breathing
    this.breathTimer -= dt;
    if ((st.stamina < 30 || st.sprinting) && this.breathTimer <= 0 && !st.underwater) {
      this.breathTimer = st.stamina < 15 ? 1.1 : 1.8;
      this.burst({ type: 'bandpass', freq: 900, q: 0.8, dur: 0.5, gain: st.stamina < 15 ? 0.3 : 0.15, attack: 0.18 });
      if (st.stamina < 15) this.caption('[Heavy breathing]');
    }

    // Campfire crackle (positional)
    this.crackleTimer -= dt;
    if (st.fire && st.fire.dist < 30 && this.crackleTimer <= 0) {
      this.crackleTimer = 0.08 + Math.random() * 0.4;
      this.burst({ type: 'highpass', freq: 2500 + Math.random() * 3000, q: 0.7, dur: 0.02 + Math.random() * 0.04, gain: 0.35 }, st.fire);
      if (Math.random() < 0.04) this.caption('[Campfire crackles]');
    }

    // Ambient wildlife calls
    this.birdTimer -= dt;
    if (this.birdTimer <= 0) {
      this.birdTimer = 4 + Math.random() * 9;
      const bird = !st.night && !st.inCave && st.rain < 0.5 ? st.animals.find((a) => a.species === 'bird' && a.dist < 70) : undefined;
      if (bird) this.animalCall('bird', bird.x, bird.y, bird.z, 'warn');
    }
    this.wolfTimer -= dt;
    if (this.wolfTimer <= 0) {
      this.wolfTimer = 25 + Math.random() * 30;
      const wolf = st.night && !st.inCave ? st.animals.find((a) => a.species === 'wolf') : undefined;
      if (wolf) this.animalCall('wolf', wolf.x, wolf.y, wolf.z, 'warn');
    }
  }

  private playNote(mood: Mood): void {
    const ctx = this.ctx!;
    const sc = SCALES[mood];
    const step = sc.steps[Math.floor(Math.random() * sc.steps.length)];
    const f = sc.root * 2 ** (step / 12) * (Math.random() < 0.3 ? 2 : 1);
    const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = mood === 'day' ? 'triangle' : 'sine'; o.frequency.value = f;
    const g = ctx.createGain();
    const peak = mood === 'tense' ? 0.09 : 0.12;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.9);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 5);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = mood === 'day' ? 1800 : 900;
    o.connect(lp); lp.connect(g); g.connect(this.busMusic); g.connect(this.delayIn);
    o.start(t); o.stop(t + 5.2);
  }

  // ---------- One-shots ----------
  private burst(p: { type: BiquadFilterType; freq: number; q: number; dur: number; gain: number; attack?: number }, at?: { x: number; y: number; z: number }): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = p.type; f.frequency.value = p.freq; f.Q.value = p.q;
    const g = ctx.createGain();
    const a = p.attack ?? 0.005;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(p.gain, t + a);
    g.gain.exponentialRampToValueAtTime(0.0005, t + a + p.dur);
    src.connect(f); f.connect(g);
    if (at) { const pn = this.makePanner(at.x, at.y, at.z); g.connect(pn); pn.connect(this.busSfx); } else g.connect(this.busSfx);
    src.start(t, Math.random() * 1.5, a + p.dur + 0.05);
  }

  private tone(freq: number, dur: number, type: OscillatorType, gain: number, at?: { x: number; y: number; z: number }, glideTo?: number): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + Math.min(0.03, dur / 3)); g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    o.connect(g);
    if (at) { const pn = this.makePanner(at.x, at.y, at.z); g.connect(pn); pn.connect(this.busSfx); } else g.connect(this.busSfx);
    o.start(t); o.stop(t + dur + 0.05);
  }

  footstep(surface: Surface, sprinting: boolean, crouching: boolean): void {
    const p = STEP_PARAMS[surface];
    const k = crouching ? 0.45 : sprinting ? 1.3 : 1;
    this.burst({ ...p, gain: p.gain * k * (0.85 + Math.random() * 0.3), freq: p.freq * (0.9 + Math.random() * 0.2) });
  }

  splash(): void {
    this.burst({ type: 'bandpass', freq: 1200, q: 0.6, dur: 0.35, gain: 0.5, attack: 0.02 });
    this.caption('[Splashing]');
  }

  swimStroke(): void {
    this.burst({ type: 'lowpass', freq: 700, q: 0.8, dur: 0.4, gain: 0.35, attack: 0.08 });
  }

  private thud(k: number): void {
    this.burst({ type: 'lowpass', freq: 300, q: 1, dur: 0.25, gain: 0.7 * k });
  }

  thunder(delay: number): void {
    const ctx = this.ctx;
    if (!ctx) { this.caption('[Thunder rumbles]'); return; }
    window.setTimeout(() => {
      this.caption('[Thunder rumbles]');
      this.burst({ type: 'lowpass', freq: 160, q: 0.8, dur: 3.2, gain: 1, attack: 0.25 });
      this.burst({ type: 'lowpass', freq: 90, q: 0.8, dur: 4.5, gain: 0.8, attack: 0.5 });
    }, Math.min(delay, 6) * 1000);
  }

  animalCall(species: string, x: number, y: number, z: number, kind: 'warn' | 'strike'): void {
    const at = { x, y: y + 1, z };
    switch (species) {
      case 'bird':
        for (let i = 0; i < 3; i++) window.setTimeout(() => this.tone(2600 + Math.random() * 1500, 0.12, 'sine', 0.12, at, 3600 + Math.random() * 800), i * 140);
        this.caption('[Birdsong]');
        break;
      case 'wolf':
        if (kind === 'warn' && this.lastState?.danger) { this.burst({ type: 'lowpass', freq: 350, q: 1, dur: 0.9, gain: 0.5, attack: 0.1 }, at); this.caption('[A wolf growls]'); }
        else { this.tone(300, 2.4, 'sawtooth', 0.12, at, 520); window.setTimeout(() => this.tone(520, 1.6, 'sawtooth', 0.1, at, 360), 1200); this.caption('[A wolf howls in the distance]'); }
        break;
      case 'bear':
        this.burst({ type: 'lowpass', freq: 250, q: 1.5, dur: 1.2, gain: 0.8, attack: 0.15 }, at);
        this.caption('[A bear growls]');
        break;
      case 'snake':
        this.burst({ type: 'highpass', freq: 4500, q: 0.6, dur: 1.0, gain: 0.4, attack: 0.1 }, at);
        this.caption('[A snake hisses]');
        break;
      case 'deer':
        this.burst({ type: 'bandpass', freq: 700, q: 1, dur: 0.3, gain: 0.5 }, at);
        this.caption('[A deer snorts]');
        break;
      default:
        this.burst({ type: 'bandpass', freq: 1000, q: 1, dur: 0.15, gain: 0.3 }, at);
    }
  }

  get running(): boolean { return this.ctx?.state === 'running'; }
  get positional(): boolean { return this.listenerSet; }

  dispose(): void {
    this.offs.forEach((o) => o());
    this.offs = [];
    void this.ctx?.close();
    this.ctx = null;
  }
}
