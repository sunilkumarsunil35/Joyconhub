import { fileURLToPath } from 'node:url';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));
const apiTarget = process.env.API_TARGET ?? 'http://127.0.0.1:3000';

// Phones only expose motion sensors to secure pages, so the dev server runs on HTTPS by default.
// Set VITE_HTTP=1 to disable (e.g. when a tunnel such as cloudflared provides HTTPS instead).
const https = !process.env.VITE_HTTP;

// Allow the tunnel hostname (e.g. *.trycloudflare.com) when PUBLIC_URL points at one.
const publicHost = process.env.PUBLIC_URL ? new URL(process.env.PUBLIC_URL).hostname : undefined;

export default defineConfig({
  root,
  // Relative asset URLs: the same build works at a domain root (Node server) and in a
  // sub-folder (GitHub Pages serves project sites from https://<user>.github.io/<repo>/).
  base: './',
  plugins: https ? [basicSsl()] : [],
  server: {
    host: true,
    port: Number(process.env.WEB_PORT ?? 5173),
    allowedHosts: publicHost ? [publicHost] : undefined,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
      '/ws': { target: apiTarget.replace(/^http/, 'ws'), ws: true },
    },
  },
  preview: {
    host: true,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
      '/ws': { target: apiTarget.replace(/^http/, 'ws'), ws: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      input: {
        main: `${root}index.html`,
        controller: `${root}controller.html`,
      },
    },
  },
});
