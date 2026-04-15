import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import mdx from '@mdx-js/rollup';
import remarkGfm from 'remark-gfm';
import { resolve } from 'path';

// Build the docs-only SPA for GitHub Pages static hosting.
// Output: dist/ghpages/  (deployed via GitHub Actions)
export default defineConfig({
  plugins: [
    { enforce: 'pre', ...mdx({ remarkPlugins: [remarkGfm] }) },
    react({ include: /\.(mdx|md|jsx|js|tsx|ts)$/ }),
  ],
  root: resolve(__dirname, 'src/ghpages'),
  base: '/freepieces/',
  resolve: {
    alias: {
      '@admin': resolve(__dirname, 'src/admin'),
    },
  },
  build: {
    outDir: resolve(__dirname, 'dist/ghpages'),
    emptyOutDir: true,
  },
});
