import type { Theme } from './types';
import { DEFAULT_THEME, PRESETS } from './presets';

const LS_KEY = 'pianoroll_theme';

export class ThemeManager {
  current: Theme;
  private listeners: Array<(t: Theme) => void> = [];

  constructor() {
    let saved: Partial<Theme> | null = null;
    try { saved = JSON.parse(localStorage.getItem(LS_KEY) ?? 'null'); } catch { saved = null; }
    // Themes saved before the keyboard redesign (no felt colour) were tuned
    // for the old renderer, whose low bloom threshold washed the keys out.
    // Start those visitors on the current default instead.
    if (saved && !(saved.piano && 'feltColor' in saved.piano)) saved = null;
    // Deep-merge so newly-added Theme fields are filled from defaults
    this.current = saved
      ? deepMerge(DEFAULT_THEME, saved) as Theme
      : { ...DEFAULT_THEME };
  }

  apply(patch: Partial<Theme> | Theme) {
    this.current = deepMerge(this.current, patch) as Theme;
    this.save();
    this.listeners.forEach(fn => fn(this.current));
  }

  applyPreset(preset: Theme) {
    // Preserve the user's current view (camera mode/angle) across preset switches —
    // presets are about look and feel, not 2D-vs-3D.
    const preservedView = this.current.view;
    this.current = deepMerge(DEFAULT_THEME, preset) as Theme;
    this.current.view = { ...preservedView };
    this.save();
    this.listeners.forEach(fn => fn(this.current));
  }

  onChange(fn: (t: Theme) => void) {
    this.listeners.push(fn);
  }

  /** Strip per-session object URLs (e.g. background.media.src) before persisting. */
  snapshotForPersist(): Theme {
    const snap = JSON.parse(JSON.stringify(this.current)) as Theme;
    if (snap.background.media) snap.background.media = null;
    return snap;
  }

  exportJSON() {
    const blob = new Blob([JSON.stringify(this.current, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'pianoroll-theme.json'; a.click();
    URL.revokeObjectURL(url);
  }

  importJSON(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target!.result as string);
        this.apply(data);
      } catch { /* ignore bad JSON */ }
    };
    reader.readAsText(file);
  }

  getPresets() { return PRESETS; }

  private _saveTimer: number | null = null;
  private save() {
    if (this._saveTimer !== null) clearTimeout(this._saveTimer);
    this._saveTimer = window.setTimeout(() => {
      localStorage.setItem(LS_KEY, JSON.stringify(this.snapshotForPersist()));
      this._saveTimer = null;
    }, 250);
  }
}

function deepMerge(target: unknown, source: unknown): unknown {
  if (typeof source !== 'object' || source === null) return source;
  if (typeof target !== 'object' || target === null) return source;
  const out = { ...(target as Record<string, unknown>) };
  for (const key of Object.keys(source as Record<string, unknown>)) {
    const sv = (source as Record<string, unknown>)[key];
    const tv = (target as Record<string, unknown>)[key];
    out[key] = (typeof sv === 'object' && sv !== null && !Array.isArray(sv))
      ? deepMerge(tv, sv) : sv;
  }
  return out;
}
