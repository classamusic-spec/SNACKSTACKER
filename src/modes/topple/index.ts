/**
 * TOPPLE — "How high before it falls?"
 *
 * A real physics tower, built inside the same worlds and out of the same food
 * as the stacker. Rules and tuning: `tuning.ts`. Solver: `physics/`.
 *
 * PHYSICS CHOICE — hand-rolled, ~0 KB of dependency.
 *   cannon-es (≈45 KB gzipped) and rapier (≈300 KB gzipped of WASM) were both
 *   considered and both rejected. The full argument is at the top of
 *   `physics/world.ts`; the short version is that this game needs exactly one
 *   collision shape (the oriented box), needs zero per-frame allocation, and
 *   needs the run to be reproducible in a Node test. A focused 900-line
 *   sequential-impulse solver gives all three; a general engine gives none of
 *   them, and charges for spheres, capsules, joints and CCD that will never be
 *   used. Stability is proved headlessly, not by eye —
 *   `npx tsx src/dev/topple-stability.ts`.
 *
 * DETERMINISM. The solver is bit-deterministic for a given body order and
 * timestep, and the game's whole simulation — swing phase included — advances
 * on the fixed step, with taps consumed at the next step boundary. So a run is
 * reproducible given the same seed and the same sequence of "released on step
 * N". It is not reproducible from wall-clock play, because a human tap does not
 * arrive on the same step twice.
 */
import type { GameMode, ModeCtx } from '../api';
import { ToppleGame } from './ToppleGame';

export function createToppleMode(ctx: ModeCtx): GameMode {
  const game = new ToppleGame(ctx);
  return {
    id: 'topple',
    events: game.events,
    attract: () => game.attract(),
    start: () => game.start(),
    stop: () => game.stop(),
    update: (dt, elapsed) => game.update(dt, elapsed),
    tap: () => game.tap(),
    setTheme: (theme) => game.setTheme(theme),
    dispose: () => game.dispose(),
  };
}

export { ToppleGame } from './ToppleGame';
export { TOPPLE } from './tuning';
