import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

/**
 * Frosted glass needs to see what is behind it. Each frame, when a glass
 * material is in use, the background alone (gradient, aurora, media, stars)
 * is drawn into a small target and blurred; glass materials sample it at
 * their own screen position.
 *
 * Objects that belong to the backdrop are put on BACKDROP_LAYER as well as
 * the default layer, so the main render still includes them.
 */
export const BACKDROP_LAYER = 1;

/** Shared by every glass material, so updating the value updates them all. */
export const backdropUniforms = {
  tBackdrop: { value: null as THREE.Texture | null },
  uScreen: { value: new THREE.Vector2(1, 1) },
};

const BLUR_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 uStep;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tDiffuse, vUv).rgb * 0.227027;
  c += texture2D(tDiffuse, vUv + uStep * 1.3846).rgb * 0.316216;
  c += texture2D(tDiffuse, vUv - uStep * 1.3846).rgb * 0.316216;
  c += texture2D(tDiffuse, vUv + uStep * 3.2308).rgb * 0.070270;
  c += texture2D(tDiffuse, vUv - uStep * 3.2308).rgb * 0.070270;
  gl_FragColor = vec4(c, 1.0);
}`;

const BLUR_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

export class Backdrop {
  private a: THREE.WebGLRenderTarget;
  private b: THREE.WebGLRenderTarget;
  private quad: FullScreenQuad;
  private blurMat: THREE.ShaderMaterial;
  private size = new THREE.Vector2();
  /** 0 = barely frosted, 1 = heavily frosted. */
  frost = 0.6;

  constructor() {
    const opts = { type: THREE.HalfFloatType, depthBuffer: true, stencilBuffer: false };
    this.a = new THREE.WebGLRenderTarget(4, 4, opts);
    this.b = new THREE.WebGLRenderTarget(4, 4, { ...opts, depthBuffer: false });
    this.blurMat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, uStep: { value: new THREE.Vector2() } },
      vertexShader: BLUR_VERT,
      fragmentShader: BLUR_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.blurMat);
    backdropUniforms.tBackdrop.value = this.a.texture;
  }

  /** Draw the backdrop layer for `camera` into the blurred target. */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    renderer.getDrawingBufferSize(this.size);
    backdropUniforms.uScreen.value.copy(this.size);
    // A quarter of the resolution is plenty for something about to be blurred.
    const w = Math.max(4, Math.round(this.size.x / 4));
    const h = Math.max(4, Math.round(this.size.y / 4));
    if (this.a.width !== w || this.a.height !== h) { this.a.setSize(w, h); this.b.setSize(w, h); }

    const prevTarget = renderer.getRenderTarget();
    const prevMask = camera.layers.mask;
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = true;

    camera.layers.set(BACKDROP_LAYER);
    renderer.setRenderTarget(this.a);
    renderer.render(scene, camera);
    camera.layers.mask = prevMask;

    // Separable blur, repeated: more passes for a heavier frost.
    const passes = 1 + Math.round(this.frost * 3);
    const spread = 0.8 + this.frost * 1.2;
    for (let i = 0; i < passes; i++) {
      this.blurMat.uniforms.tDiffuse.value = this.a.texture;
      this.blurMat.uniforms.uStep.value.set(spread / w, 0);
      renderer.setRenderTarget(this.b);
      this.quad.render(renderer);
      this.blurMat.uniforms.tDiffuse.value = this.b.texture;
      this.blurMat.uniforms.uStep.value.set(0, spread / h);
      renderer.setRenderTarget(this.a);
      this.quad.render(renderer);
    }

    renderer.setRenderTarget(prevTarget);
    renderer.autoClear = prevAutoClear;
  }

  dispose() {
    this.a.dispose();
    this.b.dispose();
    this.blurMat.dispose();
    this.quad.dispose();
  }
}
