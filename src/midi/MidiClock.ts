export class MidiClock {
  duration = 0;
  speed = 1;
  private _time = 0;
  private _playing = false;
  private _lastRAF = 0;
  private _rafId = 0;
  private _audioGetter: (() => number) | null = null;
  onTick: ((t: number) => void) | null = null;
  onEnd: (() => void) | null = null;

  get currentTime() { return this._time; }
  get playing() { return this._playing; }

  setAudioGetter(fn: (() => number) | null) { this._audioGetter = fn; }

  play() {
    if (this._playing) return;
    this._playing = true;
    this._lastRAF = performance.now();
    this._tick();
  }

  pause() {
    this._playing = false;
    cancelAnimationFrame(this._rafId);
  }

  seekTo(t: number) {
    this._time = Math.max(0, Math.min(t, this.duration));
    this.onTick?.(this._time);
  }

  reset() { this.seekTo(0); }

  private _tick = () => {
    if (!this._playing) return;
    const now = performance.now();

    if (this._audioGetter) {
      this._time = this._audioGetter();
    } else {
      const dt = (now - this._lastRAF) / 1000 * this.speed;
      this._time = Math.min(this._time + dt, this.duration);
    }

    this._lastRAF = now;
    this.onTick?.(this._time);

    if (this._time >= this.duration) {
      this._playing = false;
      this.onEnd?.();
      return;
    }

    this._rafId = requestAnimationFrame(this._tick);
  };
}
