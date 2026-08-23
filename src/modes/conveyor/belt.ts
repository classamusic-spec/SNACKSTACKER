/**
 * The conveyor machine: deck, band, rails, rollers, the entry hatch items come
 * out of, and the posts that hold the order docket.
 *
 * It is a piece of catering equipment, so it is brushed steel rather than a
 * theme-coloured slab — but the steel is pulled a fifth of the way toward the
 * palette's `accentSoft` and the flank stripe is the palette's `accent`, which
 * is enough to make it belong to a piazza or a night garden without pretending
 * to be made of pastry.
 *
 * Everything except the moving band is ONE merged, vertex-coloured geometry:
 * one draw call, one program.
 */
import * as THREE from 'three';
import type { MaterialLibrary, ThemePaletteLike } from '../../render/api';
import type { QualityTier } from '../../core/types';
import { box, mergeParts, mixHex, rollerX } from './parts';
import {
  BELT_HALF_W,
  DECK_H,
  TICKET_H,
  TICKET_Y,
  TICKET_Z,
  Z_END,
  Z_HATCH,
  Z_PASS,
} from './tuning';

const LEN = Z_END - Z_HATCH;
const CZ = (Z_END + Z_HATCH) / 2;
/** Repeats of the tread pattern down the length of the belt. */
export const TREAD_REPEATS = 10;

export interface BeltRig {
  /** Parent of everything; already lifted to the table plane. */
  root: THREE.Group;
  band: THREE.Mesh;
  bandTex: THREE.Texture;
  frame: THREE.Mesh;
  /** Local Y the docket board's pivot sits at, for the ticket to parent to. */
  postTopY: number;
}

/** Dark, matte rubber with light ribs — painted near-white so it only modulates. */
function treadPainter(c: CanvasRenderingContext2D, size: number): void {
  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, size, size);
  // Two ribs per tile at ten tiles is one every half a world unit: fine enough
  // to read as a belt, coarse enough to survive the mip chain at the far end,
  // where six ribs per tile just averaged out to flat grey.
  const ribs = 2;
  for (let i = 0; i < ribs; i++) {
    const y = (i / ribs) * size;
    c.fillStyle = 'rgba(96,99,107,0.85)';
    c.fillRect(0, y, size, Math.max(3, size * 0.1));
    c.fillStyle = 'rgba(255,255,255,0.95)';
    c.fillRect(0, y + size * 0.1, size, Math.max(2, size * 0.035));
  }
  // Slat edges catch the key light; a faint seam keeps it from reading as paper.
  c.fillStyle = 'rgba(150,153,160,0.35)';
  c.fillRect(size * 0.5 - 2, 0, 4, size);
}

export function buildBelt(
  materials: MaterialLibrary,
  palette: ThemePaletteLike,
  quality: QualityTier,
): BeltRig {
  // The mode root already carries the table height and the play yaw, so the
  // belt is authored in a clean local frame: +Z toward the camera, y = 0 table.
  const root = new THREE.Group();

  const steel = mixHex(0xd7dce2, palette.accentSoft, 0.2);
  const steelDark = mixHex(0x646c76, palette.ground, 0.25);
  const railTop = mixHex(0xdfe5ec, palette.accentSoft, 0.16);
  const accent = palette.accent;
  const mouth = mixHex(0x14161a, palette.ground, 0.4);

  const parts: (THREE.BufferGeometry | null)[] = [];

  // --- deck ----------------------------------------------------------------
  // The band's top face is DECK_H; the steel underneath stops 5mm short of it,
  // because the first build had the deck at 0.23 and it buried the belt.
  parts.push(box(1.52, 0.1, LEN, steelDark, 0, 0.05, CZ));
  parts.push(box(1.44, 0.115, LEN, steel, 0, 0.1575, CZ));

  // --- side rails, with the theme's accent painted down the flank ----------
  for (const s of [-1, 1]) {
    parts.push(box(0.105, 0.135, LEN, railTop, s * (BELT_HALF_W + 0.06), 0.2575, CZ));
    parts.push(box(0.125, 0.1, LEN, accent, s * (BELT_HALF_W + 0.055), 0.155, CZ));
  }

  // --- rollers: the nose of the belt at each end ---------------------------
  const rollerSegs = quality === 'low' ? 8 : quality === 'medium' ? 12 : 16;
  parts.push(rollerX(0.095, 1.4, rollerSegs, railTop, 0, DECK_H - 0.095, Z_HATCH + 0.06));
  parts.push(rollerX(0.095, 1.4, rollerSegs, railTop, 0, DECK_H - 0.095, Z_END - 0.06));

  // --- the far end --------------------------------------------------------
  // The first build put a hood here. It was invisible: at this camera pitch a
  // 0.6-unit hood at z -4.4 projects to screen y 273-308, and the docket's
  // bottom edge is at 297 — 11 pixels of it survived. So the docket IS the
  // service window; the belt just runs under it, and all that is left at the
  // end is a stop plate low enough to sit in the gap.
  parts.push(box(1.62, 0.2, 0.12, steelDark, 0, 0.14, Z_HATCH - 0.09));
  parts.push(box(1.36, 0.1, 0.05, mouth, 0, 0.19, Z_HATCH - 0.04));

  // --- the pass line -------------------------------------------------------
  // Without this the player cannot see where "too late" is; the first build had
  // items simply stop mattering at an invisible z and it read as a bug.
  parts.push(box(BELT_HALF_W * 2, 0.012, 0.075, accent, 0, DECK_H + 0.007, Z_PASS));
  for (const s of [-1, 1]) {
    parts.push(box(0.13, 0.075, 0.3, accent, s * (BELT_HALF_W + 0.06), 0.36, Z_PASS));
    parts.push(box(0.14, 0.02, 0.09, railTop, s * (BELT_HALF_W + 0.06), 0.4, Z_PASS));
  }

  // --- docket posts and clip rail -----------------------------------------
  const postTopY = TICKET_Y - TICKET_H / 2 + 0.02;
  const postZ = TICKET_Z + 0.24;
  for (const s of [-1, 1]) {
    parts.push(
      box(0.075, postTopY - 0.13, 0.075, railTop, s * 0.78, (postTopY + 0.13) / 2, postZ),
    );
  }
  parts.push(box(1.86, 0.075, 0.1, steelDark, 0, postTopY, postZ));

  const frameGeo = mergeParts(parts);
  const frameMat = materials.standard('conveyor.frame', {
    color: 0xffffff,
    vertexColors: true,
    metalness: 0.45,
    roughness: 0.33,
  });
  const frame = new THREE.Mesh(frameGeo ?? new THREE.BoxGeometry(0.1, 0.1, 0.1), frameMat);
  frame.castShadow = true;
  frame.receiveShadow = true;
  root.add(frame);

  // --- the moving band ----------------------------------------------------
  const bandTex = materials.texture('conveyor.tread', treadPainter, {
    size: 128,
    repeat: [1, TREAD_REPEATS],
  });
  const bandGeo = new THREE.PlaneGeometry(BELT_HALF_W * 2, LEN, 1, 1);
  bandGeo.rotateX(-Math.PI / 2);
  bandGeo.translate(0, DECK_H, CZ);
  const band = new THREE.Mesh(
    bandGeo,
    materials.standard('conveyor.band', {
      color: 0x3b3d44,
      map: bandTex,
      roughness: 0.82,
      metalness: 0.05,
    }),
  );
  band.receiveShadow = true;
  root.add(band);

  return { root, band, bandTex, frame, postTopY };
}
