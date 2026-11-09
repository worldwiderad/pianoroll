import type { MidiData } from '../midi/MidiLoader';

// Simple looping demo: a few notes of varying lengths across two tracks,
// with one note always hitting the piano so effects are visible.
export function createDemoData(): MidiData {
  // Track 1: melody — C major arpeggio
  const t1 = [
    // time, dur, midi
    [0.0, 0.4, 60], [0.5, 0.4, 64], [1.0, 0.4, 67], [1.5, 0.4, 72],
    [2.0, 0.4, 71], [2.5, 0.4, 67], [3.0, 0.4, 64],
    [3.5, 0.9, 60],  // held note
    [4.5, 0.4, 65], [5.0, 0.4, 69], [5.5, 0.4, 72],
    [6.0, 0.9, 72],  // held
    [7.0, 0.4, 67], [7.5, 0.4, 64],
    [8.0, 1.2, 60],  // long held chord
    [8.0, 1.2, 64],
    [8.0, 1.2, 67],
  ].map(([time, duration, midi]) => ({ time, duration, midi, velocity: 0.85 }));

  // Track 2: bass — low notes, longer durations
  const t2 = [
    [0.0, 1.8, 48], [2.0, 1.8, 53], [4.0, 1.8, 53], [6.0, 1.8, 55], [8.0, 1.2, 48],
  ].map(([time, duration, midi]) => ({ time, duration, midi, velocity: 0.7 }));

  return {
    duration: 9.4,
    // Note interval = 0.5 s → 120 BPM quarter-note pulse.
    bpm: 120,
    timeSignature: [4, 4],
    tracks: [
      { name: 'Melody', channel: 0, notes: t1 },
      { name: 'Bass', channel: 1, notes: t2 },
    ],
  };
}
