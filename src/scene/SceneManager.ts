import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Backdrop, BACKDROP_LAYER } from './Backdrop';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import type { Theme, CameraAngle, CameraMode } from '../theme/types';
import { MediaBackground } from './MediaBackground';

const VIGNETTE_VERT = `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
`;
const VIGNETTE_FRAG = `
uniform sampler2D tDiffuse;
uniform float intensity;
uniform float chromaIntensity;
varying vec2 vUv;
void main() {
  vec2 centered = vUv - 0.5;
  vec3 rgb;
  if (chromaIntensity > 0.0) {
    // Chromatic aberration: R + B shift outward from centre, G stays
    float off = chromaIntensity * 0.012;
    float r = texture2D(tDiffuse, vUv + centered * off).r;
    float g = texture2D(tDiffuse, vUv).g;
    float b = texture2D(tDiffuse, vUv - centered * off).b;
    rgb = vec3(r, g, b);
  } else {
    rgb = texture2D(tDiffuse, vUv).rgb;
  }
  float dist = length(centered);
  float vignette = smoothstep(0.8, 0.2, dist * intensity * 2.0);
  gl_FragColor = vec4(rgb * vignette, 1.0);
}
`;

const SCANLINE_FRAG = `
uniform sampler2D tDiffuse;
uniform float grainIntensity;
uniform float scanlineIntensity;
uniform float time;
varying vec2 vUv;
void main() {
  vec4 color = texture2D(tDiffuse, vUv);
  if (scanlineIntensity > 0.0) {
    float line = sin(vUv.y * 800.0) * 0.5 + 0.5;
    color.rgb = mix(color.rgb, color.rgb * line, scanlineIntensity * 0.35);
  }
  if (grainIntensity > 0.0) {
    float grain = fract(sin(dot(vUv + time, vec2(12.9898,78.233))) * 43758.5453) - 0.5;
    color.rgb += grain * grainIntensity * 0.08;
  }
  gl_FragColor = color;
}
`;

interface CamTarget {
  pos: THREE.Vector3;
  lookAt: THREE.Vector3;
}

/**
 * First-person stage view: camera at piano level looking forward and slightly up
 * into the falling-notes column. Distance is computed from the FOV so the full
 * 88-key width always fits in the frame regardless of aspect ratio.
 * `angle` is currently a no-op placeholder; only one tuned perspective is provided.
 */
function targetForAngle(_angle: CameraAngle, w: number, h: number): CamTarget {
  // Pick distance so the keyboard width fits horizontally with a small margin.
  const fovRad = 50 * Math.PI / 180;
  const aspect = w / h;
  const hFovRad = 2 * Math.atan(Math.tan(fovRad / 2) * aspect);
  const distance = (w / (2 * Math.tan(hFovRad / 2))) * 1.06;
  // Steeper upward look angle = keys feel more "underfoot" relative to the viewpoint.
  // Camera must drop below world Y=0 so the bottom of the view still reaches the
  // piano's bottom edge despite the steep tilt.
  const lookUpDeg = 35;
  const lookUpRad = lookUpDeg * Math.PI / 180;
  const camY = -distance * Math.tan(lookUpRad - fovRad / 2) - h * 0.02;
  const lookAtY = camY + distance * Math.tan(lookUpRad);
  return {
    pos: new THREE.Vector3(w / 2, camY, distance),
    lookAt: new THREE.Vector3(w / 2, lookAtY, 0),
  };
}

export class SceneManager {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  composer: EffectComposer;

  private orthoCam: THREE.OrthographicCamera;
  private perspCam: THREE.PerspectiveCamera;
  private currentCam: THREE.Camera;
  private renderPass: RenderPass;
  private cameraMode: CameraMode = 'ortho';
  private cameraAngle: CameraAngle = 'standard';
  private perspTarget: CamTarget;
  private perspLookAt = new THREE.Vector3();

  private bloomPass: UnrealBloomPass;
  private vignettePass: ShaderPass;
  private filmPass: ShaderPass;
  private outputPass: OutputPass;
  private bgMesh: THREE.Mesh;
  private bgMat: THREE.ShaderMaterial;
  private backdrop = new Backdrop();
  private glassActive = false;
  media: MediaBackground;
  private reflector: Reflector | null = null;
  private stars: THREE.Points | null = null;
  private starVels: Float32Array | null = null;
  private container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
    const w = container.clientWidth, h = container.clientHeight;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(w, h);
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1;
    container.appendChild(this.renderer.domElement);

    this.orthoCam = new THREE.OrthographicCamera(0, w, h, 0, -100, 100);
    this.perspCam = new THREE.PerspectiveCamera(50, w / h, 1, 5000);
    this.perspTarget = targetForAngle('standard', w, h);
    this.perspCam.position.copy(this.perspTarget.pos);
    this.perspLookAt.copy(this.perspTarget.lookAt);
    this.perspCam.lookAt(this.perspLookAt);

    this.currentCam = this.orthoCam;
    this.scene = new THREE.Scene();

    // Lights (no-op for MeshBasicMaterial; will activate for PBR Stage 1 sub-feature)
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.45));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.7);
    dirLight.position.set(w * 0.4, h * 1.2, h * 0.8);
    this.scene.add(dirLight);

    // Background plane
    this.bgMat = new THREE.ShaderMaterial({
      uniforms: {
        colorA: { value: new THREE.Color('#080810') },
        colorB: { value: new THREE.Color('#0d0820') },
        colorC: { value: new THREE.Color('#080810') },
        useGradient: { value: 1.0 },
        aurora: { value: 0 },
        auroraA: { value: new THREE.Color('#ff4fd8') },
        auroraB: { value: new THREE.Color('#6a5cff') },
        auroraC: { value: new THREE.Color('#22d3ee') },
        auroraD: { value: new THREE.Color('#ff9a3c') },
        uTime: { value: 0 },
        uSize: { value: new THREE.Vector2(w, h) },
      },
      vertexShader: `
        varying vec2 vUv; varying vec2 vWorld;
        void main() {
          vUv = uv;
          vWorld = (modelMatrix * vec4(position, 1.0)).xy;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 colorA; uniform vec3 colorB; uniform vec3 colorC;
        uniform float useGradient;
        uniform float aurora;
        uniform vec3 auroraA; uniform vec3 auroraB; uniform vec3 auroraC; uniform vec3 auroraD;
        uniform float uTime;
        uniform vec2 uSize;
        varying vec2 vUv; varying vec2 vWorld;
        // One soft glow drifting on its own slow loop.
        float blob(vec2 s, vec2 home, vec2 swing, float speed, float phase, float r) {
          vec2 c = home + swing * vec2(sin(uTime * speed + phase), cos(uTime * speed * 0.73 + phase * 1.7));
          // Measure against the shorter side, so glows keep their size in portrait.
          vec2 d = (s - c) * uSize / min(uSize.x, uSize.y);
          return exp(-dot(d, d) / (r * r));
        }
        float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        void main() {
          vec3 col = mix(colorA, colorB, smoothstep(0.0, 0.5, vUv.y));
          col = mix(col, colorC, smoothstep(0.5, 1.0, vUv.y));
          col = mix(colorA, col, useGradient);
          if (aurora > 0.5) {
            vec2 s = vWorld / uSize;
            col += auroraA * blob(s, vec2(0.16, 0.74), vec2(0.12, 0.10), 0.11, 0.0, 0.30) * 0.62;
            col += auroraB * blob(s, vec2(0.56, 0.92), vec2(0.18, 0.06), 0.08, 2.1, 0.34) * 0.55;
            col += auroraC * blob(s, vec2(0.88, 0.52), vec2(0.08, 0.16), 0.10, 4.2, 0.28) * 0.5;
            // The fourth glow lives low, behind the keyboard, so glass keys
            // have colour to show.
            col += auroraD * blob(s, vec2(0.42, 0.10), vec2(0.24, 0.05), 0.07, 1.3, 0.30) * 0.5;
            // Dither so the long soft gradients do not band.
            col += (hash(gl_FragCoord.xy + fract(uTime)) - 0.5) / 255.0;
          }
          gl_FragColor = vec4(col, 1.0);
        }
      `,
      depthWrite: false,
    });
    this.bgMesh = new THREE.Mesh(new THREE.PlaneGeometry(w * 2.5, h * 2.5), this.bgMat);
    this.bgMesh.position.set(w / 2, h / 2, -50);
    this.bgMesh.layers.enable(BACKDROP_LAYER);
    this.scene.add(this.bgMesh);

    this.media = new MediaBackground(this.scene, w, h);
    this.media.enableLayer(BACKDROP_LAYER);

    // Post-processing
    this.composer = new EffectComposer(this.renderer);
    this.renderPass = new RenderPass(this.scene, this.currentCam);
    this.composer.addPass(this.renderPass);

    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 1.2, 0.6, 0.15);
    this.composer.addPass(this.bloomPass);

    this.vignettePass = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        intensity: { value: 0.4 },
        chromaIntensity: { value: 0 },
      },
      vertexShader: VIGNETTE_VERT,
      fragmentShader: VIGNETTE_FRAG,
    });
    this.composer.addPass(this.vignettePass);

    this.filmPass = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        grainIntensity: { value: 0 },
        scanlineIntensity: { value: 0 },
        time: { value: 0 },
      },
      vertexShader: VIGNETTE_VERT,
      fragmentShader: SCANLINE_FRAG,
    });
    this.filmPass.enabled = false;
    this.composer.addPass(this.filmPass);

    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);

    window.addEventListener('resize', this._onResize);
  }

  /** Back-compat: legacy code referenced `sm.camera`. Always returns the active camera. */
  get camera(): THREE.Camera { return this.currentCam; }

  /** Swap the active camera (used by view modes / external orbit camera). */
  useCamera(cam: THREE.Camera) {
    this.currentCam = cam;
    this.renderPass.camera = cam;
  }

  /** Restore the camera selected by theme.view.cameraMode (ortho / perspective). */
  useThemeCamera() {
    this.currentCam = this.cameraMode === 'perspective' ? this.perspCam : this.orthoCam;
    this.renderPass.camera = this.currentCam;
  }

  /** Toggle starfield + bg-plane + media + reflector visibility (hidden in 3D composition view). */
  setBackgroundVisible(visible: boolean) {
    if (this.stars) this.stars.visible = visible;
    this.bgMesh.visible = visible;
    this.media.setVisible(visible);
    if (this.reflector) this.reflector.visible = visible;
  }

  private _onResize = () => {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);

    this.orthoCam.right = w; this.orthoCam.top = h;
    this.orthoCam.updateProjectionMatrix();

    this.perspCam.aspect = w / h;
    this.perspCam.updateProjectionMatrix();
    this.perspTarget = targetForAngle(this.cameraAngle, w, h);

    this.bgMesh.geometry.dispose();
    this.bgMesh.geometry = new THREE.PlaneGeometry(w * 2.5, h * 2.5);
    this.bgMesh.position.set(w / 2, h / 2, -50);
    this.bgMat.uniforms.uSize.value.set(w, h);
    this.media.setSize(w, h);
    if (this.reflector) {
      this.reflector.geometry.dispose();
      this.reflector.geometry = new THREE.PlaneGeometry(w * 4, h * 4);
      this.reflector.position.set(w / 2, -2, 0);
    }
    this.bloomPass.resolution.set(w, h);
  };

  applyTheme(t: Theme) {
    const bg = t.background;
    this.bgMat.uniforms.colorA.value.set(bg.gradientStops[0]);
    this.bgMat.uniforms.colorB.value.set(bg.gradientStops[1]);
    this.bgMat.uniforms.colorC.value.set(bg.gradientStops[2]);
    this.bgMat.uniforms.useGradient.value = bg.gradient ? 1 : 0;
    if (!bg.gradient) this.bgMat.uniforms.colorA.value.set(bg.color);
    this.bgMat.uniforms.aurora.value = bg.aurora ? 1 : 0;
    const ac = bg.auroraColors;
    this.bgMat.uniforms.auroraA.value.set(ac[0]);
    this.bgMat.uniforms.auroraB.value.set(ac[1]);
    this.bgMat.uniforms.auroraC.value.set(ac[2]);
    this.bgMat.uniforms.auroraD.value.set(ac[3]);
    // Run the backdrop pass only while something made of glass is on screen.
    this.glassActive = t.notes.glass > 0.001 || t.piano.style === 'glass';
    this.backdrop.frost = t.effects.frost;

    this.bloomPass.enabled = t.effects.bloom;
    this.bloomPass.strength = t.effects.bloomStrength;
    this.bloomPass.threshold = t.effects.bloomThreshold;
    this.bloomPass.radius = t.effects.bloomRadius;

    // Vignette pass also handles chromatic aberration; enable if either is on.
    this.vignettePass.enabled = t.effects.vignette || t.effects.chromaticAberration;
    this.vignettePass.uniforms.intensity.value = t.effects.vignette ? t.effects.vignetteIntensity : 0;
    this.vignettePass.uniforms.chromaIntensity.value = t.effects.chromaticAberration ? t.effects.chromaticAberrationIntensity : 0;

    this.filmPass.enabled = t.effects.filmGrain || bg.scanlines;
    this.filmPass.uniforms.grainIntensity.value = t.effects.filmGrain ? t.effects.filmGrainIntensity : 0;
    this.filmPass.uniforms.scanlineIntensity.value = bg.scanlines ? 1.0 : 0;

    if (bg.starfield && !this.stars) this._buildStars();
    if (!bg.starfield && this.stars) { this.scene.remove(this.stars); this.stars = null; }

    this.media.apply(bg.media ?? null);

    if (t.view.reflectiveFloor) {
      this._buildReflector();
    } else {
      this._destroyReflector();
    }

    // Camera mode / angle
    this.cameraAngle = t.view.cameraAngle;
    this.perspTarget = targetForAngle(this.cameraAngle, this.container.clientWidth, this.container.clientHeight);
    if (t.view.cameraMode !== this.cameraMode) {
      this.cameraMode = t.view.cameraMode;
      this.currentCam = this.cameraMode === 'perspective' ? this.perspCam : this.orthoCam;
      this.renderPass.camera = this.currentCam;
    }
  }

  /** Lerp the perspective camera toward its target each frame. */
  update(dt: number) {
    if (this.cameraMode !== 'perspective') return;
    const lerp = 1 - Math.exp(-dt * 6); // ~6/s convergence; ~0.6s for 95%
    this.perspCam.position.lerp(this.perspTarget.pos, lerp);
    this.perspLookAt.lerp(this.perspTarget.lookAt, lerp);
    this.perspCam.lookAt(this.perspLookAt);
  }

  // Starfield spans a region wider/taller than the 2D viewport so the tilted
  // perspective camera (which sees up to ~1.7×sceneH along Y) still has stars
  // filling its frame. In 2D ortho mode the extras render off-screen and clip.
  private static readonly STAR_X_MARGIN = 0.3; // ±30% of width outside viewport
  private static readonly STAR_Y_TOP = 2.2;    // stars spawn up to 2.2×h above bottom
  private static readonly STAR_Y_BOTTOM = -0.2; // …and as low as -0.2×h

  private _buildStars() {
    const N = 1500;
    const w = this.container.clientWidth, h = this.container.clientHeight;
    const xMin = -w * SceneManager.STAR_X_MARGIN;
    const xRange = w * (1 + 2 * SceneManager.STAR_X_MARGIN);
    const yMin = h * SceneManager.STAR_Y_BOTTOM;
    const yRange = h * (SceneManager.STAR_Y_TOP - SceneManager.STAR_Y_BOTTOM);
    const pos = new Float32Array(N * 3);
    this.starVels = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = xMin + Math.random() * xRange;
      pos[i * 3 + 1] = yMin + Math.random() * yRange;
      pos[i * 3 + 2] = -40;
      this.starVels[i] = 8 + Math.random() * 20;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.5, sizeAttenuation: false, transparent: true, opacity: 0.4 });
    this.stars = new THREE.Points(geo, mat);
    this.stars.layers.enable(BACKDROP_LAYER);
    this.scene.add(this.stars);
  }

  private _buildReflector() {
    if (this.reflector) return;
    const w = this.container.clientWidth, h = this.container.clientHeight;
    const geo = new THREE.PlaneGeometry(w * 4, h * 4);
    this.reflector = new Reflector(geo, {
      clipBias: 0.003,
      // Half-res capture: cheap, plenty for a low-detail floor reflection.
      textureWidth: Math.max(256, Math.floor(w / 2)),
      textureHeight: Math.max(256, Math.floor(h / 2)),
      color: 0x202028,
    });
    this.reflector.rotation.x = -Math.PI / 2;
    // Just below the piano's bottom edge so reflections appear right at the keyboard.
    this.reflector.position.set(w / 2, -2, 0);
    this.scene.add(this.reflector);
  }

  private _destroyReflector() {
    if (!this.reflector) return;
    this.scene.remove(this.reflector);
    this.reflector.geometry.dispose();
    (this.reflector.material as THREE.Material).dispose();
    this.reflector = null;
  }

  updateStars(dt: number, playing: boolean) {
    if (!this.stars || !this.starVels) return;
    const pos = (this.stars.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array;
    const h = this.container.clientHeight, w = this.container.clientWidth;
    const speed = playing ? 1 : 0.2;
    const xMin = -w * SceneManager.STAR_X_MARGIN;
    const xRange = w * (1 + 2 * SceneManager.STAR_X_MARGIN);
    const respawnTop = h * SceneManager.STAR_Y_TOP;
    const cutoff = h * SceneManager.STAR_Y_BOTTOM;
    for (let i = 0; i < this.starVels.length; i++) {
      pos[i * 3 + 1] -= this.starVels[i] * dt * speed;
      if (pos[i * 3 + 1] < cutoff) {
        pos[i * 3 + 1] = respawnTop;
        pos[i * 3] = xMin + Math.random() * xRange;
      }
    }
    this.stars.geometry.attributes.position.needsUpdate = true;
  }

  render(time: number) {
    this.filmPass.uniforms.time.value = time;
    this.bgMat.uniforms.uTime.value = time;
    if (this.glassActive && this.bgMesh.visible) this.backdrop.render(this.renderer, this.scene, this.currentCam);
    this.composer.render();
  }

  get width() { return this.container.clientWidth; }
  get height() { return this.container.clientHeight; }
  get isPerspective() { return this.cameraMode === 'perspective'; }
  get canvas(): HTMLCanvasElement { return this.renderer.domElement; }

  /** Temporarily resize the renderer / composer / cameras for offline export. */
  setExportSize(w: number, h: number) {
    this.renderer.setSize(w, h, false); // false = don't touch CSS size
    this.composer.setSize(w, h);
    this.orthoCam.right = w; this.orthoCam.top = h;
    this.orthoCam.updateProjectionMatrix();
    this.perspCam.aspect = w / h;
    this.perspCam.updateProjectionMatrix();
    this.bloomPass.resolution.set(w, h);
    this.bgMat.uniforms.uSize.value.set(w, h);
  }

  /** Restore to the viewport size after export. */
  restoreSize() {
    this._onResize();
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    this.backdrop.dispose();
    this.renderer.dispose();
  }
}
