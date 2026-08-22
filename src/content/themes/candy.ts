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
import type { EnvBuildCtx, FoodBuildCtx, FoodDef, ThemeDef } from '../api';
import { Rng } from '../../core/rng';
import { TAU, clamp } from '../../core/math';
import {
  mergeAll,
  mesh,
  pillow,
  pour,
  puck,
  roughen,
  roundedBox,
  ruffle,
  squareness,
  tintGeometry,
} from '../kit';
import {
  discXZ,
  envCount,
  envSeg,
  fillFlat,
  fillGradient,
  finalize,
  flagLine,
  lathe,
  longAxis,
  mergeEnv,
  noiseWash,
  propCount,
  propScale,
  rectPerimeter,
  ringSlots,
  safeD,
  safeH,
  safeRadius,
  safeW,
  scatterOnSurface,
  seg,
  sheet,
  softRound,
  softStroke,
  speckle,
  stripes,
  tableSlab,
  tintGradientY,
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
    // The painted albedo already carries this food's hue; three multiplies
    // color by map, so tinting here too would square it toward black.
    color: 0xffffff,
    map: ctx.materials.texture('candy.marshmallow.albedo', paintMarshmallow, { size: 128 }),
    roughness: 0.95,
    metalness: 0,
  });

const chocolateMat = (ctx: FoodBuildCtx): THREE.Material =>
  ctx.materials.standard('candy.chocolate', {
    // The painted albedo already carries this food's hue; three multiplies
    // color by map, so tinting here too would square it toward black.
    color: 0xffffff,
    map: ctx.materials.texture('candy.chocolate.albedo', paintChocolate, { size: 128 }),
    roughness: 0.28,
    metalness: 0,
  });

const biscuitMat = (ctx: FoodBuildCtx): THREE.Material =>
  ctx.materials.standard('candy.wafer.biscuit', {
    // The painted albedo already carries this food's hue; three multiplies
    // color by map, so tinting here too would square it toward black.
    color: 0xffffff,
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
    // The painted albedo already carries this food's hue; three multiplies
    // color by map, so tinting here too would square it toward black.
    color: 0xffffff,
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

  const bottom = puck(w * 0.95, shellH, d * 0.95, {
    domed: 0.18,
    wobble: 0.045,
    taper: 0.04,
    radial,
    rings: 5,
    seed: ctx.index + 1,
  });
  g.add(mesh(bottom, shellMat));

  // "the feet" — the ruffled frill that makes a macaron a macaron
  const feetLow = ruffle(w, footH, d, {
    folds: 22,
    amplitude: 0.18,
    seed: ctx.index * 2 + 1,
    segments: frillSegs,
  });
  const flm = mesh(feetLow, shellMat);
  flm.position.y = shellH - footH * 0.92;
  g.add(flm);

  const filling = puck(w * 0.8, fillH, d * 0.8, {
    domed: 0,
    wobble: 0.22,
    radial: seg(ctx, 32, 22, 14),
    rings: 3,
    seed: ctx.index + 8,
  });
  const fm = mesh(filling, macaronFillingMat(ctx));
  fm.position.y = shellH * 0.94;
  g.add(fm);

  const topBase = shellH * 0.94 + fillH * 0.86;
  const feetHigh = ruffle(w, footH, d, {
    folds: 22,
    amplitude: 0.18,
    seed: ctx.index * 2 + 5,
    segments: frillSegs,
  });
  const fhm = mesh(feetHigh, shellMat);
  fhm.position.y = topBase - footH * 0.08;
  g.add(fhm);

  const top = puck(w * 0.95, shellH, d * 0.95, {
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
    const lw = alongX ? step * 0.9 : S * 0.99;
    const ld = alongX ? S * 0.99 : step * 0.9;
    const log = pillow(lw, h * 0.99, ld, {
      round: softRound(0.88, lw, ld),
      segments: seg(ctx, 20, 15, 10),
      squash: 0.2,
    });
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

  const highH = h * 0.45;
  const high = puck(w, highH, d, {
    domed: 0.3,
    wobble: 0.05,
    taper: 0.05,
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
    seg(ctx, 3, 2, 1),
  );
  g.add(mesh(base, mat));

  // The moulding grid IS the identity — always at least one raised square.
  const maxCells = ctx.offcut ? 2 : ctx.quality === 'low' ? 3 : ctx.quality === 'medium' ? 4 : 5;
  const cols = clamp(Math.round(w / 0.55), 1, maxCells);
  const rows = clamp(Math.round(d / 0.55), 1, maxCells);
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
        seg(ctx, 3, 2, 1),
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
    const inset = isBiscuit ? 1 : 0.88;
    const leaf = sheet(w * inset, t, d * inset, {
      wave: t * 0.16,
      waveFreq: 3.4,
      seed: ctx.index * 3 + i,
      segments: segs,
    });
    if (isBiscuit) roughen(leaf, t * 0.16, 11, ctx.index + i);
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

  const body = pour(w * 0.99, h * 0.54, d * 0.99, {
    drips: ctx.offcut ? 3 : 6,
    dripLength: 0.4,
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
    propCount(ctx, 72, 3),
    w * 0.92,
    d * 0.92,
    surface,
    (_i, rng) => {
      const cap = new THREE.CapsuleGeometry(sr, sr * rng.range(2.6, 4.2), 2, seg(ctx, 5, 4, 4));
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
  const face = discXZ(w * 0.9, d * 0.9, radial, squareness(w, d));
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

  const body = pillow(w, h * 0.84, d, {
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
  const top = puck(w, STAND_TOP, d, { domed: 0, wobble: 0.008, radial: 52, rings: 2, seed: 2, square: 0 });
  top.translate(0, -STAND_TOP, 0);
  g.add(mesh(top, acrylic));

  // rolled rim, top of the roll flush with y = 0
  const tube = 0.035;
  const rim = new THREE.TorusGeometry(0.5 - tube, tube, 8, 44);
  rim.rotateX(-Math.PI / 2);
  rim.scale(w, 1, d);
  rim.translate(0, -tube, 0);
  g.add(mesh(rim, acrylic));

  const stem = puck(w * 0.26, STAND_STEM, d * 0.26, { domed: 0, wobble: 0.02, taper: -0.25, radial: 30, rings: 3, seed: 3, square: 0 });
  stem.translate(0, -STAND_TOP - STAND_STEM, 0);
  g.add(mesh(stem, acrylic));

  const foot = puck(w * 0.52, STAND_FOOT, d * 0.52, { domed: 0, wobble: 0.01, taper: 0.35, radial: 36, rings: 2, seed: 4, square: 0 });
  foot.translate(0, -PLATE_T, 0);
  g.add(mesh(foot, acrylic));

  return g;
}

// ---------------------------------------------------------------------------
// environment — a pastel confectionery counter
// ---------------------------------------------------------------------------
//
// A Ladurée window, not a fairground. The whole theme lives in one hue family,
// so the place is built out of FINISH rather than colour: mirror-bright
// lacquered marble under the plate, glass under the jar lids, matte paper on
// the bag, flat chalky pastel on everything past ten units.
//
// The layout is dictated by the camera, which sits ~10 units out from the
// tower axis at a fixed 0.5 rad pitch. Three consequences drive every number
// here:
//
//   * the horizon is off the top of the frame, so the counter has to reach
//     past ~5.4 units in every direction or the bottom of the screen falls off
//     its front edge into the sweep;
//   * distant things ride HIGH in the frame, and the counter's far edge hides
//     the foot of anything standing further out and lower down — which is how
//     the shelf wall stands on a floor that is never drawn;
//   * anything hanging below eye level must sit OUTSIDE the camera's own
//     radius, or the near side of it swings across the tower. That is why the
//     bunting is strung at 13 units and not at 4.

/** Half-extents of the counter. Both must clear the bottom of frame. */
const COUNTER_HALF_W = 6.4;
const COUNTER_HALF_D = 5.8;
/** The shelf wall — well outside the camera radius, so never in front. */
const SHELF_R = 12.9;
/** Bunting hangs outside the camera radius too, or it crosses the tower. */
const BUNTING_R = 11.9;
/** The arc directly behind the tower in the play camera's view. */
const BACK_ARC = Math.PI * 1.25;

const PASTEL_SWEETS = [0xff8fbe, 0x7be0e0, 0xffe08a, 0xc9b6ff, 0xfff4fa, 0x9fe8c8] as const;
const BUNTING_COLORS = [0xffb3d1, 0xfff2c2, 0xb6ebd8, 0xd8c6ff, 0xffffff] as const;
const JAR_CANDY = [0xff7fb2, 0x8fe3e3, 0xffdf8f, 0xcbbaff, 0xffe9f2] as const;

/** Soft pink-and-lilac marble: a milky base with lazy, low-contrast veins. */
function paintMarble(c: CanvasRenderingContext2D, size: number): void {
  fillGradient(c, size, [
    [0, '#DEACCB'],
    [0.5, '#D6A0C2'],
    [1, '#BF94CE'],
  ]);
  const rng = new Rng(0x3a17);
  for (let i = 0; i < 18; i++) {
    const pts: Array<[number, number]> = [];
    let yy = rng.next() * size;
    for (let x = -0.05; x <= 1.06; x += 0.09) {
      yy += rng.signed() * size * 0.06;
      pts.push([x * size, yy]);
    }
    softStroke(
      c,
      pts,
      size * rng.range(0.005, 0.016),
      rng.bool(0.55) ? '#A487C9' : '#FBE6F2',
      0.8,
      5,
    );
  }
  noiseWash(c, size, 6, 0.14, 21, '#B49CCE', '#FFFFFF');
}

/** Confectioner's stripes — the paper bag and the window valance. */
function paintCandyStripe(c: CanvasRenderingContext2D, size: number): void {
  stripes(
    c,
    size,
    [
      { span: 3, color: '#FFFCFE' },
      { span: 2, color: '#FF9EC8' },
      { span: 3, color: '#FFFCFE' },
      { span: 2, color: '#C9B6FF' },
    ],
    true,
  );
  noiseWash(c, size, 5, 0.09, 34, '#C9A3BC', '#FFFFFF');
}

// ---------------------------------------------------------------------------
// turned shapes — the sweet jar is the signature prop of the whole room
// ---------------------------------------------------------------------------

type Profile = Array<[number, number]>;

function jarBody(h: number, r: number, segments: number): THREE.BufferGeometry | null {
  const p: Profile = [
    [0, 0],
    [r * 0.74, 0],
    [r * 0.9, h * 0.04],
    [r, h * 0.16],
    [r * 0.99, h * 0.56],
    [r * 0.88, h * 0.75],
    [r * 0.66, h * 0.87],
    [r * 0.64, h * 0.93],
    [r * 0.72, h * 0.97],
    [r * 0.66, h],
    [0, h],
  ];
  return lathe(p, segments);
}

function jarLid(r: number, h: number, segments: number): THREE.BufferGeometry | null {
  const p: Profile = [
    [0, 0],
    [r * 0.78, 0],
    [r * 0.8, h * 0.14],
    [r * 0.6, h * 0.4],
    [r * 0.3, h * 0.54],
    [r * 0.11, h * 0.6],
    [r * 0.17, h * 0.72],
    [r * 0.2, h * 0.86],
    [r * 0.1, h],
    [0, h],
  ];
  return lathe(p, segments);
}

/** The heap of sweets inside a jar: a lumpy column with a domed shoulder. */
function jarFill(
  r: number,
  h: number,
  segments: number,
  seed: number,
  lumpy: boolean,
): THREE.BufferGeometry | null {
  const p: Profile = [
    [0, 0],
    [r, 0],
    [r, h * 0.86],
    [r * 0.86, h * 0.95],
    [r * 0.5, h],
    [0, h * 1.02],
  ];
  const geo = lathe(p, segments);
  if (geo && lumpy) roughen(geo, r * 0.1, 11, seed);
  return geo;
}

function buildEnvironment(ctx: EnvBuildCtx): THREE.Object3D {
  const g = new THREE.Group();
  g.name = 'candy.counter';

  const top = Number.isFinite(ctx.tableTopY) ? ctx.tableTopY : -0.45;
  const q = ctx.quality;
  const rng = ctx.rng;
  const rich = q !== 'low';
  const lo = q === 'low';

  // One bucket per material; each bucket is merged into exactly one draw call.
  const marble: Array<THREE.BufferGeometry | null> = [];
  const lacquer: Array<THREE.BufferGeometry | null> = [];
  const glass: Array<THREE.BufferGeometry | null> = [];
  const sweets: Array<THREE.BufferGeometry | null> = [];
  const paper: Array<THREE.BufferGeometry | null> = [];
  const far: Array<THREE.BufferGeometry | null> = [];
  const flags: Array<THREE.BufferGeometry | null> = [];

  // --- the counter -------------------------------------------------------
  // The slab's top face lands exactly on tableTopY: the plate is already there.
  marble.push(
    tableSlab(COUNTER_HALF_W * 2, COUNTER_HALF_D * 2, 0.46, {
      radius: 2.2,
      segments: envSeg(q, 4, 3, 2),
      top,
    }),
  );

  // A bullnose lip proud of the slab, then an inset apron. Two steps is what
  // separates a counter from a floor when only its far edge is on screen.
  const lipTop = top - 0.38;
  lacquer.push(
    tintGeometry(
      tableSlab(COUNTER_HALF_W * 2 + 0.5, COUNTER_HALF_D * 2 + 0.5, 0.2, {
        radius: 2.4,
        segments: envSeg(q, 3, 2, 2),
        top: lipTop,
      }),
      0xf3e6ff,
    ),
  );
  lacquer.push(
    tintGeometry(
      tableSlab(COUNTER_HALF_W * 2 - 1.1, COUNTER_HALF_D * 2 - 1.1, 0.9, {
        radius: 1.9,
        segments: envSeg(q, 3, 2, 2),
        top: lipTop - 0.19,
      }),
      0xb49be0,
    ),
  );

  // Scalloped valance under the lip — a hard square edge would be a desk.
  if (rich) {
    const count = q === 'high' ? 52 : 34;
    const scallops: Array<THREE.BufferGeometry | null> = [];
    for (let i = 0; i < count; i++) {
      const a = (i / count) * TAU;
      const p = rectPerimeter(COUNTER_HALF_W + 0.2, COUNTER_HALF_D + 0.2, a, 0.5);
      const s = new THREE.SphereGeometry(0.33, envSeg(q, 8, 6, 5), envSeg(q, 4, 3, 3));
      s.scale(1, 0.78, 1);
      s.translate(p.x, lipTop - 0.12, p.y);
      scallops.push(s);
    }
    const hem = mergeEnv(scallops);
    if (hem) lacquer.push(tintGeometry(hem, 0xf7ecff));
  }

  // --- props on the counter ----------------------------------------------
  // Placement is deliberate, not random. The frame is only ~22 degrees wide,
  // so at 4 units out only the arc within ~35 degrees of BACK_ARC is on
  // screen at all, and the tower itself hides the middle ~15 of that. The two
  // slots either side of the tower therefore get the best props; everything
  // else is spread around for the home screen's turntable.
  const jarSeg = envSeg(q, 16, 13, 10);
  const propRng = rng;

  /** A glass sweet jar with a knobbed lid and a heap of sweets inside. */
  const sweetJar = (arc: number, r: number, h: number, tint: number, seed: number): void => {
    const a = BACK_ARC + arc;
    const x = Math.sin(a) * r;
    const z = Math.cos(a) * r;
    const rr = h * propRng.range(0.33, 0.4);
    const body = jarBody(h, rr, jarSeg);
    if (body) {
      body.translate(x, top, z);
      glass.push(body);
    }
    const fill = jarFill(rr * 0.86, h * propRng.range(0.5, 0.78), jarSeg, seed, q === 'high');
    if (fill) {
      fill.translate(x, top + h * 0.05, z);
      sweets.push(tintGeometry(fill, tint));
    }
    const lid = jarLid(rr * 0.98, rr * 1.2, jarSeg);
    if (lid) {
      lid.translate(x, top + h * 0.965, z);
      lacquer.push(tintGeometry(lid, seed % 2 === 0 ? 0xffd3e8 : 0xdccfff));
    }
  };

  // squat jars, then the tall apothecary columns at the back of the counter
  // The last entries sit in the NEAR arc, between the camera and the tower:
  // they land low in the frame and stop the foreground reading as bare floor.
  const jarPlan: Array<[number, number, number]> = lo
    ? [
        [-1.35, 4.4, 1.05],
        [2.95, 3.8, 0.92],
      ]
    : q === 'medium'
      ? [
          [1.3, 4.1, 0.95],
          [-1.35, 4.4, 1.05],
          [2.95, 3.8, 0.92],
        ]
      : [
          [1.3, 4.1, 0.95],
          [-1.35, 4.4, 1.05],
          [2.72, 4.4, 0.88],
          [3.02, 3.7, 1.06],
          [-2.86, 3.9, 0.82],
        ];
  for (let i = 0; i < jarPlan.length; i++) {
    const [arc, r, h] = jarPlan[i];
    sweetJar(arc, r, h, JAR_CANDY[i % JAR_CANDY.length], i * 7 + 3);
  }

  const tallPlan: Array<[number, number]> = lo
    ? [[0.47, 4.7]]
    : q === 'medium'
      ? [
          [0.47, 4.7],
          [-2.1, 5.2],
        ]
      : [
          [0.47, 4.7],
          [-2.1, 5.2],
          [-1.75, 5.35],
        ];
  for (let i = 0; i < tallPlan.length; i++) {
    const [arc, r] = tallPlan[i];
    const a = BACK_ARC + arc;
    const x = Math.sin(a) * r;
    const z = Math.cos(a) * r;
    const h = rng.range(1.75, 2.2);
    const rr = rng.range(0.42, 0.52);
    const body = jarBody(h, rr, jarSeg);
    if (body) {
      body.translate(x, top, z);
      glass.push(body);
    }
    const fill = jarFill(rr * 0.87, h * rng.range(0.4, 0.62), jarSeg, i * 13 + 5, q === 'high');
    if (fill) {
      fill.translate(x, top + h * 0.04, z);
      sweets.push(tintGeometry(fill, JAR_CANDY[(i + 2) % JAR_CANDY.length]));
    }
    const lid = jarLid(rr * 0.99, rr * 1.05, jarSeg);
    if (lid) {
      lid.translate(x, top + h * 0.965, z);
      lacquer.push(tintGeometry(lid, 0xe7d8ff));
    }
  }

  // --- cake stand under a cloche -----------------------------------------
  // The best prop gets the best slot: just left of the tower in the play view.
  {
    const a = BACK_ARC - 0.5;
    const r = 4.2;
    const x = Math.sin(a) * r;
    const z = Math.cos(a) * r;
    const seg = envSeg(q, 18, 14, 10);
    const stand = lathe(
      [
        [0, 0],
        [0.46, 0],
        [0.48, 0.04],
        [0.32, 0.09],
        [0.1, 0.13],
        [0.1, 0.38],
        [0.34, 0.45],
        [0.68, 0.5],
        [0.7, 0.55],
        [0.64, 0.57],
        [0, 0.57],
      ],
      seg,
    );
    if (stand) {
      stand.translate(x, top, z);
      lacquer.push(tintGeometry(stand, 0xfff3fa));
    }
    const tiers = lo ? 2 : 4;
    for (let i = 0; i < tiers; i++) {
      const mr = 0.34 - i * 0.05;
      const m = puck(mr * 2, 0.12, mr * 2, {
        domed: 0.3,
        wobble: 0.05,
        radial: envSeg(q, 14, 11, 8),
        rings: 2,
        seed: i + 3,
        square: 0,
      });
      m.translate(x + rng.signed() * 0.04, top + 0.57 + i * 0.13, z + rng.signed() * 0.04);
      sweets.push(tintGeometry(m, PASTEL_SWEETS[i % PASTEL_SWEETS.length]));
    }
    if (rich) {
      const dome = lathe(
        [
          [0, 0],
          [0.62, 0],
          [0.64, 0.055],
          [0.62, 0.45],
          [0.49, 0.67],
          [0.27, 0.78],
          [0.08, 0.82],
          [0.1, 0.91],
          [0.055, 0.98],
          [0, 0.98],
        ],
        seg,
      );
      if (dome) {
        dome.translate(x, top + 0.54, z);
        glass.push(dome);
      }
    }
  }

  // --- candy-striped paper bag, tipped over and spilling ------------------
  if (rich) {
    const a = BACK_ARC + 2.05;
    const r = 3.9;
    const x = Math.sin(a) * r;
    const z = Math.cos(a) * r;
    const bag = roundedBox(0.44, 0.62, 0.32, 0.05, 2);
    bag.rotateZ(0.14);
    bag.rotateY(-a);
    bag.translate(x, top, z);
    paper.push(bag);
    const cuff = roundedBox(0.48, 0.12, 0.35, 0.04, 2);
    cuff.rotateZ(0.14);
    cuff.rotateY(-a);
    cuff.translate(x + 0.09, top + 0.57, z);
    paper.push(cuff);

    const spill = envCount(q, 9, 3);
    for (let i = 0; i < spill; i++) {
      const sa = a + rng.signed() * 0.42;
      const sr = Math.max(3.45, r - rng.range(0.3, 0.85));
      const bead = new THREE.SphereGeometry(rng.range(0.05, 0.08), 7, 5);
      bead.scale(1, 0.7, 1);
      bead.translate(Math.sin(sa) * sr, top + 0.032, Math.cos(sa) * sr);
      sweets.push(tintGeometry(bead, PASTEL_SWEETS[i % PASTEL_SWEETS.length]));
    }
  }

  // --- ribbon spool -------------------------------------------------------
  if (q === 'high') {
    const a = BACK_ARC + 2.45;
    const r = 3.55;
    const x = Math.sin(a) * r;
    const z = Math.cos(a) * r;
    const spool = lathe(
      [
        [0, 0],
        [0.21, 0],
        [0.21, 0.04],
        [0.12, 0.055],
        [0.12, 0.22],
        [0.21, 0.235],
        [0.21, 0.275],
        [0, 0.275],
      ],
      12,
    );
    if (spool) {
      spool.translate(x, top, z);
      lacquer.push(tintGeometry(spool, 0xfff0f7));
    }
    const wound = new THREE.CylinderGeometry(0.172, 0.172, 0.165, 14, 1);
    wound.translate(x, top + 0.138, z);
    paper.push(wound);
  }
  // A few sweets loose on the counter in the near arc — the counter is huge
  // and the bottom of the frame is otherwise bare marble.
  {
    const loose = envCount(q, 14, 6);
    for (let i = 0; i < loose; i++) {
      const sa = BACK_ARC + Math.PI + rng.signed() * 0.55;
      const sr = rng.range(3.45, 4.7);
      const bead = new THREE.SphereGeometry(rng.range(0.05, 0.085), 7, 5);
      bead.scale(1, 0.68, 1);
      bead.translate(Math.sin(sa) * sr, top + 0.03, Math.cos(sa) * sr);
      sweets.push(tintGeometry(bead, PASTEL_SWEETS[(i * 3) % PASTEL_SWEETS.length]));
    }
  }

  // --- the shelf wall -----------------------------------------------------
  // Its foot is far below the counter's far edge, which hides it: no floor has
  // to exist for the room to feel like it has one.
  const wallSeg = envSeg(q, 40, 30, 22);
  const wallLow = top - 6.5;
  const wallHigh = top + 2.45;
  const wall = new THREE.CylinderGeometry(SHELF_R, SHELF_R, wallHigh - wallLow, wallSeg, 1, true);
  wall.translate(0, (wallLow + wallHigh) * 0.5, 0);
  far.push(tintGradientY(wall, 0xb9a4dc, 0xfbe6f4, top - 3.4, wallHigh));

  const shelfInner = SHELF_R - 0.9;
  const shelfHeights = lo
    ? [top - 1.6, top + 0.5]
    : [top - 2.2, top - 0.65, top + 0.9];
  for (let s = 0; s < shelfHeights.length; s++) {
    const y = shelfHeights[s];
    const board = new THREE.RingGeometry(shelfInner, SHELF_R, wallSeg, 1);
    board.rotateX(-Math.PI / 2);
    board.translate(0, y + 0.06, 0);
    far.push(tintGeometry(board, 0xfff6fb));
    const edge = new THREE.CylinderGeometry(shelfInner, shelfInner, 0.12, wallSeg, 1, true);
    edge.translate(0, y, 0);
    far.push(tintGeometry(edge, 0xecd9ee));

    const perShelf = lo ? 22 : q === 'medium' ? 30 : 40;
    const slots = ringSlots(rng, perShelf, SHELF_R - 0.58, SHELF_R - 0.34, { jitter: 0.8 });
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      const jh = rng.range(0.5, 1.05);
      const jr = rng.range(0.19, 0.34);
      const jar = new THREE.CylinderGeometry(jr, jr * 0.92, jh, 6, 1, false);
      jar.translate(slot.x, y + 0.06 + jh * 0.5, slot.z);
      far.push(
        tintGeometry(jar, rng.bool(0.42) ? 0xffeaf4 : JAR_CANDY[(i + s) % JAR_CANDY.length]),
      );
      const knob = new THREE.SphereGeometry(jr * 0.62, 5, 3);
      knob.translate(slot.x, y + 0.06 + jh, slot.z);
      far.push(tintGeometry(knob, 0xfff3fa));
    }
  }

  // --- striped valance, scalloped at the hem ------------------------------
  const valance: THREE.BufferGeometry[] = [];
  if (rich) {
    const vh = 0.66;
    const vSeg = envSeg(q, 96, 64, 40);
    const band = new THREE.CylinderGeometry(SHELF_R - 0.08, SHELF_R - 0.08, vh, vSeg, 1, true);
    const pos = band.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y > 0) continue;
      const a = Math.atan2(pos.getZ(i), pos.getX(i));
      pos.setY(i, y + 0.22 * (1 - Math.abs(Math.sin(a * 30))));
    }
    pos.needsUpdate = true;
    band.computeVertexNormals();
    band.translate(0, wallHigh - vh * 0.5, 0);
    valance.push(band);
  }

  // --- bunting ------------------------------------------------------------
  const lines = lo ? 2 : q === 'medium' ? 3 : 4;
  for (let i = 0; i < lines; i++) {
    const a0 = BACK_ARC + (i / lines) * TAU + rng.signed() * 0.18;
    const span = rng.range(1.45, 1.95);
    const rA = BUNTING_R + rng.range(-0.4, 0.4);
    const rB = BUNTING_R + rng.range(-0.4, 0.4);
    const line = flagLine(
      new THREE.Vector3(Math.sin(a0) * rA, top + rng.range(3.5, 3.9), Math.cos(a0) * rA),
      new THREE.Vector3(
        Math.sin(a0 + span) * rB,
        top + rng.range(3.5, 3.9),
        Math.cos(a0 + span) * rB,
      ),
      rng,
      {
        colors: BUNTING_COLORS,
        cordColor: 0xe4cfec,
        sag: rng.range(1.0, 1.5),
        cordRadius: 0.03,
        flags: lo ? 7 : 12,
        flagWidth: 0.52,
        flagDrop: 0.66,
        twist: 0.3,
        segments: lo ? 10 : 18,
      },
    );
    if (line) flags.push(line);
  }

  // --- assemble: one mesh per material ------------------------------------
  const marbleMat = ctx.materials.physical('candy.env.marble', {
    color: 0xffffff,
    map: ctx.materials.texture('candy.env.marble.albedo', paintMarble, {
      size: 256,
      repeat: [0.22, 0.22],
    }),
    roughness: 0.1,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.045,
    sheen: 0.2,
    sheenColor: 0xffe3f5,
  });
  const lacquerMat = ctx.materials.physical('candy.env.lacquer', {
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.14,
    metalness: 0,
    clearcoat: 0.9,
    clearcoatRoughness: 0.08,
  });
  // The low tier zeroes transmission and falls back to opacity, so the base
  // colour has to carry the glass on its own.
  const glassMat = ctx.materials.physical('candy.env.glass', {
    color: 0xe6f1fb,
    roughness: 0.05,
    metalness: 0,
    transmission: 0.92,
    thickness: 0.3,
    ior: 1.46,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
  });
  const sweetsMat = ctx.materials.physical('candy.env.sweets', {
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.26,
    metalness: 0,
    clearcoat: 0.55,
    clearcoatRoughness: 0.15,
  });
  const paperMat = ctx.materials.standard('candy.env.paper', {
    color: 0xffffff,
    map: ctx.materials.texture('candy.env.stripe', paintCandyStripe, {
      size: 128,
      repeat: [3, 3],
    }),
    roughness: 0.88,
    metalness: 0,
  });
  const farMat = ctx.materials.standard('candy.env.far', {
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.82,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const valanceMat = ctx.materials.standard('candy.env.valance', {
    color: 0xffffff,
    map: ctx.materials.texture('candy.env.valance.albedo', paintCandyStripe, {
      size: 128,
      repeat: [24, 1],
    }),
    roughness: 0.85,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const flagMat = ctx.materials.standard('candy.env.bunting', {
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.8,
    metalness: 0,
    side: THREE.DoubleSide,
  });

  const add = (
    parts: Array<THREE.BufferGeometry | null>,
    mat: THREE.Material,
    cast: boolean,
    receive: boolean,
  ): void => {
    const geo = mergeEnv(parts);
    if (geo) g.add(mesh(geo, mat, { cast, receive }));
  };

  add(marble, marbleMat, false, true);
  add(lacquer, lacquerMat, true, true);
  add(glass, glassMat, false, false);
  add(sweets, sweetsMat, true, false);
  add(paper, paperMat, true, false);
  add(far, farMat, false, false);
  add(valance, valanceMat, false, false);
  add(flags, flagMat, false, false);

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
    keyIntensity: 2.15,
    fill: 0x9ad8ff,
    fillIntensity: 0.6,
    rim: 0xffc2e4,
    rimIntensity: 1.4,
    ground: 0x8e7ce0,
    accent: 0xff5fa2,
    accentSoft: 0x7be0e0,
    // Candy Stack is the only high-key palette in the game: near-white pastels
    // lit by a 2.6 key. Grading it like a mid-key scene blew the counter out to
    // white, so it takes the lowest exposure and bloom of the six, not the
    // highest.
    bloomStrength: 0.38,
    exposure: 0.98,
    vignette: 0.32,
  },
  foods,
  hero: [7, 4, 3, 2, 1, 0],
  plate: buildPlate,
  environment: buildEnvironment,
  ambience: 'candy',
};
