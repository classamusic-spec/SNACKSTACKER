import * as THREE from 'three';
import { clamp01, easeOutBack, easeOutCubic, smoothstep } from '../core/math';
import { RENDER_ORDER } from './pools';

/**
 * World-space floating text ("+120", "PERFECT").
 *
 * Glyphs are painted WHITE with a dark outline into a 256x128 canvas and the
 * colour is applied as a sprite tint, so one canvas serves every palette and
 * the cache can be keyed by the string alone. Scores vary a lot, so the cache
 * is a strict LRU of 32 entries; evicted canvases are recycled for the next
 * new string, which makes the steady state allocation-free.
 */

const CANVAS_W = 256;
const CANVAS_H = 128;
const FONT_STACK = '-apple-system, "SF Pro Display", Inter, system-ui, sans-serif';
const LIFE = 0.9;
const RISE = 0.85;
const BASE_WIDTH = 1.3;

function paint(canvas: HTMLCanvasElement, text: string): void {
  const ctx = canvas.getContext('2d');
  if (ctx === null) return;
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

  let px = 76;
  ctx.font = `700 ${px}px ${FONT_STACK}`;
  const maxWidth = CANVAS_W - 34;
  let width = ctx.measureText(text).width;
  while (width > maxWidth && px > 14) {
    px = Math.max(14, Math.floor(px * Math.min(0.94, maxWidth / width)));
    ctx.font = `700 ${px}px ${FONT_STACK}`;
    width = ctx.measureText(text).width;
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;

  const cx = CANVAS_W / 2;
  const cy = CANVAS_H / 2;

  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = px * 0.22;
  ctx.shadowOffsetY = px * 0.06;
  ctx.lineWidth = Math.max(4, px * 0.17);
  ctx.strokeStyle = 'rgba(12,10,14,0.92)';
  ctx.strokeText(text, cx, cy);

  ctx.shadowColor = 'rgba(0,0,0,0)';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, cx, cy);
}

class TextTextureCache {
  private readonly map = new Map<string, THREE.CanvasTexture>();
  private readonly spare: HTMLCanvasElement[] = [];

  constructor(
    private readonly limit: number,
    private readonly inUse: (key: string) => boolean,
  ) {}

  get(text: string): THREE.CanvasTexture {
    const hit = this.map.get(text);
    if (hit !== undefined) {
      // Refresh LRU position.
      this.map.delete(text);
      this.map.set(text, hit);
      return hit;
    }
    if (this.map.size >= this.limit) this.evict();

    const canvas = this.spare.pop() ?? document.createElement('canvas');
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    paint(canvas, text);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;
    tex.needsUpdate = true;
    this.map.set(text, tex);
    return tex;
  }

  /** Drop the oldest entry that is not currently on screen. */
  private evict(): void {
    let victim: string | null = null;
    for (const key of this.map.keys()) {
      if (!this.inUse(key)) {
        victim = key;
        break;
      }
    }
    if (victim === null) return;
    const tex = this.map.get(victim);
    this.map.delete(victim);
    if (tex === undefined) return;
    const image: unknown = tex.image;
    if (image instanceof HTMLCanvasElement) this.spare.push(image);
    tex.dispose();
  }

  dispose(): void {
    for (const tex of this.map.values()) tex.dispose();
    this.map.clear();
    this.spare.length = 0;
  }
}

export class PopTextPool {
  private readonly sprites: THREE.Sprite[] = [];
  private readonly mats: THREE.SpriteMaterial[] = [];
  private readonly keys: string[] = [];
  private readonly birth: Float32Array;
  private readonly base: Float32Array;
  private readonly active: Uint8Array;
  private readonly cache: TextTextureCache;
  private readonly group: THREE.Group;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly capacity: number,
  ) {
    this.birth = new Float32Array(capacity);
    this.base = new Float32Array(capacity * 3);
    this.active = new Uint8Array(capacity);
    this.cache = new TextTextureCache(32, (key) => this.isOnScreen(key));

    this.group = new THREE.Group();
    this.group.name = 'vfx.popText';
    this.group.matrixAutoUpdate = false;
    this.group.castShadow = false;
    this.group.receiveShadow = false;
    this.scene.add(this.group);

    for (let i = 0; i < capacity; i++) {
      const mat = new THREE.SpriteMaterial({
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      sprite.renderOrder = RENDER_ORDER.text + i;
      sprite.scale.set(BASE_WIDTH, BASE_WIDTH * (CANVAS_H / CANVAS_W), 1);
      this.group.add(sprite);
      this.sprites.push(sprite);
      this.mats.push(mat);
      this.keys.push('');
    }
  }

  private isOnScreen(key: string): boolean {
    for (let i = 0; i < this.capacity; i++) {
      if (this.active[i] === 1 && this.keys[i] === key) return true;
    }
    return false;
  }

  spawn(now: number, position: THREE.Vector3, text: string, color: number): void {
    let slot = -1;
    let oldest = Infinity;
    for (let i = 0; i < this.capacity; i++) {
      if (this.active[i] === 0) {
        slot = i;
        break;
      }
      if (this.birth[i] < oldest) {
        oldest = this.birth[i];
        slot = i;
      }
    }
    if (slot < 0) return;

    const tex = this.cache.get(text);
    const mat = this.mats[slot];
    if (mat.map !== tex) {
      mat.map = tex;
      mat.needsUpdate = true;
    }
    mat.color.setHex(color);
    mat.opacity = 0;

    this.keys[slot] = text;
    this.birth[slot] = now;
    this.active[slot] = 1;
    const i3 = slot * 3;
    this.base[i3] = position.x;
    this.base[i3 + 1] = position.y;
    this.base[i3 + 2] = position.z;

    const sprite = this.sprites[slot];
    sprite.position.set(position.x, position.y, position.z);
    sprite.scale.set(0.001, 0.001, 1);
    sprite.visible = true;
  }

  update(now: number): void {
    for (let i = 0; i < this.capacity; i++) {
      if (this.active[i] === 0) continue;
      const u = (now - this.birth[i]) / LIFE;
      const sprite = this.sprites[i];
      if (u >= 1) {
        this.active[i] = 0;
        sprite.visible = false;
        this.mats[i].opacity = 0;
        continue;
      }
      const i3 = i * 3;
      sprite.position.set(
        this.base[i3],
        this.base[i3 + 1] + easeOutCubic(clamp01(u)) * RISE,
        this.base[i3 + 2],
      );
      // Scale pop on birth, then a gentle settle.
      const pop = 0.52 + 0.48 * easeOutBack(clamp01(u / 0.2));
      const s = BASE_WIDTH * pop * (1 - 0.08 * u);
      sprite.scale.set(s, s * (CANVAS_H / CANVAS_W), 1);
      this.mats[i].opacity = smoothstep(u / 0.08) * (1 - smoothstep((u - 0.62) / 0.38));
    }
  }

  clear(): void {
    for (let i = 0; i < this.capacity; i++) {
      this.active[i] = 0;
      this.sprites[i].visible = false;
      this.mats[i].opacity = 0;
    }
  }

  dispose(): void {
    this.clear();
    for (let i = 0; i < this.capacity; i++) {
      this.group.remove(this.sprites[i]);
      this.mats[i].map = null;
      this.mats[i].dispose();
    }
    this.sprites.length = 0;
    this.mats.length = 0;
    this.keys.length = 0;
    this.cache.dispose();
    this.scene.remove(this.group);
  }
}
