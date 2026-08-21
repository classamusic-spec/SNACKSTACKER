import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { QualityTier } from '../core/types';
import type { ThemePaletteLike } from './api';
import { GLSL_ACES, GLSL_DITHER, GLSL_FULLSCREEN_VERT, GLSL_SRGB } from './shaders';

/**
 * Post chain, per tier:
 *
 *   HIGH    RenderPass -> UnrealBloomPass (quarter res) -> Finish
 *           Finish = ACES + sRGB + vignette + film grain + corner CA + dither
 *   MEDIUM  RenderPass -> UnrealBloomPass (~eighth res) -> Finish
 *           Finish with grain and aberration dialled to zero
 *   LOW     no composer at all — index.ts calls renderer.render directly
 *
 * `Finish` replaces three's OutputPass rather than sitting after it: the scene
 * is rendered into a linear HDR buffer where three skips tone mapping and
 * colour encoding, so one pass can do the tone map, the encode and all of the
 * grade for the price of a single fullscreen blit. On a phone every fullscreen
 * pass is real money.
 */

const FINISH_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 uResolution;
uniform float uTime;
uniform float uExposure;
uniform float uVignette;
uniform float uGrain;
uniform float uAberration;

varying vec2 vUv;

${GLSL_ACES}
${GLSL_SRGB}
${GLSL_DITHER}

void main() {
  vec2 c = vUv - 0.5;
  float r2 = dot( c, c );

  vec3 hdr;
  if ( uAberration > 0.0001 ) {
    // Lens dispersion that only shows up out at the corners.
    vec2 off = c * r2 * uAberration;
    hdr.r = texture2D( tDiffuse, vUv + off ).r;
    hdr.g = texture2D( tDiffuse, vUv ).g;
    hdr.b = texture2D( tDiffuse, vUv - off ).b;
  } else {
    hdr = texture2D( tDiffuse, vUv ).rgb;
  }

  vec3 col = encodeSRGB( acesFilmic( hdr, uExposure ) );

  float aspect = uResolution.x / max( uResolution.y, 1.0 );
  vec2 q = vec2( c.x * aspect, c.y );
  float d = length( q ) / max( length( vec2( 0.5 * aspect, 0.5 ) ), 0.0001 );
  col *= 1.0 - uVignette * smoothstep( 0.42, 1.0, d );

  if ( uGrain > 0.0001 ) {
    float t = mod( uTime, 64.0 );
    float g = hash12( gl_FragCoord.xy + vec2( t * 311.7, t * 127.1 ) );
    float lum = dot( col, vec3( 0.299, 0.587, 0.114 ) );
    // Grain lives in the shadows and midtones; sugar highlights stay clean.
    col += ( g - 0.5 ) * uGrain * mix( 1.0, 0.3, lum );
  }

  col = ditherTPDF( col, gl_FragCoord.xy, 1.0 / 255.0 );

  gl_FragColor = vec4( col, 1.0 );
}
`;

const FinishShader = {
  name: 'SnackeryFinishShader',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
    uExposure: { value: 1.05 },
    uVignette: { value: 0.36 },
    uGrain: { value: 0.028 },
    uAberration: { value: 0.9 },
  },
  vertexShader: GLSL_FULLSCREEN_VERT,
  fragmentShader: FINISH_FRAG,
};

export interface PostChainOpts {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  tier: QualityTier;
  palette: ThemePaletteLike;
}

export interface PostChain {
  /** Bloom resolution scale relative to the drawing buffer. */
  readonly bloomScale: number;
  applyPalette(p: ThemePaletteLike): void;
  setSize(width: number, height: number, pixelRatio: number): void;
  /** 0..1 momentary punch; index.ts owns the decay. */
  setFlash(amount: number): void;
  update(dt: number, elapsed: number): void;
  render(dt: number): void;
  dispose(): void;
}

class Composed implements PostChain {
  readonly bloomScale: number;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly renderPass: RenderPass;
  private readonly bloom: UnrealBloomPass;
  private readonly finish: ShaderPass;
  private readonly target: THREE.WebGLRenderTarget;
  private baseBloom: number;
  private width = 1;
  private height = 1;
  private dpr = 1;

  constructor(opts: PostChainOpts) {
    const { renderer, scene, camera, tier, palette } = opts;
    this.renderer = renderer;
    this.bloomScale = tier === 'high' ? 0.5 : 0.35;
    this.baseBloom = palette.bloomStrength;

    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.target = new THREE.WebGLRenderTarget(
      Math.max(2, size.x),
      Math.max(2, size.y),
      {
        type: THREE.HalfFloatType,
        depthBuffer: true,
        stencilBuffer: false,
        // MSAA has to live on the composer target: the canvas' own antialias
        // flag does nothing once we stop drawing straight to it.
        samples: tier === 'high' ? 4 : 0,
      },
    );
    this.target.texture.name = 'snackery.scene';

    this.composer = new EffectComposer(renderer, this.target);

    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(size.x * this.bloomScale, size.y * this.bloomScale),
      palette.bloomStrength,
      0.5,
      0.85,
    );
    this.composer.addPass(this.bloom);

    this.finish = new ShaderPass(FinishShader);
    this.finish.uniforms.uVignette.value = palette.vignette;
    this.finish.uniforms.uExposure.value = palette.exposure;
    this.finish.uniforms.uGrain.value = tier === 'high' ? 0.028 : 0;
    this.finish.uniforms.uAberration.value = tier === 'high' ? 0.9 : 0;
    this.composer.addPass(this.finish);
  }

  applyPalette(p: ThemePaletteLike): void {
    this.baseBloom = p.bloomStrength;
    this.bloom.strength = p.bloomStrength;
    this.finish.uniforms.uVignette.value = p.vignette;
  }

  setSize(width: number, height: number, pixelRatio: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.dpr = pixelRatio;

    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(this.width, this.height);

    // composer.setSize() just sized the bloom to the full buffer; pull it back
    // down. UnrealBloomPass halves again internally, so high tier blurs at a
    // quarter of the drawing buffer and medium at roughly an eighth.
    const bw = Math.max(16, Math.round(this.width * pixelRatio * this.bloomScale));
    const bh = Math.max(16, Math.round(this.height * pixelRatio * this.bloomScale));
    this.bloom.setSize(bw, bh);

    (this.finish.uniforms.uResolution.value as THREE.Vector2).set(
      this.width * pixelRatio,
      this.height * pixelRatio,
    );
  }

  setFlash(amount: number): void {
    this.bloom.strength = this.baseBloom * (1 + amount * 1.8);
  }

  update(_dt: number, elapsed: number): void {
    this.finish.uniforms.uTime.value = elapsed;
    // Exposure is punched by flash() on the renderer; the finish pass is the
    // only thing that tone-maps, so it has to read it back every frame.
    this.finish.uniforms.uExposure.value = this.renderer.toneMappingExposure;
  }

  render(dt: number): void {
    this.composer.render(dt);
  }

  dispose(): void {
    this.composer.dispose();
    this.renderPass.dispose();
    this.bloom.dispose();
    this.finish.dispose();
    // composer.dispose() already tore down renderTarget1 (our target) and its clone.
  }
}

/** Returns null on the low tier, where the frame goes straight to the canvas. */
export function createPostChain(opts: PostChainOpts): PostChain | null {
  if (opts.tier === 'low') return null;
  return new Composed(opts);
}
