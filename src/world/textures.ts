import * as THREE from 'three';
import { mulberry32 } from './rng';

/** Procedural canvas textures. No image files are shipped. */
function makeCanvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')!];
}

/** Greyscale grain used as a tiled detail map multiplied with vertex colours. */
export function makeDetailTexture(seed = 1, size = 256): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(size);
  const rnd = mulberry32(seed);
  const img = ctx.createImageData(size, size);
  // Blend a few octaves of value noise on a wrapping grid so the texture tiles.
  const grids = [8, 16, 32, 64].map((n) => {
    const g = new Float32Array(n * n);
    for (let i = 0; i < g.length; i++) g[i] = rnd();
    return { n, g };
  });
  const sampleGrid = (n: number, g: Float32Array, u: number, v: number) => {
    const x = u * n, y = v * n;
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = x - x0, fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const at = (a: number, b: number) => g[(b % n) * n + (a % n)];
    const top = at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx;
    const bot = at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx;
    return top * (1 - sy) + bot * sy;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0, amp = 0.5, norm = 0;
      for (const { n, g } of grids) {
        v += sampleGrid(n, g, x / size, y / size) * amp;
        norm += amp;
        amp *= 0.6;
      }
      v /= norm;
      const l = Math.floor(150 + v * 105);
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = l;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Normal-ish ripple texture for water. */
export function makeWaterNormalTexture(seed = 7, size = 256): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(size);
  const rnd = mulberry32(seed);
  const n = 16;
  const g = new Float32Array(n * n);
  for (let i = 0; i < g.length; i++) g[i] = rnd();
  const h = (x: number, y: number) => {
    let v = 0, a = 1, s = 0;
    for (let o = 0; o < 3; o++) {
      const f = n << o;
      const u = ((x / size) * f), w = ((y / size) * f);
      const x0 = Math.floor(u), y0 = Math.floor(w);
      const fx = u - x0, fy = w - y0;
      const at = (p: number, q: number) => g[((q % n) + n) % n * n + (((p % n) + n) % n)] ;
      // coarse: reuse grid with wrapped index, offset per octave
      const v00 = at(x0 * (o + 1), y0 * (o + 2)), v10 = at((x0 + 1) * (o + 1), y0 * (o + 2));
      const v01 = at(x0 * (o + 1), (y0 + 1) * (o + 2)), v11 = at((x0 + 1) * (o + 1), (y0 + 1) * (o + 2));
      const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      v += a * ((v00 * (1 - sx) + v10 * sx) * (1 - sy) + (v01 * (1 - sx) + v11 * sx) * sy);
      s += a; a *= 0.5;
    }
    return v / s;
  };
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = h(x + 1, y) - h(x - 1, y);
      const dy = h(x, y + 1) - h(x, y - 1);
      const i = (y * size + x) * 4;
      img.data[i] = Math.max(0, Math.min(255, 128 + dx * 900));
      img.data[i + 1] = Math.max(0, Math.min(255, 128 + dy * 900));
      img.data[i + 2] = 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}
