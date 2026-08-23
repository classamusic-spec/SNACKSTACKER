/**
 * TEMPORARY: visual harness for the snack-material kit.
 *
 * Every paper stock against every theme, every edge, the splat at several
 * seeds and aspects, and the ink treatments — on dark, light and two real
 * backdrops. The point is to look at it: material either survives being looked
 * at closely or it is clipart.
 *
 * Delete with src/dev/snack-kit.html.
 */

import '../styles/ui.css';
import '../styles/snack.css';

import type { ThemeId } from '../core/types';
import type { EdgeKind, PaperKind } from '../ui/snack/api';
import { snackKitStats, splatPath, tearLinePath, inkUnderlinePath } from '../ui/snack/api';
import { applyPaper, applySplat, applyTear, applyUnderline } from '../ui/snack/apply';
import { CONDIMENT, EDGE, INK, PAPER, PART, TILT } from '../ui/snack/classes';
import { h, s } from '../ui/dom';

const THEMES: ThemeId[] = ['diner', 'sushi', 'candy', 'taco', 'breakfast', 'pizza'];
const STOCKS: PaperKind[] = ['napkin', 'greaseproof', 'ticket', 'menucard', 'board'];
const EDGES: EdgeKind[] = ['deckle', 'scallop', 'torn', 'perforated', 'clean'];

const app = document.getElementById('app') as HTMLElement;

function head(title: string, note: string): HTMLElement {
  return h('div', { class: 'hx' }, title, h('small', { text: note }));
}

function band(kind: string, ...kids: HTMLElement[]): HTMLElement {
  const grid = h('div', { class: 'grid' }, ...kids);
  return h('div', { class: `band band--${kind}` }, grid);
}

function cell(caption: string, node: HTMLElement): HTMLElement {
  return h('div', { class: 'cell' }, node, h('div', { class: 'cap', text: caption }));
}

function paperSwatch(
  kind: PaperKind,
  opts: { theme?: ThemeId; edge?: EdgeKind; wear?: number; tilt?: number; extra?: string },
): HTMLElement {
  const edge = opts.edge ?? 'deckle';
  const el = h('div', { class: `swatch ${opts.extra ?? ''}` },
    h('div', { class: `t1 ${INK.print}`, text: 'Classic Diner' }),
    h('div', { class: 't2', text: 'Burgers, syrup, the cozy default.' }),
    h('div', { class: 't2', style: { color: 'var(--ink-2)' }, text: 'Secondary line on --ink-2' }),
  );
  applyPaper(el, {
    kind,
    seed: `${kind}:${opts.theme ?? 'none'}:${edge}:${opts.wear ?? 0}`,
    edge,
    theme: opts.theme,
    wear: opts.wear ?? 0.2,
    tilt: opts.tilt,
  });
  return el;
}

/* ---- 1. every stock x every theme --------------------------------------- */

app.appendChild(head('paper stocks x themes', 'napkin takes the themed print; every stock takes the theme cast'));
for (const kind of STOCKS) {
  app.appendChild(
    band(
      kind === 'board' ? 'light' : 'dark',
      ...THEMES.map((theme) =>
        cell(`${kind} / ${theme}`, paperSwatch(kind, { theme, edge: 'deckle', wear: 0.25 })),
      ),
    ),
  );
}

/* ---- 2. edges ------------------------------------------------------------ */

app.appendChild(head('edges', 'every one seeded and asymmetric; the mask cuts paper, never children'));
app.appendChild(
  band(
    'dark',
    ...EDGES.map((edge) =>
      cell(`napkin / ${edge}`, paperSwatch('napkin', { theme: 'diner', edge, wear: 0.3 })),
    ),
  ),
);
app.appendChild(
  band(
    'light',
    ...EDGES.map((edge) =>
      cell(`menucard / ${edge}`, paperSwatch('menucard', { edge, wear: 0.2, extra: 'swatch--tall' })),
    ),
  ),
);
app.appendChild(
  head('the same edge, four seeds', 'a column of cards must not be a column of identical tears'),
);
app.appendChild(
  band(
    'dark',
    ...[0, 1, 2, 3].map((i) => {
      const el = h('div', { class: 'swatch' }, h('div', { class: `t1 ${INK.print}`, text: `Seed ${i}` }));
      applyPaper(el, { kind: 'napkin', seed: `variety-${i}`, edge: 'deckle', theme: 'breakfast', wear: 0.4 });
      return cell(`deckle seed ${i}`, el);
    }),
  ),
);
app.appendChild(
  band(
    'dark',
    ...[0, 1, 2, 3].map((i) => {
      const el = h('div', { class: 'swatch' }, h('div', { class: `t1 ${INK.print}`, text: `Seed ${i}` }));
      applyPaper(el, { kind: 'ticket', seed: `rip-${i}`, edge: 'torn', wear: 0.3 });
      return cell(`torn seed ${i}`, el);
    }),
  ),
);

/* ---- 3. wear ------------------------------------------------------------- */

app.appendChild(head('wear', 'grease saturation, uneven pulp, creases'));
app.appendChild(
  band(
    'light',
    ...[0, 0.25, 0.5, 0.75, 1].map((wear) =>
      cell(`greaseproof wear ${wear}`, paperSwatch('greaseproof', { edge: 'clean', wear })),
    ),
  ),
);

/* ---- 4. splat ------------------------------------------------------------ */

function splatButton(seed: string, label: string, width: number, aspectHint?: number): HTMLElement {
  const layer = h('span', { class: 'sn-btn__splat sn-m-splat', aria: { hidden: 'true' } });
  const box = h('div', { style: { width: `${width}px` } });
  const btn = h(
    'button',
    {
      class: `sn-btn sn-btn--primary ${CONDIMENT.splat}`,
      type: 'button',
      style: { width: `${width}px`, height: '60px', minHeight: '60px' },
    },
    layer,
    h('span', { class: 'sn-btn__label', text: label }),
  );
  const aspect = aspectHint ?? (width * 1.24) / (60 * 1.92);
  const svg = s(
    'svg',
    { viewBox: '0 0 100 100', preserveAspectRatio: 'none', width: '100%', height: '100%' },
    s('path', { d: splatPath({ seed, aspect }), fill: 'currentColor' }),
  );
  layer.appendChild(svg);
  applySplat(layer, { seed, aspect });
  box.appendChild(btn);
  return box;
}

app.appendChild(head('the ketchup splat', 'uneven rim, satellites falling off with distance, drips'));
app.appendChild(
  band(
    'dark',
    cell('PLAY 322x60', splatButton('splat:PLAY', 'PLAY', 322)),
    cell('Play again 200x60', splatButton('splat:again', 'Play again', 200)),
    cell('Retry 140x60', splatButton('splat:retry', 'Retry', 140)),
  ),
);
app.appendChild(
  band(
    'scene',
    cell('seed a', splatButton('splat:a', 'PLAY', 300)),
    cell('seed b', splatButton('splat:b', 'PLAY', 300)),
    cell('seed c', splatButton('splat:c', 'PLAY', 300)),
  ),
);
app.appendChild(
  band(
    'light',
    ...['sq1', 'sq2', 'sq3', 'sq4'].map((seed) => {
      const box = h('div', { style: { width: '150px', height: '150px', position: 'relative' } });
      const svg = s(
        'svg',
        { viewBox: '0 0 100 100', preserveAspectRatio: 'none', width: '150', height: '150' },
        s('path', { d: splatPath({ seed, aspect: 1 }), fill: '#d02a2a' }),
      );
      box.appendChild(svg);
      return cell(`square, aspect 1 (${seed})`, box);
    }),
  ),
);

/* ---- 5. ink -------------------------------------------------------------- */

app.appendChild(head('ink on paper', 'print / stamp / thermal / hand-drawn underline'));
{
  const sheet = h('div', { class: 'swatch swatch--wide swatch--tall' });
  applyPaper(sheet, { kind: 'menucard', seed: 'ink-demo', edge: 'clean', wear: 0.18 });
  sheet.appendChild(h('div', { class: `t1 ${INK.print}`, text: 'Sushi Tower' }));
  sheet.appendChild(h('div', { class: 't2', style: { color: 'var(--ink-2)' }, text: 'Rice, salmon, nori, wasabi pop.' }));
  sheet.appendChild(h('div', { class: `t2 ${INK.thermal}`, text: '840 / 1,200 coins' }));
  const stamps = h('div', { class: 'row', style: { marginTop: '10px' } },
    h('span', { class: INK.stamp, text: 'Best value' }),
    h('span', { class: INK.stamp, text: 'PAID' }),
    h('span', { class: INK.stamp, text: 'SELECTED' }),
  );
  sheet.appendChild(stamps);
  const under = h('span', { class: INK.underline, style: { width: '150px' } });
  applyUnderline(under, 'demo-underline', 150);
  const under2 = h('span', { class: INK.underline },
    s('svg', { viewBox: '0 0 100 8', preserveAspectRatio: 'none', width: '100%', height: '8' },
      s('path', { d: inkUnderlinePath('demo-svg', 100) })),
  );
  const tear = h('div', { class: PART.tear });
  applyTear(tear, 'demo-tear');
  const tear2 = h('div', { class: PART.tear },
    s('svg', { viewBox: '0 0 100 6', preserveAspectRatio: 'none', width: '100%', height: '6' },
      s('path', { d: tearLinePath('demo-tear-2') })),
  );
  app.appendChild(
    band(
      'dark',
      cell('menucard, all four inks', sheet),
      cell('underline (mask) / (inline svg)',
        h('div', { style: { width: '220px', display: 'grid', gap: '20px', paddingTop: '20px' } }, under, under2)),
      cell('tear-line (mask) / (inline svg)',
        h('div', { style: { width: '220px', display: 'grid', gap: '20px', paddingTop: '20px' } }, tear, tear2)),
    ),
  );
}

/* ---- 6. condiments and parts --------------------------------------------- */

app.appendChild(head('condiments and parts', 'sachet, bottle cap, price sticker, tape, stain, tray'));
{
  const sachet = h('span', { class: `sn-btn sn-btn--secondary ${CONDIMENT.sachet}`, text: 'Settings' });
  const track = h('span', { class: `sn-switch__track ${CONDIMENT.sachet}`, style: { display: 'block', width: '52px', height: '32px' } });
  const onTrack = h('span', { class: 'sn-switch is-on' }, h('span', { class: `sn-switch__track ${CONDIMENT.sachet}`, style: { display: 'block', width: '52px', height: '32px' } }));
  const cap = h('span', { class: `${CONDIMENT.cap}`, style: { display: 'inline-flex', width: '56px', height: '56px', alignItems: 'center', justifyContent: 'center', fontWeight: '700' }, text: '?' });
  const sticker = h('span', { class: `sn-chip ${CONDIMENT.sticker} ${INK.print}`, style: { display: 'inline-flex', padding: '6px 12px' } }, h('span', { text: '1,240' }));
  const sticker2 = h('span', { class: `${CONDIMENT.sticker} ${INK.print}`, style: { display: 'inline-flex', padding: '7px 14px', fontWeight: '650' }, text: '$1.99' });
  const tape = h('span', { class: PART.tape, style: { width: '92px', height: '26px' } });
  const trayBox = h('div', { class: PART.tray, style: { width: '300px', height: '190px', borderRadius: '30px 30px 0 0', position: 'relative', padding: '20px' } });
  const paper = h('div', { class: `sn-sheet__paper ${PAPER.greaseproof} ${EDGE.torn}` });
  applyPaper(paper, { kind: 'greaseproof', seed: 'sheet:store', edge: 'torn', wear: 0.34 });
  const stain1 = h('span', { class: `sn-sheet__stain ${PART.stain}` });
  const stain2 = h('span', { class: `sn-sheet__stain sn-sheet__stain--b ${PART.stain}` });
  paper.appendChild(stain1);
  paper.appendChild(stain2);
  trayBox.appendChild(paper);
  trayBox.appendChild(h('div', { class: `t1 ${INK.print}`, text: 'Store' }));
  trayBox.appendChild(h('div', { class: 't2', style: { color: 'var(--ink-2)' }, text: 'Every theme, forever.' }));
  const trayTear = h('div', { class: PART.tear, style: { marginTop: '8px' } });
  applyTear(trayTear, 'tray-tear');
  trayBox.appendChild(trayTear);

  app.appendChild(
    band(
      'dark',
      cell('sachet button', sachet),
      cell('sachet switch off / on', h('div', { class: 'row' }, track, onTrack)),
      cell('bottle cap', cap),
      cell('price stickers', h('div', { class: 'row' }, sticker, sticker2)),
      cell('tape', tape),
      cell('tray + greaseproof + stains', trayBox),
    ),
  );
}

/* ---- 7. tilt ------------------------------------------------------------- */

app.appendChild(head('tilt buckets', 'the individual rotate property, so a press spring can still scale'));
{
  const kids = [TILT.l2, TILT.l1, TILT.r1, TILT.r2].map((tilt, i) => {
    const el = h('div', { class: `swatch ${tilt}` }, h('div', { class: `t1 ${INK.print}`, text: tilt || 'none' }));
    applyPaper(el, { kind: 'napkin', seed: `tilt-${i}`, edge: 'scallop', theme: THEMES[i], wear: 0.24 });
    return cell(tilt, el);
  });
  app.appendChild(band('sushi', ...kids));
}

/* ---- 8. the CSS-only path ------------------------------------------------ */

app.appendChild(head('no javascript', 'classes only — no --sn-paper, no --sn-edge; this is the floor'));
{
  const raw = (cls: string, theme: ThemeId | null, label: string): HTMLElement => {
    const el = h('div', { class: `swatch ${cls}` },
      h('div', { class: `t1 ${INK.print}`, text: label }),
      h('div', { class: 't2', style: { color: 'var(--ink-2)' }, text: 'Secondary on --ink-2' }));
    const wrap = h('div', theme ? { data: { theme } } : null, el);
    return wrap;
  };
  app.appendChild(
    band(
      'dark',
      cell('napkin+scallop / diner', raw(`${PAPER.napkin} ${EDGE.scallop}`, 'diner', 'Endless')),
      cell('napkin+scallop / sushi', raw(`${PAPER.napkin} ${EDGE.scallop}`, 'sushi', 'Rush')),
      cell('napkin+deckle / taco', raw(`${PAPER.napkin} ${EDGE.deckle}`, 'taco', 'Recipe')),
      cell('ticket+torn', raw(`${PAPER.ticket} ${EDGE.torn}`, null, 'Saved')),
      cell('menucard+perforated', raw(`${PAPER.menucard} ${EDGE.perforated}`, null, 'Order pad')),
    ),
  );
}

const stats = snackKitStats();
const el = document.getElementById('stats');
if (el) {
  el.textContent = `textures ${stats.textures}  shapes ${stats.shapes}  data-url bytes ${(
    stats.bytes / 1024
  ).toFixed(1)}kB  (avg ${(stats.bytes / Math.max(1, stats.textures) / 1024).toFixed(1)}kB/texture)`;
}
