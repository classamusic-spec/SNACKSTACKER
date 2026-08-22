import * as THREE from 'three';
import type { ThemePaletteLike } from './api';

/**
 * CPU side of the tone-mapping deal the backdrop makes with the finishing pass.
 *
 * The cyclorama wants to appear as the exact palette hex, but everything in the
 * post path gets ACES'd on the way out. So the backdrop shader pre-divides
 * itself by the curve. That means the backdrop can sit at a *linear* value well
 * above 1 — a cream sweep needs about 3.4 — which would otherwise sail past the
 * bloom threshold and turn the whole wall into a glow. Hence `backdropPeakLuma`:
 * the bloom threshold is set from the palette itself, just above the brightest
 * the wall can be, so bloom only ever picks up real highlights.
 */

/** Matches the clamp inside `acesInverse` in shaders.ts. */
export const TARGET_CLAMP = 0.97;

/** Inverse of three's ACES_IN. Derived, not transcribed. */
export function acesInMatrixInverse(): THREE.Matrix3 {
  return new THREE.Matrix3()
    .set(0.59719, 0.35458, 0.04823, 0.076, 0.90834, 0.01566, 0.0284, 0.13383, 0.83777)
    .invert();
}

/** Inverse of three's ACES_OUT. */
export function acesOutMatrixInverse(): THREE.Matrix3 {
  return new THREE.Matrix3()
    .set(1.60475, -0.53108, -0.07367, -0.10208, 1.10813, -0.00605, -0.00327, -0.07276, 1.07602)
    .invert();
}

const IN_INV = /* @__PURE__ */ acesInMatrixInverse();
const OUT_INV = /* @__PURE__ */ acesOutMatrixInverse();
const IN_FWD = /* @__PURE__ */ new THREE.Matrix3().set(
  0.59719, 0.35458, 0.04823, 0.076, 0.90834, 0.01566, 0.0284, 0.13383, 0.83777,
);
const OUT_FWD = /* @__PURE__ */ new THREE.Matrix3().set(
  1.60475, -0.53108, -0.07367, -0.10208, 1.10813, -0.00605, -0.00327, -0.07276, 1.07602,
);

const tmpVec = /* @__PURE__ */ new THREE.Vector3();
const tmpColor = /* @__PURE__ */ new THREE.Color();

function rrtInverse(v: THREE.Vector3): void {
  const solve = (y: number): number => {
    const a = 1 - 0.983729 * y;
    const b = 0.0245786 - 0.432951 * y;
    const c = -(0.000090537 + 0.238081 * y);
    const disc = Math.max(b * b - 4 * a * c, 0);
    return (-b + Math.sqrt(disc)) / (2 * a);
  };
  v.set(solve(v.x), solve(v.y), solve(v.z));
}

/**
 * The linear value that, after ACES at `exposure`, displays as `target`.
 * Writes into `out` and returns it. No allocation.
 */
export function acesInverse(
  target: THREE.Color,
  exposure: number,
  out: THREE.Vector3,
): THREE.Vector3 {
  out.set(
    THREE.MathUtils.clamp(target.r, 0, TARGET_CLAMP),
    THREE.MathUtils.clamp(target.g, 0, TARGET_CLAMP),
    THREE.MathUtils.clamp(target.b, 0, TARGET_CLAMP),
  );
  out.applyMatrix3(OUT_INV);
  rrtInverse(out);
  out.applyMatrix3(IN_INV);
  out.set(Math.max(out.x, 0), Math.max(out.y, 0), Math.max(out.z, 0));
  out.multiplyScalar(0.6 / Math.max(exposure, 0.0001));
  return out;
}

/** Forward ACES, matching `acesFilmic` in shaders.ts. Writes into `v`. */
export function acesForward(v: THREE.Vector3, exposure: number): THREE.Vector3 {
  v.multiplyScalar(exposure / 0.6);
  v.applyMatrix3(IN_FWD);
  const fit = (x: number): number =>
    (x * (x + 0.0245786) - 0.000090537) / (x * (0.983729 * x + 0.432951) + 0.238081);
  v.set(fit(v.x), fit(v.y), fit(v.z));
  v.applyMatrix3(OUT_FWD);
  v.set(
    THREE.MathUtils.clamp(v.x, 0, 1),
    THREE.MathUtils.clamp(v.y, 0, 1),
    THREE.MathUtils.clamp(v.z, 0, 1),
  );
  return v;
}

const encodeSRGB = (x: number): number =>
  x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(Math.max(x, 0), 1 / 2.4) - 0.055;

/**
 * The alpha a dark overlay needs on the direct path to darken the cyclorama by
 * the same visible amount it does on the composer path.
 *
 * They are not the same number. With a composer the overlay blends into a
 * linear HDR buffer and ACES compresses the result afterwards, so removing 34%
 * of the light costs far less than 34% of the displayed value. Drawing straight
 * to the canvas, the same blend happens on already-encoded sRGB and lands at
 * full strength. Solved here against the sweep colour behind the plate rather
 * than guessed.
 */
export function directOverlayAlpha(
  behind: THREE.Color,
  composerAlpha: number,
  exposure: number,
): number {
  acesInverse(behind, exposure, tmpVec).multiplyScalar(1 - composerAlpha);
  acesForward(tmpVec, exposure);
  const num =
    encodeSRGB(tmpVec.x) * REC709.r + encodeSRGB(tmpVec.y) * REC709.g + encodeSRGB(tmpVec.z) * REC709.b;
  const den =
    encodeSRGB(behind.r) * REC709.r + encodeSRGB(behind.g) * REC709.g + encodeSRGB(behind.b) * REC709.b;
  if (den <= 0.0001) return composerAlpha;
  return THREE.MathUtils.clamp(1 - num / den, 0, 1);
}

const REC709 = { r: 0.2126, g: 0.7152, b: 0.0722 };

function lumaOfHex(hex: number, exposure: number, gain: number): number {
  tmpColor.setHex(hex, THREE.SRGBColorSpace);
  acesInverse(tmpColor, exposure, tmpVec).multiplyScalar(gain);
  return tmpVec.x * REC709.r + tmpVec.y * REC709.g + tmpVec.z * REC709.b;
}

/** Same, for a colour that is already a linear display-referred triple. */
function lumaOfLinear(v: number, exposure: number, gain: number): number {
  tmpColor.setRGB(v, v, v);
  acesInverse(tmpColor, exposure, tmpVec).multiplyScalar(gain);
  return tmpVec.x * REC709.r + tmpVec.y * REC709.g + tmpVec.z * REC709.b;
}

/** Matches the star mix in backdrop.ts: `mix( col, uStarColor, 0.85 )`. */
const STAR_PEAK = 0.85;

/**
 * Brightest luminance the cyclorama can reach for this palette, in the linear
 * units the bloom high-pass sees.
 *
 * Everything the sky shader draws is a `mix` between authored colours, so the
 * peak is bounded by the brightest of them — which for an open sky is usually
 * not bgTop at all. A cream cloud over a dusk gradient, or the moon glow over
 * a midnight one, both sit well above the sweep, and a threshold derived from
 * bgTop alone would let the whole cloud deck bloom into a smear. The sun disc
 * is deliberately NOT in this list: it is the one thing that must bloom, and
 * `sunLinearScale` sizes it against the threshold this produces.
 *
 * @param glowGain the multiplicative lift the sweep's softbox applies.
 */
export function backdropPeakLuma(
  p: ThemePaletteLike,
  exposure = p.exposure,
  glowGain = 1.14,
): number {
  let peak = Math.max(
    lumaOfHex(p.bgTop, exposure, glowGain),
    lumaOfHex(p.bgBottom, exposure, glowGain),
    lumaOfHex(p.ground, exposure, glowGain),
  );
  const sky = p.sky;
  if (sky && sky.kind === 'open') {
    peak = Math.max(
      peak,
      lumaOfHex(sky.glowColor, exposure, glowGain),
      lumaOfHex(sky.horizonColor, exposure, glowGain),
    );
    if (sky.cloudCover > 0.001) {
      peak = Math.max(peak, lumaOfHex(sky.cloudColor, exposure, glowGain));
    }
    if (sky.stars > 0.001) {
      peak = Math.max(peak, lumaOfLinear(STAR_PEAK, exposure, glowGain));
    }
  }
  return peak;
}

/**
 * Bloom threshold that keeps the backdrop out of the glow while leaving real
 * specular highlights — glaze, syrup, sugar — well inside it.
 */
export function bloomThresholdFor(p: ThemePaletteLike): number {
  return Math.max(1.0, backdropPeakLuma(p) * 1.12);
}

/**
 * How far above the bloom threshold the sun's core sits. Two and a bit is
 * enough to saturate the tone curve to white and to clear the high-pass with
 * margin; much more and the bloom kernel spreads a hard-edged blob instead of
 * a halo.
 */
const SUN_BLOOM_HEADROOM = 2.6;

/**
 * Multiplier for the sun's linear colour on the composer path.
 *
 * The rest of the backdrop is clamped at `TARGET_CLAMP` before the inverse, so
 * it can never out-run the threshold no matter how bright the palette. The sun
 * is added afterwards, in scene-linear units, and is the only part of this
 * shader with real HDR headroom — this is the number that decides it blooms.
 * On the direct path there is no bloom at all and no composer, so the disc is
 * just clamped to white there; both paths therefore agree on the core colour
 * and differ only by the halo, which is a tier feature, not a mismatch.
 */
export function sunLinearScale(p: ThemePaletteLike): number {
  const sky = p.sky;
  if (!sky || sky.kind !== 'open') return 0;
  tmpColor.setHex(sky.sunColor, THREE.SRGBColorSpace);
  const luma = tmpColor.r * REC709.r + tmpColor.g * REC709.g + tmpColor.b * REC709.b;
  if (luma <= 0.0001) return 0;
  return (bloomThresholdFor(p) * SUN_BLOOM_HEADROOM) / luma;
}
