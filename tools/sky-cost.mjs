/**
 * Isolated fill-rate benchmark for the cyclorama.
 *
 * Frame-time A/B against the running game does not work here: SwiftShader
 * holds 60fps at the phone size (so the rAF cap hides everything) and falls to
 * a quarter of a frame per second by the time the viewport is large enough to
 * escape it, which is too few samples to mean anything.
 *
 * So this compiles the ACTUAL generated fragment shaders — extracted from
 * backdrop.ts, not a copy — and draws each one N times over a fixed number of
 * pixels with gl.finish() around the batch. That measures the one thing that
 * matters, cost per fragment, and it does it per tier.
 *
 * SwiftShader is a CPU rasteriser, so the absolute nanoseconds do not transfer
 * to a phone GPU. The RATIOS between the variants do, because they come from
 * the same instruction stream, and the ratio to the studio sweep is the number
 * that answers "what did the sky cost".
 *
 *   node tools/sky-cost.mjs
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SRC = readFileSync('src/render/backdrop.ts', 'utf8');
const SHADERS = readFileSync('src/render/shaders.ts', 'utf8');

const pick = (n) =>
  SHADERS.match(new RegExp('export const ' + n + ' = /\\* glsl \\*/ `([\\s\\S]*?)`;'))[1];

/** Brace-matched extraction so the benchmark can never drift from the source. */
function extract(text, marker) {
  const start = text.indexOf(marker);
  let i = text.indexOf('{', start), depth = 0, q = null;
  const open = i;
  for (; i < text.length; i++) {
    const c = text[i], p = text[i - 1];
    if (q) { if (c === q && p !== '\\') q = null; continue; }
    if (c === '`' || c === "'" || c === '"') { q = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (!depth) return text.slice(open + 1, i); }
  }
  throw new Error('unbalanced ' + marker);
}

const consts = {};
for (const n of ['SKY_HORIZON', 'SKY_ZENITH', 'SUN_RADIUS', 'CLOUD_SCALE', 'CLOUD_WARP', 'CLOUD_WRAP'])
  consts[n] = Number(SRC.match(new RegExp('const ' + n + ' = ([0-9.]+);'))[1]);
consts.SKY_SPAN = consts.SKY_ZENITH - consts.SKY_HORIZON;

const SKY_UNIFORMS = SRC.match(/const SKY_UNIFORMS = \/\* glsl \*\/ `([\s\S]*?)`;/)[1];
const SKY_NOISE = SRC.match(/const SKY_NOISE = \/\* glsl \*\/ `([\s\S]*?)`;/)[1];
const cnames = Object.keys(consts), cvals = Object.values(consts);
const skyFbm = (o) => new Function('octaves', ...cnames, extract(SRC, 'function skyFbm('))(o, ...cvals);
const skyBody = (o, w, l) =>
  new Function('octaves', 'warpSamples', 'litSample', ...cnames, extract(SRC, 'function skyBody('))(o, w, l, ...cvals);
const buildFrag = new Function(
  'open', 'octaves', 'warp', 'lit',
  'GLSL_ACES_INVERSE', 'GLSL_SRGB', 'GLSL_DITHER', 'SKY_UNIFORMS', 'SKY_NOISE', 'skyFbm', 'skyBody',
  ...cnames,
  extract(SRC, 'function buildFrag('),
);
const gen = (open, o, w, l) =>
  buildFrag(open, o, w, l, pick('GLSL_ACES_INVERSE'), pick('GLSL_SRGB'), pick('GLSL_DITHER'),
    SKY_UNIFORMS, SKY_NOISE, skyFbm, skyBody, ...cvals);

// Tier table, read out of backdrop.ts so it cannot drift.
const tierTable = SRC.match(/const SKY_TIERS: Record<QualityTier, SkyTier> = \{([\s\S]*?)\n\};/)[1];
const tierOf = (name) => {
  const m = tierTable.match(new RegExp(name + ':\\s*\\{ octaves: (\\d+), warp: (\\d+), lit: (true|false) \\}'));
  return { octaves: +m[1], warp: +m[2], lit: m[3] === 'true' };
};
const TIERS = { high: tierOf('high'), medium: tierOf('medium'), low: tierOf('low') };

const VARIANTS = [
  ['studio      (no sky)', gen(false, 0, 0, false), 1],
  ['low   2 noise, clear', gen(true, TIERS.low.octaves, TIERS.low.warp, TIERS.low.lit), 1],
  ['medium 5 noise      ', gen(true, TIERS.medium.octaves, TIERS.medium.warp, TIERS.medium.lit), 0],
  ['high   8 noise      ', gen(true, TIERS.high.octaves, TIERS.high.warp, TIERS.high.lit), 0],
];

const VERT = `#version 100
attribute vec2 aPos;
varying vec3 vDir;
void main() {
  // A stand-in for the sphere's view direction with the game's real pitch:
  // every pixel looks BELOW the horizon, which is what puts the sky code in
  // the branch it actually takes in the game.
  vDir = normalize( vec3( aPos.x * 0.20, -0.47 + aPos.y * 0.35, -1.0 ) );
  gl_Position = vec4( aPos, 0.0, 1.0 );
}`;

const HTML = `<!doctype html><html><body><canvas id=c width=530 height=1150></canvas>
<script>
const VERT = ${JSON.stringify(VERT)};
const VARIANTS = ${JSON.stringify(VARIANTS.map(([n, f, d]) => [n, f, d]))};
const gl = document.getElementById('c').getContext('webgl2', { antialias: false, preserveDrawingBuffer: false });
const PX = gl.drawingBufferWidth * gl.drawingBufferHeight;
function sh(type, src) {
  const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}
const quad = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, quad);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
function build(frag) {
  const p = gl.createProgram();
  gl.attachShader(p, sh(gl.VERTEX_SHADER, VERT));
  gl.attachShader(p, sh(gl.FRAGMENT_SHADER, '#version 100\\nprecision highp float;\\n' + frag));
  gl.bindAttribLocation(p, 0, 'aPos');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}
// Diner-preset-shaped uniforms: enough cloud to take the cloud branch, and a
// star pass measured separately below.
function setU(p, direct, stars) {
  const u = (n) => gl.getUniformLocation(p, n);
  gl.useProgram(p);
  gl.uniform3f(u('uTop'), 1.0, 0.80, 0.55); gl.uniform3f(u('uBottom'), 0.72, 0.19, 0.11);
  gl.uniform3f(u('uFloor'), 0.44, 0.08, 0.04); gl.uniform3f(u('uGlow'), 1.0, 0.89, 0.75);
  gl.uniform2f(u('uResolution'), gl.drawingBufferWidth, gl.drawingBufferHeight);
  gl.uniform2f(u('uRange'), -0.1, 1.04);
  gl.uniform1f(u('uParallax'), 0.18); gl.uniform1f(u('uGlowStrength'), 0.14);
  gl.uniform1f(u('uVignette'), 0.21); gl.uniform1f(u('uPostVignette'), direct ? 0.35 : 0);
  gl.uniform1f(u('uDirect'), direct ? 1 : 0); gl.uniform1f(u('uExposure'), 1.06);
  const I = [0.6624,-0.2588,-0.0231,-0.1276,1.1082,-0.1006,-0.0048,-0.0344,1.0423];
  const O = [0.6899,0.3403,0.0578,0.0637,0.9153,0.0621,0.0176,0.1096,0.9367];
  gl.uniformMatrix3fv(u('uAcesInInv'), false, I); gl.uniformMatrix3fv(u('uAcesOutInv'), false, O);
  gl.uniform1f(u('uSkyAmount'), 1); gl.uniform1f(u('uSweepToRad'), 0.748);
  gl.uniform2f(u('uSunDir'), -0.669, 0.743); gl.uniform1f(u('uSunSweep'), 0.849);
  gl.uniform2f(u('uSunSize'), 0.00595, 0.011475); gl.uniform1f(u('uSunAmt'), 1);
  gl.uniform3f(u('uSunTint'), 1.0, 0.97, 0.92); gl.uniform3f(u('uSunLin'), 8.0, 6.4, 3.8);
  gl.uniform3f(u('uGlowColor'), 1.0, 0.73, 0.39); gl.uniform1f(u('uGlowSpread'), 0.95);
  gl.uniform3f(u('uCloudLit'), 1.0, 0.94, 0.78); gl.uniform3f(u('uCloudShade'), 0.70, 0.60, 0.46);
  gl.uniform1f(u('uCloudCover'), 0.34); gl.uniform2f(u('uCloudOffset'), 3.1, 1.0);
  gl.uniform3f(u('uHorizonColor'), 1.0, 0.68, 0.39); gl.uniform2f(u('uHorizonBand'), 0.141, 0.188);
  gl.uniform1f(u('uStars'), stars); gl.uniform3f(u('uStarColor'), 0.9, 0.93, 1.0);
}
// gl.finish() alone does not block under ANGLE here; a 1px readPixels does,
// because it cannot be answered until the raster has actually happened.
const sync = new Uint8Array(4);
const flush = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, sync);

function timeOne(job, passes) {
  gl.useProgram(job.p);
  gl.enableVertexAttribArray(0);
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const t0 = performance.now();
  for (let i = 0; i < passes; i++) gl.drawArrays(gl.TRIANGLES, 0, 3);
  flush();
  return (performance.now() - t0) / passes;
}

window.__run = (passes, repeats) => {
  // Interleaved on purpose. Benchmarking each variant to completion in turn
  // makes every variant's number a sample of a DIFFERENT moment's CPU load,
  // and on a contended box that swung the high tier between 2.1x and 3.7x of
  // studio. Round-robin plus a per-variant minimum makes the comparison fair.
  const jobs = [];
  for (const [name, frag, direct] of VARIANTS) jobs.push({ name, p: build(frag), direct, stars: 0 });
  jobs.push({ name: 'low  + stars 0.62  ', p: build(VARIANTS[1][1]), direct: 1, stars: 0.62 });
  jobs.push({ name: 'high + stars 0.62  ', p: build(VARIANTS[3][1]), direct: 0, stars: 0.62 });
  for (const j of jobs) { setU(j.p, j.direct, j.stars); j.best = Infinity; }
  const err = gl.getError();
  if (err) throw new Error('gl error ' + err);
  for (const j of jobs) timeOne(j, 3);
  for (let r = 0; r < repeats; r++)
    for (const j of jobs) j.best = Math.min(j.best, timeOne(j, passes));
  return jobs.map((j) => [j.name, j.best, PX]);
};
</script></body></html>`;

const dir = join(tmpdir(), 'snackery-sky-cost');
if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
const page404 = join(dir, 'bench.html');
writeFileSync(page404, HTML);

const CHROME = [
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/opt/pw-browsers/chromium/chrome-linux/chrome',
].find((p) => existsSync(p));

const browser = await chromium.launch({
  ...(CHROME ? { executablePath: CHROME } : {}),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('PAGE ERROR', e.message));
await page.goto('file://' + page404);
const passes = Number(process.env.SN_PASSES ?? 12);
const rows = await page.evaluate(([n, r]) => window.__run(n, r), [passes, Number(process.env.SN_REPEATS ?? 7)]);
await browser.close();

const base = rows[0][1];
console.log(`\nFill cost, ${rows[0][2].toLocaleString()} px per pass (530x1150 = a phone at DPR 1.35),`);
console.log(`best of ${process.env.SN_REPEATS ?? 7} interleaved batches of ${passes} passes, SwiftShader CPU raster.\n`);
console.log('  variant                 ms/pass     ns/px    x studio');
for (const [name, ms, px] of rows) {
  console.log(
    `  ${name}  ${ms.toFixed(2).padStart(8)}  ${((ms * 1e6) / px).toFixed(1).padStart(8)}  ${(ms / base).toFixed(2).padStart(8)}`,
  );
}
