/**
 * The stack cut, as pure maths. Kept separate from StackGame so the one piece
 * of logic the whole game rests on can be tested without a WebGL context.
 *
 * All values are along a single axis. `prevCenter`/`prevSize` describe the top
 * of the tower; `curCenter` is where the sliding layer was when the player
 * tapped. The sliding layer always has the same size as the layer below it.
 */
export interface SliceOptions {
  /** Misalignment still counted as perfect. */
  tolerance: number;
  /** Footprint handed back on a perfect drop. */
  regrow: number;
  /** Footprint can never regrow past this. */
  maxSize: number;
  /** Below this the tower cannot stand. */
  minSize: number;
}

export type SliceResult =
  | { kind: 'miss'; reason: 'no_overlap' | 'too_thin' }
  | {
      kind: 'perfect' | 'cut';
      /** Size of the piece that stays on the tower. */
      keptSize: number;
      /** Centre of the piece that stays on the tower. */
      keptCenter: number;
      /** Size of the scrap that falls away (0 on a perfect drop). */
      cutSize: number;
      /** Centre of that scrap. */
      cutCenter: number;
      /** Which side the scrap flew off: +1 or -1. */
      cutSign: 1 | -1;
      /** Signed drop offset, for feedback scaling. */
      delta: number;
    };

export function sliceLayer(
  prevCenter: number,
  prevSize: number,
  curCenter: number,
  opts: SliceOptions,
): SliceResult {
  const delta = curCenter - prevCenter;
  const overlap = prevSize - Math.abs(delta);

  if (overlap <= 1e-4) return { kind: 'miss', reason: 'no_overlap' };

  const sign: 1 | -1 = delta >= 0 ? 1 : -1;

  if (Math.abs(delta) <= opts.tolerance) {
    // Perfect: snap into alignment and hand some footprint back, so a skilled
    // run can recover room instead of only ever losing it.
    const keptSize = Math.min(prevSize + opts.regrow, opts.maxSize);
    return {
      kind: 'perfect',
      keptSize,
      keptCenter: prevCenter,
      cutSize: 0,
      cutCenter: prevCenter,
      cutSign: sign,
      delta,
    };
  }

  if (overlap < opts.minSize) return { kind: 'miss', reason: 'too_thin' };

  // The kept piece is the intersection; the scrap is the rest of the sliding
  // layer, sitting immediately beyond the tower edge on the drop side.
  return {
    kind: 'cut',
    keptSize: overlap,
    keptCenter: prevCenter + delta / 2,
    cutSize: Math.abs(delta),
    cutCenter: prevCenter + delta / 2 + (sign * prevSize) / 2,
    cutSign: sign,
    delta,
  };
}

/** Position of the sliding layer at a given phase, in [-travel, travel]. */
export function slidePosition(phase: number, travel: number, ease = 0.35): number {
  const t = ((phase % 2) + 2) % 2;
  const u = t < 1 ? t : 2 - t;
  // Linear travel keeps aiming fair; a light cosine blend softens the
  // turnaround so the layer never snaps direction.
  const shaped = u + (0.5 - 0.5 * Math.cos(Math.PI * u) - u) * ease;
  return -travel + shaped * travel * 2;
}
