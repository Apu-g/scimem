import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Every date of a *.test.ts anywhere in the workspace is picked up.
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts'],
    environment: 'node',
  },
});