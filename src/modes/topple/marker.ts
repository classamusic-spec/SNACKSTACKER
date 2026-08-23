/**
 * The landing marker: the one piece of furniture Topple adds to the world.
 *
 * A physics stacker is only fair if the player can see where the food is going
 * to land, and in a camera that pitches down 29 degrees you cannot judge that
 * from the food's position alone. The marker is a flat reticle drawn on the
 * tower's top face at the *predicted* landing footprint — including the sideways
 * drift the swing will impart — plus a short post so the height reads. It is
 * tinted green through amber to red by how much of the food will actually be
 * supported, which is the whole fairness contract in one colour ramp.
 *
 * Two meshes, two draw calls, 44 triangles. It is the entire HUD.
 */
import * as THREE from 'three';
import { clamp01 } from '../../core/math';
import type { ThemePaletteLike } from '../../render/api';
import type { MaterialLibrary } from '../../render/api';

const RISK_COLOR = 0xff3b30;

function paintReticle(ctx: CanvasRenderingContext2D, size: number): void {
  ctx.clearRect(0, 0, size, size);

  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size * 0.52);
  g.addColorStop(0, 'rgba(255,255,255,0.20)');
  g.addColorStop(0.7, 'rgba(255,255,255,0.06)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  const m = size * 0.07;
  ctx.strokeStyle = 'rgba(255,255,255,0.30)';
  ctx.lineWidth = Math.max(1, size * 0.010);
  ctx.strokeRect(m, m, size - m * 2, size - m * 2);

  ctx.strokeStyle = 'rgba(255,255,255,1)';
  ctx.lineWidth = Math.max(2, size * 0.034);
  ctx.lineCap = 'round';
  const arm = size * 0.19;
  const corners: [number, number, number, number][] = [
    [m, m, 1, 1],
    [size - m, m, -1, 1],
    [size - m, size - m, -1, -1],
    [m, size - m, 1, -1],
  ];
  for (const [cx, cy, sx, sy] of corners) {
    ctx.beginPath();
    ctx.moveTo(cx + sx * arm, cy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx, cy + sy * arm);
    ctx.stroke();
  }

  // A centre tick, so a plumb placement is aimable rather than eyeballed.
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = Math.max(1, size * 0.018);
  const t = size * 0.06;
  ctx.beginPath();
  ctx.moveTo(size / 2 - t, size / 2);
  ctx.lineTo(size / 2 + t, size / 2);
  ctx.moveTo(size / 2, size / 2 - t);
  ctx.lineTo(size / 2, size / 2 + t);
  ctx.stroke();
}

function paintPost(ctx: CanvasRenderingContext2D, size: number): void {
  const g = ctx.createLinearGradient(0, 0, 0, size);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0.95)');
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
}

export class LandingMarker {
  readonly root = new THREE.Group();

  private readonly plane: THREE.Mesh;
  private readonly post: THREE.Mesh;
  private readonly planeMat: THREE.MeshStandardMaterial;
  private readonly postMat: THREE.MeshStandardMaterial;
  private readonly safe = new THREE.Color();
  private readonly risk = new THREE.Color();
  private readonly tint = new THREE.Color();

  constructor(materials: MaterialLibrary, palette: ThemePaletteLike) {
    const reticle = materials.texture('topple.reticle', paintReticle, {
      size: 256,
      srgb: true,
      wrap: THREE.ClampToEdgeWrapping,
    });
    const postTex = materials.texture('topple.post', paintPost, {
      size: 16,
      srgb: true,
      wrap: THREE.ClampToEdgeWrapping,
    });

    this.planeMat = materials.standard('topple.marker', {
      color: 0xffffff,
      emissive: 0xffffff,
      emissiveIntensity: 0.55,
      roughness: 1,
      metalness: 0,
      map: reticle,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.postMat = materials.standard('topple.markerPost', {
      color: 0xffffff,
      emissive: 0xffffff,
      emissiveIntensity: 0.5,
      roughness: 1,
      metalness: 0,
      map: postTex,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const planeGeo = materials.cache('topple.geo.markerPlane', () => {
      const g = new THREE.PlaneGeometry(1, 1);
      g.rotateX(-Math.PI / 2);
      return g;
    });
    const postGeo = materials.cache('topple.geo.markerPost', () => {
      const g = new THREE.CylinderGeometry(0.016, 0.016, 1, 6, 1, true);
      g.translate(0, 0.5, 0);
      return g;
    });

    this.plane = new THREE.Mesh(planeGeo, this.planeMat);
    this.post = new THREE.Mesh(postGeo, this.postMat);
    this.plane.renderOrder = 4;
    this.post.renderOrder = 4;
    this.plane.frustumCulled = false;
    this.post.frustumCulled = false;
    this.root.add(this.plane, this.post);
    this.root.visible = false;
    this.setPalette(palette);
  }

  setPalette(palette: ThemePaletteLike): void {
    this.safe.setHex(palette.accentSoft, THREE.SRGBColorSpace);
    this.risk.setHex(RISK_COLOR, THREE.SRGBColorSpace);
  }

  get visible(): boolean {
    return this.root.visible;
  }

  hide(): void {
    this.root.visible = false;
  }

  /**
   * @param support 1 = the food lands fully on the tower, 0 = entirely off it.
   * @param urgency 0..1 lean pressure; pulses the marker as the tower gets scary.
   */
  show(
    x: number,
    y: number,
    z: number,
    width: number,
    depth: number,
    yaw: number,
    support: number,
    urgency: number,
    time: number,
  ): void {
    this.root.visible = true;
    this.plane.position.set(x, y + 0.014, z);
    this.plane.rotation.y = yaw;
    this.plane.scale.set(width, 1, depth);
    this.post.position.set(x, y + 0.014, z);
    this.post.scale.set(1, 0.42 + urgency * 0.2, 1);

    // Below about 70% support the placement is genuinely at risk; ramp from
    // there rather than from 100%, or the marker is red the whole game.
    const risk = clamp01((0.78 - support) / 0.5);
    this.tint.copy(this.safe).lerp(this.risk, risk);
    this.planeMat.color.copy(this.tint);
    this.planeMat.emissive.copy(this.tint);
    this.postMat.color.copy(this.tint);
    this.postMat.emissive.copy(this.tint);

    const pulse = urgency > 0.4 ? 0.82 + 0.18 * Math.sin(time * 9) : 1;
    this.planeMat.opacity = (0.6 + risk * 0.35) * pulse;
    this.postMat.opacity = 0.34 * pulse;
  }

  dispose(): void {
    this.root.removeFromParent();
    this.root.clear();
    // Geometry, materials and textures are owned by the MaterialLibrary cache.
  }
}
