/**
 * Keys, scales and the per-ambience musical identity table.
 *
 * Everything tonal in the engine — the music bed, the combo ladder, the
 * unlock/newbest flourishes — reads its key from here, so a perfect drop is
 * always in tune with whatever the bed is playing.
 */

import type { ThemeDef } from '../content/api';

export type Ambience = ThemeDef['ambience'];
export type LeadKind = 'vibes' | 'koto' | 'celeste' | 'nylon' | 'bell' | 'mandolin';

/** C D E G A — the major pentatonic. The combo ladder walks this, always. */
export const MAJOR_PENTATONIC = [0, 2, 4, 7, 9];

/** Semitones above the key root for step `i` of a scale, wrapping octaves. */
export function scaleStep(scale: number[], i: number): number {
  const n = scale.length;
  if (n === 0) return 0;
  const oct = Math.floor(i / n);
  const deg = ((i % n) + n) % n;
  return scale[deg] + 12 * oct;
}

export interface Chord {
  /** Semitones above the key root. */
  root: number;
  /** Semitones above the chord root. */
  tones: number[];
}

export interface AmbienceProfile {
  id: Ambience;
  /** Pitch class of the key, 0 = C. */
  rootPc: number;
  /** MIDI note of the key root in the pad register. */
  keyMidi: number;
  bpm: number;
  /** 0..0.3 — how far odd 16ths are pushed late. */
  swing: number;
  /** Melodic scale for the arpeggio: chosen to be safe over the whole loop. */
  scale: number[];
  /** One chord per bar; the loop is `chords.length` bars long. */
  chords: Chord[];

  padWave: OscillatorType;
  padDetune: number;
  padLevel: number;
  padAttack: number;
  padRelease: number;
  padTone: number;

  bassWave: OscillatorType;
  bassLevel: number;
  bassDecay: number;
  /** 16 sixteenths; -1 = rest, otherwise an index into the chord's tones. */
  bassPattern: number[];

  tickKind: 'white' | 'pink';
  tickFreq: number;
  tickQ: number;
  tickDecay: number;
  tickLevel: number;
  /** 16 sixteenths of velocity, 0 = rest. */
  tickPattern: number[];

  lead: LeadKind;
  leadLevel: number;
  /** Semitone offset applied to every arpeggio note. */
  arpOctave: number;
  /** 16 sixteenths; -1 = rest, otherwise a scale step index. */
  arpPattern: number[];
}

const R = -1;

export const AMBIENCE_PROFILES: Record<Ambience, AmbienceProfile> = {
  /** Warm major 7ths over a brushed shuffle. Booth-in-the-corner comfortable. */
  diner: {
    id: 'diner',
    rootPc: 5,
    keyMidi: 53, // F3
    bpm: 96,
    swing: 0.16,
    scale: [0, 2, 4, 7, 9], // F major pentatonic
    chords: [
      { root: 0, tones: [0, 4, 7, 11] }, // Fmaj7
      { root: 9, tones: [0, 3, 7, 10] }, // Dm7
      { root: 2, tones: [0, 3, 7, 10] }, // Gm7
      { root: 7, tones: [0, 4, 10, 14] }, // C9
    ],
    padWave: 'triangle',
    padDetune: 7,
    padLevel: 0.1,
    padAttack: 0.9,
    padRelease: 1.5,
    padTone: 2000,
    bassWave: 'sine',
    bassLevel: 0.17,
    bassDecay: 0.45,
    bassPattern: [0, R, R, R, R, R, R, R, 2, R, R, R, R, R, 1, R],
    tickKind: 'white',
    tickFreq: 6200,
    tickQ: 0.8,
    tickDecay: 0.06,
    tickLevel: 0.05,
    tickPattern: [0.35, 0, 0.12, 0, 0.55, 0, 0.12, 0.1, 0.35, 0, 0.12, 0, 0.55, 0, 0.22, 0.14],
    lead: 'vibes',
    leadLevel: 0.075,
    arpOctave: 12,
    arpPattern: [0, R, R, 2, R, 4, R, R, 2, R, R, 5, R, 4, R, R],
  },

  /** Sparse D dorian, koto plucks, a lot of air between notes. */
  sushi: {
    id: 'sushi',
    rootPc: 2,
    keyMidi: 50, // D3
    bpm: 76,
    swing: 0,
    scale: [0, 3, 5, 7, 9, 10], // D minor pentatonic + dorian 6th
    chords: [
      { root: 0, tones: [0, 3, 7, 14] }, // Dm9
      { root: 0, tones: [0, 3, 7, 14] }, // Dm9
      { root: 5, tones: [0, 3, 7, 10] }, // Gm7
      { root: 7, tones: [0, 3, 7, 10] }, // Am7
    ],
    padWave: 'sine',
    padDetune: 4,
    padLevel: 0.095,
    padAttack: 1.6,
    padRelease: 2.2,
    padTone: 1500,
    bassWave: 'sine',
    bassLevel: 0.15,
    bassDecay: 1,
    bassPattern: [0, R, R, R, R, R, R, R, R, R, R, R, 2, R, R, R],
    tickKind: 'white',
    tickFreq: 3200,
    tickQ: 3,
    tickDecay: 0.05,
    tickLevel: 0.035,
    tickPattern: [0, 0, 0, 0, 0.4, 0, 0, 0, 0, 0, 0, 0, 0.4, 0, 0, 0.2],
    lead: 'koto',
    leadLevel: 0.1,
    arpOctave: 12,
    arpPattern: [0, R, R, R, 2, R, R, R, R, R, 4, R, R, R, R, 3],
  },

  /** Bright, bouncy A major with celeste bells on the off-beats. */
  candy: {
    id: 'candy',
    rootPc: 9,
    keyMidi: 57, // A3
    bpm: 124,
    swing: 0,
    scale: [0, 2, 4, 7, 9], // A major pentatonic
    chords: [
      { root: 0, tones: [0, 4, 7, 9] }, // A6
      { root: 9, tones: [0, 3, 7, 10] }, // F#m7
      { root: 5, tones: [0, 4, 7, 11] }, // Dmaj7
      { root: 7, tones: [0, 4, 7, 9] }, // E6
    ],
    padWave: 'triangle',
    padDetune: 9,
    padLevel: 0.085,
    padAttack: 0.45,
    padRelease: 0.9,
    padTone: 3000,
    bassWave: 'triangle',
    bassLevel: 0.15,
    bassDecay: 0.16,
    bassPattern: [0, R, 0, R, 2, R, 0, R, 0, R, 0, R, 1, R, 2, R],
    tickKind: 'white',
    tickFreq: 9000,
    tickQ: 1.2,
    tickDecay: 0.03,
    tickLevel: 0.045,
    tickPattern: [0, 0.15, 0.35, 0.15, 0.5, 0.15, 0.35, 0.2, 0, 0.15, 0.35, 0.15, 0.5, 0.2, 0.4, 0.3],
    lead: 'celeste',
    leadLevel: 0.07,
    arpOctave: 12,
    arpPattern: [0, R, 2, R, 4, R, 3, R, 2, R, 4, R, 5, R, 4, R],
  },

  /** E mixolydian, nylon plucks, a 3-3-2 syncopation under the bass. */
  taco: {
    id: 'taco',
    rootPc: 4,
    keyMidi: 52, // E3
    bpm: 108,
    swing: 0.08,
    scale: [0, 2, 4, 7, 10], // E mixolydian pentatonic
    chords: [
      { root: 0, tones: [0, 4, 7, 10] }, // E7
      { root: 5, tones: [0, 4, 7, 9] }, // A6
      { root: 10, tones: [0, 4, 7, 11] }, // Dmaj7
      { root: 0, tones: [0, 4, 7, 10] }, // E7
    ],
    padWave: 'triangle',
    padDetune: 11,
    padLevel: 0.075,
    padAttack: 0.6,
    padRelease: 1.1,
    padTone: 2200,
    bassWave: 'triangle',
    bassLevel: 0.16,
    bassDecay: 0.2,
    bassPattern: [0, R, R, 2, R, R, 0, R, 1, R, R, 2, R, R, 0, R],
    tickKind: 'white',
    tickFreq: 2400,
    tickQ: 2.5,
    tickDecay: 0.045,
    tickLevel: 0.042,
    tickPattern: [0.5, 0, 0, 0.25, 0, 0, 0.45, 0, 0.3, 0, 0, 0.25, 0, 0.3, 0, 0.2],
    lead: 'nylon',
    leadLevel: 0.09,
    arpOctave: 12,
    arpPattern: [0, R, R, 1, R, 2, R, R, 4, R, R, 3, R, 2, R, R],
  },

  /** C lydian — the #4 is the whole point. Soft, slow, sunlit. */
  breakfast: {
    id: 'breakfast',
    rootPc: 0,
    keyMidi: 48, // C3
    bpm: 88,
    swing: 0.12,
    scale: [0, 2, 4, 6, 7, 9], // C lydian pentatonic-ish
    chords: [
      { root: 0, tones: [0, 4, 7, 11] }, // Cmaj7
      { root: 2, tones: [0, 4, 7, 9] }, // D6
      { root: 9, tones: [0, 3, 7, 10] }, // Am7
      { root: 7, tones: [0, 4, 7, 9] }, // G6
    ],
    padWave: 'sine',
    padDetune: 5,
    padLevel: 0.105,
    padAttack: 1.2,
    padRelease: 1.8,
    padTone: 1900,
    bassWave: 'sine',
    bassLevel: 0.14,
    bassDecay: 0.7,
    bassPattern: [0, R, R, R, R, R, R, R, 0, R, R, R, R, R, 2, R],
    tickKind: 'white',
    tickFreq: 7000,
    tickQ: 1,
    tickDecay: 0.05,
    tickLevel: 0.032,
    tickPattern: [0.3, 0, 0, 0, 0.4, 0, 0.15, 0, 0.3, 0, 0, 0, 0.4, 0, 0.2, 0.12],
    lead: 'bell',
    leadLevel: 0.07,
    arpOctave: 12,
    arpPattern: [0, R, R, R, 2, R, R, 4, R, R, 3, R, R, 5, R, R],
  },

  /** G major with a mandolin tremolo on every arpeggio note. */
  pizza: {
    id: 'pizza',
    rootPc: 7,
    keyMidi: 55, // G3
    bpm: 112,
    swing: 0.05,
    scale: [0, 2, 4, 7, 9], // G major pentatonic
    chords: [
      { root: 0, tones: [0, 4, 7, 11] }, // Gmaj7
      { root: 9, tones: [0, 3, 7, 10] }, // Em7
      { root: 5, tones: [0, 4, 7, 11] }, // Cmaj7
      { root: 7, tones: [0, 4, 7, 9] }, // D6
    ],
    padWave: 'triangle',
    padDetune: 8,
    padLevel: 0.085,
    padAttack: 0.7,
    padRelease: 1.3,
    padTone: 2400,
    bassWave: 'sine',
    bassLevel: 0.16,
    bassDecay: 0.3,
    bassPattern: [0, R, R, R, 2, R, R, R, 0, R, R, R, 2, R, 1, R],
    tickKind: 'white',
    tickFreq: 5200,
    tickQ: 1.4,
    tickDecay: 0.04,
    tickLevel: 0.04,
    tickPattern: [0.35, 0, 0.2, 0, 0.5, 0, 0.2, 0, 0.35, 0, 0.2, 0, 0.5, 0, 0.3, 0.2],
    lead: 'mandolin',
    leadLevel: 0.075,
    arpOctave: 12,
    arpPattern: [0, R, R, R, 2, R, R, R, 4, R, R, R, 3, R, R, R],
  },
};

export function profileFor(ambience: Ambience | undefined): AmbienceProfile {
  if (ambience && ambience in AMBIENCE_PROFILES) return AMBIENCE_PROFILES[ambience];
  return AMBIENCE_PROFILES.diner;
}

/**
 * Where the combo ladder's first rung sits for a key: the key root placed in
 * whichever octave lands nearest MIDI 68 (G#4). That keeps every theme's
 * two-octave climb inside ~250Hz–1.8kHz — bright and euphoric at the top,
 * never shrill.
 */
export function ladderRootMidi(rootPc: number): number {
  let m = 60 + (((rootPc % 12) + 12) % 12);
  if (Math.abs(m + 12 - 68) < Math.abs(m - 68)) m += 12;
  return m;
}

/** Bass register root for a chord, kept within a fifth of the key. */
export function bassMidi(profile: AmbienceProfile, chord: Chord): number {
  const base = profile.keyMidi - 12;
  return chord.root > 6 ? base + chord.root - 12 : base + chord.root;
}

/** Pad register root for a chord, using the same voice-leading wrap. */
export function padMidi(profile: AmbienceProfile, chord: Chord): number {
  return chord.root > 6 ? profile.keyMidi + chord.root - 12 : profile.keyMidi + chord.root;
}
