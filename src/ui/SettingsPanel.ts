import type { ThemeManager } from '../theme/ThemeManager';
import type { Theme } from '../theme/types';
import type { SavedProject, SavedTheme } from '../storage/ProjectLibrary';

function el<T extends HTMLElement>(id: string) { return document.getElementById(id) as T; }

export interface LibraryController {
  refresh(): Promise<{ projects: SavedProject[]; themes: SavedTheme[] }>;
  saveProject(name: string): Promise<void>;
  loadProject(id: string): Promise<void>;
  deleteProject(id: string): Promise<void>;
  saveTheme(name: string): Promise<void>;
  applyTheme(theme: Theme): void;
  deleteTheme(id: string): Promise<void>;
  canSaveProject(): boolean;
}

export class SettingsPanel {
  private tm: ThemeManager;
  private panel = el<HTMLDivElement>('left-panel');
  private isOpen = false; // the welcome card is the first screen
  private libraryCtl: LibraryController | null = null;

  constructor(tm: ThemeManager) {
    this.tm = tm;
    this._buildPresets();
    this._buildTrackSwatches();
    this._buildPitchSwatches();
    this._wireTabs();
    this._wireControls();
    this._syncToTheme(tm.current);
    this._applyAccent(tm.current.ui.accentColor);

    el('panel-close-btn').addEventListener('click', () => this.close());
    el<HTMLButtonElement>('settings-btn').addEventListener('click', () => this.toggle());

    window.addEventListener('panel-open', (e) => {
      if ((e as CustomEvent).detail !== 'settings') { this.isOpen = false; this.panel.classList.remove('open'); }
    });
  }

  private _buildPitchSwatches() {
    const container = el<HTMLDivElement>('pitch-color-swatches');
    container.innerHTML = '';
    const labels = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
    this.tm.current.notes.pitchColors.forEach((color, i) => {
      const wrap = document.createElement('label');
      wrap.className = 'swatch';
      const input = document.createElement('input');
      input.type = 'color';
      input.value = color;
      input.title = `Pitch ${labels[i]}`;
      input.addEventListener('input', e => {
        const colors = [...this.tm.current.notes.pitchColors];
        colors[i] = (e.target as HTMLInputElement).value;
        this.tm.apply({ notes: { ...this.tm.current.notes, pitchColors: colors } });
      });
      const label = document.createElement('span');
      label.textContent = labels[i];
      wrap.append(input, label);
      container.appendChild(wrap);
    });
  }

  private _buildTrackSwatches() {
    const container = el<HTMLDivElement>('track-color-swatches');
    container.innerHTML = '';
    this.tm.current.trackColors.forEach((color, i) => {
      const input = document.createElement('input');
      input.type = 'color';
      input.value = color;
      input.title = `Track ${i + 1}`;
      input.addEventListener('input', e => {
        const colors = [...this.tm.current.trackColors];
        colors[i] = (e.target as HTMLInputElement).value;
        this.tm.apply({ trackColors: colors });
      });
      container.appendChild(input);
    });
  }

  toggle() { this.isOpen ? this.close() : this.open(); }
  open() {
    this.isOpen = true;
    this.panel.classList.add('open');
    // Both side panels live on the right — close the other one when opening this.
    window.dispatchEvent(new CustomEvent('panel-open', { detail: 'settings' }));
    document.body.classList.add('panel-open');
  }
  close() { this.isOpen = false; this.panel.classList.remove('open'); document.body.classList.remove('panel-open'); }

  /** Show/hide settings rows + tab buttons appropriate to the active view mode. */
  setViewMode(mode: 'performance' | 'composition') {
    document.querySelectorAll<HTMLElement>('[data-view]').forEach(el => {
      const dv = el.dataset.view;
      if (dv === 'both') return;
      el.style.display = (dv === mode) ? '' : 'none';
    });
    // If the currently-active tab is now hidden, fall back to Theme tab
    const activeTab = document.querySelector<HTMLElement>('.tab-btn.active');
    if (activeTab && activeTab.style.display === 'none') {
      this._activateTab('theme');
    }
  }

  /** Called after FileLoader fires — switch to Load tab if needed */
  showLoadTab() {
    this._activateTab('load');
    this.open();
  }

  setLibraryController(ctl: LibraryController) {
    this.libraryCtl = ctl;
    this._wireLibrary();
    void this._renderLibrary();
  }

  private _wireLibrary() {
    const saveProjectBtn = document.getElementById('lib-save-project') as HTMLButtonElement | null;
    const saveProjectName = document.getElementById('lib-project-name') as HTMLInputElement | null;
    const saveThemeBtn = document.getElementById('lib-save-theme') as HTMLButtonElement | null;
    const saveThemeName = document.getElementById('lib-theme-name') as HTMLInputElement | null;
    if (!saveProjectBtn || !saveThemeBtn) return;

    saveProjectBtn.addEventListener('click', async () => {
      if (!this.libraryCtl) return;
      if (!this.libraryCtl.canSaveProject()) {
        alert('Load a MIDI file first.');
        return;
      }
      try {
        await this.libraryCtl.saveProject(saveProjectName?.value ?? '');
        if (saveProjectName) saveProjectName.value = '';
        void this._renderLibrary();
      } catch (err) {
        console.warn('[Library] save project failed', err);
        alert('Could not save — see console for details.');
      }
    });

    saveThemeBtn.addEventListener('click', async () => {
      if (!this.libraryCtl) return;
      try {
        await this.libraryCtl.saveTheme(saveThemeName?.value ?? '');
        if (saveThemeName) saveThemeName.value = '';
        void this._renderLibrary();
      } catch (err) {
        console.warn('[Library] save theme failed', err);
        alert('Could not save — see console for details.');
      }
    });
  }

  private async _renderLibrary() {
    if (!this.libraryCtl) return;
    const projectsEl = document.getElementById('lib-project-list');
    const themesEl = document.getElementById('lib-theme-list');
    if (!projectsEl || !themesEl) return;
    const { projects, themes } = await this.libraryCtl.refresh();

    projectsEl.innerHTML = '';
    if (projects.length === 0) {
      projectsEl.innerHTML = '<div class="lib-empty">No saved projects yet.</div>';
    } else {
      for (const p of projects) projectsEl.appendChild(this._renderProjectRow(p));
    }

    themesEl.innerHTML = '';
    if (themes.length === 0) {
      themesEl.innerHTML = '<div class="lib-empty">No saved themes yet.</div>';
    } else {
      for (const t of themes) themesEl.appendChild(this._renderThemeRow(t));
    }
  }

  private _renderProjectRow(p: SavedProject): HTMLElement {
    const row = document.createElement('div');
    row.className = 'lib-row';
    const mins = Math.floor(p.duration / 60);
    const secs = Math.floor(p.duration % 60).toString().padStart(2, '0');
    const audioTag = p.audioFileName ? ' · audio' : '';
    row.innerHTML = `
      <div class="lib-row-main">
        <div class="lib-row-name"></div>
        <div class="lib-row-sub">${mins}:${secs} · ${p.trackCount} track${p.trackCount === 1 ? '' : 's'}${audioTag}</div>
      </div>
      <div class="lib-row-actions">
        <button class="s-action-btn lib-load">Load</button>
        <button class="s-action-btn lib-delete" title="Delete">✕</button>
      </div>`;
    (row.querySelector('.lib-row-name') as HTMLElement).textContent = p.name;
    row.querySelector('.lib-load')?.addEventListener('click', async () => {
      await this.libraryCtl?.loadProject(p.id);
    });
    row.querySelector('.lib-delete')?.addEventListener('click', async () => {
      if (!confirm(`Delete project "${p.name}"?`)) return;
      await this.libraryCtl?.deleteProject(p.id);
      void this._renderLibrary();
    });
    return row;
  }

  private _renderThemeRow(t: SavedTheme): HTMLElement {
    const row = document.createElement('div');
    row.className = 'lib-row';
    row.innerHTML = `
      <div class="lib-row-main">
        <div class="lib-row-name"></div>
      </div>
      <div class="lib-row-actions">
        <button class="s-action-btn lib-apply">Apply</button>
        <button class="s-action-btn lib-delete" title="Delete">✕</button>
      </div>`;
    (row.querySelector('.lib-row-name') as HTMLElement).textContent = t.name;
    row.querySelector('.lib-apply')?.addEventListener('click', () => {
      this.libraryCtl?.applyTheme(t.theme);
      this._syncToTheme(this.tm.current);
    });
    row.querySelector('.lib-delete')?.addEventListener('click', async () => {
      if (!confirm(`Delete theme "${t.name}"?`)) return;
      await this.libraryCtl?.deleteTheme(t.id);
      void this._renderLibrary();
    });
    return row;
  }

  private _buildPresets() {
    const grid = el<HTMLDivElement>('preset-grid');
    this.tm.getPresets().forEach((preset, i) => {
      const btn = document.createElement('button');
      btn.className = 'preset-btn';
      btn.type = 'button';
      const bg = preset.background;
      let sky = bg.gradient
        ? `linear-gradient(0deg, ${bg.gradientStops[0]}, ${bg.gradientStops[1]} 50%, ${bg.gradientStops[2]})`
        : bg.color;
      if (bg.aurora) {
        const [a, b, c, d] = bg.auroraColors;
        sky = `radial-gradient(circle at 18% 30%, ${a}cc, transparent 55%), radial-gradient(circle at 60% 10%, ${b}cc, transparent 55%), `
          + `radial-gradient(circle at 90% 45%, ${c}aa, transparent 50%), radial-gradient(circle at 40% 70%, ${d}88, transparent 45%), ${sky}`;
      }
      const glassy = preset.notes.glass > 0;
      const bars = [0, 1, 2, 3].map(j => {
        const c = preset.trackColors[j % 2 === 0 ? 0 : 1] ?? '#fff';
        const h = [16, 9, 22, 12][j];
        const glow = preset.effects.bloom ? `box-shadow:0 0 8px ${c};` : '';
        if (glassy) {
          return `<i style="left:${12 + j * 17}%;height:${h}px;width:9px;background:${c}40;border:1px solid rgba(255,255,255,0.7);border-right-color:rgba(255,255,255,0.2);border-bottom-color:rgba(255,255,255,0.2);backdrop-filter:blur(3px);box-shadow:0 0 6px ${c}66"></i>`;
        }
        return `<i style="left:${12 + j * 17}%;height:${h}px;background:${c};${glow}"></i>`;
      }).join('');
      btn.innerHTML = `<div class="preset-swatch" style="background:${sky};--wk:${preset.piano.whiteKeyColor};--felt:${preset.piano.feltColor}">${bars}<b></b></div><span>${preset.name}</span>`;
      btn.dataset.idx = String(i);
      if (preset.name === this.tm.current.name) btn.classList.add('active');
      btn.addEventListener('click', () => {
        this.tm.applyPreset(preset);
        // Sync from the current theme (not the preset) — applyPreset preserves
        // the user's view (camera mode/angle), so the preset object is stale.
        this._syncToTheme(this.tm.current);
        grid.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
      grid.appendChild(btn);
    });
  }

  private _wireTabs() {
    document.querySelectorAll<HTMLButtonElement>('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => this._activateTab(btn.dataset.tab!));
    });
  }

  private _activateTab(tab: string) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', (b as HTMLElement).dataset.tab === tab));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === `tab-${tab}`));
  }

  private _wireControls() {
    const t = () => this.tm.current;
    const apply = (patch: Partial<Theme>) => this.tm.apply(patch);

    // Background
    el('bg-color').addEventListener('input', e => apply({ background: { ...t().background, color: (e.target as HTMLInputElement).value } }));
    el('bg-gradient').addEventListener('change', e => {
      const on = (e.target as HTMLInputElement).checked;
      this._updateBgVisibility(on);
      apply({ background: { ...t().background, gradient: on } });
    });
    el('bg-stop0').addEventListener('input', e => { const s = [...t().background.gradientStops] as [string,string,string]; s[0] = (e.target as HTMLInputElement).value; apply({ background: { ...t().background, gradientStops: s } }); });
    el('bg-stop1').addEventListener('input', e => { const s = [...t().background.gradientStops] as [string,string,string]; s[1] = (e.target as HTMLInputElement).value; apply({ background: { ...t().background, gradientStops: s } }); });
    el('bg-stop2').addEventListener('input', e => { const s = [...t().background.gradientStops] as [string,string,string]; s[2] = (e.target as HTMLInputElement).value; apply({ background: { ...t().background, gradientStops: s } }); });
    el('bg-stars').addEventListener('change', e => apply({ background: { ...t().background, starfield: (e.target as HTMLInputElement).checked } }));
    el('bg-aurora').addEventListener('change', e => {
      const on = (e.target as HTMLInputElement).checked;
      this._updateAuroraVisibility(on);
      apply({ background: { ...t().background, aurora: on } });
    });
    [0, 1, 2, 3].forEach(i => el(`aurora-c${i}`).addEventListener('input', e => {
      const c = [...t().background.auroraColors] as [string, string, string, string];
      c[i] = (e.target as HTMLInputElement).value;
      apply({ background: { ...t().background, auroraColors: c } });
    }));
    el('ui-frosted').addEventListener('change', e => {
      const on = (e.target as HTMLInputElement).checked;
      document.body.classList.toggle('ui-frosted', on);
      apply({ ui: { ...t().ui, frosted: on } });
    });
    this._slider('note-glass', 'note-glass-v', v => { const n = v/100; this._setVal('note-glass-v', n.toFixed(2)); apply({ notes: { ...t().notes, glass: n } }); });
    this._slider('frost', 'frost-v', v => { const n = v/100; this._setVal('frost-v', n.toFixed(2)); apply({ effects: { ...t().effects, frost: n } }); });
    el('bg-scanlines').addEventListener('change', e => apply({ background: { ...t().background, scanlines: (e.target as HTMLInputElement).checked } }));

    // Background media — image / video overlay
    const mediaInput = el<HTMLInputElement>('bg-media-input');
    el('bg-media-pick').addEventListener('click', () => mediaInput.click());
    mediaInput.addEventListener('change', () => {
      const file = mediaInput.files?.[0];
      if (!file) return;
      const isVideo = file.type.startsWith('video/');
      const objectUrl = URL.createObjectURL(file);
      const existing = t().background.media;
      // Revoke any previous object URL so the browser releases the blob.
      if (existing?.src) URL.revokeObjectURL(existing.src);
      apply({ background: { ...t().background, media: {
        enabled: true,
        type: isVideo ? 'video' : 'image',
        src: objectUrl,
        fileName: file.name,
        fit: existing?.fit ?? 'cover',
        opacity: existing?.opacity ?? 1,
        blur: existing?.blur ?? 0,
      } } });
      this._setVal('bg-media-name', file.name);
      mediaInput.value = '';
    });
    el('bg-media-clear').addEventListener('click', () => {
      const existing = t().background.media;
      if (existing?.src) URL.revokeObjectURL(existing.src);
      apply({ background: { ...t().background, media: null } });
      this._setVal('bg-media-name', 'none');
    });
    el('bg-media-fit').addEventListener('change', e => {
      const m = t().background.media;
      if (!m) return;
      apply({ background: { ...t().background, media: { ...m, fit: (e.target as HTMLSelectElement).value as 'cover' | 'contain' | 'stretch' } } });
    });
    this._slider('bg-media-opacity', 'bg-media-opacity-v', v => {
      const n = v / 100;
      this._setVal('bg-media-opacity-v', n.toFixed(2));
      const m = t().background.media;
      if (m) apply({ background: { ...t().background, media: { ...m, opacity: n } } });
    });
    this._slider('bg-media-blur', 'bg-media-blur-v', v => {
      this._setVal('bg-media-blur-v', String(v));
      const m = t().background.media;
      if (m) apply({ background: { ...t().background, media: { ...m, blur: v } } });
    });

    // Notes
    el('note-shape').addEventListener('change', e => {
      const shape = (e.target as HTMLSelectElement).value as 'rectangle' | 'rounded' | 'capsule';
      this._updateCornerRadiusVisibility(shape);
      apply({ notes: { ...t().notes, shape } });
    });
    this._slider('note-opacity', 'note-opacity-v', v => { const n = v/100; this._setVal('note-opacity-v', n.toFixed(1)); apply({ notes: { ...t().notes, opacity: n } }); });
    this._slider('note-glow', 'note-glow-v', v => { const n = v/100; this._setVal('note-glow-v', n.toFixed(1)); apply({ notes: { ...t().notes, glowIntensity: n } }); });
    this._slider('trail-length', 'trail-len-v', v => { const n = v/100; this._setVal('trail-len-v', n.toFixed(2)); apply({ notes: { ...t().notes, trailLength: n } }); });
    this._slider('trail-opacity', 'trail-op-v', v => { const n = v/100; this._setVal('trail-op-v', n.toFixed(2)); apply({ notes: { ...t().notes, trailOpacity: n } }); });
    this._slider('corner-radius', 'corner-r-v', v => { this._setVal('corner-r-v', String(v)); apply({ notes: { ...t().notes, cornerRadius: v } }); });
    this._slider('note-bloom-mul', 'note-bloom-mul-v', v => { const n = v/100; this._setVal('note-bloom-mul-v', n.toFixed(1)); apply({ notes: { ...t().notes, bloomMultiplier: n } }); });
    el('vel-mod-enabled').addEventListener('change', e => apply({ notes: { ...t().notes, velocityModulation: { ...t().notes.velocityModulation, enabled: (e.target as HTMLInputElement).checked } } }));
    this._slider('vel-min', 'vel-min-v', v => { const n = v/100; this._setVal('vel-min-v', n.toFixed(2)); apply({ notes: { ...t().notes, velocityModulation: { ...t().notes.velocityModulation, minBrightness: n } } }); });
    this._slider('vel-max', 'vel-max-v', v => { const n = v/100; this._setVal('vel-max-v', n.toFixed(2)); apply({ notes: { ...t().notes, velocityModulation: { ...t().notes.velocityModulation, maxBrightness: n } } }); });
    this._slider('note-bevel', 'note-bevel-v', v => { const n = v/100; this._setVal('note-bevel-v', n.toFixed(2)); apply({ notes: { ...t().notes, bevel: n } }); });
    this._slider('note-shimmer', 'note-shimmer-v', v => { const n = v/100; this._setVal('note-shimmer-v', n.toFixed(2)); apply({ notes: { ...t().notes, shimmer: n } }); });
    this._slider('note-afterglow', 'note-afterglow-v', v => { const n = v/100; this._setVal('note-afterglow-v', n.toFixed(2)); apply({ notes: { ...t().notes, afterglow: n } }); });

    // Beat / bar markers
    el('marker-beats-enabled').addEventListener('change', e => apply({ markers: { ...t().markers, beats: { ...t().markers.beats, enabled: (e.target as HTMLInputElement).checked } } }));
    el('marker-beats-color').addEventListener('input', e => apply({ markers: { ...t().markers, beats: { ...t().markers.beats, color: (e.target as HTMLInputElement).value } } }));
    this._slider('marker-beats-op', 'marker-beats-op-v', v => { const n = v/100; this._setVal('marker-beats-op-v', n.toFixed(2)); apply({ markers: { ...t().markers, beats: { ...t().markers.beats, opacity: n } } }); });
    el('marker-bars-enabled').addEventListener('change', e => apply({ markers: { ...t().markers, bars: { ...t().markers.bars, enabled: (e.target as HTMLInputElement).checked } } }));
    el('marker-bars-color').addEventListener('input', e => apply({ markers: { ...t().markers, bars: { ...t().markers.bars, color: (e.target as HTMLInputElement).value } } }));
    this._slider('marker-bars-op', 'marker-bars-op-v', v => { const n = v/100; this._setVal('marker-bars-op-v', n.toFixed(2)); apply({ markers: { ...t().markers, bars: { ...t().markers.bars, opacity: n } } }); });
    this._slider('marker-bars-th', 'marker-bars-th-v', v => { this._setVal('marker-bars-th-v', String(v)); apply({ markers: { ...t().markers, bars: { ...t().markers.bars, thickness: v } } }); });
    el('marker-bpb').addEventListener('input', e => {
      const n = Math.max(1, Math.min(16, Number((e.target as HTMLInputElement).value) || 4));
      apply({ markers: { ...t().markers, beatsPerBar: n } });
    });
    el('note-color-mode').addEventListener('change', e => {
      const mode = (e.target as HTMLSelectElement).value as 'track' | 'pitch';
      this._updateColorModeVisibility(mode);
      apply({ notes: { ...t().notes, colorMode: mode } });
    });

    // Piano
    el('piano-style').addEventListener('change', e => {
      const style = (e.target as HTMLSelectElement).value as 'realistic' | 'neon' | 'glass';
      // Auto-swap key colours so the toggle is visibly distinct
      const colors = style === 'realistic'
        ? { whiteKeyColor: '#f3efe4', blackKeyColor: '#16120f' }
        : style === 'glass'
          ? { whiteKeyColor: '#ffffff', blackKeyColor: '#16132a' }
          : { whiteKeyColor: '#1a1b26', blackKeyColor: '#0b0b12' };
      (el('piano-white') as HTMLInputElement).value = colors.whiteKeyColor;
      (el('piano-black') as HTMLInputElement).value = colors.blackKeyColor;
      apply({ piano: { ...t().piano, style, ...colors } });
    });
    el('piano-white').addEventListener('input', e => apply({ piano: { ...t().piano, whiteKeyColor: (e.target as HTMLInputElement).value } }));
    el('piano-black').addEventListener('input', e => apply({ piano: { ...t().piano, blackKeyColor: (e.target as HTMLInputElement).value } }));
    el('piano-felt').addEventListener('input', e => apply({ piano: { ...t().piano, feltColor: (e.target as HTMLInputElement).value } }));
    el('piano-range').addEventListener('change', e => apply({ piano: { ...t().piano, range: (e.target as HTMLSelectElement).value as 'fit' | 'full' } }));
    el('piano-glow').addEventListener('change', e => apply({ piano: { ...t().piano, pressedGlow: (e.target as HTMLInputElement).checked } }));
    el('piano-press-source').addEventListener('change', e => apply({ piano: { ...t().piano, pressColorSource: (e.target as HTMLSelectElement).value as 'track'|'custom' } }));
    el('piano-press-color').addEventListener('input', e => apply({ piano: { ...t().piano, pressCustomColor: (e.target as HTMLInputElement).value } }));
    el('piano-depth').addEventListener('change', e => apply({ piano: { ...t().piano, depthEffect: (e.target as HTMLInputElement).checked } }));
    this._slider('piano-hitline-glow', 'piano-hitline-glow-v', v => { const n = v/100; this._setVal('piano-hitline-glow-v', n.toFixed(1)); apply({ piano: { ...t().piano, hitLineGlow: n } }); });
    this._slider('piano-beam-glow', 'piano-beam-glow-v', v => { const n = v/100; this._setVal('piano-beam-glow-v', n.toFixed(1)); apply({ piano: { ...t().piano, beamGlow: n } }); });
    el('piano-ripple').addEventListener('change', e => apply({ piano: { ...t().piano, hitRipple: (e.target as HTMLInputElement).checked } }));

    // Composition (3D) tab
    el('comp-camera-preset').addEventListener('change', e => {
      const preset = (e.target as HTMLSelectElement).value as 'tilt' | 'front' | 'side' | 'top';
      apply({ view: { ...t().view, composition: { ...t().view.composition, cameraPreset: preset } } });
    });
    this._slider('comp-cursor-opacity', 'comp-cursor-v', v => {
      const n = v / 100;
      this._setVal('comp-cursor-v', n.toFixed(2));
      apply({ view: { ...t().view, composition: { ...t().view.composition, cursorOpacity: n } } });
    });
    this._slider('comp-glow-radius', 'comp-glow-radius-v', v => {
      const n = v / 100;
      this._setVal('comp-glow-radius-v', n.toFixed(2));
      apply({ view: { ...t().view, composition: { ...t().view.composition, glowRadius: n } } });
    });
    this._slider('comp-glow-intensity', 'comp-glow-int-v', v => {
      const n = v / 100;
      this._setVal('comp-glow-int-v', n.toFixed(2));
      apply({ view: { ...t().view, composition: { ...t().view.composition, glowIntensity: n } } });
    });
    el('comp-recenter-btn').addEventListener('click', () => {
      // Round-trip the preset to re-trigger the recenter logic in App.ts
      const p = t().view.composition.cameraPreset;
      apply({ view: { ...t().view, composition: { ...t().view.composition, cameraPreset: p } } });
    });

    // View (camera mode + angle)
    el('view-camera-mode').addEventListener('change', e => {
      const mode = (e.target as HTMLSelectElement).value as 'ortho' | 'perspective';
      this._updateAngleVisibility(mode);
      apply({ view: { ...t().view, cameraMode: mode } });
    });
    el('view-camera-angle').addEventListener('change', e => {
      const angle = (e.target as HTMLSelectElement).value as 'standard' | 'low' | 'overhead' | 'cinematic';
      apply({ view: { ...t().view, cameraAngle: angle } });
    });
    el('view-reflective-floor').addEventListener('change', e => {
      apply({ view: { ...t().view, reflectiveFloor: (e.target as HTMLInputElement).checked } });
    });

    // Effects
    el('fx-bloom').addEventListener('change', e => apply({ effects: { ...t().effects, bloom: (e.target as HTMLInputElement).checked } }));
    this._slider('bloom-strength', 'bloom-str-v', v => { const n = v/100; this._setVal('bloom-str-v', n.toFixed(1)); apply({ effects: { ...t().effects, bloomStrength: n } }); });
    this._slider('bloom-threshold', 'bloom-thr-v', v => { const n = v/100; this._setVal('bloom-thr-v', n.toFixed(2)); apply({ effects: { ...t().effects, bloomThreshold: n } }); });
    this._slider('bloom-radius', 'bloom-rad-v', v => { const n = v/100; this._setVal('bloom-rad-v', n.toFixed(2)); apply({ effects: { ...t().effects, bloomRadius: n } }); });
    el('fx-particles').addEventListener('change', e => apply({ effects: { ...t().effects, particles: (e.target as HTMLInputElement).checked } }));
    this._slider('particle-density', 'particle-density-v', v => { const n = v/100; this._setVal('particle-density-v', n.toFixed(2)); apply({ effects: { ...t().effects, particleDensity: n } }); });
    this._slider('particle-glow', 'particle-glow-v', v => { const n = v/100; this._setVal('particle-glow-v', n.toFixed(1)); apply({ effects: { ...t().effects, particleGlow: n } }); });
    this._slider('particle-curl', 'particle-curl-v', v => { const n = v/100; this._setVal('particle-curl-v', n.toFixed(1)); apply({ effects: { ...t().effects, particleCurl: n } }); });
    el('fx-layer-sparks').addEventListener('change', e => apply({ effects: { ...t().effects, particleLayers: { ...t().effects.particleLayers, sparks: (e.target as HTMLInputElement).checked } } }));
    el('fx-layer-embers').addEventListener('change', e => apply({ effects: { ...t().effects, particleLayers: { ...t().effects.particleLayers, embers: (e.target as HTMLInputElement).checked } } }));
    el('fx-layer-ambient').addEventListener('change', e => apply({ effects: { ...t().effects, particleLayers: { ...t().effects.particleLayers, ambient: (e.target as HTMLInputElement).checked } } }));
    el('fx-layer-impact').addEventListener('change', e => apply({ effects: { ...t().effects, particleLayers: { ...t().effects.particleLayers, impact: (e.target as HTMLInputElement).checked } } }));
    el('fx-grain').addEventListener('change', e => apply({ effects: { ...t().effects, filmGrain: (e.target as HTMLInputElement).checked } }));
    this._slider('grain-intensity', 'grain-int-v', v => { const n = v/100; this._setVal('grain-int-v', n.toFixed(2)); apply({ effects: { ...t().effects, filmGrainIntensity: n } }); });
    el('fx-vignette').addEventListener('change', e => apply({ effects: { ...t().effects, vignette: (e.target as HTMLInputElement).checked } }));
    this._slider('vignette-intensity', 'vignette-int-v', v => { const n = v/100; this._setVal('vignette-int-v', n.toFixed(2)); apply({ effects: { ...t().effects, vignetteIntensity: n } }); });
    el('fx-chroma').addEventListener('change', e => apply({ effects: { ...t().effects, chromaticAberration: (e.target as HTMLInputElement).checked } }));
    this._slider('chroma-intensity', 'chroma-int-v', v => { const n = v/100; this._setVal('chroma-int-v', n.toFixed(2)); apply({ effects: { ...t().effects, chromaticAberrationIntensity: n } }); });

    // UI
    this._slider('hud-opacity', 'hud-op-v', v => {
      const n = v / 100;
      this._setVal('hud-op-v', n.toFixed(2));
      document.documentElement.style.setProperty('--hud-opacity', String(n));
      apply({ ui: { ...t().ui, hudOpacity: n } });
    });
    el('ui-accent').addEventListener('input', e => {
      const color = (e.target as HTMLInputElement).value;
      apply({ ui: { ...t().ui, accentColor: color } });
      this._applyAccent(color);
    });

    // Theme export/import
    el('export-theme-btn').addEventListener('click', () => this.tm.exportJSON());
    el('import-theme-btn').addEventListener('click', () => el<HTMLInputElement>('theme-import-input').click());
    el('theme-import-input').addEventListener('change', e => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) { this.tm.importJSON(file); setTimeout(() => this._syncToTheme(this.tm.current), 200); }
    });
  }

  private _slider(id: string, _vid: string, cb: (v: number) => void) {
    el<HTMLInputElement>(id).addEventListener('input', e => cb(Number((e.target as HTMLInputElement).value)));
  }

  private _setVal(id: string, v: string) {
    const el = document.getElementById(id);
    if (el) el.textContent = v;
  }

  syncToTheme(theme: Theme) { this._syncToTheme(theme); }

  private _syncToTheme(t: Theme) {
    const set = (id: string, v: string | number | boolean) => {
      const e = document.getElementById(id);
      if (!e) return;
      if (e instanceof HTMLInputElement) {
        if (e.type === 'checkbox') e.checked = Boolean(v);
        else e.value = String(v);
      } else if (e instanceof HTMLSelectElement) {
        e.value = String(v);
      }
    };

    set('view-camera-mode', t.view.cameraMode);
    set('view-camera-angle', t.view.cameraAngle);
    set('view-reflective-floor', t.view.reflectiveFloor);
    set('comp-camera-preset', t.view.composition.cameraPreset);
    set('comp-cursor-opacity', Math.round(t.view.composition.cursorOpacity * 100));
    set('comp-glow-radius', Math.round(t.view.composition.glowRadius * 100));
    set('comp-glow-intensity', Math.round(t.view.composition.glowIntensity * 100));
    set('bg-color', t.background.color);
    set('bg-gradient', t.background.gradient);
    set('bg-stop0', t.background.gradientStops[0]);
    set('bg-stop1', t.background.gradientStops[1]);
    set('bg-stop2', t.background.gradientStops[2]);
    set('bg-stars', t.background.starfield);
    set('bg-aurora', t.background.aurora);
    t.background.auroraColors.forEach((c, i) => set(`aurora-c${i}`, c));
    set('ui-frosted', t.ui.frosted);
    set('note-glass', Math.round(t.notes.glass * 100));
    set('frost', Math.round(t.effects.frost * 100));
    this._updateAuroraVisibility(t.background.aurora);
    set('bg-scanlines', t.background.scanlines);
    const media = t.background.media;
    set('bg-media-fit', media?.fit ?? 'cover');
    set('bg-media-opacity', Math.round((media?.opacity ?? 1) * 100));
    set('bg-media-blur', Math.round(media?.blur ?? 0));
    this._setVal('bg-media-name', media?.fileName ?? 'none');
    this._setVal('bg-media-opacity-v', (media?.opacity ?? 1).toFixed(2));
    this._setVal('bg-media-blur-v', String(media?.blur ?? 0));
    set('note-shape', t.notes.shape);
    set('note-opacity', Math.round(t.notes.opacity * 100));
    set('note-glow', Math.round(t.notes.glowIntensity * 100));
    set('trail-length', Math.round(t.notes.trailLength * 100));
    set('trail-opacity', Math.round(t.notes.trailOpacity * 100));
    set('corner-radius', t.notes.cornerRadius);
    set('note-bloom-mul', Math.round(t.notes.bloomMultiplier * 100));
    set('vel-mod-enabled', t.notes.velocityModulation.enabled);
    set('vel-min', Math.round(t.notes.velocityModulation.minBrightness * 100));
    set('vel-max', Math.round(t.notes.velocityModulation.maxBrightness * 100));
    set('note-shimmer', Math.round(t.notes.shimmer * 100));
    set('note-bevel', Math.round(t.notes.bevel * 100));
    set('note-afterglow', Math.round(t.notes.afterglow * 100));
    set('marker-beats-enabled', t.markers.beats.enabled);
    set('marker-beats-color', t.markers.beats.color);
    set('marker-beats-op', Math.round(t.markers.beats.opacity * 100));
    set('marker-bars-enabled', t.markers.bars.enabled);
    set('marker-bars-color', t.markers.bars.color);
    set('marker-bars-op', Math.round(t.markers.bars.opacity * 100));
    set('marker-bars-th', t.markers.bars.thickness);
    set('marker-bpb', t.markers.beatsPerBar);
    set('note-color-mode', t.notes.colorMode);
    set('piano-style', t.piano.style);
    set('piano-white', t.piano.whiteKeyColor);
    set('piano-black', t.piano.blackKeyColor);
    set('piano-felt', t.piano.feltColor);
    set('piano-range', t.piano.range);
    set('piano-glow', t.piano.pressedGlow);
    set('piano-press-source', t.piano.pressColorSource);
    set('piano-press-color', t.piano.pressCustomColor);
    set('piano-depth', t.piano.depthEffect);
    set('piano-hitline-glow', Math.round(t.piano.hitLineGlow * 100));
    set('piano-beam-glow', Math.round(t.piano.beamGlow * 100));
    set('piano-ripple', t.piano.hitRipple);
    set('fx-bloom', t.effects.bloom);
    set('bloom-strength', Math.round(t.effects.bloomStrength * 100));
    set('bloom-threshold', Math.round(t.effects.bloomThreshold * 100));
    set('bloom-radius', Math.round(t.effects.bloomRadius * 100));
    set('fx-particles', t.effects.particles);
    set('particle-density', Math.round(t.effects.particleDensity * 100));
    set('particle-glow', Math.round(t.effects.particleGlow * 100));
    set('particle-curl', Math.round(t.effects.particleCurl * 100));
    set('fx-layer-sparks', t.effects.particleLayers.sparks);
    set('fx-layer-embers', t.effects.particleLayers.embers);
    set('fx-layer-ambient', t.effects.particleLayers.ambient);
    set('fx-layer-impact', t.effects.particleLayers.impact);
    set('fx-grain', t.effects.filmGrain);
    set('grain-intensity', Math.round(t.effects.filmGrainIntensity * 100));
    set('fx-vignette', t.effects.vignette);
    set('vignette-intensity', Math.round(t.effects.vignetteIntensity * 100));
    set('fx-chroma', t.effects.chromaticAberration);
    set('chroma-intensity', Math.round(t.effects.chromaticAberrationIntensity * 100));
    set('hud-opacity', Math.round(t.ui.hudOpacity * 100));
    set('ui-accent', t.ui.accentColor);

    const dv: [string, string][] = [
      ['note-opacity-v', t.notes.opacity.toFixed(1)],
      ['note-glow-v', t.notes.glowIntensity.toFixed(1)],
      ['trail-len-v', t.notes.trailLength.toFixed(2)],
      ['trail-op-v', t.notes.trailOpacity.toFixed(2)],
      ['corner-r-v', String(t.notes.cornerRadius)],
      ['bloom-str-v', t.effects.bloomStrength.toFixed(1)],
      ['bloom-thr-v', t.effects.bloomThreshold.toFixed(2)],
      ['bloom-rad-v', t.effects.bloomRadius.toFixed(2)],
      ['particle-density-v', t.effects.particleDensity.toFixed(2)],
      ['grain-int-v', t.effects.filmGrainIntensity.toFixed(2)],
      ['vignette-int-v', t.effects.vignetteIntensity.toFixed(2)],
      ['hud-op-v', t.ui.hudOpacity.toFixed(2)],
      ['comp-cursor-v', t.view.composition.cursorOpacity.toFixed(2)],
      ['comp-glow-radius-v', t.view.composition.glowRadius.toFixed(2)],
      ['comp-glow-int-v', t.view.composition.glowIntensity.toFixed(2)],
      ['note-bloom-mul-v', t.notes.bloomMultiplier.toFixed(1)],
      ['piano-hitline-glow-v', t.piano.hitLineGlow.toFixed(1)],
      ['piano-beam-glow-v', t.piano.beamGlow.toFixed(1)],
      ['particle-glow-v', t.effects.particleGlow.toFixed(1)],
      ['particle-curl-v', t.effects.particleCurl.toFixed(1)],
      ['chroma-int-v', t.effects.chromaticAberrationIntensity.toFixed(2)],
      ['vel-min-v', t.notes.velocityModulation.minBrightness.toFixed(2)],
      ['vel-max-v', t.notes.velocityModulation.maxBrightness.toFixed(2)],
      ['note-shimmer-v', t.notes.shimmer.toFixed(2)],
      ['note-bevel-v', t.notes.bevel.toFixed(2)],
      ['note-glass-v', t.notes.glass.toFixed(2)],
      ['frost-v', t.effects.frost.toFixed(2)],
      ['note-afterglow-v', t.notes.afterglow.toFixed(2)],
      ['marker-beats-op-v', t.markers.beats.opacity.toFixed(2)],
      ['marker-bars-op-v', t.markers.bars.opacity.toFixed(2)],
      ['marker-bars-th-v', String(t.markers.bars.thickness)],
    ];
    dv.forEach(([id, v]) => this._setVal(id, v));
    this._applyAccent(t.ui.accentColor);
    document.body.classList.toggle('ui-frosted', t.ui.frosted);
    document.documentElement.style.setProperty('--hud-opacity', String(t.ui.hudOpacity));
    this._updateBgVisibility(t.background.gradient);
    this._updateCornerRadiusVisibility(t.notes.shape);
    this._updateAngleVisibility(t.view.cameraMode);
    this._updateColorModeVisibility(t.notes.colorMode);
    this._syncTrackSwatches(t.trackColors);
    this._syncPitchSwatches(t.notes.pitchColors);
  }

  private _syncPitchSwatches(colors: string[]) {
    const inputs = document.querySelectorAll<HTMLInputElement>('#pitch-color-swatches input');
    inputs.forEach((input, i) => {
      if (i < colors.length) input.value = colors[i];
    });
  }

  private _syncTrackSwatches(colors: string[]) {
    const inputs = document.querySelectorAll<HTMLInputElement>('#track-color-swatches input');
    inputs.forEach((input, i) => {
      if (i < colors.length) input.value = colors[i];
    });
  }

  private _applyAccent(color: string) {
    document.documentElement.style.setProperty('--accent', color);
  }

  private _updateAuroraVisibility(on: boolean) {
    const row = document.getElementById('aurora-colors-row');
    if (row) row.style.display = on ? 'flex' : 'none';
  }

  private _updateBgVisibility(gradientOn: boolean) {
    const baseRow = document.getElementById('bg-color')?.closest('.s-row') as HTMLElement | null;
    const stopsRow = document.getElementById('bg-stop0')?.closest('.s-row') as HTMLElement | null;
    if (baseRow) baseRow.style.display = gradientOn ? 'none' : 'flex';
    if (stopsRow) stopsRow.style.display = gradientOn ? 'flex' : 'none';
  }

  private _updateCornerRadiusVisibility(shape: 'rectangle' | 'rounded' | 'capsule') {
    const row = document.getElementById('corner-radius')?.closest('.s-row') as HTMLElement | null;
    if (row) row.style.display = shape === 'rounded' ? 'flex' : 'none';
  }

  private _updateAngleVisibility(_mode: 'ortho' | 'perspective') {
    // Angle row is hidden until we ship more than one tuned perspective angle.
  }

  private _updateColorModeVisibility(mode: 'track' | 'pitch') {
    const trackSec = document.getElementById('track-colors-section');
    const pitchSec = document.getElementById('pitch-colors-section');
    if (trackSec) trackSec.style.display = mode === 'pitch' ? 'none' : 'block';
    if (pitchSec) pitchSec.style.display = mode === 'pitch' ? 'block' : 'none';
  }
}
