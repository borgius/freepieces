import { builtinModules } from 'module';
import { defineConfig } from 'vite';

// Node built-ins available via Cloudflare's nodejs_compat flag — mark as
// external so Rollup/Vite does not try to bundle them or emit warnings.
const nodeBuiltins = [
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
];

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
      external: nodeBuiltins,
    },
    minify: false,
    outDir: 'dist'
  }
});
