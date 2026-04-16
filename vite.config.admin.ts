import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import mdx from '@mdx-js/rollup';
import remarkGfm from 'remark-gfm';
import { resolve } from 'path';

// Build the React admin SPA.
// Output: dist/public/admin/  (served via Cloudflare Workers ASSETS binding)
export default defineConfig({
  plugins: [
    { enforce: 'pre', ...mdx({ remarkPlugins: [remarkGfm] }) },
    react({ include: /\.(mdx|md|jsx|js|tsx|ts)$/ }),
  ],
  root: resolve(__dirname, 'src/admin'),
  base: '/admin/',
  server: {
    port: 5433,
    fs: {
      allow: [resolve(__dirname)],
    },
    proxy: {
      '/admin/api': { target: 'http://localhost:9321', changeOrigin: true },
      '/auth': { target: 'http://localhost:9321', changeOrigin: true },
      '/oa': { target: 'http://localhost:9321', changeOrigin: true },
      '/.well-known': { target: 'http://localhost:9321', changeOrigin: true },
      '/token': { target: 'http://localhost:9321', changeOrigin: true },
      '/jwks': { target: 'http://localhost:9321', changeOrigin: true },
      // Provider callback/authorize routes (redirect_uri points to worker origin)
      '/google': { target: 'http://localhost:9321', changeOrigin: true },
      '/github': { target: 'http://localhost:9321', changeOrigin: true },
    },
  },
  build: {
    outDir: resolve(__dirname, 'dist/public/admin'),
    emptyOutDir: true
  }
});
