import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    // Only the pure domain layer is unit-tested here. Anything that touches
    // React Native or expo-sqlite belongs in tests/db (node:sqlite) or in a
    // device/E2E run, so `npm test` stays fast enough to run on every save.
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
});
