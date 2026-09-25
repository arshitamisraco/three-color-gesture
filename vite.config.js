import { defineConfig } from 'vite';
import { cpSync, existsSync, createReadStream } from 'node:fs';
import { join, extname, resolve } from 'node:path';

// Serve MediaPipe's WASM bundle from node_modules (dev) and copy it into
// dist/ (build) so the app doesn't depend on a CDN. See TRACKING.wasmBase.
function mediapipeWasm() {
  const wasmDir = resolve('node_modules/@mediapipe/tasks-vision/wasm');
  const urlPrefix = '/mediapipe/wasm/';
  const types = { '.js': 'text/javascript', '.wasm': 'application/wasm' };
  let outDir = 'dist';
  return {
    name: 'mediapipe-wasm',
    configResolved(cfg) { outDir = cfg.build.outDir; },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url || !req.url.startsWith(urlPrefix)) return next();
        const file = join(wasmDir, req.url.slice(urlPrefix.length).split('?')[0]);
        if (!file.startsWith(wasmDir) || !existsSync(file)) return next();
        res.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream');
        createReadStream(file).pipe(res);
      });
    },
    closeBundle() {
      cpSync(wasmDir, join(outDir, 'mediapipe', 'wasm'), { recursive: true });
    },
  };
}

export default defineConfig({
  plugins: [mediapipeWasm()],
  server: { host: true },
  build: { target: 'esnext', chunkSizeWarningLimit: 1000 },
  optimizeDeps: { exclude: ['@mediapipe/tasks-vision'] },
});
