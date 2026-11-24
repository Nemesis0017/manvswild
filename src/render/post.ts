import * as THREE from 'three';
import { AfterimagePass } from 'three/examples/jsm/postprocessing/AfterimagePass.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { Settings } from '../core/settings';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uVignette: { value: 0 },
    uGrade: { value: 0 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uVignette; uniform float uGrade; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb;
      // 0 none, 1 warm, 2 cool, 3 filmic
      if (uGrade > 2.5) { col = (col - 0.5) * 1.12 + 0.5; float l = dot(col, vec3(0.299,0.587,0.114)); col = mix(vec3(l), col, 1.1); }
      else if (uGrade > 1.5) { col *= vec3(0.92, 1.0, 1.1); }
      else if (uGrade > 0.5) { col *= vec3(1.08, 1.0, 0.9); }
      float d = distance(vUv, vec2(0.5));
      col *= 1.0 - uVignette * smoothstep(0.35, 0.85, d);
      gl_FragColor = vec4(col, c.a);
    }`,
};

const GRADES: Record<Settings['colorGrade'], number> = { none: 0, warm: 1, cool: 2, filmic: 3 };

/** Optional post-processing chain. When every effect is off, the renderer draws straight to the screen. */
export class PostFx {
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private after: AfterimagePass;
  private grade: ShaderPass;
  private enabled = { bloom: false, vignette: false, grade: false, blur: false };

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.35, 0.6, 0.9);
    this.after = new AfterimagePass(0.7);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.after);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
  }

  /** True if any effect is active and the composer should be used. */
  get active(): boolean {
    const e = this.enabled;
    return e.bloom || e.vignette || e.grade || e.blur;
  }

  apply(s: Settings, reducedMotion: boolean): void {
    this.enabled = { bloom: s.bloom, vignette: s.vignette, grade: s.colorGrade !== 'none', blur: s.motionBlur && !reducedMotion };
    this.bloom.enabled = s.bloom;
    this.after.enabled = this.enabled.blur;
    this.grade.enabled = this.enabled.vignette || this.enabled.grade;
    this.grade.uniforms.uVignette.value = s.vignette ? 0.45 : 0;
    this.grade.uniforms.uGrade.value = GRADES[s.colorGrade];
  }

  setSize(w: number, h: number, pixelRatio: number): void {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(w, h);
  }

  render(dt: number): void {
    this.composer.render(dt);
  }

  dispose(): void {
    this.composer.dispose();
  }
}
