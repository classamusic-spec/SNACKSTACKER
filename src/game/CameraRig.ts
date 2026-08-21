import * as THREE from 'three';
import { clamp, damp, lerp } from '../core/math';
import { TUNING } from './constants';

const tmpPos = new THREE.Vector3();
const tmpLook = new THREE.Vector3();

/**
 * Owns camera framing. The distance is auto-fitted from the viewport aspect so
 * the sliding layer is always fully on screen — on a 19.5:9 phone that means
 * pulling well back; on a wide desktop window it clamps in so the food still
 * reads large.
 */
export class CameraRig {
  private distance = 16;
  private aspect = 0.5;
  private targetY = 0;
  private currentY = 0;
  private lookY = 0;
  private orbit = 0;
  private orbitSpeed = 0;
  private lift = 0;
  /** Effective travel, recomputed on resize; never exceeds what fits. */
  travel = TUNING.TRAVEL;

  constructor(public readonly camera: THREE.PerspectiveCamera) {
    camera.fov = TUNING.CAM_FOV;
    camera.near = 0.5;
    camera.far = 240;
  }

  setAspect(aspect: number): void {
    this.aspect = Math.max(aspect, 0.2);
    this.refit(this.travelRequest);
  }

  private travelRequest = TUNING.TRAVEL;

  /** Ask for a travel amplitude; the rig grants as much as fits on screen. */
  requestTravel(travel: number): void {
    this.travelRequest = travel;
    this.refit(travel);
  }

  private refit(travelWanted: number): void {
    const halfFov = THREE.MathUtils.degToRad(TUNING.CAM_FOV) / 2;
    const tan = Math.tan(halfFov);
    // Horizontal screen extent of an axis-aligned offset, at 45deg yaw.
    const project = Math.cos(TUNING.CAM_YAW);
    const needed =
      (travelWanted + TUNING.BASE_FOOTPRINT / 2 + TUNING.CAM_FIT_MARGIN) * project;

    const fitted = needed / (tan * this.aspect);
    this.distance = clamp(fitted, 9.5, 30);

    // If the distance had to be clamped, give back only the travel that fits.
    const visibleHalfWidth = this.distance * tan * this.aspect;
    const maxTravel =
      visibleHalfWidth / project - TUNING.BASE_FOOTPRINT / 2 - TUNING.CAM_FIT_MARGIN;
    this.travel = clamp(Math.min(travelWanted, maxTravel), 1.15, travelWanted);

    this.camera.aspect = this.aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Height of the tower top the camera should track. */
  setTop(y: number, instant = false): void {
    this.targetY = y;
    if (instant) {
      this.currentY = y;
      this.lookY = y;
    }
  }

  /** Slow turntable used on the home screen and after a topple. */
  setOrbit(speed: number): void {
    this.orbitSpeed = speed;
  }

  /** Jump straight back to the play angle, discarding any accumulated turn. */
  snapOrbit(): void {
    this.orbit = 0;
  }

  /** Extra pull-back, e.g. while the tower collapses. */
  setLift(lift: number): void {
    this.lift = lift;
  }

  update(dt: number, lambda = TUNING.CAM_FOLLOW_LAMBDA): void {
    this.currentY = damp(this.currentY, this.targetY, lambda, dt);
    this.lookY = damp(this.lookY, this.targetY + TUNING.CAM_LOOK_LIFT, lambda * 0.85, dt);
    this.orbit += this.orbitSpeed * dt;

    const yaw = TUNING.CAM_YAW + this.orbit;
    const pitch = TUNING.CAM_PITCH;
    const d = this.distance + this.lift;
    const horiz = Math.cos(pitch) * d;

    tmpPos.set(
      Math.sin(yaw) * horiz,
      this.currentY + Math.sin(pitch) * d,
      Math.cos(yaw) * horiz,
    );
    tmpLook.set(0, this.lookY, 0);
    this.camera.position.copy(tmpPos);
    this.camera.lookAt(tmpLook);
  }

  /** Snap instantly to the current target (used on reset). */
  snap(): void {
    this.currentY = this.targetY;
    this.lookY = this.targetY + TUNING.CAM_LOOK_LIFT;
    this.update(1 / 60, 1e6);
  }

  get topY(): number {
    return this.currentY;
  }

  /** Blend the orbit back to the play angle. */
  resetOrbit(dt: number): void {
    this.orbit = lerp(this.orbit, 0, 1 - Math.exp(-4 * dt));
  }
}
