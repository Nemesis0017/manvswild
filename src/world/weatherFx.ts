import * as THREE from 'three';
import type { WeatherEffects } from './weather';

function radialTexture(draw: (g: CanvasRenderingContext2D, s: number) => void, size = 128): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d')!, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const RAIN_N = 2600, SNOW_N = 2200, BOX = 36, HEIGHT = 26;

/** Rain streaks, snow flakes, lightning, drifting clouds and sun god rays. All procedural. */
export class WeatherFx {
  readonly group = new THREE.Group();
  private rain: THREE.LineSegments;
  private rainPos = new Float32Array(RAIN_N * 6);
  private rainBase = new Float32Array(RAIN_N * 3);
  private snow: THREE.Points;
  private snowPos = new Float32Array(SNOW_N * 3);
  private clouds: THREE.Sprite[] = [];
  private cloudBase: { x: number; z: number; y: number; s: number }[] = [];
  private rays: THREE.Mesh;
  private bolt: THREE.Line;
  private boltMat = new THREE.LineBasicMaterial({ color: 0xe8f0ff, transparent: true, opacity: 0, fog: false });
  private flash = 0;
  private nextBolt = 6;
  private time = 0;
  /** Seconds since the most recent bolt; used to schedule thunder (see onThunder). */
  onThunder: ((delay: number) => void) | null = null;
  /** 0..1 brightness boost from lightning for the sky and lights. */
  get flashLevel(): number { return this.flash; }

  constructor(seed = 1) {
    let s = seed >>> 0;
    const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
    // Rain
    for (let i = 0; i < RAIN_N; i++) {
      this.rainBase[i * 3] = (rnd() - 0.5) * BOX * 2;
      this.rainBase[i * 3 + 1] = rnd() * HEIGHT;
      this.rainBase[i * 3 + 2] = (rnd() - 0.5) * BOX * 2;
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3));
    this.rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0xb8c8e0, transparent: true, opacity: 0.45, depthWrite: false, fog: false }));
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    // Snow
    const sg = new THREE.BufferGeometry();
    for (let i = 0; i < SNOW_N; i++) {
      this.snowPos[i * 3] = (rnd() - 0.5) * BOX * 2;
      this.snowPos[i * 3 + 1] = rnd() * HEIGHT;
      this.snowPos[i * 3 + 2] = (rnd() - 0.5) * BOX * 2;
    }
    sg.setAttribute('position', new THREE.BufferAttribute(this.snowPos.slice(), 3));
    this.snow = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 0.16, transparent: true, opacity: 0.9, depthWrite: false, fog: false }));
    this.snow.frustumCulled = false;
    this.snow.visible = false;
    // Clouds
    const cloudTex = radialTexture((g, n) => {
      for (let i = 0; i < 14; i++) {
        const x = n * (0.25 + rnd() * 0.5), y = n * (0.35 + rnd() * 0.3), r = n * (0.18 + rnd() * 0.18);
        const gr = g.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, 'rgba(255,255,255,0.55)');
        gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr;
        g.fillRect(0, 0, n, n);
      }
    }, 256);
    for (let i = 0; i < 28; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudTex, transparent: true, depthWrite: false, fog: false, opacity: 0 }));
      const b = { x: (rnd() - 0.5) * 900, z: (rnd() - 0.5) * 900, y: 150 + rnd() * 50, s: 160 + rnd() * 140 };
      this.cloudBase.push(b);
      sp.scale.set(b.s, b.s * 0.45, 1);
      sp.renderOrder = -0.5;
      this.clouds.push(sp);
      this.group.add(sp);
    }
    // God rays: a fan of soft streaks drawn additively toward the sun.
    const rayTex = radialTexture((g, n) => {
      const cx = n / 2;
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * Math.PI * 2 + rnd() * 0.2;
        const gr = g.createLinearGradient(cx, cx, cx + Math.cos(a) * cx, cx + Math.sin(a) * cx);
        gr.addColorStop(0, 'rgba(255,230,170,0.35)');
        gr.addColorStop(1, 'rgba(255,230,170,0)');
        g.strokeStyle = gr;
        g.lineWidth = 3 + rnd() * 6;
        g.beginPath(); g.moveTo(cx, cx); g.lineTo(cx + Math.cos(a) * cx, cx + Math.sin(a) * cx); g.stroke();
      }
      const core = g.createRadialGradient(cx, cx, 0, cx, cx, cx * 0.5);
      core.addColorStop(0, 'rgba(255,240,200,0.5)');
      core.addColorStop(1, 'rgba(255,240,200,0)');
      g.fillStyle = core; g.fillRect(0, 0, n, n);
    }, 256);
    this.rays = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: rayTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false, opacity: 0 }),
    );
    this.rays.renderOrder = 5;
    this.rays.frustumCulled = false;
    // Lightning bolt (re-generated for each strike)
    this.bolt = new THREE.Line(new THREE.BufferGeometry(), this.boltMat);
    this.bolt.frustumCulled = false;
    this.group.add(this.rain, this.snow, this.rays, this.bolt);
  }

  /**
   * @param brightness 0..1 sky brightness (night is dark)
   * @param sunDir normalized direction to the sun
   * @param windDir wind heading unit vector in xz
   */
  update(dt: number, cam: THREE.Camera, fx: WeatherEffects, brightness: number, sunDir: THREE.Vector3, enabled: boolean, reduced: boolean): void {
    this.time += dt;
    const cp = cam.position;
    const rainAmt = enabled ? fx.rain : 0, snowAmt = enabled ? fx.snow : 0;
    const wind = fx.wind;
    // Rain streaks
    this.rain.visible = rainAmt > 0.02;
    if (this.rain.visible) {
      const n = Math.floor(RAIN_N * rainAmt * (reduced ? 0.5 : 1));
      const fall = 30 * dt, lean = wind * 6 * dt;
      for (let i = 0; i < n; i++) {
        let y = this.rainBase[i * 3 + 1] - fall;
        let x = this.rainBase[i * 3] + lean;
        if (y < 0) { y += HEIGHT; }
        if (x > BOX) x -= BOX * 2;
        this.rainBase[i * 3 + 1] = y;
        this.rainBase[i * 3] = x;
        const wx = cp.x + this.rainBase[i * 3], wz = cp.z + this.rainBase[i * 3 + 2];
        const wy = cp.y - 6 + y;
        this.rainPos.set([wx, wy, wz, wx + wind * 0.4, wy + 0.9, wz], i * 6);
      }
      this.rain.geometry.setDrawRange(0, n * 2);
      (this.rain.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (this.rain.material as THREE.LineBasicMaterial).opacity = 0.15 + 0.4 * brightness;
    }
    // Snow
    this.snow.visible = snowAmt > 0.02;
    if (this.snow.visible) {
      const n = Math.floor(SNOW_N * snowAmt * (reduced ? 0.5 : 1));
      const arr = (this.snow.geometry.attributes.position as THREE.BufferAttribute);
      for (let i = 0; i < n; i++) {
        let y = this.snowPos[i * 3 + 1] - dt * (2.2 + (i % 5) * 0.2);
        if (y < 0) y += HEIGHT;
        this.snowPos[i * 3 + 1] = y;
        const t = this.time + i;
        this.snowPos[i * 3] += (Math.sin(t * 0.9) * 0.6 + wind * 5) * dt;
        if (this.snowPos[i * 3] > BOX) this.snowPos[i * 3] -= BOX * 2;
        arr.setXYZ(i, cp.x + this.snowPos[i * 3], cp.y - 6 + y, cp.z + this.snowPos[i * 3 + 2]);
      }
      this.snow.geometry.setDrawRange(0, n);
      arr.needsUpdate = true;
    }
    // Clouds drift with the wind and follow the player.
    const cover = enabled ? fx.cloudCover : 0.15;
    const tint = 0.35 + 0.65 * brightness;
    const drift = this.time * (3 + wind * 14);
    this.clouds.forEach((c, i) => {
      const b = this.cloudBase[i];
      const x = wrap(b.x + drift, 0, 450), z = b.z;
      c.position.set(cp.x + x, b.y, cp.z + z * 0.5);
      const show = i / this.clouds.length < cover;
      const m = c.material as THREE.SpriteMaterial;
      m.opacity += ((show ? 0.55 + 0.4 * fx.dim : 0) - m.opacity) * Math.min(1, dt * 0.6);
      const dark = 1 - fx.dim * 0.55;
      m.color.setRGB(tint * dark, tint * dark, Math.min(1, tint * dark * 1.05));
    });
    // God rays: strongest at low sun on clear days.
    const elev = sunDir.y;
    const lowSun = elev > 0.02 ? Math.max(0, 1 - elev * 1.6) : 0;
    const strength = lowSun * (1 - cover * 0.9) * (enabled ? 1 : 0.5) * (elev > 0 ? 1 : 0);
    const rayMat = this.rays.material as THREE.MeshBasicMaterial;
    rayMat.opacity = strength * 0.5;
    this.rays.visible = rayMat.opacity > 0.01;
    this.rays.position.copy(cp).addScaledVector(sunDir, 600);
    this.rays.scale.setScalar(900);
    this.rays.quaternion.copy(cam.quaternion);
    // Lightning
    this.flash = Math.max(0, this.flash - dt * 4);
    this.boltMat.opacity = Math.min(1, this.flash * 1.5);
    this.bolt.visible = this.boltMat.opacity > 0.02;
    if (enabled && fx.lightning > 0.3) {
      this.nextBolt -= dt;
      if (this.nextBolt <= 0) {
        this.nextBolt = 5 + Math.random() * 14;
        this.strike(cp);
      }
    }
  }

  private strike(cp: THREE.Vector3): void {
    const ang = Math.random() * Math.PI * 2, d = 120 + Math.random() * 250;
    const bx = cp.x + Math.cos(ang) * d, bz = cp.z + Math.sin(ang) * d;
    const pts: THREE.Vector3[] = [];
    let x = bx, z = bz;
    for (let y = 200; y >= cp.y - 5; y -= 14) {
      pts.push(new THREE.Vector3(x, y, z));
      x += (Math.random() - 0.5) * 18;
      z += (Math.random() - 0.5) * 18;
    }
    this.bolt.geometry.setFromPoints(pts);
    this.flash = 1;
    this.onThunder?.(d / 340);
  }

  /** Force a strike now (used by tests and debugging). */
  triggerLightning(cp: THREE.Vector3): void { this.strike(cp); }

  dispose(): void {
    this.group.clear();
  }
}

/** Wrap a world-space-relative offset into [-box, box] around the camera. */
function wrap(v: number, cam: number, box: number): number {
  const range = box * 2;
  let r = (v - cam) % range;
  if (r > box) r -= range;
  if (r < -box) r += range;
  return r;
}
