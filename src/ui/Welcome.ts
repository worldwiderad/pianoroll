import type { LoadedMidi } from './FileLoader';
import type { SettingsPanel } from './SettingsPanel';

function el<T extends HTMLElement>(id: string) { return document.getElementById(id) as T; }
function fmt(s: number) { const m = Math.floor(s / 60); return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`; }

/**
 * The first screen: a card over the demo that picks a file, then shows what
 * was picked with a Play button. It goes away once a piece starts playing.
 */
export class Welcome {
  constructor(settings: SettingsPanel) {
    el('w-customise').addEventListener('click', () => settings.open());
    el('w-play').addEventListener('click', () => el<HTMLButtonElement>('start-btn').click());

    window.addEventListener('midi-chosen', (e) => {
      const { data, fileName } = (e as CustomEvent<LoadedMidi>).detail;
      const notes = data.tracks.reduce((n, t) => n + t.notes.length, 0);
      const tracks = data.tracks.length;
      el('w-file-name').textContent = fileName;
      el('w-file-meta').textContent =
        `${fmt(data.duration)} · ${tracks} ${tracks === 1 ? 'track' : 'tracks'} · ${notes.toLocaleString()} notes`;
      document.body.classList.add('midi-chosen');
    });

    window.addEventListener('audio-chosen', (e) => {
      el('w-audio-label').textContent = 'Change recording';
      el('w-audio-hint').textContent = `Plays in sync with ${(e as CustomEvent<string>).detail}.`;
    });
  }
}
