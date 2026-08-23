import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Snackery, wrapped as a native app.
 *
 * The game is already a self-contained web build — procedural assets, no
 * network, relative paths (`base: './'` in vite.config) — so the wrapper's job
 * is only to host `dist/` in a native WebView and get out of the way. Nothing
 * here reaches back to a server; the app runs entirely offline.
 */
const config: CapacitorConfig = {
  appId: 'com.snackery.game',
  appName: 'Snackery',
  // Capacitor copies this folder into the native project on every `cap sync`.
  webDir: 'dist',
  // Lock the WebView to the app bundle; the game never loads a remote URL.
  server: {
    androidScheme: 'https',
  },
  android: {
    // The tower and its shadows are the whole point; let the GPU do its work.
    backgroundColor: '#17101a',
  },
  ios: {
    backgroundColor: '#17101a',
    // WKWebView already; make the inset behaviour predictable for a game that
    // paints edge-to-edge and manages its own safe areas in CSS.
    contentInset: 'never',
  },
  plugins: {
    /**
     * The game draws its OWN splash — the logo animating in and being bitten
     * away — so the native splash exists only to cover the first paint, then
     * hands straight over. It is dismissed from code the moment the web boot
     * screen is up (see src/main.ts), so it must not auto-hide on a timer and
     * flash the WebView's blank background in between.
     */
    SplashScreen: {
      launchAutoHide: false,
      backgroundColor: '#17101a',
      showSpinner: false,
      androidScaleType: 'CENTER_CROP',
    },
    StatusBar: {
      // The game is a dark, full-bleed scene; a translucent dark bar with light
      // content reads correctly on every theme.
      style: 'DARK',
      backgroundColor: '#00000000',
      overlaysWebView: true,
    },
  },
};

export default config;
