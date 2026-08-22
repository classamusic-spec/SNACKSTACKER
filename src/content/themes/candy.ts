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
  facingQuad,
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
  radialGlow,
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

/**
 * Flute a turned shape: push every vertex in or out along its own radius by a
 * cosine of its bearing.
 *
 * This is the single cheapest thing that makes glass look like glass. A smooth
 * cylinder under a studio rig catches one broad highlight and reads as
 * plastic; a fluted one catches a row of narrow ones that slide as the camera
 * turns, and the turntable on the home screen is doing exactly that all day.
 * It also survives the low tier, where transmission is switched off and the
 * specular is all the jar has left to say glass with.
 */
function flute(geo: THREE.BufferGeometry, ribs: number, depth: number): THREE.BufferGeometry {
  const pos = geo.attributes.position as THREE.BufferAttribute | undefined;
  if (!pos || ribs < 2 || depth === 0) return geo;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const r = Math.hypot(x, z);
    if (r < 1e-4) continue;
    const k = 1 + depth * Math.cos(Math.atan2(x, z) * ribs);
    pos.setXYZ(i, x * k, pos.getY(i), z * k);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

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

/**
 * The jar as an actual vessel: an outer wall, an inner wall a glass-thickness
 * inside it, and a solid slug of glass in the base.
 *
 * A single lathed surface has no thickness, and with `transmission` on it
 * refracts like a soap bubble; with transmission OFF at the low tier it reads
 * as a painted plastic cup. The inner wall costs one more surface and buys the
 * dark meniscus at the rim and the double edge down the silhouette that the
 * eye actually uses to decide something is glass. The base slug is where the
 * light pools, so it is the brightest part of the whole prop.
 */
function jarShell(
  h: number,
  r: number,
  segments: number,
  wall: boolean,
  ribs: number,
): THREE.BufferGeometry | null {
  const parts: Array<THREE.BufferGeometry | null> = [];
  const outer = jarBody(h, r, segments);
  if (outer) parts.push(ribs > 0 ? flute(outer, ribs, 0.035) : outer);
  if (wall) {
    const t = Math.min(0.055, r * 0.17);
    const inner = lathe(
      [
        [0, h * 0.1],
        [r * 0.74 - t, h * 0.1],
        [r - t, h * 0.16],
        [r * 0.99 - t, h * 0.56],
        [r * 0.88 - t, h * 0.75],
        [r * 0.66 - t, h * 0.87],
        [r * 0.64 - t, h * 0.94],
      ],
      segments,
    );
    if (inner) parts.push(inner);
  }
  // the slug of glass the jar stands on
  const foot = lathe(
    [
      [0, 0],
      [r * 0.9, h * 0.035],
      [r * 0.86, h * 0.1],
      [r * 0.5, h * 0.12],
      [0, h * 0.1],
    ],
    segments,
  );
  if (foot) parts.push(foot);
  return mergeEnv(parts);
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
  /** Anything that is light rather than a thing: the cove, the shop window,
   *  and the pools the jars focus onto the marble. */
  const glow: Array<THREE.BufferGeometry | null> = [];
  // Low tier gets six draws. The bunting is the same matte, double-sided,
  // vertex-coloured material the room is built from, so it is a free merge.
  const flagsOut = lo ? far : flags;

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
        segments: 2,
        top: lipTop,
      }),
      0xf3e6ff,
    ),
  );
  lacquer.push(
    tintGeometry(
      tableSlab(COUNTER_HALF_W * 2 - 1.1, COUNTER_HALF_D * 2 - 1.1, 0.9, {
        radius: 1.9,
        segments: 2,
        top: lipTop - 0.19,
      }),
      0xb49be0,
    ),
  );

  // Scalloped valance under the lip — a hard square edge would be a desk.
  if (rich) {
    const count = q === 'high' ? 28 : 22;
    const scallops: Array<THREE.BufferGeometry | null> = [];
    for (let i = 0; i < count; i++) {
      const a = (i / count) * TAU;
      const p = rectPerimeter(COUNTER_HALF_W + 0.2, COUNTER_HALF_D + 0.2, a, 0.5);
      const s = new THREE.SphereGeometry(0.33, envSeg(q, 7, 6, 5), envSeg(q, 3, 3, 3));
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
  const jarSeg = envSeg(q, 14, 12, 10);
  const propRng = rng;

  /**
   * The bright ring a glass jar throws onto the counter. Not a real caustic —
   * a soft alpha disc on the marble — but it is the cue that tells the eye the
   * thing above it is transparent, and it survives the low tier where
   * transmission is switched off and nothing else does.
   */
  const caustic = (x: number, z: number, radius: number): void => {
    const disc = new THREE.PlaneGeometry(radius, radius);
    disc.rotateX(-Math.PI / 2);
    disc.translate(x, top + 0.006, z);
    glow.push(disc);
  };

  /** A glass sweet jar with a knobbed lid and a heap of sweets inside. */
  const sweetJar = (arc: number, r: number, h: number, tint: number, seed: number): void => {
    const a = BACK_ARC + arc;
    const x = Math.sin(a) * r;
    const z = Math.cos(a) * r;
    const rr = h * propRng.range(0.33, 0.4);
    const body = jarShell(h, rr, jarSeg, !lo, lo ? 0 : 14);
    if (body) {
      body.translate(x, top, z);
      glass.push(body);
    }
    // the pool of light the glass focuses onto the marble under it
    caustic(x, z, rr * 3.4);
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
  // The play frame is 22 degrees wide and the tower covers the middle 61% of
  // it, which leaves exactly two slots: 0.42 to 0.72 radians either side of
  // BACK_ARC at four units, narrowing to 0.34-0.58 by five and a half. Every
  // prop worth looking at goes in those two slots. What was here before put
  // its best jars at 1.3 and -1.35 rad, which project a full frame-width off
  // the edge of the screen: gorgeous on the turntable, invisible for the
  // entire run. The rest of the ring is still dressed, but it is dressed for
  // the home screen, and it is now the leftovers rather than the hero.
  const jarPlan: Array<[number, number, number]> = lo
    ? [
        [0.62, 4.3, 1.0],
        [-0.66, 4.15, 0.86],
      ]
    : q === 'medium'
      ? [
          [0.62, 4.3, 1.0],
          [-0.66, 4.15, 0.86],
          [2.95, 3.8, 0.92],
        ]
      : [
          [0.62, 4.3, 1.0],
          [-0.66, 4.15, 0.86],
          [0.4, 5.5, 1.12],
          [2.72, 4.4, 0.88],
          [3.02, 3.7, 1.06],
          [-2.86, 3.9, 0.82],
        ];
  for (let i = 0; i < jarPlan.length; i++) {
    const [arc, r, h] = jarPlan[i];
    sweetJar(arc, r, h, JAR_CANDY[i % JAR_CANDY.length], i * 7 + 3);
  }

  // The apothecary columns are the tallest thing on the counter, so they get
  // the outer edge of each slot where they frame the tower instead of
  // crowding it.
  const tallPlan: Array<[number, number]> = lo
    ? [[0.46, 5.3]]
    : q === 'medium'
      ? [
          [0.46, 5.3],
          [-0.52, 5.45],
        ]
      : [
          [0.46, 5.3],
          [-0.52, 5.45],
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
    const body = jarShell(h, rr, jarSeg, !lo, lo ? 0 : 18);
    if (body) {
      body.translate(x, top, z);
      glass.push(body);
    }
    caustic(x, z, rr * 3.2);
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
        flute(dome, 20, 0.012);
        dome.translate(x, top + 0.54, z);
        glass.push(dome);
      }
      caustic(x, z, 2.1);
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
  // A flat box of macarons in the near arc. It lands low and wide in the
  // frame, below the tower, which is the one place a prop can be big without
  // fighting it.
  if (rich) {
    const a = BACK_ARC + Math.PI - 0.22;
    const r = 4.15;
    const x = Math.sin(a) * r;
    const z = Math.cos(a) * r;
    const box = roundedBox(1.5, 0.24, 1.0, 0.07, 2);
    box.rotateY(-a + 0.3);
    box.translate(x, top + 0.12, z);
    lacquer.push(tintGeometry(box, 0xfdf0f7));
    const lid = roundedBox(1.56, 0.1, 1.06, 0.05, 2);
    lid.rotateY(-a + 0.3);
    lid.rotateZ(0.5);
    lid.translate(x - 0.95, top + 0.42, z + 0.55);
    lacquer.push(tintGeometry(lid, 0xf7e2ef));
    for (let i = 0; i < envCount(q, 8, 4); i++) {
      const row = i % 4;
      const col = Math.floor(i / 4);
      const m = puck(0.3, 0.16, 0.3, {
        domed: 0.34,
        wobble: 0.04,
        radial: envSeg(q, 12, 10, 8),
        rings: 2,
        seed: i + 11,
        square: 0,
      });
      m.rotateY(-a + 0.3);
      m.translate(
        x + Math.sin(a + 0.3) * (row - 1.5) * 0.34 + Math.sin(a + 1.87) * (col - 0.5) * 0.4,
        top + 0.24,
        z + Math.cos(a + 0.3) * (row - 1.5) * 0.34 + Math.cos(a + 1.87) * (col - 0.5) * 0.4,
      );
      sweets.push(tintGeometry(m, PASTEL_SWEETS[(i * 2) % PASTEL_SWEETS.length]));
    }
  }
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

  // --- the room -----------------------------------------------------------
  //
  // What was here before was a cylinder with three flat rings on it, and it
  // read exactly like that: a painted backdrop with a bead necklace. A room
  // needs three things this now has.
  //
  //   * **A recess.** The shelving is a carcass, not a decal — a front plane
  //     at 12.4, niche backs a unit behind it at 13.4, boards that span the
  //     gap with a nosing on the front edge, and dividers between the bays.
  //     The niche backs are painted a stop darker than the fascia, which is
  //     the whole of why the bays read as holes.
  //   * **Something further off.** The far wall is another unit out again at
  //     14.4 and runs the full height, so what shows above the cornice and
  //     through the window is a DIFFERENT surface at a DIFFERENT distance.
  //   * **A ceiling to be under.** The room goes up nearly ten units. At the
  //     first drop that is off the top of the frame, and by layer fifteen —
  //     when the camera has climbed six units and the old wall had dropped
  //     out of shot entirely, leaving a third of the screen as bare sweep —
  //     it is still there. The top of it is a lit cove graded into `bgTop`,
  //     so where the room finally ends reads as light, not as a seam.
  const roomSeg = envSeg(q, 34, 28, 22);
  const BACK_R = 14.4;
  const CASE_BACK = 13.4;
  const CASE_FRONT = 12.4;
  const CASE_LOW = top - 3.1;
  const CORNICE_Y = top + 3.35;
  const ROOM_TOP = top + 9.4;
  const ROOM_LOW = top - 6.5;

  /** A flat annulus lying in XZ, cut to an arc in the scene's own bearing. */
  const arcRing = (
    inner: number,
    outer: number,
    aStart: number,
    aLen: number,
    y: number,
    seg: number,
  ): THREE.BufferGeometry => {
    const r = new THREE.RingGeometry(inner, outer, Math.max(2, Math.round(seg)), 1, aStart - Math.PI / 2, aLen);
    r.rotateX(-Math.PI / 2);
    r.translate(0, y, 0);
    return r;
  };

  // The two shop windows. One is aimed into the play frame — at 13 units the
  // visible arc during a run is only BACK_ARC +/- 0.35 rad, and the tower
  // covers none of it because the window sits above the tower's shoulder —
  // and one is round the back for the turntable.
  const winHalf = 0.115;
  const winArcs = lo ? [BACK_ARC + 0.21] : [BACK_ARC + 0.21, BACK_ARC - 2.55];

  // Case bays are everything the windows leave. Walk the gaps in order.
  const sorted = [...winArcs].sort((a, b) => a - b);
  const caseSpans: Array<[number, number]> = [];
  for (let i = 0; i < sorted.length; i++) {
    const from = sorted[i] + winHalf;
    const to = (i + 1 < sorted.length ? sorted[i + 1] : sorted[0] + TAU) - winHalf;
    if (to > from + 0.02) caseSpans.push([from, to - from]);
  }

  // far wall: the surface a window has something to show
  {
    const back = new THREE.CylinderGeometry(
      BACK_R,
      BACK_R,
      ROOM_TOP - ROOM_LOW,
      roomSeg,
      envSeg(q, 3, 2, 2),
      true,
    );
    back.translate(0, (ROOM_TOP + ROOM_LOW) * 0.5, 0);
    far.push(tintGradientY(back, 0xbaa8d8, 0xfdeef8, top - 3.0, CORNICE_Y + 2.4));
  }

  // upper wall, cornice and cove
  {
    const upper = new THREE.CylinderGeometry(
      CASE_FRONT + 0.55,
      CASE_FRONT + 0.55,
      ROOM_TOP - CORNICE_Y,
      roomSeg,
      envSeg(q, 4, 3, 2),
      true,
    );
    upper.translate(0, (ROOM_TOP + CORNICE_Y) * 0.5, 0);
    // Brightest at the very top: a cove light washing the ceiling, graded to
    // meet `bgTop` so the room does not end on a hard line.
    far.push(tintGradientY(upper, 0xd9c4ef, 0xffe6f6, CORNICE_Y, ROOM_TOP));

    // a stepped plaster cornice, which is most of the "expensive" in the room
    const steps: Array<[number, number, number]> = [
      [CASE_FRONT - 0.06, 0.16, 0xfff4fb],
      [CASE_FRONT + 0.16, 0.13, 0xf6e6fa],
      [CASE_FRONT + 0.34, 0.2, 0xfffafd],
      [CASE_FRONT + 0.5, 0.14, 0xe9d6f2],
    ];
    let cy = CORNICE_Y;
    for (const [cr, ch, tint] of steps) {
      const band = new THREE.CylinderGeometry(cr, cr, ch, roomSeg, 1, true);
      band.translate(0, cy + ch * 0.5, 0);
      far.push(tintGeometry(band, tint));
      far.push(tintGeometry(arcRing(cr, CASE_FRONT + 0.62, 0, TAU, cy + ch, roomSeg), 0xf1dff6));
      cy += ch;
    }
    // Panelling on the upper wall. Six units of unbroken plaster is where a
    // tall room stops looking expensive and starts looking like a warehouse;
    // a picture rail and a run of pilaster strips cost 500 triangles and put
    // a vertical rhythm behind the tower that the shelving below already has.
    const railY = CORNICE_Y + 0.9;
    const rail = new THREE.CylinderGeometry(CASE_FRONT + 0.66, CASE_FRONT + 0.66, 0.16, roomSeg, 1, true);
    rail.translate(0, railY, 0);
    far.push(tintGeometry(rail, 0xfff6fc));
    const pilasters = lo ? 10 : q === 'medium' ? 13 : 16;
    for (let i = 0; i < pilasters; i++) {
      const pa = BACK_ARC + 0.16 + (i / pilasters) * TAU;
      const ph = ROOM_TOP - 0.5 - railY;
      const strip = new THREE.BoxGeometry(0.26, ph, 0.16);
      strip.rotateY(pa);
      strip.translate(
        Math.sin(pa) * (CASE_FRONT + 0.5),
        railY + ph * 0.5,
        Math.cos(pa) * (CASE_FRONT + 0.5),
      );
      far.push(tintGeometry(strip, 0xfdf1f9));
    }

    // the cove itself: a bright lip at the top of the wall
    const cove = new THREE.CylinderGeometry(CASE_FRONT + 0.4, CASE_FRONT + 0.55, 0.3, roomSeg, 1, true);
    cove.translate(0, ROOM_TOP - 0.15, 0);
    far.push(tintGeometry(cove, 0xfff2fa));
    glow.push(
      tintGeometry(
        new THREE.CylinderGeometry(CASE_FRONT + 0.38, CASE_FRONT + 0.38, 0.5, roomSeg, 1, true),
        0xffffff,
      ).translate(0, ROOM_TOP - 0.5, 0),
    );
  }

  // the shelf carcass
  const shelfHeights = lo
    ? [top - 1.65, top - 0.75, top + 0.15, top + 1.05, top + 1.95, top + 2.85]
    : [top - 2.1, top - 1.2, top - 0.3, top + 0.6, top + 1.5, top + 2.4];
  for (const [aStart, aLen] of caseSpans) {
    const segs = Math.max(3, Math.round((aLen / TAU) * roomSeg));
    // the back of the niche, a stop darker than anything in front of it
    const nb = new THREE.CylinderGeometry(
      CASE_BACK,
      CASE_BACK,
      CORNICE_Y - CASE_LOW,
      segs,
      envSeg(q, 3, 2, 2),
      true,
      aStart,
      aLen,
    );
    nb.translate(0, (CORNICE_Y + CASE_LOW) * 0.5, 0);
    far.push(tintGradientY(nb, 0xb7a2d4, 0xecdcf4, CASE_LOW, CORNICE_Y));

    for (const y of shelfHeights) {
      far.push(tintGeometry(arcRing(CASE_FRONT, CASE_BACK, aStart, aLen, y + 0.06, segs), 0xfff8fc));
      // underside, in shadow — the pair of them is what gives a board thickness
      far.push(tintGeometry(arcRing(CASE_FRONT, CASE_BACK, aStart, aLen, y - 0.03, segs), 0xc3aeda));
      const nose = new THREE.CylinderGeometry(CASE_FRONT, CASE_FRONT, 0.085, segs, 1, true, aStart, aLen);
      nose.translate(0, y + 0.01, 0);
      far.push(tintGeometry(nose, 0xf3e2f7));
    }

    // dividers between the bays
    const bays = Math.max(1, Math.round((aLen / TAU) * (lo ? 34 : q === 'medium' ? 52 : 74)));
    for (let b = 0; b <= bays; b++) {
      const a = aStart + (b / bays) * aLen;
      const div = new THREE.BoxGeometry(0.075, CORNICE_Y - CASE_LOW, CASE_BACK - CASE_FRONT);
      div.rotateY(a);
      div.translate(
        Math.sin(a) * (CASE_FRONT + CASE_BACK) * 0.5,
        (CORNICE_Y + CASE_LOW) * 0.5,
        Math.cos(a) * (CASE_FRONT + CASE_BACK) * 0.5,
      );
      far.push(tintGeometry(div, 0xf7ecfb));
    }

    // and the stock: rows of jars standing IN the bays, not on a flat ring
    const perShelf = Math.max(
      2,
      Math.round((aLen / TAU) * (lo ? 28 : q === 'medium' ? 36 : 42)),
    );
    for (let s = 0; s < shelfHeights.length; s++) {
      const y = shelfHeights[s];
      const slots = ringSlots(rng, perShelf, CASE_FRONT + 0.28, CASE_BACK - 0.34, {
        jitter: 0.7,
        startAngle: aStart,
      });
      for (let i = 0; i < slots.length; i++) {
        const slot = slots[i];
        const a = aStart + ((i + 0.5) / slots.length) * aLen + rng.signed() * 0.012;
        const rr = slot.radius;
        const x = Math.sin(a) * rr;
        const z = Math.cos(a) * rr;
        const jh = rng.range(0.3, 0.58);
        const jr = rng.range(0.085, 0.15);
        const jar = new THREE.CylinderGeometry(jr, jr * 0.92, jh, 5, 1, false);
        jar.translate(x, y + 0.06 + jh * 0.5, z);
        far.push(
          tintGeometry(jar, rng.bool(0.42) ? 0xffeaf4 : JAR_CANDY[(i + s) % JAR_CANDY.length]),
        );
      }
    }
  }

  // --- the windows, and the shop on the other side of them ----------------
  for (let w = 0; w < winArcs.length; w++) {
    const a = winArcs[w];
    const sillY = top + 0.1;
    const halfW = Math.sin(winHalf) * CASE_FRONT;
    const springY = top + 1.7;
    const headY = springY + halfW;

    // the glazing: a flat panel of daylight set at the far wall
    const pane = facingQuad(
      Math.sin(a) * (BACK_R - 0.25),
      (sillY + headY) * 0.5,
      Math.cos(a) * (BACK_R - 0.25),
      halfW * 2.1,
      headY - sillY,
    );
    glow.push(tintGeometry(pane, 0xffffff));

    // glazing bars: six lights over two. Without them the opening reads as a
    // hole cut in the wall rather than as a window with a shop behind it.
    for (let bar = 1; bar < 3; bar++) {
      const bx = (bar / 3 - 0.5) * halfW * 2;
      const mull = new THREE.BoxGeometry(0.055, headY - sillY, 0.05);
      mull.rotateY(a);
      mull.translate(
        Math.sin(a) * (BACK_R - 0.4) + Math.sin(a + Math.PI / 2) * bx,
        (sillY + headY) * 0.5,
        Math.cos(a) * (BACK_R - 0.4) + Math.cos(a + Math.PI / 2) * bx,
      );
      far.push(tintGeometry(mull, 0xf6ebfa));
    }
    for (let bar = 1; bar < 3; bar++) {
      const by = sillY + ((headY - sillY) * bar) / 3;
      const rail = new THREE.BoxGeometry(halfW * 2, 0.055, 0.05);
      rail.rotateY(a);
      rail.translate(Math.sin(a) * (BACK_R - 0.4), by, Math.cos(a) * (BACK_R - 0.4));
      far.push(tintGeometry(rail, 0xf6ebfa));
    }

    // reveal: jambs, sill and an arched head, all standing proud of the wall
    const jambH = springY - sillY;
    for (const side of [-1, 1]) {
      const ja = a + side * winHalf;
      const jamb = new THREE.BoxGeometry(0.2, jambH, BACK_R - CASE_FRONT);
      jamb.rotateY(ja);
      jamb.translate(
        Math.sin(ja) * (CASE_FRONT + BACK_R) * 0.5,
        (springY + sillY) * 0.5,
        Math.cos(ja) * (CASE_FRONT + BACK_R) * 0.5,
      );
      far.push(tintGeometry(jamb, 0xfff6fc));
    }
    const sill = new THREE.BoxGeometry(halfW * 2.6, 0.24, BACK_R - CASE_FRONT + 0.4);
    sill.rotateY(a);
    sill.translate(
      Math.sin(a) * (CASE_FRONT + BACK_R) * 0.5,
      sillY - 0.1,
      Math.cos(a) * (CASE_FRONT + BACK_R) * 0.5,
    );
    far.push(tintGeometry(sill, 0xf4e4f8));
    // arched head: a half ring standing in the plane of the window
    const arch = new THREE.RingGeometry(halfW, halfW + 0.17, envSeg(q, 14, 11, 8), 1, 0, Math.PI);
    arch.rotateY(a + Math.PI);
    arch.translate(
      Math.sin(a) * (CASE_FRONT + 0.1),
      springY,
      Math.cos(a) * (CASE_FRONT + 0.1),
    );
    far.push(tintGeometry(arch, 0xfff6fc));
    const archBack = new THREE.RingGeometry(halfW, halfW + 0.17, envSeg(q, 14, 11, 8), 1, 0, Math.PI);
    archBack.rotateY(a + Math.PI);
    archBack.translate(Math.sin(a) * (BACK_R - 0.3), springY, Math.cos(a) * (BACK_R - 0.3));
    far.push(tintGeometry(archBack, 0xd8c3e8));

    // the shop beyond: silhouettes standing INSIDE the reveal, so they read
    // as dark shapes against the daylight rather than as furniture nobody can
    // see. A bentwood chair and a cafe table is the whole vocabulary needed.
    if (!lo) {
      const shopR = BACK_R - 0.75;
      const shop: Array<THREE.BufferGeometry | null> = [];
      const tableTop = new THREE.CylinderGeometry(0.42, 0.42, 0.07, envSeg(q, 12, 9, 7), 1);
      tableTop.translate(0, sillY + 1.05, 0);
      shop.push(tableTop);
      const stem = new THREE.CylinderGeometry(0.06, 0.1, 1.05, 6, 1);
      stem.translate(0, sillY + 0.52, 0);
      shop.push(stem);
      const chairBack = new THREE.TorusGeometry(0.3, 0.045, 4, envSeg(q, 12, 9, 7), Math.PI);
      chairBack.translate(0.72, sillY + 1.32, 0);
      shop.push(chairBack);
      const chairSeat = new THREE.CylinderGeometry(0.3, 0.28, 0.06, envSeg(q, 10, 8, 6), 1);
      chairSeat.translate(0.72, sillY + 0.98, 0);
      shop.push(chairSeat);
      for (let l = 0; l < 3; l++) {
        const leg = new THREE.CylinderGeometry(0.035, 0.035, 0.95, 4, 1);
        leg.translate(0.72 + (l - 1) * 0.2, sillY + 0.48, l === 1 ? 0.18 : -0.14);
        shop.push(leg);
      }
      const merged = mergeEnv(shop);
      if (merged) {
        merged.rotateY(a);
        merged.translate(Math.sin(a) * shopR, 0, Math.cos(a) * shopR);
        // barely darker than the light behind them: a patisserie window is not
        // a silhouette study, it is a bright blur with shapes suggested in it
        far.push(tintGeometry(merged, 0xbfa9d6));
      }
    }
  }

  // --- striped valance, scalloped at the hem ------------------------------
  const valance: THREE.BufferGeometry[] = [];
  if (rich) {
    const vh = 0.66;
    const vSeg = envSeg(q, 96, 64, 40);
    const band = new THREE.CylinderGeometry(CASE_FRONT - 0.06, CASE_FRONT - 0.06, vh, vSeg, 1, true);
    const pos = band.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y > 0) continue;
      const a = Math.atan2(pos.getZ(i), pos.getX(i));
      pos.setY(i, y + 0.22 * (1 - Math.abs(Math.sin(a * 30))));
    }
    pos.needsUpdate = true;
    band.computeVertexNormals();
    band.translate(0, CORNICE_Y - vh * 0.5, 0);
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
    if (line) flagsOut.push(line);
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
  // The low tier zeroes transmission and falls back to alpha, so everything
  // that says "glass" there has to be in the base tint, the opacity and the
  // specular. A near-white was tried and reads as porcelain: what a pale
  // interior needs is glass slightly DARKER and cooler than the room behind
  // it, held up by a hard clearcoat highlight and the flute ribs.
  const glassMat = ctx.materials.physical('candy.env.glass', {
    color: 0xc9dcea,
    roughness: 0.045,
    metalness: 0,
    transmission: 0.94,
    thickness: 0.34,
    ior: 1.48,
    attenuationColor: 0xdff0ff,
    attenuationDistance: 1.6,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
    specularIntensity: 1,
    opacity: 0.62,
    side: THREE.DoubleSide,
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
  // Light, not a thing: the cove above the cornice, the daylight in the shop
  // window, and the pools under the jars all wear the same soft alpha disc.
  const glowMat = ctx.materials.standard('candy.env.glow', {
    color: 0x000000,
    emissive: 0xfff0f8,
    emissiveIntensity: 1.35,
    map: ctx.materials.texture(
      'candy.env.glow.sprite',
      (c, sz) => radialGlow(c, sz, '#FFF4FA', 0.2, 2.1),
      { size: 128, wrap: THREE.ClampToEdgeWrapping },
    ),
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
    roughness: 1,
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
  const glowGeo = mergeEnv(glow);
  if (glowGeo) {
    const m = mesh(glowGeo, glowMat, { cast: false, receive: false });
    m.renderOrder = 3;
    g.add(m);
  }

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
