/**
 * Renders the Snackery app icons without any image dependency: a tiny SDF
 * rasteriser plus a hand-rolled PNG encoder (zlib is built in).
 *
 *   node tools/make-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public');
mkdirSync(OUT, { recursive: true });

// --- png ---------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // truecolour + alpha
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- drawing -----------------------------------------------------------------

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a, b, t) => a + (b - a) * t;
const hex = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];

/** Signed distance to a rounded box centred at (cx, cy). */
function sdRoundBox(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r;
}

function sdEllipse(px, py, cx, cy, rx, ry) {
  const dx = (px - cx) / rx;
  const dy = (py - cy) / ry;
  return (Math.hypot(dx, dy) - 1) * Math.min(rx, ry);
}

function render(size, { maskable = false } = {}) {
  const buf = Buffer.alloc(size * size * 4);
  const S = size;
  // Maskable icons must keep content inside the safe circle (40% radius).
  const inset = maskable ? 0.7 : 0.86;

  // The stack: bottom bun, patty, cheese, top bun crown.
  // Layers are staggered left/right: the icon should read as "stacking", not
  // as a static burger.
  const layers = [
    { y: 0.760, x: 0.500, hw: 0.330, hh: 0.058, r: 0.052, color: 0xcf9350, hi: 0xefb877 },
    { y: 0.646, x: 0.478, hw: 0.352, hh: 0.070, r: 0.030, color: 0x6a3a22, hi: 0x94572f },
    { y: 0.535, x: 0.520, hw: 0.368, hh: 0.044, r: 0.020, color: 0xefa62c, hi: 0xffd070 },
    { y: 0.412, x: 0.490, hw: 0.330, hh: 0.092, r: 0.092, color: 0xdda257, hi: 0xffd9a4 },
  ];

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S;
      const v = (y + 0.5) / S;

      // Backdrop: warm vertical gradient with a soft radial glow behind the stack.
      const top = hex(0x3a1f2e);
      const bot = hex(0x160f16);
      const g = clamp01(v * 1.05);
      let r = mix(top[0], bot[0], g);
      let gg = mix(top[1], bot[1], g);
      let b = mix(top[2], bot[2], g);
      const glow = Math.exp(-((u - 0.5) ** 2 + (v - 0.5) ** 2) / 0.09) * 0.9;
      const acc = hex(0xe23e57);
      r = mix(r, acc[0], glow * 0.62);
      gg = mix(gg, acc[1], glow * 0.30);
      b = mix(b, acc[2], glow * 0.34);

      // Soft ground shadow under the stack.
      const sh = clamp01(1 - Math.abs(sdEllipse(u, v, 0.5, 0.79, 0.34, 0.045)) * 14);
      r *= 1 - sh * 0.45;
      gg *= 1 - sh * 0.45;
      b *= 1 - sh * 0.45;

      for (const L of layers) {
        const hw = L.hw * inset;
        const hh = L.hh * inset;
        const cy = mix(0.5, L.y, inset);
        const cx = mix(0.5, L.x, inset);
        const d = sdRoundBox(u, v, cx, cy, hw, hh, Math.min(L.r * inset, hh * 0.98));
        const cov = clamp01(0.5 - d * S * 0.5);
        if (cov <= 0) continue;
        const [lr, lg, lb] = hex(L.color);
        const [hr, hg, hb] = hex(L.hi);
        // Fake a key light from above: brighten the upper third of each layer.
        const t = clamp01((cy + hh - v) / (hh * 2));
        const shade = Math.pow(t, 0.65);
        const sr = mix(lr, hr, shade);
        const sg = mix(lg, hg, shade);
        const sb = mix(lb, hb, shade);
        r = mix(r, sr, cov);
        gg = mix(gg, sg, cov);
        b = mix(b, sb, cov);
      }

      // A soft elliptical cap on the crown reads as a 3D top face.
      {
        const crown = layers[3];
        const cy = mix(0.5, crown.y, inset) - crown.hh * inset * 0.42;
        const cx = mix(0.5, crown.x, inset);
        const d = sdEllipse(u, v, cx, cy, crown.hw * inset * 0.86, crown.hh * inset * 0.72);
        const cov = clamp01(-d * S * 0.4);
        if (cov > 0) {
          const [hr, hg, hb] = hex(0xffe3bb);
          r = mix(r, hr, cov * 0.55);
          gg = mix(gg, hg, cov * 0.55);
          b = mix(b, hb, cov * 0.55);
        }
      }

      const i = (y * S + x) * 4;
      buf[i] = Math.round(clamp01(r / 255) * 255);
      buf[i + 1] = Math.round(clamp01(gg / 255) * 255);
      buf[i + 2] = Math.round(clamp01(b / 255) * 255);
      buf[i + 3] = 255;
    }
  }
  return encodePng(S, S, buf);
}

// Exported so the native-asset pipeline (tools/make-native-assets.mjs) can
// render the icon at the 1024px @capacitor/assets wants, from the same source
// as the web icons — one drawing, every size.
export { render, encodePng };

// Run as a CLI: emit the web PWA icons into public/.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const targets = [
    ['icon-512.png', 512, {}],
    ['icon-192.png', 192, {}],
    ['icon-maskable.png', 512, { maskable: true }],
    ['apple-touch-icon.png', 180, {}],
    ['og.png', 512, {}],
  ];

  for (const [name, size, opts] of targets) {
    writeFileSync(resolve(OUT, name), render(size, opts));
    console.log(`wrote public/${name} (${size}x${size})`);
  }
}
