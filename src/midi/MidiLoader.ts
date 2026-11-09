import { Midi } from '@tonejs/midi';

export interface MidiNote {
  midi: number;
  time: number;
  duration: number;
  velocity: number;
}

export interface MidiTrack {
  name: string;
  channel: number;
  notes: MidiNote[];
}

export interface MidiData {
  duration: number;
  bpm: number;
  /** [numerator, denominator] — defaults to [4, 4] if the file declares none. */
  timeSignature: [number, number];
  tracks: MidiTrack[];
}

export async function loadMidi(file: File): Promise<MidiData> {
  const buf = await file.arrayBuffer();
  return loadMidiFromBytes(buf);
}

export function loadMidiFromBytes(buf: ArrayBuffer): MidiData {
  const midi = new Midi(buf);

  const bpm = midi.header.tempos[0]?.bpm ?? 120;
  const ts = midi.header.timeSignatures[0]?.timeSignature;
  const timeSignature: [number, number] = ts && ts.length === 2 ? [ts[0], ts[1]] : [4, 4];
  let duration = 0;

  const tracks: MidiTrack[] = midi.tracks
    .filter(t => t.notes.length > 0)
    .map((t, i) => {
      const notes = t.notes.map(n => {
        const end = n.time + n.duration;
        if (end > duration) duration = end;
        return { midi: n.midi, time: n.time, duration: n.duration, velocity: n.velocity };
      });
      return { name: t.name || `Track ${i + 1}`, channel: t.channel ?? i, notes };
    });

  return { duration, bpm, timeSignature, tracks };
}
