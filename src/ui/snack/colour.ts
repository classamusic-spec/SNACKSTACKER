/** Small RGB helpers. Colours travel as [r, g, b] in 0..255. */

export type Rgb = readonly [number, number, number];

export function fromHex(hex: number): Rgb {
  const v = Math.max(0, Math.min(0xffffff, Math.round(hex))) | 0;
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}

export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  const k = Math.max(0, Math.min(1, t));
  return [
    a[0] + (b[0] - a[0]) * k,
    a[1] + (b[1] - a[1]) * k,
    a[2] + (b[2] - a[2]) * k,
  ];
}

/** Multiply toward black (<1) or toward white (>1) without clipping hue. */
export function shade(c: Rgb, factor: number): Rgb {
  if (factor <= 1) return [c[0] * factor, c[1] * factor, c[2] * factor];
  const t = Math.min(1, factor - 1);
  return mix(c, [255, 255, 255], t);
}

export function css(c: Rgb, alpha = 1): string {
  const r = Math.round(Math.max(0, Math.min(255, c[0])));
  const g = Math.round(Math.max(0, Math.min(255, c[1])));
  const b = Math.round(Math.max(0, Math.min(255, c[2])));
  return alpha >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
}

export function hex(c: Rgb): string {
  const to = (n: number): string =>
    Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
  return `#${to(c[0])}${to(c[1])}${to(c[2])}`;
}

/** WCAG relative luminance, used to keep prints from eating text contrast. */
export function luminance(c: Rgb): number {
  const chan = (n: number): number => {
    const x = Math.max(0, Math.min(255, n)) / 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * chan(c[0]) + 0.7152 * chan(c[1]) + 0.0722 * chan(c[2]);
}

export function contrast(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
