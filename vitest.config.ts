import { defineConfig } from 'vitest/config';

const slow = process.env.SLOW === '1';

export default defineConfig({
  test: {
    include: [
      'packages/*/test/**/*.test.ts',
      'apps/server/test/**/*.test.ts',
      'apps/client/test/**/*.test.{ts,tsx}',
    ],
    exclude: slow ? ['**/node_modules/**'] : ['**/node_modules/**', '**/*.slow.test.ts'],
    environment: 'node',
    testTimeout: 20000,
    coverage: {
      provider: 'v8',
      include: ['packages/engine/src/**'],
      exclude: ['packages/engine/src/testing.ts'],
    },
  },
  esbuild: false,
  oxc: {
    jsx: { runtime: 'automatic', importSource: 'preact' },
  },
});
