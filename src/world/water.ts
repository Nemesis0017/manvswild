import * as THREE from 'three';
import { makeWaterNormalTexture } from './textures';
import { WATER_Y } from './terrain';

export const waterUniforms = {
  uTime: { value: 0 },
  uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3).normalize() },
  uSky: { value: new THREE.Color(0.55, 0.75, 0.95) },
  uDeep: { value: new THREE.Color(0.02, 0.18, 0.28) },
  uFogColor: { value: new THREE.Color(0.7, 0.8, 0.9) },
  uFogNear: { value: 80 },
  uFogFar: { value: 500 },
  uNormal: { value: null as THREE.Texture | null },
  uLight: { value: 1 },
};

const VERT = `
varying vec3 vWorld;
void main(){
  vec4 w = modelMatrix * vec4(position,1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const FRAG = `
uniform float uTime; uniform vec3 uSunDir; uniform vec3 uSky; uniform vec3 uDeep;
uniform vec3 uFogColor; uniform float uFogNear; uniform float uFogFar;
uniform sampler2D uNormal; uniform float uLight;
varying vec3 vWorld;
void main(){
  vec2 uv = vWorld.xz * 0.06;
  vec3 n1 = texture2D(uNormal, uv + vec2(uTime*0.02, uTime*0.013)).xyz*2.0-1.0;
  vec3 n2 = texture2D(uNormal, uv*1.7 - vec2(uTime*0.017, -uTime*0.021)).xyz*2.0-1.0;
  vec3 n = normalize(vec3((n1.x+n2.x)*0.5, 2.2, (n1.y+n2.y)*0.5));
  vec3 v = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  vec3 col = mix(uDeep, uSky, clamp(fres*0.9 + 0.15, 0.0, 1.0)) * uLight;
  vec3 h = normalize(uSunDir + v);
  col += vec3(1.0,0.95,0.8) * pow(max(dot(n,h),0.0), 180.0) * 1.4 * uLight;
  float d = length(cameraPosition - vWorld);
  float f = smoothstep(uFogNear, uFogFar, d);
  col = mix(col, uFogColor, f);
  gl_FragColor = vec4(col, mix(0.82, 0.95, fres));
}`;

export class Water {
  readonly mesh: THREE.Mesh;

  constructor() {
    waterUniforms.uNormal.value = makeWaterNormalTexture();
    const geo = new THREE.PlaneGeometry(2400, 2400, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.ShaderMaterial({
      uniforms: waterUniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.y = WATER_Y;
    this.mesh.renderOrder = 2;
    this.mesh.frustumCulled = false;
  }

  update(time: number, center: THREE.Vector3): void {
    waterUniforms.uTime.value = time;
    this.mesh.position.x = Math.round(center.x / 16) * 16;
    this.mesh.position.z = Math.round(center.z / 16) * 16;
  }
}

/** Animated sheet used for waterfalls. */
export function makeWaterfallMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: waterUniforms.uTime, uLight: waterUniforms.uLight },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: `varying vec2 vUv; varying vec3 vWorld; void main(){ vUv=uv; vec4 w=modelMatrix*vec4(position,1.0); vWorld=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `
      uniform float uTime; uniform float uLight; varying vec2 vUv; varying vec3 vWorld;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      void main(){
        float edge = smoothstep(0.0,0.2,vUv.x)*smoothstep(1.0,0.8,vUv.x);
        vec2 p = vec2(vUv.x*6.0, vUv.y*24.0 - uTime*5.0);
        float streak = h(floor(p)) ;
        float foam = smoothstep(0.55,1.0,streak);
        vec3 col = mix(vec3(0.45,0.7,0.85), vec3(0.95,0.98,1.0), foam) * uLight;
        gl_FragColor = vec4(col, edge*(0.55+0.35*foam));
      }`,
  });
}
