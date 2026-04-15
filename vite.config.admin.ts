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
    fs: {
      allow: [resolve(__dirname)],
    },
    proxy: {
      '/admin/api': 'http://127.0.0.1:8787',
      '/auth': 'http://127.0.0.1:8787',
    },
  },
  build: {
    outDir: resolve(__dirname, 'dist/public/admin'),
    emptyOutDir: true
  }
});
