/**
 * Sushi Tower — the dark, cinematic theme.
 *
 * Everything here is lit to be read against a near-black lacquer board: the
 * rim light does the silhouette work and the specular does the "fresh fish"
 * work. Salmon is the hero and gets the most expensive treatment in the file
 * (a painted fat-striation albedo, clearcoat and a little transmission).
 */
import * as THREE from 'three';
import type { FoodBuildCtx, FoodDef, ThemeDef } from '../api';
import { Rng } from '../../core/rng';
import { TAU, clamp } from '../../core/math';
import { mergeAll, mesh, pillow, puck, roughen, roundedBox, droopSlab, tintGeometry } from '../kit';
import {
  areaRatio,
  discXZ,
  fillFlat,
  fillGradient,
  finalize,
  hexCss,
  longAxis,
  noiseWash,
  propCount,
  propScale,
  ribbon,
  safeD,
  safeH,
  safeRadius,
  safeW,
  scatterOnSurface,
  seg,
  sheet,
  softStroke,
  speckle,
  topSampler,
  weave,
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

function paintTatami(c: CanvasRenderingContext2D, size: number): void {
  weave(c, size, 16, '#C9B98A', '#B7A578', '#8E7F58');
  noiseWash(c, size, 4, 0.2, 17, '#4A3F26', '#E8DDBC');
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
    color: 0xff7a55,
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
    color: 0x1b2b1e,
    map: ctx.materials.texture('sushi.nori.albedo', paintNori, { size: 128 }),
    bumpMap: ctx.materials.dataTexture('sushi.nori.bump', paintNoriBump, { size: 128 }),
    bumpScale: 0.006,
    roughness: 0.85,
    metalness: 0,
    side: THREE.DoubleSide,
  });

const tamagoMat = (ctx: FoodBuildCtx): THREE.Material =>
  ctx.materials.standard('sushi.tamago', {
    color: 0xf5c542,
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
    propCount(ctx, 120, 4),
    w,
    d,
    surface,
    (_i, rng) => {
      const cap = new THREE.CapsuleGeometry(
        gr * rng.range(0.8, 1.15),
        gr * rng.range(2, 3.2),
        2,
        seg(ctx, 7, 6, 4),
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
    arch: h * 0.7,
    wave: h * 0.14,
    waveFreq: 2.2,
    curlEdges: h * 0.2,
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
  const shardLen = step * 1.9;
  const shardThk = h * 0.46;
  const shardWid = S * 0.94;
  const tilt = clamp((h - shardThk) / Math.max(shardLen, 1e-4), 0.06, 0.5);
  const angle = Math.asin(clamp(tilt, 0, 0.85));

  const bodies: THREE.BufferGeometry[] = [];
  const inners: THREE.BufferGeometry[] = [];

  for (let i = 0; i < n; i++) {
    const at = -L / 2 + step * (i + 0.5);
    const body = pillow(
      alongX ? shardLen : shardWid,
      shardThk,
      alongX ? shardWid : shardLen,
      { round: 0.8, segments: seg(ctx, 18, 13, 9), squash: 0.55 },
    );
    body.translate(0, -shardThk / 2, 0);
    if (alongX) body.rotateZ(angle);
    else body.rotateX(-angle);
    body.translate(alongX ? at : 0, h * 0.5, alongX ? 0 : at);
    bodies.push(body);

    if (!ctx.offcut) {
      const inner = pillow(
        alongX ? shardLen * 0.9 : shardWid * 0.34,
        shardThk * 0.5,
        alongX ? shardWid * 0.34 : shardLen * 0.9,
        { round: 0.85, segments: seg(ctx, 12, 9, 6), squash: 0.6 },
      );
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
  const rad = seg(ctx, 8, 6, 5);
  const ring = seg(ctx, 6, 5, 4);

  const lower = scatterOnSurface(
    propCount(ctx, 150, 5),
    w,
    d,
    surface,
    (_i, rng) => new THREE.SphereGeometry(r * rng.range(0.85, 1.15), rad, ring),
    { seed: ctx.index * 7 + 2, margin: r * 1.25, spacing: 0.028, sink: r * 0.45, randomYaw: false },
  );
  const upper = ctx.offcut
    ? null
    : scatterOnSurface(
        propCount(ctx, 62, 2),
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
  const board = roundedBox(w, PLATE_SLAB, d, safeRadius(Math.min(w, d) * 0.035, w, d, PLATE_SLAB), 3);
  board.translate(0, -PLATE_SLAB, 0);
  g.add(mesh(board, lacquer));

  // a fine inset bevel that catches the rim light
  const inlayT = PLATE_SLAB * 0.34;
  const inlay = roundedBox(
    w * 0.955,
    inlayT,
    d * 0.955,
    safeRadius(Math.min(w, d) * 0.03, w, d, inlayT),
    2,
  );
  inlay.translate(0, -inlayT + 0.0015, 0);
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

function buildScenery(ctx: FoodBuildCtx): THREE.Object3D {
  const g = new THREE.Group();
  const w = Math.max(ctx.width, 1);
  const groundY = -PLATE_T;

  const tatami = ctx.materials.standard('sushi.tatami', {
    color: 0xbcae83,
    map: ctx.materials.texture('sushi.tatami.albedo', paintTatami, { size: 256, repeat: [3, 3] }),
    roughness: 0.88,
    metalness: 0,
  });
  const wood = ctx.materials.standard('sushi.chopstick', {
    color: 0x3a2a22,
    roughness: 0.52,
    metalness: 0,
  });
  const ceramic = ctx.materials.physical('sushi.rest', {
    color: 0x1d2b33,
    roughness: 0.24,
    metalness: 0,
    clearcoat: 0.7,
    clearcoatRoughness: 0.12,
  });

  // tatami weave disc, sitting just under the board
  const matR = w * 1.85;
  const disc = new THREE.CylinderGeometry(matR, matR, 0.06, seg(ctx, 48, 36, 20), 1);
  disc.translate(0, groundY - 0.03, 0);
  const dm = mesh(disc, tatami, { cast: false, receive: true });
  g.add(dm);

  // chopstick rest
  const rest = pillow(w * 0.16, 0.075, w * 0.08, { round: 0.7, segments: 14, squash: 0.4 });
  rest.translate(w * 0.86, groundY, -w * 0.42);
  g.add(mesh(rest, ceramic));

  // a pair of chopsticks resting on it
  const len = w * 1.05;
  for (let i = 0; i < 2; i++) {
    const off = (i - 0.5) * 0.055;
    const stick = new THREE.CylinderGeometry(0.017, 0.026, len, 7, 1);
    stick.rotateZ(Math.PI / 2);
    stick.rotateY(-0.34);
    stick.translate(w * 0.86 + len * 0.12, groundY + 0.075, -w * 0.42 + off + len * 0.28);
    g.add(mesh(stick, wood));
  }

  return g;
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
  plate: buildPlate,
  scenery: buildScenery,
  ambience: 'sushi',
};
