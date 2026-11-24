import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { hashInts, mulberry32 } from './rng';
import { CHUNK_SIZE, Terrain, WATER_Y } from './terrain';

export type VegKind = 'pine' | 'broadleaf' | 'palmish' | 'cactus' | 'rock' | 'bush' | 'grass';

export interface Placement {
  kind: VegKind;
  x: number; y: number; z: number;
  scale: number;
  rot: number;
  tint: number; // 0..1 colour variation
  /** collision radius in metres; 0 means none */
  radius: number;
  height: number;
}

export const windUniform = { value: 0 };
/** 0..1 wind strength driven by weather; scales tree and grass sway. */
export const windStrength = { value: 0.1 };

function colorize(g: THREE.BufferGeometry, r: number, gr: number, b: number, jitter = 0): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  const count = geo.attributes.position.count;
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const j = 1 + (Math.sin(i * 12.9898) * 0.5) * jitter;
    arr[i * 3] = r * r * j; arr[i * 3 + 1] = gr * gr * j; arr[i * 3 + 2] = b * b * j;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  geo.deleteAttribute('uv');
  return geo;
}

function tr(g: THREE.BufferGeometry, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1): THREE.BufferGeometry {
  g.scale(sx, sy, sz);
  g.translate(x, y, z);
  return g;
}

const BARK: [number, number, number] = [0.33, 0.22, 0.13];

export function buildGeometries(): Record<VegKind, THREE.BufferGeometry> {
  const merge = (parts: THREE.BufferGeometry[]) => mergeGeometries(parts, false)!;
  const pine = merge([
    colorize(tr(new THREE.CylinderGeometry(0.18, 0.3, 3, 6), 0, 1.5, 0), ...BARK),
    colorize(tr(new THREE.ConeGeometry(2.2, 3.2, 7), 0, 3.6, 0), 0.1, 0.32, 0.17, 0.2),
    colorize(tr(new THREE.ConeGeometry(1.7, 2.8, 7), 0, 5.4, 0), 0.12, 0.36, 0.19, 0.2),
    colorize(tr(new THREE.ConeGeometry(1.1, 2.4, 7), 0, 7.1, 0), 0.14, 0.4, 0.21, 0.2),
  ]);
  const broadleaf = merge([
    colorize(tr(new THREE.CylinderGeometry(0.22, 0.36, 4, 6), 0, 2, 0), ...BARK),
    colorize(tr(new THREE.IcosahedronGeometry(2.4, 1), 0, 5.2, 0, 1, 0.85, 1), 0.2, 0.5, 0.15, 0.25),
    colorize(tr(new THREE.IcosahedronGeometry(1.6, 1), 1.4, 4.4, 0.6), 0.25, 0.55, 0.17, 0.25),
    colorize(tr(new THREE.IcosahedronGeometry(1.5, 1), -1.2, 4.7, -0.8), 0.18, 0.46, 0.14, 0.25),
  ]);
  const palmish = merge([
    colorize(tr(new THREE.CylinderGeometry(0.16, 0.28, 8, 6), 0, 4, 0), 0.42, 0.32, 0.2),
    ...[0, 1, 2, 3, 4, 5].map((i) => {
      const a = (i / 6) * Math.PI * 2;
      const leaf = new THREE.ConeGeometry(0.35, 4, 4);
      leaf.rotateZ(Math.PI / 2 + 0.5);
      leaf.translate(1.8, 8.2, 0);
      leaf.rotateY(a);
      return colorize(leaf, 0.1, 0.48, 0.14, 0.2);
    }),
  ]);
  const cactus = merge([
    colorize(tr(new THREE.CylinderGeometry(0.4, 0.45, 3.2, 8), 0, 1.6, 0), 0.25, 0.5, 0.25),
    colorize(tr(new THREE.CylinderGeometry(0.25, 0.25, 1.2, 6), 0.8, 1.9, 0), 0.25, 0.5, 0.25),
    colorize(tr(new THREE.CylinderGeometry(0.25, 0.25, 1.0, 6), -0.7, 1.5, 0), 0.25, 0.5, 0.25),
  ]);
  const rockG = new THREE.IcosahedronGeometry(1, 0);
  const p = rockG.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const k = 1 + Math.sin(p.getX(i) * 7.1 + p.getY(i) * 3.3 + p.getZ(i) * 5.7) * 0.18;
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.7, p.getZ(i) * k);
  }
  const rock = merge([colorize(tr(rockG, 0, 0.3, 0), 0.5, 0.48, 0.46, 0.15)]);
  const bush = merge([
    colorize(tr(new THREE.IcosahedronGeometry(0.8, 1), 0, 0.5, 0, 1, 0.75, 1), 0.2, 0.42, 0.14, 0.3),
    colorize(tr(new THREE.IcosahedronGeometry(0.55, 1), 0.6, 0.35, 0.2), 0.24, 0.46, 0.16, 0.3),
  ]);
  const blade = (rot: number) => {
    const g = new THREE.PlaneGeometry(0.5, 0.8, 1, 2);
    g.translate(0, 0.4, 0);
    g.rotateY(rot);
    const pos = g.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const t = pos.getY(i) / 0.8;
      colors[i * 3] = (0.25 + 0.2 * t) ** 2; colors[i * 3 + 1] = (0.4 + 0.3 * t) ** 2; colors[i * 3 + 2] = 0.015;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.deleteAttribute('uv');
    return g;
  };
  const grass = merge([blade(0), blade(Math.PI / 3), blade((2 * Math.PI) / 3)].map((g) => (g.index ? g.toNonIndexed() : g)));
  return { pine, broadleaf, palmish, cactus, rock, bush, grass };
}

export function makeVegMaterial(sway: number, doubleSide = false): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: doubleSide ? THREE.DoubleSide : THREE.FrontSide });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = windUniform;
    shader.uniforms.uWind = windStrength;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uWind;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 ip = vec3(instanceMatrix[3]);
        #else
          vec3 ip = vec3(0.0);
        #endif
        float bend = max(position.y, 0.0) * ${sway.toFixed(3)} * (0.5 + uWind * 3.0);
        float ph = uTime * 1.6 + ip.x * 0.25 + ip.z * 0.17;
        transformed.x += sin(ph) * bend * (0.6 + 0.4 * sin(uTime * 0.37 + ip.z));
        transformed.z += cos(ph * 0.8) * bend * 0.6;`,
      );
  };
  return mat;
}

/** Deterministically scatter vegetation for a chunk. */
export function scatterChunk(terrain: Terrain, cx: number, cz: number, density: number, withGrass: boolean): Placement[] {
  const rnd = mulberry32(hashInts(cx, cz, terrain.seed));
  const out: Placement[] = [];
  const ox = cx * CHUNK_SIZE, oz = cz * CHUNK_SIZE;

  const attempts = (n: number) => Math.round(n * density);
  const place = (
    n: number,
    pick: (w: ReturnType<Terrain['biomeWeights']>, rnd: () => number, h: number, slope: number) => VegKind | null,
    grass = false,
  ) => {
    for (let i = 0; i < attempts(n); i++) {
      const x = ox + rnd() * CHUNK_SIZE, z = oz + rnd() * CHUNK_SIZE;
      const s = terrain.sample(x, z);
      if (s.height < WATER_Y + 0.4) { rnd(); rnd(); continue; }
      const w = terrain.biomeWeights(x, z, s);
      const slope = grass ? 0 : terrain.slopeAt(x, z, 1.5);
      const kind = pick(w, rnd, s.height, slope);
      const scaleR = rnd(), rotR = rnd();
      if (!kind) continue;
      let scale = 0.8 + scaleR * 0.7, radius = 0, height = 1;
      switch (kind) {
        case 'pine': radius = 0.45 * scale; height = 8 * scale; break;
        case 'broadleaf': radius = 0.5 * scale; height = 7 * scale; break;
        case 'palmish': radius = 0.35 * scale; height = 8.5 * scale; break;
        case 'cactus': radius = 0.5 * scale; height = 3.2 * scale; break;
        case 'rock': scale = 0.5 + scaleR * 1.8; radius = 0.9 * scale; height = 0.8 * scale; break;
        case 'bush': scale = 0.7 + scaleR * 0.7; height = 1; break;
        case 'grass': scale = 0.35 + scaleR * 0.45; break;
      }
      out.push({ kind, x, y: s.height - (kind === 'rock' ? 0.15 * scale : 0), z, scale, rot: rotR * Math.PI * 2, tint: rnd(), radius, height });
    }
  };

  place(70, (w, r, _h, slope) => {
    if (slope > 0.8) return null;
    const p = r();
    const dense = w.tropical * 1.0 + w.grassland * 0.28 + w.swamp * 0.45 + w.mountain * 0.35 * 0.5 + w.desert * 0.03;
    if (p > dense) return null;
    const q = r();
    if (w.tropical > 0.4) return q < 0.35 ? 'palmish' : 'broadleaf';
    if (w.mountain + w.snow > 0.5) return 'pine';
    if (w.swamp > 0.4) return 'broadleaf';
    return q < 0.25 ? 'pine' : 'broadleaf';
  });
  place(30, (w, r, _h, slope) => {
    if (slope > 1.2) return null;
    const dens = w.desert * 0.35 + w.mountain * 0.6 + w.snow * 0.25 + w.grassland * 0.15 + w.tropical * 0.1;
    return r() < dens ? 'rock' : null;
  });
  place(35, (w, r, _h, slope) => {
    if (slope > 0.7) return null;
    const dens = w.grassland * 0.6 + w.tropical * 0.7 + w.swamp * 0.5;
    return r() < dens ? 'bush' : null;
  });
  place(25, (w, r, _h, slope) => {
    if (slope > 0.5) return null;
    return r() < w.desert * 0.5 ? 'cactus' : null;
  });
  if (withGrass) {
    place(1100, (w, r) => {
      const dens = w.grassland * 0.9 + w.tropical * 0.7 + w.swamp * 0.6;
      return r() < dens ? 'grass' : null;
    }, true);
  }
  return out;
}

export interface VegetationMeshes {
  group: THREE.Group;
  meshes: Partial<Record<VegKind, THREE.InstancedMesh>>;
}

const dummy = new THREE.Object3D();
const tmpColor = new THREE.Color();

export function buildVegetationMeshes(
  placements: Placement[],
  geos: Record<VegKind, THREE.BufferGeometry>,
  mats: Record<VegKind, THREE.Material>,
  originX: number,
  originZ: number,
  shadows: boolean,
): VegetationMeshes {
  const group = new THREE.Group();
  group.position.set(originX, 0, originZ);
  const meshes: VegetationMeshes['meshes'] = {};
  const byKind = new Map<VegKind, Placement[]>();
  for (const p of placements) {
    let a = byKind.get(p.kind);
    if (!a) byKind.set(p.kind, (a = []));
    a.push(p);
  }
  for (const [kind, list] of byKind) {
    const mesh = new THREE.InstancedMesh(geos[kind], mats[kind], list.length);
    list.forEach((p, i) => {
      dummy.position.set(p.x - originX, p.y, p.z - originZ);
      dummy.rotation.set(0, p.rot, 0);
      dummy.scale.setScalar(p.scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      const v = 0.8 + p.tint * 0.4;
      tmpColor.setRGB(v, v * (0.92 + p.tint * 0.16), v);
      mesh.setColorAt(i, tmpColor);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = shadows && kind !== 'grass';
    mesh.receiveShadow = false;
    mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(CHUNK_SIZE / 2, 20, CHUNK_SIZE / 2), CHUNK_SIZE * 0.75 + 20);
    group.add(mesh);
    meshes[kind] = mesh;
  }
  return { group, meshes };
}
