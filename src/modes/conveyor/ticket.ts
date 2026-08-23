/**
 * THE ORDER DOCKET
 * ================
 *
 * The mode contract has no channel for "here is the order", and it should not:
 * a HUD widget would sit on the glass while the food sits in the world. So the
 * order is a physical thing — a paper docket clipped to a rail over the belt's
 * entry hatch, exactly where the next item appears, so reading the order and
 * watching the belt are the same glance.
 *
 * Sizing is not a guess. At the rig's play distance the docket's plane is
 * ~12.2 units from the camera, where the portrait frustum is 4.75 units wide
 * across 393 CSS px — 82 px per world unit. A 3.6 x 1.575 board is therefore
 * 295 x 129 CSS px, and the 640 x 280 canvas painted onto it lands at 0.46
 * device px per texel: a 38px name renders at 17.5px, a 50px colour chip at
 * 23px. The board sits at screen y 168-297, which is under the host's score
 * and over the belt's far end.
 *
 * Each row is COLOUR + WORD + PIPS. Colour is recognised pre-attentively, the
 * word disambiguates two similar tints, and the pips carry the count without a
 * fourth row — three rows is all a board this size can hold legibly, so length
 * past three becomes "x2" instead.
 */
import * as THREE from 'three';
import type { MaterialLibrary, ThemePaletteLike } from '../../render/api';
import { clamp, clamp01, damp } from '../../core/math';
import type { Order } from './orders';
import {
  cssHex,
  cssRgba,
  luminance,
  makeSurface,
  mixHex,
  roundRect,
  type Surface,
} from './parts';
import {
  TICKET_H,
  TICKET_TEX_H,
  TICKET_TEX_W,
  TICKET_TILT,
  TICKET_W,
  TICKET_Y,
  TICKET_Z,
} from './tuning';

const FONT = '-apple-system, "SF Pro Display", "Segoe UI", Inter, system-ui, sans-serif';

/** Canvas layout, in the 640 x 280 space the docket is painted in. */
const TRACK_X0 = 18;
const TRACK_X1 = 622;
const TRACK_Y0 = 238;
const TRACK_Y1 = 266;
const HEADER_H = 44;
const ROWS_TOP = 52;
const ROWS_BOTTOM = 228;

/** Timer bar geometry, derived from the painted track so they line up exactly. */
const BAR_FULL_W = ((TRACK_X1 - TRACK_X0) / TICKET_TEX_W) * TICKET_W;
const BAR_H = ((TRACK_Y1 - TRACK_Y0) / TICKET_TEX_H) * TICKET_H;
const BAR_X0 = -TICKET_W / 2 + (TRACK_X0 / TICKET_TEX_W) * TICKET_W;
const BAR_Y = TICKET_H * (0.5 - (TRACK_Y0 + TRACK_Y1) / 2 / TICKET_TEX_H);

const _warm = new THREE.Color();
const _cool = new THREE.Color();

/** Height of one row in canvas pixels. */
function rowHeight(rowCount: number): number {
  return (ROWS_BOTTOM - ROWS_TOP) / Math.max(rowCount, 1);
}

/** Colour-chip size in canvas pixels, for a docket with this many rows. */
function chipSize(rowCount: number): number {
  return Math.min(rowHeight(rowCount) - 8, 64);
}

/**
 * Centre of a row's colour chip, in the BOARD's local surface coordinates.
 * Exported so the flight animation targets exactly what was painted; when
 * these were two copies of the same arithmetic they drifted within an hour.
 */
export function chipLocal(rowIndex: number, rowCount: number, out: { x: number; y: number }): void {
  const rowH = rowHeight(rowCount);
  const chip = chipSize(rowCount);
  const cx = 22 + chip / 2;
  const cy = ROWS_TOP + rowH * (rowIndex + 0.5);
  out.x = (cx / TICKET_TEX_W - 0.5) * TICKET_W;
  out.y = (0.5 - cy / TICKET_TEX_H) * TICKET_H;
}

export class Ticket {
  readonly group = new THREE.Group();

  private surface: Surface | null;
  private tex: THREE.Texture;
  private board: THREE.Mesh;
  private bar: THREE.Mesh;
  private barMat: THREE.MeshStandardMaterial;

  private paper: number;
  private ink: number;
  private accent: number;

  private timeFrac = 1;
  private shownFrac = 1;
  private nudge = 0;
  private nudgeSeed = 0;
  private pulse = 0;

  constructor(materials: MaterialLibrary, palette: ThemePaletteLike, private calm = false) {
    this.paper = mixHex(0xfff8ec, palette.accentSoft, 0.14);
    this.ink = luminance(this.paper) > 0.5 ? 0x2c2118 : 0xfff4e4;
    this.accent = palette.accent;

    this.surface = makeSurface(TICKET_TEX_W, TICKET_TEX_H);
    this.tex = this.surface
      ? new THREE.CanvasTexture(this.surface.source)
      : new THREE.DataTexture(new Uint8Array([255, 248, 236, 255]), 1, 1);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.wrapS = THREE.ClampToEdgeWrapping;
    this.tex.wrapT = THREE.ClampToEdgeWrapping;
    this.tex.minFilter = THREE.LinearMipmapLinearFilter;
    this.tex.magFilter = THREE.LinearFilter;
    this.tex.generateMipmaps = true;
    this.tex.anisotropy = 4;
    this.tex.needsUpdate = true;

    const boardMat = materials.standard('conveyor.ticket', {
      color: 0xffffff,
      roughness: 0.88,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    // The map carries all of the hue, so the base stays white (DESIGN.md 3).
    boardMat.map = this.tex;
    // A dark theme must not swallow the order: the paper carries a little of
    // its own light, keyed off the same map so print stays print.
    boardMat.emissiveMap = this.tex;
    boardMat.emissive.setHex(0xffffff, THREE.SRGBColorSpace);
    // ...and graded against the palette's key, per DESIGN.md 3: the themes with
    // the most bloom (Sushi Tower at 0.58) get the least paper glow, or the
    // docket comes back as a white rectangle with the print burnt off it.
    boardMat.emissiveIntensity = clamp(0.34 - (palette.bloomStrength - 0.32) * 0.55, 0.16, 0.34);
    boardMat.needsUpdate = true;

    const boardGeo = new THREE.PlaneGeometry(TICKET_W, TICKET_H, 1, 1);
    this.board = new THREE.Mesh(boardGeo, boardMat);
    this.board.castShadow = false;
    this.board.receiveShadow = false;

    // Anchored at its left end so scale.x reads as "time remaining".
    const barGeo = new THREE.BoxGeometry(BAR_FULL_W, BAR_H, 0.05);
    barGeo.translate(BAR_FULL_W / 2, 0, 0);
    this.barMat = materials.standard('conveyor.timer', {
      color: 0xffffff,
      emissive: 0xffffff,
      emissiveIntensity: 1.15,
      roughness: 0.4,
      metalness: 0,
    });
    this.bar = new THREE.Mesh(barGeo, this.barMat);
    this.bar.position.set(BAR_X0, BAR_Y, 0.035);

    this.group.add(this.board);
    this.group.add(this.bar);
    this.group.position.set(0, TICKET_Y, TICKET_Z);
    this.group.rotation.x = TICKET_TILT;

    this.paint(null, null);
  }

  // ------------------------------------------------------------------ paint

  /** Repaint the docket. Called on order change and on every item served. */
  paint(order: Order | null, stamp: string | null): void {
    const s = this.surface;
    if (!s) return;
    const c = s.ctx;
    const W = TICKET_TEX_W;
    const H = TICKET_TEX_H;

    c.save();
    c.clearRect(0, 0, W, H);

    // paper
    c.fillStyle = cssHex(this.paper);
    c.fillRect(0, 0, W, H);
    // grain: a few soft horizontal fibres, nothing that reads as noise
    c.fillStyle = cssRgba(this.ink, 0.035);
    for (let i = 0; i < 9; i++) c.fillRect(0, 18 + i * 29, W, 1);
    // printed border
    c.strokeStyle = cssRgba(this.ink, 0.22);
    c.lineWidth = 3;
    c.strokeRect(6, 6, W - 12, H - 12);

    // header
    c.fillStyle = cssHex(this.accent);
    c.fillRect(6, 6, W - 12, HEADER_H - 6);
    c.fillStyle = cssRgba(0xffffff, 0.22);
    c.fillRect(6, 6, W - 12, 8);
    c.fillStyle = '#ffffff';
    c.font = `700 24px ${FONT}`;
    c.textBaseline = 'middle';
    c.textAlign = 'left';
    c.letterSpacing = '4px';
    c.fillText('ORDER', 22, HEADER_H / 2 + 2);
    c.letterSpacing = '0px';
    c.textAlign = 'right';
    c.font = `800 26px ${FONT}`;
    c.fillText(order ? `#${order.number}` : 'SNACKERY', W - 22, HEADER_H / 2 + 2);

    if (order) this.paintRows(c, order);
    else this.paintIdle(c);

    // timer track
    c.fillStyle = cssRgba(this.ink, 0.18);
    roundRect(c, TRACK_X0, TRACK_Y0, TRACK_X1 - TRACK_X0, TRACK_Y1 - TRACK_Y0, 11);
    c.fill();

    if (stamp) this.paintStamp(c, stamp);

    c.restore();
    this.tex.needsUpdate = true;
  }

  private paintIdle(c: CanvasRenderingContext2D): void {
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = cssRgba(this.ink, 0.5);
    c.font = `700 36px ${FONT}`;
    c.letterSpacing = '2px';
    c.fillText('TAP WHAT THE', TICKET_TEX_W / 2, 112);
    c.fillText('TICKET ASKS FOR', TICKET_TEX_W / 2, 164);
    c.letterSpacing = '0px';
  }

  private paintRows(c: CanvasRenderingContext2D, order: Order): void {
    const rows = order.rows;
    const rowH = rowHeight(rows.length);
    const chip = chipSize(rows.length);

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const cy = ROWS_TOP + rowH * (i + 0.5);
      const done = row.got >= row.want;
      const chipX = 22;

      // colour chip — the pre-attentive half of the row
      c.globalAlpha = done ? 0.42 : 1;
      c.fillStyle = cssHex(row.food.tint);
      roundRect(c, chipX, cy - chip / 2, chip, chip, chip * 0.28);
      c.fill();
      c.fillStyle = cssRgba(0xffffff, 0.3);
      roundRect(c, chipX + 5, cy - chip / 2 + 5, chip - 10, chip * 0.34, chip * 0.18);
      c.fill();
      c.strokeStyle = cssRgba(this.ink, 0.35);
      c.lineWidth = 2.5;
      roundRect(c, chipX, cy - chip / 2, chip, chip, chip * 0.28);
      c.stroke();

      // pips, right-aligned
      const pipR = Math.min(14, rowH * 0.2);
      const pipGap = pipR * 2.9;
      const pipsW = row.want > 1 ? pipGap * row.want : 0;
      if (row.want > 1) {
        for (let p = 0; p < row.want; p++) {
          const px = TICKET_TEX_W - 28 - pipGap * (row.want - 1 - p) - pipR;
          c.beginPath();
          c.arc(px, cy, pipR, 0, Math.PI * 2);
          if (p < row.got) {
            c.fillStyle = cssHex(this.accent);
            c.fill();
          } else {
            c.strokeStyle = cssRgba(this.ink, 0.45);
            c.lineWidth = 3;
            c.stroke();
          }
        }
      }

      // name — shrink to fit, never wrap, never clip
      const nameX = chipX + chip + 16;
      const maxW = TICKET_TEX_W - nameX - pipsW - 38;
      const label = row.food.name.toUpperCase();
      let size = Math.min(42, rowH * 0.62);
      c.textAlign = 'left';
      c.textBaseline = 'middle';
      for (; size > 22; size -= 1) {
        c.font = `800 ${size}px ${FONT}`;
        if (c.measureText(label).width <= maxW) break;
      }
      c.fillStyle = cssRgba(this.ink, done ? 0.4 : 1);
      c.fillText(label, nameX, cy + 2);

      if (done) {
        const w = Math.min(c.measureText(label).width, maxW);
        c.strokeStyle = cssRgba(this.ink, 0.55);
        c.lineWidth = 4;
        c.beginPath();
        c.moveTo(nameX - 4, cy + 2);
        c.lineTo(nameX + w + 4, cy + 2);
        c.stroke();
      }
      c.globalAlpha = 1;
    }
  }

  private paintStamp(c: CanvasRenderingContext2D, text: string): void {
    c.save();
    c.translate(TICKET_TEX_W / 2, 142);
    c.rotate(-0.14);
    c.globalAlpha = 0.94;
    c.strokeStyle = cssHex(this.accent);
    c.lineWidth = 7;
    roundRect(c, -186, -44, 372, 88, 14);
    c.stroke();
    c.fillStyle = cssRgba(this.accent, 0.14);
    c.fill();
    c.fillStyle = cssHex(this.accent);
    c.font = `900 52px ${FONT}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.letterSpacing = '4px';
    c.fillText(text, 0, 4);
    c.letterSpacing = '0px';
    c.restore();
  }

  // ----------------------------------------------------------------- runtime

  /** 0..1 of the clock remaining. */
  setTime(frac: number): void {
    this.timeFrac = clamp01(frac);
  }

  /** Knock the board so a wrong grab is felt at the place it is read. */
  knock(strength = 1): void {
    this.nudge = Math.max(this.nudge, strength);
    this.nudgeSeed += 1.7;
  }

  /** A short swell, used when an order lands. */
  celebrate(): void {
    this.pulse = 1;
  }

  update(dt: number, elapsed: number): void {
    this.shownFrac = damp(this.shownFrac, this.timeFrac, 12, dt);
    const f = clamp(this.shownFrac, 0.0001, 1);
    this.bar.scale.x = f;

    // Accent while there is room, red once there is not — and the red pulses,
    // because peripheral vision reads flicker long before it reads a length.
    const danger = clamp01((0.34 - this.timeFrac) / 0.34);
    _warm.setHex(this.accent, THREE.SRGBColorSpace);
    _cool.setRGB(1, 0.16, 0.13);
    _warm.lerp(_cool, danger);
    this.barMat.color.copy(_warm);
    this.barMat.emissive.copy(_warm);
    const flicker = this.calm ? 0 : Math.sin(elapsed * 13) * 0.75;
    this.barMat.emissiveIntensity = 1.05 + danger * (0.9 + flicker) + this.pulse * 1.2;

    this.nudge = damp(this.nudge, 0, 9, dt);
    this.pulse = damp(this.pulse, 0, 6, dt);
    // Reduced motion keeps the colour and the length and drops the movement:
    // the information survives, the vestibular noise does not.
    const shake = this.calm ? 0 : this.nudge * 0.055 + danger * danger * 0.012;
    this.group.position.x = Math.sin(elapsed * 42 + this.nudgeSeed) * shake;
    this.group.position.y = TICKET_Y + Math.sin(elapsed * 31 + this.nudgeSeed) * shake * 0.5;
    const s = 1 + this.pulse * 0.06;
    this.group.scale.set(s, s, 1);
    this.group.rotation.z = Math.sin(elapsed * 27 + this.nudgeSeed) * this.nudge * 0.03;
  }

  dispose(): void {
    (this.board.geometry as THREE.BufferGeometry).dispose();
    (this.bar.geometry as THREE.BufferGeometry).dispose();
    const mat = this.board.material as THREE.MeshStandardMaterial;
    mat.map = null;
    mat.emissiveMap = null;
    mat.needsUpdate = true;
    this.tex.dispose();
    this.surface = null;
    this.group.clear();
  }
}
