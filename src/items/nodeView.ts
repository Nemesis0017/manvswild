import * as THREE from 'three';
import { CHUNK_SIZE } from '../world/terrain';
import { NODE_KINDS, type NodeKind, type NodeRegistry, type WorldNode } from './nodes';

function merged(parts: { g: THREE.BufferGeometry; color: number; pos: [number, number, number]; scale: [number, number, number]; rot?: [number, number, number] }[]): THREE.BufferGeometry {
  const geos: THREE.BufferGeometry[] = [];
  for (const p of parts) {
    let g = p.g.index ? p.g.toNonIndexed() : p.g.clone();
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(...p.pos),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...(p.rot ?? [0, 0, 0]))),
      new THREE.Vector3(...p.scale),
    );
    g.applyMatrix4(m);
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    const c = new THREE.Color(p.color);
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.deleteAttribute('uv');
    geos.push(g);
  }
  const total = geos.reduce((s, g) => s + g.attributes.position.count, 0);
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), col = new Float32Array(total * 3);
  let o = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    col.set(g.attributes.color.array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}

const box = new THREE.BoxGeometry(1, 1, 1);
const sph = new THREE.IcosahedronGeometry(0.5, 0);
const cone = new THREE.ConeGeometry(0.5, 1, 5);
const cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 6);

function geometryFor(kind: NodeKind): THREE.BufferGeometry {
  switch (kind) {
    case 'branches':
      return merged([0, 1, 2, 3].map((i) => ({ g: cyl, color: 0x6b4a2b, pos: [0, 0.08 + i * 0.05, 0] as [number, number, number], scale: [0.06, 1.1, 0.06] as [number, number, number], rot: [Math.PI / 2, 0, i * 0.8] as [number, number, number] })));
    case 'log':
      return merged([{ g: cyl, color: 0x5a3d24, pos: [0, 0.22, 0], scale: [0.4, 1.8, 0.4], rot: [Math.PI / 2, 0, 0] }, { g: cone, color: 0x6a8a3a, pos: [0.6, 0.45, 0.1], scale: [0.25, 0.3, 0.25] }]);
    case 'stones':
      return merged([
        { g: sph, color: 0x8a8a84, pos: [0, 0.2, 0], scale: [0.6, 0.4, 0.5] },
        { g: sph, color: 0x77776f, pos: [0.4, 0.12, 0.2], scale: [0.35, 0.25, 0.3] },
        { g: sph, color: 0x9a9a92, pos: [-0.3, 0.1, 0.3], scale: [0.3, 0.2, 0.3] },
      ]);
    case 'berry_bush':
      return merged([
        { g: sph, color: 0x3e7a2c, pos: [0, 0.45, 0], scale: [1.0, 0.8, 1.0] },
        ...[0, 1, 2, 3, 4, 5].map((i) => ({ g: sph, color: 0xc4203a, pos: [Math.cos(i * 1.1) * 0.4, 0.5 + (i % 3) * 0.12, Math.sin(i * 1.1) * 0.4] as [number, number, number], scale: [0.1, 0.1, 0.1] as [number, number, number] })),
      ]);
    case 'fiber_plant':
      return merged([0, 1, 2, 3, 4].map((i) => ({ g: cone, color: 0xb8c060, pos: [Math.cos(i * 1.3) * 0.15, 0.4, Math.sin(i * 1.3) * 0.15] as [number, number, number], scale: [0.12, 0.9, 0.12] as [number, number, number], rot: [Math.sin(i * 2) * 0.3, 0, Math.cos(i * 2) * 0.3] as [number, number, number] })));
    case 'leaf_plant':
      return merged([0, 1, 2, 3].map((i) => ({ g: box, color: 0x2f9a3a, pos: [Math.cos(i * 1.6) * 0.2, 0.45, Math.sin(i * 1.6) * 0.2] as [number, number, number], scale: [0.5, 0.03, 0.9] as [number, number, number], rot: [-0.7, i * 1.6, 0] as [number, number, number] })));
    case 'wreckage':
      return merged([
        { g: box, color: 0x9aa4ac, pos: [0, 0.3, 0], scale: [1.2, 0.6, 0.8], rot: [0.1, 0.3, 0.15] },
        { g: box, color: 0xd0702a, pos: [0.5, 0.65, 0.1], scale: [0.5, 0.1, 0.9], rot: [0.3, 0.1, 0] },
      ]);
  }
}

const MAX_PER_KIND = 220;
const RADIUS_CHUNKS = 2;

/** Instanced rendering of harvestable nodes around the player. */
export class NodeView {
  readonly group = new THREE.Group();
  private meshes = new Map<NodeKind, THREE.InstancedMesh>();
  private lastCx = NaN; private lastCz = NaN;
  private dirty = true;

  constructor(private registry: NodeRegistry) {
    const material = new THREE.MeshLambertMaterial({ vertexColors: true });
    for (const k of NODE_KINDS) {
      const m = new THREE.InstancedMesh(geometryFor(k), material, MAX_PER_KIND);
      m.count = 0;
      m.castShadow = true;
      m.frustumCulled = false;
      this.meshes.set(k, m);
      this.group.add(m);
    }
  }

  markDirty(): void { this.dirty = true; }

  update(px: number, pz: number, now: number): void {
    const cx = Math.floor(px / CHUNK_SIZE), cz = Math.floor(pz / CHUNK_SIZE);
    if (!this.dirty && cx === this.lastCx && cz === this.lastCz) return;
    this.dirty = false;
    this.lastCx = cx; this.lastCz = cz;
    const counts = new Map<NodeKind, number>();
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    const axis = new THREE.Vector3(0, 1, 0);
    for (let dx = -RADIUS_CHUNKS; dx <= RADIUS_CHUNKS; dx++) {
      for (let dz = -RADIUS_CHUNKS; dz <= RADIUS_CHUNKS; dz++) {
        for (const n of this.registry.chunkNodes(cx + dx, cz + dz)) {
          if (!this.registry.isAvailable(n.id, now)) continue;
          const mesh = this.meshes.get(n.kind)!;
          const i = counts.get(n.kind) ?? 0;
          if (i >= MAX_PER_KIND) continue;
          q.setFromAxisAngle(axis, n.rot);
          m4.compose(p.set(n.x, n.y, n.z), q, s);
          mesh.setMatrixAt(i, m4);
          counts.set(n.kind, i + 1);
        }
      }
    }
    for (const [k, mesh] of this.meshes) {
      mesh.count = counts.get(k) ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
}

export type { WorldNode };
