import * as THREE from 'three';
import { SceneManager } from './scene/SceneManager';
import { Piano } from './scene/Piano';
import { NoteRain } from './scene/NoteRain';
import { Particles } from './scene/Particles';
import { BeatMarkers } from './scene/BeatMarkers';
import { OrbitCamera } from './scene/OrbitCamera';
import { CompositionView } from './scene/views/CompositionView';
import { MidiClock } from './midi/MidiClock';
import { AudioSync } from './audio/AudioSync';
import { Synth } from './audio/Synth';
import { Scheduler } from './audio/Scheduler';
import { ThemeManager } from './theme/ThemeManager';
import { FileLoader, type LoadedMidi } from './ui/FileLoader';
import { Transport } from './ui/Transport';
import { TrackList } from './ui/TrackList';
import { SettingsPanel, type LibraryController } from './ui/SettingsPanel';
import { TimelineEditor } from './ui/TimelineEditor';
import { VideoExporter } from './export/VideoExporter';
import { ExportDialog } from './ui/ExportDialog';
import type { MidiData } from './midi/MidiLoader';
import type { ViewMode, InstrumentId } from './theme/types';
import { ProjectLibrary } from './storage/ProjectLibrary';
import { createDemoData } from './demo/DemoData';
import { trackOpacityAt, cameraStateAt } from './timeline/Keyframes';

const COMP_PPS = 80; // must match CompositionView's PPS

export class App {
  private sm: SceneManager;
  private piano: Piano;
  private rain: NoteRain;
  private particles: Particles;
  private beatMarkers: BeatMarkers;
  private compView: CompositionView;
  private orbitCam: OrbitCamera;
  private clock: MidiClock;
  private audio: AudioSync;
  private synth: Synth;
  private scheduler: Scheduler;
  private synthActive = false;
  /** Per-track opacity multiplier from the timeline (recomputed each frame). */
  private trackOpacity: number[] = [];
  /** When true, the main rAF loop yields entirely — the exporter drives frames. */
  private isExporting = false;
  private tm: ThemeManager;
  private transport!: Transport;
  private trackList!: TrackList;
  private settings!: SettingsPanel;
  private timelineEditor!: TimelineEditor;
  private midiData: MidiData | null = null;
  private currentProjectId: string | null = null;
  private library = new ProjectLibrary();
  private fileLoader!: FileLoader;
  private isDemo = false;
  private viewMode: ViewMode = 'performance';
  private prevTime = performance.now();
  private pressColor = new THREE.Color();

  constructor(container: HTMLElement) {
    this.tm = new ThemeManager();
    this.sm = new SceneManager(container);
    this.piano = new Piano(this.sm.scene);
    this.rain = new NoteRain(this.sm.scene);
    this.particles = new Particles(this.sm.scene);
    this.beatMarkers = new BeatMarkers(this.sm.scene);
    this.compView = new CompositionView(this.sm.scene);
    this.orbitCam = new OrbitCamera(this.sm.width / this.sm.height);
    this.clock = new MidiClock();
    this.audio = new AudioSync();
    this.synth = new Synth();
    this.scheduler = new Scheduler(this.synth, this.clock);

    this.sm.applyTheme(this.tm.current);
    this.particles.applyTheme(this.tm.current);

    this.transport = new Transport(this.clock, this.audio);
    this.transport.onPlay(() => {
      // Resume AudioContext on user gesture (required by browsers).
      if (this.synthActive) void this.synth.resumeContext();
    });
    this.settings = new SettingsPanel(this.tm);

    const opacityEl = document.getElementById('tl-opacity-rows') as HTMLDivElement;
    const cameraEl = document.getElementById('tl-camera-row') as HTMLDivElement;
    this.timelineEditor = new TimelineEditor(opacityEl, cameraEl, this.tm);

    document.getElementById('tl-clear-btn')?.addEventListener('click', () => this.timelineEditor.clearOpacity());
    document.getElementById('tl-cam-clear')?.addEventListener('click', () => this.timelineEditor.clearCamera());
    document.getElementById('tl-cam-save')?.addEventListener('click', () => {
      const snap = this.orbitCam.snapshot();
      this.timelineEditor.saveCameraKeyframe(this.clock.currentTime, snap);
    });
    const autoCamCheckbox = document.getElementById('tl-auto-camera') as HTMLInputElement | null;
    if (autoCamCheckbox) {
      autoCamCheckbox.checked = this.tm.current.timeline.autoCamera;
      autoCamCheckbox.addEventListener('change', () => {
        this.tm.apply({ timeline: { ...this.tm.current.timeline, autoCamera: autoCamCheckbox.checked } });
      });
    }

    this.tm.onChange(theme => {
      this.sm.applyTheme(theme);
      this.rain.applyTheme(theme);
      this.particles.applyTheme(theme);
      this.piano.applyTheme(theme);
      this.beatMarkers.applyTheme(theme);
      this.compView.applyTheme(theme);
      if (theme.view.mode !== this.viewMode) this._setViewMode(theme.view.mode);
      // sm.applyTheme may re-create the starfield (Points object); re-hide it
      // along with the gradient bg whenever we're in composition view.
      if (this.viewMode === 'composition') this.sm.setBackgroundVisible(false);
      this._applyCompCameraPreset();
    });

    this.clock.onTick = (t) => { if (!this.isDemo) this.transport.update(t); };
    this.clock.onEnd = () => {
      if (this.isDemo) { this.clock.seekTo(0); this.clock.play(); }
      else this.audio.stop();
    };

    this.fileLoader = new FileLoader(this.audio, (loaded) => this._startReal(loaded), this.settings);
    this.settings.setLibraryController(this._buildLibraryController());

    window.addEventListener('resize', () => {
      this.orbitCam.setAspect(this.sm.width / this.sm.height);
      if (this.midiData) this._buildScene(this.midiData);
    });

    // Auto-hide transport: shows only while cursor is in the bottom strip
    // (or for ~3s after a real MIDI loads — so the user knows it's there).
    this._wireTransportAutoHide();

    // V toggles the view mode
    const toggleView = () => {
      const next: ViewMode = this.viewMode === 'performance' ? 'composition' : 'performance';
      this.tm.apply({ view: { ...this.tm.current.view, mode: next } });
    };
    document.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.code === 'KeyV') { e.preventDefault(); toggleView(); }
    });
    document.getElementById('view-mode-btn')?.addEventListener('click', toggleView);
    document.getElementById('export-btn')?.addEventListener('click', () => this.runExport());

    this._startDemo();
    this._loop();
  }

  private _startDemo() {
    this.isDemo = true;
    const demo = createDemoData();
    this.midiData = demo;
    this.clock.duration = demo.duration;
    this._buildScene(demo);
    this.clock.seekTo(0);
    this.clock.play();
  }

  private _startReal(loaded: LoadedMidi, opts: { preserveTimeline?: boolean } = {}) {
    const midi = loaded.data;
    this.currentProjectId = null;
    this.isDemo = false;
    this.midiData = midi;
    this.clock.duration = midi.duration;
    this.clock.pause();
    this.clock.seekTo(0);
    // Keyframes are tied to track indices + time. Clear when transitioning from
    // demo or an unrelated file, but keep them when loading a saved project
    // (where the keyframes were authored against this exact MIDI).
    const hasKeyframes = this.tm.current.timeline.trackOpacityKeyframes.length > 0
      || this.tm.current.timeline.cameraKeyframes.length > 0;
    if (hasKeyframes && !opts.preserveTimeline) {
      this.tm.apply({ timeline: { ...this.tm.current.timeline, trackOpacityKeyframes: [], cameraKeyframes: [] } });
    }
    this.trackOpacity = new Array(midi.tracks.length).fill(1);
    this._buildScene(midi);
    if (this.audio.loaded) this.clock.setAudioGetter(this.audio.getCurrentTimeGetter());
    else this.clock.setAudioGetter(null);

    // No audio file → drive sound from the built-in synth.
    this.synthActive = !this.audio.loaded;
    if (this.synthActive) {
      this.scheduler.load(midi);
      // Resolve per-track instruments (default piano for any not set).
      const instruments = this._resolveInstruments(midi.tracks.length);
      this.scheduler.setTrackInstruments(instruments);
      // Pre-load every instrument actually used by this MIDI.
      const used = Array.from(new Set(instruments)) as InstrumentId[];
      this.synth.loadInstruments(used).catch(() => { /* fall back to silence */ });
    } else {
      this.scheduler.unload();
    }

    this.trackList = new TrackList(
      this.rain,
      this.tm,
      (i, visible) => { if (this.synthActive) this.synth.setTrackMuted(i, !visible); },
      (i, instrument) => {
        if (!this.synthActive) return;
        // Apply the latest instrument list to the scheduler and pre-load the new one.
        this.scheduler.setTrackInstruments(this._resolveInstruments(this.midiData?.tracks.length ?? 0));
        void this.synth.ensureLoaded(instrument);
      },
    );
    this.trackList.build(midi.tracks);
    this.transport.show();
    document.body.classList.add('midi-loaded');
    // Reveal the transport for ~3s so the user knows it's there, then auto-hide.
    this._showTransport();
    this._scheduleHideTransport(3000);
  }

  private _buildScene(midi: MidiData) {
    const theme = this.tm.current;
    const w = this.sm.width, h = this.sm.height;
    this.piano.build(w, h, theme);
    this.rain.build(
      midi.tracks, w, h, this.piano.pianoTop, theme,
      (m) => this.piano.getKeyX(m),
      this.piano.keyWidth,
    );
    this.particles.applyTheme(theme);
    // Ambient drifters fill the area above the piano keyboard.
    this.particles.setAmbientRegion(0, this.piano.pianoTop, w, h - this.piano.pianoTop);
    // Sync beatsPerBar from the MIDI's time signature so bars line up by default.
    const sigNum = midi.timeSignature[0];
    if (sigNum !== theme.markers.beatsPerBar) {
      this.tm.apply({ markers: { ...theme.markers, beatsPerBar: sigNum } });
    }
    this.beatMarkers.configure(midi.bpm, midi.duration, w, h, this.piano.pianoTop);
    this.beatMarkers.applyTheme(this.tm.current);
    this.compView.build(midi.tracks, theme, midi.duration);
    this.compView.applyTheme(theme);
    this.timelineEditor.setTracks(midi.tracks, midi.duration);
    // Apply current view mode (in case it was 'composition' on boot via stored theme)
    this._setViewMode(theme.view.mode);
  }

  private _setViewMode(mode: ViewMode) {
    this.viewMode = mode;
    const isPerformance = mode === 'performance';
    this.piano.group.visible = isPerformance;
    this.rain.setAllMeshesVisible(isPerformance);
    this.beatMarkers.setVisible(isPerformance);
    this.particles.setVisible(isPerformance);
    this.compView.setVisible(!isPerformance);
    // Starfield + background plane are positioned in 2D screen-space and look
    // out of place from 3D orbit angles; hide them in composition view.
    this.sm.setBackgroundVisible(isPerformance);

    const btn = document.getElementById('view-mode-btn');
    if (btn) {
      btn.textContent = isPerformance ? 'PERF' : 'COMP';
      btn.classList.toggle('composition', !isPerformance);
    }

    this.settings.setViewMode(mode);

    if (isPerformance) {
      this.orbitCam.detachControls();
      this.sm.useThemeCamera();
    } else {
      this.orbitCam.setAspect(this.sm.width / this.sm.height);
      this.orbitCam.setLookAtTarget(this.compView.centerX, 0, 0);
      this._applyCompCameraPreset(true); // snap on activation
      this.orbitCam.attachControls(this.sm.renderer.domElement);
      this.sm.useCamera(this.orbitCam.camera);
    }
  }

  /** Set the orbit camera target according to theme.view.composition.cameraPreset. */
  private _applyCompCameraPreset(snap = false) {
    if (this.viewMode !== 'composition') return;
    const preset = this.tm.current.view.composition.cameraPreset;
    const spanX = this.compView.spanX;
    const spanZ = Math.max(this.compView.spanZ, 80);
    let theta = 0.15, phi = 1.35, radius = Math.max(spanX * 0.45, 500);
    switch (preset) {
      case 'front':
        theta = 0; phi = Math.PI / 2; radius = Math.max(spanX * 0.6, 600);
        break;
      case 'side':
        theta = Math.PI / 2; phi = Math.PI / 2; radius = Math.max(spanZ * 4, 500);
        break;
      case 'top':
        theta = 0; phi = 0.05; radius = Math.max(spanX * 0.55, 600);
        break;
      case 'tilt':
      default:
        theta = 0.15; phi = 1.35; radius = Math.max(spanX * 0.45, 500);
    }
    this.orbitCam.setTarget(theta, phi, radius);
    if (snap) this.orbitCam.snap();
  }

  // Auto-drift state (recomputed every ~1s, lerped continuously)
  private _driftClock = 0;
  private _driftTargetRadius = 800;
  private _driftTargetTheta = 0.15;

  /** Subtle radius + theta drift based on local note density. Called per frame. */
  private _autoCameraDrift(currentTime: number, dt: number) {
    if (!this.midiData) return;
    this._driftClock += dt;
    if (this._driftClock > 0.8) {
      this._driftClock = 0;
      // Note density in a ±1.5s window
      const w = 1.5;
      let totalNotes = 0;
      const trackActivity = new Array(this.midiData.tracks.length).fill(0);
      this.midiData.tracks.forEach((track, i) => {
        for (const n of track.notes) {
          if (n.time >= currentTime - w && n.time <= currentTime + w) {
            totalNotes++;
            trackActivity[i]++;
          }
        }
      });
      let mostActive = 0, max = 0;
      for (let i = 0; i < trackActivity.length; i++) {
        if (trackActivity[i] > max) { max = trackActivity[i]; mostActive = i; }
      }
      const baseRadius = Math.max(this.compView.spanX * 0.45, 500);
      const density = Math.min(totalNotes / 30, 1);
      this._driftTargetRadius = baseRadius * (1 + density * 0.2); // up to +20% during dense passages
      const layerOffset = mostActive - (this.midiData.tracks.length - 1) / 2;
      this._driftTargetTheta = 0.15 + layerOffset * 0.05;
    }
    const k = Math.min(dt * 0.5, 1);
    this.orbitCam.target.radius += (this._driftTargetRadius - this.orbitCam.target.radius) * k;
    this.orbitCam.target.theta += (this._driftTargetTheta - this.orbitCam.target.theta) * k;
  }

  private _transportHideTimer: number | null = null;

  /** Show the transport bar; cancel any pending hide. */
  private _showTransport() {
    document.getElementById('transport')?.classList.add('hover');
    if (this._transportHideTimer !== null) {
      clearTimeout(this._transportHideTimer);
      this._transportHideTimer = null;
    }
  }

  /** Schedule hiding the transport bar; called when cursor leaves bottom zone. */
  private _scheduleHideTransport(delay = 1200) {
    if (this._transportHideTimer !== null) return;
    this._transportHideTimer = window.setTimeout(() => {
      document.getElementById('transport')?.classList.remove('hover');
      this._transportHideTimer = null;
    }, delay);
  }

  private _wireTransportAutoHide() {
    const PEEK_PX = 130;
    document.addEventListener('mousemove', (e) => {
      const nearBottom = e.clientY > window.innerHeight - PEEK_PX;
      if (nearBottom) this._showTransport();
      else this._scheduleHideTransport();
    });
    // Also re-show briefly on any key press so transport controls react to space/arrows.
    document.addEventListener('keydown', () => {
      this._showTransport();
      this._scheduleHideTransport(2000);
    });
  }

  private _pressedLastFrame = new Set<number>();

  private _loop = () => {
    requestAnimationFrame(this._loop);
    if (this.isExporting) { this.prevTime = performance.now(); return; }
    if (!document.hasFocus()) { this.prevTime = performance.now(); return; }
    const now = performance.now();
    const dt = Math.min((now - this.prevTime) / 1000, 0.05);
    this.prevTime = now;

    if (!this.midiData) { this.sm.render(now / 1000); return; }

    const currentTime = this.clock.currentTime;
    const theme = this.tm.current;

    // Compute per-track opacity from the timeline keyframes (default 1 each)
    // and push to whichever view is active.
    const kfs = theme.timeline.trackOpacityKeyframes;
    const trackCount = this.midiData.tracks.length;
    for (let i = 0; i < trackCount; i++) {
      const op = kfs.length > 0 ? trackOpacityAt(kfs, i, currentTime) : 1;
      if (this.trackOpacity[i] !== op) {
        this.trackOpacity[i] = op;
        this.rain.setTrackOpacityMultiplier(i, op);
        this.compView.setTrackOpacityMultiplier(i, op);
      }
    }

    if (this.viewMode === 'performance') {
      this.rain.update(currentTime);
      const active = this.rain.activeNotes;

      active.forEach((trackIdx, midi) => {
        const src = theme.piano.pressColorSource === 'track'
          ? this.rain.getNoteColor(midi, trackIdx, this.pressColor)
          : this.pressColor.set(theme.piano.pressCustomColor);
        const op = this.trackOpacity[trackIdx] ?? 1;
        if (op < 1) src.multiplyScalar(op);
        if (op > 0.02 && !this._pressedLastFrame.has(midi)) {
          this.piano.pressKey(midi, src, theme);
          if (theme.effects.particles) {
            this.particles.emit(this.piano.getKeyX(midi), this.piano.pianoTop, src, this.rain.activeVelocity.get(midi) ?? 0.8);
          }
        }
      });
      this._pressedLastFrame.forEach(midi => {
        if (!active.has(midi)) this.piano.releaseKey(midi);
      });
      this._pressedLastFrame.clear();
      active.forEach((_, midi) => this._pressedLastFrame.add(midi));

      this.piano.update(dt, active.size);
      this.beatMarkers.update(currentTime);
      this.sm.update(dt); // perspective camera lerp
    } else {
      // Composition view
      this.compView.update(currentTime, this.clock.playing);

      const camKfs = theme.timeline.cameraKeyframes;
      const autoCam = theme.timeline.autoCamera;
      // Only drive automation when the user hasn't been orbiting (or cooldown lapsed).
      if (this.clock.playing && !this.orbitCam.inCooldown) {
        if (camKfs.length > 0) {
          // Keyframes mode: full state takes over, including lookAt.
          const s = cameraStateAt(camKfs, currentTime);
          if (s) {
            this.orbitCam.setTarget(s.theta, s.phi, s.radius);
            this.orbitCam.setLookAtTarget(s.lookAt[0], s.lookAt[1], s.lookAt[2]);
          }
        } else {
          // No keyframes — follow the cursor along X; optional subtle auto-drift on radius+theta.
          this.orbitCam.lookAtTarget.x = currentTime * COMP_PPS;
          if (autoCam) this._autoCameraDrift(currentTime, dt);
        }
      }
      this.orbitCam.update();
    }

    this.particles.update(dt, this.sm.renderer);
    this.sm.updateStars(dt, this.clock.playing);
    this.sm.media.syncToTime(currentTime, this.clock.playing && this.viewMode === 'performance');
    if (this.synthActive) this.scheduler.tick();
    this.timelineEditor.updatePlayhead(currentTime);
    this.sm.render(now / 1000);
  };

  // ─────────────────────────────────────────────
  //  Video export
  // ─────────────────────────────────────────────

  /** Deterministic single-frame render at `time` (seconds). No lerp / no rAF. */
  private _renderFrameForExport(time: number, dt: number) {
    if (!this.midiData) return;
    this.clock.seekTo(time);
    const theme = this.tm.current;

    // Per-track opacity (same logic as the main loop)
    const kfs = theme.timeline.trackOpacityKeyframes;
    const trackCount = this.midiData.tracks.length;
    for (let i = 0; i < trackCount; i++) {
      const op = kfs.length > 0 ? trackOpacityAt(kfs, i, time) : 1;
      this.trackOpacity[i] = op;
      this.rain.setTrackOpacityMultiplier(i, op);
      this.compView.setTrackOpacityMultiplier(i, op);
    }

    if (this.viewMode === 'performance') {
      this.rain.update(time);
      const active = this.rain.activeNotes;
      active.forEach((trackIdx, midi) => {
        const src = theme.piano.pressColorSource === 'track'
          ? this.rain.getNoteColor(midi, trackIdx, this.pressColor)
          : this.pressColor.set(theme.piano.pressCustomColor);
        const op = this.trackOpacity[trackIdx] ?? 1;
        if (op < 1) src.multiplyScalar(op);
        if (op > 0.02 && !this._pressedLastFrame.has(midi)) {
          this.piano.pressKey(midi, src, theme);
          if (theme.effects.particles) {
            this.particles.emit(this.piano.getKeyX(midi), this.piano.pianoTop, src, this.rain.activeVelocity.get(midi) ?? 0.8);
          }
        }
      });
      this._pressedLastFrame.forEach(midi => {
        if (!active.has(midi)) this.piano.releaseKey(midi);
      });
      this._pressedLastFrame.clear();
      active.forEach((_, midi) => this._pressedLastFrame.add(midi));
      this.piano.update(dt, active.size);
      this.sm.update(dt);
    } else {
      this.compView.update(time, true);
      const camKfs = theme.timeline.cameraKeyframes;
      if (camKfs.length > 0) {
        const s = cameraStateAt(camKfs, time);
        if (s) {
          this.orbitCam.setTarget(s.theta, s.phi, s.radius);
          this.orbitCam.setLookAtTarget(s.lookAt[0], s.lookAt[1], s.lookAt[2]);
        }
      } else {
        this.orbitCam.lookAtTarget.x = time * COMP_PPS;
      }
      this.orbitCam.snap(); // deterministic — no per-frame lerp during export
    }

    this.particles.update(dt, this.sm.renderer);
    this.sm.updateStars(dt, true);
    this.sm.render(time);
  }

  /** Open the export dialog and run a video export (with audio). */
  async runExport() {
    if (!this.midiData) return;
    if (!VideoExporter.isSupported()) {
      alert('Video export requires WebCodecs (Chrome/Edge 94+, Safari 17+, Firefox recent).');
      return;
    }
    const dialog = new ExportDialog();
    const audioLabel = this.audio.loaded
      ? 'Loaded audio file'
      : 'Built-in synth (offline render)';
    dialog.open(this.midiData.duration, async ({ width, height, fps }, onProgress, isCancelled) => {
      const wasPlaying = this.clock.playing;
      this.clock.pause();
      this.audio.stop();
      this.isExporting = true;
      this.sm.setExportSize(width, height);

      // Resolve audio: prefer the user-loaded file; otherwise render the synth
      // offline through an OfflineAudioContext. Either way → AAC 320kbps in MP4.
      onProgress(0);
      const audioBuf = await this._resolveExportAudio();

      this._renderFrameForExport(0, 1 / fps);

      const exporter = new VideoExporter(this.sm.canvas, (t) => this._renderFrameForExport(t, 1 / fps));
      try {
        const blob = await exporter.export({
          width, height, fps,
          duration: this.midiData!.duration,
          audio: audioBuf,
          onProgress: (i, total) => onProgress(i / total),
          onCancel: isCancelled,
        });
        return blob;
      } finally {
        this.sm.restoreSize();
        this.isExporting = false;
        this.clock.seekTo(0);
        if (wasPlaying) this.clock.play();
      }
    }, { label: audioLabel });
  }

  /** Resolve the per-track instrument id list, defaulting to 'piano' for any unset index. */
  private _resolveInstruments(trackCount: number): InstrumentId[] {
    const stored = this.tm.current.tracks.instruments;
    const out: InstrumentId[] = new Array(trackCount);
    for (let i = 0; i < trackCount; i++) out[i] = stored[i] ?? 'piano';
    return out;
  }

  /** Either the user-loaded AudioBuffer, or a fresh offline-rendered synth pass. */
  private async _resolveExportAudio(): Promise<AudioBuffer | undefined> {
    if (!this.midiData) return undefined;
    if (this.audio.loaded && this.audio.buffer) return this.audio.buffer;
    return this._renderSynthOffline(this.midiData);
  }

  /** Render the MIDI through OfflineAudioContext for sample-accurate, deterministic audio. */
  private async _renderSynthOffline(midi: import('./midi/MidiLoader').MidiData): Promise<AudioBuffer | undefined> {
    try {
      const sampleRate = 48000;
      const length = Math.ceil(midi.duration * sampleRate);
      const ctx = new OfflineAudioContext(2, length, sampleRate);
      const mod = (await import('soundfont-player')) as unknown as {
        default: { instrument: (c: BaseAudioContext, n: string) => Promise<{ play: (m: number, w: number, o: { gain?: number; duration?: number }) => unknown }> };
      };
      const sf = mod.default ?? (mod as unknown as { instrument: (c: BaseAudioContext, n: string) => Promise<{ play: (m: number, w: number, o: { gain?: number; duration?: number }) => unknown }> });

      // Per-track instruments: load each unique soundfont-backed one once.
      const SF_NAME: Record<Exclude<InstrumentId, 'drum'>, string> = {
        piano: 'acoustic_grand_piano',
        strings: 'string_ensemble_1',
        brass: 'brass_section',
        woodwinds: 'clarinet',
        synthPad: 'pad_2_warm',
        synthLead: 'lead_1_square',
      };
      const instruments = this._resolveInstruments(midi.tracks.length);
      const uniqueIds = Array.from(new Set(instruments)).filter(id => id !== 'drum') as Array<Exclude<InstrumentId, 'drum'>>;
      const loaded = new Map<Exclude<InstrumentId, 'drum'>, { play: (m: number, w: number, o: { gain?: number; duration?: number }) => unknown }>();
      await Promise.all(uniqueIds.map(async id => {
        const inst = await sf.instrument(ctx, SF_NAME[id]);
        loaded.set(id, inst);
      }));

      const muted = this.synth.muted;
      midi.tracks.forEach((track, trackIdx) => {
        if (muted.has(trackIdx)) return;
        const id = instruments[trackIdx];
        if (id === 'drum') {
          // Synth drum: short noise burst, scheduled directly on the offline ctx.
          for (const n of track.notes) {
            const len = Math.floor(ctx.sampleRate * 0.28);
            const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
            const data = buffer.getChannelData(0);
            for (let i = 0; i < len; i++) {
              const t = i / ctx.sampleRate;
              const env = Math.exp(-t * 16);
              const noise = Math.random() * 2 - 1;
              const tone = Math.sin(2 * Math.PI * 110 * t) * 0.6;
              data[i] = (noise * 0.7 + tone) * env * (n.velocity ?? 0.8) * 0.8;
            }
            const src = ctx.createBufferSource();
            src.buffer = buffer;
            src.connect(ctx.destination);
            src.start(n.time);
          }
        } else {
          const instr = loaded.get(id);
          if (!instr) return;
          for (const n of track.notes) {
            instr.play(n.midi, n.time, { gain: n.velocity * 0.8, duration: n.duration });
          }
        }
      });

      return await ctx.startRendering();
    } catch (err) {
      console.warn('[Export] synth offline render failed', err);
      return undefined;
    }
  }

  // ─────────────────────────────────────────────
  //  Library (IndexedDB projects + themes)
  // ─────────────────────────────────────────────

  private _buildLibraryController(): LibraryController {
    return {
      refresh: () => this._listLibrary(),
      saveProject: (name) => this._saveCurrentProject(name),
      loadProject: (id) => this._loadProject(id),
      deleteProject: (id) => this._deleteProject(id),
      saveTheme: (name) => this._saveCurrentTheme(name),
      applyTheme: (theme) => this.tm.applyPreset(theme),
      deleteTheme: (id) => this._deleteTheme(id),
      canSaveProject: () => this.fileLoader.current !== null && !this.isDemo,
    };
  }

  private async _listLibrary() {
    const [projects, themes] = await Promise.all([
      this.library.listProjects(),
      this.library.listThemes(),
    ]);
    return { projects, themes };
  }

  private async _saveCurrentProject(name: string) {
    const current = this.fileLoader.current;
    if (!current || !this.midiData) return;
    const id = await this.library.saveProject({
      name: name.trim() || current.fileName || 'Untitled project',
      duration: this.midiData.duration,
      trackCount: this.midiData.tracks.length,
      midi: current.bytes,
      audio: this.audio.bytes,
      audioMime: this.audio.mime,
      audioFileName: this.audio.fileName,
      theme: this.tm.snapshotForPersist(),
      existingId: this.currentProjectId ?? undefined,
    });
    this.currentProjectId = id;
  }

  private async _loadProject(id: string) {
    try {
      const saved = await this.library.getProject(id);
      if (!saved) return;
      // Project snapshots include the full theme (incl. view) — full replace,
      // unlike a saved-theme apply which preserves the user's current view.
      this.tm.apply(saved.theme);
      if (saved.audio && saved.audioMime && saved.audioFileName) {
        await this.fileLoader.ingestAudioBytes(saved.audio, saved.audioMime, saved.audioFileName);
      } else {
        this.fileLoader.clearAudio();
      }
      await this.fileLoader.ingestMidiBytes(saved.midi, `${saved.name}.mid`);
      const current = this.fileLoader.current;
      if (!current) return;
      this._startReal(current, { preserveTimeline: true });
      this.currentProjectId = saved.id;
      this.settings.close();
    } catch (err) {
      console.warn('[Library] failed to load project', err);
      alert('Could not load that project — see console for details.');
    }
  }

  private async _deleteProject(id: string) {
    await this.library.deleteProject(id);
    if (this.currentProjectId === id) this.currentProjectId = null;
  }

  private async _saveCurrentTheme(name: string) {
    const cleaned = name.trim() || 'Untitled theme';
    await this.library.saveTheme(cleaned, this.tm.snapshotForPersist());
  }

  private async _deleteTheme(id: string) {
    await this.library.deleteTheme(id);
  }
}
