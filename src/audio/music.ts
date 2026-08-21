/**
 * The adaptive score.
 *
 * A looping, key-locked bed driven by a lookahead scheduler: a 25ms interval
 * queues notes ~120ms ahead against ctx.currentTime. Notes are never fired
 * from a timer at play time — setTimeout jitter is audible on a musical grid
 * and would make the bed sound broken on a busy frame.
 *
 * Four layers enter as intensity (tower height) rises:
 *   1. pad      — always. A sustained, detuned chord.
 *   2. bass     — above 0.20. A gentle pulse.
 *   3. tick     — above 0.45. Filtered noise, never a drum sample.
 *   4. arp      — above 0.70. The melodic hook.
 * plus a master low-pass that opens from 700Hz to 14kHz across the same range.
 * Every layer crossfades with setTargetAtTime; nothing ever snaps on.
 */

import {
  clamp,
  clamp01,
  fmBell,
  midiToFreq,
  noiseBurst,
  padVoice,
  perc,
  pluck,
  type Rack,
  type Voice,
} from './synth';
import {
  bassMidi,
  padMidi,
  profileFor,
  scaleStep,
  type AmbienceProfile,
  type Chord,
  type LeadKind,
} from './theory';

const SCHEDULER_MS = 25;
const LOOKAHEAD = 0.12;
const STEPS_PER_BAR = 16;

/** Layer entry thresholds and the width of their crossfade. */
const LAYER_IN = { pad: -1, bass: 0.2, tick: 0.45, arp: 0.7 } as const;
const FADE_WIDTH = 0.16;

const CUTOFF_MIN = 700;
const CUTOFF_MAX = 14000;

function layerAmount(intensity: number, threshold: number): number {
  if (threshold < 0) return 1;
  return clamp01((intensity - threshold) / FADE_WIDTH);
}

export class MusicScheduler {
  private readonly rack: Rack;
  /** Fade/crossfade gain — owned here, upstream of the master music filter. */
  private readonly fade: GainNode;
  private readonly filter: BiquadFilterNode;

  private readonly padGain: GainNode;
  private readonly bassGain: GainNode;
  private readonly tickGain: GainNode;
  private readonly arpGain: GainNode;

  private profile: AmbienceProfile = profileFor('diner');
  private pendingProfile: AmbienceProfile | null = null;
  private swapAt = 0;

  private timer: ReturnType<typeof setInterval> | null = null;
  private step = 0;
  private nextTime = 0;
  private intensity = 0;

  /** The game asked for music. */
  private wanted = false;
  /** The player has not muted music. */
  private enabled = true;
  private stopAt: number | null = null;
  private disposed = false;

  constructor(rack: Rack, fade: GainNode, filter: BiquadFilterNode) {
    this.rack = rack;
    this.fade = fade;
    this.filter = filter;
    const ctx = rack.ctx;
    this.padGain = ctx.createGain();
    this.bassGain = ctx.createGain();
    this.tickGain = ctx.createGain();
    this.arpGain = ctx.createGain();
    this.padGain.gain.value = 1;
    this.bassGain.gain.value = 0;
    this.tickGain.gain.value = 0;
    this.arpGain.gain.value = 0;
    for (const g of [this.padGain, this.bassGain, this.tickGain, this.arpGain]) {
      g.connect(rack.musicIn);
    }
    this.filter.frequency.value = CUTOFF_MIN;
  }

  get playing(): boolean {
    return this.timer !== null;
  }

  get currentProfile(): AmbienceProfile {
    return this.profile;
  }

  // ── control ───────────────────────────────────────────────────────────────

  start(): void {
    this.wanted = true;
    this.stopAt = null;
    if (!this.enabled || this.disposed) return;
    if (this.timer !== null) return;
    const now = this.rack.ctx.currentTime;
    this.step = 0;
    this.nextTime = now + 0.08;
    const g = this.fade.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(Math.max(g.value, 0.0001), now);
    g.linearRampToValueAtTime(1, now + 0.6);
    this.applyIntensity(true);
    this.run();
  }

  stop(fadeSeconds = 0.6): void {
    this.wanted = false;
    if (this.timer === null) {
      this.halt();
      return;
    }
    const now = this.rack.ctx.currentTime;
    const g = this.fade.gain;
    const f = Math.max(0.02, fadeSeconds);
    g.cancelScheduledValues(now);
    g.setValueAtTime(Math.max(g.value, 0.0001), now);
    g.linearRampToValueAtTime(0, now + f);
    this.stopAt = now + f + 0.05;
  }

  setEnabled(v: boolean): void {
    if (this.enabled === v) return;
    this.enabled = v;
    if (!v) {
      // Silence AND stop scheduling — no CPU burnt while muted.
      this.stop(0.25);
      this.wanted = this.wanted || false;
    } else if (this.wanted) {
      this.start();
    }
  }

  setIntensity(v: number): void {
    this.intensity = clamp01(v);
    this.applyIntensity(false);
  }

  /** Swap key/tempo/voicing. Crossfades through the fade gain when playing. */
  setProfile(p: AmbienceProfile): void {
    if (p.id === this.profile.id) return;
    if (this.timer === null) {
      this.profile = p;
      this.step = 0;
      return;
    }
    const now = this.rack.ctx.currentTime;
    const g = this.fade.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(Math.max(g.value, 0.0001), now);
    g.linearRampToValueAtTime(0.0001, now + 0.4);
    this.pendingProfile = p;
    this.swapAt = now + 0.42;
  }

  suspend(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  resume(): void {
    if (this.disposed || !this.wanted || !this.enabled) return;
    if (this.timer !== null) return;
    this.nextTime = this.rack.ctx.currentTime + 0.08;
    this.run();
  }

  dispose(): void {
    this.disposed = true;
    this.halt();
    for (const g of [this.padGain, this.bassGain, this.tickGain, this.arpGain]) {
      try {
        g.disconnect();
      } catch {
        /* ignore */
      }
    }
  }

  // ── scheduling ────────────────────────────────────────────────────────────

  private run(): void {
    this.tick();
    this.timer = setInterval(() => this.tick(), SCHEDULER_MS);
  }

  private halt(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.stopAt = null;
    this.pendingProfile = null;
    this.rack.musicPool.killAll();
  }

  private applyIntensity(immediate: boolean): void {
    const now = this.rack.ctx.currentTime;
    const tc = immediate ? 0.01 : 0.35;
    const set = (g: GainNode, target: number): void => {
      try {
        g.gain.setTargetAtTime(target, now, tc);
      } catch {
        /* ignore */
      }
    };
    // The pad thins slightly as the busier layers arrive so the mix stays flat.
    set(this.padGain, 1 - 0.25 * this.intensity);
    set(this.bassGain, layerAmount(this.intensity, LAYER_IN.bass));
    set(this.tickGain, layerAmount(this.intensity, LAYER_IN.tick));
    set(this.arpGain, layerAmount(this.intensity, LAYER_IN.arp));
    const cutoff = CUTOFF_MIN * Math.pow(CUTOFF_MAX / CUTOFF_MIN, this.intensity);
    try {
      this.filter.frequency.setTargetAtTime(clamp(cutoff, 200, 20000), now, immediate ? 0.01 : 0.4);
    } catch {
      /* ignore */
    }
  }

  private get stepDur(): number {
    return 60 / this.profile.bpm / 4;
  }

  private tick(): void {
    if (this.disposed) return;
    try {
      const ctx = this.rack.ctx;
      const now = ctx.currentTime;

      if (this.pendingProfile && now >= this.swapAt) {
        this.profile = this.pendingProfile;
        this.pendingProfile = null;
        this.step = 0;
        this.nextTime = now + 0.06;
        const g = this.fade.gain;
        g.cancelScheduledValues(now);
        g.setValueAtTime(0.0001, now);
        g.linearRampToValueAtTime(1, now + 0.55);
        this.applyIntensity(false);
      }

      if (this.stopAt !== null && now >= this.stopAt) {
        this.halt();
        return;
      }

      // Re-anchor after a suspend / tab switch instead of firing a burst of
      // notes that are all already in the past.
      if (this.nextTime < now) this.nextTime = now + 0.03;

      const dur = this.stepDur;
      let guard = 0;
      while (this.nextTime < now + LOOKAHEAD && guard++ < 64) {
        this.scheduleStep(this.step, this.nextTime);
        this.nextTime += dur;
        this.step = (this.step + 1) % (STEPS_PER_BAR * 64);
      }
    } catch {
      /* a scheduler hiccup must never take the game down */
    }
  }

  private scheduleStep(step: number, time: number): void {
    const p = this.profile;
    const inBar = step % STEPS_PER_BAR;
    const bar = Math.floor(step / STEPS_PER_BAR);
    const chord = p.chords[bar % p.chords.length];
    const dur = this.stepDur;
    // Swing: odd sixteenths arrive late.
    const t = time + (inBar % 2 === 1 ? dur * p.swing : 0);

    if (inBar === 0) this.schedulePad(p, chord, time, dur * STEPS_PER_BAR);
    if (this.bassGain.gain.value > 0.02) this.scheduleBass(p, chord, inBar, t);
    if (this.tickGain.gain.value > 0.02) this.scheduleTick(p, inBar, t);
    if (this.arpGain.gain.value > 0.02) this.scheduleArp(p, inBar, t, dur);
  }

  private alloc(dest: GainNode, when: number, pan: number, keep = false): Voice {
    return this.rack.musicPool.alloc(dest, when, pan, 1, keep);
  }

  private schedulePad(p: AmbienceProfile, chord: Chord, t: number, barLen: number): void {
    const v = this.alloc(this.padGain, t, 0, true);
    const root = padMidi(p, chord);
    const attack = Math.min(p.padAttack, barLen * 0.5);
    const hold = Math.max(0.1, barLen - attack);
    for (let i = 0; i < chord.tones.length; i++) {
      padVoice(v, t + i * 0.012, {
        freq: midiToFreq(root + chord.tones[i]),
        type: p.padWave,
        detuneCents: p.padDetune,
        gain: p.padLevel * (i === 0 ? 1 : 0.78 - i * 0.08),
        attack,
        hold,
        release: p.padRelease,
        tone: p.padTone,
      });
    }
  }

  private scheduleBass(p: AmbienceProfile, chord: Chord, inBar: number, t: number): void {
    const idx = p.bassPattern[inBar];
    if (idx === undefined || idx < 0) return;
    let semis = chord.tones[Math.min(idx, chord.tones.length - 1)] ?? 0;
    if (semis > 7) semis -= 12;
    const midi = bassMidi(p, chord) + semis;
    const v = this.alloc(this.bassGain, t, 0);
    const freq = midiToFreq(midi);
    const osc = v.osc(p.bassWave, freq);
    const tone = v.biquad('lowpass', 420, 0.9);
    const amp = v.gain(0);
    osc.connect(tone);
    tone.connect(amp);
    amp.connect(v.out);
    const life = perc(amp.gain, t, p.bassLevel, 0.012, p.bassDecay);
    v.play(osc, t, life);
  }

  private scheduleTick(p: AmbienceProfile, inBar: number, t: number): void {
    const vel = p.tickPattern[inBar];
    if (!vel) return;
    const v = this.alloc(this.tickGain, t, -0.14);
    noiseBurst(this.rack, v, t, {
      kind: p.tickKind,
      type: 'bandpass',
      freq: p.tickFreq * (0.94 + this.rack.rand() * 0.12),
      q: p.tickQ,
      gain: p.tickLevel * vel,
      attack: 0.002,
      decay: p.tickDecay,
      highpass: 400,
    });
  }

  private scheduleArp(p: AmbienceProfile, inBar: number, t: number, dur: number): void {
    const idx = p.arpPattern[inBar];
    if (idx === undefined || idx < 0) return;
    const midi = p.keyMidi + p.arpOctave + scaleStep(p.scale, idx);
    const v = this.alloc(this.arpGain, t, 0.16);
    this.leadNote(v, p.lead, midi, t, p.leadLevel, dur);
  }

  /** Per-ambience instrument. This is most of what makes a theme recognisable. */
  private leadNote(
    v: Voice,
    kind: LeadKind,
    midi: number,
    t: number,
    level: number,
    stepDur: number,
  ): void {
    const freq = midiToFreq(midi);
    switch (kind) {
      case 'vibes': {
        const amp = fmBell(v, t, {
          freq,
          ratio: 4.0,
          index: freq * 0.62,
          indexDecay: 0.06,
          gain: level,
          attack: 0.005,
          decay: 0.95,
        });
        // The motor: a slow tremolo, the vibraphone's signature.
        const lfo = v.osc('sine', 5.2);
        const depth = v.gain(0.22);
        lfo.connect(depth);
        depth.connect(amp.gain);
        v.play(lfo, t, 1.05);
        break;
      }
      case 'bell':
        fmBell(v, t, {
          freq,
          ratio: 3.5,
          index: freq * 0.5,
          indexDecay: 0.08,
          gain: level,
          attack: 0.006,
          decay: 1.15,
        });
        break;
      case 'celeste': {
        const amp = v.gain(0);
        amp.connect(v.out);
        const life = perc(amp.gain, t, level, 0.004, 0.55);
        for (const [mult, g] of [
          [1, 1],
          [2, 0.35],
          [3, 0.12],
        ] as const) {
          const osc = v.osc('sine', freq * mult);
          const og = v.gain(g);
          osc.connect(og);
          og.connect(amp);
          v.play(osc, t, life);
        }
        break;
      }
      case 'koto':
        pluck(this.rack, v, t, {
          midi,
          bright: 0.8,
          sustain: 0.75,
          gain: level,
          decay: 1.75,
          tone: 5600,
        });
        break;
      case 'nylon':
        pluck(this.rack, v, t, {
          midi,
          bright: 0.35,
          sustain: 0.5,
          gain: level,
          decay: 1.25,
          tone: 3000,
        });
        break;
      case 'mandolin': {
        // Tremolo: the same string struck three times inside one step.
        const gap = Math.max(0.045, stepDur * 0.5);
        for (let i = 0; i < 3; i++) {
          pluck(this.rack, v, t + i * gap, {
            midi,
            bright: 0.9,
            sustain: 0.3,
            gain: level * (i === 0 ? 1 : 0.72),
            decay: 0.75,
            tone: 4600,
            detuneCents: i === 1 ? 4 : 0,
          });
        }
        break;
      }
      default:
        break;
    }
  }
}
