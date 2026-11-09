# Piano Roll

A MIDI visualiser that runs in the browser: notes fall onto an 88-key keyboard in WebGL, with particles, glow and a theme system you can tune live. Drop in a MIDI file, and optionally a recording to play in sync, and export the result as an MP4.

Built with TypeScript, Three.js and Vite.

## Running it

```sh
npm install
npm run dev
```

Then open http://localhost:5173. A short demo plays on load. Drag a `.mid` file (and an `.mp3`, `.wav` or `.ogg` if you have one) onto the page and press **Start**.

## What it does

- **Falling notes** per track, each in its own colour, onto a keyboard that lights and presses with the music.
- **Effects:** press beams, hit-line ripples, impact bursts, particles, bloom and background media.
- **Sound:** your own audio file, kept in sync with the MIDI clock, or a SoundFont sampler when there isn't one. It has piano, strings, brass, woodwinds, synth pad, synth lead and drums.
- **Themes:** built-in presets, and nearly every colour, size and effect is adjustable. Themes import and export as JSON.
- **Timeline keyframes** for changing settings over the course of a piece.
- **Video export** to MP4 with WebCodecs, rendered frame by frame at the size you pick. This needs a browser with `VideoEncoder`, such as Chrome or Edge.
- **Project library** in IndexedDB, so loaded pieces and themes are still there next time.

[FEATURES.md](FEATURES.md) goes through every setting.

`3d-preview/3d-early-prototype.html` is the single-file prototype the app grew out of.
