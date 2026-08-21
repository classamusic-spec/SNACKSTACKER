import * as THREE from 'three';
import type { ThemePaletteLike } from './api';
import { PALETTE_FADE } from './palette';
import { GLSL_ACES_INVERSE, GLSL_DITHER, GLSL_SRGB } from './shaders';
import { makeSurface } from './surface';

/**
 * The cyclorama.
 *
 * A photographer's sweep has no horizon line, no corner and no seam — just a
 * lit gradient that the subject floats in front of. That is an inverted sphere
 * pinned to the camera with a hand-written gradient: bgTop above, bgBottom
 * below, a warm pool of light behind the hero, a radial vignette, and a
 * triangular dither so the whole thing does not band on an 8-bit display.
 *
 * It is deliberately outside the fog and outside the tone mapper. See
 * `shaders.ts` for how the pre-division works.
 */

const SKY_RADIUS = 100;
const GROUND_RADIUS = 120;
/** World-unit radius the baked pool of light spans. */
const POOL_RADIUS = 11;

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
uniform float uGlowStrength;
uniform float uVignette;
uniform float uDirect;
uniform float uExposure;
uniform float uMaxLinear;
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

  // Vertical sweep, driven by view elevation so it drifts with the camera
  // instead of feeling like wallpaper glued to the lens.
  float t = smoothstep( uRange.x, uRange.y, vDir.y );
  vec3 col = mix( uBottom, uTop, t );

  // Where the sweep rolls into the floor it takes on the ground tint.
  float f = smoothstep( uRange.x + 0.06, uRange.x - 0.42, vDir.y );
  col = mix( col, uFloor, f * 0.6 );

  // The softbox behind the subject.
  col += uGlow * uGlowStrength * ( 1.0 - smoothstep( 0.0, 0.95, r ) );

  // Vignette. Kept gentle here because the finishing pass adds its own.
  col *= 1.0 - uVignette * smoothstep( 0.30, 1.05, r );

  if ( uDirect > 0.5 ) {
    // No composer: this shader writes the final pixel itself.
    col = encodeSRGB( col );
    col = ditherTPDF( col, gl_FragCoord.xy, 1.0 / 255.0 );
  } else {
    // A tone mapper is downstream. Pre-divide so it lands on the palette hex,
    // then rein in the peak so the backdrop glows rather than blows out bloom.
    col = acesInverse( col, uExposure, uAcesInInv, uAcesOutInv );
    float m = max( max( col.r, col.g ), col.b );
    col *= min( 1.0, uMaxLinear / max( m, 0.0001 ) );
  }

  gl_FragColor = vec4( col, 1.0 );
}
`;

/** Inverses of three's ACES matrices, derived rather than transcribed. */
function acesInverseMatrices(): { inIn: THREE.Matrix3; outIn: THREE.Matrix3 } {
  // three declares these in GLSL column-major; Matrix3.set() takes row-major.
  const inIn = new THREE.Matrix3()
    .set(0.59719, 0.35458, 0.04823, 0.076, 0.90834, 0.01566, 0.0284, 0.13383, 0.83777)
    .invert();
  const outIn = new THREE.Matrix3()
    .set(1.60475, -0.53108, -0.07367, -0.10208, 1.10813, -0.00605, -0.00327, -0.07276, 1.07602)
    .invert();
  return { inIn, outIn };
}

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

/** Grayscale pool of light on the floor. Palette-independent, so baked once. */
function paintLightPool(size: number): THREE.Texture | null {
  const s = makeSurface(size);
  if (!s) return null;
  const ctx = s.ctx;
  const half = size / 2;
  const g = ctx.createRadialGradient(half, half, 0, half, half, half);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.35, '#efefef');
  g.addColorStop(1, '#b4b4b4');
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
  private readonly groundMat: THREE.MeshStandardMaterial;
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

  constructor(opts: BackdropOpts) {
    this.group.name = 'cyclorama';
    const { inIn, outIn } = acesInverseMatrices();

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
        uRange: { value: new THREE.Vector2(-0.55, 0.3) },
        uGlowStrength: { value: 0.1 },
        uVignette: { value: 0.22 },
        uDirect: { value: opts.direct ? 1 : 0 },
        uExposure: { value: 1.05 },
        uMaxLinear: { value: 1.15 },
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

    // --- studio floor ------------------------------------------------------
    // Big enough that FogExp2 swallows the rim long before it can read as a
    // circle sitting on the sweep.
    const groundGeo = new THREE.CircleGeometry(GROUND_RADIUS, 56);
    const pool = paintLightPool(256);
    if (pool) {
      // CircleGeometry stretches the texture across the whole disc; zoom it
      // back in so the pool of light is a pool, not a planet-sized wash.
      const zoom = GROUND_RADIUS / POOL_RADIUS;
      pool.repeat.setScalar(zoom);
      pool.offset.setScalar(0.5 - 0.5 * zoom);
    }
    this.groundMat = new THREE.MeshStandardMaterial({
      color: 0xb4523c,
      roughness: 0.92,
      metalness: 0,
      map: pool ?? undefined,
      dithering: true,
    });
    this.ground = new THREE.Mesh(groundGeo, this.groundMat);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = opts.groundY ?? -0.52;
    this.ground.receiveShadow = true;
    this.owned.push(groundGeo, this.groundMat);
    if (pool) this.owned.push(pool);

    // --- contact shadow ----------------------------------------------------
    const contactGeo = new THREE.CircleGeometry(1, 32);
    const blob = paintBlob(128, 0.34);
    this.contactMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      map: blob ?? undefined,
      transparent: true,
      opacity: 0.4,
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
  }

  /** Base exposure, i.e. before any flash punch. */
  setExposure(exposure: number): void {
    this.skyMat.uniforms.uExposure.value = exposure;
  }

  /** Elevation window the gradient spans, in view-direction Y. */
  setGradientRange(low: number, high: number): void {
    (this.skyMat.uniforms.uRange.value as THREE.Vector2).set(low, high);
  }

  setGroundY(y: number): void {
    this.ground.position.y = y;
    this.contact.position.y = y + 0.012;
  }

  /** Size and darkness of the blob under the plate. */
  setContactShadow(radius: number, strength: number): void {
    this.contact.scale.setScalar(Math.max(0.001, radius));
    this.contactMat.opacity = THREE.MathUtils.clamp(strength, 0, 1);
    this.contact.visible = strength > 0.001;
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

    this.toTop.setHex(p.bgTop, THREE.SRGBColorSpace);
    this.toBottom.setHex(p.bgBottom, THREE.SRGBColorSpace);
    this.toFloor.setHex(p.ground, THREE.SRGBColorSpace);
    this.toGlow.setHex(p.key, THREE.SRGBColorSpace);
    // The floor is lifted slightly toward white so the baked pool of light has
    // headroom to read as light rather than as a stain.
    this.toGround.setHex(p.ground, THREE.SRGBColorSpace).lerp(WHITE, 0.16);
    this.toVig = p.vignette * 0.6;

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

const WHITE = /* @__PURE__ */ new THREE.Color(0xffffff);

export function createBackdrop(opts: BackdropOpts): Backdrop {
  return new Backdrop(opts);
}
