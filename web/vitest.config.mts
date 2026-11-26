import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    typecheck: { tsconfig: './tsconfig.test.json' },
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/lib/**', 'src/types/**'],
      exclude: ['src/lib/supabase/**'],
    },
  },
  resolve: {
    alias: {
      '@': import.meta.dirname + '/src',
    },
  },
})
