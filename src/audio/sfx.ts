/**
 * The SfxId -> patch table.
 *
 * House style, per the design bible: soft, foley-adjacent, never beepy.
 * Nothing here is a raw oscillator with a square wave and an instant attack.
 * Impacts have a body resonance, bells have air, and losing sounds like "aw"
 * rather than a punishment buzzer.
 *
 * Gain staging (linear, measured at the voice output before the SFX bus):
 *   drop ~0.36 peak · perfect ~0.21 · combo note ~0.24 · collapse ~0.30
 *   sfxBus 0.85 x master 0.95 => a drop + a perfect + a full music bed
 *   sums to ~0.62, comfortably inside the limiter's -6dB threshold and far
 *   under 0 dBFS.
 */

import type { SfxId } from './api';
import {
  clamp,
  fmBell,
  midiToFreq,
  noiseBurst,
  padVoice,
  perc,
  pluck,
  swell,
  thump,
  type Rack,
  type Voice,
} from './synth';
import { MAJOR_PENTATONIC, scaleStep } from './theory';

export interface PatchCtx {
  /** Frequency multiplier derived from SfxOpts.pitch (2 ** (pitch / 12)). */
  mul: number;
  /** MIDI root of the current theme's key — musical flourishes lock to it. */
  root: number;
  /** Seconds per eighth note at the current tempo. */
  eighth: number;
  rand(): number;
}

export type SfxPatch = (r: Rack, v: Voice, t: number, c: PatchCtx) => void;

/** Anything that reads as an impact and should sidechain the music. */
export const IMPACT_SFX: ReadonlySet<SfxId> = new Set<SfxId>([
  'drop',
  'perfect',
  'fall',
  'fail',
  'collapse',
]);

function send(v: Voice, from: AudioNode, to: AudioNode | null, amount: number): void {
  if (!to || amount <= 0) return;
  const g = v.gain(amount);
  from.connect(g);
  g.connect(to);
}

/** A tiny high "air" sparkle — the top-end dust on bells and flourishes. */
function airSparkle(r: Rack, v: Voice, t: number, gain: number): void {
  noiseBurst(r, v, t, {
    kind: 'white',
    type: 'bandpass',
    freq: 8600,
    q: 1.8,
    gain,
    attack: 0.004,
    decay: 0.07,
    highpass: 4000,
  });
}

/** One small wooden impact — shared by `drop` and the collapse scatter. */
function woodImpact(
  r: Rack,
  v: Voice,
  t: number,
  freq: number,
  level: number,
  dest?: AudioNode,
): void {
  thump(v, t, {
    freq,
    drop: freq * 0.42,
    dropTime: 0.05,
    type: 'triangle',
    gain: level,
    attack: 0.003,
    decay: 0.1,
    dest,
  });
  noiseBurst(r, v, t, {
    kind: 'white',
    type: 'bandpass',
    freq: freq * 17,
    q: 0.9,
    gain: level * 0.3,
    attack: 0.001,
    decay: 0.022,
    dest,
  });
  noiseBurst(r, v, t, {
    kind: 'white',
    type: 'bandpass',
    freq: freq * 2.65,
    q: 4.5,
    gain: level * 0.33,
    attack: 0.002,
    decay: 0.125,
    dest,
  });
}

/** A single flourish note: soft mallet bell, key-locked, with optional shimmer. */
function flourishNote(
  r: Rack,
  v: Voice,
  t: number,
  midi: number,
  gain: number,
  decay: number,
  shimmer: number,
): void {
  const freq = midiToFreq(midi);
  const amp = fmBell(v, t, {
    freq,
    ratio: 3.01,
    index: freq * 1.15,
    indexDecay: 0.05,
    gain,
    attack: 0.004,
    decay,
  });
  send(v, amp, r.shimmerSend(), shimmer);
  send(v, amp, r.echoSend, shimmer * 0.5);
}

export const PATCHES: Record<Exclude<SfxId, 'combo'>, SfxPatch> = {
  /**
   * A muted wooden thock. Pitched body with a fast downward pitch envelope,
   * a very short filtered noise transient for the contact, and a bandpassed
   * body resonance so it sounds like a slab landing on a board rather than a
   * sine blip. Pitch wobbles +/-6% per call so a run of taps never machine-guns.
   */
  drop(r, v, t, c) {
    const wobble = 0.94 + c.rand() * 0.12;
    const f = 152 * c.mul * wobble;
    thump(v, t, {
      freq: f,
      drop: f * 0.42,
      dropTime: 0.055,
      type: 'triangle',
      gain: 0.24,
      attack: 0.003,
      decay: 0.105,
    });
    // Sub weight, felt more than heard on a phone speaker.
    thump(v, t, {
      freq: f * 0.5,
      type: 'sine',
      gain: 0.09,
      attack: 0.004,
      decay: 0.085,
    });
    noiseBurst(r, v, t, {
      kind: 'white',
      type: 'bandpass',
      freq: 2600 * wobble,
      q: 0.9,
      gain: 0.065,
      attack: 0.001,
      decay: 0.022,
      highpass: 900,
    });
    noiseBurst(r, v, t, {
      kind: 'white',
      type: 'bandpass',
      freq: 400 * c.mul * wobble,
      q: 4.5,
      gain: 0.075,
      attack: 0.002,
      decay: 0.13,
    });
  },

  /** A filtered noise *shk*: bandpass sweeping 2k -> 6k, gone in 90ms. */
  slice(r, v, t, c) {
    const wobble = 0.92 + c.rand() * 0.16;
    noiseBurst(r, v, t, {
      kind: 'white',
      type: 'bandpass',
      freq: 2000 * c.mul * wobble,
      sweepTo: 6000 * c.mul * wobble,
      q: 1.6,
      gain: 0.155,
      attack: 0.004,
      decay: 0.085,
      highpass: 900,
    });
    // A whisper of low body so the blade has a handle.
    noiseBurst(r, v, t, {
      kind: 'pink',
      type: 'bandpass',
      freq: 700 * c.mul,
      q: 2,
      gain: 0.035,
      attack: 0.003,
      decay: 0.045,
    });
  },

  /** FM bell partial at a non-integer ratio, plus a tiny air sparkle. */
  perfect(r, v, t, c) {
    const f = 880 * c.mul;
    const amp = fmBell(v, t, {
      freq: f,
      ratio: 2.76,
      index: f * 0.36,
      indexDecay: 0.11,
      gain: 0.14,
      attack: 0.004,
      decay: 0.52,
    });
    // Warm sub-partial keeps it from sounding thin and glassy.
    fmBell(v, t, {
      freq: f * 0.5,
      ratio: 2.01,
      index: f * 0.1,
      indexDecay: 0.09,
      gain: 0.05,
      attack: 0.005,
      decay: 0.38,
    });
    airSparkle(r, v, t, 0.032);
    send(v, amp, r.shimmerSend(), 0.16);
  },

  /** Soft downward whoosh, then a distant muffled thud. */
  fall(r, v, t, c) {
    noiseBurst(r, v, t, {
      kind: 'pink',
      type: 'lowpass',
      freq: 1800 * c.mul,
      sweepTo: 220 * c.mul,
      q: 3,
      gain: 0.125,
      attack: 0.06,
      decay: 0.44,
    });
    const thudAt = t + 0.42;
    thump(v, thudAt, {
      freq: 92 * c.mul,
      drop: 48 * c.mul,
      dropTime: 0.07,
      type: 'sine',
      gain: 0.14,
      attack: 0.006,
      decay: 0.2,
    });
    noiseBurst(r, v, thudAt, {
      kind: 'pink',
      type: 'lowpass',
      freq: 320,
      q: 1.2,
      gain: 0.08,
      attack: 0.004,
      decay: 0.22,
    });
  },

  /**
   * Losing. A warm detuned pair sagging a minor third, low-passed, with an
   * octave underneath. It is a sigh, not a buzzer.
   */
  fail(r, v, t, c) {
    const f = 330 * c.mul;
    const tone = v.biquad('lowpass', 1500, 0.9);
    const amp = v.gain(0);
    tone.connect(amp);
    amp.connect(v.out);
    const life = swell(amp.gain, t, 0.16, 0.03, 0.16, 0.72);
    for (const cents of [-9, 9]) {
      const osc = v.osc('triangle', f, cents);
      try {
        osc.frequency.setValueAtTime(f, t);
        osc.frequency.exponentialRampToValueAtTime(f * 0.595, t + 0.6);
      } catch {
        /* ignore */
      }
      osc.connect(tone);
      v.play(osc, t, life);
    }
    const sub = v.osc('sine', f * 0.5);
    const subAmp = v.gain(0);
    sub.connect(subAmp);
    subAmp.connect(v.out);
    try {
      sub.frequency.setValueAtTime(f * 0.5, t);
      sub.frequency.exponentialRampToValueAtTime(f * 0.297, t + 0.6);
    } catch {
      /* ignore */
    }
    const subLife = swell(subAmp.gain, t, 0.07, 0.04, 0.2, 0.6);
    v.play(sub, t, subLife);
    void r;
  },

  /** Low rumble plus a scatter of small impacts across ~700ms. */
  collapse(r, v, t, c) {
    const rumble = v.gain(1);
    rumble.connect(v.out);
    noiseBurst(r, v, t, {
      kind: 'pink',
      type: 'lowpass',
      freq: 240 * c.mul,
      sweepTo: 90,
      q: 2.2,
      gain: 0.2,
      attack: 0.035,
      decay: 0.68,
      dest: rumble,
    });
    thump(v, t, {
      freq: 120 * c.mul,
      drop: 44,
      dropTime: 0.3,
      type: 'sine',
      gain: 0.13,
      attack: 0.01,
      decay: 0.55,
      dest: rumble,
    });
    // The debris. All of it lives inside this one voice so a collapse costs a
    // single pool slot no matter how many pieces hit the floor.
    const pieces = 9;
    for (let i = 0; i < pieces; i++) {
      const at = t + 0.02 + Math.pow(r.rand(), 0.7) * 0.6;
      const f = (110 + r.rand() * 170) * c.mul;
      woodImpact(r, v, at, f, 0.055 + r.rand() * 0.05);
    }
    const amp = v.gain(0.5);
    rumble.connect(amp);
    send(v, amp, r.shimmerSend(), 0.1);
  },

  /** iOS-tick territory: a tiny sine pip with an 8ms envelope. */
  ui_tap(r, v, t, c) {
    const f = 1800 * c.mul;
    const osc = v.osc('sine', f);
    const amp = v.gain(0);
    const tone = v.biquad('lowpass', 5200, 0.7);
    osc.connect(tone);
    tone.connect(amp);
    amp.connect(v.out);
    try {
      osc.frequency.setValueAtTime(f, t);
      osc.frequency.exponentialRampToValueAtTime(f * 0.82, t + 0.02);
    } catch {
      /* ignore */
    }
    const life = perc(amp.gain, t, 0.085, 0.0015, 0.0085);
    v.play(osc, t, life);
    noiseBurst(r, v, t, {
      kind: 'white',
      type: 'bandpass',
      freq: 4200,
      q: 1.4,
      gain: 0.022,
      attack: 0.0008,
      decay: 0.006,
      highpass: 2000,
    });
  },

  /** The tap, a perfect fourth lower. Reads as "backwards". */
  ui_back(r, v, t, c) {
    PATCHES.ui_tap(r, v, t, { ...c, mul: c.mul * Math.pow(2, -5 / 12) });
  },

  /** Two pips — the state changed. */
  ui_toggle(r, v, t, c) {
    PATCHES.ui_tap(r, v, t, { ...c, mul: c.mul * Math.pow(2, -3 / 12) });
    PATCHES.ui_tap(r, v, t + 0.045, { ...c, mul: c.mul * Math.pow(2, 1 / 12) });
  },

  /** Two quick ascending pips, bright bell timbre. */
  coin(r, v, t, c) {
    const base = 1046.5 * c.mul;
    const a = fmBell(v, t, {
      freq: base,
      ratio: 3.5,
      index: base * 0.3,
      indexDecay: 0.04,
      gain: 0.095,
      attack: 0.003,
      decay: 0.18,
    });
    const b = fmBell(v, t + 0.075, {
      freq: base * 1.5,
      ratio: 3.5,
      index: base * 0.34,
      indexDecay: 0.04,
      gain: 0.09,
      attack: 0.003,
      decay: 0.26,
    });
    airSparkle(r, v, t + 0.075, 0.025);
    send(v, a, r.shimmerSend(), 0.1);
    send(v, b, r.shimmerSend(), 0.16);
  },

  /** Four-note pentatonic flourish with a shimmer tail. Something was earned. */
  unlock(r, v, t, c) {
    const steps = [0, 2, 3, 5];
    const gap = Math.max(0.055, c.eighth * 0.36);
    for (let i = 0; i < steps.length; i++) {
      const midi = c.root + scaleStep(MAJOR_PENTATONIC, steps[i]);
      const last = i === steps.length - 1;
      flourishNote(
        r,
        v,
        t + i * gap,
        midi,
        (last ? 0.11 : 0.085) * c.mul,
        last ? 1.15 : 0.42,
        last ? 0.4 : 0.18,
      );
    }
    airSparkle(r, v, t + steps.length * gap, 0.03);
  },

  /** Warmer, slower sibling of `unlock` — a purchase should feel considered. */
  purchase(r, v, t, c) {
    const steps = [0, 1, 2, 4];
    const gap = Math.max(0.07, c.eighth * 0.46);
    for (let i = 0; i < steps.length; i++) {
      const midi = c.root + scaleStep(MAJOR_PENTATONIC, steps[i]);
      const last = i === steps.length - 1;
      flourishNote(
        r,
        v,
        t + i * gap,
        midi,
        (last ? 0.1 : 0.075) * c.mul,
        last ? 1.4 : 0.5,
        last ? 0.45 : 0.2,
      );
    }
    // A soft pad underneath so it lands rather than tinkles away.
    padVoice(v, t, {
      freq: midiToFreq(c.root - 12),
      type: 'triangle',
      detuneCents: 7,
      gain: 0.055,
      attack: 0.18,
      hold: 0.5,
      release: 0.9,
      tone: 1600,
    });
  },

  /** A warm chord swell — a course cleared, not a fanfare. */
  milestone(r, v, t, c) {
    const tones = [0, 7, 16, 26];
    for (let i = 0; i < tones.length; i++) {
      padVoice(v, t + i * 0.035, {
        freq: midiToFreq(c.root - 12 + tones[i]) * c.mul,
        type: i > 1 ? 'sine' : 'triangle',
        detuneCents: 6 - i,
        gain: 0.055 - i * 0.007,
        attack: 0.26,
        hold: 0.5,
        release: 1.05,
        tone: 2400 + i * 700,
      });
    }
    airSparkle(r, v, t + 0.24, 0.022);
    const bell = fmBell(v, t + 0.1, {
      freq: midiToFreq(c.root + 16) * c.mul,
      ratio: 2.76,
      index: 220,
      indexDecay: 0.1,
      gain: 0.05,
      attack: 0.02,
      decay: 1.1,
    });
    send(v, bell, r.shimmerSend(), 0.3);
  },

  /** Bright rising pentatonic run across two octaves with a long tail. */
  newbest(r, v, t, c) {
    const steps = [0, 1, 2, 3, 4, 5, 7];
    const gap = Math.max(0.05, c.eighth * 0.3);
    for (let i = 0; i < steps.length; i++) {
      const midi = c.root + scaleStep(MAJOR_PENTATONIC, steps[i]);
      const last = i === steps.length - 1;
      flourishNote(
        r,
        v,
        t + i * gap,
        midi,
        (0.055 + i * 0.008) * c.mul,
        last ? 1.9 : 0.36,
        last ? 0.55 : 0.14 + i * 0.03,
      );
    }
    airSparkle(r, v, t + steps.length * gap, 0.035);
    padVoice(v, t + 0.05, {
      freq: midiToFreq(c.root - 12),
      type: 'triangle',
      detuneCents: 8,
      gain: 0.05,
      attack: 0.3,
      hold: 0.7,
      release: 1.3,
      tone: 1500,
    });
  },

  /** Filtered noise with a resonant sweep — movement, not a sound effect. */
  whoosh(r, v, t, c) {
    noiseBurst(r, v, t, {
      kind: 'pink',
      type: 'bandpass',
      freq: 380 * c.mul,
      sweepTo: 2700 * c.mul,
      q: 5,
      gain: 0.115,
      attack: 0.085,
      decay: 0.22,
    });
    noiseBurst(r, v, t + 0.02, {
      kind: 'white',
      type: 'highpass',
      freq: 2400 * c.mul,
      q: 0.8,
      gain: 0.03,
      attack: 0.09,
      decay: 0.18,
    });
  },

  /** A neutral pip. Deliberately says nothing about whether this is good news. */
  countdown(r, v, t, c) {
    const f = 880 * c.mul;
    const osc = v.osc('sine', f);
    const tone = v.biquad('lowpass', 3200, 0.7);
    const amp = v.gain(0);
    osc.connect(tone);
    tone.connect(amp);
    amp.connect(v.out);
    const life = perc(amp.gain, t, 0.105, 0.012, 0.16);
    v.play(osc, t, life);
    const harm = v.osc('sine', f * 2);
    const hAmp = v.gain(0);
    harm.connect(hAmp);
    hAmp.connect(v.out);
    const hLife = perc(hAmp.gain, t, 0.022, 0.01, 0.1);
    v.play(harm, t, hLife);
    void r;
  },
};

export function patchFor(id: SfxId): SfxPatch | null {
  if (id === 'combo') return null; // routed through the combo ladder instead
  const p = PATCHES[id];
  return p ?? null;
}

/** How much headroom each patch needs before the voice is reclaimed. */
export function patchLifetime(id: SfxId): number {
  switch (id) {
    case 'collapse':
      return 1.2;
    case 'fall':
    case 'fail':
      return 1.4;
    case 'unlock':
    case 'purchase':
    case 'milestone':
      return 2.4;
    case 'newbest':
      return 3;
    default:
      return 0.8;
  }
}

export { clamp };
