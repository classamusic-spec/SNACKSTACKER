/**
 * Seeded randomness for the snack-material kit.
 *
 * Every irregularity in this kit — a deckle notch, a fleck of pulp, a flung
 * ketchup droplet — comes from here. `Math.random()` is never used: a napkin
 * that reshuffles its edge on every re-render is nauseating (DESIGN §8), so a
 * given seed string must always produce byte-identical output.
 */

/** FNV-1a over the seed string, so nearby strings land far apart. */
export function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  // A final avalanche: FNV alone leaves the low bits of short strings sticky.
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 2246822507);
  hash ^= hash >>> 13;
  return hash >>> 0;
}

export interface Rng {
  /** Uniform 0..1. */
  next(): number;
  /** Uniform min..max. */
  range(min: number, max: number): number;
  /** Integer min..max inclusive. */
  int(min: number, max: number): number;
  /** -1 or +1. */
  sign(): number;
  /** True with probability p. */
  chance(p: number): boolean;
  /** Uniform element of a non-empty list. */
  pick<T>(items: readonly T[]): T;
  /** Roughly normal, mean 0, sd ~0.4 — good for jitter that should cluster. */
  gauss(): number;
}

/** mulberry32 — 32 bits of state, excellent distribution, four lines long. */
export function makeRng(seed: string | number): Rng {
  let state = (typeof seed === 'number' ? seed >>> 0 : hashSeed(seed)) || 0x9e3779b9;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (min, max) => min + (max - min) * next(),
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    sign: () => (next() < 0.5 ? -1 : 1),
    chance: (p) => next() < p,
    pick: <T,>(items: readonly T[]): T => items[Math.floor(next() * items.length) % items.length],
    gauss: () => (next() + next() + next() - 1.5) * 0.8,
  };
}

/**
 * Smooth 1-D value noise on a seeded lattice. Fibre undulation and torn edges
 * need low-frequency wander underneath their high-frequency jitter; pure
 * per-point randomness reads as static, not as paper.
 */
export function makeNoise1(seed: string | number, cells = 32): (x: number) => number {
  const rng = makeRng(seed);
  const lattice = new Float32Array(cells);
  for (let i = 0; i < cells; i += 1) lattice[i] = rng.next() * 2 - 1;
  return (x: number): number => {
    const t = ((x % cells) + cells) % cells;
    const i0 = Math.floor(t);
    const i1 = (i0 + 1) % cells;
    const f = t - i0;
    const s = f * f * (3 - 2 * f);
    return lattice[i0] * (1 - s) + lattice[i1] * s;
  };
}

/** Two octaves of the above: body plus detail, still cheap and still seamless. */
export function makeFbm1(seed: string | number, cells = 24): (x: number) => number {
  const a = makeNoise1(`${seed}:a`, cells);
  const b = makeNoise1(`${seed}:b`, cells * 3);
  return (x: number): number => a(x) * 0.68 + b(x * 3) * 0.32;
}
