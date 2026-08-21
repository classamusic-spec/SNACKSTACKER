/**
 * GLSL fragments shared by the backdrop and the finishing pass.
 *
 * Two of these are worth explaining. When post-processing is on, the scene is
 * rendered into a linear HDR buffer and three deliberately skips tone mapping
 * and colour encoding (it only applies them when drawing straight to the
 * canvas), so the finishing pass has to do both — `acesFilmic` below is a
 * character-for-character copy of three's ACES so the two code paths agree.
 * `acesInverse` runs it backwards: the cyclorama pre-divides itself by the
 * curve so that after the finishing pass it lands on the exact palette hex
 * instead of being tone-mapped into mush.
 */

export const GLSL_ACES = /* glsl */ `
const mat3 ACES_IN = mat3(
  vec3( 0.59719, 0.07600, 0.02840 ),
  vec3( 0.35458, 0.90834, 0.13383 ),
  vec3( 0.04823, 0.01566, 0.83777 )
);
const mat3 ACES_OUT = mat3(
  vec3(  1.60475, -0.10208, -0.00327 ),
  vec3( -0.53108,  1.10813, -0.07276 ),
  vec3( -0.07367, -0.00605,  1.07602 )
);

vec3 rrtAndOdtFit( vec3 v ) {
  vec3 a = v * ( v + 0.0245786 ) - 0.000090537;
  vec3 b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081;
  return a / b;
}

vec3 acesFilmic( vec3 color, float exposure ) {
  color *= exposure / 0.6;
  color = ACES_IN * color;
  color = rrtAndOdtFit( color );
  color = ACES_OUT * color;
  return clamp( color, 0.0, 1.0 );
}
`;

export const GLSL_ACES_INVERSE = /* glsl */ `
vec3 rrtAndOdtFitInverse( vec3 y ) {
  vec3 a = 1.0 - 0.983729 * y;
  vec3 b = 0.0245786 - 0.4329510 * y;
  vec3 c = -( 0.000090537 + 0.238081 * y );
  vec3 disc = max( b * b - 4.0 * a * c, vec3( 0.0 ) );
  return ( -b + sqrt( disc ) ) / ( 2.0 * a );
}

// inIn / outIn are the inverses of ACES_IN / ACES_OUT, supplied as uniforms so
// there are no transcribed magic numbers to drift out of sync.
vec3 acesInverse( vec3 target, float exposure, mat3 inIn, mat3 outIn ) {
  vec3 v = outIn * clamp( target, vec3( 0.0 ), vec3( 0.995 ) );
  v = rrtAndOdtFitInverse( v );
  vec3 lin = inIn * v;
  return max( lin, vec3( 0.0 ) ) * ( 0.6 / max( exposure, 0.0001 ) );
}
`;

export const GLSL_SRGB = /* glsl */ `
vec3 encodeSRGB( vec3 c ) {
  c = max( c, vec3( 0.0 ) );
  return mix( c * 12.92, 1.055 * pow( c, vec3( 0.41666 ) ) - 0.055, step( vec3( 0.0031308 ), c ) );
}
`;

/**
 * Interleaved-gradient-ish hash plus a triangular-PDF dither. A smooth gradient
 * quantised to 8 bits bands visibly, and banding is the single fastest way to
 * make a premium render look cheap.
 */
export const GLSL_DITHER = /* glsl */ `
float hash12( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.x + p3.y ) * p3.z );
}

vec3 ditherTPDF( vec3 c, vec2 seed, float amount ) {
  float r1 = hash12( seed );
  float r2 = hash12( seed + vec2( 17.317, 5.113 ) );
  return c + ( r1 + r2 - 1.0 ) * amount;
}
`;

export const GLSL_FULLSCREEN_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}
`;
