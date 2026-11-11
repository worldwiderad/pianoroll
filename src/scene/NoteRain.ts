import * as THREE from 'three';
import type { MidiTrack } from '../midi/MidiLoader';
import type { Theme } from '../theme/types';
import { isBlack } from './Piano';

const FIRST_MIDI = 21;
const KEY_COUNT = 88;
const MAX_INSTANCES = 4096;
// Look-ahead extends well past the 2D viewport top so the tilted 3D perspective
// camera (which can see up to ~1.7×sceneH along Y) still has notes to draw at
// the far end. In 2D mode the extras render off-screen and get GPU-clipped.
const LOOK_AHEAD = 24;
const SCROLL_PX_PER_SEC = 120;
/** Cull margin above the viewport — keep generous so 3D mode never starves. */
const TOP_CULL_FACTOR = 3.0;

// Aspect-aware SDF rounded-rect shader. Assumes instances are scale+translate only (no rotation).
const NOTE_VERT = /* glsl */ `
attribute float aBrightness;
attribute vec3 aColor;
varying vec2 vUv;
varying vec2 vSize;
varying float vBrightness;
varying vec3 vInstanceColor;
void main() {
  vUv = uv;
  vSize = vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz));
  vBrightness = aBrightness;
  vInstanceColor = aColor;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}
`;

const NOTE_FRAG = /* glsl */ `
uniform vec3 color;
uniform float opacity;
uniform float shape;
uniform float cornerRadius;
uniform float fadeUp;
uniform float useInstanceColor;
uniform float bloomMul;
uniform float shimmer;
uniform float time;
uniform float bevel;
varying vec2 vUv;
varying vec2 vSize;
varying float vBrightness;
varying vec3 vInstanceColor;
void main() {
  vec2 halfSize = vSize * 0.5;
  vec2 p = (vUv - 0.5) * vSize;
  float r;
  if (shape < 0.5) {
    r = 0.0;
  } else if (shape < 1.5) {
    // Cap rounded at 50% of half-width so it never collapses into capsule
    r = min(cornerRadius, min(halfSize.x, halfSize.y) * 0.5);
  } else {
    r = min(halfSize.x, halfSize.y);
  }
  vec2 q = abs(p) - (halfSize - r);
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  float edge = max(fwidth(d), 0.5);
  float alpha = 1.0 - smoothstep(-edge, edge, d);
  // Vertical fade: trails set fadeUp=1 so they fade from full opacity (bottom) to 0 (top)
  float fadeAlpha = mix(1.0, pow(1.0 - vUv.y, 1.5), fadeUp);
  alpha *= fadeAlpha;
  if (alpha < 0.01) discard;
  vec3 baseColor = mix(color, vInstanceColor, useInstanceColor);
  // Bevel: a lit leading edge (the end that meets the keys) and a thin bright
  // rim, over a body a shade darker, measured in pixels so long and short
  // notes look alike.
  float rim = 1.0 - smoothstep(0.0, 2.2, -d);
  float lead = 1.0 - smoothstep(0.0, 9.0, vUv.y * vSize.y);
  vec3 lit = baseColor * (1.0 - 0.16 * bevel);
  lit = mix(lit, min(baseColor * 1.35 + 0.12, vec3(1.6)), rim * 0.55 * bevel);
  lit += baseColor * lead * 0.3 * bevel;
  // Subtle sine shimmer along vertical UV — at shimmer=0 this is a no-op.
  float shim = 1.0 + shimmer * sin(time * 3.0 + vUv.y * 6.0);
  vec3 c = lit * max(1.0, vBrightness) * bloomMul * shim;
  gl_FragColor = vec4(c, opacity * alpha);
}
`;

function shapeToFloat(s: 'rectangle' | 'rounded' | 'capsule'): number {
  return s === 'capsule' ? 2 : s === 'rounded' ? 1 : 0;
}

function makeNoteMaterial(color: THREE.Color, opacity: number, theme: Theme, isTrail = false): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      color: { value: color.clone() },
      opacity: { value: opacity },
      shape: { value: shapeToFloat(theme.notes.shape) },
      cornerRadius: { value: theme.notes.cornerRadius },
      fadeUp: { value: isTrail ? 1.0 : 0.0 },
      useInstanceColor: { value: theme.notes.colorMode === 'pitch' ? 1.0 : 0.0 },
      bloomMul: { value: theme.notes.bloomMultiplier },
      shimmer: { value: isTrail ? 0 : theme.notes.shimmer },
      bevel: { value: isTrail ? 0 : theme.notes.bevel },
      time: { value: 0 },
    },
    vertexShader: NOTE_VERT,
    fragmentShader: NOTE_FRAG,
    transparent: true,
    depthWrite: false,
    blending: isTrail ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
}

function makeInstancedGeometry(): THREE.InstancedBufferGeometry {
  // Clone attributes from a plane so source can be disposed without freeing GPU buffers
  const plane = new THREE.PlaneGeometry(1, 1);
  const inst = new THREE.InstancedBufferGeometry();
  if (plane.index) inst.setIndex(plane.index.clone());
  for (const name of Object.keys(plane.attributes)) {
    inst.setAttribute(name, (plane.attributes[name] as THREE.BufferAttribute).clone());
  }
  plane.dispose();
  const brightArr = new Float32Array(MAX_INSTANCES);
  brightArr.fill(1.0);
  const brightAttr = new THREE.InstancedBufferAttribute(brightArr, 1);
  brightAttr.setUsage(THREE.DynamicDrawUsage);
  inst.setAttribute('aBrightness', brightAttr);
  const colorArr = new Float32Array(MAX_INSTANCES * 3);
  colorArr.fill(1.0);
  const colorAttr = new THREE.InstancedBufferAttribute(colorArr, 3);
  colorAttr.setUsage(THREE.DynamicDrawUsage);
  inst.setAttribute('aColor', colorAttr);
  return inst;
}

interface TrackRenderer {
  mesh: THREE.InstancedMesh;
  trailMesh: THREE.InstancedMesh;
  mat: THREE.ShaderMaterial;
  trailMat: THREE.ShaderMaterial;
  brightArr: Float32Array;
  brightAttr: THREE.InstancedBufferAttribute;
  colorArr: Float32Array;
  colorAttr: THREE.InstancedBufferAttribute;
  trailColorArr: Float32Array;
  trailColorAttr: THREE.InstancedBufferAttribute;
  track: MidiTrack;
  visible: boolean;
  color: THREE.Color;
  cursor: number;
  lastTime: number;
}

export class NoteRain {
  private renderers: TrackRenderer[] = [];
  private scene: THREE.Scene;
  private dummy = new THREE.Object3D();
  private pianoTop = 0;
  private sceneH = 0;
  private sceneW = 0;
  private theme!: Theme;
  private keyXMap: Map<number, number> = new Map();
  private keyWidthMap: Map<number, number> = new Map();
  private whiteKeyW = 0;

  activeNotes: Map<number, number> = new Map();
  /** MIDI velocity ∈ [0, 1] of each currently-active note, keyed by midi pitch. */
  activeVelocity: Map<number, number> = new Map();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  build(tracks: MidiTrack[], sceneW: number, sceneH: number, pianoTop: number, theme: Theme, keyXFn: (m: number) => number, keyW: number) {
    this.dispose();
    this.sceneW = sceneW;
    this.sceneH = sceneH;
    this.pianoTop = pianoTop;
    this.theme = theme;
    this.whiteKeyW = keyW;

    for (let midi = FIRST_MIDI; midi < FIRST_MIDI + KEY_COUNT; midi++) {
      const x = keyXFn(midi);
      const black = isBlack(midi);
      const w = black ? keyW * 0.5 : keyW - Math.max(2, keyW * 0.12);
      this.keyXMap.set(midi, x);
      this.keyWidthMap.set(midi, w);
    }

    tracks.forEach((track, i) => {
      const color = new THREE.Color(theme.trackColors[i % theme.trackColors.length]);
      const mat = makeNoteMaterial(color, theme.notes.opacity, theme);
      const trailMat = makeNoteMaterial(color, theme.notes.trailOpacity, theme, true);

      const geo = makeInstancedGeometry();
      const mesh = new THREE.InstancedMesh(geo, mat, MAX_INSTANCES);
      mesh.frustumCulled = false;
      mesh.count = 0;

      const trailGeo = makeInstancedGeometry();
      const trailMesh = new THREE.InstancedMesh(trailGeo, trailMat, MAX_INSTANCES);
      trailMesh.frustumCulled = false;
      trailMesh.count = 0;

      const brightAttr = geo.getAttribute('aBrightness') as THREE.InstancedBufferAttribute;
      const brightArr = brightAttr.array as Float32Array;
      const colorAttr = geo.getAttribute('aColor') as THREE.InstancedBufferAttribute;
      const colorArr = colorAttr.array as Float32Array;
      const trailColorAttr = trailGeo.getAttribute('aColor') as THREE.InstancedBufferAttribute;
      const trailColorArr = trailColorAttr.array as Float32Array;

      this.scene.add(mesh);
      this.scene.add(trailMesh);
      this.renderers.push({ mesh, trailMesh, mat, trailMat, brightArr, brightAttr, colorArr, colorAttr, trailColorArr, trailColorAttr, track, visible: true, color, cursor: 0, lastTime: -1 });
    });
  }

  update(currentTime: number) {
    if (!this.renderers.length) return;
    this.activeNotes.clear();
    this.activeVelocity.clear();

    const pianoTop = this.pianoTop;
    const sceneH = this.sceneH;
    const speed = SCROLL_PX_PER_SEC;
    const lookAhead = LOOK_AHEAD;
    const trailLen = this.theme.notes.trailLength;
    const glow = this.theme.notes.glowIntensity;
    const afterglow = Math.max(0, this.theme.notes.afterglow);
    const velMod = this.theme.notes.velocityModulation;
    const pitchMode = this.theme.notes.colorMode === 'pitch';
    const pitchColors = this.theme.notes.pitchColors;
    // Resolve 12 pitch colors to RGB tuples once per frame
    const pitchRGB: [number, number, number][] = pitchMode
      ? pitchColors.map(hex => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; })
      : [];
    const d = this.dummy;
    const now = performance.now() / 1000;
    this.renderers.forEach(r => {
      r.mat.uniforms.time.value = now;
      r.trailMat.uniforms.time.value = now;
    });

    this.renderers.forEach((r, trackIdx) => {
      if (!r.visible) { r.mesh.count = 0; r.trailMesh.count = 0; return; }

      let count = 0, trailCount = 0;

      if (currentTime < r.lastTime - 0.1) r.cursor = 0;
      r.lastTime = currentTime;
      const windowStart = currentTime - 0.5 - afterglow;
      while (r.cursor < r.track.notes.length && r.track.notes[r.cursor].time + r.track.notes[r.cursor].duration < windowStart) {
        r.cursor++;
      }

      for (let ni = r.cursor; ni < r.track.notes.length; ni++) {
        const note = r.track.notes[ni];
        const noteEnd = note.time + note.duration;
        if (note.time > currentTime + lookAhead) break;

        const x = this.keyXMap.get(note.midi) ?? 0;
        const w = this.keyWidthMap.get(note.midi) ?? this.whiteKeyW * 0.88;

        const bottomY = pianoTop + (note.time - currentTime) * speed;
        const topY = pianoTop + (noteEnd - currentTime) * speed;

        if (note.time <= currentTime && noteEnd >= currentTime) {
          this.activeNotes.set(note.midi, trackIdx);
          this.activeVelocity.set(note.midi, note.velocity);
        }

        // Afterglow: notes past noteEnd render a fading slice at the hit line.
        const sincePastEnd = Math.max(0, currentTime - noteEnd);
        const afterglowFade = afterglow > 0 ? Math.max(0, 1 - sincePastEnd / afterglow) : 0;
        const isPast = topY < pianoTop - 1;
        if (isPast && afterglowFade <= 0) continue;
        if (bottomY > sceneH * TOP_CULL_FACTOR + 20) continue;

        const proximity = Math.max(0, 1 - Math.max(0, note.time - currentTime) / 1.5);
        const proxBoost = 1.0 + proximity * glow * 1.2;
        const velMul = velMod.enabled
          ? velMod.minBrightness + (velMod.maxBrightness - velMod.minBrightness) * Math.max(0, Math.min(1, note.velocity))
          : 1.0;
        let brightness = proxBoost * velMul;

        let renderBottom: number;
        let renderH: number;
        if (isPast) {
          // Render a small lingering slice at the hit line, dimmed by fade
          renderBottom = pianoTop;
          renderH = 6;
          brightness *= afterglowFade * 0.7;
        } else {
          renderBottom = Math.max(bottomY, pianoTop);
          renderH = Math.max(topY - renderBottom, 2);
        }
        const centerY = renderBottom + renderH / 2;

        if (count < MAX_INSTANCES) {
          d.position.set(x, centerY, 2);
          d.scale.set(w, renderH, 1);
          d.updateMatrix();
          r.mesh.setMatrixAt(count, d.matrix);
          r.brightArr[count] = brightness;
          if (pitchMode) {
            const rgb = pitchRGB[note.midi % 12];
            r.colorArr[count * 3] = rgb[0];
            r.colorArr[count * 3 + 1] = rgb[1];
            r.colorArr[count * 3 + 2] = rgb[2];
          }
          count++;
        }

        // Trail: a narrower, taller streak placed ABOVE the note's top edge
        // (fadeUp uniform fades it from solid near the note to transparent at the far end).
        if (trailLen > 0 && renderH > 10 && trailCount < MAX_INSTANCES) {
          const trailH = renderH * trailLen * 2.5;
          const trailCenterY = topY + trailH / 2;
          d.position.set(x, trailCenterY, 1.5);
          d.scale.set(w * 0.55, trailH, 1);
          d.updateMatrix();
          r.trailMesh.setMatrixAt(trailCount, d.matrix);
          if (pitchMode) {
            const rgb = pitchRGB[note.midi % 12];
            r.trailColorArr[trailCount * 3] = rgb[0];
            r.trailColorArr[trailCount * 3 + 1] = rgb[1];
            r.trailColorArr[trailCount * 3 + 2] = rgb[2];
          }
          trailCount++;
        }
      }

      r.mesh.count = count;
      r.trailMesh.count = trailCount;
      if (count > 0) {
        r.mesh.instanceMatrix.needsUpdate = true;
        r.brightAttr.needsUpdate = true;
        if (pitchMode) r.colorAttr.needsUpdate = true;
      }
      if (trailCount > 0) {
        r.trailMesh.instanceMatrix.needsUpdate = true;
        if (pitchMode) r.trailColorAttr.needsUpdate = true;
      }
    });
  }

  setTrackVisible(trackIdx: number, visible: boolean) {
    if (this.renderers[trackIdx]) this.renderers[trackIdx].visible = visible;
  }

  /** Show/hide all rain meshes at once (used when swapping to composition view). */
  setAllMeshesVisible(visible: boolean) {
    this.renderers.forEach(r => {
      r.mesh.visible = visible;
      r.trailMesh.visible = visible;
    });
  }

  /**
   * Multiplier on top of `theme.notes.opacity` for one track. Used by the
   * timeline keyframe system to fade tracks in/out over time.
   */
  setTrackOpacityMultiplier(trackIdx: number, mul: number) {
    const r = this.renderers[trackIdx];
    if (!r) return;
    const base = this.theme.notes.opacity;
    const trail = this.theme.notes.trailOpacity;
    r.mat.uniforms.opacity.value = base * mul;
    r.trailMat.uniforms.opacity.value = trail * mul;
  }

  setTrackColor(trackIdx: number, hex: string) {
    const r = this.renderers[trackIdx];
    if (!r) return;
    r.color.set(hex);
    (r.mat.uniforms.color.value as THREE.Color).set(hex);
    (r.trailMat.uniforms.color.value as THREE.Color).set(hex);
  }

  applyTheme(theme: Theme) {
    this.theme = theme;
    const shapeVal = shapeToFloat(theme.notes.shape);
    const usePitch = theme.notes.colorMode === 'pitch' ? 1.0 : 0.0;
    this.renderers.forEach((r, i) => {
      r.mat.uniforms.opacity.value = theme.notes.opacity;
      r.mat.uniforms.shape.value = shapeVal;
      r.mat.uniforms.cornerRadius.value = theme.notes.cornerRadius;
      r.mat.uniforms.useInstanceColor.value = usePitch;
      r.mat.uniforms.bloomMul.value = theme.notes.bloomMultiplier;
      r.mat.uniforms.shimmer.value = theme.notes.shimmer;
      r.mat.uniforms.bevel.value = theme.notes.bevel;
      r.trailMat.uniforms.opacity.value = theme.notes.trailOpacity;
      r.trailMat.uniforms.shape.value = shapeVal;
      r.trailMat.uniforms.cornerRadius.value = theme.notes.cornerRadius;
      r.trailMat.uniforms.useInstanceColor.value = usePitch;
      r.trailMat.uniforms.bloomMul.value = theme.notes.bloomMultiplier;
      this.setTrackColor(i, theme.trackColors[i % theme.trackColors.length]);
    });
  }

  getTrackColor(trackIdx: number): THREE.Color {
    return this.renderers[trackIdx]?.color ?? new THREE.Color('#ffffff');
  }

  /** Resolve the colour for a note based on the active colour mode (pitch or track). */
  getNoteColor(midi: number, trackIdx: number, out = new THREE.Color()): THREE.Color {
    if (this.theme.notes.colorMode === 'pitch') {
      return out.set(this.theme.notes.pitchColors[midi % 12]);
    }
    const r = this.renderers[trackIdx];
    return r ? out.copy(r.color) : out.set('#ffffff');
  }

  dispose() {
    this.renderers.forEach(r => {
      r.mesh.geometry.dispose();
      r.mat.dispose();
      r.trailMesh.geometry.dispose();
      r.trailMat.dispose();
      this.scene.remove(r.mesh);
      this.scene.remove(r.trailMesh);
    });
    this.renderers = [];
  }
}
