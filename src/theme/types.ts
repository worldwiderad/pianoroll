export type CameraMode = 'ortho' | 'perspective';
export type CameraAngle = 'standard' | 'low' | 'overhead' | 'cinematic';
export type NoteColorMode = 'track' | 'pitch';
export type ViewMode = 'performance' | 'composition';
export type CompCameraPreset = 'tilt' | 'front' | 'side' | 'top';
export type InstrumentId = 'piano' | 'strings' | 'brass' | 'woodwinds' | 'synthPad' | 'synthLead' | 'drum';

export interface TrackOpacityKeyframe {
  trackIdx: number;
  time: number;     // seconds
  opacity: number;  // 0..1
}

export interface CameraKeyframe {
  time: number;
  theta: number;    // azimuth (rad)
  phi: number;      // polar (rad, 0..π)
  radius: number;
  lookAt: [number, number, number];
}

export interface Theme {
  name: string;
  view: {
    mode: ViewMode;
    cameraMode: CameraMode;
    cameraAngle: CameraAngle;
    reflectiveFloor: boolean;
    composition: {
      cursorOpacity: number;     // multiplier on the cursor plane (0..2)
      glowRadius: number;        // seconds of after-glow as the cursor passes a note
      glowIntensity: number;     // multiplier on the active-note brightness boost
      cameraPreset: CompCameraPreset;
    };
  };
  background: {
    color: string;
    gradient: boolean;
    gradientStops: [string, string, string];
    starfield: boolean;
    scanlines: boolean;
    /** Slow-moving glows of colour behind everything. */
    aurora: boolean;
    auroraColors: [string, string, string, string];
    /**
     * Optional image/video overlay behind the scene. `src` is a temporary
     * object URL — NOT persisted in localStorage (would bust quota and the
     * blob is invalid across sessions anyway).
     */
    media: {
      enabled: boolean;
      type: 'image' | 'video';
      src: string;            // object URL
      fileName: string;       // shown in UI
      fit: 'cover' | 'contain' | 'stretch';
      opacity: number;        // 0..1
      blur: number;           // 0..20 pixels
    } | null;
  };
  notes: {
    shape: 'rectangle' | 'rounded' | 'capsule';
    cornerRadius: number;
    opacity: number;
    glowIntensity: number;
    trailLength: number;
    trailOpacity: number;
    colorMode: NoteColorMode;
    pitchColors: string[]; // length 12, indexed by midi % 12 (C=0, C#=1, …, B=11)
    /** Per-element bloom contribution (multiplier on emissive output, 0..2). */
    bloomMultiplier: number;
    /** Map MIDI velocity → brightness multiplier on each note bar. */
    velocityModulation: {
      enabled: boolean;
      minBrightness: number; // brightness for velocity≈0
      maxBrightness: number; // brightness for velocity=1
    };
    /** Subtle sine-wave shimmer added to each note's colour. 0 disables. */
    shimmer: number;
    /** Seconds the note keeps rendering past `noteEnd`, dimmed. */
    afterglow: number;
    /** Lit leading edge and inner rim on each note (0 = flat, 1 = full). */
    bevel: number;
    /** Frosted glass notes that show a blurred background through them (0 = solid, 1 = glass). */
    glass: number;
  };
  trackColors: string[];
  piano: {
    style: 'realistic' | 'neon' | 'glass';
    whiteKeyColor: string;
    blackKeyColor: string;
    pressedGlow: boolean;
    pressColorSource: 'track' | 'custom';
    pressCustomColor: string;
    depthEffect: boolean;
    roughness: number;
    metalness: number;
    /** Hit-line brightness multiplier (0..2). Drives bloom contribution of the line. */
    hitLineGlow: number;
    /** Press-beam brightness multiplier (0..2). */
    beamGlow: number;
    /** When true, each note press fires a brief horizontal hit-line ripple. */
    hitRipple: boolean;
    /** 'fit' frames the keyboard to the piece's notes; 'full' shows all 88 keys. */
    range: 'fit' | 'full';
    /** The felt strip along the back of the keys. */
    feltColor: string;
  };
  effects: {
    bloom: boolean;
    bloomStrength: number;
    bloomThreshold: number;
    bloomRadius: number;
    particles: boolean;
    particleDensity: number;
    particleLifetime: number;
    /** Particle brightness multiplier (0..2). */
    particleGlow: number;
    /** Legacy shape selector — ignored by the GPU particle pipeline; kept so
     *  older themes still parse. The new pipeline uses per-layer billboards. */
    particleShape: 'circle' | 'spark' | 'star';
    /** Curl-noise strength multiplier (0 = no swirl, 1 = default, 2 = chaotic). */
    particleCurl: number;
    /** Per-layer enables for the multi-layer GPU pipeline. */
    particleLayers: {
      sparks: boolean;
      embers: boolean;
      ambient: boolean;
      /** The bright flash and shockwave ring where a note lands. */
      impact: boolean;
    };
    filmGrain: boolean;
    filmGrainIntensity: number;
    vignette: boolean;
    vignetteIntensity: number;
    /** Chromatic aberration intensity (0..1). */
    chromaticAberration: boolean;
    chromaticAberrationIntensity: number;
    /** How strongly glass blurs what is behind it (0..1). */
    frost: number;
  };
  ui: {
    hudOpacity: number;
    accentColor: string;
    /** Light, frosted panels instead of dark ones. */
    frosted: boolean;
  };
  timeline: {
    trackOpacityKeyframes: TrackOpacityKeyframe[];
    cameraKeyframes: CameraKeyframe[];
    autoCamera: boolean;
  };
  markers: {
    beats: { enabled: boolean; color: string; opacity: number };
    bars:  { enabled: boolean; color: string; opacity: number; thickness: number };
    beatsPerBar: number;
  };
  tracks: {
    /** Parallel to MIDI tracks. Missing entries default to 'piano' at runtime. */
    instruments: InstrumentId[];
  };
}
