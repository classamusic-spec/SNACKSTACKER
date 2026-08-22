import * as THREE from 'three';
import type { SkyConfig, ThemePaletteLike } from './api';
import type { QualityTier } from '../core/types';
import { PALETTE_FADE } from './palette';
import { GLSL_ACES_INVERSE, GLSL_DITHER, GLSL_SRGB } from './shaders';
import { makeSurface } from './surface';
import {
  acesInMatrixInverse,
  acesOutMatrixInverse,
  directOverlayAlpha,
  sunLinearScale,
} from './tonemap';

/**
 * The cyclorama.
 *
 * A photographer's sweep has no horizon line, no corner and no seam — just a
 * lit gradient that the subject floats in front of. That is an inverted sphere
 * pinned to the camera with a hand-written gradient: bgTop above, bgBottom
 * below, a soft box of light behind the hero, a radial vignette, and a
 * triangular dither so the whole thing does not band on an 8-bit display.
 *
 * It is deliberately outside the fog and outside the tone mapper. See
 * `shaders.ts` for how the pre-division works.
 *
 * ## Why the floor is a shadow catcher and not a surface
 *
 * This used to be a 120-unit lit disc, and it was a bug. The game camera sits
 * at CAM_PITCH 0.5 rad with a 46 degree FOV, so the top of the frame looks
 * 4.5 degrees BELOW the horizon — a horizontal plane under the camera
 * therefore covers every single pixel, and the sweep was never visible at all.
 * What measured as "the gradient" was the disc fading into FogExp2, which is
 * why the top of frame read as roughly the tone-mapped fog colour and why the
 * gradient ran dark in the middle instead of monotonically. The tell was that
 * both tiers were wrong identically: it was never a colour-space or exposure
 * error on the direct path, it was occlusion.
 *
 * A floor also contradicts the design bible outright — "no skyboxes, no
 * horizons, no clutter". So the floor now renders nothing but the shadow that
 * lands on it, and the plate is grounded by the contact blob instead.
 *
 * ## The sky, and why it is only half world-anchored
 *
 * Every outdoor theme now has a real place around the plate, and a two-stop
 * sweep behind a picket fence reads as a wall. `palette.sky` turns the sweep
 * into atmosphere: a sun, a wide glow, a drifting cloud deck, a haze band and
 * (at night) stars.
 *
 * The temptation is to build that from the world view direction, the way a
 * skybox does. It does not work here, for exactly the reason the floor disc
 * did not work: the same 4.5 degrees. The camera looks DOWN, so every pixel in
 * the frame has a negative world elevation — a world-anchored sky would sit
 * entirely off the top of the screen at every camera angle the game uses, and
 * the player would see none of it. The clearance-cylinder lesson again: the
 * geometry is necessary, the frame is what decides.
 *
 * So the sky is anchored like the sweep it replaces:
 *
 *   VERTICAL    the `sweep` coordinate — frame-relative, with a slice of view
 *               direction mixed in. `SKY_HORIZON` and `SKY_ZENITH` map it onto
 *               a pretend 0..90 degrees of elevation. Measured against the
 *               shipped environments, the visible band is only sweep 0.82 (the
 *               diner's fence line) to 0.99 (top of frame) — about 125px of a
 *               393x852 frame — so the haze sits at 0.78 and the zenith is
 *               placed past the top edge.
 *   HORIZONTAL  the true world bearing of the view direction. Nothing forces
 *               this one, so it costs nothing to be honest: the sun stays put
 *               in the world while the home screen orbits a full turn, and the
 *               cloud deck slides past instead of turning with the camera.
 *
 * The sun's bearing is `KEY_AZIMUTH` from lighting.ts in every preset — see
 * the note there for why the bearing must match and the altitude need not.
 */

const SKY_RADIUS = 100;
/** Only has to be wide enough to catch the key light's shadow. */
const SHADOW_CATCHER_RADIUS = 14;
/** Alpha of the plate's contact blob on the composer path. */
const CONTACT_ALPHA = 0.4;

/**
 * Sweep value the sky treats as the horizon, and the one it treats as the
 * zenith.
 *
 * Both are measured off the shipped frames, not chosen. Sampling the diner
 * home screen at 393x852: the top of frame lands at sweep 0.986 and the fence
 * line — the highest thing any environment puts against the sky — at 0.819.
 * So the entire visible sky is a 0.17-wide strip of sweep about 125px tall,
 * and the horizon has to sit just under it or the haze band never reaches the
 * scenery it is supposed to dissolve. 0.66 was tried first, from the fence's
 * height before content raised it, and put the haze a whole screen too low.
 *
 * The zenith sits past the top edge so the deck bunches into it rather than
 * converging on a visible vanishing point.
 */
const SKY_HORIZON = 0.78;
const SKY_ZENITH = 1.14;
/** Radians of pretend elevation per unit of `e`. Used to keep cells square. */
const SKY_SPAN = SKY_ZENITH - SKY_HORIZON;

/** Angular radius of the disc, in screen radians. The real sun is 0.0047. */
const SUN_RADIUS = 0.0085;
/**
 * Noise cells per deck unit.
 *
 * Solved against the strip above, not guessed: 22 puts a cell at roughly
 * 61x28 device pixels, so about six across the frame and four up it, which
 * with the fBm's low-frequency structure comes out at three or four distinct
 * masses. 9 was tried and gives one cloud the size of the sky; past ~26 the
 * top octave falls under two pixels and fizzes.
 */
const CLOUD_SCALE = 22;
/** How far the domain warp can drag the field. Higher = more curdled. */
const CLOUD_WARP = 0.9;
/**
 * Cloud phase wrap, in noise cells. Not larger: `hash12` floors its input, and
 * a coordinate in the thousands loses enough float mantissa that the top
 * octaves go blocky. 64 cells is about four hours at the fastest preset drift,
 * and the field re-rolls rather than jumping a visible distance.
 */
const CLOUD_WRAP = 64;

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize( position );
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}
`;

/** Uniforms only the open-sky variant declares. */
const SKY_UNIFORMS = /* glsl */ `uniform float uSkyAmount;
uniform float uSweepToRad;
uniform vec2 uSunDir;
uniform float uSunSweep;
uniform vec2 uSunSize;
uniform float uSunAmt;
uniform vec3 uSunTint;
uniform vec3 uSunLin;
uniform vec3 uGlowColor;
uniform float uGlowSpread;
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;
uniform float uCloudCover;
uniform vec2 uCloudOffset;
uniform vec3 uHorizonColor;
uniform vec2 uHorizonBand;
uniform float uStars;
uniform vec3 uStarColor;`;

/**
 * Value noise on the dither hash. Four hashes an octave — that number is the
 * entire fill-rate budget for this feature, so it is the one to count.
 */
const SKY_NOISE = /* glsl */ `float vnoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = p - i;
  f = f * f * ( 3.0 - 2.0 * f );
  float a = hash12( i );
  float b = hash12( i + vec2( 1.0, 0.0 ) );
  float c = hash12( i + vec2( 0.0, 1.0 ) );
  float d = hash12( i + vec2( 1.0, 1.0 ) );
  return mix( mix( a, b, f.x ), mix( c, d, f.x ), f.y );
}`;

/**
 * fBm, unrolled to the tier's octave count so there is no dynamic loop.
 *
 * `lod` folds the higher octaves away with distance. Without it the deck turns
 * to fizz as it converges on the horizon, which is where a procedural sky
 * usually gives itself away.
 */
function skyFbm(octaves: number): string {
  let body = '';
  for (let i = 0; i < octaves; i++) {
    body += `  s += a * vnoise( p );\n  norm += a;\n`;
    if (i === 1 || octaves === 1) body += `  body = s / max( norm, 1e-4 );\n`;
    if (i < octaves - 1) {
      body += `  a *= 0.5 * lod;\n  p = p * 2.03 + ${(17.3 + i * 7.7).toFixed(2)};\n`;
    }
  }
  return /* glsl */ `float cloudFbm( vec2 p, float lod, out float body ) {
  float s = 0.0;
  float a = 0.5;
  float norm = 0.0;
  body = 0.0;
${body}  return s / max( norm, 1e-4 );
}`;
}

/**
 * The sky itself, spliced into main() after the sweep and before the softbox
 * gain. Everything here composites in the same display-referred space the
 * gradient uses, and everything is a `mix`, never an add — an add would push
 * the value into the ACES shoulder that `acesInverse` has to run backwards
 * through, and the inverse is wildly ill-conditioned up there. The one
 * exception is the sun, which is handed to the two paths separately at the
 * bottom of main() precisely so it can be HDR on the one that blooms.
 */
function skyBody(octaves: number, warpSamples: number, litSample: boolean): string {
  const warp =
    warpSamples >= 2
      ? `    vec2 wq = vec2( vnoise( cp * 0.45 ), vnoise( cp * 0.45 + 19.7 ) );
    vec2 wp = cp + ( wq - 0.5 ) * ${CLOUD_WARP.toFixed(2)};`
      : warpSamples === 1
        ? `    float w0 = vnoise( cp * 0.45 );
    vec2 wp = cp + ( vec2( w0, 1.0 - w0 ) - 0.5 ) * ${CLOUD_WARP.toFixed(2)};`
        : `    vec2 wp = cp;`;

  // Lit side needs one more sample of the field, offset toward the sun. On the
  // low tier it is dropped and the density term carries the shading alone.
  const lit = litSample
    ? `    float lightSide = clamp( 0.5 + ( vnoise( wp + uSunDir * 0.55 ) - body ) * 2.4, 0.0, 1.0 );`
    : `    float lightSide = 0.5;`;

  return /* glsl */ `
  // ---- sky ---------------------------------------------------------------
  float discShape = 0.0;
  if ( uSkyAmount > 0.0 ) {
    // Pretend elevation: 0 at the haze line, 1 at the zenith. See the header
    // for why this is the sweep and not vDir.y.
    float e = clamp( ( sweep - ${SKY_HORIZON.toFixed(2)} ) / ${SKY_SPAN.toFixed(2)}, 0.0, 1.0 );
    vec2 dxz = vDir.xz / max( length( vDir.xz ), 1e-4 );

    // Angular distance to the sun, in screen radians: true bearing across,
    // sweep scaled into radians up. The chord form of the bearing difference
    // is stable right at the disc where acos is not.
    float dAz = 2.0 * asin( min( 1.0, 0.5 * length( dxz - uSunDir ) ) );
    float dEl = ( sweep - uSunSweep ) * uSweepToRad;
    float sunAng = sqrt( dAz * dAz + dEl * dEl );

    // Core plus a skirt, in units of the authored spread. The skirt is the
    // part that reads as time of day — during a run the disc is 93 degrees
    // off-axis and the skirt is all of the sun the player ever sees — but it
    // has to actually reach zero. A second exponential in x does not: at three
    // spreads out it was still lifting the whole sky, which on the night
    // palette meant a flat slate wash 30 steps above the authored bgTop. A
    // gaussian in x falls off the way a real halo does and is dead by four.
    float x = min( sunAng / max( uGlowSpread, 0.05 ), 6.0 );
    float glowAmt = exp( -x ) + 0.5 * exp( -x * x * 0.25 );
    // Thicker air low down. Also keeps the palette's own gradient alive at the
    // top of frame instead of flattening the whole sky to one colour.
    glowAmt = min( glowAmt * mix( 1.0, 0.5, e ) * uSkyAmount, 1.0 );
    col = mix( col, uGlowColor, glowAmt * 0.8 );

    if ( uStars > 0.0 ) {
      float az = atan( vDir.x, vDir.z );
      // One unit of e is SKY_SPAN * uSweepToRad radians, so scaling both axes
      // by the same number keeps the cells square whatever the FOV.
      vec2 sp = vec2( az, e * ${SKY_SPAN.toFixed(2)} * uSweepToRad ) * ( 34.0 + 46.0 * uStars );
      vec2 ci = floor( sp );
      vec2 cf = sp - ci;
      vec2 at = vec2( hash12( ci + 7.31 ), hash12( ci + 3.17 ) );
      float star = step( 1.0 - 0.55 * uStars, hash12( ci ) );
      // Soft-edged on purpose: the high tier's finishing pass puts ~1px of
      // chromatic aberration on the frame, and a hard 2px star picks that up
      // as a coloured fringe.
      star *= 1.0 - smoothstep( 0.02, 0.20, length( cf - at ) );
      star *= smoothstep( 0.04, 0.28, e );
      star *= 1.0 - min( 1.0, glowAmt * 1.6 );
      col = mix( col, uStarColor, star * uSkyAmount * 0.85 );
    }

    float cloudA = 0.0;
    if ( uCloudCover > 0.001 ) {
      // Distance to a flat deck overhead. True cot(elevation) is the honest
      // form and it was tried first; over the sliver of sky this frame shows
      // it spreads r by 7x, and at 7x every cloud renders as a horizontal
      // smear.
      //
      // This is cot flattened until the deck compresses about 2.2x more
      // vertically than horizontally. Solved, not guessed: across the visible
      // strip a pixel of bearing is 0.00074 deck units and the r span has to
      // be ~0.21 over 125px to be twice that. Get it wrong in the other
      // direction — too flat — and the clouds hang down like stalactites.
      float r = min( 0.07 / ( e + 0.12 ) + 0.55, 1.5 );
      vec2 cp = dxz * r * ${CLOUD_SCALE.toFixed(1)} + uCloudOffset;
      // Detail dies with distance. Without it the deck fizzes exactly where it
      // is meant to be dissolving into haze.
      float lod = clamp( 1.0 - ( r - 0.66 ) * 2.6, 0.35, 1.0 );
${warp}
      float body;
      // Named dens, not f: main() already has an f for the floor roll-off and
      // GLSL would quietly shadow it.
      float dens = cloudFbm( wp, lod, body );
      // Value noise piles up around 0.5; stretch it or nothing ever clears the
      // threshold and "scattered" comes out as "faint haze".
      // 2.4 is not arbitrary: the two-octave field has a standard deviation of
      // about 0.14, and the coverage threshold below is solved against a
      // spread of ~0.34. At 3.2 most of the field clamped and cover 0.44 read
      // as overcast.
      dens = clamp( ( dens - 0.5 ) * 2.4 + 0.5, 0.0, 1.0 );

      float cov = clamp( uCloudCover * mix( 0.62, 1.18, smoothstep( 0.05, 0.60, e ) ), 0.0, 1.0 );
      float thr = mix( 0.99, 0.02, cov );
      float wid = mix( 0.22, 0.06, cov );
      cloudA = smoothstep( thr, thr + wid, dens );
      // Thin out into the haze rather than ending at a line. The window is
      // the bottom third of the VISIBLE strip, not of the notional sky — the
      // sky only starts at e 0.11 here, and a fade keyed to e 0 never fired.
      cloudA *= smoothstep( 0.05, 0.30, e );

      // Seen from underneath, a cumulus is bright at the fringe and grey
      // through the thick middle, because that is where the light from above
      // does not get through. That single term is the difference between a
      // volume and a white blob; the directional sample only tilts it.
      float depth = smoothstep( thr, min( thr + wid * 3.5, 1.05 ), dens );
${lit}
      float litMix = clamp( ( 1.0 - depth ) * 0.9 + ( lightSide - 0.5 ) * 0.5 + 0.05, 0.0, 1.0 );
      vec3 cloudRgb = mix( uCloudShade, mix( uCloudLit, uGlowColor, glowAmt * 0.6 ), litMix );
      col = mix( col, cloudRgb, cloudA * uSkyAmount );
    }

    // Haze band. Wide below the line so the fence and the facades dissolve
    // into air instead of ending, tight above so the sky stays the sky.
    float du = max( sweep - ${SKY_HORIZON.toFixed(2)}, 0.0 ) / uHorizonBand.x;
    float dd = max( ${SKY_HORIZON.toFixed(2)} - sweep, 0.0 ) / uHorizonBand.y;
    float hz = exp( -( du * du + dd * dd ) );
    col = mix( col, mix( uHorizonColor, uGlowColor, glowAmt * 0.55 ), hz * 0.62 * uSkyAmount );

    discShape = 1.0 - smoothstep( uSunSize.x, uSunSize.y, sunAng );
    discShape *= ( 1.0 - cloudA * uSkyAmount ) * ( 1.0 - hz * 0.5 ) * uSkyAmount;
  }
`;
}

/**
 * @param open false returns the studio sweep, character for character as it
 * has always been — two themes depend on that and a `mix` by zero is not the
 * same promise as code that never runs.
 */
function buildFrag(open: boolean, octaves: number, warp: number, lit: boolean): string {
  return /* glsl */ `
uniform vec3 uTop;
uniform vec3 uBottom;
uniform vec3 uFloor;
uniform vec3 uGlow;
uniform vec2 uResolution;
uniform vec2 uRange;
uniform float uParallax;
uniform float uGlowStrength;
uniform float uVignette;
uniform float uPostVignette;
uniform float uDirect;
uniform float uExposure;
uniform mat3 uAcesInInv;
uniform mat3 uAcesOutInv;
${open ? SKY_UNIFORMS + '\n' : ''}
varying vec3 vDir;

${GLSL_ACES_INVERSE}
${GLSL_SRGB}
${GLSL_DITHER}
${open ? '\n' + SKY_NOISE + '\n\n' + skyFbm(octaves) + '\n' : ''}
void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  vec2 d = uv - vec2( 0.5, 0.56 );
  d.x *= uResolution.x / max( uResolution.y, 1.0 );
  float r = length( d );

  // The sweep is anchored to the frame, with a slice of view direction mixed
  // in so it breathes as the camera pitches. Pure world elevation was tried
  // and rejected: the game frames the top of a growing tower, so the camera
  // pitch varies, and a world-locked gradient slid the whole palette off the
  // top of the screen.
  float sweep = uv.y + uParallax * vDir.y;
  float t = smoothstep( uRange.x, uRange.y, sweep );
  vec3 col = mix( uBottom, uTop, t );

  // The very bottom of frame rolls into the floor tint, the way a real
  // cyclorama's curve does.
  float f = smoothstep( 0.08, -0.22, sweep );
  col = mix( col, uFloor, f * 0.5 );
${open ? skyBody(octaves, warp, lit) : ''}
  // The softbox behind the subject, and the lens falloff. Both are gains, not
  // additions: an addition here would push the pre-divided colour into the
  // ACES shoulder, where the inverse is wildly ill-conditioned.
  float glow = 1.0 + uGlowStrength * ( 1.0 - smoothstep( 0.0, 0.95, r ) );
  // Kept gentle — the finishing pass adds its own.
  float vig = 1.0 - uVignette * smoothstep( 0.30, 1.05, r );

  if ( uDirect > 0.5 ) {
    // No composer: this shader writes the final pixel itself, which also means
    // it has to stand in for the finishing pass's vignette. Same curve, same
    // place in the order (after the encode), so the sweep measures the same on
    // both tiers instead of being ~30 steps brighter at the frame edge here.
    col = clamp( ${open ? 'mix( col, uSunTint, discShape * uSunAmt )' : 'col'} * glow * vig, 0.0, 1.0 );
    col = encodeSRGB( col );
    float aspect = uResolution.x / max( uResolution.y, 1.0 );
    vec2 pq = vec2( ( uv.x - 0.5 ) * aspect, uv.y - 0.5 );
    float pd = length( pq ) / max( length( vec2( 0.5 * aspect, 0.5 ) ), 0.0001 );
    col *= 1.0 - uPostVignette * smoothstep( 0.62, 1.35, pd );
    col = ditherTPDF( col, gl_FragCoord.xy, 1.0 / 255.0 );
  } else {
    // A tone mapper is downstream. Pre-divide so the sweep lands on the exact
    // palette hex instead of being tone-mapped into mush. See tonemap.ts for
    // how the bloom threshold is kept above whatever this produces.
    col = acesInverse( col, uExposure, uAcesInInv, uAcesOutInv ) * glow * vig;${
      open
        ? `
    // The one additive term in the shader, and the only one that can be: it
    // goes in AFTER the inverse, in linear scene units, so it never touches
    // the ill-conditioned end of the curve. uSunLin is sized in tonemap.ts to
    // clear the bloom threshold that the rest of this shader sits under.
    col += uSunLin * discShape * discShape;`
        : ''
    }
  }

  gl_FragColor = vec4( col, 1.0 );
}
`;
}

/** Noise budget per pixel, per tier. Measured, not guessed — see the report. */
interface SkyTier {
  octaves: number;
  /** Domain-warp samples. 0 drops the warp and the field reads as noise. */
  warp: number;
  /** Whether the cloud gets a second field sample for its lit side. */
  lit: boolean;
}

const SKY_TIERS: Record<QualityTier, SkyTier> = {
  // 5 + 2 + 1 = 8 value-noise fetches (32 hashes) a pixel.
  high: { octaves: 5, warp: 2, lit: true },
  // 3 + 1 + 1 = 5 fetches (20 hashes).
  medium: { octaves: 3, warp: 1, lit: true },
  // 2 + 0 + 0 = 2 fetches (8 hashes). No warp, no directional sample; the
  // density term alone still gives the deck a lit fringe and a grey core.
  low: { octaves: 2, warp: 0, lit: false },
};

function paintBlob(size: number, hardness: number): THREE.Texture | null {
  const s = makeSurface(size);
  if (!s) return null;
  const ctx = s.ctx;
  const half = size / 2;
  // White with a falling alpha: used as `map` on a black material, so the
  // texture supplies the shape and the material supplies the darkness.
  const g = ctx.createRadialGradient(half, half, 0, half, half, half);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(hardness, 'rgba(255,255,255,0.72)');
  g.addColorStop(0.72, 'rgba(255,255,255,0.2)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(s.source);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

/** Everything the shader needs to draw one sky, in shader-ready units. */
class SkyState {
  amount = 0;
  sunDir = new THREE.Vector2(0, 1);
  sunSweep = SKY_HORIZON;
  sunAmt = 0;
  readonly sunTint = new THREE.Color(0xffffff);
  readonly sunLin = new THREE.Color(0, 0, 0);
  readonly glow = new THREE.Color(0xffffff);
  glowSpread = 1;
  readonly cloudLit = new THREE.Color(0xffffff);
  readonly cloudShade = new THREE.Color(0x808080);
  cloudCover = 0;
  cloudDrift = 0;
  readonly horizon = new THREE.Color(0xffffff);
  horizonUp = 0.12;
  horizonDown = 0.16;
  stars = 0;
  readonly starColor = new THREE.Color(0xffffff);

  copy(o: SkyState): void {
    this.amount = o.amount;
    this.sunDir.copy(o.sunDir);
    this.sunSweep = o.sunSweep;
    this.sunAmt = o.sunAmt;
    this.sunTint.copy(o.sunTint);
    this.sunLin.copy(o.sunLin);
    this.glow.copy(o.glow);
    this.glowSpread = o.glowSpread;
    this.cloudLit.copy(o.cloudLit);
    this.cloudShade.copy(o.cloudShade);
    this.cloudCover = o.cloudCover;
    this.cloudDrift = o.cloudDrift;
    this.horizon.copy(o.horizon);
    this.horizonUp = o.horizonUp;
    this.horizonDown = o.horizonDown;
    this.stars = o.stars;
    this.starColor.copy(o.starColor);
  }
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export interface BackdropOpts {
  /** Height of the studio floor. The plate's top sits at y = 0. */
  groundY?: number;
  /** True when nothing downstream will tone-map or encode the frame. */
  direct: boolean;
  /** Sets the cloud octave budget. Defaults to the middle tier. */
  quality?: QualityTier;
}

export class Backdrop {
  readonly group = new THREE.Group();
  readonly sky: THREE.Mesh;
  readonly ground: THREE.Mesh;
  readonly contact: THREE.Mesh;

  private readonly skyMat: THREE.ShaderMaterial;
  private readonly groundMat: THREE.ShadowMaterial;
  private readonly contactMat: THREE.MeshBasicMaterial;
  private readonly owned: { dispose(): void }[] = [];

  // crossfade state — hoisted, applyPalette never allocates
  private fadeT = 1;
  private fadeDur = PALETTE_FADE;
  private readonly fromTop = new THREE.Color();
  private readonly toTop = new THREE.Color();
  private readonly fromBottom = new THREE.Color();
  private readonly toBottom = new THREE.Color();
  private readonly fromFloor = new THREE.Color();
  private readonly toFloor = new THREE.Color();
  private readonly fromGlow = new THREE.Color();
  private readonly toGlow = new THREE.Color();
  private readonly fromGround = new THREE.Color();
  private readonly toGround = new THREE.Color();
  private fromVig = 0;
  private toVig = 0;
  private fromPostVig = 0;
  private toPostVig = 0;
  /** Live crossfaded value of the finishing pass's vignette. */
  private postVig = 0;
  /** Authored contact-blob alpha, expressed on the composer path. */
  private contactAlpha = CONTACT_ALPHA;
  private paletteExposure = 1.05;
  /** Sweep colour immediately behind the plate; the blob blends over this. */
  private readonly behindPlate = new THREE.Color(0xe07a5f);

  // sky
  private tier: QualityTier;
  private skyOpen = false;
  private readonly fromSky = new SkyState();
  private readonly toSky = new SkyState();
  private readonly liveSky = new SkyState();
  /** Integrated, not `time * drift`, so a drift change does not jump. */
  private cloudPhase = 0;

  constructor(opts: BackdropOpts) {
    this.group.name = 'cyclorama';
    this.tier = opts.quality ?? 'medium';
    const inIn = acesInMatrixInverse();
    const outIn = acesOutMatrixInverse();

    const skyGeo = new THREE.SphereGeometry(1, 32, 20);
    this.skyMat = new THREE.ShaderMaterial({
      name: 'cyclorama',
      vertexShader: VERT,
      fragmentShader: buildFrag(false, 0, 0, false),
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      toneMapped: false,
      uniforms: {
        uTop: { value: new THREE.Color(0xffe7c4) },
        uBottom: { value: new THREE.Color(0xe07a5f) },
        uFloor: { value: new THREE.Color(0xb4523c) },
        uGlow: { value: new THREE.Color(0xfff1dc) },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uRange: { value: new THREE.Vector2(-0.1, 1.04) },
        uParallax: { value: 0.18 },
        uGlowStrength: { value: 0.14 },
        uVignette: { value: 0.22 },
        uPostVignette: { value: 0 },
        uDirect: { value: opts.direct ? 1 : 0 },
        uExposure: { value: 1.05 },
        uAcesInInv: { value: inIn },
        uAcesOutInv: { value: outIn },
        // --- sky; inert until a palette brings one ---
        uSkyAmount: { value: 0 },
        uSweepToRad: { value: 0.75 },
        uSunDir: { value: new THREE.Vector2(0, 1) },
        uSunSweep: { value: SKY_HORIZON },
        uSunSize: { value: new THREE.Vector2(SUN_RADIUS * 0.7, SUN_RADIUS * 1.35) },
        uSunAmt: { value: 0 },
        uSunTint: { value: new THREE.Color(0xffffff) },
        uSunLin: { value: new THREE.Color(0, 0, 0) },
        uGlowColor: { value: new THREE.Color(0xffffff) },
        uGlowSpread: { value: 1 },
        uCloudLit: { value: new THREE.Color(0xffffff) },
        uCloudShade: { value: new THREE.Color(0x808080) },
        uCloudCover: { value: 0 },
        uCloudOffset: { value: new THREE.Vector2(0, 0) },
        uHorizonColor: { value: new THREE.Color(0xffffff) },
        uHorizonBand: { value: new THREE.Vector2(0.12, 0.16) },
        uStars: { value: 0 },
        uStarColor: { value: new THREE.Color(0xffffff) },
      },
    });
    this.sky = new THREE.Mesh(skyGeo, this.skyMat);
    this.sky.scale.setScalar(SKY_RADIUS);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1000;
    this.sky.matrixAutoUpdate = true;
    this.owned.push(skyGeo, this.skyMat);

    // --- floor: shadow catcher only, never a visible surface -------------
    // ShadowMaterial draws nothing except what the key light darkens, so the
    // sweep runs uninterrupted from the top of the frame to the bottom. It is
    // only ever visible on the composer tiers (LOW has no shadows at all),
    // which is why its alpha needs no direct-path correction.
    const groundGeo = new THREE.CircleGeometry(SHADOW_CATCHER_RADIUS, 48);
    this.groundMat = new THREE.ShadowMaterial({
      color: 0x000000,
      opacity: 0.34,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    this.ground = new THREE.Mesh(groundGeo, this.groundMat);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = opts.groundY ?? -0.52;
    this.ground.receiveShadow = true;
    this.ground.renderOrder = -2;
    this.owned.push(groundGeo, this.groundMat);

    // --- contact shadow ----------------------------------------------------
    const contactGeo = new THREE.CircleGeometry(1, 32);
    const blob = paintBlob(128, 0.34);
    this.contactMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      map: blob ?? undefined,
      transparent: true,
      opacity: CONTACT_ALPHA,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    });
    this.contact = new THREE.Mesh(contactGeo, this.contactMat);
    this.contact.rotation.x = -Math.PI / 2;
    this.contact.position.y = (opts.groundY ?? -0.52) + 0.012;
    this.contact.scale.setScalar(2.9);
    this.contact.renderOrder = -1;
    this.owned.push(contactGeo, this.contactMat);
    if (blob) this.owned.push(blob);

    this.group.add(this.sky, this.ground, this.contact);
  }

  /** Tell the sweep whether it is writing the final pixel or feeding a composer. */
  setDirect(direct: boolean): void {
    this.skyMat.uniforms.uDirect.value = direct ? 1 : 0;
    this.syncPathDependent();
  }

  private get direct(): boolean {
    return (this.skyMat.uniforms.uDirect.value as number) > 0.5;
  }

  /**
   * Cloud octave budget. Recompiles only when the tier actually moves and the
   * sky is open; a studio theme never pays for a program it does not use.
   */
  setQuality(tier: QualityTier): void {
    if (tier === this.tier) return;
    this.tier = tier;
    if (this.skyOpen) this.compileVariant(true);
  }

  private compileVariant(open: boolean): void {
    const t = SKY_TIERS[this.tier];
    this.skyMat.fragmentShader = buildFrag(open, t.octaves, t.warp, t.lit);
    this.skyMat.needsUpdate = true;
    this.skyOpen = open;
  }

  /**
   * Everything whose correct value depends on whether a tone mapper runs after
   * us: the stand-in vignette, and the contact blob's alpha.
   */
  private syncPathDependent(): void {
    this.skyMat.uniforms.uPostVignette.value = this.direct ? this.postVig : 0;
    this.contactMat.opacity = this.direct
      ? directOverlayAlpha(this.behindPlate, this.contactAlpha, this.paletteExposure)
      : this.contactAlpha;
    this.contact.visible = this.contactAlpha > 0.001;
  }

  /** Base exposure, i.e. before any flash punch. */
  setExposure(exposure: number): void {
    this.skyMat.uniforms.uExposure.value = exposure;
  }

  /**
   * Window the gradient spans, in sweep units (0 = bottom of frame, 1 = top,
   * plus `parallax` times the view direction's Y).
   */
  setGradientRange(low: number, high: number, parallax?: number): void {
    (this.skyMat.uniforms.uRange.value as THREE.Vector2).set(low, high);
    if (parallax !== undefined) this.skyMat.uniforms.uParallax.value = parallax;
  }

  /** Hide the studio floor when a theme brings its own table or tatami. */
  setGroundVisible(visible: boolean): void {
    this.ground.visible = visible;
  }

  setGroundY(y: number): void {
    this.ground.position.y = y;
    this.contact.position.y = y + 0.012;
  }

  /** Size and darkness of the blob under the plate. */
  setContactShadow(radius: number, strength: number): void {
    this.contact.scale.setScalar(Math.max(0.001, radius));
    this.contactAlpha = THREE.MathUtils.clamp(strength, 0, 1);
    this.syncPathDependent();
  }

  setSize(width: number, height: number): void {
    (this.skyMat.uniforms.uResolution.value as THREE.Vector2).set(width, height);
  }

  applyPalette(p: ThemePaletteLike, duration = PALETTE_FADE): void {
    const u = this.skyMat.uniforms;
    this.fromTop.copy(u.uTop.value as THREE.Color);
    this.fromBottom.copy(u.uBottom.value as THREE.Color);
    this.fromFloor.copy(u.uFloor.value as THREE.Color);
    this.fromGlow.copy(u.uGlow.value as THREE.Color);
    this.fromGround.copy(this.groundMat.color);
    this.fromVig = u.uVignette.value as number;
    this.fromPostVig = this.postVig;
    this.fromSky.copy(this.liveSky);

    this.toTop.setHex(p.bgTop, THREE.SRGBColorSpace);
    this.toBottom.setHex(p.bgBottom, THREE.SRGBColorSpace);
    this.toFloor.setHex(p.ground, THREE.SRGBColorSpace);
    this.toGlow.setHex(p.key, THREE.SRGBColorSpace);
    // A cast shadow on a warm sweep is not neutral black; it keeps a little of
    // the theme's floor colour in it.
    this.toGround.setHex(p.ground, THREE.SRGBColorSpace).lerp(BLACK, 0.6);
    this.toVig = p.vignette * 0.6;
    this.toPostVig = p.vignette;
    this.resolveSky(p, this.toSky);

    // The blob blends over the bottom of the sweep, which is bgBottom pulled
    // partway toward the floor tint by the roll-off in the shader.
    this.behindPlate.setHex(p.bgBottom, THREE.SRGBColorSpace);
    this.behindPlate.lerp(TMP_GROUND.setHex(p.ground, THREE.SRGBColorSpace), 0.3);
    this.paletteExposure = p.exposure;

    // Either end of the fade needs the sky program; only when both ends are
    // studio can the plain sweep run, and it must, byte for byte.
    if (this.fromSky.amount > 0 || this.toSky.amount > 0) {
      if (!this.skyOpen) this.compileVariant(true);
    }

    this.setExposure(p.exposure);
    this.fadeDur = Math.max(0, duration);
    this.fadeT = 0;
    if (this.fadeDur === 0) this.commit(1);
  }

  /**
   * Palette -> shader units. A studio palette keeps whatever colours are
   * already loaded and simply fades `amount` to zero, so a swap out of an open
   * sky dissolves instead of lerping toward nothing.
   */
  private resolveSky(p: ThemePaletteLike, out: SkyState): void {
    const s = p.sky;
    if (!s || s.kind !== 'open') {
      out.copy(this.fromSky);
      out.amount = 0;
      out.cloudDrift = 0;
      return;
    }
    out.amount = 1;
    out.sunDir.set(Math.sin(s.sunAzimuth), Math.cos(s.sunAzimuth));
    const elev = THREE.MathUtils.clamp(s.sunElevation, -0.1, Math.PI / 2);
    out.sunSweep = SKY_HORIZON + (elev / (Math.PI / 2)) * SKY_SPAN;

    const intensity = Math.max(0, s.sunIntensity);
    out.sunAmt = THREE.MathUtils.clamp(intensity, 0, 1);
    // The core of any sun reads white; the authored hue survives at the rim
    // and, much more visibly, in the glow.
    out.sunTint.setHex(s.sunColor, THREE.SRGBColorSpace).lerp(WHITE, 0.5);
    out.sunLin
      .setHex(s.sunColor, THREE.SRGBColorSpace)
      .multiplyScalar(sunLinearScale(p) * intensity);

    out.glow.setHex(s.glowColor, THREE.SRGBColorSpace);
    out.glowSpread = Math.max(0.05, s.glowSpread);

    out.cloudLit.setHex(s.cloudColor, THREE.SRGBColorSpace);
    const shade = THREE.MathUtils.clamp(s.cloudShadow, 0, 1);
    out.cloudShade
      .copy(out.cloudLit)
      .multiplyScalar(1 - shade * 0.62)
      // A cloud base is not just a darker cloud; it picks up the haze under
      // it, and at 0.3 of that the diner's cumulus came out neutral grey and
      // read as rain against a golden sky.
      .lerp(TMP_HAZE.setHex(s.horizonColor, THREE.SRGBColorSpace), shade * 0.5);
    out.cloudCover = THREE.MathUtils.clamp(s.cloudCover, 0, 1);
    out.cloudDrift = s.cloudDrift;

    out.horizon.setHex(s.horizonColor, THREE.SRGBColorSpace);
    const soft = THREE.MathUtils.clamp(s.horizonSoftness, 0, 1);
    out.horizonUp = lerp(0.045, 0.22, soft);
    out.horizonDown = lerp(0.1, 0.26, soft);

    out.stars = THREE.MathUtils.clamp(s.stars, 0, 1);
    out.starColor.setHex(s.glowColor, THREE.SRGBColorSpace).lerp(WHITE, 0.75);
  }

  private commit(t: number): void {
    const u = this.skyMat.uniforms;
    (u.uTop.value as THREE.Color).lerpColors(this.fromTop, this.toTop, t);
    (u.uBottom.value as THREE.Color).lerpColors(this.fromBottom, this.toBottom, t);
    (u.uFloor.value as THREE.Color).lerpColors(this.fromFloor, this.toFloor, t);
    (u.uGlow.value as THREE.Color).lerpColors(this.fromGlow, this.toGlow, t);
    this.groundMat.color.lerpColors(this.fromGround, this.toGround, t);
    u.uVignette.value = this.fromVig + (this.toVig - this.fromVig) * t;
    this.postVig = this.fromPostVig + (this.toPostVig - this.fromPostVig) * t;
    this.commitSky(t);
    this.syncPathDependent();
    this.fadeT = t;
  }

  private commitSky(t: number): void {
    if (!this.skyOpen) return;
    const a = this.fromSky;
    const b = this.toSky;
    const s = this.liveSky;

    s.amount = lerp(a.amount, b.amount, t);
    s.sunDir.lerpVectors(a.sunDir, b.sunDir, t);
    if (s.sunDir.lengthSq() > 1e-6) s.sunDir.normalize();
    s.sunSweep = lerp(a.sunSweep, b.sunSweep, t);
    s.sunAmt = lerp(a.sunAmt, b.sunAmt, t);
    s.sunTint.lerpColors(a.sunTint, b.sunTint, t);
    s.sunLin.lerpColors(a.sunLin, b.sunLin, t);
    s.glow.lerpColors(a.glow, b.glow, t);
    s.glowSpread = lerp(a.glowSpread, b.glowSpread, t);
    s.cloudLit.lerpColors(a.cloudLit, b.cloudLit, t);
    s.cloudShade.lerpColors(a.cloudShade, b.cloudShade, t);
    s.cloudCover = lerp(a.cloudCover, b.cloudCover, t);
    s.cloudDrift = lerp(a.cloudDrift, b.cloudDrift, t);
    s.horizon.lerpColors(a.horizon, b.horizon, t);
    s.horizonUp = lerp(a.horizonUp, b.horizonUp, t);
    s.horizonDown = lerp(a.horizonDown, b.horizonDown, t);
    s.stars = lerp(a.stars, b.stars, t);
    s.starColor.lerpColors(a.starColor, b.starColor, t);

    const u = this.skyMat.uniforms;
    u.uSkyAmount.value = s.amount;
    (u.uSunDir.value as THREE.Vector2).copy(s.sunDir);
    u.uSunSweep.value = s.sunSweep;
    u.uSunAmt.value = s.sunAmt;
    (u.uSunTint.value as THREE.Color).copy(s.sunTint);
    (u.uSunLin.value as THREE.Color).copy(s.sunLin);
    (u.uGlowColor.value as THREE.Color).copy(s.glow);
    u.uGlowSpread.value = s.glowSpread;
    (u.uCloudLit.value as THREE.Color).copy(s.cloudLit);
    (u.uCloudShade.value as THREE.Color).copy(s.cloudShade);
    u.uCloudCover.value = s.cloudCover;
    (u.uHorizonColor.value as THREE.Color).copy(s.horizon);
    (u.uHorizonBand.value as THREE.Vector2).set(s.horizonUp, s.horizonDown);
    u.uStars.value = s.stars;
    (u.uStarColor.value as THREE.Color).copy(s.starColor);

    // Fade finished on a studio palette: drop back to the plain sweep, which
    // is the only way to promise byte-identical output rather than approximate
    // it with a multiply by zero.
    if (t >= 1 && b.amount === 0) this.compileVariant(false);
  }

  /**
   * @param camera the sweep is pinned to the camera so it never shows an edge,
   * a seam or a horizon no matter how high the tower gets.
   */
  update(dt: number, camera: THREE.Camera): void {
    if (this.fadeT < 1 && this.fadeDur > 0) {
      this.commit(Math.min(1, this.fadeT + dt / this.fadeDur));
    }
    this.sky.position.copy(camera.position);
    if (!this.skyOpen) return;

    // The deck is the only thing in the sky that moves, and it is what stops
    // the world reading as a painting. Integrated rather than time * drift so
    // a crossfade between two drift rates does not teleport the clouds.
    this.cloudPhase += dt * this.liveSky.cloudDrift;
    if (this.cloudPhase > CLOUD_WRAP) this.cloudPhase -= CLOUD_WRAP;
    (this.skyMat.uniforms.uCloudOffset.value as THREE.Vector2).set(
      this.cloudPhase,
      this.cloudPhase * 0.32,
    );
    this.skyMat.uniforms.uSweepToRad.value = sweepToRadians(
      camera,
      this.skyMat.uniforms.uParallax.value as number,
    );
  }

  dispose(): void {
    for (let i = 0; i < this.owned.length; i++) this.owned[i].dispose();
    this.owned.length = 0;
    this.group.clear();
  }
}

const BLACK = /* @__PURE__ */ new THREE.Color(0x000000);
const WHITE = /* @__PURE__ */ new THREE.Color(0xffffff);
const TMP_GROUND = /* @__PURE__ */ new THREE.Color();
const TMP_HAZE = /* @__PURE__ */ new THREE.Color();
const TMP_FWD = /* @__PURE__ */ new THREE.Vector3();

/**
 * Radians of screen angle per unit of `sweep`, at the centre of the frame.
 *
 * The sun has to be round, and it is placed with a bearing across (true
 * radians) and a sweep value up (a frame coordinate). Without this conversion
 * the disc comes out as a heavily stretched ellipse, and the stars come out in
 * vertical stripes. Derived from the live camera rather than hard-coded so it
 * stays right when the rig changes FOV or the parallax term is retuned.
 */
function sweepToRadians(camera: THREE.Camera, parallax: number): number {
  const persp = camera as THREE.PerspectiveCamera;
  const fov = persp.isPerspectiveCamera ? persp.fov : 46;
  TMP_FWD.set(0, 0, -1).applyQuaternion(camera.quaternion);
  const pitch = Math.asin(THREE.MathUtils.clamp(-TMP_FWD.y, -1, 1));
  // d(ray elevation) / d(uv.y) at frame centre.
  const dThetaDuv = 2 * Math.tan(THREE.MathUtils.degToRad(fov) * 0.5);
  const dSweepDuv = 1 + parallax * Math.cos(pitch) * dThetaDuv;
  return dThetaDuv / Math.max(dSweepDuv, 1e-4);
}

export function createBackdrop(opts: BackdropOpts): Backdrop {
  return new Backdrop(opts);
}

/** Exported for the probe harness and for anything that wants to reason about
 * where the sky's horizon falls in sweep units. */
export const SKY_LEVELS = { horizon: SKY_HORIZON, zenith: SKY_ZENITH } as const;

/** Value-noise fetches per pixel at each tier. Reported, not guessed. */
export function skyNoiseBudget(tier: QualityTier): number {
  const t = SKY_TIERS[tier];
  return t.octaves + t.warp + (t.lit ? 1 : 0);
}

export type { SkyConfig };
