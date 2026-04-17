import { builtinModules } from 'module';
import { defineConfig } from 'vite';

// Node built-ins available via Cloudflare's nodejs_compat flag.
const nodeBuiltins = [
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
];

/**
 * Vite lib-mode build for freepieces/worker.
 *
 * Produces dist/worker/index.js (ESM) with a matching dist/worker/index.d.ts
 * emitted by tsconfig.worker.json (declaration-only).
 *
 * Cloudflare-specific runtimes and peer packages are kept external so the
 * consumer worker bundle resolves them from its own node_modules.
 */
export default defineConfig({
  build: {
    target: 'es2022',
    lib: {
      entry: 'src/worker/index.ts',
      formats: ['es'],
      fileName: () => 'index.js',
    },
    rollupOptions: {
      external: [
        ...nodeBuiltins,
        /^cloudflare:/,
        // Keep hono and openauth external — consumer supplies them as peers
        /^hono(\/|$)/,
        /^@openauthjs\//,
        // Keep valibot external
        /^valibot$/,
      ],
    },
    minify: false,
    outDir: 'dist/worker',
    emptyOutDir: false,
  },
});
