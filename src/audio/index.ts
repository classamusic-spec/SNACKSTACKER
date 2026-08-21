/**
 * Snackery audio engine — 100% runtime synthesis, zero downloaded assets.
 *
 * Bus graph
 * ─────────
 *   sfx voices ─┬─────────────────────────────┐
 *   echo wet   ─┤                             │
 *   shimmer wet─┴──► sfxBus (0.85) ───────────┤
 *                                             ├─► master (0.95) ─► limiter ─► out
 *   music voices ─► layer gains ─► musicFade ─┤
 *                   ─► musicFilter ─► musicBus (0.50)
 *
 * The limiter is a brickwall-ish DynamicsCompressorNode (threshold -6, knee 0,
 * ratio 20, attack 3ms, release 250ms), so even a pathological frame — a drop,
 * a perfect, a combo note and a collapse all at once — lands around -5.5 dBFS
 * and the master ceiling stays well under -1 dBFS.
 *
 * Every public method is wrapped: a blocked, missing or closed AudioContext
 * degrades to a silent no-op. Audio never crashes the game.
 */

import type { ThemeDef } from '../content/api';
import type { AudioEngine, SfxId, SfxOpts } from './api';
import { BufferCache, makeRand } from './buffers';
import { ComboLadder } from './combo';
import { MusicScheduler } from './music';
import { IMPACT_SFX, patchFor, patchLifetime } from './sfx';
import { VoicePool, clamp, clamp01, type Rack } from './synth';
import { ladderRootMidi, profileFor, type AmbienceProfile } from './theory';

// ── mix constants (linear) ──────────────────────────────────────────────────
const SFX_BUS_LEVEL = 0.85;
const MUSIC_BUS_LEVEL = 0.5;
const MASTER_LEVEL = 0.95;
const ECHO_WET_LEVEL = 0.5;
const SHIMMER_WET_LEVEL = 0.42;

const MAX_SFX_VOICES = 24;
const MAX_MUSIC_VOICES = 40;

/** Music dip under a sting: ~-3.6 dB. */
const DUCK_STING = 0.66;
/** Music dip under a drop: ~-2.4 dB, the constant sidechain pulse. */
const DUCK_TAP = 0.76;

// ── Safari shim ─────────────────────────────────────────────────────────────

type AudioContextCtor = new (options?: AudioContextOptions) => AudioContext;

interface LegacyWindow {
  AudioContext?: AudioContextCtor;
  webkitAudioContext?: AudioContextCtor;
}

function audioContextCtor(): AudioContextCtor | null {
  try {
    if (typeof globalThis === 'undefined') return null;
    const w = globalThis as unknown as LegacyWindow;
    return w.AudioContext ?? w.webkitAudioContext ?? null;
  } catch {
    return null;
  }
}

/**
 * Freeze an AudioParam at its current value before re-automating it.
 * cancelScheduledValues alone does not stop an in-flight setTargetAtTime.
 */
function holdParam(p: AudioParam, now: number): void {
  try {
    const v = p.value;
    if (typeof p.cancelAndHoldAtTime === 'function') {
      p.cancelAndHoldAtTime(now);
    } else {
      p.cancelScheduledValues(now);
      p.setValueAtTime(v, now);
    }
  } catch {
    try {
      p.cancelScheduledValues(now);
    } catch {
      /* ignore */
    }
  }
}

// ── the audio graph ─────────────────────────────────────────────────────────

/** Owns the context and every permanent node. Implements the Rack contract. */
class Graph implements Rack {
  readonly ctx: AudioContext;
  readonly buffers: BufferCache;
  readonly master: GainNode;
  readonly limiter: DynamicsCompressorNode;
  readonly sfxBus: GainNode;
  readonly musicBus: GainNode;
  readonly musicFade: GainNode;
  readonly musicFilter: BiquadFilterNode;
  readonly sfxPool: VoicePool;
  readonly musicPool: VoicePool;

  readonly echoSend: GainNode;
  private readonly echoDelay: DelayNode;
  private readonly echoTone: BiquadFilterNode;
  private readonly echoFeedback: GainNode;
  private readonly echoWet: GainNode;

  private shimmer: GainNode | null = null;
  private shimmerNodes: AudioNode[] = [];
  private shimmerTried = false;

  private readonly rnd = makeRand((Date.now() ^ 0x9e3779b9) >>> 0);
  private readonly profileRef: () => AmbienceProfile;

  constructor(ctx: AudioContext, profileRef: () => AmbienceProfile) {
    this.ctx = ctx;
    this.profileRef = profileRef;
    this.buffers = new BufferCache(ctx);

    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -6;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.25;
    this.limiter.connect(ctx.destination);

    this.master = ctx.createGain();
    this.master.gain.value = MASTER_LEVEL;
    this.master.connect(this.limiter);

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = SFX_BUS_LEVEL;
    this.sfxBus.connect(this.master);

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = MUSIC_BUS_LEVEL;
    this.musicBus.connect(this.master);

    this.musicFilter = ctx.createBiquadFilter();
    this.musicFilter.type = 'lowpass';
    this.musicFilter.frequency.value = 700;
    this.musicFilter.Q.value = 0.6;
    this.musicFilter.connect(this.musicBus);

    this.musicFade = ctx.createGain();
    this.musicFade.gain.value = 0;
    this.musicFade.connect(this.musicFilter);

    // 1/8-note feedback echo, shared by the combo ladder and the flourishes.
    this.echoSend = ctx.createGain();
    this.echoSend.gain.value = 1;
    this.echoDelay = ctx.createDelay(1.5);
    this.echoDelay.delayTime.value = 0.3;
    this.echoTone = ctx.createBiquadFilter();
    this.echoTone.type = 'lowpass';
    this.echoTone.frequency.value = 3400;
    this.echoTone.Q.value = 0.7;
    this.echoFeedback = ctx.createGain();
    this.echoFeedback.gain.value = 0.25;
    this.echoWet = ctx.createGain();
    this.echoWet.gain.value = ECHO_WET_LEVEL;
    this.echoSend.connect(this.echoDelay);
    this.echoDelay.connect(this.echoTone);
    this.echoTone.connect(this.echoFeedback);
    this.echoFeedback.connect(this.echoDelay);
    this.echoTone.connect(this.echoWet);
    this.echoWet.connect(this.sfxBus);

    this.sfxPool = new VoicePool(ctx, MAX_SFX_VOICES);
    this.musicPool = new VoicePool(ctx, MAX_MUSIC_VOICES);
  }

  get sfxIn(): AudioNode {
    return this.sfxBus;
  }

  get musicIn(): AudioNode {
    return this.musicFade;
  }

  keyRootMidi(): number {
    return this.profileRef().keyMidi;
  }

  bpm(): number {
    return this.profileRef().bpm;
  }

  rand(): number {
    return this.rnd();
  }

  /** Retune the echo to the theme's tempo. */
  setEighth(seconds: number): void {
    try {
      this.echoDelay.delayTime.setTargetAtTime(
        clamp(seconds, 0.02, 1.4),
        this.ctx.currentTime,
        0.05,
      );
    } catch {
      /* ignore */
    }
  }

  /**
   * The shimmer plate, built the first time something actually needs a tail.
   * A convolver running permanently is real CPU on a phone, so it does not
   * exist until an unlock, a milestone or a high combo asks for it.
   */
  shimmerSend(): GainNode | null {
    if (this.shimmer) return this.shimmer;
    if (this.shimmerTried) return null;
    this.shimmerTried = true;
    try {
      const conv = this.ctx.createConvolver();
      conv.normalize = true;
      conv.buffer = this.buffers.impulse(1.1, 3.4);
      const send = this.ctx.createGain();
      send.gain.value = 1;
      const wet = this.ctx.createGain();
      wet.gain.value = SHIMMER_WET_LEVEL;
      const hp = this.ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 500;
      send.connect(hp);
      hp.connect(conv);
      conv.connect(wet);
      wet.connect(this.sfxBus);
      this.shimmerNodes = [send, hp, conv, wet];
      this.shimmer = send;
      return send;
    } catch {
      return null;
    }
  }

  dispose(): void {
    this.sfxPool.killAll();
    this.musicPool.killAll();
    const all: AudioNode[] = [
      this.echoSend,
      this.echoDelay,
      this.echoTone,
      this.echoFeedback,
      this.echoWet,
      this.musicFade,
      this.musicFilter,
      this.musicBus,
      this.sfxBus,
      this.master,
      this.limiter,
      ...this.shimmerNodes,
    ];
    for (const n of all) {
      try {
        n.disconnect();
      } catch {
        /* ignore */
      }
    }
    this.shimmerNodes = [];
    this.shimmer = null;
    this.buffers.dispose();
  }
}

// ── the engine ──────────────────────────────────────────────────────────────

class SnackeryAudio implements AudioEngine {
  private graph: Graph | null = null;
  private music: MusicScheduler | null = null;
  private ladder: ComboLadder | null = null;

  private profile: AmbienceProfile = profileFor('diner');
  private sfxEnabled = true;
  private musicEnabled = true;
  private wantMusic = false;
  private intensity = 0;
  private unlocking: Promise<void> | null = null;
  private failed = false;
  private disposed = false;
  private manuallySuspended = false;
  private visibilityHandler: (() => void) | null = null;
  private silentSource: AudioBufferSourceNode | null = null;

  get ready(): boolean {
    const g = this.graph;
    return !!g && !this.disposed && g.ctx.state === 'running';
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Must be called from a user gesture (the first pointerdown). Idempotent,
   * never throws, and safe to call on every tap — it re-resumes a context that
   * iOS interrupted behind our back.
   */
  unlock(): Promise<void> {
    if (this.disposed || this.failed) return Promise.resolve();
    if (this.unlocking) return this.unlocking;
    const run = this.doUnlock().catch(() => undefined);
    this.unlocking = run;
    void run.then(() => {
      this.unlocking = null;
    });
    return run;
  }

  private async doUnlock(): Promise<void> {
    try {
      if (!this.graph) this.build();
      const g = this.graph;
      if (!g) return;
      if (g.ctx.state !== 'running') {
        try {
          await g.ctx.resume();
        } catch {
          /* ignore */
        }
      }
      // The iOS Safari ritual: play one silent sample from inside the gesture.
      try {
        this.releaseSilentSource();
        const src = g.ctx.createBufferSource();
        src.buffer = g.buffers.silent();
        src.onended = () => {
          try {
            src.disconnect();
          } catch {
            /* ignore */
          }
          if (this.silentSource === src) this.silentSource = null;
        };
        src.connect(g.ctx.destination);
        src.start(0);
        // The buffer is one sample long, but an explicit stop guarantees the
        // teardown even if the context is interrupted before it plays out.
        try {
          src.stop(g.ctx.currentTime + 0.05);
        } catch {
          /* ignore */
        }
        this.silentSource = src;
      } catch {
        /* ignore */
      }
      this.manuallySuspended = false;
      if (this.wantMusic && this.musicEnabled) this.music?.start();
      else this.music?.resume();
    } catch {
      /* ignore */
    }
  }

  private build(): void {
    if (this.graph || this.failed || this.disposed) return;
    try {
      const Ctor = audioContextCtor();
      if (!Ctor) {
        this.failed = true;
        return;
      }
      const ctx = new Ctor({ latencyHint: 'interactive' });
      const graph = new Graph(ctx, () => this.profile);
      this.graph = graph;
      this.ladder = new ComboLadder(graph);
      this.music = new MusicScheduler(graph, graph.musicFade, graph.musicFilter);
      this.music.setIntensity(this.intensity);
      this.music.setProfile(this.profile);
      graph.setEighth(30 / this.profile.bpm);
      graph.sfxBus.gain.value = this.sfxEnabled ? SFX_BUS_LEVEL : 0;
      graph.musicBus.gain.value = this.musicEnabled ? MUSIC_BUS_LEVEL : 0;
      if (!this.musicEnabled) this.music.setEnabled(false);
      this.installVisibilityHandler();
    } catch {
      // Autoplay policy, exhausted contexts, a locked-down webview — all of it
      // ends here, silently. The game keeps running.
      this.failed = true;
      this.graph = null;
    }
  }

  private releaseSilentSource(): void {
    const prev = this.silentSource;
    this.silentSource = null;
    if (!prev) return;
    try {
      prev.onended = null;
      prev.disconnect();
    } catch {
      /* ignore */
    }
  }

  private installVisibilityHandler(): void {
    try {
      if (this.visibilityHandler || typeof document === 'undefined') return;
      const handler = (): void => {
        try {
          if (document.hidden) {
            this.pauseContext();
          } else if (!this.manuallySuspended) {
            this.resumeContext();
          }
        } catch {
          /* ignore */
        }
      };
      this.visibilityHandler = handler;
      document.addEventListener('visibilitychange', handler);
    } catch {
      /* ignore */
    }
  }

  // ── sfx ───────────────────────────────────────────────────────────────────

  play(id: SfxId, opts?: SfxOpts): void {
    try {
      if (this.disposed || !this.sfxEnabled) return;
      const g = this.graph;
      if (!g) return;
      const delay = Math.max(0, opts?.delay ?? 0);
      // Musical timing comes from the context clock, never from setTimeout.
      const when = g.ctx.currentTime + delay + 0.004;

      if (id === 'combo') {
        this.ladder?.advance(when);
        this.duckTo(DUCK_TAP, 0.14);
        return;
      }

      const patch = patchFor(id);
      if (!patch) return;
      const gain = clamp(opts?.gain ?? 1, 0, 4);
      const pan = clamp(opts?.pan ?? 0, -1, 1);
      const mul = Math.pow(2, (opts?.pitch ?? 0) / 12);
      const voice = g.sfxPool.alloc(g.sfxIn, when, pan, gain);
      voice.endsAt = Math.max(voice.endsAt, when + patchLifetime(id));
      patch(g, voice, when, {
        mul,
        root: ladderRootMidi(this.profile.rootPc),
        eighth: 30 / this.profile.bpm,
        rand: () => g.rand(),
      });
      if (IMPACT_SFX.has(id)) {
        this.duckTo(id === 'drop' ? DUCK_TAP : DUCK_STING, id === 'drop' ? 0.1 : 0.35);
      }
    } catch {
      /* ignore */
    }
  }

  /** The pentatonic combo ladder. `combo` is 1-based; <= 1 resets it. */
  playComboNote(combo: number): void {
    try {
      if (this.disposed || !this.sfxEnabled) return;
      const g = this.graph;
      if (!g || !this.ladder) return;
      const when = g.ctx.currentTime + 0.004;
      this.ladder.play(Number.isFinite(combo) ? combo : 1, when);
      this.duckTo(DUCK_TAP, 0.12);
    } catch {
      /* ignore */
    }
  }

  // ── music ─────────────────────────────────────────────────────────────────

  setTheme(theme: ThemeDef): void {
    try {
      const next = profileFor(theme?.ambience);
      if (next.id === this.profile.id) return;
      this.profile = next;
      this.ladder?.reset();
      this.graph?.setEighth(30 / next.bpm);
      this.music?.setProfile(next);
    } catch {
      /* ignore */
    }
  }

  startMusic(): void {
    try {
      this.wantMusic = true;
      if (this.disposed || !this.musicEnabled) return;
      this.music?.start();
    } catch {
      /* ignore */
    }
  }

  stopMusic(fadeSeconds = 0.6): void {
    try {
      this.wantMusic = false;
      this.music?.stop(Math.max(0, fadeSeconds));
    } catch {
      /* ignore */
    }
  }

  setIntensity(v: number): void {
    try {
      this.intensity = clamp01(Number.isFinite(v) ? v : 0);
      this.music?.setIntensity(this.intensity);
    } catch {
      /* ignore */
    }
  }

  setSfxEnabled(v: boolean): void {
    try {
      this.sfxEnabled = !!v;
      const g = this.graph;
      if (!g) return;
      const now = g.ctx.currentTime;
      holdParam(g.sfxBus.gain, now);
      g.sfxBus.gain.setTargetAtTime(this.sfxEnabled ? SFX_BUS_LEVEL : 0, now, 0.02);
      // Fade the tails out with the bus rather than cutting them dead.
      if (!this.sfxEnabled) g.sfxPool.stealAll();
    } catch {
      /* ignore */
    }
  }

  setMusicEnabled(v: boolean): void {
    try {
      this.musicEnabled = !!v;
      const g = this.graph;
      if (g) {
        const now = g.ctx.currentTime;
        holdParam(g.musicBus.gain, now);
        g.musicBus.gain.setTargetAtTime(this.musicEnabled ? MUSIC_BUS_LEVEL : 0, now, 0.05);
      }
      // The scheduler stops entirely when muted — no CPU burnt on silence.
      this.music?.setEnabled(this.musicEnabled);
      if (this.musicEnabled && this.wantMusic) this.music?.start();
    } catch {
      /* ignore */
    }
  }

  /** Sidechain dip: fast attack, slow release. */
  duck(seconds = 0.35): void {
    this.duckTo(DUCK_STING, Math.max(0.05, seconds));
  }

  private duckTo(level: number, hold: number): void {
    try {
      const g = this.graph;
      if (!g || !this.musicEnabled) return;
      const now = g.ctx.currentTime;
      const base = MUSIC_BUS_LEVEL;
      const p = g.musicBus.gain;
      holdParam(p, now);
      p.setTargetAtTime(base * level, now, 0.012);
      p.setTargetAtTime(base, now + hold, 0.18);
    } catch {
      /* ignore */
    }
  }

  // ── transport ─────────────────────────────────────────────────────────────

  suspend(): void {
    this.manuallySuspended = true;
    this.pauseContext();
  }

  resume(): void {
    this.manuallySuspended = false;
    this.resumeContext();
  }

  private pauseContext(): void {
    try {
      this.music?.suspend();
      const g = this.graph;
      if (!g) return;
      if (g.ctx.state === 'running') void g.ctx.suspend().catch(() => undefined);
    } catch {
      /* ignore */
    }
  }

  private resumeContext(): void {
    try {
      const g = this.graph;
      if (!g || this.disposed) return;
      if (g.ctx.state !== 'running') {
        void g.ctx
          .resume()
          .then(() => {
            this.music?.resume();
          })
          .catch(() => undefined);
      } else {
        this.music?.resume();
      }
    } catch {
      /* ignore */
    }
  }

  dispose(): void {
    try {
      if (this.disposed) return;
      this.disposed = true;
      if (this.visibilityHandler && typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', this.visibilityHandler);
      }
      this.visibilityHandler = null;
      this.releaseSilentSource();
      this.music?.dispose();
      this.music = null;
      this.ladder = null;
      const g = this.graph;
      this.graph = null;
      if (g) {
        g.dispose();
        try {
          void g.ctx.close().catch(() => undefined);
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    }
  }
}

export function createAudioEngine(): AudioEngine {
  return new SnackeryAudio();
}

export type { AudioEngine, SfxId, SfxOpts } from './api';
