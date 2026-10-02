import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 3100);

export default defineConfig({
  testDir: 'apps/client/e2e',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } }],
  webServer: {
    command: `npm run build && node apps/server/dist/index.js`,
    url: `http://localhost:${PORT}/healthz`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    env: { PORT: String(PORT), LOG_LEVEL: 'warn', CONNECTIONS_PER_IP: '200', NODE_ENV: 'production' },
  },
});
