import type { Theme } from './types';

// Default pitch palette: even-spaced rainbow around the colour wheel.
// Indexed by midi % 12 (C=0, C#=1, D=2, D#=3, E=4, F=5, F#=6, G=7, G#=8, A=9, A#=10, B=11)
const DEFAULT_PITCH_COLORS: string[] = [
  '#ff5252', '#ff7c43', '#ffb142', '#ffd93d', '#a7e000', '#43d775',
  '#3ad6c2', '#3ab5f3', '#5775ff', '#9a5cff', '#d654ff', '#ff4fa3',
];

const DEFAULT_COMPOSITION = {
  cursorOpacity: 1,
  glowRadius: 0.3,
  glowIntensity: 1,
  cameraPreset: 'tilt' as const,
};
const DEFAULT_VIEW = {
  mode: 'performance' as const,
  cameraMode: 'ortho' as const,
  cameraAngle: 'standard' as const,
  reflectiveFloor: false,
  composition: { ...DEFAULT_COMPOSITION },
};

export const PRESETS: Theme[] = [
  {
    name: 'Classic',
    view: { ...DEFAULT_VIEW },
    background: { color: '#0f0f14', gradient: true, gradientStops: ['#0f0f14', '#1a1428', '#0f0f14'], starfield: false, scanlines: false, media: null },
    notes: { shape: 'rounded', cornerRadius: 5, opacity: 0.92, glowIntensity: 0.6, trailLength: 0.2, trailOpacity: 0.18, colorMode: 'track', pitchColors: [...DEFAULT_PITCH_COLORS], bloomMultiplier: 1, velocityModulation: { enabled: true, minBrightness: 0.5, maxBrightness: 1.4 }, shimmer: 0, afterglow: 0.25 },
    trackColors: ['#7c6dfa', '#f472b6', '#34d399', '#fbbf24', '#60a5fa', '#a78bfa', '#f87171', '#2dd4bf'],
    piano: { style: 'realistic', whiteKeyColor: '#f0ede0', blackKeyColor: '#1a1a18', pressedGlow: true, pressColorSource: 'track', pressCustomColor: '#7c6dfa', depthEffect: true, roughness: 0.35, metalness: 0.0, hitLineGlow: 1, beamGlow: 1, hitRipple: true },
    effects: { bloom: true, bloomStrength: 0.35, bloomThreshold: 0.25, bloomRadius: 0.5, particles: true, particleDensity: 0.5, particleLifetime: 1.0, filmGrain: false, filmGrainIntensity: 0.1, vignette: true, vignetteIntensity: 0.3, particleGlow: 1, particleShape: 'circle', particleCurl: 1, particleLayers: { sparks: true, embers: true, ambient: true }, chromaticAberration: false, chromaticAberrationIntensity: 0.3 },
    ui: { hudOpacity: 0.85, accentColor: '#7c6dfa' },
    timeline: { trackOpacityKeyframes: [], cameraKeyframes: [], autoCamera: true },
    markers: {
      beats: { enabled: false, color: '#ffffff', opacity: 0.08 },
      bars:  { enabled: false, color: '#ffffff', opacity: 0.18, thickness: 2 },
      beatsPerBar: 4,
    },
    tracks: { instruments: [] },
  },
  {
    name: 'Dark Neon',
    view: { ...DEFAULT_VIEW },
    background: { color: '#080810', gradient: true, gradientStops: ['#080810', '#0d0820', '#080810'], starfield: true, scanlines: false, media: null },
    notes: { shape: 'rounded', cornerRadius: 6, opacity: 0.95, glowIntensity: 0.8, trailLength: 0.3, trailOpacity: 0.2, colorMode: 'track', pitchColors: [...DEFAULT_PITCH_COLORS], bloomMultiplier: 1, velocityModulation: { enabled: true, minBrightness: 0.5, maxBrightness: 1.4 }, shimmer: 0, afterglow: 0.25 },
    trackColors: ['#7c6dfa', '#f472b6', '#34d399', '#fbbf24', '#60a5fa', '#a78bfa', '#f87171', '#2dd4bf'],
    piano: { style: 'neon', whiteKeyColor: '#1a1a2e', blackKeyColor: '#0a0a14', pressedGlow: true, pressColorSource: 'track', pressCustomColor: '#7c6dfa', depthEffect: true, roughness: 0.15, metalness: 0.6, hitLineGlow: 1.2, beamGlow: 1.2, hitRipple: true },
    effects: { bloom: true, bloomStrength: 0.7, bloomThreshold: 0.18, bloomRadius: 0.55, particles: true, particleDensity: 0.6, particleLifetime: 1.1, filmGrain: false, filmGrainIntensity: 0.1, vignette: true, vignetteIntensity: 0.35, particleGlow: 1.2, particleShape: 'star', particleCurl: 0.9, particleLayers: { sparks: true, embers: true, ambient: true }, chromaticAberration: false, chromaticAberrationIntensity: 0.3 },
    ui: { hudOpacity: 0.85, accentColor: '#7c6dfa' },
    timeline: { trackOpacityKeyframes: [], cameraKeyframes: [], autoCamera: true },
    markers: {
      beats: { enabled: false, color: '#ffffff', opacity: 0.08 },
      bars:  { enabled: false, color: '#ffffff', opacity: 0.18, thickness: 2 },
      beatsPerBar: 4,
    },
    tracks: { instruments: [] },
  },
  {
    name: 'Minimal',
    view: { ...DEFAULT_VIEW },
    background: { color: '#111118', gradient: false, gradientStops: ['#111118', '#1a1a28', '#111118'], starfield: false, scanlines: false, media: null },
    notes: { shape: 'rectangle', cornerRadius: 3, opacity: 0.85, glowIntensity: 0.2, trailLength: 0, trailOpacity: 0, colorMode: 'track', pitchColors: [...DEFAULT_PITCH_COLORS], bloomMultiplier: 1, velocityModulation: { enabled: true, minBrightness: 0.5, maxBrightness: 1.4 }, shimmer: 0, afterglow: 0.25 },
    trackColors: ['#818cf8', '#f9a8d4', '#6ee7b7', '#fcd34d', '#93c5fd', '#c4b5fd', '#fca5a5', '#5eead4'],
    piano: { style: 'realistic', whiteKeyColor: '#f0ede0', blackKeyColor: '#1a1a18', pressedGlow: false, pressColorSource: 'track', pressCustomColor: '#818cf8', depthEffect: false, roughness: 0.5, metalness: 0.0, hitLineGlow: 0.6, beamGlow: 0.6, hitRipple: false },
    effects: { bloom: false, bloomStrength: 0.3, bloomThreshold: 0.3, bloomRadius: 0.4, particles: false, particleDensity: 0.2, particleLifetime: 0.8, filmGrain: false, filmGrainIntensity: 0.05, vignette: false, vignetteIntensity: 0.15, particleGlow: 0.7, particleShape: 'circle', particleCurl: 1, particleLayers: { sparks: true, embers: true, ambient: true }, chromaticAberration: false, chromaticAberrationIntensity: 0.3 },
    ui: { hudOpacity: 0.7, accentColor: '#818cf8' },
    timeline: { trackOpacityKeyframes: [], cameraKeyframes: [], autoCamera: true },
    markers: {
      beats: { enabled: false, color: '#ffffff', opacity: 0.08 },
      bars:  { enabled: false, color: '#ffffff', opacity: 0.18, thickness: 2 },
      beatsPerBar: 4,
    },
    tracks: { instruments: [] },
  },
  {
    name: 'Cinematic',
    view: { ...DEFAULT_VIEW },
    background: { color: '#040818', gradient: true, gradientStops: ['#040818', '#0a1628', '#040818'], starfield: true, scanlines: false, media: null },
    notes: { shape: 'rounded', cornerRadius: 4, opacity: 0.9, glowIntensity: 0.5, trailLength: 0.18, trailOpacity: 0.15, colorMode: 'track', pitchColors: [...DEFAULT_PITCH_COLORS], bloomMultiplier: 1, velocityModulation: { enabled: true, minBrightness: 0.5, maxBrightness: 1.4 }, shimmer: 0, afterglow: 0.25 },
    trackColors: ['#f59e0b', '#d97706', '#92400e', '#fbbf24', '#b45309', '#78350f', '#fcd34d', '#f97316'],
    piano: { style: 'realistic', whiteKeyColor: '#f0ede0', blackKeyColor: '#1a1a18', pressedGlow: true, pressColorSource: 'track', pressCustomColor: '#f59e0b', depthEffect: true, roughness: 0.35, metalness: 0.1, hitLineGlow: 0.9, beamGlow: 1.0, hitRipple: true },
    effects: { bloom: true, bloomStrength: 0.3, bloomThreshold: 0.28, bloomRadius: 0.6, particles: true, particleDensity: 0.3, particleLifetime: 1.6, filmGrain: true, filmGrainIntensity: 0.12, vignette: true, vignetteIntensity: 0.45, particleGlow: 0.9, particleShape: 'spark', particleCurl: 1.2, particleLayers: { sparks: true, embers: true, ambient: true }, chromaticAberration: true, chromaticAberrationIntensity: 0.35 },
    ui: { hudOpacity: 0.8, accentColor: '#f59e0b' },
    timeline: { trackOpacityKeyframes: [], cameraKeyframes: [], autoCamera: true },
    markers: {
      beats: { enabled: false, color: '#ffffff', opacity: 0.08 },
      bars:  { enabled: false, color: '#ffffff', opacity: 0.18, thickness: 2 },
      beatsPerBar: 4,
    },
    tracks: { instruments: [] },
  },
  {
    name: 'Pastel',
    view: { ...DEFAULT_VIEW },
    background: { color: '#1a1a2e', gradient: true, gradientStops: ['#1a1a2e', '#16213e', '#0f3460'], starfield: false, scanlines: false, media: null },
    notes: { shape: 'capsule', cornerRadius: 20, opacity: 0.8, glowIntensity: 0.35, trailLength: 0.12, trailOpacity: 0.12, colorMode: 'track', pitchColors: [...DEFAULT_PITCH_COLORS], bloomMultiplier: 1, velocityModulation: { enabled: true, minBrightness: 0.5, maxBrightness: 1.4 }, shimmer: 0, afterglow: 0.25 },
    trackColors: ['#a5b4fc', '#f9a8d4', '#99f6e4', '#fde68a', '#bfdbfe', '#ddd6fe', '#fecaca', '#a7f3d0'],
    piano: { style: 'realistic', whiteKeyColor: '#f0ede0', blackKeyColor: '#1a1a18', pressedGlow: true, pressColorSource: 'track', pressCustomColor: '#a5b4fc', depthEffect: false, roughness: 0.45, metalness: 0.0, hitLineGlow: 0.8, beamGlow: 0.8, hitRipple: true },
    effects: { bloom: true, bloomStrength: 0.25, bloomThreshold: 0.3, bloomRadius: 0.45, particles: false, particleDensity: 0.3, particleLifetime: 1.0, filmGrain: false, filmGrainIntensity: 0.08, vignette: true, vignetteIntensity: 0.25, particleGlow: 0.8, particleShape: 'star', particleCurl: 0.9, particleLayers: { sparks: true, embers: true, ambient: true }, chromaticAberration: false, chromaticAberrationIntensity: 0.3 },
    ui: { hudOpacity: 0.75, accentColor: '#a5b4fc' },
    timeline: { trackOpacityKeyframes: [], cameraKeyframes: [], autoCamera: true },
    markers: {
      beats: { enabled: false, color: '#ffffff', opacity: 0.08 },
      bars:  { enabled: false, color: '#ffffff', opacity: 0.18, thickness: 2 },
      beatsPerBar: 4,
    },
    tracks: { instruments: [] },
  },
  {
    name: 'Forest',
    view: { ...DEFAULT_VIEW },
    background: { color: '#0a1410', gradient: true, gradientStops: ['#0a1410', '#0e1f18', '#152a20'], starfield: false, scanlines: false, media: null },
    notes: { shape: 'rounded', cornerRadius: 5, opacity: 0.92, glowIntensity: 0.5, trailLength: 0.15, trailOpacity: 0.16, colorMode: 'track', pitchColors: [...DEFAULT_PITCH_COLORS], bloomMultiplier: 0.9, velocityModulation: { enabled: true, minBrightness: 0.55, maxBrightness: 1.3 }, shimmer: 0.04, afterglow: 0.4 },
    trackColors: ['#76b454', '#d4a657', '#3c7a4e', '#c98444', '#9bc36a', '#7c5e3a', '#5fa86f', '#b87838'],
    piano: { style: 'realistic', whiteKeyColor: '#e8e2cd', blackKeyColor: '#1d1a14', pressedGlow: true, pressColorSource: 'track', pressCustomColor: '#76b454', depthEffect: true, roughness: 0.45, metalness: 0.0, hitLineGlow: 0.7, beamGlow: 0.7, hitRipple: true },
    effects: { bloom: true, bloomStrength: 0.4, bloomThreshold: 0.26, bloomRadius: 0.55, particles: true, particleDensity: 0.35, particleLifetime: 1.2, filmGrain: true, filmGrainIntensity: 0.08, vignette: true, vignetteIntensity: 0.4, particleGlow: 0.8, particleShape: 'circle', particleCurl: 1, particleLayers: { sparks: true, embers: true, ambient: true }, chromaticAberration: false, chromaticAberrationIntensity: 0.3 },
    ui: { hudOpacity: 0.82, accentColor: '#76b454' },
    timeline: { trackOpacityKeyframes: [], cameraKeyframes: [], autoCamera: true },
    markers: {
      beats: { enabled: false, color: '#ffffff', opacity: 0.08 },
      bars:  { enabled: false, color: '#ffffff', opacity: 0.18, thickness: 2 },
      beatsPerBar: 4,
    },
    tracks: { instruments: [] },
  },
  {
    name: 'Cyber',
    view: { ...DEFAULT_VIEW },
    background: { color: '#04060a', gradient: true, gradientStops: ['#04060a', '#0a0418', '#04060a'], starfield: true, scanlines: true, media: null },
    notes: { shape: 'rounded', cornerRadius: 4, opacity: 1.0, glowIntensity: 1.0, trailLength: 0.4, trailOpacity: 0.28, colorMode: 'track', pitchColors: [...DEFAULT_PITCH_COLORS], bloomMultiplier: 1.4, velocityModulation: { enabled: true, minBrightness: 0.6, maxBrightness: 1.6 }, shimmer: 0.06, afterglow: 0.2 },
    trackColors: ['#22e7ff', '#ff3fda', '#a3ff3d', '#7a3dff', '#ff7a3d', '#3dffd4', '#ff3d6f', '#3d7aff'],
    piano: { style: 'neon', whiteKeyColor: '#101019', blackKeyColor: '#04040a', pressedGlow: true, pressColorSource: 'track', pressCustomColor: '#22e7ff', depthEffect: true, roughness: 0.12, metalness: 0.7, hitLineGlow: 1.3, beamGlow: 1.4, hitRipple: true },
    effects: { bloom: true, bloomStrength: 0.95, bloomThreshold: 0.16, bloomRadius: 0.7, particles: true, particleDensity: 0.7, particleLifetime: 1.0, filmGrain: false, filmGrainIntensity: 0.1, vignette: true, vignetteIntensity: 0.35, particleGlow: 1.3, particleShape: 'spark', particleCurl: 1.2, particleLayers: { sparks: true, embers: true, ambient: true }, chromaticAberration: true, chromaticAberrationIntensity: 0.45 },
    ui: { hudOpacity: 0.85, accentColor: '#22e7ff' },
    timeline: { trackOpacityKeyframes: [], cameraKeyframes: [], autoCamera: true },
    markers: {
      beats: { enabled: false, color: '#ffffff', opacity: 0.08 },
      bars:  { enabled: false, color: '#ffffff', opacity: 0.18, thickness: 2 },
      beatsPerBar: 4,
    },
    tracks: { instruments: [] },
  },
  {
    name: 'Sunset',
    view: { ...DEFAULT_VIEW },
    background: { color: '#1a0820', gradient: true, gradientStops: ['#1a0820', '#3a1230', '#5a1f1a'], starfield: false, scanlines: false, media: null },
    notes: { shape: 'capsule', cornerRadius: 14, opacity: 0.92, glowIntensity: 0.7, trailLength: 0.22, trailOpacity: 0.22, colorMode: 'track', pitchColors: [...DEFAULT_PITCH_COLORS], bloomMultiplier: 1.1, velocityModulation: { enabled: true, minBrightness: 0.55, maxBrightness: 1.45 }, shimmer: 0.02, afterglow: 0.5 },
    trackColors: ['#ff7a8a', '#ffba6b', '#ff5a93', '#ffd07a', '#e368a8', '#ff8a5c', '#c468d4', '#ffac6b'],
    piano: { style: 'realistic', whiteKeyColor: '#f0e6d4', blackKeyColor: '#1f1218', pressedGlow: true, pressColorSource: 'track', pressCustomColor: '#ff7a8a', depthEffect: true, roughness: 0.4, metalness: 0.05, hitLineGlow: 0.85, beamGlow: 0.95, hitRipple: true },
    effects: { bloom: true, bloomStrength: 0.5, bloomThreshold: 0.22, bloomRadius: 0.65, particles: true, particleDensity: 0.4, particleLifetime: 1.4, filmGrain: true, filmGrainIntensity: 0.1, vignette: true, vignetteIntensity: 0.55, particleGlow: 1.0, particleShape: 'circle', particleCurl: 1, particleLayers: { sparks: true, embers: true, ambient: true }, chromaticAberration: true, chromaticAberrationIntensity: 0.25 },
    ui: { hudOpacity: 0.82, accentColor: '#ff7a8a' },
    timeline: { trackOpacityKeyframes: [], cameraKeyframes: [], autoCamera: true },
    markers: {
      beats: { enabled: false, color: '#ffffff', opacity: 0.08 },
      bars:  { enabled: false, color: '#ffffff', opacity: 0.18, thickness: 2 },
      beatsPerBar: 4,
    },
    tracks: { instruments: [] },
  },
];

export const DEFAULT_THEME = PRESETS[0];
