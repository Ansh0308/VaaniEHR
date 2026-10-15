import { defineConfig } from 'vitest/config';

// Two projects:
//  - unit: no database, no network. `npm run test:unit` (and `npm run check:unit`) run only this one.
//  - db:   real PostgreSQL (the Docker db from `npm run db:up`, or a CI service). Files end in `.db.test.ts`.
//          Needed for what mocks cannot prove: append-only grants, hash-chain tampering, transactions, RBAC end to end.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: ['test/**/*.test.ts'],
          exclude: ['test/**/*.db.test.ts'],
          testTimeout: 10_000,
        },
      },
      {
        test: {
          name: 'db',
          environment: 'node',
          include: ['test/**/*.db.test.ts'],
          globalSetup: ['test/db/globalSetup.ts'],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/server.ts',
        'src/seed/seedDev.ts',
        'src/db/provision.ts',
        'src/audit/verifyCli.ts',
      ],
      reporter: ['text', 'text-summary', 'json-summary'],
      thresholds: {
        // Core modules named in the Phase 2A brief (NFR-MAINT-01: 70% target for core modules).
        'src/audit/**': { lines: 85, functions: 85, statements: 85, branches: 70 },
        'src/auth/**': { lines: 85, functions: 85, statements: 85, branches: 70 },
        'src/consent/**': { lines: 85, functions: 85, statements: 85, branches: 70 },
        'src/http/routeRegistry.ts': { lines: 85, functions: 85, statements: 85, branches: 65 },
      },
    },
  },
});
