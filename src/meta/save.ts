/**
 * Persistence for `SaveData`: load -> migrate -> validate -> debounced write.
 *
 * Two rules drive everything in this file:
 *   1. A player must never lose the app to a bad blob. Anything we cannot make
 *      sense of degrades to a fresh default save; nothing here may throw.
 *   2. A 60-layer run must not hammer storage. Writes are debounced ~250ms and
 *      flushed synchronously on `save()` and on page hide.
 */
import { readJson, removeKey, writeJson } from '../core/storage';
import { DEFAULT_SETTINGS } from '../core/types';
import type { Settings, SkuId, ThemeId } from '../core/types';
import type { SaveData } from './api';
import { FREE_THEME, isSkuId, isThemeId, skuFor, sortSkus } from './catalog';

export const SAVE_KEY = 'snackery.save.v1';

/** Bump when the shape changes, and add the matching step to MIGRATIONS. */
export const SAVE_VERSION = 1;

const WRITE_DEBOUNCE_MS = 250;
const DAY_MS = 86_400_000;

/** Clamps. Generous enough to never bite a real player, tight enough to make a
 *  hand-edited or corrupted blob harmless. */
export const LIMITS = Object.freeze({
  score: 1_000_000_000,
  layers: 1_000_000,
  coins: 1_000_000_000,
  runs: 10_000_000,
  combo: 100_000,
  streak: 3_650,
  heightCm: 10_000_000,
});

type RawSave = Record<string, unknown>;

function isRecord(v: unknown): v is RawSave {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function num(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

export function defaultSave(now: number = Date.now()): SaveData {
  return {
    version: SAVE_VERSION,
    best: 0,
    bestLayers: 0,
    coins: 0,
    runs: 0,
    totalLayers: 0,
    totalPerfects: 0,
    longestCombo: 0,
    owned: [FREE_THEME],
    selectedTheme: FREE_THEME,
    bestByTheme: {},
    settings: { ...DEFAULT_SETTINGS },
    seenTutorial: false,
    firstSeenAt: now,
    lastPlayedAt: 0,
    streak: 0,
  };
}

/* --------------------------------------------------------------- migration */

type Migration = (raw: RawSave) => RawSave;

/**
 * Ordered chain: key `n` upgrades a version-`n` blob to version `n + 1`.
 * Each step is dumb and total — it may only reshape fields, never throw, and
 * never assume the input is sane (validation runs afterwards and cleans up).
 *
 * Adding v2 later is one entry here plus `SAVE_VERSION = 2`.
 */
const MIGRATIONS: Readonly<Record<number, Migration>> = {
  // 0 -> 1: unversioned pre-release blobs. Best-effort aliasing of the field
  // names those builds used; anything unrecognised is dropped by validation.
  0: (raw) => ({
    ...raw,
    best: raw.best ?? raw.highScore ?? raw.bestScore,
    bestLayers: raw.bestLayers ?? raw.highLayers,
    owned: raw.owned ?? raw.purchases ?? raw.unlocked,
    selectedTheme: raw.selectedTheme ?? raw.theme,
  }),
};

export function migrate(input: RawSave): RawSave {
  let out: RawSave = { ...input };
  let v = Number.isFinite(out.version as number) ? Math.floor(out.version as number) : 0;
  if (v < 0) v = 0;
  // A save from a NEWER build is left alone rather than downgraded; validation
  // keeps the fields we understand and the next write re-stamps our version.
  let guard = 0;
  while (v < SAVE_VERSION && guard++ < 64) {
    const step = MIGRATIONS[v];
    out = step ? { ...out, ...step(out) } : out;
    v += 1;
    out.version = v;
  }
  return out;
}

/* -------------------------------------------------------------- validation */

/**
 * Coerce anything into a valid `Settings`.
 *
 * `base` supplies the fallback for every key we cannot make sense of. Loading a
 * save passes the defaults, so a settings key added in a later build appears
 * automatically; `setSetting` passes the *current* settings, so one bad value
 * leaves the rest — and that key — exactly as they were.
 */
export function validateSettings(input: unknown, base: Settings = DEFAULT_SETTINGS): Settings {
  const out: Settings = { ...DEFAULT_SETTINGS, ...base };
  if (!isRecord(input)) return out;
  out.sfx = bool(input.sfx, out.sfx);
  out.music = bool(input.music, out.music);
  out.haptics = bool(input.haptics, out.haptics);
  out.reducedMotion = bool(input.reducedMotion, out.reducedMotion);
  out.leftHanded = bool(input.leftHanded, out.leftHanded);
  const q = input.quality;
  if (q === 'auto' || q === 'low' || q === 'medium' || q === 'high') out.quality = q;
  return out;
}

/**
 * Turn anything at all into a `SaveData` we are willing to run the game on.
 * Every number is clamped, every id is checked against the catalogue, and every
 * settings key falls back to its default so new settings appear automatically.
 */
export function validateSave(input: unknown, now: number = Date.now()): SaveData {
  const base = defaultSave(now);
  if (!isRecord(input)) return base;

  let raw: RawSave;
  try {
    raw = migrate(input);
  } catch {
    return base;
  }

  // Entitlements: known SKUs only, diner always, bundles imply their contents.
  const owned = new Set<SkuId>([FREE_THEME]);
  if (Array.isArray(raw.owned)) {
    for (const entry of raw.owned) if (isSkuId(entry)) owned.add(entry);
  }
  for (const id of [...owned]) {
    for (const granted of skuFor(id)?.grants ?? []) if (isSkuId(granted)) owned.add(granted);
  }

  // A theme you do not own can never be the selected one.
  let selectedTheme: ThemeId = isThemeId(raw.selectedTheme) ? raw.selectedTheme : FREE_THEME;
  if (!owned.has(selectedTheme)) selectedTheme = FREE_THEME;

  const bestByTheme: Partial<Record<ThemeId, number>> = {};
  if (isRecord(raw.bestByTheme)) {
    for (const [key, value] of Object.entries(raw.bestByTheme)) {
      if (isThemeId(key)) bestByTheme[key] = num(value, 0, 0, LIMITS.score);
    }
  }

  const firstSeenAt = num(raw.firstSeenAt, now, 1, Number.MAX_SAFE_INTEGER);
  const lastPlayedAt = num(raw.lastPlayedAt, 0, 0, Number.MAX_SAFE_INTEGER);

  return {
    version: SAVE_VERSION,
    best: num(raw.best, 0, 0, LIMITS.score),
    bestLayers: num(raw.bestLayers, 0, 0, LIMITS.layers),
    coins: num(raw.coins, 0, 0, LIMITS.coins),
    runs: num(raw.runs, 0, 0, LIMITS.runs),
    totalLayers: num(raw.totalLayers, 0, 0, LIMITS.layers * 1000),
    totalPerfects: num(raw.totalPerfects, 0, 0, LIMITS.layers * 1000),
    longestCombo: num(raw.longestCombo, 0, 0, LIMITS.combo),
    owned: sortSkus(owned),
    selectedTheme,
    bestByTheme,
    settings: validateSettings(raw.settings),
    seenTutorial: bool(raw.seenTutorial, false),
    // A clock that reads before the epoch or wildly in the future is a broken
    // device clock, not a time traveller: fall back to "now".
    firstSeenAt: firstSeenAt > now + DAY_MS ? now : firstSeenAt,
    lastPlayedAt: lastPlayedAt > now + DAY_MS ? now : lastPlayedAt,
    streak: num(raw.streak, 0, 0, LIMITS.streak),
  };
}

/** Read + migrate + validate the blob on disk. Never throws. */
export function loadSave(now: number = Date.now()): SaveData {
  try {
    return validateSave(readJson<unknown>(SAVE_KEY, null), now);
  } catch {
    return defaultSave(now);
  }
}

/* ------------------------------------------------------------------- store */

type Listener = (data: Readonly<SaveData>) => void;

/**
 * Owns the live `SaveData`, its listeners, and the write schedule.
 *
 * Mutation protocol inside `src/meta`: touch `store.data` directly, then call
 * `store.commit()` exactly once. Everything outside `src/meta` only ever sees
 * `store.snapshot()`, which is frozen.
 */
export class SaveStore {
  /** Mutable live state. Internal to `src/meta` — never hand this out. */
  readonly data: SaveData;

  private snap: Readonly<SaveData> | null = null;
  private listeners = new Set<Listener>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;
  private readonly clock: () => number;
  private readonly detach: Array<() => void> = [];

  constructor(opts: { now?: () => number } = {}) {
    this.clock = opts.now ?? (() => Date.now());
    this.data = loadSave(this.clock());
    this.attachLifecycle();
  }

  /** Frozen shallow-immutable view. Cached until the next commit. */
  snapshot(): Readonly<SaveData> {
    if (!this.snap) {
      const d = this.data;
      this.snap = Object.freeze({
        ...d,
        owned: Object.freeze([...d.owned]) as SkuId[],
        bestByTheme: Object.freeze({ ...d.bestByTheme }),
        settings: Object.freeze({ ...d.settings }),
      });
    }
    return this.snap;
  }

  /** Call once after mutating `data`: invalidates the snapshot, schedules a
   *  write and notifies listeners. */
  commit(opts: { immediate?: boolean } = {}): void {
    this.snap = null;
    this.dirty = true;
    if (opts.immediate) this.flush();
    else this.schedule();
    this.emit();
  }

  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /** Synchronous write. Safe to call at any time, cheap when nothing changed. */
  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.dirty) return;
    this.dirty = false;
    writeJson(SAVE_KEY, this.data);
  }

  /** Wipe to a fresh save. Used by the debug hook — honest and complete. */
  reset(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    removeKey(SAVE_KEY);
    Object.assign(this.data, defaultSave(this.clock()));
    this.dirty = true;
    this.commit({ immediate: true });
  }

  /** Detach lifecycle listeners. The game never tears meta down, but tests and
   *  hot reload do. */
  dispose(): void {
    this.flush();
    for (const off of this.detach.splice(0)) off();
    this.listeners.clear();
  }

  private schedule(): void {
    if (this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, WRITE_DEBOUNCE_MS);
  }

  private emit(): void {
    if (this.listeners.size === 0) return;
    const view = this.snapshot();
    for (const fn of [...this.listeners]) {
      try {
        fn(view);
      } catch {
        /* a broken listener must never cost the player their save */
      }
    }
  }

  private attachLifecycle(): void {
    const flush = (): void => this.flush();
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      const onVisibility = (): void => {
        if (document.visibilityState === 'hidden') this.flush();
      };
      document.addEventListener('visibilitychange', onVisibility);
      this.detach.push(() => document.removeEventListener('visibilitychange', onVisibility));
    }
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      // pagehide is the only teardown signal iOS Safari reliably fires.
      window.addEventListener('pagehide', flush);
      this.detach.push(() => window.removeEventListener('pagehide', flush));
    }
  }
}
