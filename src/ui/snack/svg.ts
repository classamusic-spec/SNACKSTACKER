/** SVG assembly + data-URL packing. URI-encoded, not base64 — it is smaller. */

const ESCAPES: ReadonlyArray<readonly [RegExp, string]> = [
  [/%/g, '%25'],
  [/#/g, '%23'],
  [/</g, '%3C'],
  [/>/g, '%3E'],
  [/"/g, "'"],
  [/&/g, '%26'],
  [/\s+/g, ' '],
];

export function svgUrl(markup: string): string {
  let out = markup.trim();
  for (const [pattern, replacement] of ESCAPES) out = out.replace(pattern, replacement);
  return `url("data:image/svg+xml,${out}")`;
}

export interface SvgOpts {
  viewBox: string;
  /** Omit to let the SVG stretch to the element (the usual case here). */
  stretch?: boolean;
  /** Intrinsic size, for layers that should tile at a fixed scale. */
  width?: number;
  height?: number;
}

export function svg(body: string, opts: SvgOpts): string {
  const size =
    opts.width !== undefined && opts.height !== undefined
      ? ` width='${opts.width}' height='${opts.height}'`
      : '';
  const par = opts.stretch === false ? '' : " preserveAspectRatio='none'";
  return svgUrl(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='${opts.viewBox}'${size}${par}>${body}</svg>`,
  );
}
