import * as THREE from 'three';
import { CHUNK_SIZE, Terrain } from './terrain';

export const LOD_SEGMENTS = [32, 16, 8] as const;

export interface ChunkGeometry {
  geometry: THREE.BufferGeometry;
  /** Grid-only positions/indices (no skirts), for physics trimesh. */
  gridPositions: Float32Array;
  gridIndices: Uint32Array;
}

/** Builds a terrain chunk mesh with vertex colours, analytic normals and edge skirts (hide LOD cracks). */
export function buildChunkGeometry(terrain: Terrain, cx: number, cz: number, lod: number): ChunkGeometry {
  const n = LOD_SEGMENTS[lod];
  const step = CHUNK_SIZE / n;
  const ox = cx * CHUNK_SIZE;
  const oz = cz * CHUNK_SIZE;
  const verts = (n + 1) * (n + 1);
  const skirtVerts = 4 * (n + 1);
  const total = verts + skirtVerts;
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  const c: [number, number, number] = [0, 0, 0];
  const e = step;

  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const wx = ox + i * step;
      const wz = oz + j * step;
      const s = terrain.sample(wx, wz);
      const k = j * (n + 1) + i;
      pos[k * 3] = i * step;
      pos[k * 3 + 1] = s.height;
      pos[k * 3 + 2] = j * step;
      const hl = terrain.heightAt(wx - e, wz), hr = terrain.heightAt(wx + e, wz);
      const hd = terrain.heightAt(wx, wz - e), hu = terrain.heightAt(wx, wz + e);
      let nx = hl - hr, ny = 2 * e, nz = hd - hu;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len; nz /= len;
      nor[k * 3] = nx; nor[k * 3 + 1] = ny; nor[k * 3 + 2] = nz;
      terrain.colorAt(wx, wz, c, s);
      // Steep slopes show bare rock.
      const rock = Math.max(0, Math.min(1, (1 - ny - 0.22) * 4));
      // Palette is authored in sRGB; vertex colours are linear, so square (approximate gamma).
      const cr = c[0] + (0.42 - c[0]) * rock, cg = c[1] + (0.4 - c[1]) * rock, cb = c[2] + (0.38 - c[2]) * rock;
      col[k * 3] = cr * cr; col[k * 3 + 1] = cg * cg; col[k * 3 + 2] = cb * cb;
      uv[k * 2] = wx / 8;
      uv[k * 2 + 1] = wz / 8;
    }
  }

  const idx: number[] = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i, b = a + 1, d = a + n + 1, f = d + 1;
      idx.push(a, d, b, b, d, f);
    }
  }
  const gridIdxCount = idx.length;

  // Skirts: duplicate border vertices dropped downward.
  const skirt = 6;
  const edges: number[][] = [[], [], [], []];
  for (let i = 0; i <= n; i++) {
    edges[0].push(i); // z = 0
    edges[1].push(n * (n + 1) + i); // z = max
    edges[2].push(i * (n + 1)); // x = 0
    edges[3].push(i * (n + 1) + n); // x = max
  }
  let sv = verts;
  edges.forEach((edge, ei) => {
    const start = sv;
    for (const src of edge) {
      pos[sv * 3] = pos[src * 3];
      pos[sv * 3 + 1] = pos[src * 3 + 1] - skirt;
      pos[sv * 3 + 2] = pos[src * 3 + 2];
      nor[sv * 3] = nor[src * 3]; nor[sv * 3 + 1] = nor[src * 3 + 1]; nor[sv * 3 + 2] = nor[src * 3 + 2];
      col[sv * 3] = col[src * 3]; col[sv * 3 + 1] = col[src * 3 + 1]; col[sv * 3 + 2] = col[src * 3 + 2];
      uv[sv * 2] = uv[src * 2]; uv[sv * 2 + 1] = uv[src * 2 + 1];
      sv++;
    }
    for (let i = 0; i < n; i++) {
      const t0 = edge[i], t1 = edge[i + 1], b0 = start + i, b1 = start + i + 1;
      // Two-sided skirts so winding does not matter.
      idx.push(t0, b0, t1, t1, b0, b1, t0, t1, b0, t1, b1, b0);
    }
    void ei;
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1));
  geometry.boundingSphere = new THREE.Sphere(
    new THREE.Vector3(CHUNK_SIZE / 2, 40, CHUNK_SIZE / 2),
    CHUNK_SIZE * 0.72 + 60,
  );

  return {
    geometry,
    gridPositions: pos.slice(0, verts * 3),
    gridIndices: new Uint32Array(idx.slice(0, gridIdxCount)),
  };
}
