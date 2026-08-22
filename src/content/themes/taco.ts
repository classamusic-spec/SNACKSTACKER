/**
 * Taco Night — warm, saturated, messy in a good way.
 *
 * The fillings are the interesting problem here: beef, pico and beans are all
 * "small bits on a bed", so each one gets a different bit — angular crumbs,
 * hard-edged dice, smooth ovals — and a different surface finish so they never
 * read as the same layer in a different colour.
 */
import * as THREE from 'three';
import type { EnvBuildCtx, FoodBuildCtx, FoodDef, ThemeDef } from '../api';
import { Rng } from '../../core/rng';
import { TAU, clamp, clamp01, lerp } from '../../core/math';
import { SKY_PRESETS } from '../../render/palette';
import {
  fbm2,
  foldedShell,
  mergeAll,
  mesh,
  pour,
  puck,
  roughen,
  roundedBox,
  tintGeometry,
} from '../kit';
import {
  areaRatio,
  catenary,
  envSeg,
  facingQuad,
  fillFlat,
  fillGradient,
  finalize,
  flagLine,
  hazeByRadius,
  lathe,
  longAxis,
  mergeEnv,
  noiseWash,
  propCount,
  propScale,
  radialGlow,
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
  tableSlab,
  tintGradientY,
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

/**
 * Woven serape bands. Vertical in texture space on purpose: the runner's U
 * axis is its length, so bands that vary along U end up running ACROSS the
 * cloth the way a real serape's do.
 */
function paintSerape(c: CanvasRenderingContext2D, size: number): void {
  stripes(
    c,
    size,
    [
      { span: 6, color: '#F2542D' },
      { span: 2, color: '#FFE3B0' },
      { span: 4, color: '#4CB944' },
      { span: 2, color: '#FFFFFF' },
      { span: 5, color: '#5E2751' },
      { span: 2, color: '#FFB03A' },
      { span: 3, color: '#F2542D' },
      { span: 2, color: '#FFE3B0' },
    ],
    true,
  );
  noiseWash(c, size, 3, 0.18, 83, '#3A1428', '#FFF0D2');
  // a suggestion of weft threads so the cloth is not a printed ribbon
  c.save();
  c.globalAlpha = 0.16;
  c.strokeStyle = '#2A1220';
  c.lineWidth = Math.max(1, size * 0.004);
  for (let i = 0; i < 44; i++) {
    const y = (i / 44) * size;
    c.beginPath();
    c.moveTo(0, y);
    c.lineTo(size, y);
    c.stroke();
  }
  c.restore();
}

// ---------------------------------------------------------------------------
// materials
// ---------------------------------------------------------------------------

const shellMat = (ctx: FoodBuildCtx): THREE.Material =>
  ctx.materials.standard('taco.shell', {
    // The painted albedo already carries this food's hue; three multiplies
    // color by map, so tinting here too would square it toward black.
    color: 0xffffff,
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
    // The painted albedo already carries this food's hue; three multiplies
    // color by map, so tinting here too would square it toward black.
    color: 0xffffff,
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
    // The painted albedo already carries this food's hue; three multiplies
    // color by map, so tinting here too would square it toward black.
    color: 0xffffff,
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
  const archH = h * 0.93;
  const shell = foldedShell(w, archH, d, {
    openness: 0.5,
    segments: seg(ctx, 30, 22, 13),
    thickness: 0.11,
  });
  roughen(shell, Math.min(d, h) * 0.02, 13, ctx.index * 3 + 2);
  // Normalise the shell itself instead of letting finalize stretch the whole
  // group, so the crease and filling below are placed against its real height.
  shell.computeBoundingBox();
  const sbb = shell.boundingBox;
  if (sbb) {
    const ext = sbb.max.y - sbb.min.y;
    if (ext > 1e-5) shell.scale(1, archH / ext, 1);
    shell.computeBoundingBox();
    if (shell.boundingBox) shell.translate(0, -shell.boundingBox.min.y, 0);
  }
  g.add(mesh(shell, shellMat(ctx)));

  // The folded crease along the top. An extruded arch has no vertices between
  // its two end faces, so its top edge is dead straight; this rounded crease is
  // what stops the long side reading as a plain slab.
  const cr = Math.min(h * 0.13, d * 0.08, w * 0.18);
  const crest: THREE.Vector3[] = [];
  const steps = ctx.offcut ? 4 : 8;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const dip = 0.1 + 0.95 * (0.5 + 0.5 * Math.sin(t * Math.PI * 2.3 + ctx.index * 1.7));
    crest.push(
      new THREE.Vector3(
        (t - 0.5) * w * 0.99,
        archH - cr * dip,
        Math.sin(t * Math.PI * 1.6 + ctx.index) * d * 0.025,
      ),
    );
  }
  const ridge = ribbon(crest, cr, {
    tubular: seg(ctx, 30, 20, 12),
    radial: seg(ctx, 8, 6, 5),
  });
  if (ridge) g.add(mesh(ridge, shellMat(ctx)));

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

// ---------------------------------------------------------------------------
// environment — a string-lit patio at dusk
// ---------------------------------------------------------------------------
//
// The sun has just gone down behind the hill. The bulbs are on, the sky over
// the wall is still hot at the bottom and going violet above it, and the town
// is a stack of flat silhouettes between the two.
//
// The camera dictates the layout. It sits ~10 units out from the tower axis at
// a fixed 0.5 rad pitch, which means:
//
//   * the table has to reach past ~5.4 units in every direction or the bottom
//     of the screen falls off its edge;
//   * the table's far edge hides the foot of anything standing further out and
//     lower down, which is how the pots and the wall stand on a patio floor
//     that is never modelled;
//   * anything hanging BELOW eye level has to be strung outside the camera's
//     own radius, or its near half swings straight across the tower. Every
//     string here is a chord of a ring at 11.9-12.6 units for that reason —
//     and because a chord of a ring is always broadside to a camera orbiting
//     the middle, which is what makes the flags read from every angle.
//
// ## Where the sky is, and why the landscape is so low
//
// The frame top looks 4.5 degrees BELOW the true horizon, so the horizon line
// is off the top of the screen and the whole world is seen from above. Two
// consequences run through every number in the distance layers below.
//
// The band of open sky is the gap between the frame top and whatever the eye
// last cleared, and it OPENS AS THE TOWER GROWS: the camera rides up with the
// tower, the wall drops away under it, and the sky goes from about 7% of the
// frame on the home screen to a quarter of it by layer fifteen. The sky is
// therefore the thing that gets better the longer a run lasts, which is
// exactly the right thing to spend the background budget on.
//
// And distant objects project HIGHER, so each successive layer has to be
// physically LOWER than the one in front of it or it rides up out of frame.
// The four crest heights below are not a landscape profile, they are the
// solution to `y <= camY - distance * tan(frameTop)` evaluated at the lowest
// camera the game ever uses (the first drop of a run), with enough margin left
// over that the top third of the sky band stays empty. Move any of them up and
// the ridge behind eats the sunset in front of it.

/** Half-extents of the table. Both must clear the bottom of frame. */
const TABLE_HALF_W = 6.4;
const TABLE_HALF_D = 5.8;
/** The serape is what the plate actually rests on, so the wood sits under it. */
const RUNNER_T = 0.04;
/** Patio floor. Far enough below the table top that its edge hides the join. */
const PATIO_DROP = 2.7;
const WALL_R = 12.9;
const PAPEL_R = 12.4;
const FESTOON_R = 11.9;
/** The bulb run pinned to the wall itself — close enough to actually light it. */
const WALL_LAMP_R = 12.45;
/** The arc directly behind the tower in the play camera's view. */
const BACK_ARC = Math.PI * 1.25;

/** The four silhouette layers past the wall, nearest first. */
const ROOF_R = 19;
const TOWN_R = 26;
const RIDGE_R = 42;
const MESA_R = 60;

/**
 * Crest height of each layer, relative to the table top. Derived, not styled —
 * see the note above. They descend because the layers recede.
 */
const ROOF_TOP = 2.16;
const TOWN_TOP = 1.22;
const RIDGE_TOP = -0.57;
const MESA_TOP = -2.41;

/** What the distance fades toward: the hot band of sky just over the wall. */
const DUSK_HAZE = 0xf0b06a;

/**
 * Bearing of the sunset, taken from the sky preset rather than typed twice.
 * The wall, the roofs and the ridge are all shaded against it, so if the
 * render agent ever re-aims the sun the whole patio turns with it.
 */
const SUN_AZ = SKY_PRESETS.taco.sunAzimuth;

const PAPEL_COLORS = [0xf2542d, 0xffb03a, 0x4cb944, 0xff7bb0, 0x7ad7f0, 0xfff0c9] as const;
const CLAY_TINTS = [0xb0573a, 0xc06b45, 0x9c4a33, 0xc98055] as const;

/**
 * Turquoise patio paint worn back to the grain. Painting the wood FIRST and
 * then letting the paint fail over it is what sells "worn" — a turquoise base
 * with brown speckles on top just reads as dirt.
 */
function paintPatioWood(c: CanvasRenderingContext2D, size: number): void {
  fillFlat(c, size, '#5E3A26');
  const rng = new Rng(0x7a11);
  for (let i = 0; i < 30; i++) {
    const y = rng.next() * size;
    const pts: Array<[number, number]> = [];
    let yy = y;
    for (let x = -0.05; x <= 1.06; x += 0.12) {
      yy += rng.signed() * size * 0.012;
      pts.push([x * size, yy]);
    }
    softStroke(c, pts, size * rng.range(0.002, 0.007), rng.bool(0.5) ? '#40241A' : '#7E5233', 0.7, 4);
  }
  // The paint goes on as overlapping soft blobs rather than a flat fill with
  // holes punched in it: coverage lands around 90% and the gaps have feathered
  // edges, which is what worn paint actually looks like. A hard cell grid was
  // tried first and read as camouflage.
  const blobs = 96;
  for (let i = 0; i < blobs; i++) {
    const cx = rng.next() * size;
    const cy = rng.next() * size;
    const r = size * rng.range(0.07, 0.2);
    const grad = c.createRadialGradient(cx, cy, 0, cx, cy, r);
    const teal = rng.bool(0.5) ? '42,110,104' : '36,96,92';
    grad.addColorStop(0, `rgba(${teal},0.95)`);
    grad.addColorStop(0.6, `rgba(${teal},0.8)`);
    grad.addColorStop(1, `rgba(${teal},0)`);
    c.fillStyle = grad;
    c.beginPath();
    c.arc(cx, cy, r, 0, TAU);
    c.fill();
  }
  // brush drag marks in a lighter mix
  c.save();
  c.globalAlpha = 0.35;
  for (let i = 0; i < 24; i++) {
    const y = rng.next() * size;
    softStroke(
      c,
      [
        [rng.next() * size * 0.4, y],
        [size * rng.range(0.5, 1.05), y + rng.signed() * size * 0.02],
      ],
      size * rng.range(0.004, 0.012),
      '#78BEB2',
      0.5,
      3,
    );
  }
  c.restore();

  // plank seams, cut through the paint
  c.save();
  c.strokeStyle = 'rgba(30,16,10,0.7)';
  c.lineWidth = Math.max(1.5, size * 0.012);
  for (let i = 0; i < 4; i++) {
    c.beginPath();
    c.moveTo(0, (i / 4) * size);
    c.lineTo(size, (i / 4) * size);
    c.stroke();
  }
  c.strokeStyle = 'rgba(160,205,196,0.35)';
  c.lineWidth = Math.max(1, size * 0.005);
  for (let i = 0; i < 4; i++) {
    c.beginPath();
    c.moveTo(0, (i / 4) * size + size * 0.011);
    c.lineTo(size, (i / 4) * size + size * 0.011);
    c.stroke();
  }
  c.restore();
  noiseWash(c, size, 6, 0.1, 19, '#1E4A46', '#7FC0B5');
}

/**
 * Hand-floated stucco. The albedo is colourless on purpose — every bit of hue
 * on this wall comes from vertex colour, so the map can be a pure record of
 * TROWEL, and it tiles eleven times around a 40-unit circle without ever
 * showing a repeat because there is no feature in it big enough to recognise.
 */
function paintStucco(c: CanvasRenderingContext2D, size: number): void {
  fillFlat(c, size, '#FFFFFF');
  noiseWash(c, size, 4, 0.3, 63, '#B08C7E', '#FFFFFF');
  // long, shallow float marks: the arcs a plasterer's trowel leaves
  const rng = new Rng(0x51c0);
  c.save();
  for (let i = 0; i < 26; i++) {
    const cx = rng.next() * size;
    const cy = rng.next() * size;
    const r = size * rng.range(0.18, 0.45);
    const a0 = rng.range(0, TAU);
    const pts: Array<[number, number]> = [];
    for (let s = 0; s <= 8; s++) {
      const a = a0 + (s / 8) * rng.range(0.5, 1.1);
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.5]);
    }
    softStroke(c, pts, size * rng.range(0.004, 0.014), rng.bool(0.5) ? '#C9AB9C' : '#FFF8F2', 0.5, 4);
  }
  c.restore();
  speckle(c, size, 420, ['#F3E2D8', '#C0A091', '#8E7062'], 0.0015, 0.009, 64, 0.4);
}

/** The same trowel, as height: this is what stops the wall reading as paper. */
function paintStuccoBump(c: CanvasRenderingContext2D, size: number): void {
  fillFlat(c, size, '#808080');
  noiseWash(c, size, 3, 0.55, 63, '#3A3A3A', '#D8D8D8');
  speckle(c, size, 520, ['#FFFFFF', '#2A2A2A'], 0.0015, 0.008, 64, 0.5);
}

/**
 * Light the adobe wall by hand.
 *
 * The reason this exists: at the play camera the wall directly behind the
 * tower faces about 87 degrees away from the key, so the key contributes
 * essentially nothing to the only arc the player ever sees during a run. The
 * previous fix was an emissive lift, which does raise it — uniformly, which is
 * precisely what makes a wall look like a painted flat.
 *
 * What actually happens on that wall at dusk is three separate things, and
 * doing them separately is what gives it form back:
 *
 *   * **sky bounce, by bearing.** The face pointing back at the sunset is warm
 *     terracotta; the face pointing away from it is lit by the cool half of
 *     the sky and goes violet. Across the ~46 degrees of wall a player sees
 *     during a run that is a real gradient, not a tint.
 *   * **sky bounce, by height.** Higher on the wall sees more sky, so it is
 *     lighter. Down at the patio floor it sees mostly ground and goes dark.
 *   * **the bulbs.** Inverse-square pools from the run of lamps pinned under
 *     the coping. This is the part that lifts the shadow side, and because it
 *     is LOCAL it lifts it into scallops instead of into a flat.
 *
 * Plus a shadow band under the coping, because a lip with no shadow under it
 * is not a lip.
 */
function shadeAdobe(
  geo: THREE.BufferGeometry,
  opts: {
    floorY: number;
    crestY: number;
    lamps: ReadonlyArray<THREE.Vector3>;
    lampGain?: number;
    lampReach?: number;
    coping?: boolean;
  },
): THREE.BufferGeometry {
  const pos = geo.attributes.position as THREE.BufferAttribute | undefined;
  if (!pos) return geo;
  const { floorY, crestY, lamps } = opts;
  const gain = opts.lampGain ?? 1;
  const reach = Math.max(opts.lampReach ?? 1.9, 0.2);
  const coping = opts.coping ?? true;

  const shadeLow = new THREE.Color(0x3d2445).convertSRGBToLinear();
  const shadeHigh = new THREE.Color(0x9a7290).convertSRGBToLinear();
  const sunLow = new THREE.Color(0x8f5340).convertSRGBToLinear();
  const sunHigh = new THREE.Color(0xe0a276).convertSRGBToLinear();
  const lampColor = new THREE.Color(0xffa447).convertSRGBToLinear();

  const span = Math.max(crestY - floorY, 1e-3);
  const arr = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      arr[i * 3] = arr[i * 3 + 1] = arr[i * 3 + 2] = 1;
      continue;
    }
    const h = clamp01((y - floorY) / span);
    // the inner face of a ring is lit where its own bearing is opposite the sun
    const sunFace = clamp01(-Math.cos(Math.atan2(x, z) - SUN_AZ));
    const warm = Math.pow(sunFace, 0.75);

    let r = lerp(
      lerp(shadeLow.r, shadeHigh.r, h),
      lerp(sunLow.r, sunHigh.r, h),
      warm,
    );
    let g = lerp(
      lerp(shadeLow.g, shadeHigh.g, h),
      lerp(sunLow.g, sunHigh.g, h),
      warm,
    );
    let b = lerp(
      lerp(shadeLow.b, shadeHigh.b, h),
      lerp(sunLow.b, sunHigh.b, h),
      warm,
    );

    if (coping) {
      // a soft band of shadow thrown down the wall by the lip on top of it
      const under = clamp01((y - (crestY - 0.42)) / 0.42) * clamp01((crestY - y) / 0.1);
      const k = 1 - 0.42 * under;
      r *= k;
      g *= k;
      b *= k;
    }

    let lit = 0;
    for (let l = 0; l < lamps.length; l++) {
      const p = lamps[l];
      const dx = x - p.x;
      const dy = y - p.y;
      const dz = z - p.z;
      const d2 = (dx * dx + dy * dy + dz * dz) / (reach * reach);
      lit += 1 / (1 + d2 * d2);
    }
    lit = Math.min(lit * gain, 1.5);
    r += lampColor.r * lit;
    g += lampColor.g * lit;
    b += lampColor.b * lit;

    arr[i * 3] = Math.min(r, 4);
    arr[i * 3 + 1] = Math.min(g, 4);
    arr[i * 3 + 2] = Math.min(b, 4);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

/**
 * Pool mist in the feet of a silhouette layer without losing what is already
 * painted on its crest.
 *
 * `tintGradientY` would do the ramp, but it REPLACES vertex colour, and by
 * this point each roof already carries which side of it the sunset is on.
 * This multiplies instead: full existing colour at `crestY`, washed toward
 * `mist` by `amount` at `footY` and below.
 *
 * The reason every distance layer needs it: four flat cut-outs in the same
 * hue read as one brown mass. Give each one a dark crest standing against the
 * pale, misted base of the layer behind it and the same four cut-outs read as
 * five miles of air.
 */
function mistBelow(
  geo: THREE.BufferGeometry,
  mist: number,
  footY: number,
  crestY: number,
  amount: number,
): THREE.BufferGeometry {
  const pos = geo.attributes.position as THREE.BufferAttribute | undefined;
  if (!pos) return geo;
  const prev = geo.attributes.color as THREE.BufferAttribute | undefined;
  const m = new THREE.Color(mist).convertSRGBToLinear();
  const span = Math.abs(crestY - footY) > 1e-6 ? crestY - footY : 1;
  const cap = clamp01(amount);
  const arr = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const t = (1 - (Number.isFinite(y) ? clamp01((y - footY) / span) : 1)) * cap;
    const cr = prev ? prev.getX(i) : 1;
    const cg = prev ? prev.getY(i) : 1;
    const cb = prev ? prev.getZ(i) : 1;
    arr[i * 3] = lerp(cr, m.r, t);
    arr[i * 3 + 1] = lerp(cg, m.g, t);
    arr[i * 3 + 2] = lerp(cb, m.b, t);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

/**
 * A closed ring of ground seen edge-on — the whole trick behind the ridge and
 * the mesa. Two triangles per segment, one draw for the entire horizon, and
 * because it is a ring it reads identically at every yaw the home screen
 * turns through.
 */
function ridgeRing(
  segments: number,
  baseY: number,
  sample: (angle: number) => { r: number; y: number },
): THREE.BufferGeometry | null {
  const n = Math.max(8, Math.round(segments));
  const verts: number[] = [];
  let prev = sample(0);
  if (!Number.isFinite(prev.r) || !Number.isFinite(prev.y)) return null;
  for (let i = 1; i <= n; i++) {
    const a0 = ((i - 1) / n) * TAU;
    const a1 = (i / n) * TAU;
    const cur = i === n ? sample(0) : sample(a1);
    if (!Number.isFinite(cur.r) || !Number.isFinite(cur.y)) return null;
    const x0 = Math.sin(a0) * prev.r;
    const z0 = Math.cos(a0) * prev.r;
    const x1 = Math.sin(a1) * cur.r;
    const z1 = Math.cos(a1) * cur.r;
    verts.push(x0, baseY, z0, x1, baseY, z1, x1, cur.y, z1);
    verts.push(x0, baseY, z0, x1, cur.y, z1, x0, prev.y, z0);
    prev = cur;
  }
  if (!verts.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.computeVertexNormals();
  return geo;
}

/** Continuous around the ring by construction — noise sampled on the circle. */
function ringNoise(angle: number, freq: number, seed: number): number {
  return fbm2(Math.sin(angle) * freq + seed, Math.cos(angle) * freq - seed, 3);
}

function buildEnvironment(ctx: EnvBuildCtx): THREE.Object3D {
  const g = new THREE.Group();
  g.name = 'taco.patio';

  const top = Number.isFinite(ctx.tableTopY) ? ctx.tableTopY : -0.18;
  const floor = top - PATIO_DROP;
  const q = ctx.quality;
  const rng = ctx.rng;
  const rich = q !== 'low';
  const lo = q === 'low';

  const wood: Array<THREE.BufferGeometry | null> = [];
  const cloth: Array<THREE.BufferGeometry | null> = [];
  const clay: Array<THREE.BufferGeometry | null> = [];
  const food: Array<THREE.BufferGeometry | null> = [];
  const glass: Array<THREE.BufferGeometry | null> = [];
  const plant: Array<THREE.BufferGeometry | null> = [];
  const stucco: Array<THREE.BufferGeometry | null> = [];
  const far: Array<THREE.BufferGeometry | null> = [];
  const papel: Array<THREE.BufferGeometry | null> = [];
  const bulbs: Array<THREE.BufferGeometry | null> = [];
  const glow: Array<THREE.BufferGeometry | null> = [];
  // Low tier gets seven draws, and it buys them by dropping whole materials
  // rather than by folding one look into another. The flat-shaded plants ride
  // in the matte clay pass (at that tier they are eight pixels of cactus and
  // the facet break never reads), the papel joins the distance pass (same
  // matte double-sided vertex-coloured material, so it is a free merge), and
  // the bottle glass and the bulb spheres are simply not built — the bulbs are
  // carried by their glow sprites alone, which is the half of them that
  // matters. What does NOT happen any more is the salsa losing its gloss:
  // wet food two units from the lens is the last thing to economise on.
  const plantOut = lo ? clay : plant;
  const papelOut = lo ? far : papel;

  // --- the table ----------------------------------------------------------
  // The serape is what the plate actually sits on, so the wood is dropped by
  // exactly the cloth's thickness and the CLOTH's top face lands on tableTopY.
  const woodTop = top - RUNNER_T;
  wood.push(
    tableSlab(TABLE_HALF_W * 2, TABLE_HALF_D * 2, 0.42, {
      radius: 0.6,
      segments: envSeg(q, 3, 2, 2),
      top: woodTop,
    }),
  );
  wood.push(
    tableSlab(TABLE_HALF_W * 2 - 0.9, TABLE_HALF_D * 2 - 0.9, 0.42, {
      radius: 0.45,
      segments: envSeg(q, 3, 2, 2),
      top: woodTop - 0.4,
    }),
  );
  for (let i = 0; i < 4; i++) {
    const sx = i % 2 === 0 ? 1 : -1;
    const sz = i < 2 ? 1 : -1;
    const legH = woodTop - 0.8 - floor;
    if (legH > 0.1) {
      const leg = roundedBox(0.44, legH, 0.44, 0.09, 2);
      leg.translate((TABLE_HALF_W - 0.75) * sx, floor + legH / 2, (TABLE_HALF_D - 0.75) * sz);
      wood.push(leg);
    }
  }

  // --- serape runner ------------------------------------------------------
  {
    const len = 15.4;
    const wide = 2.45;
    const segX = envSeg(q, 40, 28, 18);
    const runner = new THREE.BoxGeometry(len, RUNNER_T, wide, segX, 1, envSeg(q, 6, 4, 3));
    const pos = runner.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      let y = pos.getY(i);
      const over = Math.abs(x) - (TABLE_HALF_W - 0.15);
      // the ends fall off the table and hang
      if (over > 0) y -= Math.pow(over / 1.5, 1.6) * 1.5;
      // a slack ripple, but only outside the plate's footprint
      const away = clamp01((Math.hypot(x, z) - 2.4) / 1.6);
      y -= Math.abs(fbm2(x * 0.9 + 3, z * 0.9, 2)) * 0.05 * away;
      pos.setXYZ(i, x, y, z);
    }
    pos.needsUpdate = true;
    runner.computeVertexNormals();
    runner.rotateY(0.38);
    runner.computeBoundingBox();
    const bb = runner.boundingBox;
    // Guarantee the cloth's highest point is exactly the plane the plate is on.
    if (bb) runner.translate(0, top - bb.max.y, 0);
    cloth.push(runner);
  }

  // --- props on the table -------------------------------------------------
  // The frame is only ~22 degrees wide and the tower itself covers the middle
  // 61% of it, so at four units out a prop is only ON SCREEN during a run
  // between about 0.42 and 0.72 radians either side of BACK_ARC. That window
  // is 17 degrees wide and it is the entire near-field stage; everything
  // outside it is placed for the home screen's turntable instead.
  const propSeg = envSeg(q, 16, 13, 9);

  /** Terracotta salsa bowl with a pool of pico in it. */
  const salsaBowl = (arc: number, r: number): void => {
    const a = BACK_ARC + arc;
    const x = Math.sin(a) * r;
    const z = Math.cos(a) * r;
    const bowl = lathe(
      [
        [0, 0],
        [0.17, 0],
        [0.3, 0.06],
        [0.4, 0.2],
        [0.44, 0.34],
        [0.45, 0.38],
        [0.4, 0.38],
        [0.39, 0.34],
        [0.35, 0.2],
        [0.26, 0.08],
        [0, 0.06],
      ],
      propSeg,
    );
    if (bowl) {
      bowl.translate(x, top, z);
      clay.push(tintGeometry(bowl, CLAY_TINTS[0]));
    }
    const salsa = lathe(
      [
        [0, 0],
        [0.34, 0],
        [0.36, 0.025],
        [0.3, 0.035],
        [0, 0.045],
      ],
      propSeg,
    );
    if (salsa) {
      salsa.translate(x, top + 0.25, z);
      food.push(tintGeometry(salsa, 0xb3271b));
    }
    if (rich) {
      for (let i = 0; i < 7; i++) {
        const d = new THREE.BoxGeometry(0.05, 0.04, 0.05);
        d.rotateY(rng.range(0, TAU));
        d.translate(x + rng.signed() * 0.26, top + 0.28, z + rng.signed() * 0.26);
        food.push(tintGeometry(d, i % 3 === 0 ? 0x4cb944 : i % 3 === 1 ? 0xf2f0d8 : 0xd8382a));
      }
    }
  };

  /** A shallow dish with lime wedges, cut faces up. */
  const limeDish = (arc: number, r: number): void => {
    const a = BACK_ARC + arc;
    const x = Math.sin(a) * r;
    const z = Math.cos(a) * r;
    const dish = lathe(
      [
        [0, 0],
        [0.2, 0],
        [0.32, 0.04],
        [0.4, 0.12],
        [0.42, 0.15],
        [0.37, 0.15],
        [0.35, 0.12],
        [0.28, 0.06],
        [0, 0.04],
      ],
      propSeg,
    );
    if (dish) {
      dish.translate(x, top, z);
      clay.push(tintGeometry(dish, 0xd7c3a5));
    }
    const wedges = lo ? 1 : 2;
    for (let w = 0; w < wedges; w++) {
      const lr = 0.16;
      const lt = 0.09;
      const parts: Array<THREE.BufferGeometry | null> = [];
      const rind = new THREE.CylinderGeometry(lr, lr, lt, envSeg(q, 14, 11, 8), 1, true, 0, Math.PI);
      parts.push(tintGeometry(rind, 0x4f8f2a));
      const flesh = new THREE.CylinderGeometry(
        lr * 0.86,
        lr * 0.86,
        lt * 0.99,
        envSeg(q, 14, 11, 8),
        1,
        false,
        0,
        Math.PI,
      );
      parts.push(tintGeometry(flesh, 0xd8e88a));
      for (let sIdx = 0; sIdx < 4; sIdx++) {
        const ang = ((sIdx + 0.5) / 4) * Math.PI;
        const pith = new THREE.BoxGeometry(lr * 0.82, lt * 1.01, lr * 0.05);
        pith.translate(lr * 0.41, 0, 0);
        pith.rotateY(-ang);
        parts.push(tintGeometry(pith, 0xf4f6dd));
      }
      const wedge = mergeEnv(parts);
      if (wedge) {
        wedge.rotateZ(0.1);
        wedge.rotateY(a + w * 2.1 + 0.6);
        wedge.translate(x + rng.signed() * 0.12, top + 0.13, z + rng.signed() * 0.12);
        food.push(wedge);
      }
    }
  };

  /** A cold bottle, beaded with condensation. */
  const coldBottle = (arc: number, r: number): void => {
    const a = BACK_ARC + arc;
    const x = Math.sin(a) * r;
    const z = Math.cos(a) * r;
    const h = 1.05;
    const body = lathe(
      [
        [0, 0],
        [0.17, 0],
        [0.185, h * 0.03],
        [0.185, h * 0.48],
        [0.175, h * 0.56],
        [0.11, h * 0.68],
        [0.08, h * 0.78],
        [0.08, h * 0.95],
        [0.095, h * 0.97],
        [0.095, h],
        [0, h],
      ],
      propSeg,
    );
    if (body) {
      body.translate(x, top, z);
      glass.push(body);
    }
    const cap = new THREE.CylinderGeometry(0.1, 0.1, 0.07, envSeg(q, 12, 10, 8), 1);
    cap.translate(x, top + h + 0.02, z);
    clay.push(tintGeometry(cap, 0xe0b23a));
    if (q === 'high') {
      for (let i = 0; i < 14; i++) {
        const ba = rng.range(0, TAU);
        const bead = new THREE.SphereGeometry(rng.range(0.012, 0.024), 5, 4);
        bead.translate(
          x + Math.sin(ba) * 0.19,
          top + rng.range(0.05, h * 0.5),
          z + Math.cos(ba) * 0.19,
        );
        glass.push(bead);
      }
    }
  };

  /** A fat clay jug with a strap handle. */
  const clayJug = (arc: number, r: number): void => {
    const a = BACK_ARC + arc;
    const x = Math.sin(a) * r;
    const z = Math.cos(a) * r;
    const body = lathe(
      [
        [0, 0],
        [0.2, 0],
        [0.31, 0.09],
        [0.38, 0.28],
        [0.36, 0.48],
        [0.25, 0.6],
        [0.2, 0.68],
        [0.23, 0.76],
        [0.19, 0.79],
        [0, 0.79],
      ],
      propSeg,
    );
    if (body) {
      body.translate(x, top, z);
      clay.push(tintGeometry(body, CLAY_TINTS[1]));
    }
    const handle = new THREE.TorusGeometry(0.17, 0.035, 4, envSeg(q, 12, 9, 6), Math.PI * 1.15);
    handle.rotateZ(Math.PI * 0.5);
    handle.rotateY(-a);
    handle.translate(x + Math.sin(a + Math.PI / 2) * 0.3, top + 0.56, z + Math.cos(a + Math.PI / 2) * 0.3);
    clay.push(tintGeometry(handle, CLAY_TINTS[1]));
  };

  /**
   * The hurricane lamp: the one light source close enough to the plate to put
   * warmth on the food. Everything else warm in this scene is eleven units
   * away and can only light the wall.
   */
  const hurricaneLamp = (arc: number, r: number): void => {
    const a = BACK_ARC + arc;
    const x = Math.sin(a) * r;
    const z = Math.cos(a) * r;
    const base = lathe(
      [
        [0, 0],
        [0.24, 0],
        [0.26, 0.03],
        [0.22, 0.07],
        [0.19, 0.09],
        [0.2, 0.13],
        [0, 0.13],
      ],
      propSeg,
    );
    if (base) {
      base.translate(x, top, z);
      clay.push(tintGeometry(base, 0x4a3226));
    }
    // the chimney: a waisted glass shade, open at the top
    const shade = lathe(
      [
        [0.2, 0],
        [0.235, 0.12],
        [0.235, 0.4],
        [0.19, 0.56],
        [0.185, 0.7],
        [0.2, 0.78],
      ],
      propSeg,
    );
    if (shade) {
      shade.translate(x, top + 0.11, z);
      glass.push(shade);
    }
    const collar = new THREE.TorusGeometry(0.205, 0.022, 4, envSeg(q, 12, 10, 7));
    collar.rotateX(Math.PI / 2);
    collar.translate(x, top + 0.9, z);
    clay.push(tintGeometry(collar, 0x4a3226));
    // the flame, and the pool of light it puts on the cloth
    const flame = new THREE.SphereGeometry(0.075, envSeg(q, 8, 7, 6), envSeg(q, 7, 6, 5));
    flame.scale(0.8, 1.9, 0.8);
    flame.translate(x, top + 0.36, z);
    bulbs.push(flame);
    glow.push(facingQuad(x, top + 0.38, z, 1.5, 1.5));
    const pool = new THREE.PlaneGeometry(3.1, 3.1);
    pool.rotateX(-Math.PI / 2);
    pool.translate(x, top + 0.008, z);
    glow.push(pool);
  };

  hurricaneLamp(-0.55, 4.5);
  salsaBowl(0.47, 4.0);
  if (rich) coldBottle(0.73, 4.95);
  if (rich) limeDish(-1.25, 3.9);
  if (rich) clayJug(2.1, 4.3);
  if (!lo) salsaBowl(2.95, 3.7);
  if (q === 'high') limeDish(3.05, 4.5);
  if (q === 'high') clayJug(-2.35, 4.6);
  if (lo) coldBottle(0.73, 4.95);

  // Limes and a chilli rolled across the near edge of the table. The near arc
  // lands low in the frame, which is otherwise bare cloth and paint.
  {
    const loose = lo ? 3 : q === 'medium' ? 5 : 7;
    for (let i = 0; i < loose; i++) {
      const a = BACK_ARC + Math.PI + rng.signed() * 0.6;
      const r = rng.range(3.4, 4.8);
      const x = Math.sin(a) * r;
      const z = Math.cos(a) * r;
      if (i % 3 === 2) {
        const chilli = new THREE.CylinderGeometry(0.028, 0.075, 0.46, 6, 1);
        chilli.rotateZ(Math.PI / 2);
        chilli.rotateY(rng.range(0, TAU));
        chilli.translate(x, top + 0.06, z);
        food.push(tintGeometry(chilli, rng.bool(0.5) ? 0xd8382a : 0x3f8f2f));
      } else {
        const lime = new THREE.SphereGeometry(0.15, envSeg(q, 10, 8, 6), envSeg(q, 8, 6, 5));
        lime.scale(1, 0.86, 1.18);
        lime.rotateY(rng.range(0, TAU));
        lime.translate(x, top + 0.12, z);
        food.push(tintGeometry(lime, rng.bool(0.5) ? 0x62a52c : 0x7bb534));
      }
    }
  }

  // --- terracotta pots on the patio floor ---------------------------------
  // The first two land either side of the tower in the play view; at ten units
  // out the on-screen window is only 0.25-0.45 rad off BACK_ARC, so they have
  // to be aimed rather than scattered.
  const potArcs = lo
    ? [-0.33, 0.34, 2.4]
    : q === 'medium'
      ? [-0.33, 0.34, 1.5, -1.6, 2.9]
      : [-0.33, 0.34, 0.95, -1.0, 1.9, -2.0, 3.0];
  const potSlots = potArcs.map((arc) => {
    const yaw = BACK_ARC + arc + rng.signed() * 0.08;
    const radius = rng.range(9.4, 11.4);
    return { x: Math.sin(yaw) * radius, z: Math.cos(yaw) * radius, radius, yaw };
  });
  for (let i = 0; i < potSlots.length; i++) {
    const slot = potSlots[i];
    const scale = rng.range(1.5, 2.1);
    const pot = lathe(
      [
        [0, 0],
        [0.2, 0],
        [0.26, 0.06],
        [0.3, 0.42],
        [0.34, 0.5],
        [0.35, 0.56],
        [0.3, 0.56],
        [0.29, 0.5],
        [0.25, 0.42],
        [0.21, 0.06],
        [0, 0.05],
      ],
      envSeg(q, 12, 10, 7),
    );
    if (pot) {
      pot.scale(scale, scale, scale);
      pot.translate(slot.x, floor, slot.z);
      clay.push(tintGeometry(pot, CLAY_TINTS[i % CLAY_TINTS.length]));
    }
    const potTop = floor + 0.5 * scale;

    if (i % 3 === 2) {
      // prickly pear: a stack of flat paddles, unmistakable in silhouette
      const pads = lo ? 2 : 4;
      let px = slot.x;
      let py = potTop + 0.35;
      for (let p = 0; p < pads; p++) {
        const pr = 0.62 - p * 0.09;
        const pad = new THREE.SphereGeometry(pr, envSeg(q, 9, 7, 6), envSeg(q, 7, 6, 4));
        pad.scale(1, 1.25, 0.3);
        pad.rotateY(slot.yaw + 0.4);
        pad.rotateX(rng.signed() * 0.2);
        pad.rotateZ(rng.signed() * 0.55);
        pad.translate(px, py, slot.z);
        plantOut.push(tintGeometry(pad, p % 2 === 0 ? 0x4f8f3a : 0x5da046));
        px += rng.signed() * 0.35;
        py += pr * 1.5;
      }
    } else {
      // agave: a rosette of stiff spears
      const spears = lo ? 6 : q === 'medium' ? 8 : 11;
      for (let sIdx = 0; sIdx < spears; sIdx++) {
        const len = rng.range(1.2, 2.0);
        const spear = new THREE.CylinderGeometry(0.012, 0.11, len, 4, 1);
        spear.translate(0, len / 2, 0);
        spear.rotateZ(rng.range(0.25, 0.95));
        spear.rotateY((sIdx / spears) * TAU + rng.signed() * 0.2);
        spear.translate(slot.x, potTop - 0.1, slot.z);
        plantOut.push(tintGeometry(spear, sIdx % 3 === 0 ? 0x6fae5c : 0x53924a));
      }
    }
  }

  // --- the wall's lamps, built first so the wall can be lit by them --------
  const wallLow = floor - 3.5;
  const wallHigh = top + 1.15;
  const lamps: THREE.Vector3[] = [];
  {
    const hooks = lo ? 14 : q === 'medium' ? 18 : 24;
    for (let i = 0; i < hooks; i++) {
      const a0 = (i / hooks) * TAU;
      const a1 = ((i + 1) / hooks) * TAU;
      const hookY = wallHigh - 0.34;
      const pA = new THREE.Vector3(Math.sin(a0) * WALL_LAMP_R, hookY, Math.cos(a0) * WALL_LAMP_R);
      const pB = new THREE.Vector3(Math.sin(a1) * WALL_LAMP_R, hookY, Math.cos(a1) * WALL_LAMP_R);
      const path = catenary(pA, pB, 0.3, lo ? 4 : 6);
      const cord = ribbon(path, 0.016, { tubular: lo ? 5 : 8, radial: 3 });
      if (cord) papelOut.push(tintGeometry(cord, 0x3d2a20));
      const p = path[Math.floor(path.length / 2)];
      lamps.push(p.clone());
      if (!lo) {
        const bulb = new THREE.SphereGeometry(0.105, envSeg(q, 8, 7, 5), envSeg(q, 6, 5, 4));
        bulb.scale(1, 1.3, 1);
        bulb.translate(p.x, p.y - 0.06, p.z);
        bulbs.push(bulb);
      }
      glow.push(facingQuad(p.x * 0.985, p.y - 0.06, p.z * 0.985, 1.15, 1.15));
    }
  }

  // --- stucco wall --------------------------------------------------------
  // Broken top line, a real coping course, piers standing proud of the face,
  // and every bit of its colour computed rather than tinted. See shadeAdobe.
  const wallSeg = envSeg(q, 56, 40, 28);
  {
    const wall = new THREE.CylinderGeometry(
      WALL_R,
      WALL_R,
      wallHigh - wallLow,
      wallSeg,
      envSeg(q, 5, 4, 3),
      true,
    );
    wall.translate(0, (wallLow + wallHigh) * 0.5, 0);
    stucco.push(shadeAdobe(wall, { floorY: floor - 0.4, crestY: wallHigh, lamps, lampGain: 0.62 }));

    // Piers: eight buttresses standing 0.24 proud of the face. They are what
    // give the wall a shadow of its own from the key, which is the difference
    // between a wall and a backdrop.
    const piers = lo ? 6 : 8;
    for (let i = 0; i < piers; i++) {
      const a = BACK_ARC + 0.4 + (i / piers) * TAU;
      const h = wallHigh + 0.1 - (floor - 0.6);
      const pier = new THREE.BoxGeometry(0.66, h, 0.44);
      pier.rotateY(a);
      pier.translate(
        Math.sin(a) * (WALL_R - 0.2),
        floor - 0.6 + h / 2,
        Math.cos(a) * (WALL_R - 0.2),
      );
      stucco.push(
        shadeAdobe(pier, {
          floorY: floor - 0.4,
          crestY: wallHigh,
          lamps,
          lampGain: 0.5,
          coping: false,
        }),
      );
    }

    // Coping: individual blocks, so the top line staggers instead of ruling a
    // perfect circle across the sunset. Every fourth one is a taller cap.
    const blocks = lo ? 22 : q === 'medium' ? 30 : 40;
    for (let i = 0; i < blocks; i++) {
      const a = (i / blocks) * TAU;
      const wide = ((TAU * (WALL_R + 0.16)) / blocks) * 0.94;
      const tall = 0.2 + (i % 4 === 0 ? 0.14 : 0) + rng.range(0, 0.07);
      const block = new THREE.BoxGeometry(wide, tall, 0.62);
      block.rotateY(a);
      block.translate(Math.sin(a) * (WALL_R + 0.02), wallHigh + tall * 0.5 - 0.06, Math.cos(a) * (WALL_R + 0.02));
      stucco.push(
        shadeAdobe(block, {
          floorY: wallHigh - 1.6,
          crestY: wallHigh + 0.3,
          lamps,
          lampGain: 0.34,
          coping: false,
        }),
      );
    }
  }

  // --- the distance: four layers of silhouette ----------------------------
  // Near to far, each one lower than the last so it clears the frame top, and
  // each one hazed harder toward the colour of the sky it sits against.
  {
    // The ground the town stands on. It is tucked just under the line the eye
    // grazes over the coping, so it is invisible for the first fifteen layers
    // and only appears once the camera has climbed far enough to look over the
    // wall properly — at which point the alternative is roofs floating on air.
    const deck = new THREE.RingGeometry(WALL_R + 0.4, 34, envSeg(q, 48, 36, 24), 1);
    deck.rotateX(-Math.PI / 2);
    deck.translate(0, top - 1.7, 0);
    far.push(hazeByRadius(tintGeometry(deck, 0x8f5a4e), DUSK_HAZE, 14, 33, 0.5, 1.05));
  }

  {
    /** Rooftops just past the wall — flat roofs, parapets, a water tank. */
    const roofParts: Array<THREE.BufferGeometry | null> = [];
    const roofs = lo ? 30 : q === 'medium' ? 46 : 70;
    for (let i = 0; i < roofs; i++) {
      const a = (i / roofs) * TAU + rng.signed() * 0.06;
      const r = ROOF_R + rng.range(-2.2, 2.4);
      const x = Math.sin(a) * r;
      const z = Math.cos(a) * r;
      const roofY = top + rng.range(0.75, ROOF_TOP);
      const w = rng.range(0.85, 1.55);
      const d = rng.range(0.75, 1.35);
      const body = new THREE.BoxGeometry(w, roofY - (top - 1.78), d);
      body.rotateY(a + rng.signed() * 0.25);
      body.translate(x, (roofY + top - 1.78) * 0.5, z);
      // sunward faces warm, the rest fall away into the violet
      const face = clamp01(-Math.cos(a - SUN_AZ));
      roofParts.push(tintGeometry(body, face > 0.35 ? 0x9e5341 : 0x6b3a40));
      if (i % 3 === 0) {
        // a pitched tile roof: a four-sided cone, squashed onto the footprint
        const pitch = new THREE.CylinderGeometry(0.02, Math.max(w, d) * 0.78, 0.44, 4, 1);
        pitch.rotateY(a + Math.PI / 4);
        pitch.scale(1, 1, (d / Math.max(w, 0.01)) * 0.9 + 0.1);
        pitch.translate(x, roofY + 0.2, z);
        roofParts.push(tintGeometry(pitch, 0x9c4a3c));
      } else {
        const parapet = new THREE.BoxGeometry(w * 1.06, 0.22, d * 1.06);
        parapet.rotateY(a + rng.signed() * 0.25);
        parapet.translate(x, roofY + 0.06, z);
        roofParts.push(tintGeometry(parapet, 0xc07a58));
      }
      if (!lo && i % 4 === 1) {
        // a roof water tank on stilts, the shape that says "town" fastest
        const tankH = Math.min(0.5, top + ROOF_TOP - roofY - 0.24);
        if (tankH > 0.12) {
          const tank = new THREE.CylinderGeometry(0.36, 0.36, tankH, envSeg(q, 9, 8, 6), 1);
          tank.translate(x + rng.signed() * 0.6, roofY + 0.26 + tankH * 0.5, z + rng.signed() * 0.6);
          roofParts.push(tintGeometry(tank, 0x4d3040));
        }
      }
    }
    const roofGeo = mergeEnv(roofParts);
    if (roofGeo) {
      mistBelow(roofGeo, 0xdba178, top + ROOF_TOP - 2.6, top + ROOF_TOP, 0.5);
      far.push(hazeByRadius(roofGeo, DUSK_HAZE, 14, 21, 0.26, 1.0));
    }
  }

  {
    const town: Array<THREE.BufferGeometry | null> = [];
    /** The church: the landmark, aimed at the on-screen window during play. */
    const church = (arc: number, scale: number): void => {
      const a = BACK_ARC + arc;
      const r = TOWN_R + rng.range(-1, 1);
      const x = Math.sin(a) * r;
      const z = Math.cos(a) * r;
      const tipY = top + TOWN_TOP;
      const shaftTop = tipY - 0.55 * scale;
      const shaft = new THREE.BoxGeometry(1.5 * scale, shaftTop - (top - 1.78), 1.5 * scale);
      shaft.rotateY(a);
      shaft.translate(x, (shaftTop + top - 1.78) * 0.5, z);
      town.push(tintGeometry(shaft, 0xb08063));
      const belfry = new THREE.BoxGeometry(1.72 * scale, 0.34 * scale, 1.72 * scale);
      belfry.rotateY(a);
      belfry.translate(x, shaftTop + 0.17 * scale, z);
      town.push(tintGeometry(belfry, 0x4a2c3c));
      const dome = new THREE.SphereGeometry(0.78 * scale, envSeg(q, 12, 9, 7), envSeg(q, 7, 5, 4), 0, TAU, 0, Math.PI * 0.5);
      dome.scale(1, 0.72, 1);
      dome.translate(x, shaftTop + 0.34 * scale, z);
      town.push(tintGeometry(dome, 0xc98a5e));
      const spike = new THREE.CylinderGeometry(0.012 * scale, 0.05 * scale, 0.34 * scale, 4, 1);
      spike.translate(x, tipY - 0.17 * scale, z);
      town.push(tintGeometry(spike, 0x3d2436));
      // nave, running off to one side and much lower
      const nave = new THREE.BoxGeometry(3.4 * scale, shaftTop - 0.8 - (top - 1.78), 2.2 * scale);
      nave.rotateY(a);
      nave.translate(
        x + Math.sin(a + Math.PI / 2) * 2.3 * scale,
        (shaftTop - 0.8 + top - 1.78) * 0.5,
        z + Math.cos(a + Math.PI / 2) * 2.3 * scale,
      );
      town.push(tintGeometry(nave, 0x91614f));
    };

    church(0.23, 0.78);
    if (!lo) church(-2.4, 0.66);

    const blocksN = lo ? 22 : q === 'medium' ? 34 : 50;
    for (let i = 0; i < blocksN; i++) {
      const a = (i / blocksN) * TAU + rng.signed() * 0.08;
      const r = TOWN_R + rng.range(-3.4, 3.6);
      const x = Math.sin(a) * r;
      const z = Math.cos(a) * r;
      const roofY = top + rng.range(0.15, TOWN_TOP - 0.34);
      const w = rng.range(1.3, 2.4);
      const d = rng.range(1.1, 2.0);
      const body = new THREE.BoxGeometry(w, roofY - (top - 1.78), d);
      body.rotateY(a + rng.signed() * 0.3);
      body.translate(x, (roofY + top - 1.78) * 0.5, z);
      const face = clamp01(-Math.cos(a - SUN_AZ));
      town.push(tintGeometry(body, face > 0.4 ? 0x8c5450 : 0x4e3048));
    }
    const townGeo = mergeEnv(town);
    if (townGeo) {
      // Mist in the streets: pale at the feet, dark at the roofline. This is
      // what separates one silhouette layer from the next — a dark crest read
      // against the pale base of the layer behind it — and it is the reason
      // four flat cut-outs read as distance rather than as one brown mass.
      mistBelow(townGeo, 0xe5b18c, top + TOWN_TOP - 2.8, top + TOWN_TOP, 0.6);
      far.push(hazeByRadius(townGeo, DUSK_HAZE, 19, 28, 0.4, 1.06));
    }
  }

  {
    /** Rolling hills, with saguaro on the crest where it catches the light. */
    const seed = 0x2c;
    const crestY = top + RIDGE_TOP;
    const ridgeAt = (a: number): number =>
      crestY - 1.35 + ringNoise(a, 1.9, seed) * 1.5 - Math.abs(ringNoise(a, 4.4, seed + 7)) * 0.55;
    const ring = ridgeRing(envSeg(q, 96, 72, 48), top - 12, (a) => ({
      r: RIDGE_R + ringNoise(a, 1.2, seed + 3) * 3.4,
      y: ridgeAt(a),
    }));
    const parts: Array<THREE.BufferGeometry | null> = [];
    if (ring) parts.push(tintGeometry(ring, 0x452c58));

    const cacti = lo ? 6 : q === 'medium' ? 10 : 15;
    for (let i = 0; i < cacti; i++) {
      const a = (i / cacti) * TAU + rng.signed() * 0.12;
      const rr = RIDGE_R + ringNoise(a, 1.2, seed + 3) * 3.4 - 0.6;
      const x = Math.sin(a) * rr;
      const z = Math.cos(a) * rr;
      const footY = ridgeAt(a) - 0.15;
      const tipY = Math.min(crestY, footY + rng.range(1.1, 2.0));
      if (tipY - footY < 0.5) continue;
      const trunk = new THREE.CylinderGeometry(0.16, 0.2, tipY - footY, 5, 1);
      trunk.translate(x, (tipY + footY) * 0.5, z);
      parts.push(tintGeometry(trunk, 0x4c3350));
      if (!lo) {
        for (let arm = 0; arm < 2; arm++) {
          const side = arm === 0 ? 1 : -1;
          const armH = rng.range(0.4, 0.75);
          const armY = footY + (tipY - footY) * rng.range(0.42, 0.62);
          const ox = Math.sin(a + Math.PI / 2) * 0.36 * side;
          const oz = Math.cos(a + Math.PI / 2) * 0.36 * side;
          const upper = new THREE.CylinderGeometry(0.12, 0.13, armH, 5, 1);
          upper.translate(x + ox, armY + armH * 0.5, z + oz);
          parts.push(tintGeometry(upper, 0x4c3350));
          const elbow = new THREE.BoxGeometry(0.74, 0.24, 0.24);
          elbow.rotateY(a);
          elbow.translate(x + ox * 0.5, armY, z + oz * 0.5);
          parts.push(tintGeometry(elbow, 0x4c3350));
        }
      }
    }
    const ridgeGeo = mergeEnv(parts);
    if (ridgeGeo) {
      mistBelow(ridgeGeo, 0xecc19e, crestY - 3.6, crestY, 0.68);
      far.push(hazeByRadius(ridgeGeo, DUSK_HAZE, 28, 43, 0.54, 1.14));
    }
  }

  {
    /**
     * The mesa. Clamping the noise from above is what makes the flat tops —
     * everywhere the hill wants to be taller than the cap it is sheared off
     * instead, which is the whole silhouette of a butte in one line.
     */
    const seed = 0x51;
    const cap = top + MESA_TOP;
    const ring = ridgeRing(envSeg(q, 84, 64, 44), top - 16, (a) => {
      const n = ringNoise(a, 1.35, seed);
      const raw = cap - 3.4 + (n + 0.55) * 4.6;
      return {
        r: MESA_R + ringNoise(a, 0.9, seed + 11) * 5.5,
        y: Math.min(cap, raw),
      };
    });
    if (ring) {
      tintGeometry(ring, 0x543a6e);
      mistBelow(ring, 0xf2ceac, cap - 4.6, cap, 0.74);
      far.push(hazeByRadius(ring, DUSK_HAZE, 40, 60, 0.66, 1.24));
    }
  }

  // --- papel picado and festoon lights ------------------------------------
  // Two rings at different radii and heights, with the chords offset, so from
  // any camera angle at least one line crosses the frame diagonally.
  const postAt = (a: number, r: number, h: number): THREE.Vector3 => {
    const x = Math.sin(a) * r;
    const z = Math.cos(a) * r;
    const post = new THREE.CylinderGeometry(0.055, 0.075, h, 5, 1);
    post.translate(x, wallHigh + h / 2, z);
    papelOut.push(tintGeometry(post, 0x5a3a2c));
    return new THREE.Vector3(x, wallHigh + h, z);
  };

  const papelLines = lo ? 3 : q === 'medium' ? 4 : 5;
  const papelStep = TAU / papelLines;
  for (let i = 0; i < papelLines; i++) {
    const a0 = BACK_ARC - papelStep * 0.5 + i * papelStep;
    const a1 = a0 + papelStep;
    const pA = postAt(a0, PAPEL_R, rng.range(1.5, 1.85));
    const pB = new THREE.Vector3(
      Math.sin(a1) * PAPEL_R,
      wallHigh + rng.range(1.5, 1.85),
      Math.cos(a1) * PAPEL_R,
    );
    const line = flagLine(pA, pB, rng, {
      colors: PAPEL_COLORS,
      cordColor: 0x6a4a38,
      sag: rng.range(0.75, 1.05),
      cordRadius: 0.022,
      flags: lo ? 13 : 22,
      flagWidth: 0.62,
      flagDrop: 0.72,
      shape: 'papel',
      twist: 0.22,
      segments: lo ? 10 : 16,
    });
    if (line) papelOut.push(line);
  }

  const festoonLines = lo ? 4 : 6;
  const festStep = TAU / festoonLines;
  for (let i = 0; i < festoonLines; i++) {
    const a0 = BACK_ARC + 0.5 + i * festStep;
    const a1 = a0 + festStep * 0.9;
    const yA = top + rng.range(3.0, 3.4);
    const yB = top + rng.range(3.0, 3.4);
    const pA = new THREE.Vector3(Math.sin(a0) * FESTOON_R, yA, Math.cos(a0) * FESTOON_R);
    const pB = new THREE.Vector3(Math.sin(a1) * FESTOON_R, yB, Math.cos(a1) * FESTOON_R);
    const path = catenary(pA, pB, rng.range(0.5, 0.75), lo ? 10 : 16);
    const cord = ribbon(path, 0.02, { tubular: lo ? 10 : 16, radial: 3 });
    if (cord) papelOut.push(tintGeometry(cord, 0x6a4a38));
    const perLine = lo ? 6 : 8;
    for (let b = 0; b < perLine; b++) {
      const t = (b + 0.5) / perLine;
      const p = path[Math.min(path.length - 1, Math.round(t * (path.length - 1)))];
      if (!lo) {
        const bulb = new THREE.SphereGeometry(0.15, envSeg(q, 8, 7, 5), envSeg(q, 6, 5, 4));
        bulb.scale(1, 1.28, 1);
        bulb.translate(p.x, p.y - 0.18, p.z);
        bulbs.push(bulb);
      }
      glow.push(facingQuad(p.x * 0.99, p.y - 0.18, p.z * 0.99, 1.3, 1.3));
      const collar = new THREE.CylinderGeometry(0.04, 0.055, 0.06, 5, 1);
      collar.translate(p.x, p.y - 0.05, p.z);
      papelOut.push(tintGeometry(collar, 0x3d2a20));
    }
  }

  // --- assemble: one mesh per material ------------------------------------
  const woodMat = ctx.materials.standard('taco.env.wood', {
    color: 0xffffff,
    map: ctx.materials.texture('taco.env.wood.albedo', paintPatioWood, {
      size: 256,
      repeat: [0.3, 0.3],
    }),
    roughness: 0.66,
    metalness: 0,
  });
  const clothMat = ctx.materials.standard('taco.env.serape', {
    color: 0xffffff,
    map: ctx.materials.texture('taco.env.serape.albedo', paintSerape, {
      size: 256,
      repeat: [7, 1],
    }),
    roughness: 0.94,
    metalness: 0,
  });
  const clayMat = ctx.materials.standard('taco.env.clay', {
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.92,
    metalness: 0,
  });
  const foodMat = ctx.materials.physical('taco.env.food', {
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.3,
    metalness: 0,
    clearcoat: 0.55,
    clearcoatRoughness: 0.18,
  });
  // The low tier zeroes transmission and falls back to opacity, so the bottle
  // glass has to carry its colour in the base tint.
  const glassMat = ctx.materials.physical('taco.env.glass', {
    color: 0x6fae8a,
    roughness: 0.08,
    metalness: 0,
    transmission: 0.9,
    thickness: 0.28,
    ior: 1.48,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
    side: THREE.DoubleSide,
  });
  const plantMat = ctx.materials.standard('taco.env.plant', {
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.74,
    metalness: 0,
    flatShading: true,
  });
  // No emissive. Every value on this wall is vertex colour, and the colour is
  // computed from the sunset bearing, the height and the lamps — see shadeAdobe.
  const stuccoMat = ctx.materials.standard('taco.env.stucco', {
    color: 0xffffff,
    vertexColors: true,
    map: ctx.materials.texture('taco.env.stucco.albedo', paintStucco, {
      size: 256,
      repeat: [11, 3],
    }),
    bumpMap: ctx.materials.dataTexture('taco.env.stucco.bump', paintStuccoBump, {
      size: 256,
      repeat: [11, 3],
    }),
    bumpScale: lo ? 0.35 : 0.8,
    roughness: 0.97,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const farMat = ctx.materials.standard('taco.env.far', {
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.98,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const papelMat = ctx.materials.standard('taco.env.papel', {
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.85,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const bulbMat = ctx.materials.standard('taco.env.bulb', {
    color: 0x2a1a0e,
    emissive: 0xffb35e,
    emissiveIntensity: 2.6,
    roughness: 0.35,
    metalness: 0,
  });
  // The halo. A quad wearing a radial alpha, hung on the same ring as the bulb
  // so it stays broadside to an orbiting camera — this is the part that makes
  // the bulbs read as sources rather than as dots, and it is also the pool the
  // hurricane lamp puts on the cloth.
  const glowMat = ctx.materials.standard('taco.env.glow', {
    color: 0x000000,
    emissive: 0xffb060,
    emissiveIntensity: 1.75,
    map: ctx.materials.texture('taco.env.glow.sprite', (c, s) => radialGlow(c, s, '#FFB25E', 0.1, 2.4), {
      size: 128,
      wrap: THREE.ClampToEdgeWrapping,
    }),
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    roughness: 1,
    metalness: 0,
    side: THREE.DoubleSide,
    toneMapped: true,
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

  add(wood, woodMat, false, true);
  add(cloth, clothMat, false, true);
  add(clay, clayMat, true, true);
  add(food, foodMat, true, false);
  add(glass, glassMat, false, false);
  add(plant, plantMat, false, false);
  add(stucco, stuccoMat, false, false);
  add(far, farMat, false, false);
  add(papel, papelMat, false, false);
  add(bulbs, bulbMat, false, false);
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
    // The one theme that is genuinely outdoors, and the sky is now most of
    // what the frame gains as a run climbs — see the environment's note on
    // where the open band actually is.
    sky: SKY_PRESETS.taco,
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
  hero: [0, 1, 5, 2, 3, 4],
  plate: buildPlate,
  environment: buildEnvironment,
  ambience: 'taco',
};
