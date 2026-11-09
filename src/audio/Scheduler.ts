import type { MidiData } from '../midi/MidiLoader';
import type { MidiClock } from '../midi/MidiClock';
import type { Synth, InstrumentId } from './Synth';

/**
 * Per-track cursor scheduler. On each tick walks ahead a small window and
 * schedules upcoming notes on the synth at sample-accurate AudioContext times.
 * Detects backward seeks via clock-time regression and resets cursors.
 */
const LOOK_AHEAD = 0.12; // seconds of MIDI time

export class Scheduler {
  private midi: MidiData | null = null;
  private cursors: number[] = [];
  private lastClockTime = 0;
  private wasPlaying = false;
  private synth: Synth;
  private clock: MidiClock;
  /** Per-track instrument id; defaults to 'piano' for indices past the array. */
  private trackInstruments: InstrumentId[] = [];

  constructor(synth: Synth, clock: MidiClock) {
    this.synth = synth;
    this.clock = clock;
  }

  setTrackInstruments(list: InstrumentId[]) {
    this.trackInstruments = [...list];
  }

  load(midi: MidiData) {
    this.midi = midi;
    this.cursors = midi.tracks.map(() => 0);
    this.lastClockTime = this.clock.currentTime;
  }

  unload() {
    this.midi = null;
    this.cursors = [];
    this.synth.stopAll();
  }

  /** Advance cursors to the first note >= the current clock time. */
  reset() {
    if (!this.midi) return;
    this.synth.stopAll();
    const t = this.clock.currentTime;
    this.cursors = this.midi.tracks.map(track => {
      let i = 0;
      while (i < track.notes.length && track.notes[i].time < t) i++;
      return i;
    });
    this.lastClockTime = t;
  }

  /** Call every frame from App._loop. Cheap when not playing or no MIDI. */
  tick() {
    if (!this.midi) return;
    // Once piano is loaded we have *something* to play; missing instruments stay
    // silent until lazy-load completes (they trigger a load on first use).
    if (!this.synth.ready) return;
    const playing = this.clock.playing;
    const clockTime = this.clock.currentTime;

    // Detect transitions: paused→playing means resume from current time;
    // backward seek means rewind cursors.
    if (playing && !this.wasPlaying) {
      this.reset();
    } else if (clockTime < this.lastClockTime - 0.05) {
      this.reset();
    } else if (!playing && this.wasPlaying) {
      this.synth.stopAll();
    }
    this.wasPlaying = playing;
    this.lastClockTime = clockTime;
    if (!playing) return;

    const speed = this.clock.speed || 1;
    const audioNow = this.synth.audioContext?.currentTime ?? 0;
    const windowEnd = clockTime + LOOK_AHEAD;

    for (let trackIdx = 0; trackIdx < this.midi.tracks.length; trackIdx++) {
      const track = this.midi.tracks[trackIdx];
      let i = this.cursors[trackIdx];
      while (i < track.notes.length && track.notes[i].time <= windowEnd) {
        const note = track.notes[i];
        // Convert MIDI time → AudioContext time, accounting for playback speed.
        const audioDelta = Math.max(0, (note.time - clockTime) / speed);
        const audioTime = audioNow + audioDelta;
        const audioDuration = Math.max(0.02, note.duration / speed);
        const instrument = this.trackInstruments[trackIdx] ?? 'piano';
        this.synth.playNote(note.midi, note.velocity, audioTime, audioDuration, trackIdx, instrument);
        i++;
      }
      this.cursors[trackIdx] = i;
    }
    this.synth.prune();
  }
}
