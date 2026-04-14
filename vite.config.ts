import { defineConfig } from 'vite';

// https://vitejs.dev/config/
export default defineConfig({
  build: {
    target: 'es2022',
    lib: {
      entry: 'src/worker.ts',
      formats: ['es'],
      fileName: () => 'worker.js'
    },
    rollupOptions: {
      external: []
    },
    minify: false,
    outDir: 'dist'
  }
});
