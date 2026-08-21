/**
 * THE COMBO LADDER.
 *
 * Perfect drops walk up a C major pentatonic (C D E G A) across two octaves —
 * ten rungs — and then *hold* at the top, getting brighter and wetter instead
 * of shriller. Going higher forever would turn the best moment in the game
 * into a dog whistle; opening up the shimmer instead makes a long streak feel
 * euphoric rather than tense.
 *
 * The timbre is a soft mallet: a two-operator FM bell whose modulation index
 * collapses in ~50ms, giving a bright marimba-ish attack over a resonant sine
 * tail, layered with an octave-up sparkle whose level grows with the combo,
 * and fed to a 1/8-note feedback echo whose wet level rises with it too.
 *
 * The whole thing is key-locked to the current theme so it is always in tune
 * with the music bed underneath it.
 */

import { clamp01, fmBell, midiToFreq, noiseBurst, type Rack } from './synth';
import { MAJOR_PENTATONIC, ladderRootMidi, scaleStep } from './theory';

/** Two octaves of the pentatonic: C D E G A C D E G A. */
export const LADDER_RUNGS = MAJOR_PENTATONIC.length * 2;

export class ComboLadder {
  private readonly rack: Rack;
  /** Rung index, 0-based. Survives between calls so `play('combo')` can walk. */
  private pos = 0;

  constructor(rack: Rack) {
    this.rack = rack;
  }

  reset(): void {
    this.pos = 0;
  }

  /** Current rung, for callers that just want the next note (`play('combo')`). */
  get position(): number {
    return this.pos;
  }

  /** Semitones above the ladder root for a given rung. */
  static semitonesFor(rung: number): number {
    return scaleStep(MAJOR_PENTATONIC, Math.min(rung, LADDER_RUNGS - 1));
  }

  /** Play the note for `combo` (1-based). combo <= 1 resets to the first rung. */
  play(combo: number, when: number, panHint = 0): void {
    const c = Math.floor(combo);
    this.pos = c <= 1 ? 0 : c - 1;
    this.strike(this.pos, when, panHint);
  }

  /** Advance one rung and strike — used by `play('combo')`. */
  advance(when: number): void {
    this.pos += 1;
    this.strike(this.pos, when, 0);
  }

  private strike(pos: number, when: number, panHint: number): void {
    const rack = this.rack;
    const rung = Math.min(pos, LADDER_RUNGS - 1);
    // 0..1 across the climb, continuing to open up during the plateau.
    const climb = clamp01(rung / (LADDER_RUNGS - 1));
    const plateau = clamp01((pos - (LADDER_RUNGS - 1)) / 8);
    const heat = clamp01(climb * 0.75 + plateau * 0.25);

    const root = ladderRootMidi(rack.keyRootMidi() % 12);
    const midi = root + ComboLadder.semitonesFor(rung);
    const freq = midiToFreq(midi);

    const v = rack.sfxPool.alloc(rack.sfxIn, when, panHint, 1);

    // Mallet bell. The modulation index is scaled down as the note rises so the
    // top of the ladder stays soft rather than turning into a struck triangle.
    const brightness = 1.25 - 0.45 * climb + 0.35 * plateau;
    const amp = fmBell(v, when, {
      freq,
      ratio: 3.0,
      index: freq * brightness,
      indexDecay: 0.05,
      gain: 0.135 + 0.03 * heat,
      attack: 0.003,
      decay: 0.46 + 0.34 * heat,
      detuneCents: (rack.rand() - 0.5) * 5,
    });

    // Octave-up sparkle: quiet at combo 1, singing by combo 10+.
    const sparkleGain = 0.012 + 0.055 * heat;
    const sparkle = fmBell(v, when, {
      freq: freq * 2,
      ratio: 2.01,
      index: freq * 0.55,
      indexDecay: 0.035,
      gain: sparkleGain,
      attack: 0.002,
      decay: 0.22 + 0.3 * heat,
    });

    // A soft fifth above appears only at the plateau — the note stops climbing,
    // so the chord widens instead.
    if (plateau > 0.01) {
      fmBell(v, when, {
        freq: freq * 3,
        ratio: 2.76,
        index: freq * 0.4,
        indexDecay: 0.03,
        gain: 0.008 + 0.02 * plateau,
        attack: 0.02,
        decay: 0.5 + 0.5 * plateau,
      });
    }

    // The mallet itself: a 4ms bandpassed tick so the attack has a body.
    noiseBurst(rack, v, when, {
      kind: 'white',
      type: 'bandpass',
      freq: Math.min(freq * 4.5, 9000),
      q: 1.6,
      gain: 0.02 + 0.012 * heat,
      attack: 0.001,
      decay: 0.012,
      highpass: 1200,
    });

    // Echo + shimmer sends. Wet rises with the combo; high streaks bloom.
    const wet = 0.07 + 0.33 * heat;
    const echo = v.gain(wet);
    amp.connect(echo);
    sparkle.connect(echo);
    echo.connect(rack.echoSend);

    const shim = rack.shimmerSend();
    if (shim) {
      const sg = v.gain(0.08 + 0.32 * heat);
      amp.connect(sg);
      sparkle.connect(sg);
      sg.connect(shim);
    }
  }
}
