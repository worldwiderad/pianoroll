import { loadMidiFromBytes, type MidiData } from '../midi/MidiLoader';
import type { AudioSync } from '../audio/AudioSync';
import type { SettingsPanel } from './SettingsPanel';

function el<T extends HTMLElement>(id: string) { return document.getElementById(id) as T; }

export interface LoadedMidi {
  data: MidiData;
  bytes: ArrayBuffer;
  fileName: string;
}

export class FileLoader {
  private loadedMidi: LoadedMidi | null = null;
  private audioLoaded = false;
  private onReady: (midi: LoadedMidi) => void;
  private audio: AudioSync;
  private settings: SettingsPanel | null = null;

  constructor(audio: AudioSync, onReady: (midi: LoadedMidi) => void, settings?: SettingsPanel) {
    this.audio = audio;
    this.onReady = onReady;
    this.settings = settings ?? null;
    this._wire();
  }

  private async _ingestMidiFile(file: File) {
    const bytes = await file.arrayBuffer();
    const data = loadMidiFromBytes(bytes.slice(0));
    this.loadedMidi = { data, bytes, fileName: file.name };
    el('midi-label').textContent = file.name;
    el('midi-zone').classList.add('loaded');
    window.dispatchEvent(new CustomEvent('midi-chosen', { detail: this.loadedMidi }));
  }

  /** Programmatic load (e.g. from a saved project) — bypasses the picker UI. */
  async ingestMidiBytes(bytes: ArrayBuffer, fileName: string): Promise<MidiData> {
    const data = loadMidiFromBytes(bytes.slice(0));
    this.loadedMidi = { data, bytes, fileName };
    el('midi-label').textContent = fileName;
    el('midi-zone').classList.add('loaded');
    this._checkReady();
    return data;
  }

  async ingestAudioBytes(bytes: ArrayBuffer, mime: string, fileName: string) {
    await this.audio.loadFromBytes(bytes, mime, fileName);
    this.audioLoaded = true;
    el('audio-label').textContent = fileName;
    el('audio-zone').classList.add('loaded');
    window.dispatchEvent(new CustomEvent('audio-chosen', { detail: fileName }));
  }

  clearAudio() {
    this.audio.clear();
    this.audioLoaded = false;
    el('audio-label').textContent = 'Add a recording (optional)';
    el('audio-zone').classList.remove('loaded');
  }

  private _wire() {
    const midiInput = el<HTMLInputElement>('midi-input');
    const audioInput = el<HTMLInputElement>('audio-input');
    const startBtn = el<HTMLButtonElement>('start-btn');

    midiInput.addEventListener('change', async e => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      await this._ingestMidiFile(file);
      this._checkReady();
    });

    audioInput.addEventListener('change', async e => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      await this.audio.load(file);
      this.audioLoaded = true;
      el('audio-label').textContent = file.name;
      el('audio-zone').classList.add('loaded');
      window.dispatchEvent(new CustomEvent('audio-chosen', { detail: file.name }));
      this._checkReady();
    });

    startBtn.addEventListener('click', () => {
      if (!this.loadedMidi) return;
      this.settings?.close();
      this.onReady(this.loadedMidi);
      document.getElementById('play-btn')?.click();
    });

    document.addEventListener('dragover', e => e.preventDefault());
    document.addEventListener('drop', async e => {
      e.preventDefault();
      const files = Array.from(e.dataTransfer?.files ?? []);
      for (const file of files) {
        if (file.name.match(/\.(mid|midi)$/i)) {
          await this._ingestMidiFile(file);
        } else if (file.type.startsWith('audio/')) {
          await this.audio.load(file);
          this.audioLoaded = true;
          el('audio-label').textContent = file.name;
          el('audio-zone').classList.add('loaded');
          window.dispatchEvent(new CustomEvent('audio-chosen', { detail: file.name }));
        }
      }
      this._checkReady();
    });

    ['midi-zone', 'audio-zone'].forEach(id => {
      const zone = el(id);
      zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
      zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
      zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('drag-over'); });
    });
  }

  private _checkReady() {
    el<HTMLButtonElement>('start-btn').classList.toggle('ready', this.loadedMidi !== null);
  }

  get current(): LoadedMidi | null { return this.loadedMidi; }
  get audioWasLoaded(): boolean { return this.audioLoaded; }
}
