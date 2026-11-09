import * as THREE from 'three';
import type { Theme } from '../theme/types';

const FIRST_MIDI = 21;
const KEY_COUNT = 88;

// Standard MIDI semitone classes (from C): C#=1, D#=3, F#=6, G#=8, A#=10
const BLACK_SEMITONES = new Set([1, 3, 6, 8, 10]);
export function isBlack(midi: number): boolean {
  return BLACK_SEMITONES.has(midi % 12);
}

interface KeyData {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  isBlack: boolean;
  baseColor: THREE.Color;
  pressColor: THREE.Color;
  baseY: number;
  midi: number;
}

interface Beam {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  intensity: number; // 0–1, decays each frame
  color: THREE.Color;
}

export const PIANO_HEIGHT_FRACTION = 0.19;

// Shared gradient texture: white at y=0, transparent at y=1
let _beamTex: THREE.Texture | null = null;
function beamTexture(): THREE.Texture {
  if (_beamTex) return _beamTex;
  const c = document.createElement('canvas');
  c.width = 1; c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, 64);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(1, 'rgba(255,255,255,1)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1, 64);
  _beamTex = new THREE.CanvasTexture(c);
  return _beamTex;
}

export class Piano {
  group: THREE.Group;
  private keys: Map<number, KeyData> = new Map();
  private beams: Map<number, Beam> = new Map();
  private ripples: Map<number, Beam> = new Map(); // re-uses Beam shape (mesh + mat + intensity)
  private hitLineMat!: THREE.MeshBasicMaterial;
  private hitGlowMat!: THREE.MeshBasicMaterial;
  private whiteCount = 0;
  private sceneW = 0;
  private sceneH = 0;
  pianoTop = 0;
  // Per-element bloom multipliers; live-updated from theme.
  private hitLineGlow = 1;
  private beamGlow = 1;
  private hitRipple = false;

  constructor(scene: THREE.Scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
  }

  build(sceneW: number, sceneH: number, theme: Theme) {
    // Dispose old
    this.group.children.slice().forEach(c => {
      (c as THREE.Mesh).geometry?.dispose();
      ((c as THREE.Mesh).material as THREE.Material)?.dispose();
      this.group.remove(c);
    });
    this.keys.clear();
    this.beams.clear();
    this.ripples.clear();

    this.sceneW = sceneW;
    this.sceneH = sceneH;
    this.whiteCount = 0;
    for (let m = FIRST_MIDI; m < FIRST_MIDI + KEY_COUNT; m++) {
      if (!isBlack(m)) this.whiteCount++;
    }

    const pianoH = sceneH * PIANO_HEIGHT_FRACTION;
    const keyW = sceneW / this.whiteCount;
    const whiteH = pianoH;
    const blackH = pianoH * 0.62;
    const blackW = keyW * 0.56;
    this.pianoTop = pianoH;

    const realistic = theme.piano.style === 'realistic';

    // Dark background fill (shows as gaps between white keys and as side of piano)
    const bgColor = realistic ? 0x1a1410 : 0x06060c;
    const bgGeo = new THREE.PlaneGeometry(sceneW, pianoH);
    const bgMat = new THREE.MeshBasicMaterial({ color: bgColor });
    const bg = new THREE.Mesh(bgGeo, bgMat);
    bg.position.set(sceneW / 2, pianoH / 2, -0.5);
    this.group.add(bg);

    const whiteBase = new THREE.Color(theme.piano.whiteKeyColor);
    const blackBase = new THREE.Color(theme.piano.blackKeyColor);

    let whiteIdx = 0;
    for (let midi = FIRST_MIDI; midi < FIRST_MIDI + KEY_COUNT; midi++) {
      const black = isBlack(midi);
      const w = black ? blackW : keyW - 1.5;
      const h = black ? blackH : whiteH;
      // Black key X: midpoint between adjacent white keys (whiteIdx = next white index)
      const x = black ? whiteIdx * keyW : whiteIdx * keyW + keyW / 2;
      // Black keys top-aligned with the hit line so falling black notes meet them.
      // White keys span the full piano area.
      const y = black ? pianoH - h / 2 : h / 2;
      const z = black ? 2.5 : 1.0;

      const baseColor = (black ? blackBase : whiteBase).clone();
      const pressColor = baseColor.clone(); // will be set on press

      const geo = new THREE.BoxGeometry(w, h, 1);
      const mat = new THREE.MeshBasicMaterial({ color: baseColor });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      this.group.add(mesh);
      this.keys.set(midi, { mesh, mat, isBlack: black, baseColor, pressColor, baseY: y, midi });

      // Beam plane above hit line — bottom-anchored, gradient fades upward
      const beamH = pianoH * 0.9;
      const beamGeo = new THREE.PlaneGeometry(w * 0.9, beamH);
      const beamMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        map: beamTexture(),
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const beamMesh = new THREE.Mesh(beamGeo, beamMat);
      // Bottom of beam at pianoTop, so center is at pianoTop + beamH/2
      beamMesh.position.set(x, pianoH + beamH / 2, 3.5);
      this.group.add(beamMesh);
      this.beams.set(midi, { mesh: beamMesh, mat: beamMat, intensity: 0, color: new THREE.Color() });

      // Hit-line ripple: small horizontal flash right at the hit line, fired on press.
      const rippleGeo = new THREE.PlaneGeometry(w * 1.8, 8);
      const rippleMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const rippleMesh = new THREE.Mesh(rippleGeo, rippleMat);
      rippleMesh.position.set(x, pianoH, 4.2);
      this.group.add(rippleMesh);
      this.ripples.set(midi, { mesh: rippleMesh, mat: rippleMat, intensity: 0, color: new THREE.Color() });

      if (!black) whiteIdx++;
    }

    // Thin bright hit line
    const hitLineGeo = new THREE.PlaneGeometry(sceneW, 2);
    this.hitLineMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const hitLine = new THREE.Mesh(hitLineGeo, this.hitLineMat);
    hitLine.position.set(sceneW / 2, pianoH, 4);
    this.group.add(hitLine);

    // Wider soft glow behind the hit line
    const hitGlowGeo = new THREE.PlaneGeometry(sceneW, 18);
    this.hitGlowMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.05,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const hitGlow = new THREE.Mesh(hitGlowGeo, this.hitGlowMat);
    hitGlow.position.set(sceneW / 2, pianoH, 3.9);
    this.group.add(hitGlow);
  }

  pressKey(midi: number, trackColor: THREE.Color, theme: Theme) {
    const k = this.keys.get(midi);
    if (!k) return;

    if (theme.piano.pressedGlow) {
      if (theme.piano.style === 'realistic') {
        if (k.isBlack) {
          // Black key glows with the track colour at moderate brightness
          k.mat.color.set('#1a1a18').lerp(trackColor, 0.7).multiplyScalar(0.75);
        } else {
          // White key takes a soft tint without blowing out bloom
          k.mat.color.set('#f0ede0').lerp(trackColor, 0.45).multiplyScalar(0.7);
        }
      } else {
        k.mat.color.set(trackColor).multiplyScalar(k.isBlack ? 1.0 : 0.7);
      }
      const b = this.beams.get(midi);
      if (b) {
        b.color.copy(trackColor);
        b.intensity = 1.0;
        b.mat.color.copy(trackColor);
      }
      if (this.hitRipple) {
        const r = this.ripples.get(midi);
        if (r) {
          r.intensity = 1.0;
          r.mat.color.copy(trackColor);
        }
      }
    }

    if (theme.piano.depthEffect) k.mesh.position.y = k.baseY - 5;
  }

  releaseKey(midi: number) {
    const k = this.keys.get(midi);
    if (!k) return;
    k.mat.color.copy(k.baseColor);
    k.mesh.position.y = k.baseY;
  }

  update(dt: number, activeCount: number) {
    // Hit line: very subtle pulse, modulated by per-element hitLineGlow multiplier.
    if (this.hitLineMat) {
      const target = (0.1 + Math.min(activeCount, 12) * 0.007) * this.hitLineGlow;
      this.hitLineMat.opacity += (target - this.hitLineMat.opacity) * Math.min(dt * 14, 1);
    }
    if (this.hitGlowMat) {
      const target = (0.015 + Math.min(activeCount, 12) * 0.003) * this.hitLineGlow;
      this.hitGlowMat.opacity += (target - this.hitGlowMat.opacity) * Math.min(dt * 10, 1);
    }

    // Decay beams — peak opacity 0.16 × beamGlow, decays quickly to avoid stacking.
    const decay = Math.pow(0.04, dt);
    const beamPeak = 0.16 * this.beamGlow;
    this.beams.forEach(b => {
      if (b.intensity <= 0) return;
      b.intensity *= decay;
      if (b.intensity < 0.005) { b.intensity = 0; b.mat.opacity = 0; return; }
      b.mat.opacity = b.intensity * beamPeak;
    });

    // Ripples decay faster than beams (brief flash on press)
    const rippleDecay = Math.pow(0.001, dt);
    this.ripples.forEach(r => {
      if (r.intensity <= 0) return;
      r.intensity *= rippleDecay;
      if (r.intensity < 0.005) { r.intensity = 0; r.mat.opacity = 0; return; }
      r.mat.opacity = r.intensity * 0.6;
    });
  }

  private lastStyle = '';
  private lastWhite = '';
  private lastBlack = '';

  /** Full rebuild using stored dimensions */
  rebuild(theme: Theme) {
    if (this.sceneW > 0 && this.sceneH > 0) this.build(this.sceneW, this.sceneH, theme);
  }

  applyTheme(theme: Theme) {
    const needsRebuild =
      this.lastStyle !== theme.piano.style ||
      this.lastWhite !== theme.piano.whiteKeyColor ||
      this.lastBlack !== theme.piano.blackKeyColor;
    this.lastStyle = theme.piano.style;
    this.lastWhite = theme.piano.whiteKeyColor;
    this.lastBlack = theme.piano.blackKeyColor;
    if (needsRebuild) this.rebuild(theme);
    this.hitLineGlow = theme.piano.hitLineGlow;
    this.beamGlow = theme.piano.beamGlow;
    this.hitRipple = theme.piano.hitRipple;
    // Non-structural fields (pressedGlow, depthEffect, pressColorSource) read on press
  }

  getKeyX(midi: number): number {
    return this.keys.get(midi)?.mesh.position.x ?? 0;
  }

  get keyWidth(): number {
    return this.sceneW / this.whiteCount;
  }
}
