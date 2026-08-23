/**
 * The seam between the game and the native shell it may be running inside.
 *
 * On the web — the Vercel build, a desktop browser, a PWA — every call here is
 * a no-op: Capacitor's web implementations do nothing off-device, and the
 * `isNativePlatform()` guard skips them anyway. So this file costs the web
 * build a few kilobytes of shims and nothing else, and the game has no other
 * knowledge that it might be wrapped.
 *
 * Inside the Capacitor shell its one job is the splash handoff. The native
 * splash is configured not to auto-hide (capacitor.config.ts), because a timer
 * would either cut to a blank WebView before the game is ready or linger over
 * the game once it is. Instead the game dismisses it the moment its own first
 * frame is on screen, so the native splash gives way directly to Snackery's own
 * logo-bite animation with no flash of empty background between them.
 */
import { Capacitor } from '@capacitor/core';

/** Call once, immediately after the first real frame has been rendered. */
export async function initNativeShell(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    // Light glyphs over the dark, full-bleed scene; the bar overlays the canvas
    // and the game's CSS safe-area insets already keep the HUD clear of it.
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setOverlaysWebView({ overlay: true });
  } catch {
    // A missing/again-called StatusBar plugin must never wedge boot.
  }

  try {
    const { SplashScreen } = await import('@capacitor/splash-screen');
    await SplashScreen.hide();
  } catch {
    // If the splash cannot be hidden it will auto-dismiss; not fatal.
  }
}
