# Piano Roll — Features

A browser-based MIDI piano roll visualiser with falling notes, a configurable piano keyboard, post-processing effects, and a fully user-customisable theme system. WebGL-rendered, runs entirely in the browser.

---

## Table of contents

- [Quick start](#quick-start)
- [File support](#file-support)
- [Playback & transport](#playback--transport)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Scene](#scene)
  - [Piano keyboard](#piano-keyboard)
  - [Note rain](#note-rain)
  - [Hit line & press effects](#hit-line--press-effects)
  - [Particles](#particles)
  - [Background](#background)
  - [Post-processing](#post-processing)
- [Tracks](#tracks)
- [Theme system](#theme-system)
  - [Built-in presets](#built-in-presets)
  - [Customisable properties](#customisable-properties)
  - [Import / export / persistence](#import--export--persistence)
- [Settings UI](#settings-ui)
- [Tech stack](#tech-stack)

---

## Quick start

```
npm install
npm run dev
```

Open `http://localhost:5173`. The app boots straight into a **split-screen** with the settings panel on the left and a live demo running on the right canvas. Drop your MIDI file (and optionally an audio file) onto the Load tab and press **Start ▶**.

---

## File support

| Type | Formats | Notes |
|---|---|---|
| **MIDI** | `.mid`, `.midi` | Multi-track supported; tracks parsed via `@tonejs/midi`. Each track renders as its own coloured stream of notes. |
| **Audio** | `.mp3`, `.wav`, `.ogg` (anything `decodeAudioData` supports) | Optional. Plays synchronised to MIDI position via `AudioContext.currentTime`. No built-in synth. |

Files can be loaded via:
- Drag-and-drop into either drop zone on the **Load** tab
- Drag-and-drop anywhere on the document
- Click the drop zone to open a system file picker

A short looping **demo MIDI** plays automatically on boot so the canvas preview is always populated, even before you load real files.

---

## Playback & transport

The transport bar appears at the bottom once a MIDI file is loaded.

- **Play / Pause** button (also Space key)
- **Restart** — jumps back to 00:00 and stops
- **Seek scrubber** — drag to seek; the audio stream is re-anchored on release so audio + visuals stay in sync
- **Speed selector** — 0.25× / 0.5× / 1× / 1.5× / 2×; rate-scales both the clock and the audio buffer source
- **Time display** — `current / total` in `m:ss` format
- **Tracks button** — opens the per-track sidebar
- **Settings button** — re-opens the settings panel mid-playback

When a song reaches the end, the audio stops automatically.

---

## Keyboard shortcuts

| Key | Action |
|---|---|
| `Space` | Play / Pause |
| `←` | Seek backward 5 seconds |
| `→` | Seek forward 5 seconds |

Shortcuts are suppressed while any text input or `<select>` has focus.

---

## Scene

Everything visible is rendered through a single Three.js `WebGLRenderer` driving an `OrthographicCamera`. The scene is split into back-to-front layers (background → piano → notes → beams → hit line → particles), with post-processing on top.

### Piano keyboard

- Full **88-key** layout, A0 (MIDI 21) to C8 (MIDI 108)
- Correct white/black layout with black keys top-aligned at the hit line so falling black notes meet their key visually
- Two **style modes**, switched live:
  - **Realistic** — cream white keys, near-black black keys, warm wood-toned background fill behind the keys
  - **Neon** — dark keys (theme-configurable colours), high-contrast colour wash on press
- Toggling style auto-swaps key colours so the difference is visible
- **Depth press**: pressed keys briefly translate downward, giving a tactile feel
- **Press glow** (toggleable): tints the pressed key with the source colour and fires a press beam
- **Press colour source**: either pulled from the note's track colour, or a fixed custom colour

### Note rain

Each track gets its own `InstancedMesh` of note bars (up to 4096 simultaneous instances per track) rendered with a custom GLSL **SDF rounded-rectangle shader**.

- Notes fall top → bottom; the bottom of the bar reaches the hit line at the note's start time
- Bottom clamped at the hit line so notes never render inside the piano
- Per-track colour, opacity, and brightness
- **Per-instance proximity glow** — notes brighten as they approach the hit line (per-instance `aBrightness` `InstancedBufferAttribute`)
- **Cursor-based culling** — a per-track index advances forward so the renderer never scans the full notes array each frame (O(1) per frame after the cursor finds the window; resets on backward seek)
- **Trail effect** — ghost copy of each note offset along the fall direction with configurable length and opacity
- **Three shapes**:
  - **Rectangle** — sharp corners (corner-radius slider hidden)
  - **Rounded** — adjustable corner radius, capped at 50% of the note's half-width so it never collapses into a capsule
  - **Capsule** — fully pill-shaped ends regardless of corner radius (slider hidden)

### Hit line & press effects

A horizontal glowing line marks where falling notes contact the piano:

- A thin bright line + a wider soft glow plane, both **additive-blended**
- Brightness pulses softly with the number of currently-pressed keys
- **Press beams** — when a key is first pressed, a gradient column of light (from the key, fading upward) is briefly emitted, coloured by the active track; decays with an exponential falloff so simultaneous notes don't stack into a flood

### Particles

Bursts of additive-blended particles on each note-press event:

- Custom point shader with circular falloff (so points look like glow dots, not squares)
- Random upward velocity + horizontal spread, with gravity
- Particle pool (no per-frame allocation churn)
- **Density** and **lifetime** are theme-controlled
- Coloured by the active track's colour

### Background

- Solid colour **or** three-stop vertical gradient (toggleable)
- Optional animated **starfield** — slow downward drift; speeds up while playing
- Optional **scanline** post-processing overlay (configurable independently of film grain)

### Post-processing

Composer pipeline:

1. `RenderPass` (scene → buffer)
2. `UnrealBloomPass` — global bloom (strength / threshold / radius)
3. Vignette (custom shader)
4. Film grain + scanlines (custom shader; grain and scanline intensities are separate uniforms)
5. `OutputPass` (tone-mapped output to canvas)

Tone mapping: **ACES Filmic**.

Pixel ratio is capped at 1.5 so retina displays don't get crushed by 4× GPU work.

---

## Tracks

When a multi-track MIDI is loaded, the **Tracks panel** (toggleable from the transport) shows every non-empty track:

- Coloured swatch — click to change that track's colour live
- Track name (from MIDI metadata, falls back to `Track N`)
- Note count
- Visibility toggle (eye icon) — hides that track's notes without affecting clock/audio

Track colour swatches also appear in the **Notes** tab of the settings panel, so colours can be tweaked before loading any MIDI.

---

## Theme system

Every visual property of the visualiser is part of a single `Theme` object. Changes are applied live; nothing requires a reload.

### Built-in presets

| Preset | Style | Look |
|---|---|---|
| **Classic** *(default)* | Realistic | Soft purple-tinted gradient, neon-coloured notes, cream piano, moderate bloom |
| **Dark Neon** | Neon | Deep black background with starfield, vivid track colours, strong bloom, dark piano keys |
| **Minimal** | Realistic | Flat dark grey background, pastel notes, no bloom, no effects |
| **Cinematic** | Realistic | Deep blue gradient, amber/gold track palette, soft bloom, film grain, dust starfield |
| **Pastel** | Realistic | Blue gradient, soft rainbow track palette, gentle bloom |

### Customisable properties

Every preset value is also exposed as a live setting:

**Background**
- Base colour (used when gradient is off)
- Gradient toggle + 3 stop colours
- Starfield toggle
- Scanlines toggle

**Notes**
- Shape: rectangle / rounded / capsule
- Corner radius (only meaningful for rounded)
- Opacity
- Glow intensity (drives proximity brightness multiplier)
- Trail length and opacity
- Per-track colours (8 slots, also editable via the Tracks panel)

**Piano**
- Style: realistic / neon (auto-swaps default key colours on change)
- White key colour
- Black key colour
- Press glow toggle (gates the key tint + beam)
- Press colour source: from track / custom
- Custom press colour
- Depth press toggle

**Effects**
- Bloom toggle, strength, threshold, radius
- Particles toggle, density
- Film grain toggle, intensity
- Vignette toggle, intensity

**UI**
- HUD opacity (drives a `--hud-opacity` CSS variable used by every floating panel)
- Accent colour (drives `--accent`, used for active tabs, slider thumbs, focused buttons)

### Import / export / persistence

- **Export JSON** — downloads the current theme as `pianoroll-theme.json`
- **Import JSON** — load any saved theme from disk
- **localStorage persistence** — the current theme is auto-saved (debounced 250 ms so dragging a slider doesn't thrash disk)
- **Forward-compatible** — saved themes and imported presets are *deep-merged* with `DEFAULT_THEME`, so adding new fields in future versions won't break existing saves

---

## Settings UI

A left-side panel that's open on boot and toggleable mid-playback via the transport's ⚙ button.

- **Tabbed layout**: Load / Theme / Notes / Piano / Effects
- **Sliders** show their live numeric value to the right of the label
- **Toggles** are custom-built (no native checkboxes) for consistent dark UI
- **Conditional visibility**:
  - Base-colour control only shows when gradient is OFF
  - Gradient stops only show when gradient is ON
  - Corner-radius slider only shows for `rounded` shape (hidden for rectangle and capsule)
- **Drop overlay** is integrated — the Load tab contains both the MIDI and audio drop zones
- Live preview: the canvas behind the panel keeps rendering the demo while you tweak

The panel itself uses the `--hud-opacity` variable, so setting HUD opacity also affects the panel's own background.

---

## Tech stack

| Concern | Choice |
|---|---|
| Renderer | **Three.js** WebGL via `WebGLRenderer` + `EffectComposer` |
| Camera | `OrthographicCamera` (2D-style; depth ordering used for layering) |
| MIDI parsing | `@tonejs/midi` |
| Audio playback | Web Audio `AudioContext` + `AudioBufferSourceNode` (no synth) |
| UI | Vanilla HTML + CSS (no framework) |
| Build | **Vite** + **TypeScript** |
| Persistence | `localStorage` (theme JSON only) |

**No backend.** Everything runs in the browser; MIDI/audio files never leave the machine.

---

## File layout

```
src/
├── main.ts                # bootstrap
├── App.ts                 # top-level controller + render loop
├── midi/
│   ├── MidiLoader.ts      # @tonejs/midi → MidiData
│   └── MidiClock.ts       # playback position, BPM, seek
├── audio/
│   └── AudioSync.ts       # AudioContext wrapper
├── scene/
│   ├── SceneManager.ts    # renderer, composer, background, post-FX
│   ├── Piano.ts           # 88-key keyboard mesh, hit line, beams
│   ├── NoteRain.ts        # per-track InstancedMesh + custom shader
│   └── Particles.ts       # additive point particles
├── theme/
│   ├── types.ts           # Theme interface
│   ├── presets.ts         # built-in presets
│   └── ThemeManager.ts    # apply / save / load / merge
├── ui/
│   ├── FileLoader.ts      # drag-drop + file picker wiring
│   ├── Transport.ts       # play/pause/seek HUD
│   ├── TrackList.ts       # per-track sidebar
│   └── SettingsPanel.ts   # tabbed settings UI
└── demo/
    └── DemoData.ts        # short looping demo MIDI for boot preview
```
