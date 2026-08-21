/**
 * Reusable voice primitives.
 *
 * Everything the engine makes noise with is built from the handful of
 * generators below: an oscillator voice, a filtered noise burst, a pitched
 * thump, an FM bell and a Karplus–Strong pluck.
 *
 * Two invariants hold everywhere in this file:
 *   1. Every scheduled source gets an explicit `stop()` so `onended` always
 *      fires — that is the hook that disconnects the node. Nothing leaks over
 *      a 40-minute session.
 *   2. Nothing throws. A blocked or exhausted AudioContext degrades to silence.
 */

import type { BufferCache } from './buffers';

/** Smallest value usable with exponentialRampToValueAtTime. */
export const EPS = 0.0001;

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function clamp01(v: number): number {
  return clamp(v, 0, 1);
}

/** Linear gain -> dB and back, for readable mix maths. */
export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

/**
 * Percussive envelope: silent -> peak over `attack`, exponential fall to
 * silence over `decay`. Returns the total time the voice needs to stay alive.
 */
export function perc(
  p: AudioParam,
  t: number,
  peak: number,
  attack: number,
  decay: number,
): number {
  const top = Math.max(peak, EPS * 2);
  try {
    p.cancelScheduledValues(t);
    p.setValueAtTime(EPS, t);
    p.exponentialRampToValueAtTime(top, t + attack);
    p.exponentialRampToValueAtTime(EPS, t + attack + decay);
    p.setValueAtTime(0, t + attack + decay + 0.005);
  } catch {
    /* ignore */
  }
  return attack + decay + 0.02;
}

/** Slow swell: attack -> hold at peak -> release. Returns total lifetime. */
export function swell(
  p: AudioParam,
  t: number,
  peak: number,
  attack: number,
  hold: number,
  release: number,
): number {
  const top = Math.max(peak, EPS * 2);
  try {
    p.cancelScheduledValues(t);
    p.setValueAtTime(EPS, t);
    p.exponentialRampToValueAtTime(top, t + attack);
    p.setValueAtTime(top, t + attack + hold);
    p.exponentialRampToValueAtTime(EPS, t + attack + hold + release);
    p.setValueAtTime(0, t + attack + hold + release + 0.005);
  } catch {
    /* ignore */
  }
  return attack + hold + release + 0.02;
}

export function makePanner(ctx: AudioContext, pan: number): StereoPannerNode | null {
  try {
    if (typeof ctx.createStereoPanner !== 'function') return null;
    const p = ctx.createStereoPanner();
    p.pan.value = clamp(pan, -1, 1);
    return p;
  } catch {
    // Old Safari without StereoPannerNode: fall back to centre, never crash.
    return null;
  }
}

/**
 * A single sounding event. Owns every node it creates and tears the whole lot
 * down when its last source ends.
 */
export class Voice {
  /** Connect sources here. Per-call gain (SfxOpts.gain) is applied on it. */
  readonly out: GainNode;
  /** Context time this voice was scheduled to begin — the age used for stealing. */
  readonly startedAt: number;
  /** Protected voices (music pads) are never stolen. */
  readonly protectedVoice: boolean;

  private readonly ctx: AudioContext;
  private readonly pool: VoicePool;
  private readonly nodes: AudioNode[] = [];
  private readonly sources: AudioScheduledSourceNode[] = [];
  private pending = 0;
  private dead = false;
  /** Stolen voices are fading out; they no longer count against the pool. */
  private stealing = false;
  /** Latest scheduled stop time — the pool's watchdog uses it. */
  endsAt: number;

  constructor(
    pool: VoicePool,
    ctx: AudioContext,
    dest: AudioNode,
    startedAt: number,
    pan: number,
    gain: number,
    protectedVoice: boolean,
  ) {
    this.pool = pool;
    this.ctx = ctx;
    this.startedAt = startedAt;
    this.endsAt = startedAt + 0.5;
    this.protectedVoice = protectedVoice;
    this.out = ctx.createGain();
    this.out.gain.value = gain;
    let tail: AudioNode = this.out;
    if (pan !== 0) {
      const p = makePanner(ctx, pan);
      if (p) {
        this.out.connect(p);
        this.nodes.push(p);
        tail = p;
      }
    }
    tail.connect(dest);
  }

  get isDead(): boolean {
    return this.dead;
  }

  get isStealing(): boolean {
    return this.stealing;
  }

  track<T extends AudioNode>(n: T): T {
    this.nodes.push(n);
    return n;
  }

  gain(value = 0): GainNode {
    const g = this.ctx.createGain();
    g.gain.value = value;
    return this.track(g);
  }

  osc(type: OscillatorType, freq: number, detuneCents = 0): OscillatorNode {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = Math.max(0.0001, freq);
    if (detuneCents !== 0) o.detune.value = detuneCents;
    return this.track(o);
  }

  biquad(type: BiquadFilterType, freq: number, q = 1): BiquadFilterNode {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = clamp(freq, 20, 21000);
    f.Q.value = q;
    return this.track(f);
  }

  bufferSource(buffer: AudioBuffer, rate = 1): AudioBufferSourceNode {
    const s = this.ctx.createBufferSource();
    s.buffer = buffer;
    s.playbackRate.value = rate;
    return this.track(s);
  }

  delay(time: number, max = 1): DelayNode {
    const d = this.ctx.createDelay(max);
    d.delayTime.value = clamp(time, 0, max);
    return this.track(d);
  }

  /** Schedule a source and adopt its lifetime. `offset` seeks into a buffer. */
  play(src: AudioScheduledSourceNode, when: number, duration: number, offset?: number): void {
    if (this.dead) return;
    const stopAt = when + Math.max(0.01, duration);
    this.endsAt = Math.max(this.endsAt, stopAt);
    this.pending++;
    this.sources.push(src);
    src.onended = () => {
      this.pending--;
      try {
        src.disconnect();
      } catch {
        /* ignore */
      }
      if (this.pending <= 0) this.kill();
    };
    try {
      if (offset !== undefined && 'buffer' in src) {
        (src as AudioBufferSourceNode).start(when, offset);
      } else {
        src.start(when);
      }
      src.stop(stopAt);
    } catch {
      // Could not schedule — release the slot immediately.
      this.pending--;
      if (this.pending <= 0) this.kill();
    }
  }

  /**
   * Release this slot with an 18ms fade rather than a hard disconnect —
   * yanking a ringing oscillator out of the graph clicks, and stealing happens
   * exactly when the game is loudest. The voice tears itself down from the
   * resulting `onended`; the pool stops counting it immediately.
   */
  steal(now: number): void {
    if (this.dead || this.stealing) return;
    this.stealing = true;
    try {
      const g = this.out.gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(0, now + 0.018);
    } catch {
      /* ignore */
    }
    for (const s of this.sources) {
      try {
        s.stop(now + 0.025);
      } catch {
        /* ignore */
      }
    }
    // If onended never arrives (an interrupted context), the pool watchdog
    // reclaims this slot shortly after.
    this.endsAt = now + 0.05;
  }

  /** Disconnect everything and release the pool slot. Idempotent. */
  kill(): void {
    if (this.dead) return;
    this.dead = true;
    for (const n of this.nodes) {
      try {
        n.disconnect();
      } catch {
        /* ignore */
      }
    }
    this.nodes.length = 0;
    this.sources.length = 0;
    try {
      this.out.disconnect();
    } catch {
      /* ignore */
    }
    this.pool.release(this);
  }
}

/**
 * Fixed-size voice pool. A stacker fires `drop` on every tap and a collapse can
 * land a dozen impacts in one frame, so simultaneous voices are capped and the
 * oldest is stolen rather than letting the graph grow without bound.
 */
export class VoicePool {
  private readonly ctx: AudioContext;
  private readonly limit: number;
  private readonly voices: Voice[] = [];

  constructor(ctx: AudioContext, limit: number) {
    this.ctx = ctx;
    this.limit = limit;
  }

  get size(): number {
    return this.voices.length;
  }

  alloc(dest: AudioNode, when: number, pan = 0, gain = 1, protectedVoice = false): Voice {
    const now = this.ctx.currentTime;
    // Watchdog: reclaim anything whose scheduled end is well past. onended
    // normally does this, but a suspended/interrupted context can swallow it.
    let live = 0;
    for (let i = this.voices.length - 1; i >= 0; i--) {
      const v = this.voices[i];
      if (v.endsAt + 1.5 < now) {
        v.kill();
        continue;
      }
      if (!v.isStealing) live++;
    }
    if (live >= this.limit) {
      let oldest: Voice | null = null;
      for (const v of this.voices) {
        if (v.isStealing || v.protectedVoice) continue;
        if (!oldest || v.startedAt < oldest.startedAt) oldest = v;
      }
      if (!oldest) {
        // Everything is protected (a wall of music pads): take the oldest one.
        for (const v of this.voices) {
          if (v.isStealing) continue;
          if (!oldest || v.startedAt < oldest.startedAt) oldest = v;
        }
      }
      oldest?.steal(now);
    }
    // Hard ceiling. A stolen voice needs ~25ms of *context* time to fade out
    // and release itself, and context time does not advance inside a single
    // JS frame — so a caller that fires hundreds of sounds in one frame would
    // otherwise pile up fading voices without bound. Past 1.5x the pool, the
    // oldest fading voices are torn down immediately instead.
    while (this.voices.length >= Math.ceil(this.limit * 1.5)) {
      let victim: Voice | null = null;
      for (const v of this.voices) {
        if (v.isStealing) {
          victim = v;
          break;
        }
      }
      if (!victim) {
        for (const v of this.voices) {
          if (v.protectedVoice) continue;
          if (!victim || v.startedAt < victim.startedAt) victim = v;
        }
      }
      if (!victim) break;
      victim.kill();
    }
    const voice = new Voice(this, this.ctx, dest, when, pan, gain, protectedVoice);
    this.voices.push(voice);
    return voice;
  }

  /** Fade every voice out and let it clean itself up. Used when muting SFX. */
  stealAll(): void {
    const now = this.ctx.currentTime;
    for (const v of this.voices.slice()) v.steal(now);
  }

  release(v: Voice): void {
    const i = this.voices.indexOf(v);
    if (i >= 0) this.voices.splice(i, 1);
  }

  killAll(): void {
    const now = this.ctx.currentTime;
    for (const v of this.voices.slice()) {
      v.steal(now);
      v.kill();
    }
    this.voices.length = 0;
  }
}

/**
 * The shared services a patch needs. The engine implements this and hands
 * itself to the SFX table, the combo ladder and the music scheduler.
 */
export interface Rack {
  readonly ctx: AudioContext;
  readonly buffers: BufferCache;
  /** Destination for SFX voices. */
  readonly sfxIn: AudioNode;
  /** Destination for music voices. */
  readonly musicIn: AudioNode;
  readonly sfxPool: VoicePool;
  readonly musicPool: VoicePool;
  /** Send into the 1/8-note feedback echo (combo ladder, flourishes). */
  readonly echoSend: GainNode;
  /** Lazily-built shimmer/plate send. Null if it could not be created. */
  shimmerSend(): GainNode | null;
  /** MIDI note of the current theme's key root, low octave. */
  keyRootMidi(): number;
  /** Current musical tempo, so SFX flourishes sit in the groove. */
  bpm(): number;
  rand(): number;
}

// ─── primitives ─────────────────────────────────────────────────────────────

export interface NoiseOpts {
  kind?: 'white' | 'pink';
  type?: BiquadFilterType;
  freq: number;
  /** Sweep the filter to this frequency across attack+decay. */
  sweepTo?: number;
  q?: number;
  gain: number;
  attack?: number;
  decay: number;
  /** Extra fixed high-pass to keep low rumble out of small sounds. */
  highpass?: number;
  dest?: AudioNode;
  rate?: number;
}

/** Filtered noise burst — the backbone of every foley-adjacent sound here. */
export function noiseBurst(r: Rack, v: Voice, t: number, o: NoiseOpts): void {
  const buf = r.buffers.noise(o.kind ?? 'white');
  const src = v.bufferSource(buf, o.rate ?? 1);
  const filt = v.biquad(o.type ?? 'bandpass', o.freq, o.q ?? 1);
  const amp = v.gain(0);
  const attack = o.attack ?? 0.002;
  let node: AudioNode = src;
  if (o.highpass !== undefined) {
    const hp = v.biquad('highpass', o.highpass, 0.7);
    node.connect(hp);
    node = hp;
  }
  node.connect(filt);
  filt.connect(amp);
  amp.connect(o.dest ?? v.out);
  if (o.sweepTo !== undefined) {
    try {
      filt.frequency.setValueAtTime(clamp(o.freq, 20, 21000), t);
      filt.frequency.exponentialRampToValueAtTime(
        clamp(o.sweepTo, 20, 21000),
        t + attack + o.decay,
      );
    } catch {
      /* ignore */
    }
  }
  const life = perc(amp.gain, t, o.gain, attack, o.decay);
  // Random seek into the 2s noise bed so repeats never phase-lock.
  v.play(src, t, life, r.rand() * 1.5);
}

export interface ThumpOpts {
  freq: number;
  /** Frequency the pitch falls to (the "thock"). */
  drop?: number;
  dropTime?: number;
  type?: OscillatorType;
  gain: number;
  attack?: number;
  decay: number;
  dest?: AudioNode;
}

/** Pitched percussive thump with a fast downward pitch envelope. */
export function thump(v: Voice, t: number, o: ThumpOpts): void {
  const osc = v.osc(o.type ?? 'triangle', o.freq);
  const amp = v.gain(0);
  osc.connect(amp);
  amp.connect(o.dest ?? v.out);
  if (o.drop !== undefined) {
    try {
      osc.frequency.setValueAtTime(Math.max(20, o.freq), t);
      osc.frequency.exponentialRampToValueAtTime(
        Math.max(20, o.drop),
        t + (o.dropTime ?? 0.055),
      );
    } catch {
      /* ignore */
    }
  }
  const life = perc(amp.gain, t, o.gain, o.attack ?? 0.003, o.decay);
  v.play(osc, t, life);
}

export interface BellOpts {
  freq: number;
  /** Non-integer ratios give inharmonic, bell-like partials. */
  ratio?: number;
  /** Peak modulation depth in Hz. */
  index?: number;
  indexDecay?: number;
  gain: number;
  attack?: number;
  decay: number;
  detuneCents?: number;
  dest?: AudioNode;
}

/**
 * Two-operator FM bell. A fast-decaying modulation index gives the bright
 * mallet attack; the carrier alone rings out as a soft, resonant tail.
 */
export function fmBell(v: Voice, t: number, o: BellOpts): GainNode {
  const ratio = o.ratio ?? 3.01;
  const index = o.index ?? o.freq * 1.4;
  const carrier = v.osc('sine', o.freq, o.detuneCents ?? 0);
  const mod = v.osc('sine', o.freq * ratio);
  const modAmt = v.gain(index);
  const amp = v.gain(0);
  mod.connect(modAmt);
  modAmt.connect(carrier.frequency);
  carrier.connect(amp);
  amp.connect(o.dest ?? v.out);
  try {
    modAmt.gain.setValueAtTime(Math.max(index, EPS), t);
    modAmt.gain.exponentialRampToValueAtTime(
      Math.max(index * 0.02, EPS),
      t + (o.indexDecay ?? 0.08),
    );
  } catch {
    /* ignore */
  }
  const life = perc(amp.gain, t, o.gain, o.attack ?? 0.004, o.decay);
  v.play(carrier, t, life);
  v.play(mod, t, life);
  return amp;
}

export interface PluckOpts {
  midi: number;
  /** 0 = felt mallet, 1 = fingernail. */
  bright?: number;
  /** 0 = damped, 1 = ringing. */
  sustain?: number;
  gain: number;
  decay?: number;
  detuneCents?: number;
  /** Body/tone lowpass. */
  tone?: number;
  dest?: AudioNode;
}

/** Karplus–Strong string, played from a cached offline-rendered buffer. */
export function pluck(r: Rack, v: Voice, t: number, o: PluckOpts): void {
  const bright = o.bright ?? 0.6;
  const sustain = o.sustain ?? 0.5;
  const seconds = o.decay ?? 1.5;
  const buf = r.buffers.pluck(o.midi, bright, sustain, seconds);
  const rate = o.detuneCents ? Math.pow(2, o.detuneCents / 1200) : 1;
  const src = v.bufferSource(buf, rate);
  const tone = v.biquad('lowpass', o.tone ?? 4200, 0.7);
  const amp = v.gain(0);
  src.connect(tone);
  tone.connect(amp);
  amp.connect(o.dest ?? v.out);
  const life = seconds / rate;
  try {
    amp.gain.setValueAtTime(Math.max(o.gain, EPS), t);
    amp.gain.setValueAtTime(Math.max(o.gain, EPS), t + life * 0.85);
    amp.gain.exponentialRampToValueAtTime(EPS, t + life);
  } catch {
    /* ignore */
  }
  v.play(src, t, life + 0.02);
}

export interface PadOpts {
  freq: number;
  type?: OscillatorType;
  detuneCents?: number;
  gain: number;
  attack: number;
  hold: number;
  release: number;
  tone?: number;
  dest?: AudioNode;
}

/** Sustained detuned pair — the music bed's pad and the "milestone" chord. */
export function padVoice(v: Voice, t: number, o: PadOpts): void {
  const det = o.detuneCents ?? 6;
  const amp = v.gain(0);
  const tone = v.biquad('lowpass', o.tone ?? 2600, 0.6);
  tone.connect(amp);
  amp.connect(o.dest ?? v.out);
  const life = swell(amp.gain, t, o.gain, o.attack, o.hold, o.release);
  for (const cents of [-det, det]) {
    const osc = v.osc(o.type ?? 'triangle', o.freq, cents);
    osc.connect(tone);
    v.play(osc, t, life);
  }
}
