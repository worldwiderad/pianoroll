import type { Theme } from './types';

// Default pitch palette: even-spaced around the colour wheel.
// Indexed by midi % 12 (C=0, C#=1, D=2, D#=3, E=4, F=5, F#=6, G=7, G#=8, A=9, A#=10, B=11)
const DEFAULT_PITCH_COLORS: string[] = [
  '#ff5252', '#ff7c43', '#ffb142', '#ffd93d', '#a7e000', '#43d775',
  '#3ad6c2', '#3ab5f3', '#5775ff', '#9a5cff', '#d654ff', '#ff4fa3',
];

type Patch = {
  [K in keyof Theme]?: Theme[K] extends unknown[] ? Theme[K] : Theme[K] extends object ? Partial<Theme[K]> : Theme[K];
};

/**
 * Every preset starts from this and overrides what makes it different.
 * Bloom thresholds sit above the brightest part of an ivory key, so only
 * the notes, beams and particles glow — never the keyboard.
 */
function base(): Theme {
  return {
    name: '',
    view: {
      mode: 'performance',
      cameraMode: 'ortho',
      cameraAngle: 'standard',
      reflectiveFloor: false,
      composition: { cursorOpacity: 1, glowRadius: 0.3, glowIntensity: 1, cameraPreset: 'tilt' },
    },
    background: {
      color: '#0b0908', gradient: true, gradientStops: ['#0b0908', '#0b0908', '#0b0908'], starfield: false, scanlines: false, media: null,
      aurora: false, auroraColors: ['#ff4fd8', '#6a5cff', '#22d3ee', '#ff9a3c'],
    },
    notes: {
      shape: 'rounded', cornerRadius: 4, opacity: 0.95, glowIntensity: 0.45,
      trailLength: 0, trailOpacity: 0, colorMode: 'track', pitchColors: [...DEFAULT_PITCH_COLORS],
      bloomMultiplier: 1.4, velocityModulation: { enabled: true, minBrightness: 0.6, maxBrightness: 1.35 },
      shimmer: 0, afterglow: 0.2, bevel: 0.6, glass: 0,
    },
    trackColors: [],
    piano: {
      style: 'realistic', whiteKeyColor: '#f3efe4', blackKeyColor: '#16120f',
      pressedGlow: true, pressColorSource: 'track', pressCustomColor: '#e6b45e',
      depthEffect: true, roughness: 0.35, metalness: 0,
      hitLineGlow: 0.6, beamGlow: 0.7, hitRipple: false,
      range: 'fit', feltColor: '#7a1f24',
    },
    effects: {
      bloom: true, bloomStrength: 0.55, bloomThreshold: 0.95, bloomRadius: 0.45,
      particles: true, particleDensity: 0.3, particleLifetime: 1.0, particleGlow: 0.8,
      particleShape: 'circle', particleCurl: 0.7, particleLayers: { sparks: true, embers: true, ambient: false, impact: false },
      filmGrain: true, filmGrainIntensity: 0.05, vignette: true, vignetteIntensity: 0.35,
      chromaticAberration: false, chromaticAberrationIntensity: 0.2, frost: 0.6,
    },
    ui: { hudOpacity: 0.9, accentColor: '#d9b26f', frosted: false },
    timeline: { trackOpacityKeyframes: [], cameraKeyframes: [], autoCamera: true },
    markers: {
      beats: { enabled: false, color: '#ffffff', opacity: 0.06 },
      bars: { enabled: false, color: '#ffffff', opacity: 0.14, thickness: 2 },
      beatsPerBar: 4,
    },
    tracks: { instruments: [] },
  };
}

function preset(name: string, p: Patch): Theme {
  const b = base();
  const out = { ...b, name } as Theme;
  for (const k of Object.keys(p) as (keyof Theme)[]) {
    const v = p[k];
    const bv = b[k];
    (out as unknown as Record<string, unknown>)[k] = (v && typeof v === 'object' && !Array.isArray(v) && bv && typeof bv === 'object')
      ? { ...(bv as object), ...(v as object) }
      : v;
  }
  return out;
}

export const PRESETS: Theme[] = [
  // A dark stage, an ivory and ebony keyboard with red felt, notes in warm
  // amber and a clear blue for the two hands.
  preset('Concert', {
    background: { gradientStops: ['#17100b', '#0c0908', '#070606'] },
    trackColors: ['#e6b45e', '#7c9ee8', '#d9826a', '#9cc79f', '#c49be0', '#d6c08f', '#6fc0bd', '#e07a90'],
  }),

  // Saturated light on near-black: trails, sparks, a strong bloom on the notes
  // and beams, and the same real keyboard underneath.
  preset('Neon', {
    background: { gradientStops: ['#0d0a22', '#08071a', '#04040a'], starfield: true },
    notes: { cornerRadius: 5, glowIntensity: 0.7, trailLength: 0.35, trailOpacity: 0.22, bevel: 0.35, bloomMultiplier: 1.6, velocityModulation: { enabled: true, minBrightness: 0.6, maxBrightness: 1.5 }, afterglow: 0.35 },
    trackColors: ['#22d3ee', '#f472d0', '#a3e635', '#fbbf24', '#818cf8', '#fb7185', '#2dd4bf', '#c084fc'],
    piano: { whiteKeyColor: '#e9ecf2', blackKeyColor: '#0d0e14', feltColor: '#1a1d40', hitLineGlow: 1.4, beamGlow: 1.3, hitRipple: true, pressCustomColor: '#22d3ee' },
    effects: { bloomStrength: 0.8, bloomRadius: 0.5, particleDensity: 0.55, particleGlow: 1.1, particleCurl: 1, particleLayers: { sparks: true, embers: true, ambient: true, impact: false }, filmGrain: false, vignetteIntensity: 0.4, chromaticAberration: true, chromaticAberrationIntensity: 0.12 },
    ui: { hudOpacity: 0.9, accentColor: '#22d3ee', frosted: false },
  }),

  // Frosted glass over moving colour: the notes and keys blur and tint what
  // is behind them, with a lit rim along the top and left of each.
  preset('Glass', {
    background: { gradientStops: ['#1a1036', '#0d0b24', '#07061a'], aurora: true, auroraColors: ['#ff4fd8', '#6a5cff', '#22d3ee', '#ff9a3c'] },
    notes: { cornerRadius: 9, opacity: 1, glass: 1, glowIntensity: 0.5, bevel: 0, bloomMultiplier: 1.3, velocityModulation: { enabled: true, minBrightness: 0.7, maxBrightness: 1.3 }, afterglow: 0.3 },
    trackColors: ['#ff8ad8', '#8fd3ff', '#b69cff', '#7dffcf', '#ffd27a', '#ff9f8a', '#9cf0ff', '#e3a6ff'],
    piano: { style: 'glass', whiteKeyColor: '#ffffff', blackKeyColor: '#16132a', feltColor: '#c8b6ff', hitLineGlow: 1.2, beamGlow: 1.1, hitRipple: true, pressCustomColor: '#b69cff' },
    effects: { bloomStrength: 0.6, bloomRadius: 0.6, particleDensity: 0.35, particleGlow: 0.9, particleLayers: { sparks: true, embers: false, ambient: true, impact: false }, filmGrainIntensity: 0.035, vignetteIntensity: 0.25, frost: 0.7 },
    ui: { hudOpacity: 0.9, accentColor: '#c4b0ff', frosted: true },
  }),

  // Flat and exact, like a DAW: no glow, no particles, bright distinct track
  // colours and a beat grid.
  preset('Studio', {
    background: { color: '#141518', gradient: false },
    notes: { shape: 'rectangle', cornerRadius: 2, opacity: 1, glowIntensity: 0.1, bevel: 0.25, bloomMultiplier: 1, velocityModulation: { enabled: true, minBrightness: 0.75, maxBrightness: 1.15 }, afterglow: 0.1 },
    trackColors: ['#4f9dff', '#ff8a3d', '#3ecf8e', '#f5c542', '#c77dff', '#ff5d73', '#3cc8d8', '#a3a3a3'],
    piano: { whiteKeyColor: '#eeeeec', blackKeyColor: '#202124', feltColor: '#2a2b2f', hitLineGlow: 0.5, beamGlow: 0, pressCustomColor: '#4f9dff' },
    effects: { bloom: false, particles: false, filmGrain: false, vignette: false },
    ui: { hudOpacity: 0.95, accentColor: '#4f9dff' },
    markers: { beats: { enabled: true, color: '#ffffff', opacity: 0.05 }, bars: { enabled: true, color: '#ffffff', opacity: 0.12, thickness: 1 }, beatsPerBar: 4 },
  }),

  // Ink on paper.
  preset('Paper', {
    background: { color: '#f4f1ea', gradient: false },
    notes: { cornerRadius: 3, opacity: 1, glowIntensity: 0, bevel: 0.3, bloomMultiplier: 1, velocityModulation: { enabled: true, minBrightness: 0.85, maxBrightness: 1.05 }, afterglow: 0.1 },
    trackColors: ['#2340a8', '#1c1c1c', '#b23a2a', '#2f7a4f', '#7a4fa3', '#b07d1a', '#2b7f8f', '#6b6b6b'],
    piano: { whiteKeyColor: '#fbfaf6', blackKeyColor: '#1b1b1b', feltColor: '#8c2a2a', hitLineGlow: 0, beamGlow: 0, pressCustomColor: '#2340a8' },
    effects: { bloom: false, particles: false, filmGrain: false, vignette: false },
    ui: { hudOpacity: 0.92, accentColor: '#2340a8' },
    markers: { beats: { enabled: false, color: '#000000', opacity: 0.05 }, bars: { enabled: true, color: '#000000', opacity: 0.08, thickness: 1 }, beatsPerBar: 4 },
  }),

  preset('Midnight', {
    background: { gradientStops: ['#0b1733', '#060d22', '#03060f'], starfield: true },
    notes: { cornerRadius: 6, glowIntensity: 0.6, trailLength: 0.18, trailOpacity: 0.15, bevel: 0.5, bloomMultiplier: 1.7, afterglow: 0.3 },
    trackColors: ['#7dd3fc', '#c4b5fd', '#93c5fd', '#f0abfc', '#a5f3fc', '#e0e7ff', '#67e8f9', '#a78bfa'],
    piano: { whiteKeyColor: '#eef1f6', blackKeyColor: '#0e1220', feltColor: '#1d2b4f', hitLineGlow: 0.9, beamGlow: 1, pressCustomColor: '#93c5fd' },
    effects: { bloomStrength: 0.7, bloomRadius: 0.6, particleDensity: 0.4, particleGlow: 1, particleLayers: { sparks: true, embers: false, ambient: true, impact: false }, filmGrainIntensity: 0.06, vignetteIntensity: 0.45 },
    ui: { hudOpacity: 0.9, accentColor: '#93c5fd' },
  }),

  preset('Sunset', {
    background: { gradientStops: ['#5a1f1a', '#3a1230', '#1a0820'] },
    notes: { shape: 'capsule', cornerRadius: 14, glowIntensity: 0.7, trailLength: 0.22, trailOpacity: 0.2, bevel: 0.5, bloomMultiplier: 1.6, afterglow: 0.5 },
    trackColors: ['#ff8a7a', '#ffba6b', '#ff5a93', '#ffd07a', '#e368a8', '#ff8a5c', '#c468d4', '#ffac6b'],
    piano: { whiteKeyColor: '#f4ead8', blackKeyColor: '#1f1218', feltColor: '#6e1f2e', hitLineGlow: 0.85, beamGlow: 0.95, hitRipple: true, pressCustomColor: '#ff8a7a' },
    effects: { bloomStrength: 0.6, bloomRadius: 0.65, particleDensity: 0.4, particleLayers: { sparks: true, embers: true, ambient: true, impact: false }, filmGrainIntensity: 0.08, vignetteIntensity: 0.5 },
    ui: { hudOpacity: 0.88, accentColor: '#ff8a7a' },
  }),
];

export const DEFAULT_THEME = PRESETS[0];
