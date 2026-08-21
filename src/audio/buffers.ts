/**
 * Procedurally generated, cached AudioBuffers.
 *
 * Snackery ships zero audio assets — every sample used by the engine is
 * synthesised here at runtime and memoised. Generation is deterministic
 * (seeded PRNG) so a given buffer sounds identical across sessions.
 */

export type Rand = () => number;

/** mulberry32 — small, fast, deterministic. */
export function makeRand(seed: number): Rand {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NOISE_SECONDS = 2;
const PLUCK_CACHE_LIMIT = 72;

export class BufferCache {
  private readonly ctx: BaseAudioContext;
  private white: AudioBuffer | null = null;
  private pink: AudioBuffer | null = null;
  private silence: AudioBuffer | null = null;
  private readonly impulses = new Map<string, AudioBuffer>();
  private readonly plucks = new Map<string, AudioBuffer>();
  private readonly pluckOrder: string[] = [];

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx;
  }

  /** The 1-sample silent buffer used for the iOS unlock ritual. */
  silent(): AudioBuffer {
    if (!this.silence) this.silence = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
    return this.silence;
  }

  noise(kind: 'white' | 'pink'): AudioBuffer {
    return kind === 'pink' ? this.pinkNoise() : this.whiteNoise();
  }

  whiteNoise(): AudioBuffer {
    if (this.white) return this.white;
    const sr = this.ctx.sampleRate;
    const len = Math.max(1, Math.floor(sr * NOISE_SECONDS));
    const buf = this.ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    const rand = makeRand(0x5eed01);
    for (let i = 0; i < len; i++) d[i] = rand() * 2 - 1;
    this.white = buf;
    return buf;
  }

  /**
   * Pink (1/f) noise via the Paul Kellet approximation. Used for rumble and
   * anything that needs body rather than hiss.
   */
  pinkNoise(): AudioBuffer {
    if (this.pink) return this.pink;
    const sr = this.ctx.sampleRate;
    const len = Math.max(1, Math.floor(sr * NOISE_SECONDS));
    const buf = this.ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    const rand = makeRand(0x5eed02);
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    let b3 = 0;
    let b4 = 0;
    let b5 = 0;
    let b6 = 0;
    for (let i = 0; i < len; i++) {
      const w = rand() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      const out = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
      d[i] = Math.max(-1, Math.min(1, out * 3.2));
    }
    this.pink = buf;
    return buf;
  }

  /**
   * A short exponentially-decaying stereo noise impulse response — a small
   * bright plate. Used only by the shimmer send, built lazily on first use.
   */
  impulse(seconds = 1.1, decay = 3.4): AudioBuffer {
    const key = `${seconds.toFixed(2)}|${decay.toFixed(2)}`;
    const hit = this.impulses.get(key);
    if (hit) return hit;
    const sr = this.ctx.sampleRate;
    const len = Math.max(1, Math.floor(sr * seconds));
    const buf = this.ctx.createBuffer(2, len, sr);
    const rand = makeRand(0x5eed03);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      // A tiny pre-delay keeps the direct sound clean.
      const pre = Math.floor(sr * 0.012);
      for (let i = 0; i < len; i++) {
        if (i < pre) {
          d[i] = 0;
          continue;
        }
        const t = (i - pre) / (len - pre);
        const env = Math.pow(1 - t, decay);
        // Thin the early field so it reads as air rather than a room.
        const density = i < pre + sr * 0.05 ? 0.55 : 1;
        d[i] = (rand() * 2 - 1) * env * density;
      }
    }
    this.impulses.set(key, buf);
    return buf;
  }

  /**
   * Karplus–Strong plucked string, rendered offline into a buffer.
   *
   * A DelayNode feedback loop cannot do this honestly — a cycle in the graph
   * adds a mandatory 128-sample quantum, which caps the fundamental at ~344Hz
   * and detunes everything below it. Rendering the string by hand is both
   * cheaper at playback time and actually in tune.
   *
   * @param midi     fundamental as a MIDI note number
   * @param bright   0..1 — how raw the excitation burst is (0 = felt, 1 = nail)
   * @param sustain  0..1 — loop damping, maps to a ~0.4s..~3s decay
   */
  pluck(midi: number, bright: number, sustain: number, seconds = 1.6): AudioBuffer {
    const m = Math.round(midi);
    const b = Math.round(Math.max(0, Math.min(1, bright)) * 4) / 4;
    const s = Math.round(Math.max(0, Math.min(1, sustain)) * 4) / 4;
    const secs = Math.round(seconds * 4) / 4;
    const key = `${m}|${b}|${s}|${secs}`;
    const hit = this.plucks.get(key);
    if (hit) return hit;

    const sr = this.ctx.sampleRate;
    const freq = 440 * Math.pow(2, (m - 69) / 12);
    const n = Math.max(2, Math.round(sr / freq));
    const len = Math.max(n + 1, Math.floor(secs * sr));
    const buf = this.ctx.createBuffer(1, len, sr);
    const out = buf.getChannelData(0);

    const rand = makeRand(m * 2654435761 + Math.round(b * 977) + Math.round(s * 131));
    const line = new Float32Array(n);
    // Excitation: white noise lowpassed by (1 - bright). A dull burst gives a
    // felt-mallet koto; a raw one gives a mandolin's nail.
    const a = 0.08 + 0.9 * b;
    let lp = 0;
    for (let i = 0; i < n; i++) {
      lp += a * (rand() * 2 - 1 - lp);
      line[i] = lp;
    }
    // Remove DC so the string doesn't thud.
    let mean = 0;
    for (let i = 0; i < n; i++) mean += line[i];
    mean /= n;
    for (let i = 0; i < n; i++) line[i] -= mean;

    const g = 0.984 + 0.0145 * s;
    // A guaranteed global decay so the tail always reaches true silence.
    const tau = (0.35 + 2.2 * s) * sr;
    let p = 0;
    let peak = 0;
    for (let i = 0; i < len; i++) {
      const cur = line[p];
      const nxt = line[(p + 1) % n];
      const v = cur * Math.exp(-i / tau);
      out[i] = v;
      if (Math.abs(v) > peak) peak = Math.abs(v);
      line[p] = (cur + nxt) * 0.5 * g;
      p = (p + 1) % n;
    }
    // Normalise, then fade the last 25ms so the buffer end never clicks.
    const norm = peak > 0.0001 ? 0.92 / peak : 1;
    const fade = Math.min(len, Math.floor(sr * 0.025));
    for (let i = 0; i < len; i++) {
      const k = i > len - fade ? (len - i) / fade : 1;
      out[i] *= norm * k;
    }

    this.plucks.set(key, buf);
    this.pluckOrder.push(key);
    while (this.pluckOrder.length > PLUCK_CACHE_LIMIT) {
      const old = this.pluckOrder.shift();
      if (old !== undefined) this.plucks.delete(old);
    }
    return buf;
  }

  dispose(): void {
    this.white = null;
    this.pink = null;
    this.silence = null;
    this.impulses.clear();
    this.plucks.clear();
    this.pluckOrder.length = 0;
  }
}
