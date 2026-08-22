/**
 * Framebuffer probe for the cyclorama / sky.
 *
 * Loads the home screen in a given theme + tier, hides the UI, screenshots,
 * then decodes the PNG in-process and prints the exact 8-bit values at a set of
 * normalised sample points. That is the only way to tell whether the composer
 * path and the direct path agree: they must land within a few steps of each
 * other, and the eye cannot judge a few steps.
 *
 *   node tools/sky-probe.mjs diner,candy            # low tier
 *   SN_TIER=high node tools/sky-probe.mjs diner
 *   SN_FPS=1 SN_WAIT=9000 node tools/sky-probe.mjs diner
 *
 * SN_SKY=off  seeds the "sky disabled" flag the temporary dev injection reads,
 * so the same theme can be measured with and without the sky for cost.
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const OUT = process.env.SN_OUT ?? 'shots/sky';
const TIER = process.env.SN_TIER ?? 'low';
const WAIT = Number(process.env.SN_WAIT ?? 7500);
const SKY = process.env.SN_SKY ?? 'on';
const WANT_FPS = process.env.SN_FPS === '1';
const THEMES = (process.argv[2] ?? 'diner').split(',');
const TAG = process.env.SN_TAG ?? '';
const CHROME = [
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/opt/pw-browsers/chromium/chrome-linux/chrome',
].find((p) => existsSync(p));

const W = 393;
const H = 852;

/** Normalised sample points, origin top-left. */
const POINTS = [
  ['sky-TL', 0.06, 0.02],
  ['sky-TC', 0.5, 0.02],
  ['sky-TR', 0.94, 0.02],
  ['sky-L10', 0.1, 0.1],
  ['sky-C10', 0.5, 0.1],
  ['sky-R10', 0.9, 0.1],
  ['sky-L18', 0.1, 0.18],
  ['sky-C18', 0.5, 0.18],
  ['sky-R18', 0.9, 0.18],
  ['band-L26', 0.08, 0.26],
  ['band-C26', 0.5, 0.26],
  ['band-R26', 0.92, 0.26],
  ['mid-C50', 0.5, 0.5],
  ['low-C96', 0.5, 0.96],
];

// --------------------------------------------------------------- png decode

function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a png');
  let p = 8;
  let w = 0;
  let h = 0;
  let depth = 0;
  let type = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const tag = buf.toString('ascii', p + 4, p + 8);
    const body = buf.subarray(p + 8, p + 8 + len);
    if (tag === 'IHDR') {
      w = body.readUInt32BE(0);
      h = body.readUInt32BE(4);
      depth = body[8];
      type = body[9];
      if (depth !== 8) throw new Error(`bit depth ${depth} unsupported`);
      if (body[12] !== 0) throw new Error('interlaced png unsupported');
    } else if (tag === 'IDAT') idat.push(body);
    else if (tag === 'IEND') break;
    p += 12 + len;
  }
  const channels = type === 6 ? 4 : type === 2 ? 3 : 0;
  if (!channels) throw new Error(`colour type ${type} unsupported`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * channels;
  const out = Buffer.alloc(h * stride);
  let rp = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[rp++];
    const row = raw.subarray(rp, rp + stride);
    rp += stride;
    const cur = out.subarray(y * stride, y * stride + stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= channels ? prev[x - channels] : 0;
      let v = row[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a);
        const pb = Math.abs(pp - b);
        const pc = Math.abs(pp - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 255;
    }
  }
  return { w, h, channels, data: out };
}

const hex = (r, g, b) =>
  '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');

// ------------------------------------------------------------------- drive

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  ...(CHROME ? { executablePath: CHROME } : {}),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});

const errors = [];
for (const id of THEMES) {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => errors.push(`${id}: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${id}: ${m.text()}`);
  });
  await page.addInitScript(
    ({ id, tier, sky }) => {
      try {
        localStorage.setItem(
          'snackery.save.v1',
          JSON.stringify({
            version: 1,
            settings: { quality: tier },
            owned: ['diner', 'sushi', 'candy', 'taco', 'breakfast', 'pizza', 'bundle_all'],
            selectedTheme: id,
          }),
        );
        localStorage.setItem('snackery.sky', sky);
      } catch {
        /* private mode */
      }
    },
    { id, tier: TIER, sky: SKY },
  );
  await page.goto(process.env.SNACKERY_URL ?? 'http://localhost:4173/', {
    waitUntil: 'load',
    timeout: 120000,
  });
  await page.waitForTimeout(WAIT);
  if (process.env.SN_PLAY === '1') {
    // The home screen orbits, so two captures are never the same frame. Start
    // a run instead: CAM_YAW is fixed at pi/4 there, which makes the sky
    // reproducible shot to shot.
    await page.getByRole('button', { name: /play/i }).first().click({ timeout: 20000 });
    await page.waitForTimeout(3500);
  }
  await page.evaluate(() => {
    const app = document.getElementById('app');
    if (app) app.style.display = 'none';
  });
  await page.waitForTimeout(1500);

  let fps = null;
  if (WANT_FPS) {
    // Two windows: the first lets the frame time settle after hiding the UI.
    await page.waitForTimeout(6000);
    const samples = [];
    for (let i = 0; i < 8; i++) {
      samples.push(await page.evaluate(() => window.__snackeryStats?.fps ?? 0));
      await page.waitForTimeout(1000);
    }
    samples.sort((a, b) => a - b);
    fps = samples[Math.floor(samples.length / 2)];
  }

  const name = `${id}-${TIER}${TAG ? '-' + TAG : ''}`;
  const file = `${OUT}/${name}.png`;
  await page.screenshot({ path: file, timeout: 180000 });
  // SN_SPIN=n: the home screen turntables a full revolution, so n extra shots
  // spaced across it are the only way to see the sun disc, which sits 93 deg
  // off the play camera's axis.
  const spin = Number(process.env.SN_SPIN ?? 0);
  for (let i = 1; i <= spin; i++) {
    await page.waitForTimeout(Number(process.env.SN_SPIN_GAP ?? 9000));
    await page.screenshot({ path: `${OUT}/${name}-spin${i}.png`, timeout: 180000 });
  }
  const img = decodePng(readFileSync(file));
  const rows = POINTS.map(([label, u, v]) => {
    const x = Math.min(img.w - 1, Math.round(u * img.w));
    const y = Math.min(img.h - 1, Math.round(v * img.h));
    const o = (y * img.w + x) * img.channels;
    return `${label}=${hex(img.data[o], img.data[o + 1], img.data[o + 2])}`;
  });
  const stats = await page.evaluate(() => {
    const s = window.__snackeryStats;
    return s ? { calls: s.drawCalls, tris: s.triangles, progs: s.programs, tier: s.tier } : null;
  });
  console.log(
    `${name.padEnd(22)} ${fps !== null ? `fps=${String(fps).padStart(3)} ` : ''}` +
      `${stats ? `calls=${stats.calls} progs=${stats.progs} ` : ''}${rows.join(' ')}`,
  );
  await page.close();
}
await browser.close();

if (errors.length) {
  console.error(`\n${errors.length} runtime error(s):`);
  for (const e of errors.slice(0, 12)) console.error('  ' + e);
  process.exitCode = 1;
}
