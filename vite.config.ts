import { defineConfig, type Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * `SNACKERY_SINGLE=1` produces one self-contained HTML file with every script,
 * style and icon inlined, so the whole game can be opened straight off disk
 * with no server. The normal build stays split so three.js can be cached
 * separately.
 */
const single = process.env.SNACKERY_SINGLE === '1';

/** Drop the PWA links a standalone file cannot resolve, and inline the icon. */
function standaloneHtml(): Plugin {
  return {
    name: 'snackery-standalone-html',
    transformIndexHtml(html) {
      return html
        .replace(/\s*<link rel="manifest"[^>]*>/g, '')
        .replace(/\s*<link rel="icon"[^>]*>/g, '')
        .replace(/\s*<link rel="apple-touch-icon"[^>]*>/g, '');
    },
  };
}

export default defineConfig({
  base: './',
  plugins: single ? [standaloneHtml(), viteSingleFile()] : [],
  build: {
    target: 'es2020',
    outDir: single ? 'dist-single' : 'dist',
    copyPublicDir: !single,
    assetsInlineLimit: single ? 100_000_000 : 8192,
    cssCodeSplit: !single,
    chunkSizeWarningLimit: 1200,
    rollupOptions: single
      ? {}
      : {
          output: {
            manualChunks: { three: ['three'] },
          },
        },
  },
  server: { host: true, port: 5173 },
});
