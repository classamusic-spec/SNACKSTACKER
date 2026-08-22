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
import { SKY_PRESETS } from '../../render/palette';
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
// environment — a hinoki counter above a karesansui, Fuji on the horizon
// ===========================================================================

/**
 * Layout contract, in priority order:
 *
 *  1. The counter top lands on `ctx.tableTopY` (a hair below it, so it can
 *     never punch through the plate and never z-fights the contact shadow).
 *  2. Nothing rises above that plane within PROP_R of the middle, so neither
 *     the tower nor the layer sliding above it can ever meet a prop — at any
 *     camera yaw, since the home screen orbits a full turn.
 *  3. The garden floor is `FLOOR_DROP` below the counter and is a real
 *     karesansui: raked gravel whose furrows ring the tower and bend around
 *     five stone groups, with moss islands between them.
 *  4. The horizon is three layers deep — two hazed ridgelines and Mount Fuji
 *     behind them — built as vertex-alpha silhouettes that dissolve into the
 *     sky instead of ending on a line.
 *
 * ## Why the whole horizon lives in the top fifth of the frame
 *
 * The camera pitches down 0.5 rad behind a 23 degree half-FOV, so the TOP of
 * the frame already looks 5.6 degrees BELOW the true horizon: nothing at or
 * above eye height is ever on screen, and the further away a thing is the
 * HIGHER it projects. Measured at the home framing, the garden floor's fading
 * rim lands about 17% down the frame and everything above that is sky. That
 * thin band is the entire budget for distance, which is why Fuji is authored
 * by its screen angles rather than by its world size: summit ~11% down the
 * frame, dissolved away by ~20%, about 80% of the frame wide. Sized like a
 * mountain instead, it either runs off both edges or leaves the frame out of
 * the top entirely — both of which happened on the way here.
 */

const ENV_SINK = 0.0025;
const COUNTER_W = 10.4;
const COUNTER_D = 3.94;
const COUNTER_T = 0.46;
const FLOOR_DROP = 3.1;

/**
 * Tower clearance. The home screen orbits the camera a full turn, so there is
 * no such thing as "behind the tower" — a prop parked out of the way at 45 deg
 * is straight through the food half a rotation later. Every prop must satisfy
 * ONE of these, at every yaw:
 *
 *   a. it sits at or below the counter top, or
 *   b. it is further than PROP_R from the middle and rises no higher than
 *      PROP_LIFT above the counter, or
 *   c. it is further than FAR_R out, where it may be tall: it is background.
 *
 * Because the rule is written in cylindrical coordinates it is yaw-independent
 * by construction: satisfying it once satisfies it at every camera angle.
 *
 * The one deliberate exception is the drifting petals, which are 10cm
 * translucent quads with no depth write. They stay outside PROP_R so they never
 * intersect the tower in space; they cross in FRONT of it on screen, which is
 * the effect the brief asks for.
 */
const PROP_R = 4.6;
const PROP_LIFT = 1.5;
const FAR_R = 9.5;

/** Radius of the gravel disc, and the world square the rake texture covers. */
const GROUND_R = 31;
const GARDEN_SPAN = 64;

/** Shove a prop radially outwards until it clears the tower's cylinder. */
function clearOf(x: number, z: number, min = PROP_R): [number, number] {
  const r = Math.hypot(x, z);
  if (!(r > 1e-4)) return [min, 0];
  return r >= min ? [x, z] : [(x * min) / r, (z * min) / r];
}

const envPick = <T>(q: QualityTier, low: T, med: T, high: T): T =>
  q === 'low' ? low : q === 'medium' ? med : high;

const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);
const smooth01 = (t: number): number => {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
};

/** Cheap integer hash, 0..1. Used per-texel, so it must not call Math.sin. */
function hashPx(i: number, j: number): number {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263)) | 0;
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Merge bucket. Each part carries its colour in vertex colours, so a dozen
 * differently-tinted props collapse into a single draw call. `shade` scales
 * that colour per vertex, which is how a baked pool of light is put on the
 * counter without a second material.
 */
class EnvBucket {
  private readonly parts: THREE.BufferGeometry[] = [];

  add(
    geo: THREE.BufferGeometry | null,
    color: number,
    shade?: (x: number, y: number, z: number) => number,
  ): void {
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
    if (shade) {
      const p = g.getAttribute('position') as THREE.BufferAttribute;
      const c = g.getAttribute('color') as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const s = shade(p.getX(i), p.getY(i), p.getZ(i));
        const k = Number.isFinite(s) ? clamp01(s) : 1;
        c.setXYZ(i, c.getX(i) * k, c.getY(i) * k, c.getZ(i) * k);
      }
      c.needsUpdate = true;
    }
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

/** A rod of `len` lying along +X, CENTRED on the origin — chopsticks, rails. */
function envRodX(rTop: number, rBot: number, len: number, sides: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(
    Math.max(rTop, 1e-4),
    Math.max(rBot, 1e-4),
    Math.max(len, 1e-3),
    Math.max(3, Math.round(sides)),
    1,
  );
  g.rotateZ(-Math.PI / 2);
  return g;
}

/** Faceted blob, centred on its own origin. */
function envBlob(r: number, detail: number): THREE.BufferGeometry {
  return new THREE.IcosahedronGeometry(Math.max(r, 1e-3), Math.max(0, detail));
}

/**
 * Eight and four triangles: the two sizes a blossom cluster comes in.
 *
 * Both come out of three with flat face normals, which turn a 20px puff into a
 * visibly faceted gem — the exact failure the old canopies had, only smaller.
 * Pointing every normal out from the centre instead makes each cluster shade
 * like a tiny sphere for no extra triangles at all.
 */
function softNormals(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const n = g.getAttribute('normal') as THREE.BufferAttribute;
  if (!p || !n) return g;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const l = Math.hypot(x, y, z) || 1;
    n.setXYZ(i, x / l, y / l, z / l);
  }
  n.needsUpdate = true;
  return g;
}
function envOcta(r: number): THREE.BufferGeometry {
  return softNormals(new THREE.OctahedronGeometry(Math.max(r, 1e-3), 0));
}
function envTetra(r: number): THREE.BufferGeometry {
  return softNormals(new THREE.TetrahedronGeometry(Math.max(r, 1e-3), 0));
}

const STRUT_UP = new THREE.Vector3(0, 1, 0);
const STRUT_DIR = new THREE.Vector3();
const STRUT_Q = new THREE.Quaternion();

/** An open-ended rod between two arbitrary points — a limb, a twig. */
function envStrut(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  rTop: number, rBot: number, sides: number,
): THREE.BufferGeometry | null {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const len = Math.hypot(dx, dy, dz);
  if (!(len > 1e-4) || !Number.isFinite(len)) return null;
  const g = new THREE.CylinderGeometry(
    Math.max(rTop, 1e-4),
    Math.max(rBot, 1e-4),
    len,
    Math.max(3, Math.round(sides)),
    1,
    true,
  );
  STRUT_DIR.set(dx / len, dy / len, dz / len);
  g.applyQuaternion(STRUT_Q.setFromUnitVectors(STRUT_UP, STRUT_DIR));
  g.translate((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
  return g;
}

/** Author a prop at the origin with its base on y = 0, then post it here. */
function at(g: THREE.BufferGeometry, x: number, y: number, z: number, yaw = 0): THREE.BufferGeometry {
  if (yaw) g.rotateY(yaw);
  g.translate(x, y, z);
  return g;
}

/**
 * A ring-tessellated ground disc with per-vertex RGBA, so the far rim can fade
 * to nothing instead of ending on a hard edge. UVs are world-planar and
 * centred, which is what lets a single non-tiling texture carry rake furrows
 * that ring particular stones rather than an anonymous repeat.
 */
function envGround(
  radii: readonly number[],
  segments: number,
  shade: (radius: number) => readonly [number, number, number, number],
): THREE.BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const s = 1 / GARDEN_SPAN;
  const push = (x: number, z: number, r: number): void => {
    pos.push(x, 0, z);
    nrm.push(0, 1, 0);
    uv.push(x * s + 0.5, z * s + 0.5);
    const c = shade(r);
    col.push(c[0], c[1], c[2], c[3]);
  };

  push(0, 0, 0);
  for (let ri = 0; ri < radii.length; ri++) {
    const r = radii[ri];
    for (let sg = 0; sg < segments; sg++) {
      const a = (sg / segments) * TAU;
      push(Math.cos(a) * r, Math.sin(a) * r, r);
    }
  }
  for (let sg = 0; sg < segments; sg++) idx.push(0, 1 + ((sg + 1) % segments), 1 + sg);
  for (let ri = 0; ri < radii.length - 1; ri++) {
    const a0 = 1 + ri * segments;
    const b0 = a0 + segments;
    for (let sg = 0; sg < segments; sg++) {
      const s1 = (sg + 1) % segments;
      idx.push(a0 + sg, a0 + s1, b0 + sg);
      idx.push(a0 + s1, b0 + s1, b0 + sg);
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

// ---------------------------------------------------------------------------
// the karesansui — stones, moss, and the field the rake follows
// ---------------------------------------------------------------------------

interface StoneGroup {
  /** Bearing (x = cos a, z = sin a) and radius of the group's centre. */
  readonly a: number;
  readonly r: number;
  /** How many stones. Odd, or a pair — never a tidy count. */
  readonly n: number;
  /** How far the stones scatter from the group's centre. */
  readonly spread: number;
  /** Height of the tallest stone in the group. */
  readonly tall: number;
  readonly seed: number;
}

/**
 * Ryoan-ji's grammar: fifteen stones in five groups of 5-2-3-2-3, never
 * centred, never evenly spaced, never on a grid — the asymmetry IS the form.
 *
 * Authored as constants rather than drawn from ctx.rng because the rake
 * texture is baked once and cached across runs: the furrows have to ring the
 * stones that are actually standing there, so both have to read the same
 * layout. A zen garden is composed anyway; it is the one thing in this scene
 * that should not be re-rolled.
 */
const STONE_GROUPS: readonly StoneGroup[] = [
  { a: 3.49, r: 8.4, n: 5, spread: 1.45, tall: 1.2, seed: 0x51a1 },
  { a: 4.97, r: 12.6, n: 2, spread: 0.85, tall: 0.72, seed: 0x51a2 },
  { a: 0.44, r: 9.9, n: 3, spread: 1.1, tall: 0.9, seed: 0x51a3 },
  { a: 1.66, r: 13.4, n: 2, spread: 0.9, tall: 0.66, seed: 0x51a4 },
  { a: 2.53, r: 7.5, n: 3, spread: 1.0, tall: 0.98, seed: 0x51a5 },
];

interface Patch {
  readonly x: number;
  readonly z: number;
  readonly r: number;
  readonly seed: number;
}

/** Every stone group wears a moss skirt; three islands float free of them. */
const MOSS: readonly Patch[] = [
  ...STONE_GROUPS.map((g, i) => ({
    x: Math.cos(g.a) * g.r + Math.cos(g.a + 1.9) * g.spread * 0.5,
    z: Math.sin(g.a) * g.r + Math.sin(g.a + 1.9) * g.spread * 0.5,
    r: g.spread * 1.55 + 0.5,
    seed: 3.7 + i * 2.3,
  })),
  { x: -4.1, z: -11.6, r: 1.9, seed: 17.2 },
  { x: 10.8, z: 4.4, r: 1.35, seed: 21.9 },
  { x: 1.6, z: 15.2, r: 2.3, seed: 26.4 },
];

interface RakeIsland {
  readonly x: number;
  readonly z: number;
  readonly r: number;
}

const RAKE_ISLANDS: readonly RakeIsland[] = STONE_GROUPS.map((g) => ({
  x: Math.cos(g.a) * g.r,
  z: Math.sin(g.a) * g.r,
  r: g.spread + 0.8,
}));

/** Influence length of the open field, in world units. */
const RAKE_OPEN = 5.6;

/**
 * The potential whose contour lines the rake follows.
 *
 * Every term is a distance, so the gradient is unit length wherever one term
 * dominates and the furrow spacing stays even: rings about the tower out in
 * the open, rings about a stone group near one, and a smooth partition of
 * unity between them so a furrow BENDS round a stone instead of colliding
 * with it. That bend is the whole signature of a raked garden.
 */
function rakePotential(x: number, z: number): number {
  const rc = Math.sqrt(x * x + z * z);
  let w = 1 / (RAKE_OPEN * RAKE_OPEN);
  let wsum = w;
  // the open sea, wobbled: a rake is dragged by hand, not by a compass
  let v = (rc + fbm2(x * 0.055 + 11, z * 0.055 - 7, 2) * 1.3) * w;
  for (let i = 0; i < RAKE_ISLANDS.length; i++) {
    const is = RAKE_ISLANDS[i];
    const dx = x - is.x;
    const dz = z - is.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    w = 1 / (d * d + 0.5);
    wsum += w;
    v += (d - is.r) * w;
  }
  return v / wsum;
}

/** 0 outside the moss, 1 inside, with a torn rather than circular edge. */
function mossAt(x: number, z: number): number {
  let m = 0;
  for (let i = 0; i < MOSS.length; i++) {
    const p = MOSS[i];
    const dx = x - p.x;
    const dz = z - p.z;
    const warp = fbm2(x * 0.45 + p.seed, z * 0.45 - p.seed, 3) * 0.4;
    const d = Math.sqrt(dx * dx + dz * dz) / Math.max(p.r, 0.1) + warp;
    const v = 1 - smooth01((d - 0.6) / 0.42);
    if (v > m) m = v;
  }
  return m;
}

/** How much the gravel is shaded by the stones standing in it. */
function stoneShadeAt(x: number, z: number): number {
  let s = 0;
  for (let i = 0; i < RAKE_ISLANDS.length; i++) {
    const is = RAKE_ISLANDS[i];
    const d = Math.hypot(x - is.x, z - is.z);
    const v = 1 - smooth01((d - is.r * 0.55) / (is.r * 0.9));
    if (v > s) s = v;
  }
  return s;
}

/**
 * Smooth fields sampled on a coarse grid and read back bilinearly.
 *
 * The furrows themselves have to be crisp at texel resolution, but everything
 * that FEEDS them — the potential, its gradient, the moss, the mottling — is
 * smooth over metres. Evaluating those per texel costs a million square roots
 * and a million fbm calls; sampling them at half resolution costs a quarter of
 * that and is visually identical, which is the difference between a 40ms bake
 * and a third of a second of hitching on theme select.
 */
interface RakeMaps {
  res: number;
  step: number;
  field: Float32Array;
  gradX: Float32Array;
  gradZ: Float32Array;
  moss: Float32Array;
  mottle: Float32Array;
  pebble: Float32Array;
}

let rakeMaps: RakeMaps | null = null;

function rakeMapsFor(res: number): RakeMaps {
  if (rakeMaps && rakeMaps.res === res) return rakeMaps;
  const n = res * res;
  const step = GARDEN_SPAN / res;
  const field = new Float32Array(n);
  const moss = new Float32Array(n);
  const mottle = new Float32Array(n);
  const pebble = new Float32Array(n);
  const gradX = new Float32Array(n);
  const gradZ = new Float32Array(n);

  for (let j = 0; j < res; j++) {
    const wz = GARDEN_SPAN / 2 - (j + 0.5) * step;
    for (let i = 0; i < res; i++) {
      const wx = (i + 0.5) * step - GARDEN_SPAN / 2;
      const k = j * res + i;
      field[k] = rakePotential(wx, wz);
      moss[k] = mossAt(wx, wz);
      mottle[k] = fbm2(wx * 0.16 + 3.1, wz * 0.16 - 5.4, 3);
      pebble[k] = fbm2(wx * 4.1 + 41, wz * 4.1 - 29, 2);
    }
  }
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      const k = j * res + i;
      const i0 = i > 0 ? i - 1 : i;
      const i1 = i < res - 1 ? i + 1 : i;
      const j0 = j > 0 ? j - 1 : j;
      const j1 = j < res - 1 ? j + 1 : j;
      gradX[k] = (field[j * res + i1] - field[j * res + i0]) / ((i1 - i0) * step);
      // canvas rows run the other way to world z, hence the sign
      gradZ[k] = -(field[j1 * res + i] - field[j0 * res + i]) / ((j1 - j0) * step);
    }
  }
  rakeMaps = { res, step, field, gradX, gradZ, moss, mottle, pebble };
  return rakeMaps;
}

/** Bilinear read of a coarse grid at continuous grid coordinates. */
function gridAt(g: Float32Array, res: number, gx: number, gy: number): number {
  const x = gx < 0 ? 0 : gx > res - 1 ? res - 1 : gx;
  const y = gy < 0 ? 0 : gy > res - 1 ? res - 1 : gy;
  const i0 = Math.floor(x);
  const j0 = Math.floor(y);
  const i1 = i0 < res - 1 ? i0 + 1 : i0;
  const j1 = j0 < res - 1 ? j0 + 1 : j0;
  const fx = x - i0;
  const fy = y - j0;
  const a = g[j0 * res + i0];
  const b = g[j0 * res + i1];
  const c = g[j1 * res + i0];
  const d = g[j1 * res + i1];
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}

/**
 * Furrow spacing, in world units, held to at least ten texels so the rake
 * never turns into a moire once anisotropy runs out. One unit is about 20cm
 * at this scale, so 0.62 is a hand rake at Ryoan-ji's pitch.
 */
function rakeSpacing(size: number): number {
  return Math.max(0.62, (10.5 * GARDEN_SPAN) / size);
}
/** Depth of a furrow, in world units. Read entirely by the normal map. */
const RAKE_DEPTH = 0.065;

/** Where the gravel gives out and the fog takes over. */
const rakeFalloff = (rc: number): number => 1 - smooth01((rc - 21) / 9);

/**
 * The garden floor, painted once in world space.
 *
 * A tiling gravel swatch cannot ring a stone that is standing at (8.4, 3.1),
 * so this is a single non-tiling image covering a 64-unit square centred on
 * the tower, and the mesh's UVs are world-planar. The albedo stays almost
 * flat — the rake is carried by the matching normal map, because a furrow
 * painted as a light and dark stripe stops being a furrow the moment the key
 * light moves.
 */
function paintKaresansui(c: CanvasRenderingContext2D, size: number): void {
  const res = Math.max(64, size >> 1);
  const maps = rakeMapsFor(res);
  const img = c.createImageData(size, size);
  const px = img.data;
  const inv = GARDEN_SPAN / size;
  const k = TAU / rakeSpacing(size);
  const scale = res / size;

  for (let j = 0; j < size; j++) {
    const wz = GARDEN_SPAN / 2 - (j + 0.5) * inv;
    const gy = (j + 0.5) * scale - 0.5;
    for (let i = 0; i < size; i++) {
      const wx = (i + 0.5) * inv - GARDEN_SPAN / 2;
      const gx = (i + 0.5) * scale - 0.5;
      const rc = Math.hypot(wx, wz);

      const moss = clamp01(gridAt(maps.moss, res, gx, gy));
      const amp = (1 - moss) * rakeFalloff(rc);
      const crest = amp * Math.cos(gridAt(maps.field, res, gx, gy) * k);
      const mot = gridAt(maps.mottle, res, gx, gy);
      const grain = hashPx(i, j);
      const shade = stoneShadeAt(wx, wz);

      // Cool near-black granite chippings. Kept dark: this is a night garden
      // and the furrows are read by their normals, not by their albedo.
      let r = 36 + mot * 7 + grain * 15 + crest * 9;
      let g = 44 + mot * 7 + grain * 15 + crest * 11;
      let b = 55 + mot * 7 + grain * 16 + crest * 13;
      // damp, darker gravel in the lee of a stone
      const damp = 1 - 0.34 * shade;
      r *= damp;
      g *= damp;
      b *= damp;

      if (moss > 0.004) {
        // Moss is the only warm-ish green in the frame; it wants to read as
        // velvet, so it gets its own grain and a darker torn rim.
        const rim = 0.72 + 0.28 * smooth01((moss - 0.06) / 0.34);
        const mr = (32 + grain * 13 + mot * 8) * rim;
        const mg = (58 + grain * 19 + mot * 12) * rim;
        const mb = (36 + grain * 12 + mot * 7) * rim;
        r += (mr - r) * moss;
        g += (mg - g) * moss;
        b += (mb - b) * moss;
      }

      const o = (j * size + i) * 4;
      px[o] = r < 0 ? 0 : r > 255 ? 255 : r;
      px[o + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
      px[o + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
      px[o + 3] = 255;
    }
  }
  c.putImageData(img, 0, 0);
}

/**
 * The matching relief. Tangent space here is (T,B,N) = (+x, +z, +y) because
 * the ground's UVs are world planar and un-rotated, so the height field's
 * x-slope goes in R, its z-slope in G and the up axis in B.
 */
function paintKaresansuiNormal(c: CanvasRenderingContext2D, size: number): void {
  const res = Math.max(64, size >> 1);
  const maps = rakeMapsFor(res);
  const img = c.createImageData(size, size);
  const px = img.data;
  const inv = GARDEN_SPAN / size;
  const spacing = rakeSpacing(size);
  const k = TAU / spacing;
  const scale = res / size;
  // pebble relief: read off the coarse grid by central difference
  const pStep = maps.step;

  for (let j = 0; j < size; j++) {
    const wz = GARDEN_SPAN / 2 - (j + 0.5) * inv;
    const gy = (j + 0.5) * scale - 0.5;
    for (let i = 0; i < size; i++) {
      const wx = (i + 0.5) * inv - GARDEN_SPAN / 2;
      const gx = (i + 0.5) * scale - 0.5;
      const rc = Math.hypot(wx, wz);
      const moss = clamp01(gridAt(maps.moss, res, gx, gy));
      const amp = (1 - moss) * rakeFalloff(rc);

      const v = gridAt(maps.field, res, gx, gy);
      const s = Math.sin(v * k) * amp * RAKE_DEPTH * k;
      let dx = -s * gridAt(maps.gradX, res, gx, gy);
      let dz = -s * gridAt(maps.gradZ, res, gx, gy);

      // gravel chippings, and a softer swell under the moss
      const pAmp = 0.016 + moss * 0.01;
      const px0 = gridAt(maps.pebble, res, gx - 0.5, gy);
      const px1 = gridAt(maps.pebble, res, gx + 0.5, gy);
      const pz0 = gridAt(maps.pebble, res, gx, gy - 0.5);
      const pz1 = gridAt(maps.pebble, res, gx, gy + 0.5);
      dx += (pAmp * (px1 - px0)) / pStep;
      dz -= (pAmp * (pz1 - pz0)) / pStep;

      const nx = -dx;
      const nz = -dz;
      const len = Math.hypot(nx, 1, nz);
      const o = (j * size + i) * 4;
      px[o] = Math.round(127.5 + (nx / len) * 127);
      px[o + 1] = Math.round(127.5 + (nz / len) * 127);
      px[o + 2] = Math.round(127.5 + (1 / len) * 127);
      px[o + 3] = 255;
    }
  }
  c.putImageData(img, 0, 0);
}

// --- painted surfaces ------------------------------------------------------

/** Hinoki: pale blond, dead-straight, very fine. Never a flat tan. */
function paintHinoki(c: CanvasRenderingContext2D, size: number): void {
  const g = c.createLinearGradient(0, 0, 0, size);
  // A stop down from where this started: hinoki is blond, but at the theme's
  // exposure #F2E7CE clipped to paper-white and the counter out-shouted the
  // salmon it is supposed to be serving.
  g.addColorStop(0, '#E4D7B6');
  g.addColorStop(0.5, '#DBCDA9');
  g.addColorStop(1, '#E2D5B1');
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
 * idempotent.
 *
 * Each petal now writes a real face normal alongside its position, which is
 * the whole difference between "lit" and "not". As flat emissive quads with a
 * hard-coded +Y normal they hung against the night like stickers; with the
 * plane's own normal they catch the key on one tumble and the warm rim on the
 * next, and the drift finally reads as something falling through light.
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
    // Biased outwards, and never inside PROP_R, so a petal can drift in FRONT
    // of the tower on screen but never through it in space.
    const r = PROP_R + 0.5 + rng.next() * rng.next() * 5.5;
    petals.push({
      x: Math.cos(a) * r,
      z: Math.sin(a) * r,
      top: deck + rng.range(3.2, 6.4),
      fall: rng.range(4.2, 7.4),
      speed: rng.range(0.4, 0.8),
      sway: rng.range(0.16, 0.5),
      phase: rng.range(0, TAU),
      spin: rng.range(0.45, 1.5) * (rng.bool() ? 1 : -1),
      // Half the first pass: at 0.14 a petal crossing the lens read as a pink
      // playing card, which is a very expensive way to break the illusion.
      w: rng.range(0.04, 0.075),
      h: rng.range(0.028, 0.05),
    });
  }

  const geo = new THREE.BufferGeometry();
  const attr = new THREE.BufferAttribute(position, 3);
  attr.setUsage(THREE.DynamicDrawUsage);
  const nAttr = new THREE.BufferAttribute(normal, 3);
  nAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', attr);
  geo.setAttribute('normal', nAttr);
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

      // face normal = u x v, the plane the petal is actually lying in
      let nx = -uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy;
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl;
      ny /= nl;
      nz /= nl;

      const o = i * 18;
      const set = (kk: number, sx: number, sy: number): void => {
        position[o + kk] = cx + ux * sx + vx * sy;
        position[o + kk + 1] = cy + vy * sy;
        position[o + kk + 2] = cz + uz * sx + vz * sy;
        normal[o + kk] = nx;
        normal[o + kk + 1] = ny;
        normal[o + kk + 2] = nz;
      };
      // A rhombus, not a rectangle: same two triangles, but the corners meet
      // on the axes so the silhouette is a petal rather than a pink tile.
      set(0, -1, 0);
      set(3, 0, -1);
      set(6, 1, 0);
      set(9, -1, 0);
      set(12, 1, 0);
      set(15, 0, 1);
    }
    attr.needsUpdate = true;
    nAttr.needsUpdate = true;
  };

  write(0);
  const m = new THREE.Mesh(geo, mat);
  m.frustumCulled = false;
  m.castShadow = false;
  m.receiveShadow = false;
  m.renderOrder = 3;
  // Drifting petals are ambient motion, which is exactly what a reduced-motion
  // reader asked us not to do. They still hang in the air; they just stop
  // falling. Queried once, not per frame.
  const still =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;
  if (!still) m.onBeforeRender = () => write(performance.now() * 0.001);
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
  // The fire chamber is FOUR CORNER POSTS, not a solid drum: a closed drum
  // sealed the glow inside where nothing could ever see it, which is the whole
  // reason the lantern is here.
  for (let k = 0; k < 4; k++) {
    const ca = yaw + (k * Math.PI) / 2 + Math.PI / 4;
    stone.add(
      at(envBox(0.14 * s, 0.5 * s, 0.14 * s), x + Math.cos(ca) * 0.31 * s, y + h, z + Math.sin(ca) * 0.31 * s, yaw),
      tone,
    );
  }
  glow.add(at(envCyl(0.29 * s, 0.3 * s, 0.4 * s, 8), x, y + h + 0.05 * s, z, yaw), 0xffcf96);
  h += 0.5 * s;
  stone.add(at(envCyl(0.82 * s, 0.86 * s, 0.07 * s, 8), x, y + h, z, yaw), tone);
  h += 0.06 * s;
  stone.add(at(envCyl(0.14 * s, 0.84 * s, 0.42 * s, 8), x, y + h, z, yaw), tone);
  h += 0.4 * s;
  const cap = envBlob(0.14 * s, 0);
  stone.add(at(cap, x, y + h + 0.1 * s, z), tone);
}

/** A weathered garden stone: rolled, bedded, never a ball on the ground. */
function gardenStone(
  rock: EnvBucket,
  rng: Rng,
  x: number, y: number, z: number,
  size: number,
  standing: boolean,
  detail: number,
  tone: number,
): void {
  const g = envBlob(size, detail);
  if (standing) g.scale(rng.range(0.6, 0.82), rng.range(1.25, 1.7), rng.range(0.62, 0.86));
  else g.scale(rng.range(1.1, 1.6), rng.range(0.42, 0.66), rng.range(1.0, 1.45));
  roughen(g, size * 0.16, 3.2, rng.int(0, 64));
  g.rotateX(rng.signed() * 0.16);
  g.rotateZ(rng.signed() * 0.16);
  // bedded: a stone is buried to a third of its depth, never balanced on top
  rock.add(at(g, x, y + size * (standing ? 0.5 : 0.24), z, rng.range(0, TAU)), tone);
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
  const h = 1.2;
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
    const rail = envRodX(0.045, 0.045, span, 5);
    rail.rotateY(yaw);
    wood.add(at(rail, cx, y + 0.26 + r * 0.38, cz), tone);
  }
}

/**
 * A teahouse wall: stone plinth, dark posts, a band of lit paper under a heavy
 * tiled eave.
 *
 * It used to be three units of glowing paper standing 4.2 above the garden,
 * which put its roofline straight through the horizon band and made it the
 * brightest object in the theme by a wide margin. Cut to a single low band of
 * shoji it still supplies the only warm light in the frame, but it now sits
 * UNDER the ridgelines where a garden wall belongs.
 */
function shojiWall(
  wood: EnvBucket,
  glow: EnvBucket,
  radius: number,
  bearing: number,
  span: number,
  y: number,
  bars: number,
): void {
  const h = 1.02;
  const sill = 0.52;
  const cx = Math.cos(bearing) * radius;
  const cz = Math.sin(bearing) * radius;
  const yaw = -bearing + Math.PI / 2;
  const nx = Math.cos(yaw);
  const nz = -Math.sin(yaw);

  // a stone plinth, so the lit paper is not hovering over the gravel
  wood.add(at(envBox(span + 0.9, sill, 1.5), cx, y, cz, yaw), 0x1e242a);
  glow.add(at(envBox(span, h, 0.1), cx, y + sill, cz, yaw), 0xffb877);
  // dark boarding above the paper, so the wall has mass without more light
  wood.add(at(envBox(span + 0.2, 0.62, 0.34), cx, y + sill + h, cz, yaw), 0x171310);
  // lattice: sits a few centimetres proud of the paper on the camera side
  const px = -Math.cos(bearing) * 0.09;
  const pz = -Math.sin(bearing) * 0.09;
  for (let i = 0; i <= bars; i++) {
    const u = (i / bars - 0.5) * span;
    wood.add(at(envBox(0.06, h, 0.05), cx + nx * u + px, y + sill, cz + nz * u + pz, yaw), 0x140f0d);
  }
  wood.add(at(envBox(span, 0.05, 0.05), cx + px, y + sill + h * 0.52, cz + pz, yaw), 0x140f0d);
  // eave: a deep dark overhang, which is what reads as a roof at this size
  wood.add(at(envBox(span + 1.15, 0.14, 1.15), cx, y + sill + h + 0.62, cz, yaw), 0x0e0b0a);
  wood.add(at(envBox(span + 0.8, 0.16, 0.7), cx, y + sill + h + 0.74, cz, yaw), 0x181310);
  // posts down to the ground
  for (const s of [-1, 1]) {
    wood.add(at(envBox(0.14, sill + h + 0.62, 0.14), cx + nx * (span / 2) * s, y, cz + nz * (span / 2) * s, yaw), 0x140f0d);
  }
}

// --- blossom ---------------------------------------------------------------

/** Where the key and the rim actually come from, so the mass can be graded. */
const KEY_DIR = new THREE.Vector3(-4.5, 4.72, 5.0).normalize();
const RIM_DIR = new THREE.Vector3(2.4, 5.6, -6.4).normalize();

const BLOSSOM_DEEP = new THREE.Color(0xb05e7d);
const BLOSSOM_MID = new THREE.Color(0xf5a8c2);
const BLOSSOM_PALE = new THREE.Color(0xffd6e4);
const BLOSSOM_LIGHT = new THREE.Color(0xfff5f9);
const BLOSSOM_HAZE = new THREE.Color(0x8fa2b4);
const BLOSSOM_TMP = new THREE.Color();
const BLOSSOM_TMP2 = new THREE.Color();

/**
 * Colour through the mass, which is the entire difference between a canopy and
 * a pink ball: deep dusky rose where a cluster faces away and sits inside the
 * crown, near-white where it faces the key on the outside of the silhouette.
 */
function blossomTint(lit: number, rim: number, out: number, fade: number): number {
  const t = smooth01(lit * 0.5 + 0.5);
  BLOSSOM_TMP.copy(BLOSSOM_DEEP).lerp(BLOSSOM_MID, smooth01(out * 0.55 + t * 0.55));
  BLOSSOM_TMP.lerp(BLOSSOM_PALE, t * t * out);
  BLOSSOM_TMP.lerp(BLOSSOM_LIGHT, 0.5 * t * t * t * out);
  // the warm rim catches the far edge of the crown
  if (rim > 0) BLOSSOM_TMP.lerp(BLOSSOM_TMP2.setRGB(1, 0.78, 0.7), 0.16 * rim * rim * out);
  return BLOSSOM_TMP.lerp(BLOSSOM_HAZE, fade).getHex();
}

/**
 * A cherry in blossom: flared trunk, a fan of limbs, and a crown built from
 * scattered clusters rather than a facet ball.
 *
 * The old canopy was seven icosahedra, and beyond about twelve units it read
 * as exactly what it was — pink hexagons. The fix is not more subdivision, it
 * is smaller forms: forty clusters of four to eight triangles each break the
 * silhouette, let the limbs show through the gaps, and carry their own colour
 * so the crown has depth instead of a single flat pink.
 */
function cherryTree(
  wood: EnvBucket,
  blossom: EnvBucket,
  rng: Rng,
  q: QualityTier,
  x: number, y: number, z: number,
  scale: number,
  fade: number,
  clusters: number,
): void {
  const bark = 0x53414a;
  const sides = q === 'low' ? 5 : 6;
  const trunkH = 1.9 * scale;
  const lean = rng.signed() * 0.11;

  // a root mound, so the trunk is visibly planted instead of stopping in the
  // dark. Without it the tree reads as a lollipop pasted onto the sky.
  const mound = envBlob(0.44 * scale, q === 'low' ? 0 : 1);
  mound.scale(1.6, 0.34, 1.6);
  wood.add(at(mound, x, y + 0.02 * scale, z, rng.range(0, TAU)), 0x241d22);
  // flare, then the shaft: a cherry swells hard at the ground
  wood.add(at(envCyl(0.17 * scale, 0.31 * scale, 0.34 * scale, sides), x, y, z), bark);
  const trunk = envCyl(0.1 * scale, 0.18 * scale, trunkH, sides);
  trunk.rotateZ(lean);
  wood.add(at(trunk, x, y + 0.32 * scale, z), bark);

  const tx = x - Math.sin(lean) * trunkH;
  const ty = y + 0.32 * scale + Math.cos(lean) * trunkH;
  const tz = z;

  // The crown is ONE umbrella: an oblate shell, much wider than it is tall,
  // filled with overlapping lumps and fringed with small ones. Five separate
  // lobes on five limbs read as five puffs of candyfloss; a cherry reads as a
  // single cloud with structure inside it.
  const crownR = rng.range(1.02, 1.42) * scale;
  const crownH = rng.range(0.44, 0.64) * scale;
  const limbs = q === 'low' ? 3 : 5;
  for (let i = 0; i < limbs; i++) {
    const a = (i / limbs) * TAU + rng.range(-0.5, 0.5);
    const reach = crownR * rng.range(0.45, 0.85);
    const ex = tx + Math.cos(a) * reach;
    const ey = ty + rng.range(0.1, 0.42) * scale;
    const ez = tz + Math.sin(a) * reach;
    wood.add(envStrut(tx, ty - 0.34 * scale, tz, ex, ey, ez, 0.028 * scale, 0.06 * scale, 4), bark);
    if (q !== 'low') {
      const ta = a + rng.range(-1.1, 1.1);
      const tr = crownR * rng.range(0.3, 0.6);
      wood.add(
        envStrut(
          ex, ey, ez,
          ex + Math.cos(ta) * tr, ey + rng.range(0.02, 0.24) * scale, ez + Math.sin(ta) * tr,
          0.014 * scale, 0.028 * scale, 4,
        ),
        bark,
      );
    }
  }

  /** Place one blossom form at a spherical offset inside the crown shell. */
  const put = (u: number, shell: number, up: number, size: number, small: boolean): void => {
    const ox = Math.cos(u) * crownR * shell;
    const oz = Math.sin(u) * crownR * shell;
    const oy = crownH * up;
    const len = Math.hypot(ox / crownR, oy / crownH, oz / crownR) || 1;
    const lit = (ox / crownR * KEY_DIR.x + (oy / crownH) * KEY_DIR.y + (oz / crownR) * KEY_DIR.z) / len;
    const rim = (ox / crownR * RIM_DIR.x + (oy / crownH) * RIM_DIR.y + (oz / crownR) * RIM_DIR.z) / len;
    const geo = small ? envTetra(size * 1.25) : envOcta(size);
    geo.scale(1.24, 0.8, 1.24);
    geo.rotateX(rng.signed() * 0.55);
    blossom.add(
      at(geo, tx + ox, ty + oy, tz + oz, rng.range(0, TAU)),
      blossomTint(lit, rim, clamp01(Math.hypot(shell, up * 0.7)), fade),
    );
  };

  // the body: a dozen fat lumps filling the umbrella
  const masses = q === 'low' ? 7 : q === 'medium' ? 10 : 13;
  for (let i = 0; i < masses; i++) {
    const u = (i / masses) * TAU + rng.range(-0.5, 0.5);
    put(
      u,
      i === 0 ? rng.range(0, 0.25) : rng.range(0.2, 0.72),
      rng.range(-0.45, 0.85),
      rng.range(0.27, 0.44) * scale,
      false,
    );
  }
  // the fringe: small forms out on the shell, which is what tears the outline
  for (let i = 0; i < clusters; i++) {
    const u = rng.range(0, TAU);
    const shell = 0.68 + 0.42 * Math.sqrt(rng.next());
    const small = rng.bool(0.55);
    put(
      u,
      shell,
      rng.range(-0.85, 1.05) * (1.15 - shell * 0.5),
      (small ? rng.range(0.075, 0.13) : rng.range(0.14, 0.23)) * scale,
      small,
    );
  }
}

// --- the horizon -----------------------------------------------------------

/**
 * Mount Fuji.
 *
 * The profile is the point. Fuji is not a triangle: its flanks are concave,
 * steep at the summit (about 32 degrees) and flattening to almost nothing at
 * the skirt, and the summit itself is a small rounded crown rather than a
 * point. That is `y = H (1 - u)^n` for `u = r/R` with n around 2.6, capped
 * with a quadratic that meets the flank tangentially, and it is instantly
 * recognisable where a cone is not.
 *
 * Only the top of the cone is built. The skirt of a mountain this size runs
 * halfway across the world and there is no terrain out there to bury it in, so
 * the mesh stops where the vertex alpha reaches zero and the rest of the
 * mountain is haze, which is also how it actually looks.
 */
/**
 * Solve for the world height that lands a given fraction down the frame at a
 * given distance from the camera, measured at the framing a run starts in:
 * eye 5.5 above the plate, 23 degree half-FOV, 0.5 rad of downward pitch.
 *
 * Everything on the horizon is authored through this rather than by world
 * size, because a tenth of a frame is the whole difference between a mountain
 * and a smudge, and the arithmetic that gets you there is not intuitive: the
 * top of frame is already 5.6 degrees BELOW the true horizon, so a hill
 * standing on the garden floor forty units out projects HIGHER than Fuji's
 * summit unless it is deliberately sunk below the floor plane.
 */
const CAM_EYE = 5.5;
const CAM_HALF_FOV = 0.4014;
const CAM_PITCH = 0.5;
function heightAtFrame(frac: number, distance: number): number {
  return CAM_EYE - distance * Math.tan(CAM_PITCH - CAM_HALF_FOV + frac * 2 * CAM_HALF_FOV);
}

const FUJI_R = 35;
const FUJI_H = 8.76;
const FUJI_N = 2.6;
const FUJI_U0 = 0.055;
/** Where the alpha fade starts and finishes, as heights up the full cone. */
const FUJI_FADE_LO = 1.8;
const FUJI_FADE_HI = 4.2;

function fujiProfile(u: number): number {
  if (u >= FUJI_U0) return FUJI_H * Math.pow(1 - u, FUJI_N);
  // quadratic cap, C1-continuous with the flank: a slightly flattened summit
  const k = (FUJI_N * FUJI_H * Math.pow(1 - FUJI_U0, FUJI_N - 1)) / (2 * FUJI_U0);
  const top = FUJI_H * Math.pow(1 - FUJI_U0, FUJI_N) + k * FUJI_U0 * FUJI_U0;
  return top - k * u * u;
}

/** Radius where the cone reaches a given height. Inverse of the flank. */
function fujiRadiusAt(h: number): number {
  const t = clamp01(h / FUJI_H);
  return (1 - Math.pow(t, 1 / FUJI_N)) * FUJI_R;
}

const FUJI_ROCK = new THREE.Color(0x1c2836);
const FUJI_ROCK_DARK = new THREE.Color(0x0a0f16);
/**
 * Snow, deliberately over-bright. At 60 units the exponential fog has already
 * eaten 60% of this before it reaches the frame, so a snowcap authored at
 * paper-white lands as mid-grey and Fuji becomes a bald hill. Vertex colours
 * are a straight linear multiplier and three does not clamp them, so the cap
 * is pushed past 1 and the fog brings it back to white.
 */
const FUJI_SNOW = new THREE.Color(0xcfe2f5).multiplyScalar(2.1);
const FUJI_TMP = new THREE.Color();

/**
 * @param seg  azimuthal segments — the snow tongues are only as ragged as this
 * @param rings vertical rings from the fade line up to the summit
 */
function buildFuji(seg: number, rings: number, baseY: number): THREE.BufferGeometry {
  const uMax = 1 - Math.pow(FUJI_FADE_LO / FUJI_H, 1 / FUJI_N);
  const pos: number[] = [];
  const nrm: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];

  // Snow line about a third down, with tongues running lower in the gullies.
  const snowLine = (a: number): number =>
    FUJI_H * (0.66 + 0.075 * Math.sin(a * 7.3 + 0.9) + 0.055 * Math.sin(a * 13.1 - 2.1) + 0.04 * Math.sin(a * 3.7 + 1.7));

  for (let ri = 0; ri <= rings; ri++) {
    const t = ri / rings;
    // pack the rings toward the summit, where the curvature lives
    const u = uMax * (1 - t) * (1 - t * 0.35);
    const h = fujiProfile(u);
    for (let si = 0; si < seg; si++) {
      const a = (si / seg) * TAU;
      // the mountain is not a solid of revolution: ridges and a broad shoulder
      const swell = 1 + 0.075 * Math.sin(a + 0.8) + 0.04 * Math.sin(a * 2 - 1.3) + 0.022 * Math.sin(a * 5 + 0.4);
      const rr = u * FUJI_R * swell;
      const y = h + 0.06 * FUJI_H * Math.sin(a * 3.1 + 2.2) * u;
      pos.push(Math.cos(a) * rr, baseY + y, Math.sin(a) * rr);
      // outward-and-up, which is close enough for something this hazed
      const slope = 0.42 + 0.5 * (1 - u);
      const nl = Math.hypot(1, slope);
      nrm.push(Math.cos(a) / nl, slope / nl, Math.sin(a) / nl);

      const sn = smooth01((y - snowLine(a)) / (FUJI_H * 0.045));
      FUJI_TMP.copy(FUJI_ROCK_DARK).lerp(FUJI_ROCK, smooth01(0.35 + Math.cos(a + 0.7) * 0.5));
      FUJI_TMP.lerp(FUJI_SNOW, sn);
      const alpha = smooth01((y - FUJI_FADE_LO) / (FUJI_FADE_HI - FUJI_FADE_LO));
      col.push(FUJI_TMP.r, FUJI_TMP.g, FUJI_TMP.b, alpha);
    }
  }
  for (let ri = 0; ri < rings; ri++) {
    const a0 = ri * seg;
    const b0 = a0 + seg;
    for (let si = 0; si < seg; si++) {
      const s1 = (si + 1) % seg;
      idx.push(a0 + si, b0 + si, a0 + s1);
      idx.push(a0 + s1, b0 + si, b0 + s1);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  g.setIndex(idx);
  return g;
}

/**
 * A ridgeline: a closed silhouette all the way round, whose top edge is fbm
 * and whose bottom dissolves. Two of them at different radii is what turns a
 * flat horizon into distance, and because it closes on itself there is no yaw
 * where the far edge of the garden is empty.
 */
function buildRidge(
  seg: number,
  radius: number,
  crestY: number,
  amp: number,
  drop: number,
  seed: number,
  tint: THREE.Color,
  peak: number,
): THREE.BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const rows = 3;

  for (let si = 0; si < seg; si++) {
    const a = (si / seg) * TAU;
    const wob = fbm2(Math.cos(a) * 5.5 + seed, Math.sin(a) * 5.5 - seed, 3);
    const wob2 = fbm2(Math.cos(a) * 13.5 - seed, Math.sin(a) * 13.5 + seed, 2);
    const top = crestY + amp * (wob * 0.8 + wob2 * 0.34);
    const rr = radius * (1 + 0.05 * wob);
    for (let ri = 0; ri <= rows; ri++) {
      const t = ri / rows;
      const y = top - t * drop;
      pos.push(Math.cos(a) * rr, y, Math.sin(a) * rr);
      // Straight up, not outward. A ridge normal that follows the azimuth
      // makes the hills bright on the key's side of the ring and invisible on
      // the other, which is a lighting swing the horizon cannot afford when
      // the camera turns a full circle.
      nrm.push(0, 1, 0);
      // brighter along the crest, where the sky rakes across the ridge
      const lift = 1 + peak * (1 - t) * (1 - t);
      const alpha = ri === 0 ? 1 : smooth01(1.3 - t * 2.2);
      col.push(tint.r * lift, tint.g * lift, tint.b * lift, alpha);
    }
  }
  for (let si = 0; si < seg; si++) {
    const a0 = si * (rows + 1);
    const b0 = ((si + 1) % seg) * (rows + 1);
    for (let ri = 0; ri < rows; ri++) {
      idx.push(a0 + ri, a0 + ri + 1, b0 + ri);
      idx.push(b0 + ri, a0 + ri + 1, b0 + ri + 1);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  g.setIndex(idx);
  return g;
}

/** DEV-ONLY probe: per-environment draw calls and triangles. Removed at the end. */
function envStats(name: string, root: THREE.Object3D): void {
  if (typeof window === 'undefined') return;
  let draws = 0;
  let tris = 0;
  root.traverse((o) => {
    const mm = o as THREE.Mesh;
    if (!mm.isMesh || !mm.geometry) return;
    draws++;
    const g = mm.geometry;
    const pos = g.getAttribute('position');
    tris += (g.index ? g.index.count : pos ? pos.count : 0) / 3;
  });
  const w = window as unknown as { __envStats?: Record<string, [number, number]> };
  w.__envStats = { ...(w.__envStats ?? {}), [name]: [draws, Math.round(tris)] };
}

// --- the build -------------------------------------------------------------

function sushiEnvironment(ctx: EnvBuildCtx): THREE.Object3D {
  const root = new THREE.Group();
  root.name = 'sushi.garden';

  const m = ctx.materials;
  const q = ctx.quality;
  const rng = ctx.rng;
  const topY = Number.isFinite(ctx.tableTopY) ? ctx.tableTopY : -0.3;
  const deck = topY - ENV_SINK;
  const floorY = deck - FLOOR_DROP;
  const detail = envPick(q, 0, 1, 1);

  // ---- materials (keyed by look; the library shares them across runs) ----
  const hinokiMat = m.standard('sushi.env.hinoki', {
    color: 0xffffff,
    map: m.texture('sushi.env.hinoki.map', paintHinoki, { size: 256, repeat: [0.1, 0.62] }),
    bumpMap: m.dataTexture('sushi.env.hinoki.bump', paintHinokiBump, { size: 256, repeat: [0.1, 0.62] }),
    bumpScale: 0.004,
    // Blond wood under a 2.6-intensity key was the second brightest surface in
    // the frame and it owned the bottom third of it. The answer is not more
    // brown paint — it is to stop the slab behaving like a mirror. At 0.4 the
    // whole top carried one broad specular sheet; at 0.68 it goes matte, the
    // env map contribution falls with it, and the salmon gets its highlight
    // back. The rest of the fix is the light pool baked in below.
    roughness: 0.68,
    metalness: 0,
    vertexColors: true,
  });
  const gravelMat = m.standard('sushi.env.karesansui', {
    color: 0xffffff,
    map: m.texture('sushi.env.karesansui.map', paintKaresansui, {
      size: 1024,
      repeat: [1, 1],
      wrap: THREE.ClampToEdgeWrapping,
    }),
    normalMap: m.dataTexture('sushi.env.karesansui.nrm', paintKaresansuiNormal, {
      size: 1024,
      repeat: [1, 1],
      wrap: THREE.ClampToEdgeWrapping,
    }),
    normalScale: 1.15,
    roughness: 0.93,
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
  const blossomMat = m.physical('sushi.env.blossom2', {
    color: 0xffffff,
    roughness: 0.82,
    metalness: 0,
    sheen: 0.9,
    sheenColor: 0xffd7e2,
    sheenRoughness: 0.55,
    // A whisper of self-light, no more. The clusters now carry their own
    // shading in vertex colour, so the emissive lift that used to keep the
    // shadow side off maroon can come most of the way back down — and the
    // crown finally has a dark side, which is what gives it volume.
    emissive: 0x2a1119,
    emissiveIntensity: 0.34,
    vertexColors: true,
  });
  const glowMat = m.standard('sushi.env.glow', {
    color: 0x120a06,
    emissive: 0xffb877,
    emissiveIntensity: 1.05,
    roughness: 1,
    metalness: 0,
    vertexColors: true,
  });
  const petalMat = m.physical('sushi.env.petal2', {
    // Lit, not emissive. A real albedo plus sheen means a petal turning
    // through the rim light flashes warm and then falls back to cool, which is
    // the whole reason to have them.
    color: 0xffdbe6,
    roughness: 0.72,
    metalness: 0,
    sheen: 1,
    sheenColor: 0xffffff,
    sheenRoughness: 0.35,
    emissive: 0x2a161e,
    emissiveIntensity: 0.3,
    transparent: true,
    opacity: 0.93,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const hazeMat = m.standard('sushi.env.haze', {
    color: 0xffffff,
    roughness: 1,
    metalness: 0,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const counter = new EnvBucket();
  const matte = new EnvBucket();
  const blossom = new EnvBucket();
  const glow = new EnvBucket();
  // On low the satin and wood families fold into the matte draw: a clearcoat
  // and a semi-gloss are a luxury next to holding the draw count down, and
  // every one of those props is under a hundred pixels on a phone.
  const satin = q === 'low' ? matte : new EnvBucket();
  const wood = q === 'low' ? matte : new EnvBucket();

  // ---- the counter -------------------------------------------------------
  // A single thick slab of hinoki, tessellated across the top so a pool of
  // lantern light can be baked into it.
  const slab = new THREE.BoxGeometry(COUNTER_W, COUNTER_T, COUNTER_D, envPick(q, 10, 14, 18), 1, envPick(q, 4, 6, 8));
  slab.translate(0, deck - COUNTER_T / 2, 0);
  /**
   * The counter's real problem was never its albedo, it was that a flat plane
   * two metres wide takes the key light evenly from end to end and therefore
   * reads as one enormous highlight. A bar is not lit like that: it is lit in
   * a pool around where the chef is working, and falls away into the dark at
   * both ends. Baked here rather than added as a light, because the rig is
   * three-point studio and shared by every theme.
   */
  const pool = (x: number, y: number, z: number): number => {
    const r = Math.hypot(x * 0.82, z);
    const fall = 1 - 0.74 * smooth01((r - 1.2) / 3.9);
    const lip = y < deck - COUNTER_T * 0.4 ? 0.55 : 1;
    return 0.94 * fall * lip;
  };
  counter.add(slab, 0xffffff, pool);
  // end grain: a hair proud of each short end so the edge reads as a cut face
  for (const s of [-1, 1]) {
    counter.add(
      at(envBox(0.05, COUNTER_T * 0.92, COUNTER_D * 0.985), s * (COUNTER_W / 2), deck - COUNTER_T * 0.96, 0),
      0xd8c8a4,
      pool,
    );
  }
  // a lacquered nosing along both long edges: the bevel, and a dark line that
  // stops the slab from meeting the gravel as one continuous pale field
  for (const s of [-1, 1]) {
    matte.add(
      at(envBox(COUNTER_W + 0.06, 0.075, 0.1), 0, deck - 0.075, s * (COUNTER_D / 2 + 0.02)),
      0x140f11,
    );
  }
  // recessed base, so the slab reads as thick and floating
  const baseH = FLOOR_DROP - COUNTER_T;
  matte.add(at(envBox(COUNTER_W * 0.78, baseH, COUNTER_D * 0.5), 0, floorY, 0), 0x2b2822);
  matte.add(at(envBox(COUNTER_W * 0.82, 0.09, COUNTER_D * 0.56), 0, floorY, 0), 0x1c1a16);

  // ---- on the counter ----------------------------------------------------
  // Everything on the bar is pushed down to the far ends of it: rule (b), out
  // past PROP_R and never more than PROP_LIFT proud of the counter.
  // PROP_R is a floor on the CENTRE; each prop is clamped with enough extra
  // margin that its widest reach — a chopstick tip, a twig — also clears.
  const [dishX, dishZ] = clearOf(4.35 + rng.range(-0.15, 0.2), 1.2 + rng.range(-0.12, 0.12), 4.75);
  satin.add(at(envCyl(0.42, 0.36, 0.11, 20), dishX, deck, dishZ), 0x0b1013);
  satin.add(at(envCyl(0.34, 0.34, 0.02, 20), dishX, deck + 0.075, dishZ), 0x241a12);

  const [restX, restZ] = clearOf(-(4.5 + rng.range(-0.1, 0.2)), -(1.2 + rng.range(-0.12, 0.12)), 4.85);
  const rest = pillow(0.44, 0.11, 0.17, { round: 0.75, segments: 12, squash: 0.45 });
  satin.add(at(rest, restX, deck, restZ, rng.range(-0.3, 0.3)), 0x22333c);
  for (let i = 0; i < 2; i++) {
    // laid along the bar and offset outboard, so even the inner tip clears
    const stick = envRodX(0.017, 0.026, 1.15, 6);
    stick.rotateY(-0.42);
    satin.add(at(stick, restX - 0.05, deck + 0.1 + i * 0.036, restZ - 0.14 + i * 0.055), 0x150f0d);
  }

  // a folded indigo cloth
  const [clothX, clothZ] = clearOf(-(4.4 + rng.range(0, 0.3)), 1.25 + rng.range(-0.12, 0.12), 4.9);
  matte.add(at(envBox(0.95, 0.05, 0.62), clothX, deck, clothZ, 0.22), 0x14243f);
  matte.add(at(envBox(0.86, 0.05, 0.5), clothX - 0.04, deck + 0.05, clothZ + 0.02, 0.18), 0x1b2f4e);

  // a single branch in a vase — the ikebana. Capped at PROP_LIFT.
  const [vaseX, vaseZ] = clearOf(4.4 + rng.range(0, 0.3), -(1.2 + rng.range(-0.12, 0.15)), 4.9);
  satin.add(at(envCyl(0.17, 0.24, 0.55, 14), vaseX, deck, vaseZ), 0x16323a);
  satin.add(at(envCyl(0.2, 0.17, 0.08, 14), vaseX, deck + 0.53, vaseZ), 0x1d3f47);
  const branch = envCyl(0.014, 0.032, 0.82, 5);
  branch.rotateZ(-0.22);
  wood.add(at(branch, vaseX, deck + 0.5, vaseZ), 0x3a2b2d);
  for (let i = 0; i < 3; i++) {
    const twig = envCyl(0.009, 0.018, rng.range(0.2, 0.32), 4);
    twig.rotateZ(rng.range(0.6, 1.1) * (i % 2 ? 1 : -1));
    twig.rotateY(rng.range(0, TAU));
    wood.add(at(twig, vaseX + 0.11 + i * 0.08, deck + 0.78 + i * 0.14, vaseZ - i * 0.06), 0x3a2b2d);
    for (let b = 0; b < 3; b++) {
      const s = rng.range(0.03, 0.055);
      const bud = rng.bool(0.5) ? envOcta(s) : envTetra(s * 1.2);
      blossom.add(
        at(
          bud,
          vaseX + 0.15 + i * 0.13 + rng.signed() * 0.07,
          deck + 0.88 + i * 0.16 + rng.range(0, 0.1),
          vaseZ - rng.next() * 0.14,
          rng.range(0, TAU),
        ),
        blossomTint(rng.range(-0.4, 1), 0, 1, 0),
      );
    }
  }

  // ---- the garden floor --------------------------------------------------
  const gseg = envPick(q, 30, 46, 64);
  const radii = envPick<readonly number[]>(
    q,
    [2.4, 7, 13, 20, 26, GROUND_R],
    [1.8, 4.2, 8, 12.5, 17, 21, 26, GROUND_R],
    [1.6, 3.4, 6.4, 10, 14, 18, 22, 26, GROUND_R],
  );
  // The fade has to start BEYOND the treeline or the trunks stand on nothing.
  const ground = envGround(radii, gseg, (r) => {
    const fade = 1 - smooth01((r - 19) / 11);
    const dark = 1 - 0.34 * smooth01((r - 3) / 21);
    return [dark, dark * 0.99, dark * 1.02, fade];
  });
  ground.translate(0, floorY, 0);
  const groundMesh = new THREE.Mesh(ground, gravelMat);
  groundMesh.castShadow = false;
  groundMesh.receiveShadow = false;
  groundMesh.renderOrder = -1;
  root.add(groundMesh);

  // ---- the stones --------------------------------------------------------
  // Fifteen stones in five groups, at the fixed bearings the rake was baked
  // around. Sizes descend inside a group so each one has a clear parent.
  for (const grp of STONE_GROUPS) {
    const grng = new Rng(grp.seed);
    const gx = Math.cos(grp.a) * grp.r;
    const gz = Math.sin(grp.a) * grp.r;
    for (let i = 0; i < grp.n; i++) {
      const a = grng.range(0, TAU);
      const rr = i === 0 ? 0 : grp.spread * (0.35 + 0.65 * Math.sqrt(grng.next()));
      const size = grp.tall * (i === 0 ? 1 : grng.range(0.42, 0.78));
      gardenStone(
        matte,
        grng,
        gx + Math.cos(a) * rr,
        floorY,
        gz + Math.sin(a) * rr,
        size,
        i === 0 && grp.n > 2,
        detail,
        grng.bool(0.6) ? 0x424a52 : 0x333b42,
      );
    }
    // a low moss swell under the group, so the stones sit in something
    const mound = envBlob(grp.spread * 1.5, detail);
    mound.scale(1.25, 0.16, 1.15);
    matte.add(
      at(mound, gx + Math.cos(grp.a + 1.9) * grp.spread * 0.5, floorY, gz + Math.sin(grp.a + 1.9) * grp.spread * 0.5, grng.range(0, TAU)),
      0x2c4630,
    );
  }
  // the three free moss islands get a swell too
  for (let i = 5; i < MOSS.length; i++) {
    const p = MOSS[i];
    const mound = envBlob(p.r * 0.92, detail);
    mound.scale(1.3, 0.13, 1.1);
    matte.add(at(mound, p.x, floorY, p.z, p.seed), 0x2c4630);
  }

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
  // reaches from the post out over the basin, tipped down at the mouth
  const spout = envRodX(0.06, 0.07, 1.15, 6);
  spout.rotateZ(-0.26);
  wood.add(at(spout, bx - 0.42, floorY + 1.46, bz + 0.24), 0x7d7850);
  // the thread of water, hung from the spout's mouth down to the basin
  satin.add(at(envCyl(0.013, 0.011, 0.33, 4), bx + 0.13, floorY + 0.99, bz + 0.24), 0x8fb6c4);

  // ---- background --------------------------------------------------------
  const fences = envPick(q, 4, 6, 8);
  for (let i = 0; i < fences; i++) {
    const bearing = (i / fences) * TAU + rng.range(-0.16, 0.16);
    bambooFence(wood, rng, rng.range(9.6, 10.8), bearing, rng.range(5.5, 7.5), floorY, 0x8d8a5c);
  }

  const lanterns = envPick(q, 3, 4, 5);
  for (let i = 0; i < lanterns; i++) {
    const a = (i / lanterns) * TAU + rng.range(-0.5, 0.5);
    const r = rng.range(FAR_R + 0.3, 12.5);
    stoneLantern(matte, glow, rng.range(0.85, 1.15), Math.cos(a) * r, floorY, Math.sin(a) * r, rng.range(0, TAU), 0x424a52);
  }

  // A near-continuous run of lit paper: the warm light behind the dark garden
  // is the only warm note in the theme and it has to be on screen at every
  // yaw — but low, so it sits under the ridgelines rather than through them.
  const walls = envPick(q, 4, 6, 7);
  for (let i = 0; i < walls; i++) {
    const bearing = (i / walls) * TAU + rng.range(-0.12, 0.12) + 0.6;
    shojiWall(wood, glow, rng.range(15.5, 17.5), bearing, rng.range(6.5, 8.5), floorY, envPick(q, 3, 4, 5));
  }

  // A treeline, not a lollipop: many small trees rather than a few big ones,
  // all planted inside the solid part of the ground so a trunk always has
  // earth under it, and with crowns topping out just above the counter plane
  // so the blossom bands beside the tower instead of massing behind its top.
  const trees = envPick(q, 16, 20, 24);
  const clusters = envPick(q, 20, 28, 34);
  for (let i = 0; i < trees; i++) {
    const a = (i / trees) * TAU + rng.range(-0.2, 0.2);
    const r = rng.range(10.8, 15.0);
    // a floor on the wash so even the nearest canopy is blossom-pink, not grey
    const fade = clamp((r - 10) / 24, 0.05, 0.24);
    cherryTree(
      wood,
      blossom,
      rng,
      q,
      Math.cos(a) * r,
      floorY,
      Math.sin(a) * r,
      rng.range(0.92, 1.26),
      fade,
      // the far half of the treeline is small on screen; spend the clusters
      // where they are actually resolvable
      Math.round(clusters * (r > 12.8 ? 0.62 : 1)),
    );
  }

  // ---- the horizon -------------------------------------------------------
  // Three depths, all drawn before the ground so they layer back to front:
  // Fuji, a far ridge, a near ridge. Each dissolves at its base rather than
  // standing on a line, because there is no terrain out there to stand on.
  const fujiSeg = envPick(q, 34, 52, 72);
  const fujiRings = envPick(q, 6, 9, 12);
  // On the play camera's axis, nudged a few degrees off so the cone is not a
  // perfectly centred hat on the tower. Fixed, never rolled: a landmark has a
  // place. The orbit swings it through frame; the ridges keep every other yaw
  // occupied, so no bearing is ever an empty horizon.
  const fujiA = Math.PI * 1.25 + 0.11;
  // 50 out from the middle, so 60 from the camera when it is looking straight
  // at it. The summit is pinned 8% down the frame; everything else on the
  // horizon then has to sit BELOW that, which is what the sunken ridge crests
  // below are doing.
  const fuji = buildFuji(fujiSeg, fujiRings, heightAtFrame(0.08, 60) - fujiProfile(0));
  fuji.translate(Math.cos(fujiA) * 50, 0, Math.sin(fujiA) * 50);

  // These carry RGB *and* alpha per vertex, so they cannot go through the
  // tinting buckets — those overwrite the colour attribute with a flat RGB and
  // the whole dissolve goes with it. Merged by hand, far layer first, so the
  // blend order runs back to front inside the single draw.
  const ridgeSeg = envPick(q, 48, 72, 96);
  const horizon = mergeAll([
    fuji,
    buildRidge(ridgeSeg, 39, heightAtFrame(0.138, 49), 1.15, 3.4, 5.3, new THREE.Color(0x1b2634), 0.42),
    buildRidge(ridgeSeg, 31, heightAtFrame(0.168, 41), 0.95, 3.2, 19.7, new THREE.Color(0x121a25), 0.32),
  ]);
  if (horizon) {
    const hm = new THREE.Mesh(horizon, hazeMat);
    hm.castShadow = false;
    hm.receiveShadow = false;
    hm.renderOrder = -6;
    hm.frustumCulled = false;
    root.add(hm);
  }

  // ---- assemble ----------------------------------------------------------
  const built = new Set<EnvBucket>();
  const add = (b: EnvBucket, mat: THREE.Material, cast: boolean, receive: boolean, order = 0): void => {
    if (built.has(b)) return;
    built.add(b);
    const mesh = b.build(mat, cast, receive);
    if (!mesh) return;
    mesh.renderOrder = order;
    root.add(mesh);
  };
  add(counter, hinokiMat, false, true);
  add(satin, satinMat, true, true);
  add(matte, matteMat, false, true);
  add(wood, woodMat, false, false);
  add(blossom, blossomMat, false, false);
  add(glow, glowMat, false, false);
  const petals = buildPetals(envPick(q, 12, 34, 56), deck, rng, petalMat);
  if (petals) root.add(petals);
  envStats('sushi', root);
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
    // Night, no disc, a cool moon halo and the only star field in the game.
    sky: SKY_PRESETS.sushi,
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
