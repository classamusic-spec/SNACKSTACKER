import { chromium } from 'playwright';
import { inflateSync } from 'node:zlib';

/** Minimal PNG reader: enough for Playwright's small non-interlaced clips. */
function decodePng(buf) {
  let off = 8, w = 0, h = 0, bitDepth = 8, colorType = 6;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
  if (bitDepth !== 8) throw new Error('unexpected bit depth ' + bitDepth);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * channels;
  const out = Buffer.alloc(h * stride);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = v & 255;
    }
    cur.copy(out, y * stride);
    prev = cur;
  }
  return { w, h, channels, data: out };
}

const hex = (r, g, b) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');

const SEED = () => { try {
  const K='snackery.save.v1'; const raw=localStorage.getItem(K);
  const s = raw?JSON.parse(raw):{version:1}; s.settings={...(s.settings??{}),quality:'low'};
  localStorage.setItem(K, JSON.stringify(s));
} catch {} };

const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const p = await b.newPage({ viewport:{width:393,height:852}, deviceScaleFactor:1 });
await p.addInitScript(SEED);
await p.goto('http://localhost:4173/', { waitUntil:'networkidle' });
await p.waitForTimeout(2500);
await p.evaluate(() => document.querySelectorAll('.sn-root').forEach((n) => (n.style.display = 'none')));
await p.waitForTimeout(400);

const sample = async (x, y) => {
  const png = await p.screenshot({ clip: { x, y, width: 2, height: 2 } });
  const { data, channels } = decodePng(png);
  return hex(data[0], data[1], data[2]);
};
const pts = [[196, 4], [196, 60], [196, 140], [196, 240], [30, 400], [196, 620], [196, 780], [196, 846]];
for (const [x, y] of pts) console.log(`y=${String(y).padStart(3)}  ${await sample(x, y)}`);
console.log('target bgTop #ffe7c4   bgBottom #e07a5f   ground #b4523c');
await b.close();
