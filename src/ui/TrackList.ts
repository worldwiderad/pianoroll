import type { MidiTrack } from '../midi/MidiLoader';
import type { NoteRain } from '../scene/NoteRain';
import type { ThemeManager } from '../theme/ThemeManager';
import type { InstrumentId } from '../theme/types';

const INSTRUMENT_OPTIONS: Array<[InstrumentId, string]> = [
  ['piano', 'Piano'],
  ['strings', 'Strings'],
  ['brass', 'Brass'],
  ['woodwinds', 'Woodwinds'],
  ['synthPad', 'Synth Pad'],
  ['synthLead', 'Synth Lead'],
  ['drum', 'Drum'],
];

function el<T extends HTMLElement>(id: string) { return document.getElementById(id) as T; }

export class TrackList {
  private panel = el<HTMLDivElement>('track-panel');
  private list = el<HTMLDivElement>('track-list');
  private open = false;
  private rain: NoteRain;
  private tm: ThemeManager;
  private onVisibilityChange: ((trackIdx: number, visible: boolean) => void) | null;
  private onInstrumentChange: ((trackIdx: number, instrument: InstrumentId) => void) | null;

  constructor(
    rain: NoteRain,
    tm: ThemeManager,
    onVisibilityChange?: (trackIdx: number, visible: boolean) => void,
    onInstrumentChange?: (trackIdx: number, instrument: InstrumentId) => void,
  ) {
    this.rain = rain;
    this.tm = tm;
    this.onVisibilityChange = onVisibilityChange ?? null;
    this.onInstrumentChange = onInstrumentChange ?? null;
    // Make track panel visible now that MIDI is loaded
    this.panel.style.display = 'flex';
    this.panel.style.flexDirection = 'column';
    el<HTMLButtonElement>('tracks-btn').addEventListener('click', () => this.toggle());
    window.addEventListener('panel-open', (e) => {
      if ((e as CustomEvent).detail !== 'tracks') this._closeFromEvent();
    });
  }

  toggle() {
    const next = !this.open;
    this.open = next;
    this.panel.classList.toggle('open', next);
    if (next) window.dispatchEvent(new CustomEvent('panel-open', { detail: 'tracks' }));
    document.body.classList.toggle('panel-open', next);
  }

  private _closeFromEvent() {
    this.open = false;
    this.panel.classList.remove('open');
  }

  build(tracks: MidiTrack[]) {
    this.list.innerHTML = '';
    tracks.forEach((track, i) => {
      const color = this.tm.current.trackColors[i % this.tm.current.trackColors.length];
      const item = document.createElement('div');
      item.className = 'track-item';

      const colorInput = document.createElement('input');
      colorInput.type = 'color';
      colorInput.className = 'track-color';
      colorInput.value = color;
      colorInput.title = 'Change track colour';
      colorInput.addEventListener('input', (e) => {
        const hex = (e.target as HTMLInputElement).value;
        this.rain.setTrackColor(i, hex);
        const colors = [...this.tm.current.trackColors];
        colors[i] = hex;
        this.tm.apply({ trackColors: colors });
      });

      const name = document.createElement('span');
      name.className = 'track-name';
      name.textContent = track.name;

      const noteCount = document.createElement('span');
      noteCount.className = 'track-notes';
      noteCount.textContent = `${track.notes.length}`;

      const instSelect = document.createElement('select');
      instSelect.className = 's-select';
      instSelect.title = 'Track instrument (synth path only)';
      instSelect.style.fontSize = '0.7rem';
      instSelect.style.padding = '2px 4px';
      instSelect.style.maxWidth = '80px';
      for (const [id, label] of INSTRUMENT_OPTIONS) {
        const opt = document.createElement('option');
        opt.value = id; opt.textContent = label;
        instSelect.appendChild(opt);
      }
      instSelect.value = this.tm.current.tracks.instruments[i] ?? 'piano';
      instSelect.addEventListener('change', () => {
        const value = instSelect.value as InstrumentId;
        const list = [...this.tm.current.tracks.instruments];
        while (list.length <= i) list.push('piano');
        list[i] = value;
        this.tm.apply({ tracks: { instruments: list } });
        this.onInstrumentChange?.(i, value);
      });

      const eye = document.createElement('button');
      eye.className = 'track-eye';
      eye.title = 'Toggle visibility';
      eye.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
      let visible = true;
      eye.addEventListener('click', () => {
        visible = !visible;
        this.rain.setTrackVisible(i, visible);
        eye.classList.toggle('muted', !visible);
        this.onVisibilityChange?.(i, visible);
      });

      item.append(colorInput, name, noteCount, instSelect, eye);
      this.list.appendChild(item);
    });
  }
}
