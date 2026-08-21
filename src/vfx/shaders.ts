/**
 * GLSL for the Snackery VFX system.
 *
 * ARCHITECTURE NOTE — every particle class shares one instance attribute
 * layout so that `ParticlePool` can stay generic:
 *
 *   aStart  vec3   spawn position (world space)
 *   aVel    vec3   spawn velocity (world space)   [rings: (r0, r1, thickness)]
 *   aColor  vec3   linear-space colour
 *   aParams vec4   (birthTime, life, size, seed)
 *   aDyn    vec4   (gravity, drag, x, y)  -- x/y are per-class extras
 *
 * The CPU writes those five attributes ONCE at emission. Every frame after
 * that the vertex shader advances the particle from a single `uTime` uniform,
 * so the per-frame CPU cost of a live particle is exactly zero.
 *
 * `birthTime` may be in the FUTURE: a particle whose age is negative collapses
 * to a degenerate triangle. That gives us free, allocation-free scheduling —
 * the staggered rings, the rising glint column and the confetti rain are all
 * emitted in a single call and simply switch themselves on later.
 */

/** Attribute/uniform declarations + integration helpers, prepended to every vertex shader. */
const COMMON = /* glsl */ `
uniform float uTime;

attribute vec3 aStart;
attribute vec3 aVel;
attribute vec3 aColor;
attribute vec4 aParams;
attribute vec4 aDyn;

const float VFX_TAU = 6.2831853;

float vfxHash(float p) {
  return fract(sin(p * 127.1 + 0.37) * 43758.5453123);
}

/** Exact closed form of  x'' = -g*y  with linear drag  -k*x'. */
vec3 vfxIntegrate(vec3 p0, vec3 v0, float g, float k, float t) {
  vec3 acc = vec3(0.0, -g, 0.0);
  if (k > 0.001) {
    vec3 term = acc / k;
    return p0 + (v0 - term) * (1.0 - exp(-k * t)) / k + term * t;
  }
  return p0 + v0 * t + 0.5 * acc * t * t;
}

/** Velocity of the same solution at time t (used to stretch droplets). */
vec3 vfxVelocity(vec3 v0, float g, float k, float t) {
  vec3 acc = vec3(0.0, -g, 0.0);
  if (k > 0.001) {
    vec3 term = acc / k;
    return (v0 - term) * exp(-k * t) + term;
  }
  return v0 + acc * t;
}

/** Fade in over the first 8% of life, out over the last 35%. Never pops. */
float vfxFade(float u) {
  return smoothstep(0.0, 0.08, u) * (1.0 - smoothstep(0.65, 1.0, u));
}

mat3 vfxRot(vec3 axis, float angle) {
  vec3 a = normalize(axis);
  float c = cos(angle);
  float s = sin(angle);
  float t = 1.0 - c;
  return mat3(
    t * a.x * a.x + c,       t * a.x * a.y + s * a.z, t * a.x * a.z - s * a.y,
    t * a.x * a.y - s * a.z, t * a.y * a.y + c,       t * a.y * a.z + s * a.x,
    t * a.x * a.z + s * a.y, t * a.y * a.z - s * a.x, t * a.z * a.z + c
  );
}

/** Warm key at ~35 degrees, matching the studio rig in the design bible. */
const vec3 VFX_KEY = vec3(0.4544, 0.8280, 0.3271);
const vec3 VFX_FILL = vec3(-0.4867, 0.2434, -0.8390);
`;

/* ------------------------------------------------------------------ crumbs */

export const CRUMB_VERT = /* glsl */ `
${COMMON}
varying vec3 vColor;
varying float vAlpha;
varying float vShade;
#include <fog_pars_vertex>

void main() {
  float age = uTime - aParams.x;
  float life = max(aParams.y, 0.0001);
  float u = age / life;
  if (age < 0.0 || u >= 1.0) {
    vColor = vec3(0.0);
    vAlpha = 0.0;
    vShade = 0.0;
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    return;
  }

  float seed = aParams.w;
  vec3 centre = vfxIntegrate(aStart, aVel, aDyn.x, aDyn.y, age);

  vec3 axis = vec3(
    vfxHash(seed) - 0.5,
    vfxHash(seed + 7.31) - 0.5,
    vfxHash(seed + 19.77) - 0.5
  ) + vec3(0.013, 0.021, 0.007);
  mat3 spin = vfxRot(axis, aDyn.z * age + seed * VFX_TAU);

  float grow = min(1.0, 0.4 + u * 14.0);
  float size = aParams.z * grow * (1.0 - 0.45 * smoothstep(0.68, 1.0, u));

  vec3 nrm = spin * normal;
  vShade = 0.34 + 0.74 * max(dot(nrm, VFX_KEY), 0.0)
                + 0.20 * max(dot(nrm, VFX_FILL), 0.0);
  vColor = aColor;
  vAlpha = vfxFade(u);

  vec4 mvPosition = modelViewMatrix * vec4(centre + spin * (position * size), 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

export const CRUMB_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
varying float vShade;
#include <fog_pars_fragment>

void main() {
  if (vAlpha <= 0.002) discard;
  gl_FragColor = vec4(vColor * vShade, vAlpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/* ------------------------------------------------- glints / sparkle / flash */

export const GLOW_VERT = /* glsl */ `
${COMMON}
varying vec3 vColor;
varying float vAlpha;
varying vec2 vUv;

void main() {
  float age = uTime - aParams.x;
  float life = max(aParams.y, 0.0001);
  float u = age / life;
  if (age < 0.0 || u >= 1.0) {
    vColor = vec3(0.0);
    vAlpha = 0.0;
    vUv = vec2(0.5);
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    return;
  }

  float seed = aParams.w;
  float phase = seed * VFX_TAU;
  vec3 centre = vfxIntegrate(aStart, aVel, aDyn.x, aDyn.y, age);

  float twinkle = 0.62 + 0.38 * sin(age * aDyn.z + phase);
  float pop = smoothstep(0.0, 0.10, u);
  float size = aParams.z * pop * (0.82 + 0.30 * twinkle)
             * (1.0 - 0.34 * smoothstep(0.5, 1.0, u));

  float ang = aDyn.w * age + phase;
  float c = cos(ang);
  float s = sin(ang);
  vec2 q = vec2(position.x * c - position.y * s, position.x * s + position.y * c) * size;

  vec4 mvPosition = modelViewMatrix * vec4(centre, 1.0);
  mvPosition.xy += q;
  gl_Position = projectionMatrix * mvPosition;

  vUv = uv;
  vColor = aColor;
  vAlpha = vfxFade(u) * twinkle;
}
`;

export const GLOW_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform float uIntensity;
varying vec3 vColor;
varying float vAlpha;
varying vec2 vUv;

void main() {
  float mask = texture2D(uMap, vUv).a;
  if (mask <= 0.003 || vAlpha <= 0.002) discard;
  float core = mask * mask * mask;
  vec3 rgb = (vColor * mask + vec3(core) * 0.45) * uIntensity;
  // Additive blending multiplies rgb by alpha, so the fade lives in alpha.
  gl_FragColor = vec4(rgb, vAlpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/* ---------------------------------------------------------------- droplets */

export const DROP_VERT = /* glsl */ `
${COMMON}
varying vec3 vColor;
varying float vAlpha;
varying vec2 vUv;
#include <fog_pars_vertex>

void main() {
  float age = uTime - aParams.x;
  float life = max(aParams.y, 0.0001);
  float u = age / life;
  if (age < 0.0 || u >= 1.0) {
    vColor = vec3(0.0);
    vAlpha = 0.0;
    vUv = vec2(0.5);
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    return;
  }

  vec3 centre = vfxIntegrate(aStart, aVel, aDyn.x, aDyn.y, age);
  vec3 vel = vfxVelocity(aVel, aDyn.x, aDyn.y, age);

  vec4 mvPosition = modelViewMatrix * vec4(centre, 1.0);
  vec3 mvVel = mat3(modelViewMatrix) * vel;

  float planar = length(mvVel.xy);
  vec2 ay = planar > 0.0001 ? mvVel.xy / planar : vec2(0.0, 1.0);
  vec2 ax = vec2(ay.y, -ay.x);

  float stretch = clamp(1.0 + length(vel) * aDyn.z, 1.0, 4.2);
  float grow = min(1.0, 0.45 + u * 16.0);
  float size = aParams.z * grow * (1.0 - 0.28 * smoothstep(0.6, 1.0, u));

  mvPosition.xy += ax * (position.x * size) + ay * (position.y * size * stretch);
  gl_Position = projectionMatrix * mvPosition;

  vUv = uv;
  vColor = aColor;
  vAlpha = vfxFade(u);
  #include <fog_vertex>
}
`;

export const DROP_FRAG = /* glsl */ `
uniform sampler2D uMap;
varying vec3 vColor;
varying float vAlpha;
varying vec2 vUv;
#include <fog_pars_fragment>

void main() {
  vec4 tex = texture2D(uMap, vUv);
  float mask = tex.a;
  if (mask <= 0.01 || vAlpha <= 0.002) discard;
  float gloss = tex.r;
  vec3 rgb = vColor * (0.42 + 0.80 * gloss) + vec3(pow(gloss, 5.0)) * 0.9;
  gl_FragColor = vec4(rgb, mask * vAlpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/* ---------------------------------------------------------------- confetti */

export const CONFETTI_VERT = /* glsl */ `
${COMMON}
varying vec3 vColor;
varying float vAlpha;
varying float vShade;
#include <fog_pars_vertex>

void main() {
  float age = uTime - aParams.x;
  float life = max(aParams.y, 0.0001);
  float u = age / life;
  if (age < 0.0 || u >= 1.0) {
    vColor = vec3(0.0);
    vAlpha = 0.0;
    vShade = 0.0;
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    return;
  }

  float seed = aParams.w;
  float phase = seed * VFX_TAU;
  vec3 centre = vfxIntegrate(aStart, aVel, aDyn.x, aDyn.y, age);

  // Paper flutters sideways as it falls.
  float sway = aDyn.z;
  centre.x += sin(age * (2.3 + seed * 2.1) + phase) * sway;
  centre.z += cos(age * (1.9 + seed * 1.7) + phase * 1.3) * sway;

  float spin = aDyn.w * age + phase;
  mat3 tumble = vfxRot(vec3(0.35, 0.0, 1.0), spin * 1.6 + phase)
              * vfxRot(vec3(0.0, 1.0, 0.0), spin);

  float size = aParams.z * min(1.0, 0.3 + u * 12.0);
  vec3 local = tumble * vec3(position.x * size * 0.58, position.y * size, 0.0);
  vec3 nrm = tumble * vec3(0.0, 0.0, 1.0);

  vShade = 0.40 + 0.78 * abs(dot(nrm, VFX_KEY)) + 0.16 * abs(dot(nrm, VFX_FILL));
  vColor = aColor;
  vAlpha = vfxFade(u);

  vec4 mvPosition = modelViewMatrix * vec4(centre + local, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

export const CONFETTI_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
varying float vShade;
#include <fog_pars_fragment>

void main() {
  if (vAlpha <= 0.002) discard;
  float face = gl_FrontFacing ? 1.0 : 0.52;
  gl_FragColor = vec4(vColor * vShade * face, vAlpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/* ------------------------------------------------------------------- rings */

export const RING_VERT = /* glsl */ `
${COMMON}
varying vec2 vLocal;
varying float vRadius;
varying float vThick;
varying vec3 vColor;
varying float vAlpha;

void main() {
  float age = uTime - aParams.x;
  float life = max(aParams.y, 0.0001);
  float u = age / life;
  if (age < 0.0 || u >= 1.0) {
    vLocal = vec2(0.0);
    vRadius = 1.0;
    vThick = 1.0;
    vColor = vec3(0.0);
    vAlpha = 0.0;
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    return;
  }

  float ease = 1.0 - pow(1.0 - u, 3.0);
  float radius = mix(aVel.x, aVel.y, ease);
  float thick = max(aVel.z * (0.32 + 0.95 * (1.0 - u)), 0.001);
  float extent = radius + thick * 2.4 + 0.02;

  vec2 local = position.xy * 2.0 * extent;
  vLocal = local;
  vRadius = radius;
  vThick = thick;
  vColor = aColor;
  vAlpha = aParams.z * smoothstep(0.0, 0.05, u) * pow(1.0 - u, 1.6);

  vec4 mvPosition;
  if (aDyn.x < 0.5) {
    // 'flat' — lies on the XZ plane.
    mvPosition = modelViewMatrix * vec4(aStart + vec3(local.x, 0.0, local.y), 1.0);
  } else {
    // 'billboard' — faces the camera.
    mvPosition = modelViewMatrix * vec4(aStart, 1.0);
    mvPosition.xy += local;
  }
  gl_Position = projectionMatrix * mvPosition;
}
`;

export const RING_FRAG = /* glsl */ `
varying vec2 vLocal;
varying float vRadius;
varying float vThick;
varying vec3 vColor;
varying float vAlpha;

void main() {
  if (vAlpha <= 0.002) discard;
  // Gaussian band around the radius: soft on both sides, no aliased rim.
  float d = (length(vLocal) - vRadius) / vThick;
  float band = exp(-d * d * 2.1);
  if (band <= 0.004) discard;
  vec3 rgb = vColor * band + vec3(band * band * band) * 0.5;
  gl_FragColor = vec4(rgb, vAlpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
