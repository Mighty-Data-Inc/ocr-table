// vitest file to permit running tests on TypeScript files
// conveniently from the package directory.
// npx vitest run --config vitest.config.mts

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.{test,spec}.ts'],
    exclude: ['node_modules/**', 'dist/**', 'build/**'],
    setupFiles: ['tests/setupEnv.ts'],
  },
});
