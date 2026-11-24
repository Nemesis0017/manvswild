import { clamp } from '../world/rng';
import type { DifficultyMods } from './difficulty';

export interface Injuries {
  /** Seconds remaining. Sprain slows movement. */
  sprain: number;
  /** Seconds remaining. Strain slows stamina recovery. */
  strain: number;
  /** Seconds remaining. Sickness (from untreated water) drains hunger and thirst faster. */
  sickness: number;
}

export type Phase = 'alive' | 'fading' | 'rescued' | 'ended';

export interface SurvivalState {
  health: number; // 0..100
  hunger: number; // 100 = full
  thirst: number; // 100 = hydrated
  stamina: number; // 0..100
  exhausted: boolean; // stamina hit zero, recovers above EXHAUST_RECOVER
  bodyTemp: number; // deg C, 37 is normal
  fatigue: number; // 0..100, 100 = desperately tired
  wetness: number; // 0..100
  injuries: Injuries;
  phase: Phase;
  /** 0..1 black overlay for the failure state. */
  fade: number;
  failReason: string;
  rescuesUsed: number;
}

export interface SurvivalEnv {
  /** Air temperature in deg C before shelter and fire. */
  ambient: number;
  /** Extra effective degrees from fire/torch. */
  warmth: number;
  /** Under a shelter: blocks rain and wind, shades sun. */
  sheltered: boolean;
  /** 0..1 */
  precipitation: number;
  /** 0..1 */
  wind: number;
  /** Clothing insulation 0..1 (jacket about 0.5). */
  insulation: number;
  /** Clothing rain protection 0..1. */
  rainProof: number;
  swimming: boolean;
  /** Seconds-scale activity. */
  moving: boolean;
  sprinting: boolean;
  crouching: boolean;
  climbing: boolean;
  resting: boolean;
  /** Carrying a raft that reduces swim effort. */
  onRaft: boolean;
  /** 0..1 */
  encumbrance: number;
}

export const EXHAUST_RECOVER = 25;
export const NORMAL_TEMP = 37;
export const MIN_TEMP = 24;
export const MAX_TEMP = 42;

export function createSurvival(): SurvivalState {
  return {
    health: 100, hunger: 85, thirst: 85, stamina: 100, exhausted: false, bodyTemp: NORMAL_TEMP,
    fatigue: 10, wetness: 0, injuries: { sprain: 0, strain: 0, sickness: 0 },
    phase: 'alive', fade: 0, failReason: '', rescuesUsed: 0,
  };
}

export const defaultEnv = (): SurvivalEnv => ({
  ambient: 20, warmth: 0, sheltered: false, precipitation: 0, wind: 0, insulation: 0, rainProof: 0,
  swimming: false, moving: false, sprinting: false, crouching: false, climbing: false, resting: false,
  onRaft: false, encumbrance: 0,
});

/** Temperature the body drifts toward given the environment. 20C effective gives 37C. */
export function equilibriumTemp(env: SurvivalEnv, wetness: number): number {
  const wet = wetness / 100;
  let eff = env.ambient + env.warmth + env.insulation * 12;
  // Wind chill and wet skin only matter when it is cool; shelter blocks wind.
  const windChill = env.sheltered ? 0 : env.wind * 6;
  if (eff < 25) eff -= windChill + wet * 10;
  // Wet skin evaporates heat in hot weather too (relief).
  else eff -= wet * 4;
  if (env.sheltered) eff += eff < 20 ? 3 : -3;
  if (env.swimming) eff = Math.min(eff, 14 + env.warmth);
  const raw = NORMAL_TEMP + (eff - 20) * 0.22;
  return clamp(raw, MIN_TEMP, MAX_TEMP);
}

/** Speed multiplier from slippery ground (wet, rain, slopes). 1 is full grip. */
export function slipperyFactor(wetness: number, precipitation: number, slope: number, icy: boolean): number {
  const wetGround = clamp(precipitation, 0, 1) * 0.5 + (icy ? 0.5 : 0) + (wetness / 100) * 0.1;
  const slopeF = clamp((slope - 0.4) / 0.8, 0, 1);
  return clamp(1 - wetGround * (0.1 + 0.3 * slopeF), 0.6, 1);
}

/** Health damage for landing at a downward speed (m/s). Safe below 12 m/s. */
export function fallDamage(speed: number, mods: DifficultyMods): number {
  if (speed < 12) return 0;
  return (speed - 12) * 4.5 * mods.damage;
}

export interface TickResult {
  /** Short messages for the HUD log. */
  warnings: string[];
  damage: number;
}

export function movementMultiplier(s: SurvivalState, encumbrance: number): number {
  let m = 1;
  if (s.injuries.sprain > 0) m *= 0.7;
  if (s.exhausted) m *= 0.65;
  if (s.fatigue > 85) m *= 0.85;
  if (s.bodyTemp < 33) m *= 0.8;
  m *= 1 - clamp(encumbrance - 0.8, 0, 0.4) * 0.8;
  return m;
}

export function addInjury(s: SurvivalState, kind: keyof Injuries, seconds: number, mods: DifficultyMods): void {
  s.injuries[kind] = Math.max(s.injuries[kind], seconds * mods.injury);
}

export function applyDamage(s: SurvivalState, amount: number): void {
  if (s.phase !== 'alive') return;
  s.health = clamp(s.health - amount, 0, 100);
  if (s.health <= 0) beginFailure(s, failureReason(s));
}

/** Advance the survival simulation by dt seconds. Mutates and returns warnings. */
export function tickSurvival(s: SurvivalState, env: SurvivalEnv, dt: number, mods: DifficultyMods): TickResult {
  const res: TickResult = { warnings: [], damage: 0 };
  if (s.phase !== 'alive') return res;
  const before = s.health;
  const inj = s.injuries;
  const sick = inj.sickness > 0 ? 1.6 : 1;
  const heatStress = s.bodyTemp > 38.5 ? 1 + (s.bodyTemp - 38.5) * 0.8 : 1;
  const rest = env.resting ? 0.4 : 1;

  // Hunger and thirst
  const activity = 1 + (env.sprinting ? 1.2 : env.moving ? 0.35 : 0) + (env.climbing ? 0.8 : 0) + (env.swimming ? 0.8 : 0);
  s.hunger = clamp(s.hunger - (100 / 1500) * activity * mods.drain * sick * rest * dt, 0, 100);
  s.thirst = clamp(s.thirst - (100 / 900) * activity * mods.drain * sick * heatStress * rest * dt, 0, 100);

  // Wetness
  const rainWet = env.sheltered ? 0 : env.precipitation * (1 - env.rainProof) * (100 / 70);
  const swimWet = env.swimming ? 100 / 4 : 0;
  const warmDry = 1 + Math.max(0, env.warmth) * 0.25 + Math.max(0, env.ambient - 20) * 0.05;
  const dry = (100 / 240) * warmDry;
  s.wetness = clamp(s.wetness + (rainWet + swimWet - (rainWet > 0 || swimWet > 0 ? 0 : dry)) * dt, 0, 100);

  // Body temperature
  const target = equilibriumTemp(env, s.wetness);
  const k = (1 / 90) * mods.drain;
  const rate = env.warmth > 0 && target > s.bodyTemp ? k * 2 : k;
  s.bodyTemp += (target - s.bodyTemp) * clamp(rate * dt, 0, 1);

  // Fatigue
  if (env.resting) s.fatigue = clamp(s.fatigue - (100 / 90) * dt, 0, 100);
  else s.fatigue = clamp(s.fatigue + (100 / 2400) * activity * mods.drain * dt, 0, 100);

  // Stamina
  let staminaDelta: number;
  if (env.sprinting) staminaDelta = -16;
  else if (env.climbing) staminaDelta = -9;
  else if (env.swimming) staminaDelta = env.onRaft ? -0.5 : -5 - (s.bodyTemp < 35 ? 3 : 0);
  else if (env.moving) staminaDelta = 7;
  else staminaDelta = 15;
  if (staminaDelta > 0) {
    let regen = 1;
    if (inj.strain > 0) regen *= 0.5;
    if (s.fatigue > 80) regen *= 0.6;
    if (s.hunger < 15 || s.thirst < 15) regen *= 0.5;
    if (s.bodyTemp > 39) regen *= 0.6;
    staminaDelta *= regen;
  } else {
    staminaDelta *= 1 + clamp(env.encumbrance - 0.8, 0, 0.4);
  }
  s.stamina = clamp(s.stamina + staminaDelta * dt, 0, 100);
  if (s.stamina <= 0 && !s.exhausted) { s.exhausted = true; res.warnings.push('You are exhausted. Catch your breath.'); }
  if (s.exhausted && s.stamina >= EXHAUST_RECOVER) s.exhausted = false;

  // Injuries decay
  inj.sprain = Math.max(0, inj.sprain - dt);
  inj.strain = Math.max(0, inj.strain - dt);
  inj.sickness = Math.max(0, inj.sickness - dt);

  // Damage from hazards, in health per second
  let dps = 0;
  if (s.thirst <= 0) { dps += 0.7; res.warnings.push('Dehydration is hurting you.'); }
  if (s.hunger <= 0) dps += 0.3;
  if (s.bodyTemp < 33) { dps += 0.25 + (33 - s.bodyTemp) * 0.15; res.warnings.push('Hypothermia. Warm up near a fire.'); }
  else if (s.bodyTemp < 35 && s.bodyTemp >= 33) res.warnings.push('You are shivering.');
  if (s.bodyTemp > 40) { dps += 0.35 + (s.bodyTemp - 40) * 0.3; res.warnings.push('Heat exhaustion. Find shade and water.'); }
  else if (s.bodyTemp > 38.5) res.warnings.push('You are overheating.');
  if (s.fatigue >= 100) dps += 0.1;
  dps *= mods.damage;

  const wellFed = s.hunger > 30 && s.thirst > 30 && s.bodyTemp > 35 && s.bodyTemp < 39;
  const regen = wellFed ? (env.resting ? 1.6 : 0.35) * (2 - Math.min(mods.damage, 1.5)) : 0;
  s.health = clamp(s.health + (regen - dps) * dt, 0, 100);

  res.damage = Math.max(0, before - s.health);
  if (s.health <= 0 && s.phase === 'alive') beginFailure(s, failureReason(s));
  return res;
}

export function failureReason(s: SurvivalState): string {
  if (s.thirst <= 0) return 'Severe dehydration';
  if (s.bodyTemp < 33) return 'Hypothermia';
  if (s.bodyTemp > 40) return 'Heat exhaustion';
  if (s.hunger <= 0) return 'Exhaustion from hunger';
  return 'Injury and exhaustion';
}

export function beginFailure(s: SurvivalState, reason: string): void {
  s.phase = 'fading';
  s.failReason = reason;
  s.health = 0;
}

/** Called each frame while fading; becomes rescued or ended when fully black. */
export function tickFailure(s: SurvivalState, dt: number, mods: DifficultyMods): void {
  if (s.phase !== 'fading') return;
  s.fade = clamp(s.fade + dt / 3, 0, 1);
  if (s.fade >= 1) s.phase = s.rescuesUsed < mods.rescues ? 'rescued' : 'ended';
}

/** The rescue team stabilises the player; returns false if the run has ended. */
export function acceptRescue(s: SurvivalState): boolean {
  if (s.phase !== 'rescued') return false;
  s.rescuesUsed += 1;
  Object.assign(s, {
    health: 45, hunger: Math.max(s.hunger, 50), thirst: 65, stamina: 100, exhausted: false,
    bodyTemp: NORMAL_TEMP, fatigue: 40, wetness: 0, phase: 'alive', fade: 0, failReason: '',
  });
  s.injuries = { sprain: 0, strain: 0, sickness: 0 };
  return true;
}

export function hudWarnings(s: SurvivalState): string[] {
  const w: string[] = [];
  if (s.thirst < 20) w.push('Thirsty');
  if (s.hunger < 20) w.push('Hungry');
  if (s.bodyTemp < 35) w.push('Cold');
  if (s.bodyTemp > 38.5) w.push('Overheating');
  if (s.fatigue > 80) w.push('Tired');
  if (s.exhausted) w.push('Out of breath');
  if (s.wetness > 60) w.push('Soaked');
  if (s.injuries.sprain > 0) w.push('Sprain');
  if (s.injuries.strain > 0) w.push('Strain');
  if (s.injuries.sickness > 0) w.push('Queasy');
  return w;
}
