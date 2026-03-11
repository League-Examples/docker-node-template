import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [path.resolve(__dirname, '../tests/server/**/*.test.ts')],
    setupFiles: [path.resolve(__dirname, '../tests/server/setup.ts')],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
