import { defineConfig, devices } from '@playwright/test';

import { MONEY_PORT, PEER_PORT, PORT, STATIC_PORT } from './e2e/ports.ts';

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    launchOptions: {
      // Let two local browser contexts reach each other over WebRTC.
      args: ['--disable-features=WebRtcHideLocalIpsWithMdns'],
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: `PEER_PORT=${PEER_PORT} node e2e/peer-server.mjs`,
      url: `http://127.0.0.1:${PEER_PORT}/`,
      reuseExistingServer: !process.env.CI,
    },
    {
      // One build serves both the relay server and the GitHub Pages-like static server; its p2p
      // mode points at the local signalling server instead of the public PeerJS cloud.
      command: `VITE_PEER_HOST=127.0.0.1 VITE_PEER_PORT=${PEER_PORT} VITE_PEER_SECURE=0 pnpm build && PORT=${PORT} HOST=127.0.0.1 pnpm start`,
      url: `http://localhost:${PORT}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: `STATIC_PORT=${STATIC_PORT} node e2e/static-server.mjs apps/web/dist`,
      url: `http://localhost:${STATIC_PORT}/health`,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: `pnpm --filter @joyconhub/money build && STATIC_PORT=${MONEY_PORT} STATIC_PREFIX=/ node e2e/static-server.mjs apps/money/dist`,
      url: `http://localhost:${MONEY_PORT}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
