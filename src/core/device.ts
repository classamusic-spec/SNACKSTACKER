import type { QualityTier } from './types';

export interface DeviceProfile {
  isTouch: boolean;
  isMobile: boolean;
  isIOS: boolean;
  isSafari: boolean;
  isStandalone: boolean;
  cores: number;
  memoryGb: number;
  prefersReducedMotion: boolean;
  /** Best-guess starting tier; the frame governor may lower it at runtime. */
  suggestedQuality: QualityTier;
  maxPixelRatio: number;
}

export function detectDevice(): DeviceProfile {
  const ua = navigator.userAgent;
  const isTouch =
    'ontouchstart' in window || (navigator.maxTouchPoints ?? 0) > 0;
  const isIOS =
    /iP(hone|ad|od)/.test(ua) ||
    (/Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1);
  const isMobile = isIOS || /Android|Mobile/i.test(ua);
  const isSafari = /^((?!chrome|android|crios|fxios).)*safari/i.test(ua);
  const isStandalone =
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true;

  const cores = navigator.hardwareConcurrency ?? (isMobile ? 4 : 8);
  const memoryGb =
    (navigator as unknown as { deviceMemory?: number }).deviceMemory ??
    (isMobile ? 4 : 8);
  const prefersReducedMotion =
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

  let suggestedQuality: QualityTier = 'high';
  if (isMobile) suggestedQuality = cores >= 6 && memoryGb >= 4 ? 'high' : 'medium';
  if (cores <= 4 && memoryGb <= 3) suggestedQuality = 'low';

  // Retina beyond 2.0 costs a lot of fill rate for no perceptible gain.
  const maxPixelRatio = suggestedQuality === 'low' ? 1.5 : 2;

  return {
    isTouch,
    isMobile,
    isIOS,
    isSafari,
    isStandalone,
    cores,
    memoryGb,
    prefersReducedMotion,
    suggestedQuality,
    maxPixelRatio,
  };
}

export const device: DeviceProfile = /* @__PURE__ */ detectDevice();
