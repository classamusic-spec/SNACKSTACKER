/**
 * TEMPORARY (Recipe Rush build harness) — geometry cost probe.
 *
 * Builds every theme's eight foods at tray-token size and at layer size and
 * reports mesh count / triangle count / distinct materials, so the tray budget
 * can be planned before a single frame is rendered. No WebGL involved.
 *
 * Delete with the rest of the `recipe-` dev files.
 */
import * as THREE from 'three';
import type { FoodBuildCtx, FoodDef } from '../content/api';
import { themes } from '../content';
import { Rng } from '../core/rng';
import { createMaterialLibrary } from '../render/MaterialLibrary';
import type { QualityTier } from '../core/types';

interface Row {
  theme: string;
  food: string;
  meshes: number;
  tris: number;
  mats: string;
}

function measure(obj: THREE.Object3D): { meshes: number; tris: number; mats: Set<THREE.Material> } {
  let meshes = 0;
  let tris = 0;
  const mats = new Set<THREE.Material>();
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    meshes++;
    const g = m.geometry as THREE.BufferGeometry;
    const idx = g.getIndex();
    tris += (idx ? idx.count : g.getAttribute('position')?.count ?? 0) / 3;
    const mat = m.material;
    if (Array.isArray(mat)) mat.forEach((x) => mats.add(x));
    else mats.add(mat);
  });
  return { meshes, tris: Math.round(tris), mats };
}

const renderer = new THREE.WebGLRenderer({ canvas: document.createElement('canvas') });

function run(size: number, quality: QualityTier, offcut: boolean): Row[] {
  const materials = createMaterialLibrary({ renderer, quality });
  const rows: Row[] = [];
  for (const theme of themes.all) {
    theme.foods.forEach((food: FoodDef, i: number) => {
      const ctx: FoodBuildCtx = {
        width: size,
        depth: size,
        height: Math.max(food.thickness * (size / 2.4), 0.05),
        index: i,
        rng: new Rng(1234 + i),
        quality,
        materials,
        offcut,
      };
      let obj: THREE.Object3D;
      try {
        obj = food.build(ctx);
      } catch (e) {
        rows.push({ theme: theme.id, food: food.id, meshes: -1, tris: -1, mats: String(e) });
        return;
      }
      const m = measure(obj);
      rows.push({ theme: theme.id, food: food.id, meshes: m.meshes, tris: m.tris, mats: String(m.mats.size) });
    });
  }
  materials.dispose();
  return rows;
}

const out: Record<string, Row[]> = {
  tokenHigh: run(0.66, 'high', false),
  tokenHighOffcut: run(0.66, 'high', true),
  tokenLow: run(0.66, 'low', false),
  layerHigh: run(2.4, 'high', false),
};
(window as unknown as { __probe: unknown }).__probe = out;
document.title = 'probe-done';
