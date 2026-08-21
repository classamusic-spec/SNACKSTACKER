import * as THREE from 'three';

/**
 * Tiny hand-built base geometries for the particle classes. Built from raw
 * typed arrays so nothing is shared with (or accidentally disposed by) the
 * render agent's geometry cache.
 */

/** Unit quad on XY, centred, with uv 0..1. 4 verts / 2 tris. */
export function quadGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  // prettier-ignore
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    -0.5, -0.5, 0,
     0.5, -0.5, 0,
     0.5,  0.5, 0,
    -0.5,  0.5, 0,
  ]), 3));
  // prettier-ignore
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([
    0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
  ]), 3));
  // prettier-ignore
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([
    0, 0, 1, 0, 1, 1, 0, 1,
  ]), 2));
  g.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1));
  return g;
}

/**
 * An irregular tetrahedral shard — a crumb. Non-indexed with flat face
 * normals so each face catches the key light differently as it tumbles.
 * Roughly unit diameter, so `size` reads as world units.
 */
export function shardGeometry(): THREE.BufferGeometry {
  // prettier-ignore
  const v = [
    0.02, 0.58, 0.06,
    -0.52, -0.26, 0.44,
    0.56, -0.22, 0.30,
    0.06, -0.32, -0.58,
  ];
  const faces = [0, 1, 2, 0, 2, 3, 0, 3, 1, 1, 3, 2];
  const positions = new Float32Array(faces.length * 3);
  const normals = new Float32Array(faces.length * 3);
  const uvs = new Float32Array(faces.length * 2);

  for (let f = 0; f < faces.length; f += 3) {
    const a = faces[f] * 3;
    const b = faces[f + 1] * 3;
    const c = faces[f + 2] * 3;
    const abx = v[b] - v[a];
    const aby = v[b + 1] - v[a + 1];
    const abz = v[b + 2] - v[a + 2];
    const acx = v[c] - v[a];
    const acy = v[c + 1] - v[a + 1];
    const acz = v[c + 2] - v[a + 2];
    let nx = aby * acz - abz * acy;
    let ny = abz * acx - abx * acz;
    let nz = abx * acy - aby * acx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;

    for (let k = 0; k < 3; k++) {
      const src = faces[f + k] * 3;
      const dst = (f + k) * 3;
      positions[dst] = v[src];
      positions[dst + 1] = v[src + 1];
      positions[dst + 2] = v[src + 2];
      normals[dst] = nx;
      normals[dst + 1] = ny;
      normals[dst + 2] = nz;
      uvs[(f + k) * 2] = k === 1 ? 1 : 0;
      uvs[(f + k) * 2 + 1] = k === 2 ? 1 : 0;
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  return g;
}
