import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, strictPort: true },
  test: {
    environment: 'jsdom',
    setupFiles: ['src/test-utils/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // page tests render the whole app (router, i18n, shell) in jsdom; several files run in parallel
    // each worker loads the whole app (router, i18n, motion); fewer workers keep memory use low on small machines
    maxWorkers: 2,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
