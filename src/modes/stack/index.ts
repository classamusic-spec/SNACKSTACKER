import type { ThemeDef } from '../../content/api';
import { Emitter } from '../../core/events';
import { clamp01 } from '../../core/math';
import { StackGame } from '../../game/StackGame';
import type { GameMode, ModeCtx, ModeEvents } from '../api';

/**
 * Adapts the original tower game to the GameMode contract.
 *
 * StackGame predates the contract and has its own richer event vocabulary
 * (`perfect`, `layer`, `gameover`). Rather than rewrite a shipped, heavily
 * tested game, this translates it — so the host can treat all four modes
 * identically and StackGame keeps its own tests and semantics.
 */
export function createStackMode(ctx: ModeCtx): GameMode {
  const events = new Emitter<ModeEvents>();

  const game = new StackGame({
    scene: ctx.scene,
    rig: ctx.rig,
    materials: ctx.materials,
    vfx: ctx.vfx,
    audio: ctx.audio,
    quality: ctx.quality,
    shake: (m, d) => ctx.shake(m, d),
    flash: (a) => ctx.flash(a),
  });
  game.setTheme(ctx.theme);

  let perfects = 0;
  let bestCombo = 0;

  game.events.on('score', (e) => events.emit('score', e));
  game.events.on('combo', (c) => {
    bestCombo = Math.max(bestCombo, c);
    events.emit('combo', c);
  });
  game.events.on('perfect', ({ label, tier }) => {
    perfects++;
    events.emit('praise', { label, tier });
  });
  game.events.on('milestone', (m) => events.emit('milestone', m));
  game.events.on('layer', ({ layers }) =>
    events.emit('progress', { primary: layers, label: 'Layers' }),
  );
  game.events.on('intensity', (v) => events.emit('intensity', clamp01(v)));
  game.events.on('firstDrop', () => events.emit('firstAction', undefined));
  game.events.on('gameover', (s) => {
    events.emit('over', {
      score: s.score,
      count: s.layers,
      countLabel: 'Layers',
      perfects: s.perfects,
      bestCombo: s.bestCombo,
      heightCm: s.heightCm,
    });
  });

  return {
    id: 'stack',
    events,
    attract: () => game.attract(),
    start: () => {
      perfects = 0;
      bestCombo = 0;
      game.start();
    },
    stop: () => game.stop(),
    update: (dt, elapsed) => game.update(dt, elapsed),
    // The stacker is a tap-anywhere game; the coordinates are irrelevant to it.
    tap: () => game.drop(),
    get aimHint() {
      return game.dropOffset;
    },
    get debrisCount() {
      return game.debrisCount;
    },
    setTheme: (t: ThemeDef) => game.setTheme(t),
    dispose: () => {
      game.dispose();
      events.clear();
    },
  };
}

/** The host needs the live phase to know when a topple is mid-flight. */
export { StackGame };
