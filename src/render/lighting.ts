import * as THREE from 'three';
import { damp, smootherstep } from '../core/math';
import type { QualityTier } from '../core/types';
import type { ThemePaletteLike } from './api';
import { PALETTE_FADE } from './palette';

/**
 * Three-point studio rig.
 *
 *   KEY   warm, 35 degrees elevation, front-left, the only shadow caster.
 *   FILL  cool, opposite side, low and soft, plus a hemisphere for bounce.
 *   RIM   saturated, behind and above, peels the tower off the backdrop.
 *   AMB   a whisper so shadows read as shadow, never as holes.
 *
 * The whole rig rides the camera's height: the tower grows forever, so the key
 * light and its orthographic shadow frustum track `camera.position.y` and keep
 * a tight, high-resolution shadow around the layers you can actually see.
 */

/** offset = light position relative to the tracked focus point. */
const KEY_OFFSET = new THREE.Vector3(-4.5, 4.72, 5.0); // |xz| 6.73, y 4.72 -> ~35 deg
const FILL_OFFSET = new THREE.Vector3(5.6, 2.6, 3.2);
const RIM_OFFSET = new THREE.Vector3(2.4, 5.6, -6.4);

/**
 * The key light expressed as a compass bearing and an altitude, so the sky can
 * put its sun in the same place the shadows say it is.
 *
 * `KEY_AZIMUTH` is `atan2(x, z)` — the same convention the camera rig uses for
 * yaw — and works out at -0.733 rad (-42 deg), i.e. front-left of the plate.
 * `KEY_ELEVATION` is 0.612 rad (35 deg), the studio rig's authored altitude.
 *
 * A sky is allowed to disagree about ALTITUDE: a golden-hour sun sits far
 * lower than the key, and all that changes is how long the shadows read, which
 * nobody measures. It must not disagree about BEARING. The cast shadow points
 * at KEY_AZIMUTH + pi, and a glow on the wrong side of the frame from the
 * shadows is the single fastest way to make a rendered sky look pasted on.
 * Every preset in palette.ts therefore uses KEY_AZIMUTH verbatim.
 *
 * Worth knowing: at the play camera (CAM_YAW pi/4, so a view bearing of -135
 * deg) the sun sits about 93 deg off the view axis, well outside the ~22 deg
 * horizontal field. During a run the disc is off-frame to the left and only
 * the glow's skirt is visible — which is why the glow is authored wide and the
 * disc small. The home screen orbits a full turn, so the disc does swing
 * through frame there.
 */
export const KEY_AZIMUTH = /* @__PURE__ */ Math.atan2(KEY_OFFSET.x, KEY_OFFSET.z);
export const KEY_ELEVATION = /* @__PURE__ */ Math.atan2(
  KEY_OFFSET.y,
  Math.hypot(KEY_OFFSET.x, KEY_OFFSET.z),
);

/** Half-extent of the shadow frustum in world units. Tight = crisp. */
const SHADOW_EXTENT_XZ = 5.2;
const SHADOW_EXTENT_Y = 6.4;

export interface LightRigOpts {
  quality: QualityTier;
}

export function shadowMapSizeFor(tier: QualityTier): number {
  return tier === 'high' ? 2048 : tier === 'medium' ? 1024 : 0;
}

export class LightRig {
  readonly group = new THREE.Group();
  readonly key: THREE.DirectionalLight;
  readonly fill: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly rim: THREE.DirectionalLight;
  readonly ambient: THREE.AmbientLight;

  private tier: QualityTier;
  private focusY = 0;
  private readonly keyTarget = new THREE.Object3D();
  private readonly rimTarget = new THREE.Object3D();
  private readonly fillTarget = new THREE.Object3D();

  // --- crossfade state (hoisted: applyPalette must not allocate either) ---
  private fadeT = 1;
  private fadeDur = PALETTE_FADE;
  private readonly fromKey = new THREE.Color();
  private readonly toKey = new THREE.Color();
  private readonly fromFill = new THREE.Color();
  private readonly toFill = new THREE.Color();
  private readonly fromGround = new THREE.Color();
  private readonly toGround = new THREE.Color();
  private readonly fromRim = new THREE.Color();
  private readonly toRim = new THREE.Color();
  private readonly fromAmb = new THREE.Color();
  private readonly toAmb = new THREE.Color();
  private fromKeyI = 0;
  private toKeyI = 0;
  private fromFillI = 0;
  private toFillI = 0;
  private fromRimI = 0;
  private toRimI = 0;

  constructor(opts: LightRigOpts) {
    this.tier = opts.quality;
    this.group.name = 'studio-rig';

    this.key = new THREE.DirectionalLight(0xfff1dc, 2.6);
    this.key.name = 'key';
    this.key.position.copy(KEY_OFFSET);
    this.key.target = this.keyTarget;

    const s = this.key.shadow;
    const cam = s.camera;
    cam.left = -SHADOW_EXTENT_XZ;
    cam.right = SHADOW_EXTENT_XZ;
    cam.top = SHADOW_EXTENT_Y;
    cam.bottom = -SHADOW_EXTENT_Y;
    cam.near = 0.5;
    cam.far = 30;
    cam.updateProjectionMatrix();
    // Acne on a domed pancake is instantly visible; normalBias does the heavy
    // lifting and the tiny constant bias cleans up the grazing angles.
    s.bias = -0.0008;
    s.normalBias = 0.02;
    s.radius = 2.5;

    this.fill = new THREE.DirectionalLight(0x8fb8de, 0.6);
    this.fill.name = 'fill';
    this.fill.position.copy(FILL_OFFSET);
    this.fill.target = this.fillTarget;
    this.fill.castShadow = false;

    this.hemi = new THREE.HemisphereLight(0x8fb8de, 0xb4523c, 0.33);
    this.hemi.name = 'bounce';

    this.rim = new THREE.DirectionalLight(0xffd9a0, 1.4);
    this.rim.name = 'rim';
    this.rim.position.copy(RIM_OFFSET);
    this.rim.target = this.rimTarget;
    this.rim.castShadow = false;

    this.ambient = new THREE.AmbientLight(0xffffff, 0.15);
    this.ambient.name = 'ambient';

    this.group.add(
      this.key,
      this.keyTarget,
      this.fill,
      this.fillTarget,
      this.hemi,
      this.rim,
      this.rimTarget,
      this.ambient,
    );

    this.setQuality(this.tier);
  }

  /** Directional + hemisphere + ambient count, for RenderQualitySettings. */
  get lightCount(): number {
    return this.fill.visible ? 5 : 4;
  }

  setQuality(tier: QualityTier): void {
    this.tier = tier;
    const size = shadowMapSizeFor(tier);
    this.key.castShadow = size > 0;

    if (size > 0 && this.key.shadow.mapSize.width !== size) {
      // Resizing a live shadow map needs the old render target torn down.
      this.key.shadow.map?.dispose();
      this.key.shadow.map = null;
      this.key.shadow.mapSize.setScalar(size);
    }
    if (size === 0) {
      this.key.shadow.map?.dispose();
      this.key.shadow.map = null;
    }

    // Low tier drops one directional light entirely; the hemisphere keeps the
    // cool side from going dead.
    this.fill.visible = tier !== 'low';
    this.hemi.intensity = tier === 'low' ? 0.5 : 0.33;
    this.key.shadow.radius = tier === 'high' ? 2.5 : 1.5;
  }

  applyPalette(p: ThemePaletteLike, duration = PALETTE_FADE): void {
    this.fromKey.copy(this.key.color);
    this.fromFill.copy(this.fill.color);
    this.fromGround.copy(this.hemi.groundColor);
    this.fromRim.copy(this.rim.color);
    this.fromAmb.copy(this.ambient.color);
    this.fromKeyI = this.key.intensity;
    this.fromFillI = this.fill.intensity;
    this.fromRimI = this.rim.intensity;

    this.toKey.setHex(p.key, THREE.SRGBColorSpace);
    this.toFill.setHex(p.fill, THREE.SRGBColorSpace);
    this.toGround.setHex(p.ground, THREE.SRGBColorSpace);
    this.toRim.setHex(p.rim, THREE.SRGBColorSpace);
    // Ambient borrows the fog tint so unlit sides sit inside the room.
    this.toAmb.setHex(p.fog, THREE.SRGBColorSpace);
    this.toKeyI = p.keyIntensity;
    this.toFillI = p.fillIntensity;
    this.toRimI = p.rimIntensity;

    this.fadeDur = Math.max(0, duration);
    this.fadeT = 0;
    if (this.fadeDur === 0) this.commit(1);
  }

  private commit(t: number): void {
    const e = smootherstep(t);
    this.key.color.lerpColors(this.fromKey, this.toKey, e);
    this.fill.color.lerpColors(this.fromFill, this.toFill, e);
    this.hemi.color.copy(this.fill.color);
    this.hemi.groundColor.lerpColors(this.fromGround, this.toGround, e);
    this.rim.color.lerpColors(this.fromRim, this.toRim, e);
    this.ambient.color.lerpColors(this.fromAmb, this.toAmb, e);
    this.key.intensity = this.fromKeyI + (this.toKeyI - this.fromKeyI) * e;
    this.fill.intensity = this.fromFillI + (this.toFillI - this.fromFillI) * e;
    this.rim.intensity = this.fromRimI + (this.toRimI - this.fromRimI) * e;
    this.fadeT = t;
  }

  /** Snap the rig to a height instantly (new run, camera teleport). */
  resetFocus(y: number): void {
    this.focusY = y;
    this.place();
  }

  /**
   * @param focusY the height the shadow frustum should be centred on — the
   * camera's y works well because the game keeps the tower top framed.
   */
  update(dt: number, focusY: number): void {
    if (this.fadeT < 1 && this.fadeDur > 0) {
      this.commit(Math.min(1, this.fadeT + dt / this.fadeDur));
    }

    // Damped so the shadow map's texel grid slides instead of strobing, but
    // snapped when the game teleports the camera (restart, theme preview).
    if (Math.abs(focusY - this.focusY) > 8) this.focusY = focusY;
    else this.focusY = damp(this.focusY, focusY, 9, dt);
    this.place();
  }

  private place(): void {
    const y = this.focusY;
    this.key.position.set(KEY_OFFSET.x, y + KEY_OFFSET.y, KEY_OFFSET.z);
    this.fill.position.set(FILL_OFFSET.x, y + FILL_OFFSET.y, FILL_OFFSET.z);
    this.rim.position.set(RIM_OFFSET.x, y + RIM_OFFSET.y, RIM_OFFSET.z);
    this.keyTarget.position.y = y;
    this.fillTarget.position.y = y;
    this.rimTarget.position.y = y;
  }

  dispose(): void {
    this.key.shadow.map?.dispose();
    this.key.shadow.map = null;
    this.key.dispose();
    this.fill.dispose();
    this.rim.dispose();
    this.hemi.dispose();
    this.ambient.dispose();
    this.group.clear();
  }
}

export function createLightRig(opts: LightRigOpts): LightRig {
  return new LightRig(opts);
}
