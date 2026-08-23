/**
 * Paper painting.
 *
 * One 256px tile per option set, painted once to a canvas and handed back as a
 * CSS `background-image` value. Every mark is drawn through `around()`, which
 * repeats anything crossing a tile boundary on the far side, so the tile is
 * seamless — a card is only ~1.4 tiles wide and a visible seam would give the
 * whole trick away.
 *
 * The layering is the layering of real paper: base tone, uneven pulp density,
 * long fibre strands, short flecks, the print run on top, then wear — grease
 * that saturates the sheet translucent and a crease or two.
 */

import type { ThemeId } from '../../core/types';
import type { PaperKind, PaperOpts } from './api';
import type { Rgb } from './colour';
import { css, mix, shade } from './colour';
import type { Rng } from './rng';
import { makeFbm1, makeRng } from './rng';
import type { ThemePaper } from './stocks';
import { paperBase, STOCKS, THEME_PAPER } from './stocks';

/** 256 CSS px of tile. Big enough to hide the repeat, small enough to ship. */
export const TILE = 256;
const TAU = Math.PI * 2;

type Ctx = CanvasRenderingContext2D;

/**
 * Draw `paint` at every wrapped position whose bounding circle still touches
 * the tile. Anything that runs off an edge comes back on the opposite one.
 */
function around(ctx: Ctx, x: number, y: number, r: number, paint: () => void): void {
  for (let ix = -1; ix <= 1; ix += 1) {
    const ox = ix * TILE;
    if (x + ox + r < 0 || x + ox - r > TILE) continue;
    for (let iy = -1; iy <= 1; iy += 1) {
      const oy = iy * TILE;
      if (y + oy + r < 0 || y + oy - r > TILE) continue;
      ctx.save();
      ctx.translate(ox, oy);
      paint();
      ctx.restore();
    }
  }
}

/** A closed, smoothly-curved lobed outline — the shape of a spilled thing. */
function lobedPath(
  ctx: Ctx,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  lobes: number,
  wobble: number,
  rng: Rng,
): void {
  const pts: Array<[number, number]> = [];
  const phase = rng.next() * TAU;
  const a2 = rng.range(0.4, 1);
  const a3 = rng.range(0.3, 0.9);
  for (let i = 0; i < lobes; i += 1) {
    const t = (i / lobes) * TAU;
    const n =
      Math.sin(t * 2 + phase) * a2 +
      Math.sin(t * 3 - phase * 1.7) * a3 +
      rng.gauss() * 0.9;
    const k = 1 + wobble * n * 0.42;
    pts.push([cx + Math.cos(t) * rx * k, cy + Math.sin(t) * ry * k]);
  }
  ctx.beginPath();
  const mid = (a: [number, number], b: [number, number]): [number, number] => [
    (a[0] + b[0]) / 2,
    (a[1] + b[1]) / 2,
  ];
  let prev = pts[pts.length - 1];
  let start = mid(prev, pts[0]);
  ctx.moveTo(start[0], start[1]);
  for (let i = 0; i < pts.length; i += 1) {
    const cur = pts[i];
    const next = pts[(i + 1) % pts.length];
    const m = mid(cur, next);
    ctx.quadraticCurveTo(cur[0], cur[1], m[0], m[1]);
    prev = cur;
  }
  ctx.closePath();
}

/* ------------------------------------------------------------------ layers */

function fillBase(ctx: Ctx, base: Rgb): void {
  ctx.fillStyle = css(base);
  ctx.fillRect(0, 0, TILE, TILE);
}

/** Uneven pulp density: broad, almost invisible pools of thick and thin. */
function pulp(ctx: Ctx, rng: Rng, base: Rgb, amount: number): void {
  const count = Math.round(9 * amount);
  for (let i = 0; i < count; i += 1) {
    const x = rng.next() * TILE;
    const y = rng.next() * TILE;
    const r = rng.range(46, 132);
    const dark = rng.chance(0.6);
    const col = dark ? shade(base, 0.9) : shade(base, 1.06);
    const a = rng.range(0.1, 0.26) * (dark ? 1 : 0.8);
    around(ctx, x, y, r, () => {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, css(col, a));
      g.addColorStop(1, css(col, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
    });
  }
}

/** Long fibre strands, bowed, biased to the machine direction. */
function fibres(
  ctx: Ctx,
  rng: Rng,
  base: Rgb,
  count: number,
  len: readonly [number, number],
  ink: number,
  grain: number,
): void {
  const wander = makeFbm1(`fibre:${count}`, 20);
  for (let i = 0; i < count; i += 1) {
    const x = rng.next() * TILE;
    const y = rng.next() * TILE;
    const l = rng.range(len[0], len[1]);
    const machine = grain > 0.5 ? Math.PI / 2 : 0;
    const ang = machine + rng.gauss() * (0.5 + (1 - Math.abs(grain - 0.5) * 2) * 1.6);
    const dark = rng.chance(0.62);
    const col = dark ? shade(base, 0.86) : shade(base, 1.12);
    const a = ink * rng.range(0.55, 1.7) * (dark ? 1 : 0.75);
    const w = rng.range(0.4, 1.15);
    const bow = (wander(i * 1.7) + rng.gauss()) * 0.1 * l;
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    const ex = x + dx * l;
    const ey = y + dy * l;
    const mx = (x + ex) / 2 - dy * bow;
    const my = (y + ey) / 2 + dx * bow;
    around(ctx, (x + ex) / 2, (y + ey) / 2, l * 0.75 + 4, () => {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(mx, my, ex, ey);
      ctx.strokeStyle = css(col, a);
      ctx.lineWidth = w;
      ctx.lineCap = 'round';
      ctx.stroke();
    });
  }
}

/** Short flecks: specks of bark and unbeaten pulp. */
function flecks(ctx: Ctx, rng: Rng, base: Rgb, count: number, ink: number): void {
  for (let i = 0; i < count; i += 1) {
    const x = rng.next() * TILE;
    const y = rng.next() * TILE;
    const dark = rng.chance(0.72);
    const col = dark ? shade(base, rng.range(0.6, 0.86)) : shade(base, 1.16);
    const a = ink * rng.range(0.4, 2.1);
    const r = rng.range(0.28, 1.15);
    const long = rng.chance(0.35);
    around(ctx, x, y, 4, () => {
      ctx.fillStyle = css(col, a);
      ctx.beginPath();
      if (long) {
        const ang = rng.next() * Math.PI;
        ctx.ellipse(x, y, r * rng.range(1.6, 3.4), r * 0.6, ang, 0, TAU);
      } else {
        ctx.arc(x, y, r, 0, TAU);
      }
      ctx.fill();
    });
  }
}

/** Tooth: the coarse stipple of a heavier, less-calendered sheet. */
function tooth(ctx: Ctx, rng: Rng, base: Rgb, amount: number): void {
  const count = Math.round(1500 * amount);
  for (let i = 0; i < count; i += 1) {
    const x = rng.next() * TILE;
    const y = rng.next() * TILE;
    const dark = rng.chance(0.55);
    const col = dark ? shade(base, 0.9) : shade(base, 1.07);
    ctx.fillStyle = css(col, rng.range(0.02, 0.075));
    ctx.fillRect(x, y, rng.range(0.6, 1.5), rng.range(0.6, 1.5));
  }
}

/** Broad waxy sheen. Greaseproof is not matte. */
function sheen(ctx: Ctx, rng: Rng, amount: number): void {
  for (let i = 0; i < 3; i += 1) {
    const x = rng.next() * TILE;
    const y = rng.next() * TILE;
    const r = rng.range(110, 190);
    const light = i < 2;
    around(ctx, x, y, r, () => {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(255, 252, 240, ${(light ? 0.09 : 0) * amount})`);
      g.addColorStop(0, `rgba(${light ? '255, 252, 240' : '120, 96, 58'}, ${(light ? 0.09 : 0.05) * amount})`);
      g.addColorStop(1, 'rgba(255, 252, 240, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
    });
  }
}

/**
 * A grease spot. Oil saturates the sheet: it goes warm, darker and a touch
 * more transparent, and the edge where it stopped spreading settles darker
 * still. Never a circle.
 */
function greaseSpot(ctx: Ctx, rng: Rng, x: number, y: number, r: number, strength: number): void {
  const warm: Rgb = [176, 134, 68];
  const rim: Rgb = [150, 108, 52];
  const rx = r * rng.range(0.82, 1.2);
  const ry = r * rng.range(0.82, 1.2);
  around(ctx, x, y, Math.max(rx, ry) * 1.6, () => {
    ctx.save();
    lobedPath(ctx, x, y, rx, ry, 11, 0.5, rng);
    ctx.clip();
    const g = ctx.createRadialGradient(x, y, 0, x, y, Math.max(rx, ry) * 1.06);
    g.addColorStop(0, css(warm, 0.085 * strength));
    g.addColorStop(0.5, css(warm, 0.1 * strength));
    g.addColorStop(0.82, css(rim, 0.125 * strength));
    g.addColorStop(0.96, css(rim, 0.055 * strength));
    g.addColorStop(1, css(rim, 0.01 * strength));
    ctx.fillStyle = g;
    ctx.fillRect(x - rx * 2, y - ry * 2, rx * 4, ry * 4);
    ctx.restore();
    // A second, smaller pool inside — grease pools unevenly.
    ctx.save();
    lobedPath(ctx, x + rng.gauss() * r * 0.7, y + rng.gauss() * r * 0.7, rx * 0.42, ry * 0.42, 9, 0.6, rng);
    ctx.fillStyle = css(rim, 0.035 * strength);
    ctx.fill();
    ctx.restore();
  });
}

/** A fold. A dark valley, a light ridge beside it, both fading at the ends. */
function crease(ctx: Ctx, rng: Rng, base: Rgb): void {
  const x0 = rng.range(-20, TILE * 0.6);
  const y0 = rng.range(-10, TILE);
  const ang = rng.chance(0.5) ? rng.range(-0.5, 0.5) : rng.range(1.1, 2.1);
  const len = rng.range(TILE * 0.7, TILE * 1.3);
  const x1 = x0 + Math.cos(ang) * len;
  const y1 = y0 + Math.sin(ang) * len;
  const nx = -Math.sin(ang);
  const ny = Math.cos(ang);
  const wander = makeFbm1(`crease:${x0.toFixed(2)}`, 14);
  const steps = 26;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const off = wander(t * 6) * 2.4;
    pts.push([x0 + (x1 - x0) * t + nx * off, y0 + (y1 - y0) * t + ny * off]);
  }
  const stroke = (dx: number, dy: number, colour: Rgb, alpha: number, width: number): void => {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, css(colour, 0));
    g.addColorStop(0.2, css(colour, alpha));
    g.addColorStop(0.78, css(colour, alpha));
    g.addColorStop(1, css(colour, 0));
    ctx.strokeStyle = g;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0][0] + dx, pts[0][1] + dy);
    for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i][0] + dx, pts[i][1] + dy);
    ctx.stroke();
  };
  around(ctx, (x0 + x1) / 2, (y0 + y1) / 2, len, () => {
    stroke(0, 0, shade(base, 0.84), 0.055, 3.4);
    stroke(0, 0, shade(base, 0.78), 0.075, 1.1);
    stroke(nx * -1.1, ny * -1.1, shade(base, 1.15), 0.09, 1);
  });
}

/* ------------------------------------------------------------------ prints */

function gingham(ctx: Ctx, rng: Rng, paper: ThemePaper, strength: number): void {
  // 14 checks across the tile — an even count, so the two-cell period still
  // divides 256 and the tile stays seamless.
  const cell = TILE / 14;
  const ink = paper.inks[0];
  const a = 0.082 * strength;
  for (let i = 0; i < TILE / cell; i += 1) {
    if (i % 2 === 0) continue;
    ctx.fillStyle = css(ink, a);
    ctx.fillRect(0, i * cell, TILE, cell);
    ctx.fillRect(i * cell, 0, cell, TILE);
  }
  // Woven thread: fine lines through the coloured bands only.
  ctx.fillStyle = css(ink, 0.022 * strength);
  for (let y = 0; y < TILE; y += 3) {
    const band = Math.floor(y / cell) % 2 === 1;
    if (!band) continue;
    ctx.fillRect(0, y, TILE, 1);
  }
  ctx.fillStyle = css([255, 255, 255], 0.04 * strength);
  for (let x = 1; x < TILE; x += 3) ctx.fillRect(x, 0, 1, TILE);
}

function washi(ctx: Ctx, rng: Rng, base: Rgb, paper: ThemePaper, strength: number): void {
  const fibre = paper.inks[0];
  const gold = paper.inks[1];
  // Washi's signature: long, visible, sparse strands laid across the sheet.
  for (let i = 0; i < 52; i += 1) {
    const x = rng.next() * TILE;
    const y = rng.next() * TILE;
    const l = rng.range(20, 84);
    const ang = rng.next() * TAU;
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    const bow = rng.gauss() * 0.16 * l;
    const ex = x + dx * l;
    const ey = y + dy * l;
    around(ctx, (x + ex) / 2, (y + ey) / 2, l, () => {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo((x + ex) / 2 - dy * bow, (y + ey) / 2 + dx * bow, ex, ey);
      ctx.strokeStyle = css(fibre, rng.range(0.035, 0.105) * strength);
      ctx.lineWidth = rng.range(0.5, 1.5);
      ctx.lineCap = 'round';
      ctx.stroke();
    });
  }
  // Gold leaf flecks — few, tiny, and only just there.
  for (let i = 0; i < 54; i += 1) {
    const x = rng.next() * TILE;
    const y = rng.next() * TILE;
    const r = rng.range(0.4, 1.5);
    around(ctx, x, y, 4, () => {
      ctx.fillStyle = css(gold, rng.range(0.16, 0.42) * strength);
      ctx.beginPath();
      ctx.ellipse(x, y, r * rng.range(1, 2.2), r * 0.7, rng.next() * Math.PI, 0, TAU);
      ctx.fill();
    });
  }
}

function scallopStripe(ctx: Ctx, rng: Rng, paper: ThemePaper, strength: number): void {
  const period = 42.667;
  const draw = (x0: number, width: number, ink: Rgb, alpha: number, bump: number): void => {
    for (let k = 0; k < TILE / period; k += 1) {
      const x = x0 + k * period;
      ctx.beginPath();
      ctx.moveTo(x, -8);
      for (let y = -8; y < TILE + 8; y += 16) {
        ctx.quadraticCurveTo(x - bump, y + 8, x, y + 16);
      }
      ctx.lineTo(x + width, TILE + 8);
      for (let y = TILE + 8; y > -8; y -= 16) {
        ctx.quadraticCurveTo(x + width + bump, y - 8, x + width, y - 16);
      }
      ctx.closePath();
      ctx.fillStyle = css(ink, alpha);
      ctx.fill();
    }
  };
  draw(9, 16, paper.inks[0], 0.1 * strength, 4.2);
  draw(37, 6, paper.inks[1], 0.085 * strength, 2.6);
}

function serape(ctx: Ctx, rng: Rng, paper: ThemePaper, strength: number): void {
  const widths: number[] = [];
  const seq = [20, 3, 2, 3, 12, 3, 2, 3, 24, 3, 2, 3, 15, 3, 2, 3];
  let total = 0;
  for (let i = 0; i < seq.length; i += 1) {
    const w = seq[i] * (1 + rng.gauss() * 0.16);
    widths.push(w);
    total += w;
  }
  // Two runs of the sequence per tile, so a card shows a proper band rhythm
  // rather than two enormous stripes.
  const scale = TILE / 2 / total;
  let y = 0;
  for (let rep = 0; rep < 2; rep += 1) {
    for (let i = 0; i < widths.length; i += 1) {
      const h = widths[i] * scale;
      const wide = widths[i] > 8;
      const ink = paper.inks[i % paper.inks.length];
      ctx.fillStyle = css(ink, (wide ? 0.072 : 0.13) * strength);
      ctx.fillRect(0, y, TILE, h + 0.4);
      y += h;
    }
  }
  // Warp threads running across the weave.
  for (let x = 0; x < TILE; x += 2) {
    ctx.fillStyle = css([90, 62, 40], (x % 4 === 0 ? 0.022 : 0.012) * strength);
    ctx.fillRect(x, 0, 1, TILE);
  }
}

function linen(ctx: Ctx, rng: Rng, paper: ThemePaper, strength: number): void {
  const warp = paper.inks[0];
  const weft = paper.inks[1];
  for (let y = 0; y < TILE; y += 4) {
    ctx.fillStyle = css(warp, (y % 8 === 0 ? 0.058 : 0.032) * strength);
    ctx.fillRect(0, y, TILE, 1.7);
  }
  for (let x = 2; x < TILE; x += 4) {
    ctx.fillStyle = css(weft, (x % 8 === 2 ? 0.05 : 0.028) * strength);
    ctx.fillRect(x, 0, 1.7, TILE);
  }
  // Slubs: the odd thick thread that makes it linen and not graph paper.
  for (let i = 0; i < 16; i += 1) {
    const vertical = rng.chance(0.5);
    const p = Math.round(rng.next() * (TILE / 4)) * 4 + (vertical ? 2 : 0);
    const start = rng.next() * TILE;
    const len = rng.range(24, 90);
    ctx.fillStyle = css(warp, 0.05 * strength);
    around(ctx, vertical ? p : start + len / 2, vertical ? start + len / 2 : p, len, () => {
      if (vertical) ctx.fillRect(p, start, 2.4, len);
      else ctx.fillRect(start, p, len, 2.4);
    });
  }
}

function trattoria(ctx: Ctx, rng: Rng, paper: ThemePaper, strength: number): void {
  const cell = TILE / 10;
  const ink = paper.inks[0];
  const a = 0.088 * strength;
  for (let i = 0; i < TILE / cell; i += 1) {
    if (i % 2 === 0) continue;
    ctx.fillStyle = css(ink, a);
    ctx.fillRect(0, i * cell, TILE, cell);
    ctx.fillRect(i * cell, 0, cell, TILE);
  }
  // Cotton weave inside the print: a fine diagonal, only in the coloured cells.
  ctx.save();
  ctx.globalAlpha = 0.5 * strength;
  ctx.strokeStyle = css([255, 255, 255], 0.09);
  ctx.lineWidth = 1;
  for (let d = -TILE; d < TILE * 2; d += 5) {
    ctx.beginPath();
    ctx.moveTo(d, 0);
    ctx.lineTo(d + TILE, TILE);
    ctx.stroke();
  }
  ctx.restore();
}

function printFor(
  ctx: Ctx,
  rng: Rng,
  base: Rgb,
  theme: ThemeId,
  kind: PaperKind,
): void {
  // Only the napkin takes a themed print. Greaseproof is greaseproof
  // everywhere; one material per role is what keeps this out of jumble-sale
  // territory (DESIGN §8).
  if (kind !== 'napkin') return;
  const paper = THEME_PAPER[theme];
  const s = paper.strength;
  switch (paper.print) {
    case 'gingham':
      gingham(ctx, rng, paper, s);
      break;
    case 'washi':
      washi(ctx, rng, base, paper, s);
      break;
    case 'scallop-stripe':
      scallopStripe(ctx, rng, paper, s);
      break;
    case 'serape':
      serape(ctx, rng, paper, s);
      break;
    case 'linen':
      linen(ctx, rng, paper, s);
      break;
    case 'trattoria':
      trattoria(ctx, rng, paper, s);
      break;
  }
}

/* ------------------------------------------------------------- stock extras */

function stockCharacter(ctx: Ctx, rng: Rng, kind: PaperKind, base: Rgb): void {
  if (kind === 'board') {
    // Corrugation showing faintly through the liner.
    for (let y = 0; y < TILE; y += 1) {
      const s = Math.sin((y / 16) * TAU);
      const a = 0.035 * Math.abs(s);
      ctx.fillStyle = s > 0 ? css([255, 240, 215], a) : css([92, 60, 32], a * 1.15);
      ctx.fillRect(0, y, TILE, 1);
    }
  }
  if (kind === 'ticket') {
    // Thermal paper: near-frictionless, with faint print-head banding.
    for (let i = 0; i < 44; i += 1) {
      const y = rng.next() * TILE;
      const h = rng.range(0.6, 2.2);
      ctx.fillStyle = css([132, 142, 152], rng.range(0.012, 0.03));
      ctx.fillRect(0, y, TILE, h);
    }
    ctx.fillStyle = 'rgba(150, 162, 172, 0.05)';
    ctx.fillRect(0, 0, TILE, TILE);
  }
  if (kind === 'menucard') {
    // Laid lines — the chain marks of a mould-made card.
    for (let x = 0; x < TILE; x += 21) {
      ctx.fillStyle = css(shade(base, 0.95), 0.05);
      ctx.fillRect(x, 0, 1.2, TILE);
    }
  }
}

/**
 * Per-pixel grain, overlaid last.
 *
 * Strands and flecks give paper its *structure*; this gives it its surface.
 * Without it the sheet is convincing at arm's length and plastic at 100%,
 * which is the wrong way round — the whole point of §8 is that the material
 * survives being looked at closely.
 */
function grain(ctx: Ctx, seed: string, amount: number): void {
  const canvas = document.createElement('canvas');
  canvas.width = TILE;
  canvas.height = TILE;
  const gc = canvas.getContext('2d');
  if (!gc) return;
  const img = gc.createImageData(TILE, TILE);
  const data = img.data;
  const rng = makeRng(`grain:${seed}`);
  for (let i = 0; i < data.length; i += 4) {
    // Two samples averaged: pure white noise is television static, this has
    // just enough correlation to read as fibre.
    const v = 128 + (rng.next() + rng.next() - 1) * 108;
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
    data[i + 3] = 255;
  }
  gc.putImageData(img, 0, 0);
  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = amount;
  ctx.drawImage(canvas, 0, 0);
  ctx.restore();
}

/* -------------------------------------------------------------------- paint */

function encode(canvas: HTMLCanvasElement): string {
  // The paper is opaque, so JPEG is on the table and is usually a third of the
  // size of the PNG. Take whichever is smaller — this ships to phones.
  const png = canvas.toDataURL('image/png');
  let jpeg = png;
  try {
    jpeg = canvas.toDataURL('image/jpeg', 0.93);
  } catch {
    /* no JPEG encoder — PNG it is */
  }
  return jpeg.length > 32 && jpeg.length < png.length ? jpeg : png;
}

/** The hairline printed rule some stocks carry, as element-sized CSS layers. */
function ruleLayers(colour: Rgb): string {
  const c = css(colour, 0.26);
  const at = (dir: string): string =>
    `linear-gradient(to ${dir}, rgba(0,0,0,0) 0 6px, ${c} 6px 7px, rgba(0,0,0,0) 7px)`;
  return [at('bottom'), at('top'), at('right'), at('left')].join(', ');
}

/** Paint one tile and return a complete CSS `background-image` value. */
export function paintPaper(opts: PaperOpts): string {
  const kind: PaperKind = opts.kind;
  const stock = STOCKS[kind];
  const base = paperBase(kind, opts.theme, opts.tint);
  const wear = Math.max(0, Math.min(1, opts.wear ?? 0));
  const rng = makeRng(`snack-paper:${kind}:${opts.seed}:${opts.theme ?? '-'}:${wear}`);

  const canvas = document.createElement('canvas');
  canvas.width = TILE;
  canvas.height = TILE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return `linear-gradient(${css(base)}, ${css(base)})`;

  fillBase(ctx, base);
  pulp(ctx, rng, base, stock.blotch * (1 + wear * 0.6));
  stockCharacter(ctx, rng, kind, base);
  fibres(
    ctx,
    rng,
    base,
    Math.round(155 * stock.fibre),
    stock.fibreLen,
    stock.fibreInk,
    stock.grain,
  );
  flecks(ctx, rng, base, Math.round(390 * stock.fleck), stock.fleckInk);
  if (stock.tooth > 0) tooth(ctx, rng, base, stock.tooth);
  if (opts.theme) printFor(ctx, rng, base, opts.theme, kind);
  if (stock.sheen > 0) sheen(ctx, rng, stock.sheen);

  // Wear. Grease first (it sits in the sheet), creases last (they sit on it).
  const spots = stock.grease > 0.3 ? 1 : 0;
  const extra = wear >= 0.36 ? 1 : 0;
  const most = wear >= 0.72 ? 1 : 0;
  const total = spots + extra + most;
  for (let i = 0; i < total; i += 1) {
    greaseSpot(
      ctx,
      rng,
      rng.next() * TILE,
      rng.next() * TILE,
      rng.range(22, 62),
      (0.55 + wear * 0.75) * (0.5 + stock.grease * 1.5),
    );
  }
  if (wear >= 0.5) crease(ctx, rng, base);
  if (wear >= 0.85) crease(ctx, rng, base);
  grain(ctx, `${kind}:${opts.seed}`, stock.grain2);

  const tile = `url("${encode(canvas)}")`;
  const paper = opts.theme ? THEME_PAPER[opts.theme] : null;
  // A printed rule only makes sense on a sheet that was cut, not one that was
  // torn: a straight border chopped up by a scallop reads as a mistake.
  const straight = !opts.edge || opts.edge === 'clean' || opts.edge === 'perforated';
  const rule = paper && kind === 'napkin' && straight ? paper.rule : null;
  return rule ? `${ruleLayers(rule)}, ${tile}` : tile;
}
