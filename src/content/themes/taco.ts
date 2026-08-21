/**
 * Taco Night — warm, saturated, messy in a good way.
 *
 * The fillings are the interesting problem here: beef, pico and beans are all
 * "small bits on a bed", so each one gets a different bit — angular crumbs,
 * hard-edged dice, smooth ovals — and a different surface finish so they never
 * read as the same layer in a different colour.
 */
import * as THREE from 'three';
import type { FoodBuildCtx, FoodDef, ThemeDef } from '../api';
import { Rng } from '../../core/rng';
import { TAU, clamp } from '../../core/math';
import { foldedShell, mergeAll, mesh, pour, puck, roughen, tintGeometry } from '../kit';
import {
  areaRatio,
  fillFlat,
  fillGradient,
  finalize,
  longAxis,
  noiseWash,
  propCount,
  propScale,
  ribbon,
  safeD,
  safeH,
  safeW,
  scatterOnSurface,
  seg,
  sheet,
  softStroke,
  speckle,
  stripes,
  topSampler,
  weave,
} from './shared-fresh';

// ---------------------------------------------------------------------------
// painted textures
// ---------------------------------------------------------------------------

/** Fried corn shell: golden base with dark toasted blisters burned into it. */
function paintShell(c: CanvasRenderingContext2D, size: number): void {
  fillGradient(c, size, [
    [0, '#EDB255'],
    [0.45, '#E0A040'],
    [1, '#C9862F'],
  ]);
  const rng = new Rng(0x7ac0);
  // blisters: irregular scorched blooms
  for (let i = 0; i < 46; i++) {
    const x = rng.next() * size;
    const y = rng.next() * size;
    const r = size * rng.range(0.015, 0.055);
    const grad = c.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(96,52,18,0.85)');
    grad.addColorStop(0.55, 'rgba(146,84,30,0.45)');
    grad.addColorStop(1, 'rgba(146,84,30,0)');
    c.fillStyle = grad;
    c.beginPath();
    c.arc(x, y, r, 0, TAU);
    c.fill();
  }
  // masa flecks and dusty corn grain
  speckle(c, size, 420, ['#F6D089', '#B87A2C', '#FFE6B4'], 0.002, 0.007, 13, 0.55);
  noiseWash(c, size, 4, 0.18, 27, '#8A5518', '#FFE0A8');
}

function paintShellBump(c: CanvasRenderingContext2D, size: number): void {
  fillFlat(c, size, '#808080');
  const rng = new Rng(0x7ac1);
  for (let i = 0; i < 90; i++) {
    const x = rng.next() * size;
    const y = rng.next() * size;
    const r = size * rng.range(0.012, 0.05);
    const grad = c.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)');
    grad.addColorStop(0.6, 'rgba(160,160,160,0.4)');
    grad.addColorStop(1, 'rgba(128,128,128,0)');
    c.fillStyle = grad;
    c.beginPath();
    c.arc(x, y, r, 0, TAU);
    c.fill();
  }
  noiseWash(c, size, 2, 0.4, 8);
}

function paintQueso(c: CanvasRenderingContext2D, size: number): void {
  fillGradient(c, size, [
    [0, '#FFCC55'],
    [0.5, '#F2B93B'],
    [1, '#DFA22B'],
  ]);
  noiseWash(c, size, 6, 0.12, 51, '#C4881F', '#FFE3A0');
  speckle(c, size, 120, ['#FFE8B4', '#D89B26'], 0.003, 0.012, 52, 0.35);
}

function paintGuac(c: CanvasRenderingContext2D, size: number): void {
  fillFlat(c, size, '#7FA84B');
  noiseWash(c, size, 5, 0.22, 66, '#4F7130', '#A8C96B');
  speckle(c, size, 260, ['#5E8033', '#A9CB6D', '#3F5C25'], 0.003, 0.013, 67, 0.5);
  // flecks of cilantro and lime zest
  const rng = new Rng(0x6acd);
  for (let i = 0; i < 40; i++) {
    const x = rng.next() * size;
    const y = rng.next() * size;
    softStroke(
      c,
      [
        [x, y],
        [x + size * rng.range(0.01, 0.04), y + size * rng.range(-0.02, 0.02)],
      ],
      size * 0.006,
      rng.bool(0.5) ? '#2F5C1E' : '#C8DE86',
      0.6,
      3,
    );
  }
}

function paintBasket(c: CanvasRenderingContext2D, size: number): void {
  weave(c, size, 14, '#D8A155', '#C08B45', '#8A5F2C');
  noiseWash(c, size, 4, 0.18, 71, '#5E3C18', '#F0C88A');
}

function paintSerape(c: CanvasRenderingContext2D, size: number): void {
  stripes(c, size, [
    { span: 6, color: '#F2542D' },
    { span: 2, color: '#FFE3B0' },
    { span: 4, color: '#4CB944' },
    { span: 2, color: '#FFFFFF' },
    { span: 5, color: '#5E2751' },
    { span: 2, color: '#FFB03A' },
    { span: 3, color: '#F2542D' },
    { span: 2, color: '#FFE3B0' },
  ]);
  noiseWash(c, size, 3, 0.16, 83, '#3A1428', '#FFF0D2');
}

// ---------------------------------------------------------------------------
// materials
// ---------------------------------------------------------------------------

const shellMat = (ctx: FoodBuildCtx): THREE.Material =>
  ctx.materials.standard('taco.shell', {
    color: 0xe0a040,
    map: ctx.materials.texture('taco.shell.albedo', paintShell, { size: 256 }),
    bumpMap: ctx.materials.dataTexture('taco.shell.bump', paintShellBump, { size: 128 }),
    bumpScale: 0.02,
    roughness: 0.72,
    metalness: 0,
    side: THREE.DoubleSide,
  });

const fillingMat = (ctx: FoodBuildCtx): THREE.Material =>
  ctx.materials.standard('taco.filling', {
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.55,
    metalness: 0,
  });

const beefMat = (ctx: FoodBuildCtx): THREE.Material =>
  ctx.materials.standard('taco.beef', {
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.62,
    metalness: 0,
    flatShading: true,
  });

const beefBedMat = (ctx: FoodBuildCtx): THREE.Material =>
  ctx.materials.standard('taco.beef.bed', {
    color: 0x5a3019,
    roughness: 0.7,
    metalness: 0,
  });

const guacMat = (ctx: FoodBuildCtx): THREE.Material =>
  ctx.materials.standard('taco.guac', {
    color: 0x7fa84b,
    map: ctx.materials.texture('taco.guac.albedo', paintGuac, { size: 128 }),
    roughness: 0.85,
    metalness: 0,
  });

const guacChunkMat = (ctx: FoodBuildCtx): THREE.Material =>
  ctx.materials.standard('taco.guac.chunk', {
    color: 0xa6c96a,
    roughness: 0.7,
    metalness: 0,
    flatShading: true,
  });

const picoJuiceMat = (ctx: FoodBuildCtx): THREE.Material =>
  ctx.materials.physical('taco.pico.juice', {
    color: 0x9e2018,
    roughness: 0.22,
    metalness: 0,
    clearcoat: 0.7,
    clearcoatRoughness: 0.15,
  });

const picoMat = (ctx: FoodBuildCtx): THREE.Material =>
  ctx.materials.physical('taco.pico', {
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.3,
    metalness: 0,
    clearcoat: 0.55,
    clearcoatRoughness: 0.18,
  });

const quesoMat = (ctx: FoodBuildCtx): THREE.Material =>
  ctx.materials.physical('taco.queso', {
    color: 0xf2b93b,
    map: ctx.materials.texture('taco.queso.albedo', paintQueso, { size: 128 }),
    roughness: 0.22,
    metalness: 0,
    clearcoat: 0.7,
    clearcoatRoughness: 0.1,
    sheen: 0.25,
    sheenColor: 0xffe6b0,
  });

const beanMat = (ctx: FoodBuildCtx): THREE.Material =>
  ctx.materials.physical('taco.beans', {
    color: 0x2a2230,
    roughness: 0.3,
    metalness: 0,
    clearcoat: 0.45,
    clearcoatRoughness: 0.2,
  });

const beanBedMat = (ctx: FoodBuildCtx): THREE.Material =>
  ctx.materials.standard('taco.beans.bed', {
    color: 0x1d1822,
    roughness: 0.55,
    metalness: 0,
  });

const jalapenoMat = (ctx: FoodBuildCtx): THREE.Material =>
  ctx.materials.physical('taco.jalapeno', {
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.28,
    metalness: 0,
    clearcoat: 0.55,
    clearcoatRoughness: 0.14,
    transmission: 0.16,
    thickness: 0.05,
    ior: 1.36,
  });

const jalapenoBrineMat = (ctx: FoodBuildCtx): THREE.Material =>
  ctx.materials.physical('taco.jalapeno.brine', {
    color: 0x87a83f,
    roughness: 0.2,
    metalness: 0,
    clearcoat: 0.6,
    clearcoatRoughness: 0.16,
  });

const cremaMat = (ctx: FoodBuildCtx): THREE.Material =>
  ctx.materials.physical('taco.crema', {
    color: 0xf6f1e2,
    roughness: 0.2,
    metalness: 0,
    clearcoat: 0.6,
    clearcoatRoughness: 0.14,
    sheen: 0.3,
    sheenColor: 0xffffff,
  });

const cremaBedMat = (ctx: FoodBuildCtx): THREE.Material =>
  ctx.materials.standard('taco.crema.bed', {
    color: 0xdcd2b6,
    roughness: 0.5,
    metalness: 0,
  });

// ---------------------------------------------------------------------------
// 1 — folded shell
// ---------------------------------------------------------------------------

function buildShell(ctx: FoodBuildCtx): THREE.Object3D {
  const w = safeW(ctx);
  const d = safeD(ctx);
  const h = safeH(ctx);
  const g = new THREE.Group();

  // kit's foldedShell is an ARCH extruded along Z: the fold sits at the top and
  // the two solid cross-section faces are at x = +/-w/2. That is a folded
  // tortilla seen end-on, which is exactly the read we want.
  const shell = foldedShell(w, h, d, {
    openness: 0.5,
    segments: seg(ctx, 30, 22, 13),
    thickness: 0.11,
  });
  roughen(shell, Math.min(d, h) * 0.02, 13, ctx.index * 3 + 2);
  // Normalise the shell itself instead of letting finalize stretch the whole
  // group, so the filling below is placed against its real height.
  shell.computeBoundingBox();
  const sbb = shell.boundingBox;
  if (sbb) {
    const ext = sbb.max.y - sbb.min.y;
    if (ext > 1e-5) shell.scale(1, h / ext, 1);
    shell.computeBoundingBox();
    if (shell.boundingBox) shell.translate(0, -shell.boundingBox.min.y, 0);
  }
  g.add(mesh(shell, shellMat(ctx)));

  // Lettuce and cheese spilling out of the two open ends. They straddle the end
  // faces so half the bit is inside the fold and half pokes out — placing them
  // inside the arch would hide them behind the solid cross-section.
  if (!ctx.offcut && d > 0.5 && w > 0.4 && ctx.quality !== 'low') {
    const ps = propScale(ctx);
    const rng = new Rng((ctx.index * 977 + 13) >>> 0);
    const per = Math.max(3, Math.round(propCount(ctx, 30, 4) / 2));
    const bits: THREE.BufferGeometry[] = [];
    for (const sx of [-1, 1]) {
      for (let i = 0; i < per; i++) {
        const green = rng.bool(0.55);
        const s = 0.055 * ps * rng.range(0.7, 1.3);
        const bit = new THREE.BoxGeometry(s * 1.7, s * (green ? 0.5 : 0.34), s * (green ? 2.2 : 2.9));
        bit.rotateX(rng.signed() * 0.6);
        bit.rotateY(rng.signed() * 0.5);
        const zz = rng.signed() * d * 0.3;
        const closeness = clamp(1 - Math.abs(zz) / (d * 0.52), 0, 1);
        const yy = Math.max(h * 0.07, h * (0.08 + rng.next() * 0.34) * closeness);
        bit.translate(sx * w * 0.5, yy, zz);
        bits.push(tintGeometry(bit, green ? 0x86c047 : 0xf6c64a));
      }
    }
    const fill = mergeAll(bits);
    if (fill) g.add(mesh(fill, fillingMat(ctx)));
  }

  return finalize(g, ctx);
}

// ---------------------------------------------------------------------------
// 2 — seasoned beef
// ---------------------------------------------------------------------------

function buildBeef(ctx: FoodBuildCtx): THREE.Object3D {
  const w = safeW(ctx);
  const d = safeD(ctx);
  const h = safeH(ctx);
  const g = new THREE.Group();

  const bed = sheet(w, h * 0.55, d, {
    arch: h * 0.06,
    wave: h * 0.05,
    seed: ctx.index + 3,
    segments: seg(ctx, 14, 10, 6),
  });
  const surface = topSampler(bed, ctx.offcut ? 6 : 10);
  g.add(mesh(bed, beefBedMat(ctx)));

  // Crumbly, angular, never spherical — this is minced beef, not peas.
  const ps = propScale(ctx);
  const cr = 0.055 * ps;
  const makeCrumb = (_i: number, rng: Rng): THREE.BufferGeometry => {
    const r = cr * rng.range(0.65, 1.3);
    const blob = new THREE.DodecahedronGeometry(r, 0);
    blob.scale(rng.range(0.85, 1.4), rng.range(0.55, 0.95), rng.range(0.85, 1.4));
    const c = rng.next();
    return tintGeometry(blob, c < 0.62 ? 0x6b3a20 : c < 0.88 ? 0x8a4a26 : 0x4d2714);
  };
  const lower = scatterOnSurface(propCount(ctx, 100, 4), w, d, surface, makeCrumb, {
    seed: ctx.index * 21 + 8,
    margin: 0.08 * ps,
    spacing: 0.015,
    randomTilt: 0.9,
    sink: 0.02 * ps,
  });
  const upper = ctx.offcut
    ? null
    : scatterOnSurface(
        propCount(ctx, 34, 1),
        w * 0.88,
        d * 0.88,
        (x, z) => surface(x, z) + cr * 0.85,
        makeCrumb,
        { seed: ctx.index * 21 + 61, margin: 0.09 * ps, spacing: 0.05, randomTilt: 0.9, sink: 0.01 * ps },
      );
  const crumbs = mergeAll([lower, upper]);
  if (crumbs) g.add(mesh(crumbs, beefMat(ctx)));

  return finalize(g, ctx);
}

// ---------------------------------------------------------------------------
// 3 — guacamole
// ---------------------------------------------------------------------------

function buildGuac(ctx: FoodBuildCtx): THREE.Object3D {
  const w = safeW(ctx);
  const d = safeD(ctx);
  const h = safeH(ctx);
  const g = new THREE.Group();

  const body = pour(w * 0.99, h * 0.54, d * 0.99, {
    drips: ctx.offcut ? 2 : 4,
    dripLength: 0.26,
    seed: ctx.index * 3 + 11,
    radial: seg(ctx, 44, 32, 18),
  });
  // low-frequency lumps: guacamole is chunky, not poured
  roughen(body, h * 0.07, 3.4, ctx.index + 4);
  body.computeBoundingBox();
  const bb = body.boundingBox;
  if (bb) body.translate(0, -bb.min.y, 0);
  const surface = topSampler(body, ctx.offcut ? 6 : 12);
  g.add(mesh(body, guacMat(ctx)));

  const ps = propScale(ctx);
  const chunks = ctx.offcut
    ? null
    : scatterOnSurface(
        propCount(ctx, 26, 1),
        w * 0.9,
        d * 0.9,
        surface,
        (_i, rng) => {
          const s = 0.07 * ps * rng.range(0.7, 1.2);
          const chunk = new THREE.DodecahedronGeometry(s, 0);
          chunk.scale(1.1, 0.6, 1.1);
          return chunk;
        },
        { seed: ctx.index * 13 + 2, margin: 0.09 * ps, spacing: 0.08, randomTilt: 0.7, sink: 0.03 * ps },
      );
  if (chunks) g.add(mesh(chunks, guacChunkMat(ctx)));

  return finalize(g, ctx);
}

// ---------------------------------------------------------------------------
// 4 — pico salsa
// ---------------------------------------------------------------------------

function buildPico(ctx: FoodBuildCtx): THREE.Object3D {
  const w = safeW(ctx);
  const d = safeD(ctx);
  const h = safeH(ctx);
  const g = new THREE.Group();

  const bed = sheet(w, h * 0.55, d, {
    arch: h * 0.06,
    wave: h * 0.05,
    seed: ctx.index + 9,
    segments: seg(ctx, 14, 10, 6),
  });
  const surface = topSampler(bed, ctx.offcut ? 6 : 10);
  g.add(mesh(bed, picoJuiceMat(ctx)));

  // Hard-edged cubes so it reads DICED, never as a paste.
  const ps = propScale(ctx);
  const ds = 0.052 * ps;
  const makeDie = (_i: number, rng: Rng): THREE.BufferGeometry => {
    const s = ds * rng.range(0.75, 1.25);
    const cube = new THREE.BoxGeometry(s, s * 0.78, s * rng.range(0.85, 1.15));
    const c = rng.next();
    return tintGeometry(cube, c < 0.55 ? 0xd8322b : c < 0.82 ? 0xf5efe0 : 0x4cb944);
  };
  const lower = scatterOnSurface(propCount(ctx, 140, 5), w, d, surface, makeDie, {
    seed: ctx.index * 29 + 3,
    margin: 0.06 * ps,
    spacing: 0.012,
    randomTilt: 0.6,
    sink: 0.014 * ps,
  });
  const upper = ctx.offcut
    ? null
    : scatterOnSurface(
        propCount(ctx, 46, 1),
        w * 0.88,
        d * 0.88,
        (x, z) => surface(x, z) + ds * 0.75,
        makeDie,
        { seed: ctx.index * 29 + 71, margin: 0.07 * ps, spacing: 0.04, randomTilt: 0.6, sink: 0.008 * ps },
      );
  const dice = mergeAll([lower, upper]);
  if (dice) g.add(mesh(dice, picoMat(ctx)));

  return finalize(g, ctx);
}

// ---------------------------------------------------------------------------
// 5 — queso pour
// ---------------------------------------------------------------------------

function buildQueso(ctx: FoodBuildCtx): THREE.Object3D {
  const w = safeW(ctx);
  const d = safeD(ctx);
  const h = safeH(ctx);
  const g = new THREE.Group();

  const body = pour(w * 0.99, h * 0.58, d * 0.99, {
    drips: ctx.offcut ? 3 : 7,
    dripLength: 0.52,
    seed: ctx.index * 7 + 5,
    radial: seg(ctx, 56, 40, 22),
  });
  // Drips reach the base of the layer and stop — nothing leaves y in [0, h].
  body.computeBoundingBox();
  const bb = body.boundingBox;
  if (bb) body.translate(0, -bb.min.y, 0);
  g.add(mesh(body, quesoMat(ctx)));

  return finalize(g, ctx);
}

// ---------------------------------------------------------------------------
// 6 — black beans
// ---------------------------------------------------------------------------

function buildBeans(ctx: FoodBuildCtx): THREE.Object3D {
  const w = safeW(ctx);
  const d = safeD(ctx);
  const h = safeH(ctx);
  const g = new THREE.Group();

  const bed = sheet(w, h * 0.52, d, {
    arch: h * 0.06,
    wave: h * 0.05,
    seed: ctx.index + 12,
    segments: seg(ctx, 14, 10, 6),
  });
  const surface = topSampler(bed, ctx.offcut ? 6 : 10);
  g.add(mesh(bed, beanBedMat(ctx)));

  const ps = propScale(ctx);
  const r = 0.048 * ps;
  const rad = seg(ctx, 8, 6, 5);
  const ring = seg(ctx, 5, 4, 3);
  const makeBean = (_i: number, rng: Rng): THREE.BufferGeometry => {
    const bean = new THREE.SphereGeometry(r * rng.range(0.85, 1.12), rad, ring);
    bean.scale(1.65, 0.82, 1);
    return bean;
  };

  const lower = scatterOnSurface(propCount(ctx, 85, 3), w, d, surface, makeBean, {
    seed: ctx.index * 31 + 6,
    margin: r * 1.8,
    spacing: 0.03,
    randomTilt: 0.28,
    sink: r * 0.3,
  });
  const upper = ctx.offcut
    ? null
    : scatterOnSurface(
        propCount(ctx, 34, 1),
        w * 0.86,
        d * 0.86,
        (x, z) => surface(x, z) + r * 0.9,
        makeBean,
        { seed: ctx.index * 31 + 44, margin: r * 1.9, spacing: 0.06, randomTilt: 0.35, sink: r * 0.2 },
      );

  const beans = mergeAll([lower, upper]);
  if (beans) g.add(mesh(beans, beanMat(ctx)));

  return finalize(g, ctx);
}

// ---------------------------------------------------------------------------
// 7 — jalapeño ring
// ---------------------------------------------------------------------------

function jalapenoRing(radius: number, thick: number, ctx: FoodBuildCtx): THREE.BufferGeometry | null {
  const parts: THREE.BufferGeometry[] = [];
  const tube = radius * 0.3;
  const ring = new THREE.TorusGeometry(radius - tube, tube, seg(ctx, 6, 5, 4), seg(ctx, 16, 12, 8));
  ring.rotateX(-Math.PI / 2);
  ring.scale(1, clamp(thick / Math.max(tube * 2, 1e-4), 0.35, 1.6), 1);
  parts.push(tintGeometry(ring, 0x4cb944));

  if (!ctx.offcut && radius > 0.05) {
    for (let s = 0; s < 4; s++) {
      const a = (s / 4) * TAU + 0.7;
      const seed = new THREE.SphereGeometry(radius * 0.13, 5, 3);
      seed.scale(1, 0.45, 1.5);
      seed.rotateY(a);
      seed.translate(Math.cos(a) * radius * 0.3, -thick * 0.16, Math.sin(a) * radius * 0.3);
      parts.push(tintGeometry(seed, 0xf3edbf));
    }
  }
  const merged = mergeAll(parts);
  if (merged) merged.translate(0, thick * 0.5, 0);
  return merged;
}

function buildJalapeno(ctx: FoodBuildCtx): THREE.Object3D {
  const w = safeW(ctx);
  const d = safeD(ctx);
  const h = safeH(ctx);
  const g = new THREE.Group();

  const bed = sheet(w, h * 0.4, d, {
    arch: h * 0.05,
    wave: h * 0.05,
    seed: ctx.index + 15,
    segments: seg(ctx, 14, 10, 6),
  });
  const surface = topSampler(bed, ctx.offcut ? 6 : 10);
  g.add(mesh(bed, jalapenoBrineMat(ctx)));

  const ringR = clamp(Math.min(w, d) * 0.34, 0.028, 0.23);
  const ringT = h * 0.6;
  const rings = scatterOnSurface(
    propCount(ctx, 14, 1),
    w,
    d,
    surface,
    (i) => jalapenoRing(ringR * (0.85 + 0.3 * (((i * 41) % 9) / 9)), ringT, ctx),
    {
      seed: ctx.index * 37 + 2,
      margin: ringR * 1.06,
      spacing: 0.22,
      randomTilt: 0.14,
      sink: ringT * 0.16,
    },
  );
  if (rings) g.add(mesh(rings, jalapenoMat(ctx)));

  return finalize(g, ctx);
}

// ---------------------------------------------------------------------------
// 8 — lime crema
// ---------------------------------------------------------------------------

function buildCrema(ctx: FoodBuildCtx): THREE.Object3D {
  const w = safeW(ctx);
  const d = safeD(ctx);
  const h = safeH(ctx);
  const g = new THREE.Group();

  const bed = sheet(w, h * 0.42, d, {
    arch: h * 0.05,
    wave: h * 0.04,
    seed: ctx.index + 18,
    segments: seg(ctx, 14, 10, 6),
  });
  bed.computeBoundingBox();
  const bedTop = bed.boundingBox ? bed.boundingBox.max.y : h * 0.5;
  g.add(mesh(bed, cremaBedMat(ctx)));

  // the zigzag drizzle
  const alongX = longAxis(ctx) === 'x';
  const L = alongX ? w : d;
  const S = alongX ? d : w;
  const r = clamp(Math.min(h * 0.42, S * 0.16), 0.01, 0.06);
  const zig = clamp(Math.round(L / 0.4), 2, ctx.offcut ? 5 : 10);
  const halfSpan = Math.max(S * 0.5 - r * 2.4, 0) * 0.72;
  const lines: THREE.BufferGeometry[] = [];

  for (let pass = 0; pass < (areaRatio(ctx) > 0.3 && !ctx.offcut ? 2 : 1); pass++) {
    const pts: THREE.Vector3[] = [];
    const flip = pass === 0 ? 1 : -1;
    for (let i = 0; i <= zig; i++) {
      const t = i / zig;
      const a = (t - 0.5) * L * 0.84;
      const b = (i % 2 === 0 ? -1 : 1) * halfSpan * flip;
      const y = bedTop + r * 0.75 + Math.sin(t * 5.1 + pass) * r * 0.2;
      pts.push(new THREE.Vector3(alongX ? a : b, y, alongX ? b : a));
    }
    const tube = ribbon(pts, r, {
      tubular: Math.max(8, zig * seg(ctx, 6, 4, 3)),
      radial: seg(ctx, 8, 6, 5),
    });
    if (tube) lines.push(tube);
  }

  const drizzle = mergeAll(lines);
  if (drizzle) g.add(mesh(drizzle, cremaMat(ctx)));

  return finalize(g, ctx);
}

// ---------------------------------------------------------------------------
// plate + scenery
// ---------------------------------------------------------------------------

const TRAY_H = 0.1;
const RIM_TUBE = 0.042;
const PLATE_T = 0.18;

function buildPlate(ctx: FoodBuildCtx): THREE.Object3D {
  const w = Math.max(ctx.width, 0.6);
  const d = Math.max(ctx.depth, 0.6);
  const g = new THREE.Group();

  const enamel = ctx.materials.physical('taco.enamel', {
    color: 0xf6efe2,
    roughness: 0.16,
    metalness: 0,
    clearcoat: 0.85,
    clearcoatRoughness: 0.08,
  });
  const enamelRim = ctx.materials.physical('taco.enamel.rim', {
    color: 0xf2542d,
    roughness: 0.18,
    metalness: 0,
    clearcoat: 0.85,
    clearcoatRoughness: 0.08,
  });
  const basket = ctx.materials.standard('taco.basket', {
    color: 0xc89253,
    map: ctx.materials.texture('taco.basket.albedo', paintBasket, { size: 256, repeat: [2, 2] }),
    roughness: 0.82,
    metalness: 0,
  });

  // The woven floor's TOP SURFACE IS EXACTLY y = 0 so the tower's first layer
  // lands flush on it; the tray, rim and foot all live in y in [-PLATE_T, 0].
  const floorH = 0.09;
  const floor = puck(w * 0.9, floorH, d * 0.9, { domed: 0, wobble: 0.01, radial: 44, rings: 2, seed: 6, square: 0 });
  floor.translate(0, -floorH, 0);
  g.add(mesh(floor, basket));

  const tray = puck(w, TRAY_H, d, { domed: 0, wobble: 0.012, taper: 0.04, radial: 48, rings: 2, seed: 7, square: 0 });
  tray.translate(0, -TRAY_H - 0.006, 0);
  g.add(mesh(tray, enamel));

  // rolled rim, the top of the roll flush with y = 0
  const rim = new THREE.TorusGeometry(0.5 - RIM_TUBE, RIM_TUBE, 8, 44);
  rim.rotateX(-Math.PI / 2);
  rim.scale(w, 1, d);
  rim.translate(0, -RIM_TUBE, 0);
  g.add(mesh(rim, enamelRim));

  // foot ring
  const footTube = 0.028;
  const foot = new THREE.TorusGeometry(0.34, footTube, 6, 30);
  foot.rotateX(-Math.PI / 2);
  foot.scale(w, 1, d);
  foot.translate(0, -PLATE_T + footTube, 0);
  g.add(mesh(foot, enamel));

  return g;
}

function buildScenery(ctx: FoodBuildCtx): THREE.Object3D {
  const g = new THREE.Group();
  const w = Math.max(ctx.width, 1);
  const groundY = -PLATE_T;

  const serape = ctx.materials.standard('taco.serape', {
    color: 0xffffff,
    map: ctx.materials.texture('taco.serape.albedo', paintSerape, { size: 256 }),
    roughness: 0.92,
    metalness: 0,
  });
  const limeMat = ctx.materials.physical('taco.lime', {
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.3,
    metalness: 0,
    clearcoat: 0.5,
    clearcoatRoughness: 0.2,
  });

  // striped cloth under the tray, turned so its stripes read at an angle
  const cloth = sheet(w * 3.1, 0.022, w * 2.2, { wave: 0.012, waveFreq: 2.2, seed: 5, segments: 12, square: 1 });
  const cm = mesh(cloth, serape, { cast: false, receive: true });
  cm.position.y = groundY - 0.024;
  cm.rotation.y = 0.22;
  g.add(cm);

  // a lime wedge lying flat on the cloth, cut face up
  const lr = w * 0.13;
  const lt = w * 0.034;
  const parts: THREE.BufferGeometry[] = [];
  const rind = new THREE.CylinderGeometry(lr, lr, lt, seg(ctx, 18, 14, 9), 1, true, 0, Math.PI);
  parts.push(tintGeometry(rind, 0x4f8f2a));
  const flesh = new THREE.CylinderGeometry(lr * 0.86, lr * 0.86, lt * 0.99, seg(ctx, 18, 14, 9), 1, false, 0, Math.PI);
  parts.push(tintGeometry(flesh, 0xd8e88a));
  for (let s = 0; s < 4; s++) {
    const a = ((s + 0.5) / 4) * Math.PI;
    const pith = new THREE.BoxGeometry(lr * 0.82, lt * 1.01, lr * 0.045);
    pith.translate(lr * 0.41, 0, 0);
    pith.rotateY(-a);
    parts.push(tintGeometry(pith, 0xf4f6dd));
  }
  const wedge = mergeAll(parts);
  if (wedge) {
    const wm = mesh(wedge, limeMat);
    wm.rotation.set(0.07, -0.7, 0);
    wm.position.set(-w * 1.02, groundY + lt * 0.5, w * 0.62);
    g.add(wm);
  }

  return g;
}

// ---------------------------------------------------------------------------
// theme
// ---------------------------------------------------------------------------

const foods: FoodDef[] = [
  {
    id: 'taco.shell',
    name: 'Folded Shell',
    glyph: '🌮',
    thickness: 0.62,
    tint: 0xe0a040,
    tintAlt: 0x8a5518,
    weight: 1.2,
    build: buildShell,
  },
  {
    id: 'taco.beef',
    name: 'Seasoned Beef',
    glyph: '🥩',
    thickness: 0.36,
    tint: 0x6b3a20,
    tintAlt: 0x8a4a26,
    build: buildBeef,
  },
  {
    id: 'taco.guac',
    name: 'Guacamole',
    glyph: '🥑',
    thickness: 0.3,
    tint: 0x7fa84b,
    tintAlt: 0xa6c96a,
    build: buildGuac,
  },
  {
    id: 'taco.pico',
    name: 'Pico Salsa',
    glyph: '🍅',
    thickness: 0.26,
    tint: 0xd8322b,
    tintAlt: 0x4cb944,
    build: buildPico,
  },
  {
    id: 'taco.queso',
    name: 'Queso Pour',
    glyph: '🧀',
    thickness: 0.3,
    tint: 0xf2b93b,
    tintAlt: 0xffe3b0,
    build: buildQueso,
  },
  {
    id: 'taco.beans',
    name: 'Black Beans',
    glyph: '🫘',
    thickness: 0.32,
    tint: 0x2a2230,
    tintAlt: 0x4b3f56,
    build: buildBeans,
  },
  {
    id: 'taco.jalapeno',
    name: 'Jalapeño Ring',
    glyph: '🌶️',
    thickness: 0.24,
    tint: 0x4cb944,
    tintAlt: 0xf3edbf,
    weight: 0.9,
    build: buildJalapeno,
  },
  {
    id: 'taco.crema',
    name: 'Lime Crema',
    glyph: '🥛',
    thickness: 0.22,
    tint: 0xf6f1e2,
    tintAlt: 0xdcd2b6,
    weight: 0.9,
    build: buildCrema,
  },
];

export const tacoTheme: ThemeDef = {
  id: 'taco',
  name: 'Taco Night',
  tagline: 'Shells, guac, salsa, all the fixings.',
  glyph: '🌮',
  price: 1.99,
  palette: {
    bgTop: 0xffc46b,
    bgBottom: 0x5e2751,
    fog: 0xb4664f,
    fogDensity: 0.015,
    key: 0xffe3b0,
    keyIntensity: 2.6,
    fill: 0x7a9fd4,
    fillIntensity: 0.6,
    rim: 0xffb03a,
    rimIntensity: 1.4,
    ground: 0x3e1a36,
    accent: 0xf2542d,
    accentSoft: 0x4cb944,
    bloomStrength: 0.42,
    exposure: 1.05,
    vignette: 0.36,
  },
  foods,
  plate: buildPlate,
  scenery: buildScenery,
  ambience: 'taco',
};
