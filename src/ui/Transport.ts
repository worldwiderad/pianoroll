import type { MidiClock } from '../midi/MidiClock';
import type { AudioSync } from '../audio/AudioSync';

function el<T extends HTMLElement>(id: string) { return document.getElementById(id) as T; }
function fmt(s: number) { const m = Math.floor(s / 60); return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`; }

export class Transport {
  private clock: MidiClock;
  private audio: AudioSync;
  private onPlayCb: (() => void) | null = null;
  private seekEl = el<HTMLInputElement>('seek');
  private timeEl = el<HTMLSpanElement>('time-display');
  private playBtn = el<HTMLButtonElement>('play-btn');
  private playIcon = document.getElementById('play-icon') as Element;
  private dragging = false;

  constructor(clock: MidiClock, audio: AudioSync) {
    this.clock = clock;
    this.audio = audio;
    this._wire();
  }

  /** Hook called whenever playback is started via the play button or Space. */
  onPlay(cb: () => void) { this.onPlayCb = cb; }

  private _wire() {
    this.playBtn.addEventListener('click', () => this._togglePlay());
    el('restart-btn').addEventListener('click', () => this._restart());
    el('speed-select').addEventListener('change', (e) => {
      const speed = Number((e.target as HTMLSelectElement).value);
      this.clock.speed = speed;
      this.audio.speed = speed;
    });

    this.seekEl.addEventListener('mousedown', () => { this.dragging = true; });
    this.seekEl.addEventListener('touchstart', () => { this.dragging = true; });
    this.seekEl.addEventListener('input', () => {
      const t = (Number(this.seekEl.value) / 1000) * this.clock.duration;
      this.clock.seekTo(t);
      if (this.audio.loaded) {
        if (this.audio.playing) { this.audio.pause(); this.audio.play(t); }
        else { this.audio.startOffset = t; }
      }
    });
    this.seekEl.addEventListener('mouseup', () => { this.dragging = false; });
    this.seekEl.addEventListener('touchend', () => { this.dragging = false; });

    document.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.code === 'Space') { e.preventDefault(); this._togglePlay(); }
      if (e.code === 'ArrowLeft') { e.preventDefault(); this._seek(-5); }
      if (e.code === 'ArrowRight') { e.preventDefault(); this._seek(5); }
    });
  }

  private _togglePlay() {
    if (this.clock.playing) {
      this.clock.pause();
      this.audio.pause();
      this._setIcon(false);
    } else {
      if (this.audio.loaded) this.audio.play(this.clock.currentTime);
      this.clock.play();
      this.onPlayCb?.();
      this._setIcon(true);
    }
  }

  private _restart() {
    this.clock.pause();
    this.audio.stop();
    this.clock.seekTo(0);
    this._setIcon(false);
  }

  private _seek(delta: number) {
    const t = Math.max(0, Math.min(this.clock.currentTime + delta, this.clock.duration));
    this.clock.seekTo(t);
    if (this.audio.loaded && this.audio.playing) { this.audio.pause(); this.audio.play(t); }
  }

  update(currentTime: number) {
    if (!this.dragging && this.clock.duration > 0) {
      this.seekEl.value = String(Math.round((currentTime / this.clock.duration) * 1000));
    }
    this.seekEl.style.setProperty('--p', `${Number(this.seekEl.value) / 10}%`);
    this.timeEl.textContent = `${fmt(currentTime)} / ${fmt(this.clock.duration)}`;
  }

  show() { el('transport').classList.add('visible'); }

  setTitle(name: string) {
    const t = el('song-title');
    t.textContent = name;
    t.title = name;
  }

  private _setIcon(playing: boolean) {
    this.playIcon.innerHTML = playing
      ? '<rect x="4" y="2" width="4" height="12"/><rect x="10" y="2" width="4" height="12"/>'
      : '<path d="M4 2l10 6-10 6V2z"/>';
  }
}
