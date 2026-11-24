import * as THREE from 'three';
import type { PhysicsWorld, RAPIER } from '../physics/physics';
import { events } from '../core/events';
import type { PresetValues } from '../core/settings';
import { buildCaveEntrance, CAVE_TRIGGER_RADIUS } from './caves';
import { buildChunkGeometry } from './chunkMesh';
import { caveSiteForChunk, waterfallSitesForChunk, type CaveSite } from './features';
import { CHUNK_SIZE, Terrain } from './terrain';
import {
  buildGeometries, buildVegetationMeshes, makeVegMaterial, scatterChunk,
  type Placement, type VegKind, type VegetationMeshes,
} from './vegetation';
import { makeDetailTexture } from './textures';
import { makeWaterfallMaterial } from './water';

interface Chunk {
  cx: number; cz: number;
  lod: number;
  mesh: THREE.Mesh;
  gridPositions: Float32Array;
  gridIndices: Uint32Array;
  vegLevel: 0 | 1 | 2;
  veg: VegetationMeshes | null;
  placements: Placement[];
  body: RAPIER.RigidBody | null;
  extras: THREE.Group;
  cave: CaveSite | null;
}

const key = (cx: number, cz: number) => `${cx},${cz}`;
const lodFor = (d: number) => (d <= 2 ? 0 : d <= 4 ? 1 : 2);

export class ChunkManager {
  readonly group = new THREE.Group();
  private chunks = new Map<string, Chunk>();
  private terrainMat: THREE.MeshLambertMaterial;
  private geos = buildGeometries();
  private vegMats: Record<VegKind, THREE.Material>;
  private waterfallMat = makeWaterfallMaterial();
  caveSites = new Map<string, CaveSite>();
  private settings: PresetValues;

  constructor(private terrain: Terrain, private physics: PhysicsWorld, settings: PresetValues) {
    this.settings = settings;
    this.terrainMat = new THREE.MeshLambertMaterial({ vertexColors: true, map: makeDetailTexture(terrain.seed) });
    const tree = makeVegMaterial(0.012);
    const stiff = makeVegMaterial(0.004);
    const grass = makeVegMaterial(0.35, true);
    this.vegMats = { pine: tree, broadleaf: tree, palmish: tree, cactus: stiff, rock: stiff, bush: makeVegMaterial(0.02), grass };
  }

  setPreset(p: PresetValues): void {
    this.settings = p;
    this.group.traverse((o) => {
      if ((o as THREE.InstancedMesh).isInstancedMesh) o.castShadow = p.shadows && o !== undefined;
    });
  }

  get loadedCount(): number {
    return this.chunks.size;
  }

  private create(cx: number, cz: number): Chunk {
    const ox = cx * CHUNK_SIZE, oz = cz * CHUNK_SIZE;
    const g = buildChunkGeometry(this.terrain, cx, cz, 2);
    const mesh = new THREE.Mesh(g.geometry, this.terrainMat);
    mesh.position.set(ox, 0, oz);
    mesh.receiveShadow = true;
    const extras = new THREE.Group();
    const cave = caveSiteForChunk(this.terrain, cx, cz);
    if (cave) {
      extras.add(buildCaveEntrance(cave));
      this.caveSites.set(cave.id, cave);
    }
    for (const w of waterfallSitesForChunk(this.terrain, cx, cz)) extras.add(this.buildWaterfall(w));
    this.group.add(mesh, extras);
    const chunk: Chunk = {
      cx, cz, lod: 2, mesh, gridPositions: g.gridPositions, gridIndices: g.gridIndices,
      vegLevel: 0, veg: null, placements: [], body: null, extras, cave,
    };
    this.chunks.set(key(cx, cz), chunk);
    events.emit('chunkLoaded', { cx, cz });
    return chunk;
  }

  private buildWaterfall(w: ReturnType<typeof waterfallSitesForChunk>[number]): THREE.Mesh {
    const segs = 10, len = 16, width = 3.2;
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    const px = -w.tz, pz = w.tx;
    for (let i = 0; i <= segs; i++) {
      const t = (i / segs - 0.5) * len;
      const x = w.x + w.tx * t, z = w.z + w.tz * t;
      const y = this.terrain.heightAt(x, z) + 0.35;
      pos.push(x + px * width / 2, y, z + pz * width / 2, x - px * width / 2, y, z - pz * width / 2);
      uv.push(0, i / segs, 1, i / segs);
      if (i > 0) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    const m = new THREE.Mesh(geo, this.waterfallMat);
    // Positions are world-space; the chunk group offset is applied to the terrain mesh only.
    m.renderOrder = 3;
    return m;
  }

  private applyState(c: Chunk, d: number): void {
    const lod = lodFor(d);
    if (lod !== c.lod) {
      const g = buildChunkGeometry(this.terrain, c.cx, c.cz, lod);
      c.mesh.geometry.dispose();
      c.mesh.geometry = g.geometry;
      c.gridPositions = g.gridPositions;
      c.gridIndices = g.gridIndices;
      c.lod = lod;
    }
    const vegRadius = Math.min(4, this.settings.viewDistance);
    const level: 0 | 1 | 2 = d <= 2 ? 2 : d <= vegRadius ? 1 : 0;
    if (level !== c.vegLevel) {
      if (c.veg) {
        this.group.remove(c.veg.group);
        Object.values(c.veg.meshes).forEach((m) => m!.dispose());
        c.veg = null;
      }
      if (level > 0) {
        c.placements = scatterChunk(this.terrain, c.cx, c.cz, this.settings.vegetationDensity, level === 2);
        c.veg = buildVegetationMeshes(c.placements, this.geos, this.vegMats, c.cx * CHUNK_SIZE, c.cz * CHUNK_SIZE, this.settings.shadows);
        this.group.add(c.veg.group);
      } else c.placements = [];
      c.vegLevel = level;
    }
    const wantBody = d <= 2 && c.lod === 0;
    if (wantBody && !c.body) {
      c.body = this.physics.addChunkCollider(
        c.cx * CHUNK_SIZE, c.cz * CHUNK_SIZE, c.gridPositions, c.gridIndices,
        c.placements.filter((p) => p.kind !== 'grass' && p.kind !== 'bush'),
      );
    } else if (!wantBody && c.body) {
      this.physics.remove(c.body);
      c.body = null;
    }
  }

  private destroy(c: Chunk): void {
    if (c.body) this.physics.remove(c.body);
    this.group.remove(c.mesh, c.extras);
    if (c.veg) {
      this.group.remove(c.veg.group);
      Object.values(c.veg.meshes).forEach((m) => m!.dispose());
    }
    c.extras.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.geometry) m.geometry.dispose();
    });
    c.mesh.geometry.dispose();
    if (c.cave) this.caveSites.delete(c.cave.id);
    this.chunks.delete(key(c.cx, c.cz));
    events.emit('chunkUnloaded', { cx: c.cx, cz: c.cz });
  }

  /** Streams chunks around a world position. `budget` limits create/rebuild operations this call. */
  update(px: number, pz: number, budget = 2): void {
    const pcx = Math.floor(px / CHUNK_SIZE), pcz = Math.floor(pz / CHUNK_SIZE);
    const R = this.settings.viewDistance;
    let ops = budget;

    for (const c of [...this.chunks.values()]) {
      if (Math.hypot(c.cx - pcx, c.cz - pcz) > R + 1.5) this.destroy(c);
    }

    const wanted: Array<{ cx: number; cz: number; d: number }> = [];
    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        const d = Math.hypot(dx, dz);
        if (d <= R) wanted.push({ cx: pcx + dx, cz: pcz + dz, d });
      }
    }
    wanted.sort((a, b) => a.d - b.d);
    for (const w of wanted) {
      if (ops <= 0) break;
      let c = this.chunks.get(key(w.cx, w.cz));
      const dd = Math.max(Math.abs(w.cx - pcx), Math.abs(w.cz - pcz));
      if (!c) {
        c = this.create(w.cx, w.cz);
        this.applyState(c, dd);
        ops--;
      } else if (this.needsChange(c, dd)) {
        this.applyState(c, dd);
        ops--;
      }
    }
  }

  private needsChange(c: Chunk, d: number): boolean {
    const vegRadius = Math.min(4, this.settings.viewDistance);
    const level = d <= 2 ? 2 : d <= vegRadius ? 1 : 0;
    return lodFor(d) !== c.lod || level !== c.vegLevel || ((d <= 2 && c.lod === 0) !== !!c.body);
  }

  /** Synchronously load everything within `radius` chunks (used before spawning). */
  preload(px: number, pz: number, radius: number): void {
    const pcx = Math.floor(px / CHUNK_SIZE), pcz = Math.floor(pz / CHUNK_SIZE);
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const cx = pcx + dx, cz = pcz + dz;
        let c = this.chunks.get(key(cx, cz));
        if (!c) c = this.create(cx, cz);
        this.applyState(c, Math.max(Math.abs(dx), Math.abs(dz)));
      }
    }
  }

  /** Cave site whose entrance is within trigger range of the position, if any. */
  nearbyCave(x: number, y: number, z: number): CaveSite | null {
    for (const s of this.caveSites.values()) {
      if (Math.hypot(s.x - x, s.z - z) < CAVE_TRIGGER_RADIUS && Math.abs(s.y - y) < 4) return s;
    }
    return null;
  }

  hasColliderAt(x: number, z: number): boolean {
    const c = this.chunks.get(key(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE)));
    return !!c?.body;
  }
}
