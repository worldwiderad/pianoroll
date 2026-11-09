/**
 * Multi-instrument SoundFont sampler. Wraps `soundfont-player` (fetches samples
 * from a CDN on first use of each instrument). Used when a MIDI is loaded
 * without an accompanying audio file so the piece is still audible.
 *
 * Drum is a synthesised noise-burst — pitch-independent (one tone per hit).
 */
export type InstrumentId = 'piano' | 'strings' | 'brass' | 'woodwinds' | 'synthPad' | 'synthLead' | 'drum';

/** Map of UI-facing id → MIDI-JS soundfont instrument name. */
const SF_NAME: Record<Exclude<InstrumentId, 'drum'>, string> = {
  piano:     'acoustic_grand_piano',
  strings:   'string_ensemble_1',
  brass:     'brass_section',
  woodwinds: 'clarinet',
  synthPad:  'pad_2_warm',
  synthLead: 'lead_1_square',
};

export const INSTRUMENT_LABELS: Record<InstrumentId, string> = {
  piano:     'Piano',
  strings:   'Strings',
  brass:     'Brass',
  woodwinds: 'Woodwinds',
  synthPad:  'Synth Pad',
  synthLead: 'Synth Lead',
  drum:      'Drum',
};

interface ActiveVoice {
  player: { stop: (when?: number) => void };
  trackIdx: number;
  endTime: number;
}

type SoundfontInstrument = {
  play: (note: number, when?: number, opts?: { gain?: number; duration?: number }) => { stop: (when?: number) => void };
};

export class Synth {
  audioContext: AudioContext | null = null;
  private instruments: Map<InstrumentId, SoundfontInstrument> = new Map();
  private loaders: Map<InstrumentId, Promise<SoundfontInstrument | null>> = new Map();
  private mutedTracks = new Set<number>();
  private active: ActiveVoice[] = [];
  gain = 0.8;

  /** True once piano is loaded (we always load piano for back-compat). */
  get ready() { return this.instruments.has('piano'); }
  get loading() { return this.loaders.size > 0 && this.instruments.size === 0; }

  /** Kick off loads for the given set of instruments. Safe to call repeatedly. */
  loadInstruments(ids: InstrumentId[]): Promise<void[]> {
    return Promise.all(ids.filter((v, i) => ids.indexOf(v) === i).map(id => this.ensureLoaded(id)));
  }

  /** Idempotent load of a single instrument. Drum is a no-op (synthesised on the fly). */
  ensureLoaded(id: InstrumentId): Promise<void> {
    if (id === 'drum') return Promise.resolve();
    if (this.instruments.has(id)) return Promise.resolve();
    const existing = this.loaders.get(id);
    if (existing) return existing.then(() => {});
    const p = this._doLoad(id);
    this.loaders.set(id, p);
    return p.then(() => {});
  }

  private async _doLoad(id: Exclude<InstrumentId, 'drum'>): Promise<SoundfontInstrument | null> {
    try {
      this.audioContext = this.audioContext ?? new AudioContext();
      const mod = (await import('soundfont-player')) as unknown as {
        default: { instrument: (ctx: BaseAudioContext, name: string) => Promise<SoundfontInstrument> };
      };
      const sf = mod.default ?? (mod as unknown as { instrument: (ctx: BaseAudioContext, name: string) => Promise<SoundfontInstrument> });
      const instrument = await sf.instrument(this.audioContext, SF_NAME[id]);
      this.instruments.set(id, instrument);
      return instrument;
    } catch (err) {
      console.warn(`[Synth] failed to load ${id}`, err);
      this.loaders.delete(id);
      return null;
    }
  }

  /** Back-compat: pre-loads piano. Most callers should use `loadInstruments`. */
  init(): Promise<void> { return this.ensureLoaded('piano'); }

  async resumeContext() {
    if (this.audioContext?.state === 'suspended') {
      try { await this.audioContext.resume(); } catch { /* ignore */ }
    }
  }

  /** Schedule a note for the given track's instrument. Silently no-ops if not loaded. */
  playNote(midi: number, velocity: number, when: number, duration: number, trackIdx: number, instrument: InstrumentId) {
    if (this.mutedTracks.has(trackIdx)) return;
    const gain = Math.max(0, Math.min(1, velocity * this.gain));

    if (instrument === 'drum') {
      this._playDrum(when, gain, trackIdx);
      return;
    }
    const inst = this.instruments.get(instrument);
    if (!inst) {
      // Trigger lazy load for next time; current note is silent.
      void this.ensureLoaded(instrument);
      return;
    }
    const player = inst.play(midi, when, { gain, duration });
    this.active.push({ player, trackIdx, endTime: when + duration });
  }

  /** Synthesised drum hit: white-noise + low tonal click, exponential decay. */
  private _playDrum(when: number, gain: number, trackIdx: number) {
    if (!this.audioContext) this.audioContext = new AudioContext();
    const ctx = this.audioContext;
    const len = Math.floor(ctx.sampleRate * 0.28);
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const t = i / ctx.sampleRate;
      const env = Math.exp(-t * 16);
      const noise = Math.random() * 2 - 1;
      const tone = Math.sin(2 * Math.PI * 110 * t) * 0.6;
      data[i] = (noise * 0.7 + tone) * env * gain;
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    src.start(when);
    // Adapter so `active.player.stop()` works
    const adapter = { stop: (w?: number) => { try { src.stop(w); } catch { /* */ } } };
    this.active.push({ player: adapter, trackIdx, endTime: when + 0.3 });
  }

  stopAll() {
    const now = this.audioContext?.currentTime ?? 0;
    for (const v of this.active) {
      try { v.player.stop(now); } catch { /* already stopped */ }
    }
    this.active = [];
  }

  prune() {
    if (!this.audioContext) return;
    const now = this.audioContext.currentTime;
    this.active = this.active.filter(v => v.endTime > now);
  }

  get muted(): Set<number> { return new Set(this.mutedTracks); }

  setTrackMuted(idx: number, muted: boolean) {
    if (muted) {
      this.mutedTracks.add(idx);
      const now = this.audioContext?.currentTime ?? 0;
      this.active = this.active.filter(v => {
        if (v.trackIdx === idx) { try { v.player.stop(now); } catch { /* ignore */ } return false; }
        return true;
      });
    } else {
      this.mutedTracks.delete(idx);
    }
  }
}
