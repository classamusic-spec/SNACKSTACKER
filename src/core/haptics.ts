/**
 * Haptics. Android/Chrome exposes navigator.vibrate; iOS Safari does not, so we
 * fall back to a hidden <label>+switch trick only where it is known to work and
 * otherwise degrade silently. Never throws.
 */
type Pattern = 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error' | 'selection';

const PATTERNS: Record<Pattern, number | number[]> = {
  selection: 8,
  light: 12,
  medium: 22,
  heavy: 38,
  success: [14, 40, 26],
  warning: [22, 60, 22],
  error: [40, 60, 40, 60, 60],
};

let enabled = true;
let supported = false;

export function initHaptics(): void {
  supported = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}

export function setHapticsEnabled(v: boolean): void {
  enabled = v;
}

export function haptic(pattern: Pattern): void {
  if (!enabled || !supported) return;
  try {
    navigator.vibrate(PATTERNS[pattern]);
  } catch {
    /* ignore */
  }
}
