import * as THREE from 'three';
import { hashInts, mulberry32 } from '../world/rng';
import { CHUNK_SIZE, WATER_Y, type Terrain } from '../world/terrain';
import {
  SPECIES, advanceAnimal, spawnForChunk, stepAnimal,
  type AIEvents, type Animal, type Noise, type Perception, type Species,
} from './ai';

interface Rig {
  root: THREE.Group;
  legs: THREE.Object3D[];
  wings: THREE.Object3D[];
  head?: THREE.Object3D;
  segments: THREE.Object3D[];
  tail?: THREE.Object3D;
  scale: number;
}

const mats = new Map<number, THREE.MeshLambertMaterial>();
const mat = (c: number) => {
  let m = mats.get(c);
  if (!m) mats.set(c, (m = new THREE.MeshLambertMaterial({ color: c })));
  return m;
};
const boxG = new THREE.BoxGeometry(1, 1, 1);
const sphG = new THREE.SphereGeometry(0.5, 8, 6);
const coneG = new THREE.ConeGeometry(0.5, 1, 6);

function part(g: THREE.BufferGeometry, color: number, sx: number, sy: number, sz: number, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(g, mat(color));
  m.scale.set(sx, sy, sz);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

/** Low-poly procedural animal facing +Z. Shared geometry and materials; no blood or gore. */
export function buildAnimal(species: Species): Rig {
  const root = new THREE.Group();
  const rig: Rig = { root, legs: [], wings: [], segments: [], scale: 1 };
  const quad = (len: number, h: number, w: number, legL: number, body: number, head: number, headSize: number, legW = 0.12) => {
    const b = part(sphG, body, w, h, len, 0, legL + h * 0.5, 0);
    root.add(b);
    const hg = new THREE.Group();
    hg.position.set(0, legL + h * 0.8, len * 0.5);
    hg.add(part(sphG, head, headSize, headSize, headSize * 1.2, 0, 0, headSize * 0.5));
    root.add(hg);
    rig.head = hg;
    for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]] as const) {
      const lg = new THREE.Group();
      lg.position.set(sx * w * 0.32, legL, sz * len * 0.3);
      const leg = part(boxG, body, legW, legL, legW, 0, -legL * 0.5, 0);
      lg.add(leg);
      root.add(lg);
      rig.legs.push(lg);
    }
  };
  switch (species) {
    case 'deer': {
      quad(1.3, 0.55, 0.5, 0.85, 0x9a6a3c, 0x8a5c32, 0.28);
      const t = part(boxG, 0xf0e6d0, 0.1, 0.12, 0.1, 0, 1.3, -0.7);
      root.add(t);
      for (const sx of [-1, 1]) {
        const ant = part(boxG, 0xd8caa8, 0.04, 0.4, 0.04, sx * 0.1, 0.3, 0.1);
        ant.rotation.z = -sx * 0.4;
        rig.head!.add(ant);
        const ear = part(coneG, 0x8a5c32, 0.08, 0.2, 0.05, sx * 0.17, 0.12, 0);
        ear.rotation.z = -sx * 0.9;
        rig.head!.add(ear);
      }
      break;
    }
    case 'rabbit': {
      quad(0.4, 0.22, 0.2, 0.12, 0xb8a58a, 0xa8957a, 0.14, 0.05);
      for (const sx of [-1, 1]) rig.head!.add(part(boxG, 0xb8a58a, 0.04, 0.2, 0.03, sx * 0.04, 0.18, 0));
      root.add(part(sphG, 0xffffff, 0.08, 0.08, 0.08, 0, 0.25, -0.25));
      break;
    }
    case 'wolf': {
      quad(1.0, 0.38, 0.3, 0.55, 0x77777a, 0x6a6a6e, 0.22, 0.1);
      rig.head!.add(part(boxG, 0x55555a, 0.1, 0.1, 0.22, 0, -0.03, 0.22));
      for (const sx of [-1, 1]) rig.head!.add(part(coneG, 0x55555a, 0.07, 0.14, 0.05, sx * 0.08, 0.17, 0));
      const tail = part(boxG, 0x77777a, 0.1, 0.1, 0.5, 0, 0.7, -0.65);
      tail.rotation.x = 0.5;
      root.add(tail);
      rig.tail = tail;
      break;
    }
    case 'bear': {
      quad(1.6, 0.75, 0.8, 0.6, 0x4a3524, 0x40301f, 0.38, 0.22);
      rig.head!.add(part(boxG, 0x70563d, 0.2, 0.15, 0.22, 0, -0.08, 0.3));
      for (const sx of [-1, 1]) rig.head!.add(part(sphG, 0x40301f, 0.12, 0.12, 0.08, sx * 0.15, 0.2, 0));
      break;
    }
    case 'snake': {
      for (let i = 0; i < 9; i++) {
        const seg = part(sphG, i === 0 ? 0x4c6a2c : i % 2 ? 0x6a8a3a : 0x3e5a24, 0.1, 0.09, 0.18, 0, 0.05, -i * 0.15);
        root.add(seg);
        rig.segments.push(seg);
      }
      break;
    }
    case 'bird': {
      root.add(part(sphG, 0x4a6a9a, 0.16, 0.14, 0.3, 0, 0.1, 0));
      root.add(part(sphG, 0x3a557f, 0.1, 0.1, 0.1, 0, 0.17, 0.17));
      root.add(part(coneG, 0xe0a030, 0.04, 0.09, 0.04, 0, 0.17, 0.25)).children[2].rotation.x = Math.PI / 2;
      for (const sx of [-1, 1]) {
        const wg = new THREE.Group();
        wg.position.set(sx * 0.1, 0.14, 0);
        wg.add(part(boxG, 0x3a557f, 0.4, 0.02, 0.2, sx * 0.2, 0, 0));
        root.add(wg);
        rig.wings.push(wg);
      }
      root.add(part(boxG, 0x3a557f, 0.08, 0.02, 0.2, 0, 0.1, -0.3));
      break;
    }
    case 'fish': {
      root.add(part(sphG, 0xc8d6e0, 0.14, 0.18, 0.5, 0, 0, 0));
      const tail = new THREE.Group();
      tail.position.z = -0.25;
      tail.add(part(coneG, 0x8aa0b0, 0.02, 0.2, 0.14, 0, 0, -0.1)).children[0].rotation.x = -Math.PI / 2;
      root.add(tail);
      rig.tail = tail;
      break;
    }
  }
  return rig;
}

/** Streams in animals around the player, runs their AI and animates their models. */
export class WildlifeManager {
  readonly group = new THREE.Group();
  private chunks = new Map<string, Animal[]>();
  private rigs = new Map<number, Rig>();
  private rng: () => number;
  private time = 0;
  /** Recent noises, cleared after each AI step. */
  private pending: Noise[] = [];
  /** Nearest animal info for the HUD. */
  nearest: { name: string; state: string; dist: number } | null = null;

  constructor(private terrain: Terrain, private seed: number, private radiusChunks = 2) {
    this.rng = mulberry32(hashInts(seed, 7, 7));
  }

  addNoise(x: number, z: number, loudness: number): void {
    this.pending.push({ x, z, loudness });
  }

  get animals(): Animal[] {
    const all: Animal[] = [];
    for (const list of this.chunks.values()) all.push(...list);
    return all;
  }

  private canStand = (a: Animal) => (x: number, z: number): boolean => {
    const h = this.terrain.heightAt(x, z);
    const def = SPECIES[a.species];
    if (def.aquatic) return h < WATER_Y - 1.0;
    if (def.flying) return true;
    return h > WATER_Y + 0.3 && this.terrain.slopeAt(x, z, 1) < 1.1;
  };

  private ensureChunks(px: number, pz: number): void {
    const pcx = Math.floor(px / CHUNK_SIZE), pcz = Math.floor(pz / CHUNK_SIZE);
    const want = new Set<string>();
    for (let dx = -this.radiusChunks; dx <= this.radiusChunks; dx++) {
      for (let dz = -this.radiusChunks; dz <= this.radiusChunks; dz++) {
        const key = `${pcx + dx},${pcz + dz}`;
        want.add(key);
        if (!this.chunks.has(key)) {
          const list = spawnForChunk(this.terrain, this.seed, pcx + dx, pcz + dz);
          // Do not spawn right on top of the player.
          const kept = list.filter((a) => Math.hypot(a.x - px, a.z - pz) > 18);
          this.chunks.set(key, kept);
          for (const a of kept) this.addRig(a);
        }
      }
    }
    for (const [key, list] of this.chunks) {
      if (want.has(key)) continue;
      for (const a of list) this.removeRig(a);
      this.chunks.delete(key);
    }
  }

  private addRig(a: Animal): void {
    const rig = buildAnimal(a.species);
    this.rigs.set(a.id, rig);
    this.group.add(rig.root);
    rig.root.position.set(a.x, a.y, a.z);
  }

  private removeRig(a: Animal): void {
    const rig = this.rigs.get(a.id);
    if (rig) this.group.remove(rig.root);
    this.rigs.delete(a.id);
  }

  /** Step all AI and apply movement. Returns events for animals that struck defensively. */
  update(dt: number, per: Perception): { animal: Animal; ev: AIEvents }[] {
    this.time += dt;
    this.ensureChunks(per.playerX, per.playerZ);
    const events: { animal: Animal; ev: AIEvents }[] = [];
    let near: { name: string; state: string; dist: number } | null = null;
    const p: Perception = { ...per, noises: this.pending };
    for (const list of this.chunks.values()) {
      for (const a of list) {
        const d = Math.hypot(a.x - per.playerX, a.z - per.playerZ);
        // Far animals tick at a lower rate through simple skipping.
        if (d > 130 && (Math.floor(this.time * 10) + a.id) % 4 !== 0) continue;
        const ev = stepAnimal(a, p, dt, this.rng);
        advanceAnimal(a, dt, this.canStand(a), this.rng);
        const def = SPECIES[a.species];
        const g = this.terrain.heightAt(a.x, a.z);
        a.y = def.aquatic ? Math.min(a.y, WATER_Y - 0.4) : def.flying ? Math.max(a.y, g) : g;
        if (ev.strike || ev.warned) events.push({ animal: a, ev });
        if (!near || d < near.dist) near = { name: def.name, state: a.state, dist: d };
      }
    }
    this.nearest = near;
    this.pending = [];
    return events;
  }

  /** Per-frame model animation. */
  animate(frameDt: number, camPos: THREE.Vector3): void {
    for (const list of this.chunks.values()) {
      for (const a of list) {
        const rig = this.rigs.get(a.id);
        if (!rig) continue;
        const def = SPECIES[a.species];
        const dcam = Math.hypot(a.x - camPos.x, a.z - camPos.z);
        rig.root.visible = dcam < 160;
        if (!rig.root.visible) continue;
        let y = a.y;
        let pitch = 0;
        if (def.flying) {
          const flyingNow = a.state === 'flee' || a.state === 'investigate';
          y = a.y + (flyingNow ? 4 + Math.sin(this.time * 2 + a.id) : 0.1);
          pitch = flyingNow ? -0.15 : 0;
          for (const w of rig.wings) w.rotation.z = (flyingNow ? Math.sin(this.time * 22 + a.id) * 0.9 : -0.25) * (w.position.x > 0 ? 1 : -1);
        }
        rig.root.position.set(a.x, y, a.z);
        rig.root.rotation.set(pitch, a.yaw, 0);
        const moving = a.speed > 0.1;
        const gait = this.time * (4 + a.speed * 1.4) + a.id;
        rig.legs.forEach((l, i) => { l.rotation.x = moving ? Math.sin(gait + (i % 2 ? Math.PI : 0) + (i > 1 ? 1.2 : 0)) * 0.6 : 0; });
        rig.segments.forEach((s, i) => { s.position.x = Math.sin(this.time * (moving ? 7 : 1.5) - i * 0.9) * (a.state === 'warn' ? 0.02 : 0.08); });
        if (rig.tail) {
          if (def.aquatic) rig.tail.rotation.y = Math.sin(this.time * (6 + a.speed * 2) + a.id) * 0.5;
          else rig.tail.rotation.x = 0.5 + Math.sin(this.time * 3 + a.id) * 0.1;
        }
        if (rig.head) {
          let hx = 0;
          if (a.state === 'feed') hx = 0.7 + Math.sin(this.time * 3 + a.id) * 0.1;
          else if (a.state === 'warn') hx = 0.35 + Math.sin(this.time * 30) * 0.04;
          else if (a.state === 'rest') hx = 0.5;
          rig.head.rotation.x += (hx - rig.head.rotation.x) * Math.min(1, frameDt * 6);
        }
        const lie = a.state === 'rest' && (a.species === 'deer' || a.species === 'rabbit' || a.species === 'wolf' || a.species === 'bear');
        rig.root.scale.y += ((lie ? 0.75 : 1) - rig.root.scale.y) * Math.min(1, frameDt * 4);
        // Stagger wobble after a defensive push.
        if (a.stagger > 0) rig.root.rotation.z = Math.sin(this.time * 40) * 0.15 * a.stagger;
      }
    }
  }

  dispose(): void {
    this.chunks.clear();
    this.rigs.clear();
    this.group.clear();
  }
}
