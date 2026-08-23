/**
 * The snack-material UI kit.
 *
 * `api.ts` is the frozen contract; `classes.ts` is the class vocabulary that
 * `src/styles/snack.css` defines; `apply.ts` is the small amount of wiring that
 * hands the CSS its generated values. Import from here.
 */

export type { EdgeKind, PaperKind, PaperOpts, SplatOpts } from './api';
export {
  disposeSnackKit,
  edgeClip,
  edgeMask,
  edgePath,
  inkUnderlinePath,
  paperTexture,
  snackKitStats,
  splatPath,
  tearLinePath,
} from './api';
export {
  applyPaper,
  applySplat,
  applyTear,
  applyUnderline,
  clearSnackVars,
  inkColour,
  inkColourAlpha,
} from './apply';
export type {
  CondimentClass,
  EdgeClass,
  InkClass,
  PaperClass,
  PartClass,
  TiltClass,
} from './classes';
export { CONDIMENT, EDGE, INK, PAPER, PART, TILT, tiltFor } from './classes';
