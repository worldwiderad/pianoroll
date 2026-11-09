import * as THREE from 'three';
import { SIMPLEX_3D, RAMP_SAMPLE } from './shaders';

export interface SpawnEntry {
  pos: [number, number, number];
  vel: [number, number, number];
  /** Per-particle lifetime in seconds. */
  lifetime: number;
  /** Spawn-time HDR colour (typically the press colour or a layer-specific tint). */
  color: [number, number, number];
  /** Random in [0, 1] — drives per-particle variation in shaders. */
  seed: number;
}

export interface LayerOptions {
  name: string;
  /** Tex-side size; total particle count = texSize². 64 → 4096, 32 → 1024. */
  texSize: number;
  /** Force-field strength of curl noise on velocity (px/s² scale-ish). */
  curl: number;
  /** Spatial scale of the curl-noise field. Smaller = larger swirls. */
  curlScale: number;
  /** Constant downward (-Y) acceleration; negative = drift upward (embers). */
  gravity: number;
  /** Velocity decay per second (exp drag). */
  drag: number;
  /** Base render size of each billboard quad in world units. */
  size: number;
  /** Multiplier applied to size by the screen-space velocity magnitude. 0 = round. */
  stretch: number;
  /** Three HDR colour stops for the lifetime ramp (start → mid → end). >1 values bloom. */
  ramp: [THREE.Color, THREE.Color, THREE.Color];
  /** Render blend mode — `Additive` for hot layers, `Normal` for smoke/glow. */
  blending: THREE.Blending;
  /** Initial render order (lower = drawn first). */
  renderOrder: number;
  /** Soft edge falloff exponent for the billboard SDF. */
  softness: number;
}

/**
 * One GPU-simulated particle layer.
 *
 * State lives in three RGBA-float textures (position+age, velocity+lifetime,
 * colour+seed), ping-ponged between two MRT render targets. Each frame the
 * simulation shader runs once over a full-screen quad — every texel is one
 * particle. CPU writes spawn batches into a small DataTexture and the sim
 * shader respawns the matching slots.
 *
 * Rendering: one InstancedMesh of unit quads; the vertex shader samples the
 * three state textures by per-instance UV, then offsets/rotates the quad in
 * clip space to face the camera (and stretch along the screen-space velocity
 * vector for sparks).
 */
export class ParticleLayer {
  readonly mesh: THREE.Mesh;
  enabled = true;
  /** Per-layer intensity multiplier applied to spawn brightness + size. */
  intensity = 1;
  private opts: LayerOptions;
  private numParticles: number;
  private rt: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private current: 0 | 1 = 0;
  private simMat: THREE.ShaderMaterial;
  private simScene: THREE.Scene;
  private simCam: THREE.OrthographicCamera;
  private renderMat: THREE.ShaderMaterial;
  private spawnTex: THREE.DataTexture;
  private spawnTexWidth: number;
  private spawnQueue: SpawnEntry[] = [];
  private slotCursor = 0;
  private rampTex: THREE.DataTexture;
  private clock = 0;

  constructor(opts: LayerOptions) {
    this.opts = opts;
    const N = opts.texSize;
    this.numParticles = N * N;
    this.spawnTexWidth = 256; // max spawns drained per frame

    // ── State textures (MRT, 3 attachments × ping-pong) ──
    const targetOpts: THREE.RenderTargetOptions = {
      count: 3,
      type: THREE.FloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    };
    this.rt = [
      new THREE.WebGLRenderTarget(N, N, targetOpts),
      new THREE.WebGLRenderTarget(N, N, targetOpts),
    ];
    // Tag the textures so debug logs can tell them apart.
    this.rt.forEach((rt, i) => rt.textures.forEach((t, j) => {
      t.name = `${opts.name}.rt${i}.attach${j}`;
    }));

    // ── Spawn-batch DataTexture (3 rows: pos+life, vel+seed, color) ──
    const spawnData = new Float32Array(this.spawnTexWidth * 3 * 4);
    this.spawnTex = new THREE.DataTexture(
      spawnData, this.spawnTexWidth, 3,
      THREE.RGBAFormat, THREE.FloatType,
    );
    this.spawnTex.minFilter = THREE.NearestFilter;
    this.spawnTex.magFilter = THREE.NearestFilter;
    this.spawnTex.needsUpdate = true;

    // ── Lifetime ramp (1 × 64 RGBA, linear-interp through 3 HDR stops) ──
    this.rampTex = this._buildRampTexture(opts.ramp);

    // ── Simulation shader ──
    this.simMat = this._buildSimMaterial();
    this.simScene = new THREE.Scene();
    this.simCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const simQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.simMat);
    simQuad.frustumCulled = false;
    this.simScene.add(simQuad);

    // Initialise both ping-pong targets to "dead" state (age >= lifetime).
    // Sim shader's respawn branch will fill slots as spawns arrive.

    // ── Render mesh ──
    this.renderMat = this._buildRenderMaterial();
    const geo = this._buildInstancedQuad();
    this.mesh = new THREE.Mesh(geo, this.renderMat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = opts.renderOrder;
  }

  // ─────────────────────────────────────────────
  //  API
  // ─────────────────────────────────────────────

  emit(spawn: SpawnEntry) {
    if (!this.enabled) return;
    this.spawnQueue.push(spawn);
  }

  /** Run one simulation step + push render-uniforms. Must be called with the active renderer. */
  update(dt: number, renderer: THREE.WebGLRenderer) {
    if (!this.enabled) return;
    this.clock += dt;

    // Drain the spawn queue into the batch DataTexture.
    const spawnCount = Math.min(this.spawnQueue.length, this.spawnTexWidth);
    if (spawnCount > 0) {
      const data = this.spawnTex.image.data as Float32Array;
      for (let i = 0; i < spawnCount; i++) {
        const s = this.spawnQueue[i];
        const base = i * 4; // row 0: pos+lifetime
        data[base + 0] = s.pos[0];
        data[base + 1] = s.pos[1];
        data[base + 2] = s.pos[2];
        data[base + 3] = s.lifetime;
        const baseV = (this.spawnTexWidth + i) * 4; // row 1: vel+seed
        data[baseV + 0] = s.vel[0];
        data[baseV + 1] = s.vel[1];
        data[baseV + 2] = s.vel[2];
        data[baseV + 3] = s.seed;
        const baseC = (this.spawnTexWidth * 2 + i) * 4; // row 2: color
        data[baseC + 0] = s.color[0];
        data[baseC + 1] = s.color[1];
        data[baseC + 2] = s.color[2];
        data[baseC + 3] = 1.0;
      }
      this.spawnTex.needsUpdate = true;
    }
    // Even if no spawns this frame, advance shader state safely.
    this.spawnQueue.length = 0;

    const read = this.rt[this.current];
    const write = this.rt[1 - this.current];

    const u = this.simMat.uniforms;
    u.posTex.value = read.textures[0];
    u.velTex.value = read.textures[1];
    u.colTex.value = read.textures[2];
    u.spawnTex.value = this.spawnTex;
    u.spawnSlotStart.value = this.slotCursor;
    u.spawnCount.value = spawnCount;
    u.dt.value = Math.min(dt, 0.033); // clamp to ~30fps to avoid catastrophic step
    u.time.value = this.clock;

    // Restore prior renderer state after the off-screen pass.
    const prevTarget = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = true;
    renderer.setRenderTarget(write);
    renderer.render(this.simScene, this.simCam);
    renderer.setRenderTarget(prevTarget);
    renderer.autoClear = prevAutoClear;

    // Advance ring-buffer cursor + ping-pong.
    this.slotCursor = (this.slotCursor + spawnCount) % this.numParticles;
    this.current = (1 - this.current) as 0 | 1;

    // Push the latest state to the render material.
    const r = this.renderMat.uniforms;
    r.posTex.value = write.textures[0];
    r.velTex.value = write.textures[1];
    r.colTex.value = write.textures[2];
    r.rampTex.value = this.rampTex;
    r.time.value = this.clock;
  }

  setBaseSize(size: number) { this.renderMat.uniforms.baseSize.value = size; }
  setVisible(v: boolean) { this.mesh.visible = v; }
  setEnabled(v: boolean) { this.enabled = v; this.mesh.visible = v; }
  setIntensity(v: number) { this.intensity = v; this.renderMat.uniforms.intensity.value = v; }
  setCurl(v: number) { this.simMat.uniforms.curlStrength.value = v; }
  setGravity(v: number) { this.simMat.uniforms.gravity.value = v; }

  dispose() {
    this.rt.forEach(rt => rt.dispose());
    this.spawnTex.dispose();
    this.rampTex.dispose();
    this.simMat.dispose();
    this.renderMat.dispose();
    this.mesh.geometry.dispose();
  }

  // ─────────────────────────────────────────────
  //  Internals
  // ─────────────────────────────────────────────

  private _buildRampTexture(stops: [THREE.Color, THREE.Color, THREE.Color]): THREE.DataTexture {
    const N = 64;
    const data = new Float32Array(N * 4);
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      let c: THREE.Color;
      if (t < 0.5) {
        c = new THREE.Color().lerpColors(stops[0], stops[1], t * 2);
      } else {
        c = new THREE.Color().lerpColors(stops[1], stops[2], (t - 0.5) * 2);
      }
      data[i * 4 + 0] = c.r;
      data[i * 4 + 1] = c.g;
      data[i * 4 + 2] = c.b;
      data[i * 4 + 3] = 1;
    }
    const tex = new THREE.DataTexture(data, N, 1, THREE.RGBAFormat, THREE.FloatType);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    return tex;
  }

  setRamp(stops: [THREE.Color, THREE.Color, THREE.Color]) {
    this.rampTex.dispose();
    this.rampTex = this._buildRampTexture(stops);
  }

  private _buildSimMaterial(): THREE.ShaderMaterial {
    const o = this.opts;
    return new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: {
        posTex: { value: null },
        velTex: { value: null },
        colTex: { value: null },
        spawnTex: { value: null },
        spawnSlotStart: { value: 0 },
        spawnCount: { value: 0 },
        spawnTexWidth: { value: this.spawnTexWidth },
        numParticles: { value: this.numParticles },
        texSize: { value: o.texSize },
        dt: { value: 0 },
        time: { value: 0 },
        curlStrength: { value: o.curl },
        curlScale: { value: o.curlScale },
        gravity: { value: o.gravity },
        drag: { value: o.drag },
      },
      vertexShader: /* glsl */ `
        out vec2 vUv;
        void main(){
          vUv = (position.xy + 1.0) * 0.5;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        ${SIMPLEX_3D}
        in vec2 vUv;
        layout(location = 0) out vec4 outPos;
        layout(location = 1) out vec4 outVel;
        layout(location = 2) out vec4 outCol;

        uniform sampler2D posTex;
        uniform sampler2D velTex;
        uniform sampler2D colTex;
        uniform sampler2D spawnTex;
        uniform float spawnSlotStart;
        uniform float spawnCount;
        uniform float spawnTexWidth;
        uniform float numParticles;
        uniform float texSize;
        uniform float dt;
        uniform float time;
        uniform float curlStrength;
        uniform float curlScale;
        uniform float gravity;
        uniform float drag;

        void main(){
          vec4 prevPos = texture(posTex, vUv);
          vec4 prevVel = texture(velTex, vUv);
          vec4 prevCol = texture(colTex, vUv);

          // Linearise this texel's slot index.
          vec2 px = floor(vUv * texSize);
          float slotIdx = px.x + px.y * texSize;

          // Wraparound-aware membership test for the spawn batch.
          float rel = mod(slotIdx - spawnSlotStart + numParticles, numParticles);
          bool isSpawning = (spawnCount > 0.5) && (rel < spawnCount);

          if (isSpawning) {
            float u = (rel + 0.5) / spawnTexWidth;
            vec4 sp = texture(spawnTex, vec2(u, 0.5 / 3.0));   // pos+life
            vec4 sv = texture(spawnTex, vec2(u, 1.5 / 3.0));   // vel+seed
            vec4 sc = texture(spawnTex, vec2(u, 2.5 / 3.0));   // color
            outPos = vec4(sp.xyz, 0.0);
            outVel = vec4(sv.xyz, sp.w);   // lifetime stored in vel.w
            outCol = vec4(sc.rgb, sv.w);   // seed stored in col.w
            return;
          }

          float age = prevPos.w;
          float lifetime = prevVel.w;
          if (lifetime <= 0.0 || age >= lifetime) {
            // Dead — keep the slot inert until respawn.
            outPos = vec4(prevPos.xyz, lifetime > 0.0 ? lifetime + 1.0 : 1.0);
            outVel = vec4(0.0, 0.0, 0.0, lifetime);
            outCol = prevCol;
            return;
          }

          // Force field: curl noise + gravity, integrated with simple drag.
          vec3 pos = prevPos.xyz;
          vec3 vel = prevVel.xyz;
          vec3 curl = curlNoise(pos * curlScale + vec3(0.0, time * 0.1, 0.0));
          vec3 force = curl * curlStrength + vec3(0.0, gravity, 0.0);
          vel = vel * exp(-drag * dt) + force * dt;
          pos += vel * dt;
          outPos = vec4(pos, age + dt);
          outVel = vec4(vel, lifetime);
          outCol = prevCol;
        }
      `,
      depthTest: false,
      depthWrite: false,
    });
  }

  private _buildRenderMaterial(): THREE.ShaderMaterial {
    const o = this.opts;
    return new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: {
        posTex: { value: null },
        velTex: { value: null },
        colTex: { value: null },
        rampTex: { value: null },
        baseSize: { value: o.size },
        stretchFactor: { value: o.stretch },
        softness: { value: o.softness },
        intensity: { value: 1 },
        time: { value: 0 },
        texSize: { value: o.texSize },
      },
      vertexShader: /* glsl */ `
        in vec2 corner;
        in vec2 slotUv;
        out vec3 vColor;
        out vec2 vCorner;
        out float vAge01;
        out float vSeed;
        out float vSpeed;

        uniform sampler2D posTex;
        uniform sampler2D velTex;
        uniform sampler2D colTex;
        uniform float baseSize;
        uniform float stretchFactor;
        uniform float intensity;
        uniform float texSize;

        void main(){
          vec4 P = texture(posTex, slotUv);
          vec4 V = texture(velTex, slotUv);
          vec4 C = texture(colTex, slotUv);
          float age = P.w;
          float lifetime = V.w;
          vAge01 = clamp(age / max(lifetime, 1e-4), 0.0, 1.0);
          vSeed  = C.w;
          vColor = C.rgb * intensity;
          vCorner = corner;
          vSpeed = length(V.xyz);

          // Cull dead slots by collapsing the quad to zero — push outside NDC.
          if (lifetime <= 0.0 || age >= lifetime) {
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
            return;
          }

          // Camera basis vectors (rows of the rotation block of modelViewMatrix).
          vec3 camRight   = vec3(modelViewMatrix[0][0], modelViewMatrix[1][0], modelViewMatrix[2][0]);
          vec3 camUp      = vec3(modelViewMatrix[0][1], modelViewMatrix[1][1], modelViewMatrix[2][1]);
          vec3 camForward = vec3(modelViewMatrix[0][2], modelViewMatrix[1][2], modelViewMatrix[2][2]);

          // Project velocity into the camera plane; that direction is what we
          // stretch the spark along on screen.
          vec3 vTan = V.xyz - dot(V.xyz, camForward) * camForward;
          float vLen = length(vTan);
          vec3 sDir = vLen > 1e-3 ? vTan / vLen : camRight;
          vec3 oDir = normalize(cross(camForward, sDir));

          // Size profile: grow into life, shrink toward end.
          float lifeProfile = sin(vAge01 * 3.14159);
          float size = baseSize * (0.7 + 0.5 * lifeProfile);
          float stretch = 1.0 + stretchFactor * min(vLen * 0.02, 3.0);

          vec3 worldOffset = sDir * corner.x * size * stretch
                           + oDir * corner.y * size;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(P.xyz + worldOffset, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        ${RAMP_SAMPLE}
        in vec3 vColor;
        in vec2 vCorner;
        in float vAge01;
        in float vSeed;
        in float vSpeed;
        out vec4 outColor;
        uniform sampler2D rampTex;
        uniform float softness;
        uniform float stretchFactor;

        void main(){
          // Soft SDF — radial falloff for round particles, biased toward the
          // leading edge for stretched ones (sparks).
          float d = length(vCorner);
          float core = pow(max(0.0, 1.0 - d), softness);
          if (core <= 0.0) discard;
          vec3 ramp = sampleRamp(rampTex, vAge01);
          vec3 col = vColor * ramp;

          // Spark tail-fade: only kicks in for strongly-stretched layers
          // (stretchFactor >= 1 in our presets, sparks=3.0). corner.x = +1 is
          // the leading tip in screen-space; brightness concentrates there.
          float tipMix = smoothstep(0.5, 2.0, stretchFactor);
          float tipBoost = mix(1.0, mix(0.15, 1.0, (vCorner.x + 1.0) * 0.5), tipMix);

          // Tiny seeded twinkle so a burst doesn't look like a regiment.
          float twinkle = 0.92 + 0.08 * sin(vSeed * 23.0 + vAge01 * 18.0);
          outColor = vec4(col * core * twinkle * tipBoost, core * tipBoost);
        }
      `,
      transparent: true,
      blending: o.blending,
      depthWrite: false,
      depthTest: false,
    });
  }

  /** N quads, each a unit square in xy[-0.5..0.5]. `slotUv` per instance picks the state texel. */
  private _buildInstancedQuad(): THREE.InstancedBufferGeometry {
    const geo = new THREE.InstancedBufferGeometry();
    // 4 verts × 2 tris (6 indices) for the quad
    const positions = new Float32Array([
      -0.5, -0.5, 0,
       0.5, -0.5, 0,
       0.5,  0.5, 0,
      -0.5,  0.5, 0,
    ]);
    const corners = new Float32Array([
      -1, -1,
       1, -1,
       1,  1,
      -1,  1,
    ]);
    const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('corner', new THREE.BufferAttribute(corners, 2));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));

    // One slotUv per instance — pointing at the texel that holds its state.
    const N = this.opts.texSize;
    const slotUvs = new Float32Array(this.numParticles * 2);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const i = (y * N + x) * 2;
        slotUvs[i + 0] = (x + 0.5) / N;
        slotUvs[i + 1] = (y + 0.5) / N;
      }
    }
    geo.setAttribute('slotUv', new THREE.InstancedBufferAttribute(slotUvs, 2));
    geo.instanceCount = this.numParticles;
    return geo;
  }
}
