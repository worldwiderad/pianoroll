export class AudioSync {
  private ctx: AudioContext | null = null;
  buffer: AudioBuffer | null = null;
  /** Original encoded file bytes — kept so projects can save/restore. */
  bytes: ArrayBuffer | null = null;
  mime: string | null = null;
  fileName: string | null = null;
  private source: AudioBufferSourceNode | null = null;
  private startCtxTime = 0;
  startOffset = 0;
  private _playing = false;
  speed = 1;

  get loaded() { return this.buffer !== null; }
  get playing() { return this._playing; }

  async load(file: File) {
    this.stop();
    this.ctx = new AudioContext();
    const buf = await file.arrayBuffer();
    this.bytes = buf.slice(0); // decodeAudioData may consume; keep a copy
    this.mime = file.type;
    this.fileName = file.name;
    this.buffer = await this.ctx.decodeAudioData(buf);
    return this.buffer.duration;
  }

  /** Reconstruct from previously-saved bytes (e.g. an IndexedDB project). */
  async loadFromBytes(bytes: ArrayBuffer, mime: string, fileName: string) {
    this.stop();
    this.ctx = new AudioContext();
    this.bytes = bytes;
    this.mime = mime;
    this.fileName = fileName;
    // decodeAudioData may detach its input, so feed it a copy.
    this.buffer = await this.ctx.decodeAudioData(bytes.slice(0));
    return this.buffer.duration;
  }

  /** Release the current media so the next load starts fresh. */
  clear() {
    this.stop();
    this.buffer = null;
    this.bytes = null;
    this.mime = null;
    this.fileName = null;
  }

  play(offset = 0) {
    if (!this.ctx || !this.buffer) return;
    this.stop();
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this.source = this.ctx.createBufferSource();
    this.source.buffer = this.buffer;
    this.source.playbackRate.value = this.speed;
    this.source.connect(this.ctx.destination);
    this.startOffset = offset;
    this.startCtxTime = this.ctx.currentTime;
    this.source.start(0, offset);
    this._playing = true;
    this.source.onended = () => { this._playing = false; };
  }

  pause() {
    if (!this._playing) return;
    this.startOffset = this.currentTime;
    this.source?.stop();
    this.source = null;
    this._playing = false;
  }

  stop() {
    if (this.source) { try { this.source.stop(); } catch { /* already stopped */ } }
    this.source = null;
    this._playing = false;
  }

  get currentTime(): number {
    if (!this.ctx) return 0;
    if (!this._playing) return this.startOffset;
    return this.startOffset + (this.ctx.currentTime - this.startCtxTime) * this.speed;
  }

  getCurrentTimeGetter(): () => number {
    return () => this.currentTime;
  }
}
