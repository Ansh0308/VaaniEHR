// Migration 0007 (Phase 3A fix): why a medicine row was retired.
// The importer retires rows that a later run no longer produces ("not in the NLEM import") and brings them back if a later
// run produces them again. A row an admin retired has no reason and is never brought back by an import.

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.sql('ALTER TABLE medicine_master ADD COLUMN retired_reason text');
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.sql('ALTER TABLE medicine_master DROP COLUMN IF EXISTS retired_reason');
};
