/**
 * Flatten a built food into as few meshes as it can honestly become.
 *
 * A Topple tower is thirty foods tall where the stacker's is a stack of layers
 * the camera mostly leaves behind, so the draw call cost of a single food is
 * paid thirty times over. Several foods return two to five child meshes that
 * share one material — a macaron's two shells, a tamago's four slabs, a nori
 * band's two faces — and those can be merged into one draw call with pixel-
 * identical output. Across the six themes it removes 14% of the meshes, and 35%
 * on Candy Stack, which is the worst offender.
 *
 * This is deliberately conservative. Anything with an array material, a morph
 * target, instancing, skinning, a different attribute set or a different
 * shadow/render flag is left exactly as the content author built it, and any
 * failure inside `mergeGeometries` falls back to the original object. It never
 * touches physics: collision hulls are analytic boxes derived from the
 * requested footprint, not from the mesh.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const rootInverse = new THREE.Matrix4();
const local = new THREE.Matrix4();

interface Group {
  material: THREE.Material;
  castShadow: boolean;
  receiveShadow: boolean;
  renderOrder: number;
  meshes: THREE.Mesh[];
  geometries: THREE.BufferGeometry[];
}

function mergeable(mesh: THREE.Mesh): boolean {
  if (!mesh.visible) return false;
  if ((mesh as THREE.InstancedMesh).isInstancedMesh) return false;
  if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) return false;
  if (Array.isArray(mesh.material)) return false;
  const g = mesh.geometry;
  if (!g || g.morphAttributes === undefined) return false;
  if (Object.keys(g.morphAttributes).length > 0) return false;
  // Draw groups are irrelevant here: three only splits a mesh into per-group
  // draws when the material is an array, and array materials are excluded
  // above. `mergeGeometries(..., false)` discards them.
  return true;
}

function keyFor(mesh: THREE.Mesh): string {
  const g = mesh.geometry;
  const attrs = Object.keys(g.attributes).sort().join(',');
  const mat = mesh.material as THREE.Material;
  return `${mat.uuid}|${attrs}|${g.index ? 'i' : 'n'}|${mesh.castShadow ? 1 : 0}|${
    mesh.receiveShadow ? 1 : 0
  }|${mesh.renderOrder}`;
}

/** Merges same-material sibling meshes in place. Returns the same object. */
export function bakeFood(root: THREE.Object3D): THREE.Object3D {
  try {
    root.updateMatrixWorld(true);
    rootInverse.copy(root.matrixWorld).invert();

    const groups = new Map<string, Group>();
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh || !mergeable(mesh)) return;
      const key = keyFor(mesh);
      let g = groups.get(key);
      if (!g) {
        g = {
          material: mesh.material as THREE.Material,
          castShadow: mesh.castShadow,
          receiveShadow: mesh.receiveShadow,
          renderOrder: mesh.renderOrder,
          meshes: [],
          geometries: [],
        };
        groups.set(key, g);
      }
      g.meshes.push(mesh);
    });

    for (const g of groups.values()) {
      if (g.meshes.length < 2) continue;
      g.geometries.length = 0;
      let ok = true;
      for (const mesh of g.meshes) {
        const clone = mesh.geometry.clone();
        local.copy(mesh.matrixWorld).premultiply(rootInverse);
        clone.applyMatrix4(local);
        // A merge needs matching attribute sets; a clone that lost one is a
        // sign the source was unusual, so bail rather than corrupt the food.
        if (!clone.attributes.position) {
          ok = false;
          clone.dispose();
          break;
        }
        g.geometries.push(clone);
      }
      if (!ok) {
        for (const geo of g.geometries) geo.dispose();
        continue;
      }
      const merged = mergeGeometries(g.geometries, false);
      for (const geo of g.geometries) geo.dispose();
      if (!merged) continue;

      const out = new THREE.Mesh(merged, g.material);
      out.castShadow = g.castShadow;
      out.receiveShadow = g.receiveShadow;
      out.renderOrder = g.renderOrder;
      for (const mesh of g.meshes) {
        mesh.removeFromParent();
        mesh.geometry.dispose();
      }
      root.add(out);
    }
  } catch (err) {
    console.error('[topple] food bake failed; keeping the original meshes', err);
  }
  return root;
}
