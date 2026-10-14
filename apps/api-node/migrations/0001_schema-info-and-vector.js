// Migration 0001 (Phase 1.1): enable pgvector and create a single-row schema_info table.
// Intentionally NO ClinicOS tables and NO clinical tables (ADR-D1, ADR-D11).

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.createExtension('vector', { ifNotExists: true });

  pgm.createTable('schema_info', {
    id: { type: 'smallint', primaryKey: true, default: 1, check: 'id = 1' },
    app_name: { type: 'text', notNull: true, default: 'vaaniehr' },
    schema_version: { type: 'integer', notNull: true, default: 1 },
    simulated_data_only: {
      type: 'boolean',
      notNull: true,
      default: true,
      check: 'simulated_data_only',
    },
    initialised_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.sql('INSERT INTO schema_info (id) VALUES (1)');
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.dropTable('schema_info');
  pgm.dropExtension('vector', { ifExists: true });
};
