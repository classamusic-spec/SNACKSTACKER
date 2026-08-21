/**
 * Inline SVG glyph set. No icon font, no emoji in chrome.
 * Every icon is a 24x24 stroke drawing that inherits `currentColor`.
 */

import { s } from './dom';

function frame(...children: SVGElement[]): SVGElement {
  return s(
    'svg',
    {
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '1.8',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': 'true',
      focusable: 'false',
      class: 'sn-icon',
    },
    ...children,
  );
}

function path(d: string, extra?: Record<string, string | number>): SVGElement {
  return s('path', { d, ...(extra ?? {}) });
}

/** Shopping bag. */
export function iconBag(): SVGElement {
  return frame(
    path(
      'M5.35 8.4h13.3a1.5 1.5 0 0 1 1.49 1.68l-1.02 8.4a2.4 2.4 0 0 1-2.38 2.12H7.26a2.4 2.4 0 0 1-2.38-2.12l-1.02-8.4A1.5 1.5 0 0 1 5.35 8.4Z',
    ),
    path('M8.9 10.6V7.3a3.1 3.1 0 0 1 6.2 0v3.3'),
  );
}

/** Gear, assembled from a ring plus eight rounded teeth. */
export function iconGear(): SVGElement {
  const parts: SVGElement[] = [
    s('circle', { cx: '12', cy: '12', r: '7.2' }),
    s('circle', { cx: '12', cy: '12', r: '3', opacity: '0.9' }),
  ];
  for (let i = 0; i < 8; i += 1) {
    parts.push(
      s('rect', {
        x: '10.9',
        y: '2.1',
        width: '2.2',
        height: '3.4',
        rx: '1.1',
        fill: 'currentColor',
        stroke: 'none',
        transform: `rotate(${i * 45} 12 12)`,
      }),
    );
  }
  return frame(...parts);
}

export function iconPause(): SVGElement {
  return frame(
    s('rect', { x: '8.4', y: '5.8', width: '2.6', height: '12.4', rx: '1.3', fill: 'currentColor', stroke: 'none' }),
    s('rect', { x: '13', y: '5.8', width: '2.6', height: '12.4', rx: '1.3', fill: 'currentColor', stroke: 'none' }),
  );
}

export function iconClose(): SVGElement {
  return frame(path('M6.6 6.6 17.4 17.4'), path('M17.4 6.6 6.6 17.4'));
}

export function iconShare(): SVGElement {
  return frame(
    path('M12 3.4v10.4'),
    path('M8.3 7.1 12 3.4l3.7 3.7'),
    path('M7.6 10.6H6.4a2.2 2.2 0 0 0-2.2 2.2v5.6a2.2 2.2 0 0 0 2.2 2.2h11.2a2.2 2.2 0 0 0 2.2-2.2v-5.6a2.2 2.2 0 0 0-2.2-2.2h-1.2'),
  );
}

export function iconHome(): SVGElement {
  return frame(
    path('M3.8 10.4 12 3.8l8.2 6.6'),
    path('M5.8 9.4v9a1.6 1.6 0 0 0 1.6 1.6h9.2a1.6 1.6 0 0 0 1.6-1.6v-9'),
    path('M9.9 20v-5.2h4.2V20'),
  );
}

export function iconRestart(): SVGElement {
  return frame(
    path('M19.4 12a7.4 7.4 0 1 1-2.4-5.45'),
    path('M19.7 4.2v4.5h-4.5'),
  );
}

/** Coin: a rimmed disc with a soft inner highlight. */
export function iconCoin(): SVGElement {
  return frame(
    s('circle', { cx: '12', cy: '12', r: '8.1', fill: 'currentColor', stroke: 'none', opacity: '0.22' }),
    s('circle', { cx: '12', cy: '12', r: '8.1' }),
    s('circle', { cx: '12', cy: '12', r: '4.5', opacity: '0.55' }),
  );
}

export function iconCheck(): SVGElement {
  return frame(path('M5.4 12.6 10 17.1l8.6-9.7'));
}

/** Four-point sparkle used by the perfect banner and the new-best ribbon. */
export function iconSpark(): SVGElement {
  return frame(
    path('M12 3.2c.9 4.3 2.3 5.7 6.6 6.6-4.3.9-5.7 2.3-6.6 6.6-.9-4.3-2.3-5.7-6.6-6.6 4.3-.9 5.7-2.3 6.6-6.6Z', {
      fill: 'currentColor',
      stroke: 'none',
    }),
    path('M18.4 15.6c.42 1.9 1.05 2.53 2.95 2.95-1.9.42-2.53 1.05-2.95 2.95-.42-1.9-1.05-2.53-2.95-2.95 1.9-.42 2.53-1.05 2.95-2.95Z', {
      fill: 'currentColor',
      stroke: 'none',
      opacity: '0.7',
    }),
  );
}

export function iconTag(): SVGElement {
  return frame(
    path('M4.2 11.1V5.6a1.4 1.4 0 0 1 1.4-1.4h5.5a1.4 1.4 0 0 1 .99.41l7.5 7.5a1.4 1.4 0 0 1 0 1.98l-5.5 5.5a1.4 1.4 0 0 1-1.98 0l-7.5-7.5a1.4 1.4 0 0 1-.41-.99Z'),
    s('circle', { cx: '8.3', cy: '8.3', r: '1.35', fill: 'currentColor', stroke: 'none' }),
  );
}

/** A stacked-plates mark used by the boot screen and the pause sheet. */
export function iconStack(): SVGElement {
  return frame(
    s('rect', { x: '4.2', y: '14.6', width: '15.6', height: '3.6', rx: '1.8' }),
    s('rect', { x: '6.2', y: '9.6', width: '11.6', height: '3.6', rx: '1.8', opacity: '0.75' }),
    s('rect', { x: '8.4', y: '4.6', width: '7.2', height: '3.6', rx: '1.8', opacity: '0.5' }),
  );
}
