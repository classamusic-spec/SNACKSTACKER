/**
 * Candy Stack — pastel, glossy, high-key.
 *
 * The silhouette rule does the heavy lifting in this theme: a macaron, a
 * marshmallow, a gummy and a nougat block would all be "a pale puck" if we let
 * them, so each one gets a structural tell — the macaron its ruffled feet and
 * sandwich seam, the gummy a row of separate jelly logs, the chocolate its
 * moulding grid, the lollipop its stick.
 */
import * as THREE from 'three';
import type { FoodBuildCtx, FoodDef, ThemeDef } from '../api';
import { Rng } from '../../core/rng';
import { TAU, clamp } from '../../core/math';
import { mergeAll, mesh, pillow, pour, puck, roughen, roundedBox, ruffle, tintGeometry } from '../kit';
import {
  discXZ,
  fillFlat,
  fillGradient,
  finalize,
  longAxis,
  noiseWash,
  propCount,
  propScale,
  safeD,
  safeH,
  safeRadius,
  safeW,
  scatterOnSurface,
  seg,
  sheet,
  speckle,
  topSampler,
} from './shared-fresh';

// ---------------------------------------------------------------------------
// palettes shared by geometry and materials
// ---------------------------------------------------------------------------

const MACARON_SHELLS = [0xffb3d1, 0xb6ebd8, 0xd8c6ff, 0xffe7a3] as const;
const GUMMY_TINTS = [
  { body: 0xff3d68, atten: 0xff0f45 },
  { body: 0x5fd65a, atten: 0x1fbf2a },
  { body: 0xffa02e, atten: 0xff7000 },
] as const;
const SPRINKLE_COLORS = [0xff5fa2, 0x7be0e0, 0xffe7a3, 0xffffff, 0x9ad8ff, 0xb6ebd8] as const;
const CONFETTI_COLORS = [0xff5fa2, 0x7be0e0, 0xffe7a3, 0xffffff, 0xd8c6ff] as const;

// ---------------------------------------------------------------------------
// painted textures
// ---------------------------------------------------------------------------

/** Near-white almond grain, tinted by each shell material's own colour. */
function paintShellGrain(c: CanvasRenderingContext2D, size: number): void {
  fillFlat(c, size, '#ffffff');
  speckle(c, size, 340, ['#f0e6ea', '#ffffff', '#e8dde3'], 0.002, 0.008, 31, 0.5);
  noiseWash(c, size, 5, 0.14, 12, '#c9bcc4', '#ffffff');
}

function paintMarshmallow(c: CanvasRenderingContext2D, size: number): void {
  fillFlat(c, size, '#fff3f7');
  noiseWash(c, size, 6, 0.1, 44, '#e8d4dd', '#ffffff');
  // icing-sugar dusting
  speckle(c, size, 900, ['#ffffff', '#fffafc'], 0.0015, 0.0055, 77, 0.85);
  speckle(c, size, 120, ['#f2dde5'], 0.003, 0.01, 78, 0.35);
}

function paintChocolate(c: CanvasRenderingContext2D, size: number): void {
  fillGradient(c, size, [
    [0, '#5A3020'],
    [0.5, '#4A2618'],
    [1, '#3A1C11'],
  ]);
  noiseWash(c, size, 4, 0.16, 5, '#2A1209', '#6B3B26');
  speckle(c, size, 200, ['#5E331F', '#3A1C11'], 0.002, 0.009, 6, 0.4);
}

function paintWaffleBump(c: CanvasRenderingContext2D, size: number): void {
  fillFlat(c, size, '#8a8a8a');
  const n = 8;
  const s = size / n;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      c.fillStyle = '#dcdcdc';
      c.fillRect(x * s + s * 0.12, y * s + s * 0.12, s * 0.76, s * 0.76);
    }
  }
  c.strokeStyle = '#2b2b2b';
  c.lineWidth = Math.max(1, s * 0.13);
  c.beginPath();
  for (let i = 0; i <= n; i++) {
    c.moveTo(i * s, 0);
    c.lineTo(i * s, size);
    c.moveTo(0, i * s);
    c.lineTo(size, i * s);
  }
  c.stroke();
}

function paintWafer(c: CanvasRenderingContext2D, size: number): void {
  fillFlat(c, size, '#E8C489');
  noiseWash(c, size, 5, 0.16, 61, '#B98F52', '#F7E0B6');
  speckle(c, size, 160, ['#C79A5C', '#F5DFB6'], 0.002, 0.008, 62, 0.5);
}

/** Classic radiating lollipop swirl, painted straight onto the disc's UVs. */
function paintSwirl(c: CanvasRenderingContext2D, size: number): void {
  fillFlat(c, size, '#FFFFFF');
  const arms = 6;
  const cols = ['#FF5FA2', '#FFFFFF', '#7BE0E0', '#FFFFFF', '#FFE7A3', '#FFFFFF'];
  c.save();
  c.translate(size / 2, size / 2);
  c.lineCap = 'round';
  for (let a = 0; a < arms; a++) {
    const phase = (a / arms) * TAU;
    c.beginPath();
    c.moveTo(0, 0);
    for (let t = 0; t <= 1.001; t += 0.025) {
      const r = t * size * 0.52;
      const th = phase + t * 3.4;
      c.lineTo(Math.cos(th) * r, Math.sin(th) * r);
    }
    c.lineWidth = size * 0.07;
    c.strokeStyle = cols[a % cols.length];
    c.stroke();
  }
  c.beginPath();
  c.arc(0, 0, size * 0.055, 0, TAU);
  c.fillStyle = '#FF5FA2';
  c.fill();
  c.restore();
  noiseWash(c, size, 8, 0.06, 3, '#d0a8bd', '#ffffff');
}

function paintNougat(c: CanvasRenderingContext2D, size: number): void {
  fillFlat(c, size, '#F3E3C2');
  noiseWash(c, size, 6, 0.13, 88, '#CBB68C', '#FFF8E6');
  // aerated bubbles
  const rng = new Rng(0x0a17);
  for (let i = 0; i < 90; i++) {
    const r = size * rng.range(0.006, 0.022);
    const x = rng.next() * size;
    const y = rng.next() * size;
    c.beginPath();
    c.arc(x, y, r, 0, TAU);
    c.fillStyle = 'rgba(214,193,155,0.5)';
    c.fill();
    c.beginPath();
    c.arc(x - r * 0.25, y - r * 0.25, r * 0.6, 0, TAU);
    c.fillStyle = 'rgba(255,252,240,0.55)';
    c.fill();
  }
}

// ---------------------------------------------------------------------------
// materials
// ---------------------------------------------------------------------------

const shellGrain = (ctx: FoodBuildCtx): THREE.Texture =>
  ctx.materials.texture('candy.shell.grain', paintShellGrain, { size: 128 });

function macaronShellMat(ctx: FoodBuildCtx, variant: number): THREE.Material {
  const v = ((variant % MACARON_SHELLS.length) + MACARON_SHELLS.length) % MACARON_SHELLS.length;
  return ctx.materials.physical(`candy.macaron.shell.${v}`, {
    color: MACARON_SHELLS[v],
    map: shellGrain(ctx),
    roughness: 0.55,
    metalness: 0,
    clearcoat: 0.14,
    clearcoatRoughness: 0.6,
    sheen: 0.3,
    sheenColor: 0xffffff,
    sheenRoughness: 0.7,
    side: THREE.DoubleSide,
  });
}

const macaronFillingMat = (ctx: FoodBuildCtx): THREE.Material =>
  ctx.materials.physical('candy.macaron.filling', {
    color: 0xffe6c7,
    roughness: 0.38,
    metalness: 0,
    clearcoat: 0.4,
    clearcoatRoughness: 0.3,
  });

function gummyMat(ctx: FoodBuildCtx, variant: number): THREE.Material {
  const v = ((variant % GUMMY_TINTS.length) + GUMMY_TINTS.length) % GUMMY_TINTS.length;
  const t = GUMMY_TINTS[v];
  return ctx.materials.physical(`candy.gummy.${v}`, {
    color: t.body,
    roughness: 0.15,
    metalness: 0,
    transmission: 0.75,
    thickness: 0.34,
    ior: 1.4,
    attenuationColor: t.atten,
    attenuationDistance: 0.42,
    clearcoat: 0.6,
    clearcoatRoughness: 0.12,
  });
}

const sugarMat = (ctx: FoodBuildCtx): THREE.Material =>
  ctx.materials.standard('candy.sugar', {
    color: 0xfffdf6,
    roughness: 0.42,
    metalness: 0,
    flatShading: true,
  });

const marshmallowMat = (ctx: FoodBuildCtx): THREE.Material =>
  ctx.materials.standard('candy.marshmallow', {
    color: 0xfff3f7,
    map: ctx.materials.texture('candy.marshmallow.albedo', paintMarshmallow, { size: 128 }),
    roughness: 0.95,
    metalness: 0,
  });

const chocolateMat = (ctx: FoodBuildCtx): THREE.Material =>
  ctx.materials.standard('candy.chocolate', {
    color: 0x4a2618,
    map: ctx.materials.texture('candy.chocolate.albedo', paintChocolate, { size: 128 }),
    roughness: 0.28,
    metalness: 0,
  });

const biscuitMat = (ctx: FoodBuildCtx): THREE.Material =>
  ctx.materials.standard('candy.wafer.biscuit', {
    color: 0xe8c489,
    map: ctx.materials.texture('candy.wafer.albedo', paintWafer, { size: 128 }),
    bumpMap: ctx.materials.dataTexture('candy.wafer.bump', paintWaffleBump, { size: 128 }),
    bumpScale: 0.012,
    roughness: 0.78,
    metalness: 0,
  });

const waferCreamMat = (ctx: FoodBuildCtx): THREE.Material =>
  ctx.materials.standard('candy.wafer.cream', {
    color: 0xfff2da,
    roughness: 0.6,
    metalness: 0,
  });

const icingMat = (ctx: FoodBuildCtx): THREE.Material =>
  ctx.materials.physical('candy.icing', {
    color: 0xffc2e4,
    roughness: 0.12,
    metalness: 0,
    clearcoat: 0.9,
    clearcoatRoughness: 0.06,
    sheen: 0.2,
    sheenColor: 0xffffff,
  });

const sprinkleMat = (ctx: FoodBuildCtx): THREE.Material =>
  ctx.materials.standard('candy.sprinkles', {
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.34,
    metalness: 0,
  });

const lollyMat = (ctx: FoodBuildCtx): THREE.Material =>
  ctx.materials.physical('candy.lolly.body', {
    color: 0xff5fa2,
    roughness: 0.08,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
    transmission: 0.28,
    thickness: 0.14,
    ior: 1.45,
    attenuationColor: 0xff2f86,
    attenuationDistance: 0.3,
  });

const lollyFaceMat = (ctx: FoodBuildCtx): THREE.Material =>
  ctx.materials.physical('candy.lolly.face', {
    color: 0xffffff,
    map: ctx.materials.texture('candy.lolly.swirl', paintSwirl, { size: 256 }),
    roughness: 0.06,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
    side: THREE.DoubleSide,
  });

const stickMat = (ctx: FoodBuildCtx): THREE.Material =>
  ctx.materials.standard('candy.lolly.stick', {
    color: 0xfdf8f0,
    roughness: 0.72,
    metalness: 0,
  });

const nougatMat = (ctx: FoodBuildCtx): THREE.Material =>
  ctx.materials.standard('candy.nougat', {
    color: 0xf3e3c2,
    map: ctx.materials.texture('candy.nougat.albedo', paintNougat, { size: 128 }),
    roughness: 0.72,
    metalness: 0,
  });

const nutMat = (ctx: FoodBuildCtx): THREE.Material =>
  ctx.materials.standard('candy.nuts', {
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.48,
    metalness: 0,
  });

// ---------------------------------------------------------------------------
// 1 — macaron shell
// ---------------------------------------------------------------------------

function buildMacaron(ctx: FoodBuildCtx): THREE.Object3D {
  const w = safeW(ctx);
  const d = safeD(ctx);
  const h = safeH(ctx);
  const g = new THREE.Group();

  const shellMat = macaronShellMat(ctx, ctx.index);
  const shellH = h * 0.33;
  const fillH = h * 0.2;
  const footH = shellH * 0.5;
  const radial = seg(ctx, 40, 28, 16);
  const frillSegs = seg(ctx, 64, 44, 24);

  const bottom = puck(w, shellH, d, {
    domed: 0.18,
    wobble: 0.045,
    taper: 0.04,
    radial,
    rings: 5,
    seed: ctx.index + 1,
  });
  g.add(mesh(bottom, shellMat));

  // "the feet" — the ruffled frill that makes a macaron a macaron
  const feetLow = ruffle(w * 0.99, footH, d * 0.99, {
    folds: 22,
    amplitude: 0.1,
    seed: ctx.index * 2 + 1,
    segments: frillSegs,
  });
  const flm = mesh(feetLow, shellMat);
  flm.position.y = shellH - footH * 0.92;
  g.add(flm);

  const filling = puck(w * 0.97, fillH, d * 0.97, {
    domed: 0,
    wobble: 0.2,
    radial: seg(ctx, 32, 22, 14),
    rings: 3,
    seed: ctx.index + 8,
  });
  const fm = mesh(filling, macaronFillingMat(ctx));
  fm.position.y = shellH * 0.94;
  g.add(fm);

  const topBase = shellH * 0.94 + fillH * 0.86;
  const feetHigh = ruffle(w * 0.99, footH, d * 0.99, {
    folds: 22,
    amplitude: 0.1,
    seed: ctx.index * 2 + 5,
    segments: frillSegs,
  });
  const fhm = mesh(feetHigh, shellMat);
  fhm.position.y = topBase - footH * 0.08;
  g.add(fhm);

  const top = puck(w, shellH, d, {
    domed: 0.55,
    wobble: 0.045,
    taper: 0.09,
    radial,
    rings: 6,
    seed: ctx.index + 4,
  });
  const tm = mesh(top, shellMat);
  tm.position.y = topBase;
  g.add(tm);

  return finalize(g, ctx);
}

// ---------------------------------------------------------------------------
// 2 — gummy slab (a row of jelly logs)
// ---------------------------------------------------------------------------

function buildGummy(ctx: FoodBuildCtx): THREE.Object3D {
  const w = safeW(ctx);
  const d = safeD(ctx);
  const h = safeH(ctx);
  const g = new THREE.Group();

  const alongX = longAxis(ctx) === 'x';
  const L = alongX ? w : d;
  const S = alongX ? d : w;
  const n = clamp(Math.round(L / 0.58), 1, ctx.offcut ? 3 : 5);
  const step = L / n;

  const logs: THREE.BufferGeometry[] = [];
  for (let i = 0; i < n; i++) {
    const at = -L / 2 + step * (i + 0.5);
    const log = pillow(
      alongX ? step * 0.9 : S * 0.99,
      h * 0.99,
      alongX ? S * 0.99 : step * 0.9,
      { round: 0.88, segments: seg(ctx, 20, 15, 10), squash: 0.2 },
    );
    log.translate(alongX ? at : 0, 0, alongX ? 0 : at);
    logs.push(log);
  }
  const geo = mergeAll(logs);
  if (geo) {
    const jelly = mesh(geo, gummyMat(ctx, ctx.index));
    g.add(jelly);

    // sugar crystals catching the light along the tops
    if (!ctx.offcut) {
      const surface = topSampler(geo, 12);
      const ps = propScale(ctx);
      const crystals = scatterOnSurface(
        propCount(ctx, 46, 0),
        w,
        d,
        surface,
        (_i, rng) => new THREE.OctahedronGeometry(0.014 * ps * rng.range(0.7, 1.4), 0),
        { seed: ctx.index * 9 + 4, margin: 0.03 * ps, randomTilt: 0.8, sink: 0.004 },
      );
      if (crystals) g.add(mesh(crystals, sugarMat(ctx)));
    }
  }

  return finalize(g, ctx);
}

// ---------------------------------------------------------------------------
// 3 — marshmallow
// ---------------------------------------------------------------------------

function buildMarshmallow(ctx: FoodBuildCtx): THREE.Object3D {
  const w = safeW(ctx);
  const d = safeD(ctx);
  const h = safeH(ctx);
  const g = new THREE.Group();
  const mat = marshmallowMat(ctx);
  const radial = seg(ctx, 34, 24, 14);

  // two soft drums with a faint seam — the "cut cylinder" tell
  const lowH = h * 0.5;
  const low = puck(w, lowH, d, {
    domed: 0.06,
    wobble: 0.045,
    taper: -0.03,
    radial,
    rings: 4,
    seed: ctx.index + 2,
  });
  roughen(low, Math.min(w, d) * 0.004, 6, ctx.index);
  g.add(mesh(low, mat));

  const highH = h * 0.52;
  const high = puck(w * 0.985, highH, d * 0.985, {
    domed: 0.42,
    wobble: 0.05,
    taper: 0.12,
    radial,
    rings: 6,
    seed: ctx.index + 6,
  });
  roughen(high, Math.min(w, d) * 0.004, 6, ctx.index + 3);
  const hm = mesh(high, mat);
  hm.position.y = lowH * 0.97;
  g.add(hm);

  return finalize(g, ctx);
}

// ---------------------------------------------------------------------------
// 4 — chocolate bar
// ---------------------------------------------------------------------------

function buildChocolate(ctx: FoodBuildCtx): THREE.Object3D {
  const w = safeW(ctx);
  const d = safeD(ctx);
  const h = safeH(ctx);
  const g = new THREE.Group();
  const mat = chocolateMat(ctx);

  const baseH = h * 0.55;
  const base = roundedBox(
    w,
    baseH,
    d,
    safeRadius(Math.min(w, d) * 0.035, w, d, baseH),
    seg(ctx, 3, 2, 2),
  );
  g.add(mesh(base, mat));

  // The moulding grid IS the identity — always at least one raised square.
  const cols = clamp(Math.round(w / 0.55), 1, 5);
  const rows = clamp(Math.round(d / 0.55), 1, 5);
  const cw = w / cols;
  const cd = d / rows;
  const bumpH = h * 0.5;
  const bumps: THREE.BufferGeometry[] = [];
  for (let r = 0; r < rows; r++) {
    for (let cIdx = 0; cIdx < cols; cIdx++) {
      const bw = cw * 0.84;
      const bd = cd * 0.84;
      const cell = roundedBox(
        bw,
        bumpH,
        bd,
        safeRadius(Math.min(bw, bd) * 0.16, bw, bd, bumpH),
        seg(ctx, 3, 2, 2),
      );
      cell.translate(-w / 2 + cw * (cIdx + 0.5), baseH * 0.92, -d / 2 + cd * (r + 0.5));
      bumps.push(cell);
    }
  }
  const grid = mergeAll(bumps);
  if (grid) g.add(mesh(grid, mat));

  return finalize(g, ctx);
}

// ---------------------------------------------------------------------------
// 5 — wafer
// ---------------------------------------------------------------------------

function buildWafer(ctx: FoodBuildCtx): THREE.Object3D {
  const w = safeW(ctx);
  const d = safeD(ctx);
  const h = safeH(ctx);
  const g = new THREE.Group();

  const biscuitT = h * 0.22;
  const creamT = h * 0.17;
  const segs = seg(ctx, 12, 9, 6);
  let y = 0;

  for (let i = 0; i < 5; i++) {
    const isBiscuit = i % 2 === 0;
    const t = isBiscuit ? biscuitT : creamT;
    const inset = isBiscuit ? 1 : 0.955;
    const leaf = sheet(w * inset, t, d * inset, {
      wave: t * 0.16,
      waveFreq: 3.4,
      seed: ctx.index * 3 + i,
      segments: segs,
    });
    if (isBiscuit) roughen(leaf, t * 0.07, 14, ctx.index + i);
    const m = mesh(leaf, isBiscuit ? biscuitMat(ctx) : waferCreamMat(ctx));
    m.position.y = y;
    g.add(m);
    y += t * 0.98;
  }

  return finalize(g, ctx);
}

// ---------------------------------------------------------------------------
// 6 — sprinkle icing
// ---------------------------------------------------------------------------

function buildIcing(ctx: FoodBuildCtx): THREE.Object3D {
  const w = safeW(ctx);
  const d = safeD(ctx);
  const h = safeH(ctx);
  const g = new THREE.Group();

  const body = pour(w * 0.99, h * 0.68, d * 0.99, {
    drips: ctx.offcut ? 3 : 6,
    dripLength: 0.42,
    seed: ctx.index * 5 + 3,
    radial: seg(ctx, 52, 38, 20),
  });
  // Drips hang to the layer's own base, never below it — the food must stay
  // inside y in [0, height].
  body.computeBoundingBox();
  const bb = body.boundingBox;
  if (bb) body.translate(0, -bb.min.y, 0);
  const surface = topSampler(body, ctx.offcut ? 6 : 12);
  g.add(mesh(body, icingMat(ctx)));

  const ps = propScale(ctx);
  const sr = 0.017 * ps;
  const sprinkles = scatterOnSurface(
    propCount(ctx, 90, 3),
    w * 0.92,
    d * 0.92,
    surface,
    (_i, rng) => {
      const cap = new THREE.CapsuleGeometry(sr, sr * rng.range(2.6, 4.2), 2, seg(ctx, 6, 5, 4));
      cap.rotateZ(Math.PI / 2);
      return tintGeometry(cap, SPRINKLE_COLORS[rng.int(0, SPRINKLE_COLORS.length)]);
    },
    {
      seed: ctx.index * 17 + 6,
      margin: sr * 3,
      spacing: 0.02,
      randomTilt: 0.55,
      sink: sr * 0.35,
    },
  );
  if (sprinkles) g.add(mesh(sprinkles, sprinkleMat(ctx)));

  return finalize(g, ctx);
}

// ---------------------------------------------------------------------------
// 7 — lollipop disc
// ---------------------------------------------------------------------------

function buildLollipop(ctx: FoodBuildCtx): THREE.Object3D {
  const w = safeW(ctx);
  const d = safeD(ctx);
  const h = safeH(ctx);
  const g = new THREE.Group();
  const radial = seg(ctx, 40, 28, 16);

  const bodyH = h * 0.82;
  const body = puck(w * 0.99, bodyH, d * 0.99, {
    domed: 0.2,
    wobble: 0.02,
    radial,
    rings: 3,
    seed: ctx.index + 5,
  });
  g.add(mesh(body, lollyMat(ctx)));

  // painted swirl on the top face
  const face = discXZ(w * 0.9, d * 0.9, radial);
  const fm = mesh(face, lollyFaceMat(ctx), { cast: false });
  fm.position.y = bodyH * 1.09;
  g.add(fm);

  // the stick — the single most identifiable thing about a lollipop
  const alongX = longAxis(ctx) === 'x';
  const L = alongX ? w : d;
  if (!ctx.offcut && Math.min(w, d) > 0.26) {
    const inner = -L * 0.1;
    const outer = L * 0.5 + Math.min(0.55, L * 0.42);
    const len = outer - inner;
    const r = clamp(Math.min(h * 0.16, 0.036), 0.008, 0.05);
    const stick = new THREE.CylinderGeometry(r, r, len, seg(ctx, 10, 8, 6), 1);
    stick.rotateZ(Math.PI / 2);
    if (!alongX) stick.rotateY(Math.PI / 2);
    const mid = (inner + outer) / 2;
    stick.translate(alongX ? mid : 0, bodyH * 0.5, alongX ? 0 : mid);
    g.add(mesh(stick, stickMat(ctx)));
  }

  return finalize(g, ctx);
}

// ---------------------------------------------------------------------------
// 8 — nougat
// ---------------------------------------------------------------------------

function buildNougat(ctx: FoodBuildCtx): THREE.Object3D {
  const w = safeW(ctx);
  const d = safeD(ctx);
  const h = safeH(ctx);
  const g = new THREE.Group();

  const body = pillow(w, h * 0.94, d, {
    round: 0.22,
    segments: seg(ctx, 26, 18, 12),
    squash: 0.15,
  });
  roughen(body, Math.min(w, d, h) * 0.02, 9, ctx.index * 2 + 1);
  const surface = topSampler(body, ctx.offcut ? 6 : 12);
  g.add(mesh(body, nougatMat(ctx)));

  // whole nuts pressed into the top
  const ps = propScale(ctx);
  const nuts = scatterOnSurface(
    propCount(ctx, 22, 1),
    w,
    d,
    surface,
    (i, rng) => {
      const r = 0.05 * ps * rng.range(0.8, 1.2);
      const nut = new THREE.SphereGeometry(r, seg(ctx, 9, 7, 5), seg(ctx, 7, 5, 4));
      nut.scale(1.35, 0.72, 1);
      return tintGeometry(nut, i % 3 === 0 ? 0x9ec45a : 0xe6cfa2);
    },
    { seed: ctx.index * 23 + 7, margin: 0.075 * ps, spacing: 0.1, randomTilt: 0.35, sink: 0.02 * ps },
  );
  if (nuts) g.add(mesh(nuts, nutMat(ctx)));

  return finalize(g, ctx);
}

// ---------------------------------------------------------------------------
// plate + scenery
// ---------------------------------------------------------------------------

const STAND_TOP = 0.1;
const STAND_STEM = 0.28;
const STAND_FOOT = 0.07;
const PLATE_T = STAND_TOP + STAND_STEM + STAND_FOOT;

function buildPlate(ctx: FoodBuildCtx): THREE.Object3D {
  const w = Math.max(ctx.width, 0.6);
  const d = Math.max(ctx.depth, 0.6);
  const g = new THREE.Group();

  const acrylic = ctx.materials.physical('candy.stand', {
    color: 0xffd9ee,
    roughness: 0.07,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
    iridescence: 0.45,
    sheen: 0.3,
    sheenColor: 0xbfe9ff,
  });

  // The stand's top surface is EXACTLY y = 0 so the tower's first layer lands
  // flush on it; everything else hangs below in y in [-PLATE_T, 0].
  const top = puck(w, STAND_TOP, d, { domed: 0, wobble: 0.008, radial: 52, rings: 2, seed: 2 });
  top.translate(0, -STAND_TOP, 0);
  g.add(mesh(top, acrylic));

  // rolled rim, top of the roll flush with y = 0
  const tube = 0.035;
  const rim = new THREE.TorusGeometry(0.5 - tube, tube, 8, 44);
  rim.rotateX(-Math.PI / 2);
  rim.scale(w, 1, d);
  rim.translate(0, -tube, 0);
  g.add(mesh(rim, acrylic));

  const stem = puck(w * 0.26, STAND_STEM, d * 0.26, { domed: 0, wobble: 0.02, taper: -0.25, radial: 30, rings: 3, seed: 3 });
  stem.translate(0, -STAND_TOP - STAND_STEM, 0);
  g.add(mesh(stem, acrylic));

  const foot = puck(w * 0.52, STAND_FOOT, d * 0.52, { domed: 0, wobble: 0.01, taper: 0.35, radial: 36, rings: 2, seed: 4 });
  foot.translate(0, -PLATE_T, 0);
  g.add(mesh(foot, acrylic));

  return g;
}

function buildScenery(ctx: FoodBuildCtx): THREE.Object3D {
  const g = new THREE.Group();
  const w = Math.max(ctx.width, 1);
  const groundY = -PLATE_T;
  const inner = w * 0.75;
  const spread = w * 3.4;

  const confettiMat = ctx.materials.standard('candy.confetti', {
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.45,
    metalness: 0,
  });

  const count = ctx.quality === 'low' ? 60 : ctx.quality === 'medium' ? 110 : 170;
  const dots = scatterOnSurface(
    count,
    spread,
    spread,
    () => groundY + 0.004,
    (_i, rng, x, z) => {
      // annulus only — the plate would hide anything under it
      if (Math.hypot(x, z) < inner) return null;
      const r = rng.range(0.035, 0.075);
      const dot = new THREE.CylinderGeometry(r, r, 0.012, 10, 1);
      return tintGeometry(dot, CONFETTI_COLORS[rng.int(0, CONFETTI_COLORS.length)]);
    },
    { seed: 91, margin: 0.1, randomTilt: 0.06 },
  );
  if (dots) g.add(mesh(dots, confettiMat, { cast: false, receive: true }));

  return g;
}

// ---------------------------------------------------------------------------
// theme
// ---------------------------------------------------------------------------

const foods: FoodDef[] = [
  {
    id: 'candy.macaron',
    name: 'Macaron Shell',
    glyph: '🍬',
    thickness: 0.6,
    tint: 0xffb3d1,
    tintAlt: 0xffe6c7,
    weight: 1.2,
    build: buildMacaron,
  },
  {
    id: 'candy.gummy',
    name: 'Gummy Slab',
    glyph: '🐻',
    thickness: 0.38,
    tint: 0xff3d68,
    tintAlt: 0xffa02e,
    build: buildGummy,
  },
  {
    id: 'candy.marshmallow',
    name: 'Marshmallow',
    glyph: '☁️',
    thickness: 0.52,
    tint: 0xfff3f7,
    tintAlt: 0xffd3e4,
    build: buildMarshmallow,
  },
  {
    id: 'candy.chocolate',
    name: 'Chocolate Bar',
    glyph: '🍫',
    thickness: 0.3,
    tint: 0x4a2618,
    tintAlt: 0x8a5a3c,
    build: buildChocolate,
  },
  {
    id: 'candy.wafer',
    name: 'Wafer',
    glyph: '🧇',
    thickness: 0.34,
    tint: 0xe8c489,
    tintAlt: 0xfff2da,
    build: buildWafer,
  },
  {
    id: 'candy.icing',
    name: 'Sprinkle Icing',
    glyph: '🧁',
    thickness: 0.26,
    tint: 0xffc2e4,
    tintAlt: 0x7be0e0,
    build: buildIcing,
  },
  {
    id: 'candy.lollipop',
    name: 'Lollipop Disc',
    glyph: '🍭',
    thickness: 0.28,
    tint: 0xff5fa2,
    tintAlt: 0x7be0e0,
    weight: 0.9,
    build: buildLollipop,
  },
  {
    id: 'candy.nougat',
    name: 'Nougat',
    glyph: '🍯',
    thickness: 0.44,
    tint: 0xf3e3c2,
    tintAlt: 0x9ec45a,
    build: buildNougat,
  },
];

export const candyTheme: ThemeDef = {
  id: 'candy',
  name: 'Candy Stack',
  tagline: 'Macarons, gummies, pastel dream.',
  glyph: '🍬',
  price: 1.99,
  palette: {
    bgTop: 0xffe3f5,
    bgBottom: 0xb9aeff,
    fog: 0xe7d6ff,
    fogDensity: 0.013,
    key: 0xfff6fb,
    keyIntensity: 2.6,
    fill: 0x9ad8ff,
    fillIntensity: 0.6,
    rim: 0xffc2e4,
    rimIntensity: 1.4,
    ground: 0x8e7ce0,
    accent: 0xff5fa2,
    accentSoft: 0x7be0e0,
    bloomStrength: 0.62,
    exposure: 1.12,
    vignette: 0.32,
  },
  foods,
  plate: buildPlate,
  scenery: buildScenery,
  ambience: 'candy',
};
