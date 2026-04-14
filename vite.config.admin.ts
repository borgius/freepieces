import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// Build the React admin SPA.
// Output: dist/public/admin/  (served via Cloudflare Workers ASSETS binding)
export default defineConfig({
  plugins: [react()],
  root: resolve(__dirname, 'src/admin'),
  base: '/admin/',
  build: {
    outDir: resolve(__dirname, 'dist/public/admin'),
    emptyOutDir: true
  }
});
