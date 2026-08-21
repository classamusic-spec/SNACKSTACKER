import * as THREE from 'three';
import type { ThemePaletteLike } from './api';
import { PALETTE_FADE } from './palette';
import { GLSL_ACES_INVERSE, GLSL_DITHER, GLSL_SRGB } from './shaders';
import { makeSurface } from './surface';
import { acesInMatrixInverse, acesOutMatrixInverse, directOverlayAlpha } from './tonemap';

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
 */

const SKY_RADIUS = 100;
/** Only has to be wide enough to catch the key light's shadow. */
const SHADOW_CATCHER_RADIUS = 14;
/** Alpha of the plate's contact blob on the composer path. */
const CONTACT_ALPHA = 0.4;

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize( position );
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}
`;

const FRAG = /* glsl */ `
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

varying vec3 vDir;

${GLSL_ACES_INVERSE}
${GLSL_SRGB}
${GLSL_DITHER}

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
    col = clamp( col * glow * vig, 0.0, 1.0 );
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
    col = acesInverse( col, uExposure, uAcesInInv, uAcesOutInv ) * glow * vig;
  }

  gl_FragColor = vec4( col, 1.0 );
}
`;

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

export interface BackdropOpts {
  /** Height of the studio floor. The plate's top sits at y = 0. */
  groundY?: number;
  /** True when nothing downstream will tone-map or encode the frame. */
  direct: boolean;
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

  constructor(opts: BackdropOpts) {
    this.group.name = 'cyclorama';
    const inIn = acesInMatrixInverse();
    const outIn = acesOutMatrixInverse();

    const skyGeo = new THREE.SphereGeometry(1, 32, 20);
    this.skyMat = new THREE.ShaderMaterial({
      name: 'cyclorama',
      vertexShader: VERT,
      fragmentShader: FRAG,
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

    this.toTop.setHex(p.bgTop, THREE.SRGBColorSpace);
    this.toBottom.setHex(p.bgBottom, THREE.SRGBColorSpace);
    this.toFloor.setHex(p.ground, THREE.SRGBColorSpace);
    this.toGlow.setHex(p.key, THREE.SRGBColorSpace);
    // A cast shadow on a warm sweep is not neutral black; it keeps a little of
    // the theme's floor colour in it.
    this.toGround.setHex(p.ground, THREE.SRGBColorSpace).lerp(BLACK, 0.6);
    this.toVig = p.vignette * 0.6;
    this.toPostVig = p.vignette;

    // The blob blends over the bottom of the sweep, which is bgBottom pulled
    // partway toward the floor tint by the roll-off in the shader.
    this.behindPlate.setHex(p.bgBottom, THREE.SRGBColorSpace);
    this.behindPlate.lerp(TMP_GROUND.setHex(p.ground, THREE.SRGBColorSpace), 0.3);
    this.paletteExposure = p.exposure;

    this.setExposure(p.exposure);
    this.fadeDur = Math.max(0, duration);
    this.fadeT = 0;
    if (this.fadeDur === 0) this.commit(1);
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
    this.syncPathDependent();
    this.fadeT = t;
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
  }

  dispose(): void {
    for (let i = 0; i < this.owned.length; i++) this.owned[i].dispose();
    this.owned.length = 0;
    this.group.clear();
  }
}

const BLACK = /* @__PURE__ */ new THREE.Color(0x000000);
const TMP_GROUND = /* @__PURE__ */ new THREE.Color();

export function createBackdrop(opts: BackdropOpts): Backdrop {
  return new Backdrop(opts);
}
