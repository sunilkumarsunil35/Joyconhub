import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root,
  // Relative asset URLs so the bundle loads from the Android app's local web assets.
  base: './',
  server: { host: true, port: Number(process.env.MONEY_PORT ?? 5180) },
  build: { outDir: 'dist', emptyOutDir: true },
});
