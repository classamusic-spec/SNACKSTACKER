/**
 * CLASSIC DINER — the free, cozy default.
 *
 * Ingredient run (DESIGN.md order): sesame bun crown, beef patty, cheddar
 * slice, tomato, lettuce ruffle, pickle chips, bacon rashers, bottom bun.
 *
 * Silhouette discipline: the crown is a tall seeded dome, the patty is a squat
 * craggy puck with a proud seared rim, the cheddar is a thin sheet whose
 * corners droop to the deck, the tomato is a clean thin disc with a skin edge,
 * the lettuce is a frill, the pickles are separated chips with gaps between
 * them, the bacon is parallel wavy ribbons, and the heel is a flat-topped
 * squat disc. No two share a profile in black at 120px.
 */
import * as THREE from 'three';
import type { FoodBuildCtx, FoodDef, ThemeDef } from '../api';
import type { MaterialLibrary } from '../../render/api';
import { TAU } from '../../core/math';
import { droopSlab, mesh, puck, roughen, ruffle, scatter } from '../kit';
import {
  areaCount,
  baconPainter,
  charPainter,
  checkerPainter,
  coverCount,
  crumbBumpTex,
  cutRadius,
  cutSquare,
  discFace,
  finishLayer,
  fitGeoY,
  glazePainter,
  groundGeo,
  ceilGeo,
  leafVeinTex,
  mergeSafe,
  paintTomatoFlesh,
  pickQ,
  propSize,
  rasherRun,
  ringTorus,
  roughAmt,
  safe,
  specklePainter,
} from './shared-savory';

// ---------------------------------------------------------------------------
// materials — keyed by LOOK so all 60 layers share a handful of programs
// ---------------------------------------------------------------------------

const bunMat = (m: MaterialLibrary): THREE.Material =>
  m.physical('diner.bun', {
    color: 0xc98a4b,
    roughness: 0.86,
    sheen: 0.5,
    sheenColor: 0xffe9c9,
    sheenRoughness: 0.85,
    bumpMap: crumbBumpTex(m),
    bumpScale: 0.012,
  });

const bunCrumbMat = (m: MaterialLibrary): THREE.Material =>
  m.physical('diner.bunCrumb', {
    color: 0xf2dcb2,
    roughness: 0.95,
    sheen: 0.35,
    sheenColor: 0xfff4e0,
    bumpMap: crumbBumpTex(m),
    bumpScale: 0.02,
  });

const sesameMat = (m: MaterialLibrary): THREE.Material =>
  m.standard('diner.sesame', { color: 0xf3e2c0, roughness: 0.52 });

const pattyMat = (m: MaterialLibrary): THREE.Material =>
  m.standard('diner.patty', {
    color: 0x5c3a22,
    roughness: 0.72,
    map: m.texture('diner.charFine', charPainter(0xf0e9e0, 0x4a2f1c, 150, 5), { size: 256 }),
    bumpMap: crumbBumpTex(m),
    bumpScale: 0.03,
  });

const searMat = (m: MaterialLibrary): THREE.Material =>
  m.standard('diner.pattySear', {
    color: 0x3a2013,
    roughness: 0.6,
    map: m.texture('diner.charHeavy', charPainter(0xe8ded2, 0x2a1a10, 300, 9), { size: 256 }),
  });

const cheddarMat = (m: MaterialLibrary): THREE.Material =>
  m.physical('diner.cheddar', {
    color: 0xf0a830,
    roughness: 0.45,
    clearcoat: 0.34,
    clearcoatRoughness: 0.42,
  });

const tomatoMat = (m: MaterialLibrary): THREE.Material =>
  // The painted flesh map carries the #D8412F hue itself, so the base colour
  // stays neutral — otherwise the pale seeds would be multiplied back to red.
  m.physical('diner.tomato', {
    color: 0xfff4f0,
    roughness: 0.3,
    clearcoat: 0.6,
    clearcoatRoughness: 0.25,
    map: m.texture('diner.tomatoFlesh', paintTomatoFlesh, { size: 256 }),
  });

const tomatoSkinMat = (m: MaterialLibrary): THREE.Material =>
  m.physical('diner.tomatoSkin', {
    color: 0xc0392b,
    roughness: 0.28,
    clearcoat: 0.7,
    clearcoatRoughness: 0.18,
  });

const lettuceMat = (m: MaterialLibrary): THREE.Material =>
  m.standard('diner.lettuce', {
    color: 0x7fbf4b,
    roughness: 0.76,
    side: THREE.DoubleSide,
    // a lighter emissive tint fakes the light bleeding through a thin leaf
    emissive: 0x3d7a24,
    emissiveIntensity: 0.24,
    bumpMap: leafVeinTex(m),
    bumpScale: 0.006,
  });

const pickleMat = (m: MaterialLibrary): THREE.Material =>
  m.physical('diner.pickle', {
    color: 0xffffff,
    roughness: 0.4,
    clearcoat: 0.4,
    clearcoatRoughness: 0.3,
    map: m.texture(
      'diner.pickleSkin',
      specklePainter(
        0x5e8c31,
        [
          { color: 0x9bbf5b, count: 90, min: 0.006, max: 0.03, alpha: 0.55 },
          { color: 0x3d6420, count: 60, min: 0.004, max: 0.02, alpha: 0.5 },
          { color: 0xdcecb0, count: 26, min: 0.004, max: 0.012, alpha: 0.8 },
        ],
        { seed: 21, mottle: 20 },
      ),
      { size: 256 },
    ),
  });

const baconMat = (m: MaterialLibrary): THREE.Material =>
  m.standard('diner.bacon', {
    color: 0xffffff,
    roughness: 0.48,
    map: m.texture('diner.baconStripes', baconPainter(false, 3), { size: 256 }),
    bumpMap: crumbBumpTex(m),
    bumpScale: 0.012,
  });

// ---------------------------------------------------------------------------
// foods
// ---------------------------------------------------------------------------

const CROWN_DOME = 0.62;
const CROWN_TAPER = 0.12;

/**
 * Height of the crown's baked top surface at normalized radius q, in the space
 * the mesh ends up in. Derived from `puck`'s dome term so sesame seeds sit ON
 * the bread instead of hovering over the rim.
 */
function crownSurfaceY(q: number, height: number): number {
  return (height * (1 + CROWN_DOME * (1 - q * q) * 0.5)) / (1 + CROWN_DOME * 0.5);
}

const bunCrown: FoodDef = {
  id: 'diner.bun_crown',
  name: 'Sesame Bun Crown',
  glyph: '🍔',
  thickness: 0.62,
  tint: 0xc98a4b,
  tintAlt: 0xf3e2c0,
  build(ctx) {
    const g = new THREE.Group();
    const h = safe(ctx.height, 1e-3);
    const sq = cutSquare(ctx);
    const body = puck(safe(ctx.width), h, safe(ctx.depth), {
      wobble: 0.055 + ctx.rng.range(-0.012, 0.012),
      domed: CROWN_DOME,
      taper: CROWN_TAPER,
      radial: pickQ(ctx, 16, 26, 40),
      rings: pickQ(ctx, 3, 5, 7),
      seed: 3.1 + ctx.index * 0.37,
    });
    roughen(body, roughAmt(ctx, 0.016), 7, ctx.index * 1.7);
    fitGeoY(body, h);
    g.add(mesh(body, bunMat(ctx.materials)));

    // sesame seeds, placed along the dome so none of them float
    const n = areaCount(ctx, pickQ(ctx, 12, 20, 30));
    if (n > 0 && !ctx.offcut) {
      const len = propSize(ctx, 0.05, 0.072);
      const rng = ctx.rng.fork(11 + ctx.index);
      const seeds: THREE.BufferGeometry[] = [];
      for (let i = 0; i < n; i++) {
        const q = Math.sqrt(rng.next()) * 0.84;
        const a = rng.range(0, TAU);
        // follow the superellipse the kit morphs a cut puck into, so seeds sit
        // on the bread out to the corners instead of stopping at an ellipse
        const spread = (1 - CROWN_TAPER * q * q) * cutRadius(a, sq);
        const s = new THREE.SphereGeometry(0.5, 6, 4);
        s.scale(len, len * 0.4, len * 0.6);
        s.rotateY(rng.range(0, TAU));
        s.translate(
          (safe(ctx.width) / 2) * q * spread * Math.cos(a),
          crownSurfaceY(q, h) - len * 0.14,
          (safe(ctx.depth) / 2) * q * spread * Math.sin(a),
        );
        seeds.push(s);
      }
      const merged = mergeSafe(seeds);
      if (merged) g.add(mesh(merged, sesameMat(ctx.materials)));
    }
    return finishLayer(ctx, g);
  },
};

const beefPatty: FoodDef = {
  id: 'diner.patty',
  name: 'Beef Patty',
  glyph: '🥩',
  thickness: 0.52,
  tint: 0x5c3a22,
  tintAlt: 0x3a2013,
  build(ctx) {
    const g = new THREE.Group();
    const h = safe(ctx.height, 1e-3);
    const w = safe(ctx.width);
    const d = safe(ctx.depth);
    const radial = pickQ(ctx, 16, 26, 40);

    const body = puck(w, h * 0.94, d, {
      wobble: 0.085,
      domed: 0.22,
      radial,
      rings: pickQ(ctx, 3, 4, 6),
      seed: 7.7 + ctx.index * 0.61,
    });
    roughen(body, roughAmt(ctx, 0.055), 8, ctx.index * 2.3);
    fitGeoY(body, h);
    g.add(mesh(body, pattyMat(ctx.materials)));

    // The seared rim: a slightly proud, much rougher band around the waist.
    // 4.5% of the footprint, so even a 0.15 sliver overhangs by 3mm.
    const rim = puck(w * 1.045, h * 0.5, d * 1.045, {
      wobble: 0.13,
      domed: 0,
      radial,
      rings: 2,
      seed: 2.2 + ctx.index * 0.9,
      square: cutSquare(ctx),
    });
    roughen(rim, roughAmt(ctx, 0.07), 11, ctx.index * 3.1);
    groundGeo(rim, h * 0.2);
    g.add(mesh(rim, searMat(ctx.materials)));
    return finishLayer(ctx, g);
  },
};

const cheddarSlice: FoodDef = {
  id: 'diner.cheddar',
  name: 'Cheddar Slice',
  glyph: '🧀',
  thickness: 0.24,
  tint: 0xf0a830,
  tintAlt: 0xffd27a,
  build(ctx) {
    const h = safe(ctx.height, 1e-3);
    const geo = droopSlab(safe(ctx.width) * 0.99, h * 0.42, safe(ctx.depth) * 0.99, {
      droop: 0.55,
      segments: pickQ(ctx, 6, 10, 14),
      seed: 3 + ctx.index * 0.8,
      ripple: 0.34 + ctx.rng.range(-0.08, 0.08),
    });
    fitGeoY(geo, h);
    return finishLayer(ctx, mesh(geo, cheddarMat(ctx.materials)));
  },
};

const tomatoRound: FoodDef = {
  id: 'diner.tomato',
  name: 'Tomato',
  glyph: '🍅',
  thickness: 0.3,
  tint: 0xd8412f,
  tintAlt: 0xf7e5a3,
  build(ctx) {
    const g = new THREE.Group();
    const h = safe(ctx.height, 1e-3);
    const sq = cutSquare(ctx);
    const flesh = puck(safe(ctx.width) * 0.96, h, safe(ctx.depth) * 0.96, {
      wobble: 0.026,
      domed: 0.1,
      radial: pickQ(ctx, 20, 32, 46),
      rings: pickQ(ctx, 2, 3, 4),
      seed: 4.4 + ctx.index * 0.29,
      square: sq,
    });
    fitGeoY(flesh, h);
    g.add(mesh(flesh, tomatoMat(ctx.materials)));

    // the skin: a taut red edge that gives the disc a crisp silhouette
    const skin = ringTorus(
      safe(ctx.width),
      safe(ctx.depth),
      0.05,
      h * 0.44,
      pickQ(ctx, 5, 6, 8),
      pickQ(ctx, 20, 32, 48),
      sq,
    );
    skin.translate(0, h * 0.48, 0);
    g.add(mesh(skin, tomatoSkinMat(ctx.materials)));
    return finishLayer(ctx, g);
  },
};

const lettuceRuffle: FoodDef = {
  id: 'diner.lettuce',
  name: 'Lettuce Ruffle',
  glyph: '🥬',
  thickness: 0.36,
  tint: 0x7fbf4b,
  tintAlt: 0xcfe8a6,
  build(ctx) {
    const h = safe(ctx.height, 1e-3);
    const w = safe(ctx.width);
    const d = safe(ctx.depth);
    // The frill is built at 86% and peaks at ~1.33x, so it feathers ~14% past
    // the footprint — a lettuce leaf should peek out of a burger, but the
    // centre of mass stays well inside the cut.
    const sq = cutSquare(ctx);
    const band = ruffle(w * 0.86, h * 0.82, d * 0.86, {
      folds: 7 + (ctx.index % 4),
      amplitude: 0.26,
      seed: 5 + ctx.index * 0.7,
      segments: pickQ(ctx, 28, 48, 72),
      square: sq,
    });
    const heart = puck(w * 0.78, h * 0.4, d * 0.78, {
      wobble: 0.16,
      domed: 0.55,
      radial: pickQ(ctx, 14, 22, 32),
      rings: 2,
      seed: 9.1 + ctx.index * 0.4,
      square: sq,
    });
    roughen(heart, roughAmt(ctx, 0.07), 9, ctx.index * 1.3);
    const geo = mergeSafe([band, heart]);
    if (!geo) return finishLayer(ctx, new THREE.Group());
    fitGeoY(geo, h);
    return finishLayer(ctx, mesh(geo, lettuceMat(ctx.materials)));
  },
};

const pickleChips: FoodDef = {
  id: 'diner.pickle',
  name: 'Pickle Chips',
  glyph: '🥒',
  thickness: 0.26,
  tint: 0x5e8c31,
  tintAlt: 0x9bbf5b,
  build(ctx) {
    const h = safe(ctx.height, 1e-3);
    // Chip diameter tracks the SHORT axis, so on a 0.15 sliver the chips are
    // 7.5mm across instead of poking out either side.
    const chipD = propSize(ctx, 0.5, 0.62);
    const n = coverCount(ctx.width, ctx.depth, chipD, 0.62, pickQ(ctx, 6, 12, 20));
    const radial = pickQ(ctx, 12, 16, 22);
    const geo = scatter(
      n,
      safe(ctx.width),
      safe(ctx.depth),
      (i, rng) => {
        const s = rng.range(0.86, 1.06);
        const chip = puck(chipD * s, h * rng.range(0.86, 1), chipD * s, {
          wobble: 0.1,
          domed: 0.16,
          radial,
          rings: 2,
          seed: 3 + i * 1.7,
          // a chip is small because a chip is small — never a cut cross-section
          square: 0,
        });
        // crinkle cut — the ridge is the whole point of a pickle chip
        roughen(chip, Math.min(h * 0.1, chipD * 0.08), 15, i * 2.9);
        return chip;
      },
      {
        seed: 17 + ctx.index,
        y: 0,
        margin: chipD * 0.38,
        spacing: 0.14,
        randomYaw: true,
        randomTilt: 0.09,
      },
    );
    if (!geo) return finishLayer(ctx, new THREE.Group());
    return finishLayer(ctx, mesh(geo, pickleMat(ctx.materials)));
  },
};

const baconRashers: FoodDef = {
  id: 'diner.bacon',
  name: 'Bacon Rashers',
  glyph: '🥓',
  thickness: 0.28,
  tint: 0x9a3b24,
  tintAlt: 0xf2dcc0,
  build(ctx) {
    const h = safe(ctx.height, 1e-3);
    // Rashers always run along the LONG axis: a 0.15 x 2.4 sliver gets one
    // full-length rasher rather than a row of confetti.
    const geo = rasherRun(ctx.width, ctx.depth, h * 0.3, {
      maxStrips: pickQ(ctx, 2, 3, 4),
      minPitch: 0.17,
      wave: 0.46,
      curl: 0.5,
      seed: 5 + ctx.index * 1.3,
      segments: pickQ(ctx, 8, 12, 18),
    });
    if (!geo) return finishLayer(ctx, new THREE.Group());
    fitGeoY(geo, h);
    return finishLayer(ctx, mesh(geo, baconMat(ctx.materials)));
  },
};

const bottomBun: FoodDef = {
  id: 'diner.bun_heel',
  name: 'Bottom Bun',
  glyph: '🍞',
  thickness: 0.44,
  tint: 0xc98a4b,
  tintAlt: 0xf0dcb4,
  build(ctx) {
    const g = new THREE.Group();
    const h = safe(ctx.height, 1e-3);
    const w = safe(ctx.width);
    const d = safe(ctx.depth);
    const radial = pickQ(ctx, 16, 26, 38);
    const body = puck(w, h, d, {
      wobble: 0.05 + ctx.rng.range(-0.01, 0.01),
      domed: 0.08,
      radial,
      rings: pickQ(ctx, 3, 4, 6),
      seed: 12.3 + ctx.index * 0.53,
    });
    roughen(body, roughAmt(ctx, 0.014), 7, ctx.index * 1.1);
    fitGeoY(body, h);
    g.add(mesh(body, bunMat(ctx.materials)));

    // the pale cut face — this is what makes a heel read as a heel
    const face = puck(w * 0.965, h * 0.22, d * 0.965, {
      wobble: 0.045,
      domed: 0.12,
      radial,
      rings: 2,
      seed: 5.5 + ctx.index * 0.31,
      square: cutSquare(ctx),
    });
    ceilGeo(face, h);
    g.add(mesh(face, bunCrumbMat(ctx.materials)));
    return finishLayer(ctx, g);
  },
};

// ---------------------------------------------------------------------------
// plate & scenery
// ---------------------------------------------------------------------------

const plateThickness = (ctx: FoodBuildCtx): number =>
  ctx.height > 0.02 ? ctx.height : 0.17;

const chromeMat = (m: MaterialLibrary): THREE.Material =>
  m.standard('diner.chrome', { color: 0xc9d0d8, metalness: 0.88, roughness: 0.34 });

function dinerPlate(ctx: FoodBuildCtx): THREE.Object3D {
  const g = new THREE.Group();
  const m = ctx.materials;
  const t = plateThickness(ctx);
  const w = safe(ctx.width, 0.2);
  const d = safe(ctx.depth, 0.2);
  const radial = pickQ(ctx, 24, 40, 60);

  // Built DOWNWARD: the plate occupies y in [-t, 0] so its top face is exactly
  // y = 0 and the tower's first layer lands flush on it.
  const body = puck(w * 0.94, Math.max(t - 0.004, t * 0.5), d * 0.94, {
    wobble: 0.003,
    domed: 0,
    radial,
    rings: 2,
    seed: 1.1,
    // a plate is never cut, so it stays round whatever the footprint does
    square: 0,
  });
  groundGeo(body, -t);
  g.add(
    mesh(
      body,
      m.standard('diner.plateBody', { color: 0xefe8d8, roughness: 0.4 }),
      { cast: false },
    ),
  );

  // off-white melamine face, sitting exactly on y = 0
  // Stops short of the rim tube: coplanar overlap here z-fights into dashes.
  const face = discFace(w * 0.79, d * 0.79, radial);
  g.add(
    mesh(
      face,
      m.standard('diner.plateFace', {
        color: 0xffffff,
        roughness: 0.3,
        map: m.texture('diner.plateGlaze', glazePainter(0xf6f1e4, 0xe6dcc4, 0.4, 0.452), {
          size: 256,
          wrap: THREE.ClampToEdgeWrapping,
        }),
      }),
      { cast: false },
    ),
  );

  // the chrome rim: outer edge exactly on the footprint, crest exactly on y = 0
  const rim = ringTorus(w, d, 0.055, t * 0.46, pickQ(ctx, 6, 8, 10), pickQ(ctx, 24, 40, 64));
  rim.translate(0, -t * 0.46 - 0.03, 0);
  g.add(mesh(rim, chromeMat(m), { cast: false }));
  return g;
}

function dinerScenery(ctx: FoodBuildCtx): THREE.Object3D {
  const g = new THREE.Group();
  const m = ctx.materials;
  const w = safe(ctx.width, 0.4);
  const floorY = -plateThickness(ctx) - 0.006;

  const floor = discFace(w * 3.0, w * 3.0, pickQ(ctx, 24, 40, 64));
  floor.translate(0, floorY, 0);
  g.add(
    mesh(
      floor,
      m.standard('diner.floor', {
        color: 0xffffff,
        roughness: 0.44,
        map: m.texture('diner.checker', checkerPainter(0xf3ede0, 0x2b2b33, 4), {
          size: 256,
          repeat: [3.5, 3.5],
        }),
      }),
      { cast: false, receive: true },
    ),
  );

  // a chrome napkin dispenser, kept to a silhouette and pushed well clear of
  // the tower footprint (the plate is already 1.35x the base footprint)
  const bw = w * 0.16;
  const bh = w * 0.19;
  const box = new THREE.BoxGeometry(bw, bh, bw * 0.52);
  groundGeo(box, floorY);
  box.translate(w * 0.78, 0, -w * 0.6);
  g.add(mesh(box, chromeMat(m), { receive: false }));

  const napkin = new THREE.BoxGeometry(bw * 0.72, bh * 0.1, bw * 0.16);
  groundGeo(napkin, floorY + bh);
  napkin.translate(w * 0.78, 0, -w * 0.6);
  g.add(
    mesh(napkin, m.standard('diner.napkin', { color: 0xfaf6ec, roughness: 0.92 }), {
      receive: false,
    }),
  );
  return g;
}

// ---------------------------------------------------------------------------
// theme
// ---------------------------------------------------------------------------

export const dinerTheme: ThemeDef = {
  id: 'diner',
  name: 'Classic Diner',
  tagline: 'Burgers, syrup, the cozy default.',
  glyph: '🍔',
  price: 0,
  palette: {
    bgTop: 0xffe7c4,
    bgBottom: 0xe07a5f,
    fog: 0xf2b48c,
    fogDensity: 0.014,
    key: 0xfff1dc,
    keyIntensity: 2.6,
    fill: 0x8fb8de,
    fillIntensity: 0.6,
    rim: 0xffd9a0,
    rimIntensity: 1.4,
    ground: 0xb4523c,
    accent: 0xe23e57,
    accentSoft: 0xffb4a2,
    bloomStrength: 0.42,
    exposure: 1.06,
    vignette: 0.35,
  },
  foods: [
    bunCrown,
    beefPatty,
    cheddarSlice,
    tomatoRound,
    lettuceRuffle,
    pickleChips,
    baconRashers,
    bottomBun,
  ],
  hero: [7, 1, 2, 3, 4, 0],
  plate: dinerPlate,
  scenery: dinerScenery,
  ambience: 'diner',
};
