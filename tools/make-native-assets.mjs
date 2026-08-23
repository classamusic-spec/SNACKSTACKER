/**
 * Source images for `@capacitor/assets`, which stamps them into every icon
 * density bucket and splash size for Android and iOS.
 *
 * Two sources, both drawn here so nothing is downloaded (the project's whole
 * asset ethos):
 *
 *   assets/icon-only.png   1024² — the Snackery tile, the same drawing the web
 *                          icons use, rendered large.
 *   assets/splash*.png     2732² — a FLAT brand-colour veil, on purpose. The
 *                          game draws its own splash (the logo animating in and
 *                          being bitten away), so the native splash exists only
 *                          to cover the first paint before that takes over. A
 *                          picture here would fight the animation; a solid
 *                          #17101a hands straight to it.
 *
 *   node tools/make-native-assets.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng, render } from './make-icons.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'assets');
mkdirSync(OUT, { recursive: true });

// The brand background — matches capacitor.config.ts and the web boot veil.
const BG = [0x17, 0x10, 0x1a];

function solid(size, [r, g, b]) {
  const buf = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i += 1) {
    buf[i * 4] = r;
    buf[i * 4 + 1] = g;
    buf[i * 4 + 2] = b;
    buf[i * 4 + 3] = 255;
  }
  return encodePng(size, size, buf);
}

const targets = [
  ['icon-only.png', () => render(1024, {})],
  ['splash.png', () => solid(2732, BG)],
  ['splash-dark.png', () => solid(2732, BG)],
];

for (const [name, make] of targets) {
  writeFileSync(resolve(OUT, name), make());
  console.log(`wrote assets/${name}`);
}
