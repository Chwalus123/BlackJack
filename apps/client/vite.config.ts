import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

const SERVER = process.env.CASINO_SERVER ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [preact()],
  server: {
    port: 5173,
    host: true,
    // Keep the browser's Host header so the server's same-origin check also passes for LAN devices.
    proxy: {
      '/socket.io': { target: SERVER, ws: true },
      '/healthz': { target: SERVER },
    },
  },
  preview: { port: 4173 },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three')) return 'three';
          return undefined;
        },
      },
    },
  },
  worker: { format: 'es' },
});
