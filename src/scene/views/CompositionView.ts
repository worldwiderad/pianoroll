import * as THREE from 'three';
import type { MidiTrack } from '../../midi/MidiLoader';
import type { Theme } from '../../theme/types';

/** Pixels per second on the X axis (time → space). */
const PPS = 80;
/** World units per semitone on the Y axis. */
const PITCH_SCALE = 18;
/** World units between adjacent track layers on the Z axis. */
const TRACK_DEPTH = 40;
const NOTE_HEIGHT = 14;
const NOTE_DEPTH = 28;

interface NoteRecord {
  midi: number;
  time: number;
  duration: number;
  velocity: number;
  trackIdx: number;
  layer: number;
  instIdx: number;       // index within its track's InstancedMesh
  baseR: number;
  baseG: number;
  baseB: number;
  glowScale: number;     // per-color normalization so all colours bloom equally
}

interface LayerRenderer {
  mesh: THREE.InstancedMesh;
  mat: THREE.MeshStandardMaterial;
  colorAttr: THREE.InstancedBufferAttribute;
  notes: NoteRecord[];
  trackIdx: number;
  visible: boolean;
}

/**
 * 3D composition view: notes laid out in space (X=time, Y=pitch, Z=track),
 * with a cursor plane sweeping along X to "reveal" notes as time progresses.
 */
export class CompositionView {
  readonly group: THREE.Group;
  private scene: THREE.Scene;
  private layers: LayerRenderer[] = [];
  private cursorSoft: THREE.Mesh | null = null;
  private cursorBright: THREE.Mesh | null = null;
  private minPitch = 60;
  private maxPitch = 72;
  private midPitch = 66;
  private trackCount = 0;
  private duration = 0;
  /** Centre of the score on the X axis (used for camera framing). */
  centerX = 0;
  /** Bounding extents — used by App.ts to position the orbit camera. */
  spanX = 0;
  spanY = 0;
  spanZ = 0;

  // Theme-driven runtime settings
  private cursorOpacityMul = 1;
  private glowRadius = 0.3;
  private glowIntensityMul = 1;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);
  }

  build(tracks: MidiTrack[], theme: Theme, duration: number) {
    this.dispose();
    this.duration = duration;

    const tracksWithNotes = tracks.filter(t => t.notes.length > 0);
    this.trackCount = tracksWithNotes.length;
    if (this.trackCount === 0) return;

    this.minPitch = 127; this.maxPitch = 0;
    tracksWithNotes.forEach(t => t.notes.forEach(n => {
      if (n.midi < this.minPitch) this.minPitch = n.midi;
      if (n.midi > this.maxPitch) this.maxPitch = n.midi;
    }));
    this.midPitch = (this.minPitch + this.maxPitch) / 2;

    const geo = new THREE.BoxGeometry(1, 1, 1);
    const pitchMode = theme.notes.colorMode === 'pitch';

    tracksWithNotes.forEach((track, layer) => {
      const trackColor = new THREE.Color(theme.trackColors[layer % theme.trackColors.length]);
      const mat = new THREE.MeshStandardMaterial({
        color: trackColor.clone().multiplyScalar(0.6),
        emissive: trackColor,
        emissiveIntensity: 0.18,
        metalness: 0.25,
        roughness: 0.45,
        transparent: true,
        opacity: 0.92,
      });
      const mesh = new THREE.InstancedMesh(geo, mat, track.notes.length);
      mesh.frustumCulled = false;
      const colorArr = new Float32Array(track.notes.length * 3);
      const colorAttr = new THREE.InstancedBufferAttribute(colorArr, 3);
      colorAttr.setUsage(THREE.DynamicDrawUsage);
      mesh.instanceColor = colorAttr;

      const zPos = (layer - (this.trackCount - 1) / 2) * TRACK_DEPTH;
      const dummy = new THREE.Object3D();
      const notes: NoteRecord[] = [];

      track.notes.forEach((n, i) => {
        const x = n.time * PPS;
        const y = (n.midi - this.midPitch) * PITCH_SCALE;
        const w = Math.max(n.duration * PPS, 2.5);
        dummy.position.set(x + w / 2, y, zPos);
        dummy.scale.set(w, NOTE_HEIGHT, NOTE_DEPTH);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);

        const color = pitchMode
          ? new THREE.Color(theme.notes.pitchColors[n.midi % 12])
          : trackColor;
        const v = 0.18 + (n.velocity ?? 0.8) * 0.22; // dim base — active notes pop by contrast
        const baseR = color.r * v, baseG = color.g * v, baseB = color.b * v;
        colorArr[i * 3] = baseR;
        colorArr[i * 3 + 1] = baseG;
        colorArr[i * 3 + 2] = baseB;
        const lum = color.r * 0.299 + color.g * 0.587 + color.b * 0.114;
        const glowScale = lum > 0 ? 0.5 / lum : 1.0;

        notes.push({
          midi: n.midi, time: n.time, duration: n.duration, velocity: n.velocity ?? 0.8,
          trackIdx: layer, layer, instIdx: i,
          baseR, baseG, baseB, glowScale,
        });
      });

      mesh.instanceMatrix.needsUpdate = true;
      colorAttr.needsUpdate = true;
      this.group.add(mesh);
      this.layers.push({ mesh, mat, colorAttr, notes, trackIdx: layer, visible: true });
    });

    // ── Cursor plane (Y-Z plane sweeping along X) ──
    const pitchSpan = (this.maxPitch - this.minPitch + 24) * PITCH_SCALE;
    const zSpan = (this.trackCount + 2) * TRACK_DEPTH;

    const cursorVS = `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
    const softFS = `
      uniform vec3 color; uniform float baseOpacity;
      varying vec2 vUv;
      void main() {
        float zNorm = abs(vUv.x - 0.5) * 2.0;
        float fade = smoothstep(1.0, 0.3, zNorm);
        gl_FragColor = vec4(color, baseOpacity * fade);
      }
    `;
    const brightFS = `
      uniform vec3 color; uniform float baseOpacity;
      varying vec2 vUv;
      void main() {
        float zNorm = abs(vUv.x - 0.5) * 2.0;
        float xFade = smoothstep(1.0, 0.0, zNorm);
        float yNorm = abs(vUv.y - 0.5) * 2.0;
        float yFade = smoothstep(1.0, 0.85, yNorm);
        float w = max(0.0, 1.0 - yFade) * xFade;
        gl_FragColor = vec4(color, baseOpacity * w);
      }
    `;

    const softGeo = new THREE.PlaneGeometry(zSpan, pitchSpan);
    const softMat = new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Color(0x8888aa) }, baseOpacity: { value: 0.06 } },
      vertexShader: cursorVS, fragmentShader: softFS,
      transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.NormalBlending,
    });
    this.cursorSoft = new THREE.Mesh(softGeo, softMat);
    this.cursorSoft.rotation.y = Math.PI / 2;
    this.group.add(this.cursorSoft);

    const brightGeo = new THREE.PlaneGeometry(zSpan, pitchSpan);
    const brightMat = new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Color(0xaaaacc) }, baseOpacity: { value: 0.4 } },
      vertexShader: cursorVS, fragmentShader: brightFS,
      transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.cursorBright = new THREE.Mesh(brightGeo, brightMat);
    this.cursorBright.rotation.y = Math.PI / 2;
    this.group.add(this.cursorBright);

    // Extents (used by App.ts to position the orbit camera on first activation)
    this.spanX = duration * PPS;
    this.spanY = (this.maxPitch - this.minPitch + 6) * PITCH_SCALE;
    this.spanZ = this.trackCount * TRACK_DEPTH;
    this.centerX = this.spanX / 2;
  }

  /** Per-frame cursor sweep + per-instance proximity glow. */
  update(currentTime: number, playing: boolean) {
    if (this.layers.length === 0) return;

    const cursorX = currentTime * PPS;
    if (this.cursorSoft) this.cursorSoft.position.x = cursorX;
    if (this.cursorBright) this.cursorBright.position.x = cursorX;

    const glowActive = playing;

    for (const layer of this.layers) {
      if (!layer.visible) { layer.mesh.visible = false; continue; }
      layer.mesh.visible = true;
      const arr = layer.colorAttr.array as Float32Array;

      const radius = this.glowRadius;
      const boostScale = 12.0 * this.glowIntensityMul;
      for (const n of layer.notes) {
        const noteEnd = n.time + n.duration;
        const i = n.instIdx;
        if (currentTime < n.time) {
          arr[i * 3] = 0; arr[i * 3 + 1] = 0; arr[i * 3 + 2] = 0;
          continue;
        }
        let proximity = 0;
        if (currentTime > noteEnd) proximity = currentTime - noteEnd;
        const glow = proximity <= 0 ? 1.0 : Math.max(0, 1.0 - proximity / radius);
        if (glowActive && glow > 0) {
          const t = glow * glow * (3.0 - 2.0 * glow);
          const boost = 1.0 + t * boostScale * n.glowScale;
          arr[i * 3] = n.baseR * boost;
          arr[i * 3 + 1] = n.baseG * boost;
          arr[i * 3 + 2] = n.baseB * boost;
        } else {
          arr[i * 3] = n.baseR;
          arr[i * 3 + 1] = n.baseG;
          arr[i * 3 + 2] = n.baseB;
        }
      }
      layer.colorAttr.needsUpdate = true;
    }
  }

  setVisible(v: boolean) {
    this.group.visible = v;
  }

  setTrackVisible(trackIdx: number, visible: boolean) {
    const layer = this.layers[trackIdx];
    if (layer) layer.visible = visible;
  }

  /** Per-track opacity multiplier for the timeline keyframe system. */
  setTrackOpacityMultiplier(trackIdx: number, mul: number) {
    const layer = this.layers[trackIdx];
    if (!layer) return;
    layer.mat.opacity = Math.max(0.05, 0.92 * mul); // 0.92 is the default base opacity
  }

  /** Re-apply theme without rebuilding (colour mode / palette change). */
  applyTheme(theme: Theme) {
    const comp = theme.view.composition;
    this.cursorOpacityMul = comp.cursorOpacity;
    this.glowRadius = Math.max(0.01, comp.glowRadius);
    this.glowIntensityMul = comp.glowIntensity;
    if (this.cursorSoft) {
      (this.cursorSoft.material as THREE.ShaderMaterial).uniforms.baseOpacity.value = 0.06 * comp.cursorOpacity;
    }
    if (this.cursorBright) {
      (this.cursorBright.material as THREE.ShaderMaterial).uniforms.baseOpacity.value = 0.4 * comp.cursorOpacity;
    }
    const pitchMode = theme.notes.colorMode === 'pitch';
    this.layers.forEach((layer, i) => {
      const trackColor = new THREE.Color(theme.trackColors[i % theme.trackColors.length]);
      layer.mat.color.copy(trackColor).multiplyScalar(0.6);
      layer.mat.emissive.copy(trackColor);
      const arr = layer.colorAttr.array as Float32Array;
      for (const n of layer.notes) {
        const color = pitchMode
          ? new THREE.Color(theme.notes.pitchColors[n.midi % 12])
          : trackColor;
        const v = 0.18 + n.velocity * 0.22;
        n.baseR = color.r * v;
        n.baseG = color.g * v;
        n.baseB = color.b * v;
        const lum = color.r * 0.299 + color.g * 0.587 + color.b * 0.114;
        n.glowScale = lum > 0 ? 0.5 / lum : 1.0;
        arr[n.instIdx * 3] = n.baseR;
        arr[n.instIdx * 3 + 1] = n.baseG;
        arr[n.instIdx * 3 + 2] = n.baseB;
      }
      layer.colorAttr.needsUpdate = true;
    });
  }

  dispose() {
    for (const layer of this.layers) {
      layer.mesh.geometry.dispose();
      layer.mat.dispose();
      this.group.remove(layer.mesh);
    }
    this.layers = [];
    if (this.cursorSoft) {
      this.cursorSoft.geometry.dispose();
      (this.cursorSoft.material as THREE.Material).dispose();
      this.group.remove(this.cursorSoft);
      this.cursorSoft = null;
    }
    if (this.cursorBright) {
      this.cursorBright.geometry.dispose();
      (this.cursorBright.material as THREE.Material).dispose();
      this.group.remove(this.cursorBright);
      this.cursorBright = null;
    }
  }
}
