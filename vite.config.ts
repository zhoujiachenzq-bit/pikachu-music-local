import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const shim = (name: string) => fileURLToPath(new URL(`./src/phone/shims/${name}.ts`, import.meta.url));

export default defineConfig({
  plugins: [react()],
  root: '.',
  resolve: {
    // Only the phone backend chunk imports src/server, so the website is unaffected.
    alias: [
      { find: /^fastify$/, replacement: shim('fastify') },
      { find: /^@fastify\/(cookie|static)$/, replacement: shim('plugin') },
      { find: /^node:sqlite$/, replacement: shim('sqlite') },
      { find: /^node:(crypto|fs|path|stream|util)$/, replacement: shim('node') }
    ]
  },
  build: { outDir: 'dist/client', emptyOutDir: false },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:3000' }
  }
});
