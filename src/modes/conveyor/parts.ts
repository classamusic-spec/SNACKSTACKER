/**
 * Small geometry helpers.
 *
 * Everything the conveyor machine is made of is baked into ONE geometry with
 * per-vertex colour, so the whole rig — deck, rails, rollers, hatch, docket
 * posts — costs a single draw call and a single shader program.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { tintGeometry } from '../../content/kit';

/** A coloured, positioned box, ready to merge. */
export function box(
  w: number,
  h: number,
  d: number,
  color: number,
  x: number,
  y: number,
  z: number,
): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(Math.max(w, 1e-3), Math.max(h, 1e-3), Math.max(d, 1e-3));
  g.translate(x, y, z);
  return tintGeometry(g, color);
}

/** A coloured cylinder lying along X — a belt roller. */
export function rollerX(
  radius: number,
  length: number,
  segments: number,
  color: number,
  x: number,
  y: number,
  z: number,
): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(radius, radius, length, segments, 1, false);
  g.rotateZ(Math.PI / 2);
  g.translate(x, y, z);
  return tintGeometry(g, color);
}

/**
 * Merge a mixed bag. Three refuses to merge indexed with non-indexed geometry,
 * so anything indexed is flattened first — a few more vertices, never a
 * different triangle count.
 */
export function mergeParts(parts: (THREE.BufferGeometry | null)[]): THREE.BufferGeometry | null {
  const list = parts.filter((p): p is THREE.BufferGeometry => !!p);
  if (!list.length) return null;
  if (list.length === 1) return list[0];
  const mixed = list.some((g) => g.index === null) && list.some((g) => g.index !== null);
  const flat = mixed
    ? list.map((g) => {
        if (!g.index) return g;
        const n = g.toNonIndexed();
        g.dispose();
        return n;
      })
    : list;
  const merged = mergeGeometries(flat, false);
  for (const g of flat) if (g !== merged) g.dispose();
  return merged;
}

/** Dispose every geometry under a subtree. Materials belong to the library. */
export function disposeGeometries(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const m = obj as THREE.Mesh;
    if (m.isMesh && m.geometry) m.geometry.dispose();
  });
}

/** Blend two 0xRRGGBB literals in gamma space. */
export function mixHex(a: number, b: number, t: number): number {
  const u = 1 - t;
  const r = Math.round(((a >> 16) & 0xff) * u + ((b >> 16) & 0xff) * t);
  const g = Math.round(((a >> 8) & 0xff) * u + ((b >> 8) & 0xff) * t);
  const bl = Math.round((a & 0xff) * u + (b & 0xff) * t);
  return (r << 16) | (g << 8) | bl;
}

/** CSS `#rrggbb` for a 0xRRGGBB literal. */
export function cssHex(hex: number): string {
  return `#${(hex & 0xffffff).toString(16).padStart(6, '0')}`;
}

/** CSS `rgba()` for a 0xRRGGBB literal plus an alpha. */
export function cssRgba(hex: number, alpha: number): string {
  return `rgba(${(hex >> 16) & 0xff},${(hex >> 8) & 0xff},${hex & 0xff},${alpha})`;
}

/** Relative luminance, 0..1, for deciding ink colour against a paper tint. */
export function luminance(hex: number): number {
  const r = ((hex >> 16) & 0xff) / 255;
  const g = ((hex >> 8) & 0xff) / 255;
  const b = (hex & 0xff) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** A 2D surface for a texture we repaint at runtime. */
export interface Surface {
  ctx: CanvasRenderingContext2D;
  source: HTMLCanvasElement;
  width: number;
  height: number;
}

type OffscreenCtor = new (width: number, height: number) => OffscreenCanvas;

export function makeSurface(width: number, height: number): Surface | null {
  const Ctor = (globalThis as unknown as { OffscreenCanvas?: OffscreenCtor }).OffscreenCanvas;
  if (Ctor) {
    const off = new Ctor(width, height);
    const octx = off.getContext('2d');
    if (octx) {
      return {
        ctx: octx as unknown as CanvasRenderingContext2D,
        source: off as unknown as HTMLCanvasElement,
        width,
        height,
      };
    }
  }
  if (typeof document === 'undefined') return null;
  const el = document.createElement('canvas');
  el.width = width;
  el.height = height;
  const c = el.getContext('2d');
  if (!c) return null;
  return { ctx: c, source: el, width, height };
}

/** Rounded rectangle path — canvas2d's roundRect is still not everywhere. */
export function roundRect(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + rr, y);
  c.lineTo(x + w - rr, y);
  c.quadraticCurveTo(x + w, y, x + w, y + rr);
  c.lineTo(x + w, y + h - rr);
  c.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  c.lineTo(x + rr, y + h);
  c.quadraticCurveTo(x, y + h, x, y + h - rr);
  c.lineTo(x, y + rr);
  c.quadraticCurveTo(x, y, x + rr, y);
  c.closePath();
}


/* ------------------------------------------------------------- item flatten */

const _attrNames = (g: THREE.BufferGeometry): string => Object.keys(g.attributes).sort().join(',');

/**
 * Collapse a built food to one mesh per MATERIAL.
 *
 * A theme's food is authored as a little scene graph — flesh plus skin, dough
 * plus a scatter of pepperoni — because that is how it reads as food. On the
 * tower that is fine: one layer is one item. On a belt there are five at once,
 * and every extra node is another draw call five times over.
 *
 * Each leaf's geometry is baked through its own transform and merged with
 * every other leaf sharing its material, so an item costs exactly as many
 * draws as it has distinct materials — the floor, and lossless. Groups whose
 * members disagree about their attributes (one has uvs, another does not) are
 * left alone rather than merged wrongly. `maxMaterials` then trims past that
 * floor, which is NOT lossless — see the note on the cap below.
 */
export function flattenByMaterial(src: THREE.Object3D, maxMaterials = 99): THREE.Object3D {
  src.updateMatrixWorld(true);

  const order: THREE.Material[] = [];
  const groups = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const originals: THREE.BufferGeometry[] = [];
  let simple = true;

  src.traverse((obj) => {
    const m = obj as THREE.Mesh;
    if (!m.isMesh || !m.geometry) return;
    // Only an ARRAY material defeats this. Draw groups on their own do not:
    // three ignores geometry.groups when the mesh has a single material, and
    // every roundedBox in the kit is an ExtrudeGeometry with two of them —
    // bailing on those was why the first version of this was a no-op.
    if (Array.isArray(m.material)) {
      simple = false;
      return;
    }
    const mat = m.material as THREE.Material;
    const g = m.geometry.clone();
    g.applyMatrix4(m.matrixWorld);
    originals.push(m.geometry);
    let list = groups.get(mat);
    if (!list) {
      list = [];
      groups.set(mat, list);
      order.push(mat);
    }
    list.push(g);
  });

  if (!simple || order.length === 0) {
    for (const g of groups.values()) for (const c of g) c.dispose();
    return src;
  }

  // A hard cap on materials per item, keeping the biggest.
  //
  // Five belt items at once means a food's fifth material — a scatter of
  // sesame, a sprinkle line, a filling seam — costs five draw calls to say
  // something worth about six pixels. Dropped by bounding volume, so the body
  // and the one or two features that give the food its silhouette always
  // survive and only the garnish goes.
  let keep = order;
  if (order.length > maxMaterials) {
    const vol = new Map<THREE.Material, number>();
    for (const mat of order) {
      let v = 0;
      for (const g of groups.get(mat)!) {
        g.computeBoundingBox();
        const b = g.boundingBox;
        if (b) v += (b.max.x - b.min.x) * (b.max.y - b.min.y) * (b.max.z - b.min.z);
      }
      vol.set(mat, v);
    }
    keep = order.slice().sort((a, b) => (vol.get(b) ?? 0) - (vol.get(a) ?? 0)).slice(0, maxMaterials);
    for (const mat of order) {
      if (keep.includes(mat)) continue;
      for (const g of groups.get(mat)!) g.dispose();
      groups.delete(mat);
    }
  }

  const out = new THREE.Group();
  for (const mat of keep) {
    const list = groups.get(mat)!;
    const sameAttrs = list.every((g) => _attrNames(g) === _attrNames(list[0]));
    const merged = sameAttrs ? mergeParts(list) : null;
    if (merged) {
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      out.add(mesh);
    } else {
      for (const g of list) {
        const mesh = new THREE.Mesh(g, mat);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        out.add(mesh);
      }
    }
  }

  for (const g of originals) g.dispose();
  return out;
}

/* ---------------------------------------------------------- corridor carving */

export interface Corridor {
  /** Half-width of the belt's claim, in belt-local X. */
  halfW: number;
  zMin: number;
  zMax: number;
  /** Only things standing on the table are candidates. */
  yMin: number;
  yMax: number;
  /** An island bigger than this on X or Z is the room, not a prop. */
  maxProp: number;
}

const _m = new THREE.Matrix4();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();

/**
 * CARVE THE BELT'S CORRIDOR OUT OF THE THEME'S WORLD.
 *
 * The six environments were authored around a tower: a narrow column in the
 * middle of the frame, which leaves the near arc — the wedge between the
 * camera and the origin — free to be dressed. Candy Stack puts a sweet jar at
 * r 3.7 within 0.12 rad of the camera bearing and Taco Night puts a salsa bowl
 * on the same line, deliberately, to stop the foreground reading as bare
 * floor. A belt runs down exactly that line, so a jar ends up standing on it.
 *
 * Hiding the offending object is not available: every environment merges its
 * props into a handful of room-wide batches to hit its own draw-call budget,
 * so the smallest thing that can be switched off is "all the glass in the
 * shop". This carves instead, and it carves whole props:
 *
 *   1. cheap pass — does this mesh have ANY triangle in the corridor? Most
 *      have none and are skipped entirely.
 *   2. islands — union-find over shared vertex positions splits a merged batch
 *      back into the pieces it was merged from.
 *   3. an island goes only if its BOUNDING-BOX CENTRE is inside the corridor
 *      and it is prop-sized. Testing the centre rather than the overlap is
 *      what stops a jar being sliced in half; a prop is either wholly gone or
 *      wholly there, and the counter, ground and room are never candidates.
 *
 * Triangles are degenerated in place, which costs no draw call and no upload
 * of anything but the buffer that changed.
 *
 * @returns [islands removed, triangles degenerated]
 */
export function carveCorridor(
  root: THREE.Object3D,
  worldToLocal: THREE.Matrix4,
  co: Corridor,
): [number, number] {
  let islands = 0;
  let tris = 0;

  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const geo = mesh.geometry;
    const pos = geo.attributes.position as THREE.BufferAttribute | undefined;
    if (!pos) return;
    const idx = geo.index;
    const count = idx ? idx.count : pos.count;
    const nTri = Math.floor(count / 3);
    if (nTri < 2) return;

    _m.multiplyMatrices(worldToLocal, obj.matrixWorld);

    // --- 1. is anything of this mesh in the corridor at all? ----------------
    let anyHit = false;
    for (let t = 0; t < nTri && !anyHit; t++) {
      const o = t * 3;
      const i0 = idx ? idx.getX(o) : o;
      const i1 = idx ? idx.getX(o + 1) : o + 1;
      const i2 = idx ? idx.getX(o + 2) : o + 2;
      _a.fromBufferAttribute(pos, i0).applyMatrix4(_m);
      _b.fromBufferAttribute(pos, i1).applyMatrix4(_m);
      _c.fromBufferAttribute(pos, i2).applyMatrix4(_m);
      const cy = (_a.y + _b.y + _c.y) / 3;
      if (cy < co.yMin || cy > co.yMax) continue;
      const cz = (_a.z + _b.z + _c.z) / 3;
      if (cz < co.zMin || cz > co.zMax) continue;
      const cx = (_a.x + _b.x + _c.x) / 3;
      if (Math.abs(cx) <= co.halfW) anyHit = true;
    }
    if (!anyHit) return;

    // --- 2. split the batch back into islands -------------------------------
    const parent = new Int32Array(nTri);
    for (let i = 0; i < nTri; i++) parent[i] = i;
    const find = (x: number): number => {
      let r = x;
      while (parent[r] !== r) r = parent[r];
      while (parent[x] !== r) {
        const n = parent[x];
        parent[x] = r;
        x = n;
      }
      return r;
    };
    const union = (x: number, y: number): void => {
      const a = find(x);
      const b = find(y);
      if (a !== b) parent[b] = a;
    };
    const seen = new Map<string, number>();
    for (let t = 0; t < nTri; t++) {
      const o = t * 3;
      for (let k = 0; k < 3; k++) {
        const vi = idx ? idx.getX(o + k) : o + k;
        const key = `${Math.round(pos.getX(vi) * 256)},${Math.round(pos.getY(vi) * 256)},${Math.round(pos.getZ(vi) * 256)}`;
        const prev = seen.get(key);
        if (prev === undefined) seen.set(key, t);
        else union(prev, t);
      }
    }

    // --- 3. per-island bounds, in belt-local space --------------------------
    const bounds = new Map<number, Float64Array>();
    for (let t = 0; t < nTri; t++) {
      const r = find(t);
      let bb = bounds.get(r);
      if (!bb) {
        bb = new Float64Array([1e9, 1e9, 1e9, -1e9, -1e9, -1e9]);
        bounds.set(r, bb);
      }
      const o = t * 3;
      for (let k = 0; k < 3; k++) {
        const vi = idx ? idx.getX(o + k) : o + k;
        _a.fromBufferAttribute(pos, vi).applyMatrix4(_m);
        if (_a.x < bb[0]) bb[0] = _a.x;
        if (_a.y < bb[1]) bb[1] = _a.y;
        if (_a.z < bb[2]) bb[2] = _a.z;
        if (_a.x > bb[3]) bb[3] = _a.x;
        if (_a.y > bb[4]) bb[4] = _a.y;
        if (_a.z > bb[5]) bb[5] = _a.z;
      }
    }

    const doomed = new Set<number>();
    bounds.forEach((bb, r) => {
      const sx = bb[3] - bb[0];
      const sz = bb[5] - bb[2];
      if (sx > co.maxProp || sz > co.maxProp) return;
      if (bb[4] < co.yMin || bb[1] > co.yMax) return;
      const cx = (bb[0] + bb[3]) / 2;
      const cz = (bb[2] + bb[5]) / 2;
      if (Math.abs(cx) > co.halfW) return;
      if (cz < co.zMin || cz > co.zMax) return;
      doomed.add(r);
    });
    if (!doomed.size) return;
    islands += doomed.size;

    for (let t = 0; t < nTri; t++) {
      if (!doomed.has(find(t))) continue;
      tris++;
      const o = t * 3;
      if (idx) {
        const keep = idx.getX(o);
        idx.setX(o + 1, keep);
        idx.setX(o + 2, keep);
      } else {
        const x = pos.getX(o);
        const y = pos.getY(o);
        const z = pos.getZ(o);
        pos.setXYZ(o + 1, x, y, z);
        pos.setXYZ(o + 2, x, y, z);
      }
    }
    if (idx) idx.needsUpdate = true;
    else pos.needsUpdate = true;
  });

  return [islands, tris];
}
