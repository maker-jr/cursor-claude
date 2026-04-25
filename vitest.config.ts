import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'src/**/*.test.ts',
      'tests/**/*.test.ts',
    ],
    testTimeout: 15_000,
    hookTimeout: 15_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.d.ts',
        // Type-only modules: v8 reports 0% because there are no executable
        // statements. Excluded so they don't drag thresholds down.
        'src/domain/proxy/types.ts',
        'src/ports/**',
        // Composition / framework wiring exercised end-to-end via integration
        // and CLI tests, not unit-tested directly.
        'src/server.ts',
        'src/http/app.ts',
        'src/cli/index.ts',
        'src/cli/composition.ts',
      ],
      thresholds: {
        'src/domain/**/*.ts': {
          lines: 80,
          branches: 70,
          functions: 80,
          statements: 80,
        },
        'src/adapters/**/*.ts': {
          lines: 60,
          branches: 50,
          functions: 60,
          statements: 60,
        },
        'src/http/**/*.ts': {
          lines: 60,
          branches: 50,
          functions: 60,
          statements: 60,
        },
      },
    },
  },
})
