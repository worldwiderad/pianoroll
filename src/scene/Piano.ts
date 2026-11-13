import * as THREE from 'three';
import type { Theme } from '../theme/types';
import type { MidiTrack } from '../midi/MidiLoader';
import { backdropUniforms } from './Backdrop';

export const FULL_RANGE = { lo: 21, hi: 108 } as const;
export interface KeyRange { lo: number; hi: number }

// Semitone classes from C: C#=1, D#=3, F#=6, G#=8, A#=10
const BLACK_SEMITONES = new Set([1, 3, 6, 8, 10]);
export function isBlack(midi: number): boolean {
  return BLACK_SEMITONES.has(((midi % 12) + 12) % 12);
}

// On a real keyboard the black keys are not centred on the gap between two
// whites: C# and F# sit left of it, D# and A# right, G# in the middle.
const BLACK_OFFSET: Record<number, number> = { 1: -0.1, 3: 0.1, 6: -0.13, 8: 0, 10: 0.13 };

const WHITE_IN_OCTAVE = [1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1];
/** Number of white keys strictly below `midi`. */
function whitesBelow(midi: number): number {
  const oct = Math.floor(midi / 12);
  let n = oct * 7;
  for (let s = 0; s < midi - oct * 12; s++) n += WHITE_IN_OCTAVE[s];
  return n;
}

/**
 * The keyboard range that frames a piece: its lowest to highest note, padded,
 * widened to at least `minWhiteKeys` white keys, and snapped to white keys at
 * both ends.
 */
export function fitRange(tracks: MidiTrack[], minWhiteKeys = 22): KeyRange {
  const minSpan = Math.ceil(minWhiteKeys * 12 / 7);
  let lo = Infinity, hi = -Infinity;
  for (const t of tracks) for (const n of t.notes) { if (n.midi < lo) lo = n.midi; if (n.midi > hi) hi = n.midi; }
  if (!isFinite(lo)) return { ...FULL_RANGE };
  lo -= 3; hi += 3;
  const span = hi - lo;
  if (span < minSpan) { const grow = (minSpan - span) / 2; lo -= Math.ceil(grow); hi += Math.floor(grow); }
  if (lo < FULL_RANGE.lo) { hi += FULL_RANGE.lo - lo; lo = FULL_RANGE.lo; }
  if (hi > FULL_RANGE.hi) { lo -= hi - FULL_RANGE.hi; hi = FULL_RANGE.hi; }
  lo = Math.max(FULL_RANGE.lo, lo); hi = Math.min(FULL_RANGE.hi, hi);
  while (isBlack(lo) && lo > FULL_RANGE.lo) lo--;
  while (isBlack(hi) && hi < FULL_RANGE.hi) hi++;
  return { lo, hi };
}

// ── Key surface textures ──────────────────────────────────────────────────
// Drawn once per build on a canvas, in the theme's own key colours, so the
// shading (felt shadow, rounded edges, the front lip, the black keys' bevel and
// gloss) is part of the key rather than a flat fill.

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return { c, g: c.getContext('2d')! };
}

function toTexture(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

function shade(hex: string, amt: number): string {
  // amt > 0 mixes toward white, < 0 toward black
  const c = new THREE.Color(hex);
  const target = amt > 0 ? new THREE.Color(1, 1, 1) : new THREE.Color(0, 0, 0);
  return '#' + c.lerp(target, Math.abs(amt)).getHexString();
}

function whiteKeyTexture(color: string, neon: boolean): THREE.CanvasTexture {
  const W = 64, H = 512;
  const { c, g } = canvas(W, H);
  g.fillStyle = color;
  g.fillRect(0, 0, W, H);
  if (neon) {
    // Dark glass: a faint sheen and a thin bright rim along the front edge.
    const sheen = g.createLinearGradient(0, 0, 0, H);
    sheen.addColorStop(0, 'rgba(255,255,255,0.00)');
    sheen.addColorStop(0.75, 'rgba(255,255,255,0.04)');
    sheen.addColorStop(1, 'rgba(255,255,255,0.10)');
    g.fillStyle = sheen; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(255,255,255,0.22)'; g.fillRect(0, H - 6, W, 2);
    g.fillStyle = 'rgba(255,255,255,0.06)'; g.fillRect(0, 0, 2, H); g.fillRect(W - 2, 0, 2, H);
    return toTexture(c);
  }
  // Shadow where the key runs under the felt and the fallboard.
  const back = g.createLinearGradient(0, 0, 0, H * 0.22);
  back.addColorStop(0, 'rgba(40,24,10,0.42)');
  back.addColorStop(1, 'rgba(40,24,10,0)');
  g.fillStyle = back; g.fillRect(0, 0, W, H * 0.22);
  // A broad soft highlight across the playing area.
  const body = g.createLinearGradient(0, 0, 0, H);
  body.addColorStop(0.35, 'rgba(255,255,255,0)');
  body.addColorStop(0.8, 'rgba(255,255,255,0.10)');
  body.addColorStop(0.93, 'rgba(255,255,255,0.02)');
  g.fillStyle = body; g.fillRect(0, 0, W, H);
  // Rounded long edges.
  const edge = g.createLinearGradient(0, 0, W, 0);
  edge.addColorStop(0, 'rgba(60,40,20,0.30)');
  edge.addColorStop(0.07, 'rgba(60,40,20,0.0)');
  edge.addColorStop(0.93, 'rgba(60,40,20,0.0)');
  edge.addColorStop(1, 'rgba(60,40,20,0.34)');
  g.fillStyle = edge; g.fillRect(0, 0, W, H);
  // Front lip: a bright bevel, then the key's front face falling away.
  const lipTop = H * 0.945;
  g.fillStyle = 'rgba(255,255,255,0.55)'; g.fillRect(0, lipTop, W, 3);
  const face = g.createLinearGradient(0, lipTop + 3, 0, H);
  face.addColorStop(0, 'rgba(70,50,30,0.18)');
  face.addColorStop(1, 'rgba(50,34,20,0.42)');
  g.fillStyle = face; g.fillRect(0, lipTop + 3, W, H - lipTop - 3);
  return toTexture(c);
}

function blackKeyTexture(color: string, neon: boolean): THREE.CanvasTexture {
  const W = 64, H = 512;
  const { c, g } = canvas(W, H);
  g.fillStyle = color;
  g.fillRect(0, 0, W, H);
  if (neon) {
    g.fillStyle = 'rgba(255,255,255,0.10)'; g.fillRect(4, H - 10, W - 8, 2);
    g.strokeStyle = 'rgba(255,255,255,0.08)'; g.lineWidth = 2; g.strokeRect(1, 1, W - 2, H - 2);
    return toTexture(c);
  }
  // Seen from above, a black key is a narrower top surface with bevelled
  // sides, and a sloped front that catches the light.
  const inset = W * 0.14;
  const top = shade(color, 0.10);
  const topGrad = g.createLinearGradient(0, 0, 0, H);
  topGrad.addColorStop(0, shade(color, 0.02));
  topGrad.addColorStop(0.7, top);
  topGrad.addColorStop(0.86, shade(color, 0.16));
  g.fillStyle = topGrad;
  g.fillRect(inset, 0, W - inset * 2, H * 0.88);
  // Gloss: a soft streak down the top surface.
  const gloss = g.createLinearGradient(inset, 0, W - inset, 0);
  gloss.addColorStop(0, 'rgba(255,255,255,0)');
  gloss.addColorStop(0.35, 'rgba(255,255,255,0.10)');
  gloss.addColorStop(0.5, 'rgba(255,255,255,0.04)');
  gloss.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gloss; g.fillRect(inset, H * 0.18, W - inset * 2, H * 0.66);
  // Sloped front face.
  const front = g.createLinearGradient(0, H * 0.88, 0, H);
  front.addColorStop(0, shade(color, 0.32));
  front.addColorStop(1, shade(color, 0.06));
  g.fillStyle = front; g.fillRect(inset * 0.6, H * 0.88, W - inset * 1.2, H * 0.12);
  // Edge bevels darken toward the outside.
  const sides = g.createLinearGradient(0, 0, W, 0);
  sides.addColorStop(0, 'rgba(0,0,0,0.55)');
  sides.addColorStop(0.14, 'rgba(0,0,0,0)');
  sides.addColorStop(0.86, 'rgba(0,0,0,0)');
  sides.addColorStop(1, 'rgba(0,0,0,0.55)');
  g.fillStyle = sides; g.fillRect(0, 0, W, H);
  return toTexture(c);
}

let _shadowTex: THREE.Texture | null = null;
function shadowTexture(): THREE.Texture {
  if (_shadowTex) return _shadowTex;
  const { c, g } = canvas(64, 256);
  g.filter = 'blur(7px)';
  g.fillStyle = 'rgba(0,0,0,1)';
  g.fillRect(14, -20, 36, 250);
  _shadowTex = new THREE.CanvasTexture(c);
  return _shadowTex;
}

let _fadeTex: THREE.Texture | null = null;
/** White at the bottom, transparent at the top. */
function fadeTexture(): THREE.Texture {
  if (_fadeTex) return _fadeTex;
  const { c, g } = canvas(1, 64);
  const grad = g.createLinearGradient(0, 0, 0, 64);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(1, 'rgba(255,255,255,1)');
  g.fillStyle = grad; g.fillRect(0, 0, 1, 64);
  _fadeTex = new THREE.CanvasTexture(c);
  return _fadeTex;
}

/** A flat pane of darkened frosted glass (the key bed under a glass keyboard). */
function glassPlane(mul: number, add: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { tBackdrop: backdropUniforms.tBackdrop, uScreen: backdropUniforms.uScreen },
    vertexShader: `void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform sampler2D tBackdrop; uniform vec2 uScreen;
      void main() { gl_FragColor = vec4(texture2D(tBackdrop, gl_FragCoord.xy / uScreen).rgb * ${mul.toFixed(3)} + ${add.toFixed(3)}, 1.0); }`,
  });
}

const KEY_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

// The press tint keeps the key's own shading (it multiplies the surface's
// luminance), so a pressed ivory key still has its lip and edges.
const KEY_FRAG = /* glsl */ `
uniform sampler2D map;
uniform vec3 tint;
uniform float press;
uniform float tintAmt;
uniform float glowAmt;
uniform float glass;
uniform float smoked;
uniform sampler2D tBackdrop;
uniform vec2 uScreen;
varying vec2 vUv;
void main() {
  vec3 base = texture2D(map, vUv).rgb;
  float lum = dot(base, vec3(0.2126, 0.7152, 0.0722));
  if (glass > 0.5) {
    // The surface texture becomes shading only (lip, rounded edges, bevels)
    // over frosted glass: milky for white keys, smoked for black ones.
    vec3 behind = texture2D(tBackdrop, gl_FragCoord.xy / uScreen).rgb;
    // Milky toward the front of the key, clearer toward the back.
    float milk = mix(0.28, 0.55, 1.0 - vUv.y);
    vec3 white = mix(behind * 1.15 + vec3(0.05), behind * 0.6 + vec3(0.42), milk) * (0.42 + 0.68 * lum);
    vec3 black = (behind * 0.24 + vec3(0.012)) * (0.7 + 3.5 * lum);
    base = mix(white, black, smoked);
    lum = dot(base, vec3(0.2126, 0.7152, 0.0722));
  }
  vec3 tinted = tint * (0.22 + 0.95 * lum) + base * 0.12;
  vec3 col = mix(base, tinted, press * tintAmt);
  col *= 1.0 - press * 0.12 * (1.0 - vUv.y);
  col += tint * press * glowAmt;
  gl_FragColor = vec4(col, 1.0);
}`;

interface KeyData {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  isBlack: boolean;
  baseY: number;
  press: number;
  target: number;
}

interface Flash {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  intensity: number;
}

export class Piano {
  group: THREE.Group;
  private keys: Map<number, KeyData> = new Map();
  private beams: Map<number, Flash> = new Map();
  private ripples: Map<number, Flash> = new Map();
  private textures: THREE.Texture[] = [];
  private hitLineMat!: THREE.MeshBasicMaterial;
  private hitGlowMat!: THREE.MeshBasicMaterial;
  private range: KeyRange = { ...FULL_RANGE };
  private whiteCount = 52;
  private keyW = 0;
  private sceneW = 0;
  private sceneH = 0;
  private pressDepth = 0;
  pianoTop = 0;
  private hitLineGlow = 1;
  private beamGlow = 1;
  private hitRipple = false;
  private tintAmt = 0.55;
  private glowAmt = 0;

  constructor(scene: THREE.Scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
  }

  private dispose() {
    this.group.children.slice().forEach(c => {
      const m = c as THREE.Mesh;
      m.geometry?.dispose();
      (m.material as THREE.Material)?.dispose();
      this.group.remove(c);
    });
    this.textures.forEach(t => t.dispose());
    this.textures = [];
    this.keys.clear();
    this.beams.clear();
    this.ripples.clear();
  }

  build(sceneW: number, sceneH: number, theme: Theme, range: KeyRange = this.range) {
    this.dispose();
    this.sceneW = sceneW;
    this.sceneH = sceneH;
    this.range = { ...range };
    const { lo, hi } = this.range;

    this.whiteCount = 0;
    for (let m = lo; m <= hi; m++) if (!isBlack(m)) this.whiteCount++;
    const keyW = this.keyW = sceneW / this.whiteCount;

    // A white key is about six and a half times as long as it is wide. Follow
    // that when the range allows, within sensible limits of the screen height.
    const pianoH = Math.min(sceneH * 0.24, Math.max(sceneH * 0.15, keyW * 6.2));
    const blackH = pianoH * 0.63;
    const blackW = keyW * 0.56;
    const gap = Math.max(1, Math.min(2, keyW * 0.06));
    const feltH = Math.max(3, pianoH * 0.035);
    this.pianoTop = pianoH;
    this.pressDepth = Math.max(1.5, pianoH * 0.012);

    const neon = theme.piano.style === 'neon';
    const glass = theme.piano.style === 'glass';
    this.tintAmt = theme.piano.pressedGlow ? (neon ? 0.85 : glass ? 0.7 : 0.55) : 0;
    this.glowAmt = theme.piano.pressedGlow ? (neon ? 0.35 : glass ? 0.3 : 0) : 0;

    // Key bed: shows through the gaps between white keys.
    const bed = new THREE.Mesh(
      new THREE.PlaneGeometry(sceneW, pianoH),
      glass ? glassPlane(0.3, 0.008) : new THREE.MeshBasicMaterial({ color: neon ? 0x030308 : 0x0a0705 }),
    );
    bed.position.set(sceneW / 2, pianoH / 2, -0.5);
    this.group.add(bed);

    const whiteTex = whiteKeyTexture(theme.piano.whiteKeyColor, neon);
    const blackTex = blackKeyTexture(theme.piano.blackKeyColor, neon);
    this.textures.push(whiteTex, blackTex);

    const makeKeyMat = (map: THREE.Texture, isBlackKey: boolean) => new THREE.ShaderMaterial({
      uniforms: {
        map: { value: map },
        tint: { value: new THREE.Color(1, 1, 1) },
        press: { value: 0 },
        tintAmt: { value: this.tintAmt },
        glowAmt: { value: this.glowAmt },
        glass: { value: glass ? 1 : 0 },
        smoked: { value: isBlackKey ? 1 : 0 },
        tBackdrop: backdropUniforms.tBackdrop,
        uScreen: backdropUniforms.uScreen,
      },
      vertexShader: KEY_VERT,
      fragmentShader: KEY_FRAG,
    });

    const shadowTex = shadowTexture();
    for (let midi = lo; midi <= hi; midi++) {
      const black = isBlack(midi);
      const x = this.getKeyX(midi);
      const w = black ? blackW : keyW - gap;
      const h = black ? blackH : pianoH;
      const y = black ? pianoH - h / 2 : h / 2;
      const z = black ? 2.5 : 1.0;

      const mat = makeKeyMat(black ? blackTex : whiteTex, black);
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, 1), mat);
      mesh.position.set(x, y, z);
      this.group.add(mesh);
      this.keys.set(midi, { mesh, mat, isBlack: black, baseY: y, press: 0, target: 0 });

      if (black && !neon) {
        // Soft shadow the black key casts down and to the right onto the whites.
        const sh = new THREE.Mesh(
          new THREE.PlaneGeometry(w * 1.7, h * 1.06),
          new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: shadowTex, transparent: true, opacity: 0.55, depthWrite: false }),
        );
        sh.position.set(x + w * 0.16, y - h * 0.05, 1.8);
        this.group.add(sh);
      }

      // Press beam: rises from the hit line and fades upward.
      const beamH = pianoH * 0.9;
      const beamMat = new THREE.MeshBasicMaterial({
        color: 0xffffff, map: fadeTexture(), transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const beam = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.9, beamH), beamMat);
      beam.position.set(x, pianoH + beamH / 2, 3.5);
      this.group.add(beam);
      this.beams.set(midi, { mesh: beam, mat: beamMat, intensity: 0 });

      const rippleMat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const ripple = new THREE.Mesh(new THREE.PlaneGeometry(w * 1.8, 8), rippleMat);
      ripple.position.set(x, pianoH, 4.2);
      this.group.add(ripple);
      this.ripples.set(midi, { mesh: ripple, mat: rippleMat, intensity: 0 });
    }

    // Shadow the fallboard throws across the back of the keys.
    const slipH = pianoH * 0.09;
    const slip = new THREE.Mesh(
      new THREE.PlaneGeometry(sceneW, slipH),
      new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: fadeTexture(), transparent: true, opacity: neon ? 0.5 : 0.38, depthWrite: false }),
    );
    // alphaMap is opaque at the bottom; flip so it is darkest at the felt.
    slip.rotation.z = Math.PI;
    slip.position.set(sceneW / 2, pianoH - feltH - slipH / 2, 2.9);
    this.group.add(slip);

    // Felt strip along the back of the keys.
    const felt = new THREE.Mesh(
      new THREE.PlaneGeometry(sceneW, feltH),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(theme.piano.feltColor) }),
    );
    felt.position.set(sceneW / 2, pianoH - feltH / 2, 3);
    this.group.add(felt);

    // Hit line along the top of the felt, and a soft glow behind it.
    this.hitLineMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.1,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const hitLine = new THREE.Mesh(new THREE.PlaneGeometry(sceneW, 1.5), this.hitLineMat);
    hitLine.position.set(sceneW / 2, pianoH, 4);
    this.group.add(hitLine);

    this.hitGlowMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.05,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const hitGlow = new THREE.Mesh(new THREE.PlaneGeometry(sceneW, 18), this.hitGlowMat);
    hitGlow.position.set(sceneW / 2, pianoH, 3.9);
    this.group.add(hitGlow);
  }

  pressKey(midi: number, trackColor: THREE.Color, theme: Theme) {
    const k = this.keys.get(midi);
    if (!k) return;
    k.target = 1;
    k.mat.uniforms.tint.value.copy(trackColor);
    if (theme.piano.pressedGlow) {
      const b = this.beams.get(midi);
      if (b) { b.intensity = 1; b.mat.color.copy(trackColor); }
      if (this.hitRipple) {
        const r = this.ripples.get(midi);
        if (r) { r.intensity = 1; r.mat.color.copy(trackColor); }
      }
    }
    this.depthEffect = theme.piano.depthEffect;
  }

  private depthEffect = true;

  releaseKey(midi: number) {
    const k = this.keys.get(midi);
    if (k) k.target = 0;
  }

  update(dt: number, activeCount: number) {
    if (this.hitLineMat) {
      const target = (0.1 + Math.min(activeCount, 12) * 0.007) * this.hitLineGlow;
      this.hitLineMat.opacity += (target - this.hitLineMat.opacity) * Math.min(dt * 14, 1);
    }
    if (this.hitGlowMat) {
      const target = (0.015 + Math.min(activeCount, 12) * 0.003) * this.hitLineGlow;
      this.hitGlowMat.opacity += (target - this.hitGlowMat.opacity) * Math.min(dt * 10, 1);
    }

    // Keys go down fast and come back a little slower, like a real action.
    const down = Math.min(dt * 40, 1), up = Math.min(dt * 18, 1);
    this.keys.forEach(k => {
      if (k.press === k.target) return;
      k.press += (k.target - k.press) * (k.target > k.press ? down : up);
      if (Math.abs(k.target - k.press) < 0.004) k.press = k.target;
      k.mat.uniforms.press.value = k.press;
      k.mesh.position.y = k.baseY - (this.depthEffect ? this.pressDepth * k.press : 0);
    });

    const decay = Math.pow(0.04, dt);
    const beamPeak = 0.16 * this.beamGlow;
    this.beams.forEach(b => {
      if (b.intensity <= 0) return;
      b.intensity *= decay;
      if (b.intensity < 0.005) { b.intensity = 0; b.mat.opacity = 0; return; }
      b.mat.opacity = b.intensity * beamPeak;
    });

    const rippleDecay = Math.pow(0.001, dt);
    this.ripples.forEach(r => {
      if (r.intensity <= 0) return;
      r.intensity *= rippleDecay;
      if (r.intensity < 0.005) { r.intensity = 0; r.mat.opacity = 0; return; }
      r.mat.opacity = r.intensity * 0.6;
    });
  }

  private lastKey = '';

  /** Full rebuild using the stored dimensions and range. */
  rebuild(theme: Theme) {
    if (this.sceneW > 0 && this.sceneH > 0) this.build(this.sceneW, this.sceneH, theme, this.range);
  }

  applyTheme(theme: Theme) {
    const p = theme.piano;
    const key = [p.style, p.whiteKeyColor, p.blackKeyColor, p.feltColor, p.pressedGlow].join('|');
    if (key !== this.lastKey) { this.lastKey = key; this.rebuild(theme); }
    this.hitLineGlow = p.hitLineGlow;
    this.beamGlow = p.beamGlow;
    this.hitRipple = p.hitRipple;
    this.depthEffect = p.depthEffect;
  }

  /** Centre x of any key, including ones outside the visible range. */
  getKeyX(midi: number): number {
    const kw = this.keyW || this.sceneW / this.whiteCount;
    const dx = (whitesBelow(midi) - whitesBelow(this.range.lo)) * kw;
    if (!isBlack(midi)) return dx + kw / 2;
    return dx + (BLACK_OFFSET[((midi % 12) + 12) % 12] ?? 0) * kw;
  }

  get keyWidth(): number {
    return this.keyW || this.sceneW / this.whiteCount;
  }

  get currentRange(): KeyRange {
    return { ...this.range };
  }
}
