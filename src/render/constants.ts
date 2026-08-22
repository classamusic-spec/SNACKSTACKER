/**
 * Leaf constants: no imports, so anything in render/ can reach them without
 * risking a cycle.
 *
 * `PALETTE_FADE` used to live in palette.ts, which is fine until palette.ts
 * needs the light rig's bearing for the sky presets — at which point
 * lighting.ts -> palette.ts -> lighting.ts is a real cycle, and a real
 * temporal-dead-zone crash the moment module order puts lighting first. It is
 * re-exported from palette.ts so every existing importer is unaffected.
 */

/** Seconds a palette crossfade takes. Snapping a theme change looks broken. */
export const PALETTE_FADE = 0.6;
