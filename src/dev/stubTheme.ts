import * as THREE from 'three';
import type { FoodBuildCtx, FoodDef, ThemeDef } from '../content/api';
import { puck, roundedBox } from '../content/kit';

/**
 * A deliberately trivial theme used only by the dev sandbox, so render, vfx,
 * audio and ui can be exercised without depending on authored content.
 */
const slab = (
  id: string,
  name: string,
  tint: number,
  thickness: number,
  round: boolean,
): FoodDef => ({
  id,
  name,
  glyph: '🍽️',
  thickness,
  tint,
  build(ctx: FoodBuildCtx) {
    const geo = round
      ? puck(ctx.width, ctx.height, ctx.depth, { domed: 0.2, radial: 28, rings: 4 })
      : roundedBox(ctx.width, ctx.height, ctx.depth, Math.min(ctx.width, ctx.depth, ctx.height) * 0.2, 2);
    const mat = ctx.materials.standard(`stub.${id}`, { color: tint, roughness: 0.6 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  },
});

export const stubTheme: ThemeDef = {
  id: 'diner',
  name: 'Sandbox',
  tagline: 'Stub content for subsystem testing.',
  glyph: '🧪',
  price: 0,
  ambience: 'diner',
  palette: {
    bgTop: 0xffe7c4,
    bgBottom: 0xe07a5f,
    fog: 0xf2b48c,
    fogDensity: 0.015,
    key: 0xfff1dc,
    keyIntensity: 2.6,
    fill: 0x8fb8de,
    fillIntensity: 0.6,
    rim: 0xffd9a0,
    rimIntensity: 1.4,
    ground: 0xb4523c,
    accent: 0xe23e57,
    accentSoft: 0xffb4a2,
    bloomStrength: 0.45,
    exposure: 1.05,
    vignette: 0.35,
  },
  foods: [
    slab('a', 'Round A', 0xc98a4b, 0.5, true),
    slab('b', 'Square B', 0x5c3a22, 0.42, false),
    slab('c', 'Round C', 0xf0a830, 0.3, true),
    slab('d', 'Square D', 0xd8412f, 0.36, false),
  ],
  plate(ctx: FoodBuildCtx) {
    const geo = puck(ctx.width, 0.22, ctx.width, { domed: 0, radial: 40, rings: 2 });
    geo.translate(0, -0.22, 0);
    const mat = ctx.materials.standard('stub.plate', {
      color: 0xf4f0e8,
      roughness: 0.35,
      metalness: 0.05,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    return mesh;
  },
};
