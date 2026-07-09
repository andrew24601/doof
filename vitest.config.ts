import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    globals: true,
    testTimeout: 30000,
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage',
      reporter: ['text', 'html', 'json'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*-test-helpers.ts',
        'src/test-helpers.ts',
        'src/**/*.d.ts',
        'src/bin.ts',
        'src/index.ts',
        'dist/**',
        'coverage/**',
        'observer-ui/**',
        'playground/**',
        'samples/**',
        'stdlib/**',
        'vscode-doof/**',
      ],
    },
  },
});
