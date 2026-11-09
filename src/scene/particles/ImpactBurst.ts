import * as THREE from 'three';

const POOL_SIZE = 64;

/**
 * Two short-lived per-impact elements: a bright shock flash and an expanding
 * ring. Both are CPU-pooled (a few dozen slots), with all animation done in the
 * vertex shader from a single `birth` timestamp per instance.
 *
 *   Flash — radial bloom-targeted billboard. Pops to peak in ~25 ms, lingers
 *           ~120 ms total. Mass driven by note velocity.
 *   Ring  — thin annulus on the hit-line plane. Expands fast and fades over
 *           ~250 ms. Reads as the "shock front."
 *
 * Why two meshes vs. one big shader: blend equation, render-order, and the
 * SDF math are different enough that splitting is clearer than branching.
 */
export class ImpactBurst {
  readonly flashMesh: THREE.Mesh;
  readonly ringMesh: THREE.Mesh;

  private flashCursor = 0;
  private ringCursor = 0;
  private clock = 0;

  private flashBirth: Float32Array;
  private flashOrigin: Float32Array;
  private flashColor: Float32Array;
  private flashIntensity: Float32Array;
  private flashGeo: THREE.InstancedBufferGeometry;

  private ringBirth: Float32Array;
  private ringOrigin: Float32Array;
  private ringColor: Float32Array;
  private ringIntensity: Float32Array;
  private ringGeo: THREE.InstancedBufferGeometry;

  private flashMat: THREE.ShaderMaterial;
  private ringMat: THREE.ShaderMaterial;
  /** Recently-touched range — we only flag those attributes for upload. */
  private dirty = { lo: -1, hi: -1 };

  constructor() {
    // Per-instance state buffers.
    this.flashBirth     = new Float32Array(POOL_SIZE).fill(-9999);
    this.flashOrigin    = new Float32Array(POOL_SIZE * 3);
    this.flashColor     = new Float32Array(POOL_SIZE * 3);
    this.flashIntensity = new Float32Array(POOL_SIZE);
    this.ringBirth      = new Float32Array(POOL_SIZE).fill(-9999);
    this.ringOrigin     = new Float32Array(POOL_SIZE * 3);
    this.ringColor      = new Float32Array(POOL_SIZE * 3);
    this.ringIntensity  = new Float32Array(POOL_SIZE);

    this.flashGeo = this._buildInstancedQuad(this.flashBirth, this.flashOrigin, this.flashColor, this.flashIntensity);
    this.ringGeo  = this._buildInstancedQuad(this.ringBirth,  this.ringOrigin,  this.ringColor,  this.ringIntensity);

    this.flashMat = this._buildFlashMaterial();
    this.ringMat  = this._buildRingMaterial();

    this.flashMesh = new THREE.Mesh(this.flashGeo, this.flashMat);
    this.flashMesh.frustumCulled = false;
    this.flashMesh.renderOrder = 120;

    this.ringMesh = new THREE.Mesh(this.ringGeo, this.ringMat);
    this.ringMesh.frustumCulled = false;
    this.ringMesh.renderOrder = 115;
  }

  // ─────────────────────────────────────────────
  //  Emission
  // ─────────────────────────────────────────────

  /**
   * Spawn one impact at `(x, y)` with the given press colour and MIDI
   * velocity ∈ [0, 1]. Velocity drives flash brightness, ring radius,
   * and burst lifetime.
   */
  spawn(x: number, y: number, color: THREE.Color, velocity: number) {
    // Velocity → intensity: power curve so a soft note still pops a little,
    // a forte note blooms hard. min ~0.35, max ~1.6.
    const v01 = Math.max(0, Math.min(1, velocity));
    const intensity = 0.35 + 1.25 * Math.pow(v01, 0.7);

    // Flash slot.
    const fi = this.flashCursor;
    this.flashCursor = (this.flashCursor + 1) % POOL_SIZE;
    this.flashBirth[fi] = this.clock;
    this.flashOrigin[fi * 3 + 0] = x;
    this.flashOrigin[fi * 3 + 1] = y;
    this.flashOrigin[fi * 3 + 2] = 8;
    this.flashColor[fi * 3 + 0] = color.r;
    this.flashColor[fi * 3 + 1] = color.g;
    this.flashColor[fi * 3 + 2] = color.b;
    this.flashIntensity[fi] = intensity;

    // Primary ring at t=0.
    this._spawnRing(x, y, color, intensity, 0);
    // Mini secondary ring 30 ms later at 0.45× — adds the "double-tap" the
    // ear-eye pairing reads as percussive (Real Time VFX timing thread).
    this._spawnRing(x, y, color, intensity * 0.45, 0.03);

    // Mark dirty range for upload.
    this.dirty.lo = this.dirty.lo < 0 ? fi : Math.min(this.dirty.lo, fi);
    this.dirty.hi = Math.max(this.dirty.hi, fi);
  }

  private _spawnRing(x: number, y: number, color: THREE.Color, intensity: number, delay: number) {
    const i = this.ringCursor;
    this.ringCursor = (this.ringCursor + 1) % POOL_SIZE;
    this.ringBirth[i] = this.clock + delay;
    this.ringOrigin[i * 3 + 0] = x;
    this.ringOrigin[i * 3 + 1] = y;
    this.ringOrigin[i * 3 + 2] = 7;
    this.ringColor[i * 3 + 0] = color.r;
    this.ringColor[i * 3 + 1] = color.g;
    this.ringColor[i * 3 + 2] = color.b;
    this.ringIntensity[i] = intensity;
    this.dirty.lo = this.dirty.lo < 0 ? i : Math.min(this.dirty.lo, i);
    this.dirty.hi = Math.max(this.dirty.hi, i);
  }

  // ─────────────────────────────────────────────
  //  Frame update
  // ─────────────────────────────────────────────

  update(dt: number) {
    this.clock += dt;
    this.flashMat.uniforms.time.value = this.clock;
    this.ringMat.uniforms.time.value = this.clock;
    if (this.dirty.lo < 0) return;
    // InstancedBufferAttribute upload range. setUsage(DynamicDrawUsage) was
    // set at build time; flagging needsUpdate triggers re-upload.
    for (const geo of [this.flashGeo, this.ringGeo]) {
      const attrs = ['aBirth', 'aOrigin', 'aColor', 'aIntensity'] as const;
      for (const name of attrs) {
        const a = geo.getAttribute(name) as THREE.InstancedBufferAttribute;
        a.needsUpdate = true;
      }
    }
    this.dirty.lo = -1;
    this.dirty.hi = -1;
  }

  setVisible(v: boolean) {
    this.flashMesh.visible = v;
    this.ringMesh.visible = v;
  }

  setIntensityMultiplier(m: number) {
    this.flashMat.uniforms.globalScale.value = m;
    this.ringMat.uniforms.globalScale.value = m;
  }

  dispose() {
    this.flashGeo.dispose();
    this.ringGeo.dispose();
    this.flashMat.dispose();
    this.ringMat.dispose();
  }

  // ─────────────────────────────────────────────
  //  Internals
  // ─────────────────────────────────────────────

  private _buildInstancedQuad(birth: Float32Array, origin: Float32Array, color: Float32Array, intensity: Float32Array): THREE.InstancedBufferGeometry {
    const geo = new THREE.InstancedBufferGeometry();
    // Centered unit quad.
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      -0.5, -0.5, 0,
       0.5, -0.5, 0,
       0.5,  0.5, 0,
      -0.5,  0.5, 0,
    ]), 3));
    geo.setAttribute('corner', new THREE.BufferAttribute(new Float32Array([
      -1, -1,  1, -1,  1, 1,  -1, 1,
    ]), 2));
    geo.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1));

    const mk = (data: Float32Array, size: number) => {
      const a = new THREE.InstancedBufferAttribute(data, size);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    geo.setAttribute('aBirth',     mk(birth, 1));
    geo.setAttribute('aOrigin',    mk(origin, 3));
    geo.setAttribute('aColor',     mk(color, 3));
    geo.setAttribute('aIntensity', mk(intensity, 1));
    geo.instanceCount = POOL_SIZE;
    return geo;
  }

  private _buildFlashMaterial(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: {
        time: { value: 0 },
        globalScale: { value: 1 },
        // Peak diameter ~480 px on a loud note; ~2× the typical spark cone.
        // Research recipe: the flash must read as "bigger than the cause."
        baseSize: { value: 240 },
      },
      vertexShader: /* glsl */ `
        in vec2 corner;
        in float aBirth;
        in vec3 aOrigin;
        in vec3 aColor;
        in float aIntensity;
        out vec3 vColor;
        out vec2 vCorner;
        out float vAge01;
        out float vIntensity;

        uniform float time;
        uniform float globalScale;
        uniform float baseSize;

        // Anatomy of a 0.12 s flash:
        //   0–25 ms : explode in, slight overshoot
        //   25–120 ms : rapid decay
        // Encoded as: sizeCurve = smoothstep(0, .02, age) * (1 - smoothstep(.025, .12, age))
        // with an extra spike at t=0 (alpha-side only).
        float sizeProfile(float t){
          float pop  = smoothstep(0.0, 0.02, t);
          float fade = 1.0 - smoothstep(0.025, 0.12, t);
          return pop * fade;
        }

        void main(){
          float age = time - aBirth;
          vAge01 = age / 0.12;
          vIntensity = aIntensity;
          vColor = aColor;
          vCorner = corner;

          if (age < 0.0 || age > 0.12) {
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return;
          }

          float s = sizeProfile(age) * aIntensity * globalScale;
          // Slight overshoot at peak: bonus 20% width briefly.
          float overshoot = 1.0 + 0.25 * (1.0 - smoothstep(0.0, 0.04, age));
          float size = baseSize * s * overshoot;

          // Camera-aligned billboard so the flash stays head-on in 3D too.
          vec3 camRight = vec3(modelViewMatrix[0][0], modelViewMatrix[1][0], modelViewMatrix[2][0]);
          vec3 camUp    = vec3(modelViewMatrix[0][1], modelViewMatrix[1][1], modelViewMatrix[2][1]);
          vec3 worldOffset = camRight * corner.x * size + camUp * corner.y * size;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(aOrigin + worldOffset, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        in vec3 vColor;
        in vec2 vCorner;
        in float vAge01;
        in float vIntensity;
        out vec4 outColor;

        void main(){
          float d = length(vCorner);
          // Sharp bright core + soft halo: two superimposed gaussians.
          float core = exp(-d * d * 8.0);
          float halo = exp(-d * d * 1.8) * 0.4;
          float a = core + halo;
          if (a < 0.01) discard;

          // HDR-white tinted with the press colour. Values >>1 so bloom picks
          // the core up hard — research's "the flash IS the bloom anchor."
          vec3 hot  = vec3(5.0, 4.4, 3.4);
          vec3 warm = vColor * 2.0 + vec3(0.6, 0.5, 0.3);
          vec3 col = mix(hot, warm, smoothstep(0.0, 0.6, vAge01));
          outColor = vec4(col * a * vIntensity, a);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });
  }

  private _buildRingMaterial(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: {
        time: { value: 0 },
        globalScale: { value: 1 },
        // Peak radius ~330 px on a loud note — shockwave reaches the next
        // 2-3 keys, then thins away.
        baseRadius: { value: 200 },
        lifetime: { value: 0.32 },
      },
      vertexShader: /* glsl */ `
        in vec2 corner;
        in float aBirth;
        in vec3 aOrigin;
        in vec3 aColor;
        in float aIntensity;
        out vec3 vColor;
        out vec2 vCorner;
        out float vAge01;
        out float vIntensity;

        uniform float time;
        uniform float globalScale;
        uniform float baseRadius;
        uniform float lifetime;

        void main(){
          float age = time - aBirth;
          vAge01 = clamp(age / lifetime, 0.0, 1.0);
          vIntensity = aIntensity;
          vColor = aColor;
          vCorner = corner;

          if (age < 0.0 || age > lifetime) {
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return;
          }

          // Radius curve: quick initial expansion, then ease-out.
          float r = (1.0 - pow(1.0 - vAge01, 2.4)) * baseRadius * (0.7 + 0.6 * aIntensity) * globalScale;

          vec3 camRight = vec3(modelViewMatrix[0][0], modelViewMatrix[1][0], modelViewMatrix[2][0]);
          vec3 camUp    = vec3(modelViewMatrix[0][1], modelViewMatrix[1][1], modelViewMatrix[2][1]);
          // Quad spans 2r along both axes — fragment shader carves the ring out of it.
          vec3 worldOffset = camRight * corner.x * r + camUp * corner.y * r;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(aOrigin + worldOffset, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        in vec3 vColor;
        in vec2 vCorner;
        in float vAge01;
        in float vIntensity;
        out vec4 outColor;

        void main(){
          float d = length(vCorner);
          if (d > 1.0) discard;
          // Annulus around r=0.78, thinning over life.
          float ringR = 0.78;
          float thickness = mix(0.18, 0.05, vAge01);
          float ring = 1.0 - smoothstep(thickness * 0.5, thickness, abs(d - ringR));
          if (ring < 0.02) discard;
          // Brightness fades quadratically — fast attack, faster decay.
          float fade = pow(1.0 - vAge01, 1.6);
          vec3 col = vColor * 1.8 + vec3(0.6, 0.45, 0.3);
          outColor = vec4(col * ring * fade * vIntensity, ring * fade);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });
  }
}
