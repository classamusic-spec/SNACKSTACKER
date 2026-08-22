/**
 * Sushi Tower — the dark, cinematic theme.
 *
 * Everything here is lit to be read against a near-black lacquer board: the
 * rim light does the silhouette work and the specular does the "fresh fish"
 * work. Salmon is the hero and gets the most expensive treatment in the file
 * (a painted fat-striation albedo, clearcoat and a little transmission).
 */
import * as THREE from 'three';
import type { EnvBuildCtx, FoodBuildCtx, FoodDef, ThemeDef } from '../api';
import type { QualityTier } from '../../core/types';
import { Rng } from '../../core/rng';
import { TAU, clamp } from '../../core/math';
import {
  fbm2,
  mergeAll,
  mesh,
  pillow,
  puck,
  roughen,
  roundedBox,
  droopSlab,
  tintGeometry,
} from '../kit';
import {
  areaRatio,
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
  softRound,
  softStroke,
  speckle,
  topSampler,
} from './shared-fresh';

// ---------------------------------------------------------------------------
// painted textures
// ---------------------------------------------------------------------------

/** Individual grain relief. The rice must never read as a smooth block. */
function paintRiceBump(c: CanvasRenderingContext2D, size: number): void {
  fillFlat(c, size, '#767676');
  const rng = new Rng(0x91ce);
  for (let i = 0; i < 760; i++) {
    const len = size * rng.range(0.012, 0.026);
    const wid = size * rng.range(0.005, 0.010);
    c.save();
    c.translate(rng.next() * size, rng.next() * size);
    c.rotate(rng.range(0, TAU));
    const g = c.createLinearGradient(0, -wid, 0, wid);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.beginPath();
    c.ellipse(0, 0, len, wid, 0, 0, TAU);
    c.fill();
    c.restore();
  }
  noiseWash(c, size, 3, 0.3, 4);
}

/**
 * The hero texture: salmon flesh with 5 soft cream fat striations running
 * diagonally, over a fine muscle grain. Painted rather than modelled because
 * marbling is a colour phenomenon, not a shape one.
 */
function paintSalmon(c: CanvasRenderingContext2D, size: number): void {
  fillGradient(c, size, [
    [0, '#FF8E6B'],
    [0.42, '#FF7A55'],
    [0.78, '#F26F4C'],
    [1, '#E76244'],
  ]);

  const rng = new Rng(0x5a1);
  // fine muscle grain, running roughly with the fillet
  for (let i = 0; i < 150; i++) {
    const x = rng.next() * size;
    const y = rng.next() * size;
    softStroke(
      c,
      [
        [x - size * 0.18, y - size * 0.06],
        [x, y],
        [x + size * 0.18, y + size * 0.06],
      ],
      size * 0.006,
      rng.bool(0.5) ? '#DF563A' : '#FFA184',
      0.45,
      3,
    );
  }

  // the unmistakable white fat lines
  const bands = 5;
  for (let i = 0; i < bands; i++) {
    const t = (i + 0.5) / bands;
    const y0 = t * size * 1.3 - size * 0.2;
    const wob = size * 0.045;
    const pts: Array<[number, number]> = [
      [-size * 0.14, y0 + rng.signed() * wob],
      [size * 0.26, y0 + size * 0.11 + rng.signed() * wob],
      [size * 0.63, y0 + size * 0.23 + rng.signed() * wob],
      [size * 1.14, y0 + size * 0.36 + rng.signed() * wob],
    ];
    softStroke(c, pts, size * rng.range(0.024, 0.046), '#FFE7D8', 1, 8);
    softStroke(c, pts, size * 0.009, '#FFF6EF', 0.55, 3);
  }

  noiseWash(c, size, 5, 0.13, 21, '#8E3520', '#FFD3C0');
}

/** Near-black green with the fibrous, slightly iridescent grain of dried nori. */
function paintNori(c: CanvasRenderingContext2D, size: number): void {
  fillFlat(c, size, '#1B2B1E');
  const rng = new Rng(0x0e1);
  for (let i = 0; i < 260; i++) {
    const y = rng.next() * size;
    const x = rng.next() * size;
    const len = size * rng.range(0.08, 0.36);
    softStroke(
      c,
      [
        [x, y],
        [x + len, y + rng.signed() * size * 0.012],
      ],
      size * rng.range(0.004, 0.010),
      rng.bool(0.35) ? '#33513A' : '#121E15',
      0.6,
      3,
    );
  }
  speckle(c, size, 220, ['#3E6248', '#26402C', '#0B120D'], 0.002, 0.006, 5, 0.7);
  noiseWash(c, size, 4, 0.22, 9, '#050806', '#4A6E52');
}

function paintNoriBump(c: CanvasRenderingContext2D, size: number): void {
  fillFlat(c, size, '#808080');
  const rng = new Rng(0x0e2);
  for (let i = 0; i < 340; i++) {
    const y = rng.next() * size;
    const x = rng.next() * size;
    softStroke(
      c,
      [
        [x, y],
        [x + size * rng.range(0.06, 0.3), y + rng.signed() * size * 0.01],
      ],
      size * 0.006,
      rng.bool(0.5) ? '#e8e8e8' : '#2a2a2a',
      0.5,
      3,
    );
  }
  noiseWash(c, size, 2, 0.45, 3);
}

/** Sweet omelette: warm yellow with faint fold shadows and grilled streaks. */
function paintTamago(c: CanvasRenderingContext2D, size: number): void {
  fillGradient(c, size, [
    [0, '#FFD65E'],
    [0.5, '#F5C542'],
    [1, '#E0AB2C'],
  ], false);
  const rng = new Rng(0x7a0);
  for (let i = 0; i < 6; i++) {
    const y = ((i + 0.5) / 6) * size;
    softStroke(
      c,
      [
        [0, y + rng.signed() * size * 0.02],
        [size * 0.5, y + rng.signed() * size * 0.02],
        [size, y + rng.signed() * size * 0.02],
      ],
      size * 0.018,
      '#C98A22',
      0.5,
      6,
    );
  }
  for (let i = 0; i < 10; i++) {
    const y = rng.next() * size;
    softStroke(
      c,
      [
        [rng.next() * size * 0.4, y],
        [size * rng.range(0.6, 1.05), y + rng.signed() * size * 0.05],
      ],
      size * rng.range(0.004, 0.012),
      '#96601A',
      0.45,
      4,
    );
  }
  speckle(c, size, 90, ['#FFF0B8', '#D9A32C'], 0.002, 0.007, 12, 0.5);
  noiseWash(c, size, 5, 0.12, 33, '#8A5F14', '#FFF2C4');
}

// ---------------------------------------------------------------------------
// materials — keyed by LOOK so all 60 layers share them
// ---------------------------------------------------------------------------

const riceMat = (ctx: FoodBuildCtx): THREE.Material =>
  ctx.materials.standard('sushi.rice', {
    color: 0xf7f3e8,
    roughness: 0.62,
    metalness: 0,
    bumpMap: ctx.materials.dataTexture('sushi.rice.bump', paintRiceBump, { size: 256 }),
    bumpScale: 0.02,
  });

const riceGrainMat = (ctx: FoodBuildCtx): THREE.Material =>
  ctx.materials.standard('sushi.rice.grain', {
    color: 0xfdfaf1,
    roughness: 0.55,
    metalness: 0,
  });

const salmonMat = (ctx: FoodBuildCtx): THREE.Material =>
  ctx.materials.physical('sushi.salmon', {
    // The painted albedo already carries this food's hue; three multiplies
    // color by map, so tinting here too would square it toward black.
    color: 0xffffff,
    map: ctx.materials.texture('sushi.salmon.albedo', paintSalmon, { size: 256 }),
    roughness: 0.32,
    metalness: 0,
    clearcoat: 0.5,
    clearcoatRoughness: 0.28,
    transmission: 0.15,
    thickness: 0.22,
    ior: 1.36,
    attenuationColor: 0xff5a34,
    attenuationDistance: 0.5,
    sheen: 0.25,
    sheenColor: 0xffd9c8,
    sheenRoughness: 0.5,
  });

const noriMat = (ctx: FoodBuildCtx): THREE.Material =>
  ctx.materials.standard('sushi.nori', {
    // The painted albedo already carries this food's hue; three multiplies
    // color by map, so tinting here too would square it toward black.
    color: 0xffffff,
    map: ctx.materials.texture('sushi.nori.albedo', paintNori, { size: 128 }),
    bumpMap: ctx.materials.dataTexture('sushi.nori.bump', paintNoriBump, { size: 128 }),
    bumpScale: 0.006,
    roughness: 0.85,
    metalness: 0,
    side: THREE.DoubleSide,
  });

const tamagoMat = (ctx: FoodBuildCtx): THREE.Material =>
  ctx.materials.standard('sushi.tamago', {
    // The painted albedo already carries this food's hue; three multiplies
    // color by map, so tinting here too would square it toward black.
    color: 0xffffff,
    map: ctx.materials.texture('sushi.tamago.albedo', paintTamago, { size: 128 }),
    roughness: 0.5,
    metalness: 0,
  });

const tamagoGrillMat = (ctx: FoodBuildCtx): THREE.Material =>
  ctx.materials.standard('sushi.tamago.grill', {
    color: 0xc9891f,
    roughness: 0.44,
    metalness: 0,
  });

const avocadoMat = (ctx: FoodBuildCtx): THREE.Material =>
  ctx.materials.physical('sushi.avocado', {
    color: 0x8cbf4d,
    roughness: 0.42,
    metalness: 0,
    clearcoat: 0.28,
    clearcoatRoughness: 0.5,
  });

const avocadoInnerMat = (ctx: FoodBuildCtx): THREE.Material =>
  ctx.materials.physical('sushi.avocado.inner', {
    color: 0xd6e79a,
    roughness: 0.38,
    metalness: 0,
    clearcoat: 0.3,
    clearcoatRoughness: 0.45,
  });

const tobikoMat = (ctx: FoodBuildCtx): THREE.Material =>
  ctx.materials.physical('sushi.tobiko', {
    color: 0xff8c3a,
    roughness: 0.08,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
    transmission: 0.5,
    thickness: 0.05,
    ior: 1.4,
    attenuationColor: 0xff6a12,
    attenuationDistance: 0.08,
  });

const tobikoBedMat = (ctx: FoodBuildCtx): THREE.Material =>
  ctx.materials.standard('sushi.tobiko.bed', {
    color: 0xc0521c,
    roughness: 0.35,
    metalness: 0,
  });

const cucumberMat = (ctx: FoodBuildCtx): THREE.Material =>
  ctx.materials.physical('sushi.cucumber', {
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.26,
    metalness: 0,
    clearcoat: 0.45,
    clearcoatRoughness: 0.2,
    transmission: 0.3,
    thickness: 0.09,
    ior: 1.34,
    attenuationColor: 0xbfe08a,
    attenuationDistance: 0.2,
  });

const wasabiMat = (ctx: FoodBuildCtx): THREE.Material =>
  ctx.materials.standard('sushi.wasabi', {
    color: 0x8fbf3f,
    roughness: 0.9,
    metalness: 0,
  });

const wasabiBedMat = (ctx: FoodBuildCtx): THREE.Material =>
  ctx.materials.standard('sushi.wasabi.bed', {
    color: 0xa4c95c,
    roughness: 0.95,
    metalness: 0,
  });

// ---------------------------------------------------------------------------
// 1 — pressed rice
// ---------------------------------------------------------------------------

function buildRice(ctx: FoodBuildCtx): THREE.Object3D {
  const w = safeW(ctx);
  const d = safeD(ctx);
  const h = safeH(ctx);
  const g = new THREE.Group();

  const bodyH = h * 0.9;
  const body = pillow(w, bodyH, d, {
    round: 0.34,
    segments: seg(ctx, 26, 18, 12),
    squash: 0.22,
  });
  roughen(body, Math.min(0.011, Math.min(w, d) * 0.02), 34, ctx.index * 2 + 5);
  const surface = topSampler(body, ctx.offcut ? 6 : 12);
  g.add(mesh(body, riceMat(ctx)));

  // The signature: individual grains sitting proud of the pressed block.
  const ps = propScale(ctx);
  const gr = 0.019 * ps;
  const grains = scatterOnSurface(
    propCount(ctx, 105, 4),
    w,
    d,
    surface,
    (_i, rng) => {
      const cap = new THREE.CapsuleGeometry(
        gr * rng.range(0.8, 1.15),
        gr * rng.range(2, 3.2),
        2,
        seg(ctx, 6, 5, 4),
      );
      cap.rotateZ(Math.PI / 2);
      return cap;
    },
    {
      seed: ctx.index * 13 + 3,
      margin: gr * 2.3,
      spacing: 0.02,
      randomTilt: 0.5,
      sink: gr * 0.6,
    },
  );
  if (grains) g.add(mesh(grains, riceGrainMat(ctx)));

  return finalize(g, ctx);
}

// ---------------------------------------------------------------------------
// 2 — salmon nigiri (hero)
// ---------------------------------------------------------------------------

function buildSalmon(ctx: FoodBuildCtx): THREE.Object3D {
  const w = safeW(ctx);
  const d = safeD(ctx);
  const h = safeH(ctx);
  const g = new THREE.Group();

  // rice bed
  const bedH = h * 0.52;
  const bed = pillow(w * 0.9, bedH, d * 0.9, {
    round: 0.42,
    segments: seg(ctx, 20, 14, 10),
    squash: 0.3,
  });
  roughen(bed, Math.min(0.009, Math.min(w, d) * 0.018), 32, ctx.index + 7);
  g.add(mesh(bed, riceMat(ctx)));

  // the fish, draped over the bed with the ends hanging down the sides
  const fishT = h * 0.3;
  const fish = droopSlab(w * 1.02, fishT, d, {
    droop: 0.5,
    segments: seg(ctx, 20, 14, 9),
    seed: ctx.index * 3 + 2,
    ripple: 0.35,
  });
  const fishMesh = mesh(fish, salmonMat(ctx));
  fishMesh.position.y = bedH * 0.72;
  g.add(fishMesh);

  // a nori strap across the middle on the roomier cuts
  if (!ctx.offcut && areaRatio(ctx) > 0.32 && ctx.rng.bool(0.45)) {
    const acrossX = longAxis(ctx) === 'x';
    const strap = sheet(
      acrossX ? w * 0.2 : w * 1.03,
      h * 0.05,
      acrossX ? d * 1.03 : d * 0.2,
      { arch: h * 0.05, segments: 8, seed: ctx.index + 4 },
    );
    const sm = mesh(strap, noriMat(ctx));
    sm.position.y = bedH * 0.72 + fishT * 0.9;
    g.add(sm);
  }

  return finalize(g, ctx);
}

// ---------------------------------------------------------------------------
// 3 — nori band
// ---------------------------------------------------------------------------

function buildNori(ctx: FoodBuildCtx): THREE.Object3D {
  const w = safeW(ctx);
  const d = safeD(ctx);
  const h = safeH(ctx);
  const g = new THREE.Group();

  // Paper-thin sheet: the layer gets its height from the arch and the curled
  // rim, never from sheet thickness — thick nori reads as green cardboard.
  const t = Math.min(h * 0.2, 0.05);
  const top = sheet(w, t, d, {
    arch: h * 0.85,
    wave: h * 0.14,
    waveFreq: 2.2,
    curlEdges: h * 0.14,
    seed: ctx.index * 3 + 1,
    segments: seg(ctx, 20, 14, 8),
  });
  g.add(mesh(top, noriMat(ctx)));

  // a second torn strip lying across it
  if (!ctx.offcut && areaRatio(ctx) > 0.18) {
    const acrossX = longAxis(ctx) === 'x';
    const strip = sheet(
      acrossX ? w * 0.42 : w * 0.94,
      t * 0.8,
      acrossX ? d * 0.94 : d * 0.42,
      {
        arch: h * 0.16,
        wave: h * 0.1,
        curlEdges: h * 0.1,
        seed: ctx.index * 5 + 9,
        segments: seg(ctx, 12, 9, 6),
      },
    );
    const sm = mesh(strip, noriMat(ctx));
    sm.position.set(acrossX ? ctx.rng.signed() * w * 0.12 : 0, h * 0.3, acrossX ? 0 : ctx.rng.signed() * d * 0.12);
    sm.rotation.y = ctx.rng.signed() * 0.14;
    g.add(sm);
  }

  return finalize(g, ctx);
}

// ---------------------------------------------------------------------------
// 4 — tamago
// ---------------------------------------------------------------------------

function buildTamago(ctx: FoodBuildCtx): THREE.Object3D {
  const w = safeW(ctx);
  const d = safeD(ctx);
  const h = safeH(ctx);
  const g = new THREE.Group();

  // Stacked folds: each fold is inset a hair so the seam reads in silhouette.
  const capH = h * 0.1;
  const folds = ctx.offcut ? 2 : 3;
  const foldH = (h - capH) / folds;
  const mat = tamagoMat(ctx);

  for (let i = 0; i < folds; i++) {
    const inset = 1 - i * 0.022;
    const fw = w * inset;
    const fd = d * inset;
    const slab = roundedBox(
      fw,
      foldH * 0.99,
      fd,
      safeRadius(Math.min(fw, fd) * 0.13, fw, fd, foldH),
      seg(ctx, 3, 2, 2),
    );
    const m = mesh(slab, mat);
    m.position.y = i * foldH;
    g.add(m);
  }

  // rounded crown + grilled skin on top
  const crownInset = 1 - folds * 0.022;
  const crown = pillow(w * crownInset, capH * 1.7, d * crownInset, {
    round: 0.3,
    segments: seg(ctx, 16, 12, 8),
    squash: 0.55,
  });
  const cm = mesh(crown, tamagoGrillMat(ctx));
  cm.position.y = folds * foldH - capH * 0.5;
  g.add(cm);

  return finalize(g, ctx);
}

// ---------------------------------------------------------------------------
// 5 — avocado fan
// ---------------------------------------------------------------------------

function buildAvocado(ctx: FoodBuildCtx): THREE.Object3D {
  const w = safeW(ctx);
  const d = safeD(ctx);
  const h = safeH(ctx);
  const g = new THREE.Group();

  // Fan along whichever axis the cut left longer, so a 2.4 x 0.2 sliver still
  // reads as overlapping slices rather than one lonely blob.
  const alongX = longAxis(ctx) === 'x';
  const L = alongX ? w : d;
  const S = alongX ? d : w;
  const maxShards = ctx.quality === 'low' ? 4 : 6;
  const n = clamp(Math.round(L / 0.48), 1, ctx.offcut ? 3 : maxShards);
  const step = L / n;
  const shardLen = step * (n === 1 ? 1.15 : 1.7);
  const shardThk = h * 0.46;
  const shardWid = S * 0.94;
  // Height of a lens of axes (shardLen, shardThk) tilted by t is
  // sqrt(L^2 sin^2 t + T^2 cos^2 t); solve it for the angle that exactly fills
  // the layer instead of guessing, or the fan ends up squat and finalize has
  // to stretch it.
  const den = shardLen * shardLen - shardThk * shardThk;
  const num = h * h - shardThk * shardThk;
  const sinT = den > 1e-6 && num > 0 ? Math.sqrt(clamp(num / den, 0, 1)) : 0.12;
  const angle = Math.asin(clamp(sinT, 0.05, 0.82));

  const bodies: THREE.BufferGeometry[] = [];
  const inners: THREE.BufferGeometry[] = [];

  for (let i = 0; i < n; i++) {
    const at = -L / 2 + step * (i + 0.5);
    const bw = alongX ? shardLen : shardWid;
    const bd = alongX ? shardWid : shardLen;
    const body = pillow(bw, shardThk, bd, {
      round: softRound(0.8, bw, bd),
      segments: seg(ctx, 18, 13, 9),
      squash: 0.55,
    });
    body.translate(0, -shardThk / 2, 0);
    if (alongX) body.rotateZ(angle);
    else body.rotateX(-angle);
    body.translate(alongX ? at : 0, h * 0.5, alongX ? 0 : at);
    bodies.push(body);

    if (!ctx.offcut) {
      const iw = alongX ? shardLen * 0.9 : shardWid * 0.34;
      const idp = alongX ? shardWid * 0.34 : shardLen * 0.9;
      const inner = pillow(iw, shardThk * 0.5, idp, {
        round: softRound(0.85, iw, idp),
        segments: seg(ctx, 12, 9, 6),
        squash: 0.6,
      });
      inner.translate(0, -shardThk * 0.25, 0);
      if (alongX) inner.rotateZ(angle);
      else inner.rotateX(-angle);
      inner.translate(
        alongX ? at : shardWid * 0.28,
        h * 0.5 + shardThk * 0.3,
        alongX ? shardWid * 0.28 : at,
      );
      inners.push(inner);
    }
  }

  const bodyGeo = mergeAll(bodies);
  if (bodyGeo) g.add(mesh(bodyGeo, avocadoMat(ctx)));
  const innerGeo = mergeAll(inners);
  if (innerGeo) g.add(mesh(innerGeo, avocadoInnerMat(ctx)));

  return finalize(g, ctx);
}

// ---------------------------------------------------------------------------
// 6 — tobiko
// ---------------------------------------------------------------------------

function buildTobiko(ctx: FoodBuildCtx): THREE.Object3D {
  const w = safeW(ctx);
  const d = safeD(ctx);
  const h = safeH(ctx);
  const g = new THREE.Group();

  const bed = puck(w * 0.98, h * 0.4, d * 0.98, {
    domed: 0.5,
    wobble: 0.07,
    radial: seg(ctx, 34, 24, 14),
    rings: 4,
    seed: ctx.index + 1,
  });
  const surface = topSampler(bed, ctx.offcut ? 6 : 10);
  g.add(mesh(bed, tobikoBedMat(ctx)));

  const ps = propScale(ctx);
  const r = 0.044 * ps;
  const rad = seg(ctx, 6, 5, 4);
  const ring = seg(ctx, 4, 4, 3);

  const lower = scatterOnSurface(
    propCount(ctx, 118, 5),
    w,
    d,
    surface,
    (_i, rng) => new THREE.SphereGeometry(r * rng.range(0.85, 1.15), rad, ring),
    { seed: ctx.index * 7 + 2, margin: r * 1.25, spacing: 0.028, sink: r * 0.45, randomYaw: false },
  );
  const upper = ctx.offcut
    ? null
    : scatterOnSurface(
        propCount(ctx, 46, 2),
        w * 0.88,
        d * 0.88,
        (x, z) => surface(x, z) + r * 0.95,
        (_i, rng) => new THREE.SphereGeometry(r * rng.range(0.8, 1.05), rad, ring),
        { seed: ctx.index * 7 + 31, margin: r * 1.3, spacing: 0.05, sink: r * 0.3, randomYaw: false },
      );

  const beads = mergeAll([lower, upper]);
  if (beads) g.add(mesh(beads, tobikoMat(ctx)));

  return finalize(g, ctx);
}

// ---------------------------------------------------------------------------
// 7 — cucumber
// ---------------------------------------------------------------------------

/** One slice: dark skin ring + translucent flesh + a few pale seeds. */
function cucumberSlice(radius: number, thick: number, ctx: FoodBuildCtx): THREE.BufferGeometry | null {
  const radial = seg(ctx, 16, 12, 8);
  const parts: THREE.BufferGeometry[] = [];

  const skin = new THREE.CylinderGeometry(radius, radius, thick, radial, 1, true);
  parts.push(tintGeometry(skin, 0x2f6b34));

  const flesh = new THREE.CylinderGeometry(radius * 0.9, radius * 0.9, thick * 0.98, radial, 1, false);
  parts.push(tintGeometry(flesh, 0xd8ecb2));

  if (!ctx.offcut && radius > 0.06) {
    for (let s = 0; s < 3; s++) {
      const a = (s / 3) * TAU + 0.4;
      const seed = new THREE.SphereGeometry(radius * 0.11, 6, 4);
      seed.scale(1, 0.5, 1.7);
      seed.rotateY(a);
      seed.translate(Math.cos(a) * radius * 0.26, thick * 0.5, Math.sin(a) * radius * 0.26);
      parts.push(tintGeometry(seed, 0xf3f6e2));
    }
  }

  const merged = mergeAll(parts);
  if (merged) merged.translate(0, thick / 2, 0);
  return merged;
}

function buildCucumber(ctx: FoodBuildCtx): THREE.Object3D {
  const w = safeW(ctx);
  const d = safeD(ctx);
  const h = safeH(ctx);
  const g = new THREE.Group();

  const base = sheet(w, h * 0.16, d, {
    arch: h * 0.08,
    wave: h * 0.05,
    seed: ctx.index + 2,
    segments: seg(ctx, 14, 10, 6),
  });
  const surface = topSampler(base, 8);
  g.add(mesh(base, cucumberMat(ctx)));

  const sliceR = clamp(Math.min(w, d) * 0.46, 0.03, 0.33);
  const sliceT = h * 0.6;
  const slices = scatterOnSurface(
    propCount(ctx, 9, 1),
    w,
    d,
    surface,
    (i) => cucumberSlice(sliceR * (0.86 + 0.28 * (((i * 37) % 7) / 7)), sliceT, ctx),
    {
      seed: ctx.index * 11 + 5,
      margin: sliceR * 1.04,
      spacing: 0.3,
      randomTilt: 0.1,
      sink: sliceT * 0.14,
    },
  );
  if (slices) g.add(mesh(slices, cucumberMat(ctx)));

  return finalize(g, ctx);
}

// ---------------------------------------------------------------------------
// 8 — wasabi dab
// ---------------------------------------------------------------------------

function buildWasabi(ctx: FoodBuildCtx): THREE.Object3D {
  const w = safeW(ctx);
  const d = safeD(ctx);
  const h = safeH(ctx);
  const g = new THREE.Group();

  // raked, grated bed
  const bedH = h * 0.34;
  const bed = sheet(w, bedH, d, {
    rake: h * 0.09,
    rakeFreq: 8 + (ctx.index % 3) * 3,
    wave: h * 0.04,
    arch: h * 0.06,
    seed: ctx.index * 4 + 6,
    segments: seg(ctx, 20, 14, 8),
  });
  const surface = topSampler(bed, 8);
  g.add(mesh(bed, wasabiBedMat(ctx)));

  // the dab itself
  const dabX = clamp(w * 0.34, 0.04, 0.6);
  const dabZ = clamp(d * 0.34, 0.04, 0.6);
  const dab = puck(dabX, h * 0.38, dabZ, {
    domed: 1.2,
    taper: 0.68,
    wobble: 0.08,
    square: 0.2,
    radial: seg(ctx, 26, 18, 12),
    rings: 5,
    seed: ctx.index + 3,
  });
  const dm = mesh(dab, wasabiMat(ctx));
  dm.position.y = bedH * 0.82;
  g.add(dm);

  // grated flecks around it
  const ps = propScale(ctx);
  const flecks = ctx.offcut
    ? null
    : scatterOnSurface(
        propCount(ctx, 34, 0),
        w,
        d,
        surface,
        (_i, rng) => {
          const f = new THREE.SphereGeometry(0.013 * ps * rng.range(0.7, 1.4), 5, 3);
          f.scale(1.6, 0.6, 1);
          return f;
        },
        { seed: ctx.index * 3 + 12, margin: 0.03 * ps, randomTilt: 0.4, sink: 0.004 },
      );
  if (flecks) g.add(mesh(flecks, wasabiMat(ctx)));

  return finalize(g, ctx);
}

// ---------------------------------------------------------------------------
// plate + scenery
// ---------------------------------------------------------------------------

/** Board slab + feet. Total drop below the tower. */
const PLATE_SLAB = 0.17;
const PLATE_FEET = 0.13;
const PLATE_T = PLATE_SLAB + PLATE_FEET;

function buildPlate(ctx: FoodBuildCtx): THREE.Object3D {
  const w = Math.max(ctx.width, 0.6);
  const d = Math.max(ctx.depth, 0.6);
  const g = new THREE.Group();

  const lacquer = ctx.materials.physical('sushi.lacquer', {
    color: 0x0b1114,
    roughness: 0.34,
    metalness: 0,
    clearcoat: 0.55,
    clearcoatRoughness: 0.22,
  });
  const sheen = ctx.materials.physical('sushi.lacquer.sheen', {
    color: 0x141c21,
    roughness: 0.16,
    metalness: 0,
    clearcoat: 0.9,
    clearcoatRoughness: 0.08,
  });

  // The board occupies y in [-PLATE_T, 0] so its TOP SURFACE IS EXACTLY y = 0
  // and the tower's first layer lands flush on it.
  // The lacquered field is recessed a hair below the polished inlay so the
  // board reads with a fine bevel around its edge.
  const board = roundedBox(w, PLATE_SLAB, d, safeRadius(Math.min(w, d) * 0.035, w, d, PLATE_SLAB), 3);
  board.translate(0, -PLATE_SLAB - 0.004, 0);
  g.add(mesh(board, lacquer));

  const inlayT = PLATE_SLAB * 0.34;
  const inlay = roundedBox(
    w * 0.955,
    inlayT,
    d * 0.955,
    safeRadius(Math.min(w, d) * 0.03, w, d, inlayT),
    2,
  );
  inlay.translate(0, -inlayT, 0);
  g.add(mesh(inlay, sheen));

  // geta feet
  const footW = w * 0.1;
  for (const sx of [-1, 1]) {
    const foot = roundedBox(
      footW,
      PLATE_FEET,
      d * 0.84,
      safeRadius(footW * 0.2, footW, d, PLATE_FEET),
      2,
    );
    foot.translate(sx * w * 0.3, -PLATE_T, 0);
    g.add(mesh(foot, lacquer));
  }

  return g;
}

// ===========================================================================
// environment — a hinoki counter in a lantern-lit garden
// ===========================================================================

/**
 * Layout contract, in priority order:
 *
 *  1. The counter top lands on `ctx.tableTopY` (a hair below it, so it can
 *     never punch through the plate and never z-fights the contact shadow).
 *  2. Nothing rises above that plane inside `SWEEP_HALF` of either axis —
 *     that is the corridor a sliding layer sweeps through — so the counter
 *     props all live out on the diagonals where a layer can never reach.
 *  3. The garden floor is `FLOOR_DROP` below the counter and dissolves into
 *     the sweep with a baked vertex alpha, so the backdrop still owns the top
 *     of frame and there is no hard horizon line.
 *
 * Everything is merged into eight vertex-coloured draws. A whole family of
 * props — stone lantern, basin, rocks, moss, the folded cloth — is one mesh.
 */

const ENV_SINK = 0.0025;
const COUNTER_W = 9.2;
const COUNTER_D = 4.7;
const COUNTER_T = 0.52;
const FLOOR_DROP = 3.1;
/** Half-width of the axis-aligned corridor a sliding layer sweeps through. */
const SWEEP_HALF = 1.45;

const envPick = <T>(q: QualityTier, low: T, med: T, high: T): T =>
  q === 'low' ? low : q === 'medium' ? med : high;

/**
 * Merge bucket. Each part carries its colour in vertex colours, so a dozen
 * differently-tinted props collapse into a single draw call.
 */
class EnvBucket {
  private readonly parts: THREE.BufferGeometry[] = [];

  add(geo: THREE.BufferGeometry | null, color: number): void {
    if (!geo) return;
    const pos = geo.getAttribute('position');
    if (!pos || pos.count < 3) {
      geo.dispose();
      return;
    }
    let g = geo;
    // mergeGeometries refuses a mix of indexed and non-indexed inputs, and the
    // kit hands back both kinds, so everything is flattened on the way in.
    if (g.index) {
      const flat = g.toNonIndexed();
      g.dispose();
      g = flat;
    }
    tintGeometry(g, color);
    this.parts.push(g);
  }

  build(mat: THREE.Material, cast: boolean, receive: boolean): THREE.Mesh | null {
    const merged = mergeAll(this.parts);
    this.parts.length = 0;
    if (!merged) return null;
    const m = new THREE.Mesh(merged, mat);
    m.castShadow = cast;
    m.receiveShadow = receive;
    return m;
  }
}

/** Box with its base on y = 0. */
function envBox(w: number, h: number, d: number): THREE.BufferGeometry {
  const hh = Math.max(h, 1e-3);
  const g = new THREE.BoxGeometry(Math.max(w, 1e-3), hh, Math.max(d, 1e-3));
  g.translate(0, hh / 2, 0);
  return g;
}

/** Cylinder / cone with its base on y = 0. */
function envCyl(rTop: number, rBot: number, h: number, sides: number): THREE.BufferGeometry {
  const hh = Math.max(h, 1e-3);
  const g = new THREE.CylinderGeometry(
    Math.max(rTop, 0),
    Math.max(rBot, 1e-4),
    hh,
    Math.max(3, Math.round(sides)),
    1,
  );
  g.translate(0, hh / 2, 0);
  return g;
}

/** Faceted blob, centred on its own origin. */
function envBlob(r: number, detail: number): THREE.BufferGeometry {
  return new THREE.IcosahedronGeometry(Math.max(r, 1e-3), Math.max(0, detail));
}

/** Author a prop at the origin with its base on y = 0, then post it here. */
function at(g: THREE.BufferGeometry, x: number, y: number, z: number, yaw = 0): THREE.BufferGeometry {
  if (yaw) g.rotateY(yaw);
  g.translate(x, y, z);
  return g;
}

/**
 * A ring-tessellated ground disc with per-vertex RGBA, so the far rim can fade
 * to nothing instead of ending on a hard edge. Planar UVs in world units keep
 * the texture tiling even across every ring.
 */
function envGround(
  radii: readonly number[],
  segments: number,
  uvScale: number,
  shade: (radius: number) => readonly [number, number, number, number],
): THREE.BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const push = (x: number, z: number, r: number): void => {
    pos.push(x, 0, z);
    nrm.push(0, 1, 0);
    uv.push(x * uvScale, z * uvScale);
    const s = shade(r);
    col.push(s[0], s[1], s[2], s[3]);
  };

  push(0, 0, 0);
  for (let ri = 0; ri < radii.length; ri++) {
    const r = radii[ri];
    for (let s = 0; s < segments; s++) {
      const a = (s / segments) * TAU;
      push(Math.cos(a) * r, Math.sin(a) * r, r);
    }
  }
  for (let s = 0; s < segments; s++) idx.push(0, 1 + ((s + 1) % segments), 1 + s);
  for (let ri = 0; ri < radii.length - 1; ri++) {
    const a0 = 1 + ri * segments;
    const b0 = a0 + segments;
    for (let s = 0; s < segments; s++) {
      const s1 = (s + 1) % segments;
      idx.push(a0 + s, a0 + s1, b0 + s);
      idx.push(a0 + s1, b0 + s1, b0 + s);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  g.setIndex(idx);
  return g;
}

// --- painted surfaces ------------------------------------------------------

/** Hinoki: pale blond, dead-straight, very fine. Never a flat tan. */
function paintHinoki(c: CanvasRenderingContext2D, size: number): void {
  const g = c.createLinearGradient(0, 0, 0, size);
  g.addColorStop(0, '#F2E7CE');
  g.addColorStop(0.5, '#EADEC1');
  g.addColorStop(1, '#F0E4C8');
  c.fillStyle = g;
  c.fillRect(0, 0, size, size);

  const rng = new Rng(0x51ce);
  for (let i = 0; i < 240; i++) {
    const y = rng.next() * size;
    const dark = rng.bool(0.62);
    c.strokeStyle = dark
      ? `rgba(190,161,110,${rng.range(0.06, 0.2).toFixed(3)})`
      : `rgba(255,250,232,${rng.range(0.08, 0.26).toFixed(3)})`;
    c.lineWidth = size * rng.range(0.0016, 0.006);
    c.beginPath();
    for (let x = 0; x <= size; x += size / 12) {
      const yy = y + fbm2(x * 0.008 + i * 3.1, i * 0.6, 2) * size * 0.01;
      if (x === 0) c.moveTo(x, yy);
      else c.lineTo(x, yy);
    }
    c.stroke();
  }
  // a couple of soft knots so the grain has somewhere to come from
  for (let k = 0; k < 3; k++) {
    const kx = rng.next() * size;
    const ky = rng.next() * size;
    for (let r = 1; r < 5; r++) {
      c.strokeStyle = `rgba(176,146,98,${(0.16 / r).toFixed(3)})`;
      c.lineWidth = size * 0.004;
      c.beginPath();
      c.ellipse(kx, ky, size * 0.012 * r * 2.4, size * 0.012 * r, 0, 0, TAU);
      c.stroke();
    }
  }
}

/** Matching relief so the satin finish catches the grain, not a flat sheen. */
function paintHinokiBump(c: CanvasRenderingContext2D, size: number): void {
  c.fillStyle = '#808080';
  c.fillRect(0, 0, size, size);
  const rng = new Rng(0x51cf);
  for (let i = 0; i < 200; i++) {
    const y = rng.next() * size;
    c.strokeStyle = rng.bool() ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.16)';
    c.lineWidth = size * rng.range(0.002, 0.006);
    c.beginPath();
    c.moveTo(0, y);
    c.lineTo(size, y + fbm2(i * 2.3, 0.7, 2) * size * 0.01);
    c.stroke();
  }
}

/** Raked gravel, seen at night: near-black with a cool sheen along the rake. */
function paintGravel(c: CanvasRenderingContext2D, size: number): void {
  c.fillStyle = '#232F3A';
  c.fillRect(0, 0, size, size);
  const rng = new Rng(0x6ea5);
  for (let i = 0; i < 6; i++) {
    const y = (i / 6) * size + rng.range(-4, 4);
    c.strokeStyle = 'rgba(120,152,176,0.13)';
    c.lineWidth = size * 0.02;
    c.beginPath();
    for (let x = 0; x <= size; x += size / 16) {
      c.lineTo(x, y + Math.sin((x / size) * TAU * 1.5 + i) * size * 0.012);
    }
    c.stroke();
    c.strokeStyle = 'rgba(6,10,14,0.3)';
    c.lineWidth = size * 0.012;
    c.beginPath();
    for (let x = 0; x <= size; x += size / 16) {
      c.lineTo(x, y + size * 0.028 + Math.sin((x / size) * TAU * 1.5 + i) * size * 0.012);
    }
    c.stroke();
  }
  for (let i = 0; i < 900; i++) {
    const s = size * rng.range(0.002, 0.006);
    c.fillStyle = rng.bool(0.5) ? 'rgba(146,171,190,0.16)' : 'rgba(8,12,17,0.3)';
    c.beginPath();
    c.arc(rng.next() * size, rng.next() * size, s, 0, TAU);
    c.fill();
  }
}

// --- petals ----------------------------------------------------------------

interface Petal {
  x: number;
  z: number;
  top: number;
  fall: number;
  speed: number;
  sway: number;
  phase: number;
  spin: number;
  w: number;
  h: number;
}

/**
 * A slow drift of blossom past the camera. One mesh, one draw, animated on the
 * CPU from an absolute clock so repeated render passes in a frame are
 * idempotent. Sixty quads is nothing; the drift is what sells the night.
 */
function buildPetals(count: number, deck: number, rng: Rng, mat: THREE.Material): THREE.Mesh | null {
  if (count <= 0) return null;
  const verts = count * 6;
  const position = new Float32Array(verts * 3);
  const normal = new Float32Array(verts * 3);
  for (let i = 0; i < verts; i++) normal[i * 3 + 1] = 1;

  const petals: Petal[] = [];
  for (let i = 0; i < count; i++) {
    const a = rng.range(0, TAU);
    // biased outwards so nothing drifts through the tower itself
    const r = 3.2 + rng.next() * rng.next() * 6.4;
    petals.push({
      x: Math.cos(a) * r,
      z: Math.sin(a) * r,
      top: deck + rng.range(3.2, 6.4),
      fall: rng.range(4.2, 7.4),
      speed: rng.range(0.4, 0.8),
      sway: rng.range(0.16, 0.5),
      phase: rng.range(0, TAU),
      spin: rng.range(0.45, 1.5) * (rng.bool() ? 1 : -1),
      w: rng.range(0.075, 0.14),
      h: rng.range(0.05, 0.095),
    });
  }

  const geo = new THREE.BufferGeometry();
  const attr = new THREE.BufferAttribute(position, 3);
  attr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', attr);
  geo.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, deck + 2, 0), 14);

  const write = (t: number): void => {
    if (!Number.isFinite(t)) return;
    for (let i = 0; i < petals.length; i++) {
      const p = petals[i];
      const cycle = ((t * p.speed) / p.fall + p.phase) % 1;
      const cy = p.top - (cycle < 0 ? cycle + 1 : cycle) * p.fall;
      const cx = p.x + Math.sin(t * 1.5 + p.phase) * p.sway;
      const cz = p.z + Math.cos(t * 1.13 + p.phase * 1.7) * p.sway;
      const ang = t * p.spin + p.phase;
      const tilt = 0.5 + 0.45 * Math.sin(t * 1.9 + p.phase);
      const ux = Math.cos(ang) * p.w;
      const uz = Math.sin(ang) * p.w;
      const vh = Math.cos(tilt) * p.h;
      const vx = -Math.sin(ang) * vh;
      const vz = Math.cos(ang) * vh;
      const vy = Math.sin(tilt) * p.h;

      const o = i * 18;
      const set = (k: number, sx: number, sy: number): void => {
        position[o + k] = cx + ux * sx + vx * sy;
        position[o + k + 1] = cy + vy * sy;
        position[o + k + 2] = cz + uz * sx + vz * sy;
      };
      set(0, -1, -1);
      set(3, 1, -1);
      set(6, 1, 1);
      set(9, -1, -1);
      set(12, 1, 1);
      set(15, -1, 1);
    }
    attr.needsUpdate = true;
  };

  write(0);
  const m = new THREE.Mesh(geo, mat);
  m.frustumCulled = false;
  m.castShadow = false;
  m.receiveShadow = false;
  m.renderOrder = 3;
  m.onBeforeRender = () => write(performance.now() * 0.001);
  return m;
}

// --- props -----------------------------------------------------------------

/** Base block, shaft, fire box, flared roof, finial. Reads at 120px. */
function stoneLantern(stone: EnvBucket, glow: EnvBucket, s: number, x: number, y: number, z: number, yaw: number, tone: number): void {
  let h = 0;
  stone.add(at(envCyl(0.5 * s, 0.62 * s, 0.26 * s, 8), x, y + h, z, yaw), tone);
  h += 0.24 * s;
  stone.add(at(envCyl(0.17 * s, 0.2 * s, 0.9 * s, 8), x, y + h, z, yaw), tone);
  h += 0.88 * s;
  stone.add(at(envCyl(0.44 * s, 0.5 * s, 0.15 * s, 8), x, y + h, z, yaw), tone);
  h += 0.14 * s;
  stone.add(at(envCyl(0.4 * s, 0.42 * s, 0.5 * s, 8), x, y + h, z, yaw), tone);
  glow.add(at(envCyl(0.3 * s, 0.31 * s, 0.36 * s, 8), x, y + h + 0.07 * s, z, yaw), 0xffcf96);
  h += 0.5 * s;
  stone.add(at(envCyl(0.82 * s, 0.86 * s, 0.07 * s, 8), x, y + h, z, yaw), tone);
  h += 0.06 * s;
  stone.add(at(envCyl(0.14 * s, 0.84 * s, 0.42 * s, 8), x, y + h, z, yaw), tone);
  h += 0.4 * s;
  const cap = envBlob(0.14 * s, 0);
  stone.add(at(cap, x, y + h + 0.1 * s, z), tone);
}

/** Dark trunk, a couple of limbs, a cloud of pink. */
function cherryTree(
  wood: EnvBucket,
  blossom: EnvBucket,
  rng: Rng,
  detail: number,
  x: number,
  y: number,
  z: number,
  scale: number,
  fade: number,
): void {
  const trunkH = 2.5 * scale;
  const lean = rng.signed() * 0.09;
  const trunk = envCyl(0.13 * scale, 0.25 * scale, trunkH, 7);
  trunk.rotateZ(lean);
  wood.add(at(trunk, x, y, z), 0x1b1620);

  const limbs = detail > 0 ? 3 : 2;
  for (let i = 0; i < limbs; i++) {
    const a = rng.range(0, TAU);
    const len = rng.range(0.7, 1.3) * scale;
    const limb = envCyl(0.045 * scale, 0.1 * scale, len, 5);
    limb.rotateZ(rng.range(0.5, 0.95));
    limb.rotateY(a);
    wood.add(at(limb, x + lean * -trunkH, y + trunkH * rng.range(0.55, 0.85), z), 0x1b1620);
  }

  const blobs = detail > 0 ? 5 : 3;
  const pinks = [0xf6b6c8, 0xefa2ba, 0xffc9d6, 0xe294ae];
  for (let i = 0; i < blobs; i++) {
    const a = rng.range(0, TAU);
    const rr = rng.range(0, 1.15) * scale;
    const size = rng.range(0.72, 1.28) * scale;
    const blob = envBlob(size, detail);
    blob.scale(1, rng.range(0.62, 0.86), 1);
    const tint = new THREE.Color(rng.pick(pinks));
    tint.lerp(new THREE.Color(0x16242f), fade);
    blossom.add(
      at(blob, x + Math.cos(a) * rr, y + trunkH + rng.range(0.15, 0.85) * scale, z + Math.sin(a) * rr),
      tint.getHex(),
    );
  }
}

/** Posts and three rails, built straight then swung out to a bearing. */
function bambooFence(
  wood: EnvBucket,
  rng: Rng,
  radius: number,
  bearing: number,
  span: number,
  y: number,
  tone: number,
): void {
  const h = 1.35;
  const bays = Math.max(2, Math.round(span / 1.5));
  const cx = Math.cos(bearing) * radius;
  const cz = Math.sin(bearing) * radius;
  const yaw = -bearing;
  for (let i = 0; i <= bays; i++) {
    const u = (i / bays - 0.5) * span;
    const post = envCyl(0.055, 0.065, h * rng.range(0.95, 1.05), 5);
    wood.add(at(post, cx + Math.cos(yaw) * u, y, cz - Math.sin(yaw) * u), tone);
  }
  for (let r = 0; r < 3; r++) {
    const rail = envCyl(0.045, 0.045, span, 5);
    rail.rotateZ(Math.PI / 2);
    rail.rotateY(yaw);
    wood.add(at(rail, cx, y + 0.28 + r * 0.44, cz), tone);
  }
}

/** Glowing paper, a dark lattice in front of it, a heavy eave over the top. */
function shojiWall(
  wood: EnvBucket,
  glow: EnvBucket,
  radius: number,
  bearing: number,
  span: number,
  y: number,
  bars: number,
): void {
  const h = 3.3;
  const cx = Math.cos(bearing) * radius;
  const cz = Math.sin(bearing) * radius;
  const yaw = -bearing + Math.PI / 2;
  const nx = Math.cos(yaw);
  const nz = -Math.sin(yaw);

  glow.add(at(envBox(span, h, 0.1), cx, y + 0.5, cz, yaw), 0xffb877);
  // lattice: sits a few centimetres proud of the paper on the camera side
  const px = -Math.cos(bearing) * 0.09;
  const pz = -Math.sin(bearing) * 0.09;
  for (let i = 0; i <= bars; i++) {
    const u = (i / bars - 0.5) * span;
    wood.add(at(envBox(0.07, h, 0.06), cx + nx * u + px, y + 0.5, cz + nz * u + pz, yaw), 0x140f0d);
  }
  for (let i = 0; i < 3; i++) {
    wood.add(
      at(envBox(span, 0.07, 0.06), cx + px, y + 0.5 + (i + 1) * (h / 4), cz + pz, yaw),
      0x140f0d,
    );
  }
  wood.add(at(envBox(span + 0.5, 0.16, 0.14), cx + px, y + 0.5 + h, cz + pz, yaw), 0x140f0d);
  // eave
  wood.add(at(envBox(span + 1.2, 0.2, 1.0), cx, y + 0.5 + h + 0.16, cz, yaw), 0x0e0b0a);
  // posts down to the ground
  for (const s of [-1, 1]) {
    wood.add(at(envBox(0.16, h + 0.6, 0.16), cx + nx * (span / 2) * s, y, cz + nz * (span / 2) * s, yaw), 0x140f0d);
  }
}

// --- the build -------------------------------------------------------------

function sushiEnvironment(ctx: EnvBuildCtx): THREE.Object3D {
  const root = new THREE.Group();
  root.name = 'sushi.garden';

  const m = ctx.materials;
  const q = ctx.quality;
  const rng = ctx.rng;
  const topY = Number.isFinite(ctx.tableTopY) ? ctx.tableTopY : -0.3;
  const plate = Number.isFinite(ctx.plateWidth) && ctx.plateWidth > 0.4 ? ctx.plateWidth : 3.24;
  const deck = topY - ENV_SINK;
  const floorY = deck - FLOOR_DROP;
  const detail = envPick(q, 0, 1, 1);

  // ---- materials (keyed by look; the library shares them across runs) ----
  const hinokiMat = m.standard('sushi.env.hinoki', {
    color: 0xffffff,
    map: m.texture('sushi.env.hinoki.map', paintHinoki, { size: 256, repeat: [0.1, 0.62] }),
    bumpMap: m.dataTexture('sushi.env.hinoki.bump', paintHinokiBump, { size: 256, repeat: [0.1, 0.62] }),
    bumpScale: 0.004,
    roughness: 0.4,
    metalness: 0,
    vertexColors: true,
  });
  const gravelMat = m.standard('sushi.env.gravel', {
    color: 0xffffff,
    map: m.texture('sushi.env.gravel.map', paintGravel, { size: 256, repeat: [1, 1] }),
    roughness: 0.96,
    metalness: 0,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
  });
  const matteMat = m.standard('sushi.env.matte', {
    color: 0xffffff,
    roughness: 0.94,
    metalness: 0,
    vertexColors: true,
  });
  const woodMat = m.standard('sushi.env.wood', {
    color: 0xffffff,
    roughness: 0.6,
    metalness: 0,
    vertexColors: true,
  });
  const satinMat = m.physical('sushi.env.satin', {
    color: 0xffffff,
    roughness: 0.18,
    metalness: 0,
    clearcoat: 0.7,
    clearcoatRoughness: 0.1,
    vertexColors: true,
  });
  const blossomMat = m.physical('sushi.env.blossom', {
    color: 0xffffff,
    roughness: 0.86,
    metalness: 0,
    sheen: 0.6,
    sheenColor: 0xffd7e2,
    sheenRoughness: 0.6,
    vertexColors: true,
    flatShading: true,
  });
  const glowMat = m.standard('sushi.env.glow', {
    color: 0x120a06,
    emissive: 0xffb877,
    emissiveIntensity: 1.15,
    roughness: 1,
    metalness: 0,
    vertexColors: true,
  });
  const petalMat = m.standard('sushi.env.petal', {
    color: 0x1a1014,
    emissive: 0xffb8cc,
    emissiveIntensity: 0.62,
    roughness: 1,
    metalness: 0,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const counter = new EnvBucket();
  const matte = new EnvBucket();
  const wood = new EnvBucket();
  const satin = new EnvBucket();
  const blossom = new EnvBucket();
  const glow = new EnvBucket();

  // ---- the counter -------------------------------------------------------
  // A single thick slab of hinoki. Its top surface is the plate's table.
  const slabR = envPick(q, 1, 2, 3);
  const slab = roundedBox(COUNTER_W, COUNTER_T, COUNTER_D, 0.05, slabR);
  counter.add(at(slab, 0, deck - COUNTER_T, 0), 0xffffff);
  // end grain: a hair proud of each short end so the edge reads as a cut face
  for (const s of [-1, 1]) {
    counter.add(
      at(envBox(0.05, COUNTER_T * 0.92, COUNTER_D * 0.985), s * (COUNTER_W / 2), deck - COUNTER_T * 0.96, 0),
      0xd8c8a4,
    );
  }
  // recessed base, so the slab reads as thick and floating
  const baseH = FLOOR_DROP - COUNTER_T;
  counter.add(at(envBox(COUNTER_W * 0.78, baseH, COUNTER_D * 0.5), 0, floorY, 0), 0x6d6152);
  counter.add(at(envBox(COUNTER_W * 0.82, 0.09, COUNTER_D * 0.56), 0, floorY, 0), 0x4a4238);

  // ---- on the counter ----------------------------------------------------
  // Everything here keeps min(|x|,|z|) > SWEEP_HALF so a sliding layer can
  // never pass through it.
  const dishX = 2.35 + rng.range(-0.1, 0.15);
  const dishZ = SWEEP_HALF + 0.25 + rng.range(0, 0.15);
  satin.add(at(envCyl(0.42, 0.36, 0.11, 20), dishX, deck, dishZ), 0x0b1013);
  satin.add(at(envCyl(0.34, 0.34, 0.02, 20), dishX, deck + 0.075, dishZ), 0x241a12);

  const restX = -2.5 + rng.range(-0.15, 0.15);
  const restZ = -(SWEEP_HALF + 0.3 + rng.range(0, 0.2));
  const rest = pillow(0.44, 0.11, 0.17, { round: 0.75, segments: 12, squash: 0.45 });
  satin.add(at(rest, restX, deck, restZ, rng.range(-0.3, 0.3)), 0x22333c);
  for (let i = 0; i < 2; i++) {
    const stick = envCyl(0.017, 0.026, 1.55, 6);
    stick.rotateZ(Math.PI / 2);
    stick.rotateY(-0.42);
    satin.add(at(stick, restX + 0.12, deck + 0.1 + i * 0.036, restZ + 0.05 + i * 0.055), 0x150f0d);
  }

  // a folded indigo cloth
  const clothX = -(plate * 0.62 + 1.5);
  const clothZ = SWEEP_HALF + 0.4;
  matte.add(at(envBox(0.95, 0.05, 0.62), clothX, deck, clothZ, 0.22), 0x14243f);
  matte.add(at(envBox(0.86, 0.05, 0.5), clothX + 0.04, deck + 0.05, clothZ - 0.02, 0.18), 0x1b2f4e);

  // a single branch in a vase — the ikebana
  const vaseX = 3.0 + rng.range(-0.2, 0.2);
  const vaseZ = -(SWEEP_HALF + 0.45 + rng.range(0, 0.3));
  satin.add(at(envCyl(0.17, 0.24, 0.62, 14), vaseX, deck, vaseZ), 0x16323a);
  satin.add(at(envCyl(0.2, 0.17, 0.08, 14), vaseX, deck + 0.6, vaseZ), 0x1d3f47);
  const branch = envCyl(0.014, 0.032, 1.15, 5);
  branch.rotateZ(0.22);
  wood.add(at(branch, vaseX, deck + 0.55, vaseZ), 0x241a1c);
  for (let i = 0; i < 3; i++) {
    const twig = envCyl(0.009, 0.018, rng.range(0.28, 0.46), 4);
    twig.rotateZ(rng.range(0.6, 1.1) * (i % 2 ? 1 : -1));
    twig.rotateY(rng.range(0, TAU));
    wood.add(at(twig, vaseX - 0.13 + i * 0.09, deck + 0.9 + i * 0.22, vaseZ), 0x241a1c);
    blossom.add(
      at(envBlob(rng.range(0.07, 0.11), detail), vaseX - 0.2 + i * 0.16, deck + 1.05 + i * 0.24, vaseZ + rng.signed() * 0.12),
      0xf7bcca,
    );
  }

  // ---- the garden floor --------------------------------------------------
  const gseg = envPick(q, 28, 44, 60);
  const radii = envPick<readonly number[]>(
    q,
    [2.4, 7, 13, 19, 25],
    [1.8, 4.2, 8, 12.5, 17, 21, 25],
    [1.6, 3.4, 6.4, 10, 13.5, 17, 20.5, 25],
  );
  const ground = envGround(radii, gseg, 0.13, (r) => {
    const fade = 1 - THREE.MathUtils.smoothstep(r, 12.5, 24.5);
    const dark = 1 - 0.42 * THREE.MathUtils.smoothstep(r, 3, 20);
    return [dark, dark * 0.99, dark * 1.02, fade];
  });
  ground.translate(0, floorY, 0);
  const groundMesh = new THREE.Mesh(ground, gravelMat);
  groundMesh.castShadow = false;
  groundMesh.receiveShadow = false;
  groundMesh.renderOrder = -1;
  root.add(groundMesh);

  // ---- mid ground --------------------------------------------------------
  // tsukubai: a squat stone basin, a bamboo spout, a black disc of water
  const basinA = rng.range(2.5, 3.1);
  const bx = Math.cos(basinA) * 9.2;
  const bz = Math.sin(basinA) * 9.2;
  matte.add(at(envBlob(0.85, detail), bx, floorY + 0.18, bz), 0x2b3138);
  matte.add(at(envCyl(0.76, 0.7, 0.62, 10), bx, floorY + 0.4, bz), 0x39414a);
  satin.add(at(envCyl(0.62, 0.62, 0.03, 12), bx, floorY + 0.99, bz), 0x0a1116);
  const spoutBase = envCyl(0.075, 0.09, 1.5, 6);
  wood.add(at(spoutBase, bx - 1.0, floorY, bz + 0.5), 0x6f6b47);
  const spout = envCyl(0.06, 0.07, 1.1, 6);
  spout.rotateZ(Math.PI / 2 - 0.28);
  wood.add(at(spout, bx - 0.95, floorY + 1.42, bz + 0.5), 0x7d7850);
  satin.add(at(envCyl(0.012, 0.012, 0.42, 4), bx - 0.12, floorY + 1.02, bz + 0.42), 0x8fb6c4);

  // rocks and moss, never evenly spaced
  const rocks = envPick(q, 3, 6, 8);
  for (let i = 0; i < rocks; i++) {
    const a = rng.range(0, TAU);
    const r = rng.range(6.5, 13.5);
    const s = rng.range(0.3, 0.85);
    const rock = envBlob(s, detail);
    rock.scale(rng.range(0.9, 1.5), rng.range(0.4, 0.7), rng.range(0.9, 1.4));
    matte.add(
      at(rock, Math.cos(a) * r, floorY + s * 0.2, Math.sin(a) * r, rng.range(0, TAU)),
      rng.bool(0.6) ? 0x2c3239 : 0x1e2a25,
    );
  }

  // ---- background --------------------------------------------------------
  if (q !== 'low') {
    const fences = envPick(q, 2, 3, 4);
    for (let i = 0; i < fences; i++) {
      const bearing = (i / fences) * TAU + rng.range(-0.35, 0.35);
      bambooFence(wood, rng, rng.range(10.5, 12.5), bearing, rng.range(4.5, 7), floorY, 0x565c3f);
    }
  }

  const lanterns = envPick(q, 1, 2, 2);
  for (let i = 0; i < lanterns; i++) {
    const a = rng.range(0, TAU);
    const r = rng.range(8.5, 12);
    stoneLantern(matte, glow, rng.range(0.85, 1.15), Math.cos(a) * r, floorY, Math.sin(a) * r, rng.range(0, TAU), 0x424a52);
  }

  const walls = envPick(q, 1, 2, 3);
  for (let i = 0; i < walls; i++) {
    const bearing = (i / walls) * TAU + rng.range(-0.4, 0.4) + 0.6;
    shojiWall(wood, glow, rng.range(14.5, 16.5), bearing, rng.range(6, 8.5), floorY, envPick(q, 3, 4, 5));
  }

  const trees = envPick(q, 3, 5, 7);
  for (let i = 0; i < trees; i++) {
    const a = (i / trees) * TAU + rng.range(-0.4, 0.4);
    const r = rng.range(13, 21);
    const fade = THREE.MathUtils.clamp((r - 12) / 14, 0, 0.55);
    cherryTree(wood, blossom, rng, detail, Math.cos(a) * r, floorY, Math.sin(a) * r, rng.range(0.85, 1.35), fade);
  }

  // ---- assemble ----------------------------------------------------------
  const meshes: Array<THREE.Mesh | null> = [
    counter.build(hinokiMat, false, true),
    satin.build(satinMat, true, true),
    matte.build(matteMat, false, true),
    wood.build(woodMat, false, false),
    blossom.build(blossomMat, false, false),
    glow.build(glowMat, false, false),
    buildPetals(envPick(q, 8, 26, 44), deck, rng, petalMat),
  ];
  for (const mesh of meshes) if (mesh) root.add(mesh);
  return root;
}

// ---------------------------------------------------------------------------
// theme
// ---------------------------------------------------------------------------

const foods: FoodDef[] = [
  {
    id: 'sushi.rice',
    name: 'Pressed Rice',
    glyph: '🍚',
    thickness: 0.46,
    tint: 0xf7f3e8,
    tintAlt: 0xdcd2b8,
    weight: 1.2,
    build: buildRice,
  },
  {
    id: 'sushi.salmon',
    name: 'Salmon Nigiri',
    glyph: '🍣',
    thickness: 0.34,
    tint: 0xff7a55,
    tintAlt: 0xffe7d8,
    weight: 1.3,
    build: buildSalmon,
  },
  {
    id: 'sushi.nori',
    name: 'Nori Band',
    glyph: '🍙',
    thickness: 0.22,
    tint: 0x1b2b1e,
    tintAlt: 0x3e6248,
    build: buildNori,
  },
  {
    id: 'sushi.tamago',
    name: 'Tamago',
    glyph: '🍳',
    thickness: 0.44,
    tint: 0xf5c542,
    tintAlt: 0xc9891f,
    build: buildTamago,
  },
  {
    id: 'sushi.avocado',
    name: 'Avocado Fan',
    glyph: '🥑',
    thickness: 0.3,
    tint: 0x8cbf4d,
    tintAlt: 0xd6e79a,
    build: buildAvocado,
  },
  {
    id: 'sushi.tobiko',
    name: 'Tobiko',
    glyph: '🧡',
    thickness: 0.26,
    tint: 0xff8c3a,
    tintAlt: 0xc0521c,
    build: buildTobiko,
  },
  {
    id: 'sushi.cucumber',
    name: 'Cucumber',
    glyph: '🥒',
    thickness: 0.28,
    tint: 0x7fbf5a,
    tintAlt: 0xd8ecb2,
    build: buildCucumber,
  },
  {
    id: 'sushi.wasabi',
    name: 'Wasabi Dab',
    glyph: '🌿',
    thickness: 0.32,
    tint: 0x8fbf3f,
    tintAlt: 0xa4c95c,
    weight: 0.8,
    build: buildWasabi,
  },
];

export const sushiTheme: ThemeDef = {
  id: 'sushi',
  name: 'Sushi Tower',
  tagline: 'Rice, salmon, nori, wasabi pop.',
  glyph: '🍣',
  price: 1.99,
  palette: {
    bgTop: 0x22384a,
    bgBottom: 0x0a1218,
    fog: 0x16242f,
    fogDensity: 0.016,
    key: 0xeaf4ff,
    keyIntensity: 2.6,
    fill: 0x5f8fa8,
    fillIntensity: 0.6,
    rim: 0xff9e80,
    rimIntensity: 1.5,
    ground: 0x0e1a22,
    accent: 0xff6b57,
    accentSoft: 0x7fd1c1,
    bloomStrength: 0.58,
    exposure: 1.08,
    vignette: 0.4,
  },
  foods,
  hero: [0, 2, 3, 4, 5, 1],
  plate: buildPlate,
  environment: sushiEnvironment,
  ambience: 'sushi',
};
