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

Open `http://localhost:5173`, or use the hosted copy at [worldwiderad.github.io/pianoroll](https://worldwiderad.github.io/pianoroll/). A short demo plays behind a start card. Choose or drop a MIDI file, optionally add a recording, and press **Play**. **Change the look** opens the settings panel at any point.

---

## File support

| Type | Formats | Notes |
|---|---|---|
| **MIDI** | `.mid`, `.midi` | Multi-track supported; tracks parsed via `@tonejs/midi`. Each track renders as its own coloured stream of notes. |
| **Audio** | `.mp3`, `.wav`, `.ogg` (anything `decodeAudioData` supports) | Optional. Plays synchronised to MIDI position via `AudioContext.currentTime`. Without one, the piece plays on a built-in SoundFont piano (or another instrument per track). |

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

- **Range**: *Fit to the piece* frames the keyboard from just below the lowest note to just above the highest (never fewer keys than the screen comfortably holds), or *All 88 keys*, A0 (MIDI 21) to C8 (MIDI 108)
- Keys are drawn like a real piano rather than as flat blocks: ivory keys with rounded edges, a lit front lip and a shadow where they run under the fallboard; black keys with bevelled sides, a glossy top and a sloped front; soft shadows from the black keys onto the white ones; gaps between keys; and a felt strip along the back in a colour you choose
- Black keys sit off-centre the way they do on a real keyboard (C♯ and F♯ to the left of the gap, D♯ and A♯ to the right)
- The keyboard's height follows the key width, about six and a half widths per key, within limits of the screen height
- Three **finishes**, switched live: *Ivory and ebony*; *Dark, lit by notes* (dark keys that light up in the note's colour); and *Frosted glass* (milky white keys and smoked black keys that show the blurred background through them, keeping the same lip, bevels and shadows)
- **Depth press**: pressed keys go down quickly and come back a little slower, like a real action
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
| **Concert** *(default)* | Ivory and ebony | Warm dark stage, red felt, amber and blue notes, a light bloom and a few sparks |
| **Neon** | Ivory and ebony | Saturated notes with trails over near-black with stars, strong bloom on the notes only |
| **Glass** | Frosted glass | Frosted glass notes and keys over a moving aurora, frosted panels |
| **Studio** | Ivory and ebony | Flat graphite, bright distinct track colours, a beat and bar grid, no glow or particles |
| **Paper** | Ivory and ebony | Ink on paper: a light background, ink-blue and black notes, no effects |
| **Midnight** | Ivory and ebony | Deep blue gradient, cool pastel notes, soft bloom, drifting dust |
| **Sunset** | Ivory and ebony | Plum-to-red gradient, warm capsule notes, film grain |

The bloom threshold in every preset sits above the brightest part of an ivory key, so only the notes, beams and particles glow.

### Customisable properties

Every preset value is also exposed as a live setting:

**Background**
- Base colour (used when gradient is off)
- Gradient toggle + 3 stop colours
- Starfield toggle
- Scanlines toggle
- Aurora toggle + 4 colours: soft glows that drift slowly behind everything

**Glass**
- Frost: how strongly glass notes and keys blur what is behind them. Glass works by drawing the background (gradient, aurora, stars, media) on its own at a quarter of the resolution each frame, blurring it, and letting glass materials sample it at their own screen position. The pass only runs while something made of glass is on screen.
- Frosted panels: light, frosted interface panels instead of dark ones

**Notes**
- Shape: rectangle / rounded / capsule
- Corner radius (only meaningful for rounded)
- Edge highlight: a lit leading edge and a thin bright rim on each note
- Glass (0 to 1): frosted glass notes that show the blurred background through them, bend it slightly at the rim, catch light along the top and left edges, and glow from inside as they reach the keys
- Opacity
- Glow intensity (drives proximity brightness multiplier)
- Trail length and opacity
- Per-track colours (8 slots, also editable via the Tracks panel)

**Piano**
- Range: fit to the piece / all 88 keys
- Finish: ivory and ebony / dark, lit by notes / frosted glass (auto-swaps default key colours on change)
- White key colour
- Black key colour
- Felt colour
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

A floating panel on the right (a bottom sheet on phones), opened from the start card's **Change the look** or the transport's settings button.

- **Tabs**: Music / Library / Look / Notes / Keys / 3D / Timeline / Effects, each with an icon
- **Presets** are shown as small pictures of each look
- **Sliders** show their live numeric value to the right of the label
- **Toggles** are custom-built (no native checkboxes) for consistent dark UI
- **Conditional visibility**:
  - Base-colour control only shows when gradient is OFF
  - Gradient stops only show when gradient is ON
  - Corner-radius slider only shows for `rounded` shape (hidden for rectangle and capsule)
- The Music tab has the MIDI and recording drop zones and a Play button; the start card does the same job before anything is loaded
- Live preview: the canvas behind the panel keeps rendering the demo while you tweak

The panel itself uses the `--hud-opacity` variable, so setting HUD opacity also affects the panel's own background.

---

## Tech stack

| Concern | Choice |
|---|---|
| Renderer | **Three.js** WebGL via `WebGLRenderer` + `EffectComposer` |
| Camera | `OrthographicCamera` (2D-style; depth ordering used for layering) |
| MIDI parsing | `@tonejs/midi` |
| Audio playback | Web Audio `AudioContext` + `AudioBufferSourceNode`; `soundfont-player` when there is no recording |
| UI | Vanilla HTML + CSS (no framework) |
| Build | **Vite** + **TypeScript** |
| Persistence | `localStorage` for the current theme, IndexedDB for the project and theme library |

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
│   ├── Piano.ts           # keyboard: key textures and shader, range fitting, felt, beams
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
│   ├── Welcome.ts         # start card
│   └── SettingsPanel.ts   # tabbed settings UI
└── demo/
    └── DemoData.ts        # short looping demo MIDI for boot preview
```
