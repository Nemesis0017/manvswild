import * as THREE from 'three';
import { waterUniforms } from './water';

interface Key { t: number; top: THREE.Color; horizon: THREE.Color; sun: number; amb: number }
const c = (hex: number) => new THREE.Color(hex);
const KEYS: Key[] = [
  { t: 0.0, top: c(0x050816), horizon: c(0x0c1226), sun: 0, amb: 0.12 },
  { t: 0.22, top: c(0x0a1030), horizon: c(0x1a1c34), sun: 0, amb: 0.16 },
  { t: 0.27, top: c(0x3a5a9a), horizon: c(0xf0a070), sun: 0.5, amb: 0.35 },
  { t: 0.36, top: c(0x3f86d6), horizon: c(0xbcd8f0), sun: 1, amb: 0.6 },
  { t: 0.5, top: c(0x2e7ad8), horizon: c(0xb6d6f2), sun: 1.1, amb: 0.7 },
  { t: 0.66, top: c(0x3f86d6), horizon: c(0xc4d8ea), sun: 1, amb: 0.6 },
  { t: 0.74, top: c(0x4a4f9a), horizon: c(0xf08a5a), sun: 0.5, amb: 0.35 },
  { t: 0.79, top: c(0x0a1030), horizon: c(0x2a1e3a), sun: 0, amb: 0.16 },
  { t: 1.0, top: c(0x050816), horizon: c(0x0c1226), sun: 0, amb: 0.12 },
];

const VERT = `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`;
const FRAG = `
uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uSunDir; uniform float uStars; uniform float uTime;
varying vec3 vDir;
float hash(vec3 p){ p = fract(p*0.3183099+0.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
void main(){
  vec3 d = normalize(vDir);
  float t = clamp(d.y, 0.0, 1.0);
  vec3 col = mix(uHorizon, uTop, pow(t, 0.55));
  float sd = max(dot(d, uSunDir), 0.0);
  col += vec3(1.0,0.85,0.55) * (pow(sd, 400.0)*2.0 + pow(sd, 8.0)*0.25);
  vec3 g = floor(d*220.0);
  float st = step(0.9965, hash(g)) * uStars * smoothstep(0.0,0.2,d.y);
  col += vec3(st);
  gl_FragColor = vec4(col, 1.0);
}`;

/** Sky dome, sun light and day/night cycle. timeOfDay in [0,1): 0.5 is noon. */
export class Sky {
  readonly mesh: THREE.Mesh;
  readonly sun = new THREE.DirectionalLight(0xfff2d8, 1.2);
  readonly hemi = new THREE.HemisphereLight(0xbfd8ff, 0x445533, 0.6);
  readonly fogColor = new THREE.Color();
  timeOfDay = 0.38;
  /** seconds for a full day */
  dayLength = 20 * 60;
  private uniforms = {
    uTop: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uStars: { value: 0 },
    uTime: { value: 0 },
  };
  private sunDir = new THREE.Vector3();

  constructor(shadowSize: number, shadows: boolean) {
    const geo = new THREE.SphereGeometry(1, 24, 16);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: THREE.BackSide,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
    this.configureShadows(shadowSize, shadows);
  }

  configureShadows(size: number, enabled: boolean): void {
    this.sun.castShadow = enabled;
    this.sun.shadow.mapSize.set(size, size);
    const cam = this.sun.shadow.camera;
    cam.left = cam.bottom = -70;
    cam.right = cam.top = 70;
    cam.near = 1;
    cam.far = 400;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.5;
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
  }

  update(dt: number, center: THREE.Vector3): void {
    this.timeOfDay = (this.timeOfDay + dt / this.dayLength) % 1;
    this.apply(center);
  }

  apply(center: THREE.Vector3): void {
    const t = this.timeOfDay;
    let i = 0;
    while (i < KEYS.length - 2 && t > KEYS[i + 1].t) i++;
    const k0 = KEYS[i], k1 = KEYS[i + 1];
    const f = (t - k0.t) / (k1.t - k0.t);
    this.uniforms.uTop.value.copy(k0.top).lerp(k1.top, f);
    this.uniforms.uHorizon.value.copy(k0.horizon).lerp(k1.horizon, f);
    const sunI = k0.sun + (k1.sun - k0.sun) * f;
    const amb = k0.amb + (k1.amb - k0.amb) * f;

    const ang = (t - 0.25) * Math.PI * 2; // sunrise at 0.25
    this.sunDir.set(Math.cos(ang) * 0.8, Math.sin(ang), 0.45).normalize();
    this.uniforms.uSunDir.value.copy(this.sunDir);
    this.uniforms.uStars.value = Math.max(0, 1 - sunI * 3 - amb);
    this.sun.intensity = Math.max(0, sunI) * 1.5;
    this.sun.color.setRGB(1, 0.85 + 0.15 * Math.min(1, sunI), 0.7 + 0.3 * Math.min(1, sunI));
    this.hemi.intensity = amb;
    this.sun.position.copy(center).addScaledVector(this.sunDir, 200);
    this.sun.target.position.copy(center);
    this.sun.target.updateMatrixWorld();
    this.mesh.position.copy(center);
    this.mesh.scale.setScalar(900);

    this.fogColor.copy(this.uniforms.uHorizon.value);
    waterUniforms.uSunDir.value.copy(this.sunDir);
    waterUniforms.uSky.value.copy(this.uniforms.uTop.value).lerp(this.uniforms.uHorizon.value, 0.4);
    waterUniforms.uFogColor.value.copy(this.fogColor);
    waterUniforms.uLight.value = Math.max(0.18, Math.min(1, amb * 1.3));
  }
}
