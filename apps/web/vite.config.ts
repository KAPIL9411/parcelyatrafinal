import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * The dev server proxies `/v1` to the API so the browser sees one origin. That keeps CORS and the
 * API base URL out of the client code entirely.
 *
 * Production builds ship without sourcemaps: the published bundle is the one users download, and
 * shipping the TypeScript sources to the browser is an information leak we do not need for
 * debugging — the local `npm run dev` build already gives a stack trace.
 */
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/v1': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: false,
      },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: mode !== 'production',
  },
}));
